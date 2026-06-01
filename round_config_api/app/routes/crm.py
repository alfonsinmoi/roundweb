"""Endpoints CRM:
  POST /api/crm/lead       (público)  — recibe form web, crea lead en Odoo
  POST /api/crm/lead-meta  (público)  — recibe webhook Meta Lead Ads
  GET  /api/crm/leads      (auth)     — lista leads para el dashboard Round
  PATCH /api/crm/leads/:id (auth)     — actualizar etapa, asignación, etc.
"""
import os, json, logging, re, time
from collections import defaultdict
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..odoo_guard import require_feature
from ..db import get_conn
from ..odoo_cuotas import get_cuotas
from .centros import buscar_centro, proximo_centro_round_robin, get_centros_activos
from ..email_sender import enviar as enviar_email
from ..email_templates import trigger as trigger_email
from ..lead_scoring import calcular_score, color_for_score, LOST_REASONS
from ..audit_log import log_action, actor_from_request
from .. import config as cfg
from datetime import datetime, timezone

bp = Blueprint('crm', __name__)
log = logging.getLogger(__name__)

# Rate limit muy simple por IP en memoria (resetea al reiniciar servicio)
_RL_BUCKET = defaultdict(list)
_RL_MAX = 8           # peticiones
_RL_WINDOW = 60 * 5   # 5 min


def _rate_limit_ok(ip):
    now = time.time()
    bucket = [t for t in _RL_BUCKET[ip] if now - t < _RL_WINDOW]
    bucket.append(now)
    _RL_BUCKET[ip] = bucket
    return len(bucket) <= _RL_MAX


def _email_valid(s):
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$', (s or '').strip()))


# Mapa stage_name (en BD Odoo) → evento del trigger.
# Si tu pipeline está renombrado en Odoo, ajusta aquí.
STAGE_EVENT_MAP = {
    'nuevo':       None,                    # Ya disparado al crear
    'contactado':  'etapa_contactado_lead',
    'visita':      'etapa_visita_lead',
    'prueba':      'etapa_prueba_lead',
    'alta':        'etapa_alta_lead',
    'perdido':     'lead_perdido_lead',
}

# Etapas que marcan "ya contactado" — para actualizar last_contact_at
CONTACTED_STAGES = {'contactado', 'visita', 'prueba', 'alta'}
LOST_STAGE_NAMES = {'perdido', 'lost'}


def _build_ctx(lead_id, lead_name, lead_email, lead_phone, lead_message,
               cuota_interes, centro):
    """Construye el dict de variables para los templates."""
    return {
        'lead_id':       str(lead_id or ''),
        'lead_name':     lead_name or '',
        'lead_email':    lead_email or '',
        'lead_phone':    lead_phone or '',
        'lead_message':  lead_message or '',
        'lead_url':      f'https://noofit.wiemspro.com/crm',
        'cuota_interes': cuota_interes or '',
        'trainer_name':  centro.get('nombre_centro') or '' if centro else '',
        'trainer_phone': centro.get('telefono') or '' if centro else '',
        'trainer_email': centro.get('email') or '' if centro else '',
        'centro_name':   centro.get('nombre_centro') or '' if centro else '',
        'centro_email':  centro.get('email') or '' if centro else '',
        'centro_slug':   centro.get('slug') or '' if centro else '',
        'centro_ciudad': centro.get('ciudad') or '' if centro else '',
        'id_trainer':    centro.get('id_trainer') or '' if centro else '',
        'manager_email': os.getenv('ROUND_MANAGER_EMAIL', ''),
    }


# ── Endpoint público para form web ──────────────────────────────────────────
@bp.route('/lead', methods=['POST', 'OPTIONS'])
def crear_lead_publico():
    if request.method == 'OPTIONS':
        # CORS preflight
        return ('', 204)

    ip = request.headers.get('X-Real-IP') or request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr or 'unknown'
    if not _rate_limit_ok(ip):
        return jsonify({'ok': False, 'error': 'rate_limited'}), 429

    try:
        # Acepta JSON o form-data (Elementor manda multipart)
        d = request.get_json(silent=True) or request.form.to_dict() or {}
    except Exception:
        d = {}

    # Honeypot — campo oculto que solo bots rellenan
    if d.get('website') or d.get('url'):
        log.warning(f'Lead bloqueado por honeypot, ip={ip}')
        return jsonify({'ok': True, 'skipped': True}), 200  # respuesta OK para no dar pistas

    # id_manager fijo (Round Málaga). El webhook multi-tenant (Tally) usa
    # /api/crm/lead/tally?k=<token>; este endpoint legacy sigue mono-manager.
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '17675')
    return _procesar_lead(id_manager, d, origen='web_form',
                          company_id=cfg.ODOO_COMPANY, origen_label='Formulario web')


def _procesar_lead(id_manager, d, *, origen='web_form', company_id=None,
                   origen_label='Formulario web'):
    """Núcleo de creación de lead, reutilizable por el form web (mono-manager)
    y por el webhook Tally (multi-tenant). Recibe el dict plano `d` con los
    campos ya normalizados. Crea el crm.lead en `company_id` (la company del
    manager destino), guarda lead_asignacion y dispara emails.

    Devuelve (jsonify_response, status).
    """
    nombre = (d.get('nombre') or d.get('name') or '').strip()
    apellidos = (d.get('apellidos') or d.get('surname') or '').strip()
    email = (d.get('email') or '').strip()
    telefono = (d.get('telefono') or d.get('phone') or '').strip()
    mensaje = (d.get('mensaje') or d.get('message') or d.get('comments') or '').strip()
    centro_slug = (d.get('centro') or d.get('centro_slug') or '').strip().lower()
    cuota_interes = (d.get('cuota') or d.get('cuota_interes') or '').strip()
    objetivo = (d.get('objetivo') or '').strip()
    presupuesto = (d.get('presupuesto') or '').strip()
    edad = (d.get('edad') or d.get('age') or '').strip()
    fecha_disponible = (d.get('fecha_disponible') or '').strip()
    ciudad = (d.get('ciudad') or d.get('city') or '').strip()

    if not email and not telefono:
        return jsonify({'ok': False, 'error': 'email_o_telefono_requerido'}), 400
    if email and not _email_valid(email):
        return jsonify({'ok': False, 'error': 'email_invalido'}), 400

    if company_id is None:
        company_id = cfg.ODOO_COMPANY

    # 1) Determinar centro (del manager destino)
    centro = None
    if centro_slug:
        centro = buscar_centro(id_manager, slug=centro_slug)
    if not centro:
        centro = proximo_centro_round_robin(id_manager)
    if not centro:
        return jsonify({'ok': False, 'error': 'no_hay_centros_configurados'}), 503

    full_name = (f'{nombre} {apellidos}'.strip()) or email or telefono

    # 2) Crear lead en Odoo (en la company del manager)
    description_lines = [f'<b>Origen:</b> {origen_label}']
    if cuota_interes: description_lines.append(f'<b>Cuota interés:</b> {cuota_interes}')
    if objetivo:      description_lines.append(f'<b>Objetivo:</b> {objetivo}')
    if presupuesto:   description_lines.append(f'<b>Presupuesto:</b> {presupuesto}')
    if mensaje:       description_lines.append(f'<b>Mensaje:</b><br/>{mensaje}')
    description_lines.append(
        f'<br/><i>Centro asignado: {centro["nombre_centro"]} '
        f'(trainer #{centro["id_trainer"]} · {centro["email"]})</i>'
    )
    if d.get('utm_source'):  description_lines.append(f'<i>UTM source: {d["utm_source"]}</i>')
    if d.get('utm_medium'):  description_lines.append(f'<i>UTM medium: {d["utm_medium"]}</i>')
    if d.get('utm_campaign'):description_lines.append(f'<i>UTM campaign: {d["utm_campaign"]}</i>')

    odoo_lead_id = None
    try:
        oc = get_cuotas()
        vals = {
            'name': f'Web · {full_name}',
            'contact_name': full_name,
            'email_from': email or False,
            'phone': telefono or False,
            'description': '<br/>'.join(description_lines),
            'type': 'opportunity',
            'priority': '0',
            'company_id': company_id,
        }
        odoo_lead_id = oc._call('crm.lead', 'create', vals)
        log.info(f'Lead Odoo creado id={odoo_lead_id} mgr={id_manager} '
                 f'company={company_id} centro={centro["nombre_centro"]}')
    except Exception as e:
        log.exception('crm.lead create')
        # NO devolvemos error al cliente — guardamos en BD nuestra y seguimos
        odoo_lead_id = None

    # 3) Guardar asignación en nuestra BD (con qualification + score inicial)
    qualification = {
        'objetivo':         objetivo or None,
        'presupuesto':      presupuesto or None,
        'cuota_interes':    cuota_interes or None,
        'edad':             edad or None,
        'fecha_disponible': fecha_disponible or None,
        'ciudad':           ciudad or None,
    }
    qualification = {k: v for k, v in qualification.items() if v}

    try:
        from .canales_captacion import resolver_canal_id
        canal_id = resolver_canal_id(id_manager, d.get('utm_source'))
    except Exception:
        canal_id = None

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO lead_asignacion
                  (id_manager, id_trainer, odoo_lead_id, origen,
                   utm_source, utm_medium, utm_campaign, raw_payload,
                   qualification, score, stage_history, canal_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (odoo_lead_id) DO NOTHING
                RETURNING *
            """, (id_manager, centro['id_trainer'], odoo_lead_id or 0, origen,
                  d.get('utm_source'), d.get('utm_medium'), d.get('utm_campaign'),
                  json.dumps(d, ensure_ascii=False),
                  json.dumps(qualification, ensure_ascii=False),
                  0,  # score se calcula a continuación
                  json.dumps([{'stage': 'Nuevo', 'at': datetime.now(timezone.utc).isoformat()}], ensure_ascii=False),
                  canal_id))
            row = cur.fetchone()
            if row:
                score = calcular_score(row, lead_odoo={'stage_id': [0, 'Nuevo']})
                cur.execute("UPDATE lead_asignacion SET score=%s WHERE id=%s", (score, row['id']))
    except Exception as e:
        log.warning(f'lead_asignacion: {e}')

    # 4) Disparar emails (lead + trainer) vía templates configurables
    try:
        ctx = _build_ctx(odoo_lead_id, full_name, email, telefono, mensaje,
                         cuota_interes, centro)
        results = trigger_email('lead_creado_lead', id_manager, ctx)
        results += trigger_email('lead_creado_trainer', id_manager, ctx)
        results += trigger_email('lead_creado_manager', id_manager, ctx)

        sent_trainer = any(dst == 'trainer' and ok for dst, ok in results)
        if not sent_trainer:
            cc_list = []
            if centro.get('email_cc'):
                cc_list.extend([e.strip() for e in centro['email_cc'].split(',') if e.strip()])
            manager_email = os.getenv('ROUND_MANAGER_EMAIL', '')
            if manager_email: cc_list.append(manager_email)
            body_html = f"""<p>Hola,</p>
<p>Te ha llegado un nuevo lead a tu centro <b>{centro['nombre_centro']}</b>:</p>
<table style="border-collapse:collapse">
  <tr><td><b>Nombre:</b></td><td>{full_name}</td></tr>
  <tr><td><b>Email:</b></td><td>{email}</td></tr>
  <tr><td><b>Teléfono:</b></td><td>{telefono}</td></tr>
  {'<tr><td><b>Mensaje:</b></td><td>'+mensaje+'</td></tr>' if mensaje else ''}
</table>
<p>Gestionar: <a href="https://noofit.wiemspro.com/crm">panel CRM</a></p>"""
            enviar_email(centro['email'],
                         f'Nuevo lead web — {full_name} ({centro["nombre_centro"]})',
                         f'Nuevo lead {full_name}\n{email}\n{telefono}',
                         body_html=body_html, cc=cc_list or None,
                         reply_to=email or None, id_manager=id_manager)
    except Exception as e:
        log.warning(f'email lead: {e}')

    return jsonify({
        'ok': True,
        'lead_id': odoo_lead_id,
        'centro': centro['nombre_centro'],
    }), 200


# ── Webhook Tally (multi-tenant por token) ─────────────────────────────────
# Tally envía un POST JSON con envelope anidado {data:{fields:[{label,type,
# value,options}]}}. Lo aplanamos a campos planos y reutilizamos _procesar_lead.
# Auth: ?k=<lead_webhook_token> identifica el manager destino sin exponer su id.

def _tally_norm(s):
    import unicodedata
    s = (s or '').lower().strip()
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def _tally_field_value(f):
    """Resuelve el valor de un campo Tally a string (resuelve choices por id)."""
    v = f.get('value')
    if v is None:
        return ''
    opts = f.get('options') or []
    if opts and isinstance(v, list):
        id2txt = {o.get('id'): o.get('text') for o in opts}
        return ', '.join(str(id2txt.get(x, x)) for x in v)
    if isinstance(v, list):
        return ', '.join(str(x) for x in v)
    if isinstance(v, bool):
        return 'Sí' if v else 'No'
    return str(v)


def _parse_tally(payload):
    """Aplana el FORM_RESPONSE de Tally a un dict plano compatible con
    _procesar_lead. Mapea por tipo de campo y por keywords en la etiqueta;
    lo no reconocido se acumula en `mensaje` para no perder información."""
    data = payload.get('data') or {}
    fields = data.get('fields') or []
    d = {}
    extras = []
    for f in fields:
        label = f.get('label') or f.get('key') or ''
        ftype = f.get('type') or ''
        val = _tally_field_value(f).strip()
        if not val:
            continue
        nlabel = _tally_norm(label)
        nkey = _tally_norm(f.get('key') or '')

        # Campos meta (utm_*, centro) por key o label exactos
        meta_hit = next((m for m in ('utm_source', 'utm_medium', 'utm_campaign', 'centro')
                         if m in (nkey, nlabel)), None)
        if meta_hit:
            d[meta_hit] = val
            continue

        if 'apellido' in nlabel and 'nombre' in nlabel:
            target = 'nombre'                      # campo combinado nombre+apellidos
        elif ftype == 'INPUT_EMAIL' or any(k in nlabel for k in ('email', 'correo', 'e-mail')):
            target = 'email'
        elif ftype == 'INPUT_PHONE_NUMBER' or any(k in nlabel for k in ('telefono', 'movil', 'celular', 'whatsapp', 'phone')):
            target = 'telefono'
        elif 'apellido' in nlabel:
            target = 'apellidos'
        elif 'nombre' in nlabel:
            target = 'nombre'
        elif any(k in nlabel for k in ('ciudad', 'localidad', 'poblacion', 'municipio')):
            target = 'ciudad'
        elif 'edad' in nlabel:
            target = 'edad'
        elif any(k in nlabel for k in ('objetivo', 'meta')):
            target = 'objetivo'
        elif 'presupuesto' in nlabel:
            target = 'presupuesto'
        elif any(k in nlabel for k in ('cuota', 'plan', 'tarifa', 'servicio')):
            target = 'cuota'
        elif any(k in nlabel for k in ('mensaje', 'comentario', 'consulta', 'cuentanos', 'observacion')):
            target = 'mensaje'
        else:
            target = None

        if target and not d.get(target):
            d[target] = val
        else:
            extras.append(f'{label}: {val}')

    if extras:
        base = d.get('mensaje', '')
        d['mensaje'] = (base + '\n' if base else '') + '\n'.join(extras)
    return d


@bp.route('/lead/tally', methods=['POST'])
def lead_tally():
    """Webhook de Tally. URL: /api/crm/lead/tally?k=<lead_webhook_token>.
    El token identifica el manager destino y su company Odoo."""
    k = (request.args.get('k') or '').strip()
    if not k:
        return jsonify({'ok': False, 'error': 'missing_token'}), 401

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id_manager, odoo_company_id, odoo_crm_enabled
                         FROM manager_config WHERE lead_webhook_token = %s""", (k,))
        mgr = cur.fetchone()
    if not mgr:
        return jsonify({'ok': False, 'error': 'invalid_token'}), 403
    if not mgr.get('odoo_crm_enabled'):
        return jsonify({'ok': False, 'error': 'crm_no_activado'}), 403

    payload = request.get_json(silent=True) or {}
    data = payload.get('data') or {}
    submission_id = data.get('submissionId') or data.get('responseId')

    # Idempotencia: Tally reintenta webhooks. Si ya procesamos este submission,
    # devolvemos OK sin duplicar.
    if submission_id:
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""SELECT 1 FROM lead_asignacion
                                WHERE id_manager = %s
                                  AND raw_payload->>'_tally_submission_id' = %s
                                LIMIT 1""",
                            (str(mgr['id_manager']), str(submission_id)))
                if cur.fetchone():
                    return jsonify({'ok': True, 'duplicate': True}), 200
        except Exception:
            pass   # si la columna no es jsonb o falla, seguimos (peor caso: dup)

    d = _parse_tally(payload)
    if not d.get('email') and not d.get('telefono'):
        return jsonify({'ok': False, 'error': 'sin_email_ni_telefono',
                        'detalle': 'El form Tally no trae email ni teléfono '
                                   'reconocibles. Revisa las etiquetas de los campos.'}), 400
    if submission_id:
        d['_tally_submission_id'] = str(submission_id)

    company_id = mgr.get('odoo_company_id') or cfg.ODOO_COMPANY
    return _procesar_lead(str(mgr['id_manager']), d, origen='tally',
                          company_id=company_id, origen_label='Formulario Tally')


# ── Crear lead manualmente desde el ERP (autenticado) ──────────────────────
# Caso de uso: una persona llega presencialmente al gimnasio sin haber
# pasado por el formulario web. El operador la registra desde el CRM Round
# y queda como lead normal (con origen='manual_erp' para distinguirlo).
@bp.route('/lead-manual', methods=['POST'])
@auth_required
@require_feature('crm')
def crear_lead_manual():
    """Crea un lead a mano desde el ERP. Mismos campos que el público pero
    con auth de manager + origen='manual_erp'. Sin honeypot/rate-limit."""
    d = request.get_json() or {}
    nombre = (d.get('nombre') or '').strip()
    apellidos = (d.get('apellidos') or '').strip()
    email = (d.get('email') or '').strip()
    telefono = (d.get('telefono') or '').strip()
    mensaje = (d.get('mensaje') or '').strip()
    centro_slug = (d.get('centro_slug') or '').strip().lower()
    id_trainer_explicito = (d.get('id_trainer') or '').strip()
    cuota_interes = (d.get('cuota_interes') or '').strip()
    objetivo = (d.get('objetivo') or '').strip()
    canal_id_explicito = d.get('canal_id')

    if not (nombre or apellidos):
        return jsonify({'ok': False, 'error': 'nombre_requerido'}), 400
    if not email and not telefono:
        return jsonify({'ok': False, 'error': 'email_o_telefono_requerido'}), 400
    if email and not _email_valid(email):
        return jsonify({'ok': False, 'error': 'email_invalido'}), 400

    id_manager = str(g.id_manager)
    actor = actor_from_request()

    # 1) Resolver centro: prioridad id_trainer explícito → slug → trainer
    # logueado → round-robin.
    centro = None
    if id_trainer_explicito:
        centro = buscar_centro(id_manager, id_trainer=id_trainer_explicito)
    if not centro and centro_slug:
        centro = buscar_centro(id_manager, slug=centro_slug)
    if not centro and g.id_trainer:
        centro = buscar_centro(id_manager, id_trainer=str(g.id_trainer))
    if not centro:
        centro = proximo_centro_round_robin(id_manager)
    if not centro:
        return jsonify({'ok': False, 'error': 'no_hay_centros_configurados'}), 503

    full_name = f'{nombre} {apellidos}'.strip() or email or telefono

    # 2) Crear lead en Odoo (mismo formato que público, etiquetado "Manual")
    description_lines = [
        f'<b>Origen:</b> Alta manual desde ERP por '
        f'{actor.get("label") or actor.get("email") or "operador"}'
    ]
    if cuota_interes: description_lines.append(f'<b>Cuota interés:</b> {cuota_interes}')
    if objetivo:      description_lines.append(f'<b>Objetivo:</b> {objetivo}')
    if mensaje:       description_lines.append(f'<b>Mensaje:</b><br/>{mensaje}')
    description_lines.append(
        f'<br/><i>Centro asignado: {centro["nombre_centro"]} '
        f'(trainer #{centro["id_trainer"]} · {centro["email"]})</i>'
    )

    odoo_lead_id = None
    try:
        oc = get_cuotas()
        vals = {
            'name': f'Manual · {full_name}',
            'contact_name': full_name,
            'email_from': email or False,
            'phone': telefono or False,
            'description': '<br/>'.join(description_lines),
            'type': 'opportunity',
            'priority': '1',
            'company_id': cfg.ODOO_COMPANY,
        }
        odoo_lead_id = oc._call('crm.lead', 'create', vals)
        log.info(f'[lead_manual] Odoo lead id={odoo_lead_id} por {actor.get("email")}')
    except Exception as e:
        log.exception('crm.lead create manual')
        return jsonify({'ok': False, 'error': 'odoo_crear_lead_fallo',
                        'detalle': str(e)[:200]}), 502

    # 3) Asignación local con origen='manual_erp'
    qualification = {k: v for k, v in {
        'objetivo': objetivo or None,
        'cuota_interes': cuota_interes or None,
    }.items() if v}

    canal_id = None
    if canal_id_explicito:
        try: canal_id = int(canal_id_explicito)
        except: canal_id = None

    asign_id = None
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO lead_asignacion
                  (id_manager, id_trainer, odoo_lead_id, origen,
                   raw_payload, qualification, score, stage_history, canal_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (id_manager, centro['id_trainer'], odoo_lead_id, 'manual_erp',
                  json.dumps(d, ensure_ascii=False),
                  json.dumps(qualification, ensure_ascii=False),
                  0,
                  json.dumps([{'stage': 'Nuevo',
                               'at': datetime.now(timezone.utc).isoformat(),
                               'by': actor.get('label') or actor.get('email')}],
                             ensure_ascii=False),
                  canal_id))
            asign_id = cur.fetchone()['id']
    except Exception as e:
        log.warning(f'lead_asignacion manual: {e}')

    log_action(actor, entidad='crm.lead', entidad_id=str(odoo_lead_id),
               accion='create_manual',
               resumen=f'Lead manual: {full_name} ({email or telefono}) → {centro["nombre_centro"]}')

    return jsonify({
        'ok': True,
        'lead_id': odoo_lead_id,
        'asignacion_id': asign_id,
        'centro': centro['nombre_centro'],
        'id_trainer': centro['id_trainer'],
    })


# ── Listar leads para el dashboard Round (manager + trainer) ────────────────
@bp.route('/leads/<int:lead_id>', methods=['PATCH'])
@auth_required
@require_feature('crm')
def update_lead(lead_id):
    """Actualiza un lead (etapa, prioridad, notas...).
    Body: { stage_id?, priority?, description?, name?, notes?, lost_reason_id? }
    """
    try:
        d = request.get_json() or {}
        # Whitelist de campos permitidos en Odoo
        allowed = ('stage_id','priority','description','name','contact_name',
                   'email_from','phone','date_deadline','expected_revenue',
                   'probability','lost_reason_id')
        vals = {k: d[k] for k in allowed if k in d}
        # Validación de tipos: stage_id / lost_reason_id deben ser enteros
        for int_field in ('stage_id', 'lost_reason_id'):
            if int_field in vals:
                try:
                    vals[int_field] = int(vals[int_field])
                except (TypeError, ValueError):
                    return jsonify({'ok': False, 'error': f'{int_field}_invalido', 'value': vals[int_field]}), 400
        # Campos que NO van a Odoo, pero sí a lead_asignacion
        lost_reason  = (d.get('lost_reason') or '').strip() or None
        qualification_patch = d.get('qualification') if isinstance(d.get('qualification'), dict) else None

        if not vals and not lost_reason and not qualification_patch:
            return jsonify({'ok': False, 'error': 'no_fields'}), 400

        # Pertenencia y datos previos
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM lead_asignacion
                 WHERE id_manager=%s AND odoo_lead_id=%s LIMIT 1
            """, (g.id_manager, lead_id))
            asig = cur.fetchone()
        if not asig:
            return jsonify({'ok': False, 'error': 'lead_not_found'}), 404
        if g.id_trainer and str(asig['id_trainer']) != str(g.id_trainer):
            return jsonify({'ok': False, 'error': 'forbidden'}), 403
        id_trainer = asig['id_trainer']
        oc = get_cuotas()

        # Snapshot stage_id ANTES (para detectar transición)
        prev_stage_id = None
        if 'stage_id' in vals:
            try:
                prev = oc._call('crm.lead','read',[lead_id],['stage_id'])
                if prev: prev_stage_id = (prev[0].get('stage_id') or [None])[0]
            except Exception:
                pass

        if vals:
            oc._call('crm.lead', 'write', [lead_id], vals)
        lead = oc._call('crm.lead','read',[lead_id],
            ['id','name','contact_name','email_from','phone','stage_id',
             'priority','create_date','date_deadline','description','probability'])[0]

        new_stage_name = ''
        try: new_stage_name = (lead['stage_id'][1] or '').strip().lower() if lead.get('stage_id') else ''
        except: new_stage_name = ''
        is_lost = new_stage_name in LOST_STAGE_NAMES or bool(lost_reason)

        # Persistir cambios en lead_asignacion (qualification, last_contact_at, lost_reason, score, stage_history)
        try:
            with get_conn() as conn, conn.cursor() as cur:
                sets, params = [], []

                if qualification_patch:
                    new_qual = dict(asig.get('qualification') or {})
                    new_qual.update({k: v for k, v in qualification_patch.items() if v is not None})
                    sets.append("qualification=%s"); params.append(json.dumps(new_qual, ensure_ascii=False))

                # Cambio de etapa → actualizar last_contact_at, lost_reason, stage_history
                stage_changed = 'stage_id' in vals and lead.get('stage_id') and lead['stage_id'][0] != prev_stage_id
                if stage_changed:
                    history = list(asig.get('stage_history') or [])
                    history.append({
                        'stage': lead['stage_id'][1],
                        'at': datetime.now(timezone.utc).isoformat(),
                    })
                    sets.append("stage_history=%s"); params.append(json.dumps(history, ensure_ascii=False))

                    if new_stage_name in CONTACTED_STAGES:
                        sets.append("last_contact_at=%s"); params.append(datetime.now(timezone.utc))

                if is_lost:
                    if lost_reason:
                        sets.append("lost_reason=%s"); params.append(lost_reason)
                    sets.append("lost_at=%s"); params.append(datetime.now(timezone.utc))

                if sets:
                    params.append(asig['id'])
                    cur.execute(f"UPDATE lead_asignacion SET {', '.join(sets)} WHERE id=%s", params)

                # Recalcular score con la asignación actualizada
                cur.execute("SELECT * FROM lead_asignacion WHERE id=%s", (asig['id'],))
                asig_now = cur.fetchone()
                new_score = calcular_score(asig_now, lead_odoo=lead)
                cur.execute("UPDATE lead_asignacion SET score=%s WHERE id=%s",
                            (new_score, asig['id']))
        except Exception as e:
            log.warning(f'lead_asignacion update: {e}')

        # Trigger por cambio de etapa
        try:
            if 'stage_id' in vals and lead.get('stage_id') and lead['stage_id'][0] != prev_stage_id:
                evento = STAGE_EVENT_MAP.get(new_stage_name)
                if evento:
                    centro = buscar_centro(g.id_manager, id_trainer=id_trainer) or {}
                    full_name = lead.get('contact_name') or lead.get('name') or ''
                    if full_name.startswith('Web · '): full_name = full_name[6:]
                    ctx = _build_ctx(lead_id, full_name, lead.get('email_from'),
                                     lead.get('phone'), '', '', centro)
                    trigger_email(evento, g.id_manager, ctx)
        except Exception as e:
            log.warning(f'trigger etapa: {e}')

        return jsonify({'ok': True, 'lead': lead})
    except Exception as e:
        log.exception('update_lead')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/stages', methods=['GET'])
@auth_required
@require_feature('crm')
def list_stages():
    """Lista las etapas del pipeline CRM (crm.stage)."""
    try:
        oc = get_cuotas()
        ids = oc._call('crm.stage','search',[], order='sequence,id')
        if not ids: return jsonify({'ok': True, 'stages': []})
        stages = oc._call('crm.stage','read', ids,
            ['id','name','sequence','is_won','fold'])
        return jsonify({'ok': True, 'stages': stages})
    except Exception as e:
        log.exception('list_stages')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/leads', methods=['GET'])
@auth_required
@require_feature('crm')
def list_leads():
    """Manager ve todos. Trainer (impersonando) ve solo los suyos."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            if g.id_trainer:
                cur.execute("""
                    SELECT * FROM lead_asignacion
                     WHERE id_manager=%s AND id_trainer=%s
                     ORDER BY created_at DESC LIMIT 500
                """, (g.id_manager, g.id_trainer))
            else:
                cur.execute("""
                    SELECT * FROM lead_asignacion
                     WHERE id_manager=%s
                     ORDER BY created_at DESC LIMIT 500
                """, (g.id_manager,))
            asignaciones = cur.fetchall()

        if not asignaciones:
            return jsonify({'ok': True, 'leads': []})

        # ── Reservas de prueba asociadas (slot_reserva) por odoo_lead_id ──
        odoo_ids = [a['odoo_lead_id'] for a in asignaciones if a.get('odoo_lead_id')]
        reservas_por_lead = {}
        if odoo_ids:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT id, odoo_lead_id, noofit_sala_id, fecha_clase, nombre_clase,
                           estado, expira_at, confirmado_at, token, created_at,
                           noofit_cliente_id
                      FROM slot_reserva
                     WHERE odoo_lead_id = ANY(%s)
                     ORDER BY created_at DESC
                """, (odoo_ids,))
                rows = cur.fetchall() or []
                # Tomamos la más reciente por lead (el ORDER BY ya lo asegura)
                for r in rows:
                    key = r['odoo_lead_id']
                    if key not in reservas_por_lead:
                        reservas_por_lead[key] = r

        # Enriquecer con datos de Odoo crm.lead. Usamos search_read en lugar de
        # read([ids]) — el read falla ENTERO si algún id no pasa las record
        # rules (p.ej. multi-company: leads de otra compañía bloquean toda la
        # llamada). search_read filtra silenciosamente los inaccesibles y
        # devuelve los visibles. Si un lead queda fuera de leads_by_id se
        # devuelve con `lead: {}` y avisamos en logs.
        oc = get_cuotas()
        ids = [a['odoo_lead_id'] for a in asignaciones if a.get('odoo_lead_id')]
        leads_by_id = {}
        if ids:
            try:
                arr = oc._call('crm.lead', 'search_read',
                    [('id', 'in', ids)],
                    fields=['id','name','contact_name','email_from','phone','stage_id',
                            'priority','create_date','date_deadline','description','probability'])
                leads_by_id = {l['id']: l for l in arr}
                faltan = sorted(set(ids) - set(leads_by_id.keys()))
                if faltan:
                    log.warning(f'crm.lead search_read: {len(faltan)} leads no accesibles '
                                f'(probable record rule multi-company): {faltan}')
            except Exception as e:
                log.warning(f'crm.lead search_read: {e}')

        out = []
        now = datetime.now(timezone.utc)
        for a in asignaciones:
            row = {**a}
            l = leads_by_id.get(a['odoo_lead_id']) or {}
            row['lead'] = l

            # Recalcular score on-the-fly (más fresco que el almacenado)
            try:
                row['score'] = calcular_score(a, lead_odoo=l)
                row['score_color'] = color_for_score(row['score'])
            except Exception:
                row['score'] = a.get('score') or 0
                row['score_color'] = color_for_score(row['score'])

            # Métricas temporales
            created = a.get('created_at')
            if created:
                if created.tzinfo is None: created = created.replace(tzinfo=timezone.utc)
                row['hours_since_creation'] = round((now - created).total_seconds() / 3600, 1)
                row['days_since_creation']  = round(row['hours_since_creation'] / 24, 1)
            else:
                row['hours_since_creation'] = None
                row['days_since_creation']  = None

            stage_name = ''
            try: stage_name = (l.get('stage_id') and l['stage_id'][1] or '').strip().lower()
            except: pass
            row['warning_sin_contactar'] = (
                stage_name == 'nuevo'
                and row.get('hours_since_creation') is not None
                and row['hours_since_creation'] > 24
                and not a.get('lost_at')
            )

            # Reserva de prueba asociada (si la hay)
            reserva = reservas_por_lead.get(a.get('odoo_lead_id'))
            if reserva:
                fc = reserva.get('fecha_clase')
                exp = reserva.get('expira_at')
                if fc and getattr(fc, 'tzinfo', None) is None:
                    fc = fc.replace(tzinfo=timezone.utc)
                if exp and getattr(exp, 'tzinfo', None) is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                row['slot_reserva'] = {
                    'id':              reserva['id'],
                    'noofit_sala_id':  reserva.get('noofit_sala_id'),
                    'noofit_cliente_id': reserva.get('noofit_cliente_id'),
                    'fecha_clase':     fc.isoformat() if fc else None,
                    'nombre_clase':    reserva.get('nombre_clase'),
                    'estado':          reserva.get('estado'),
                    'expira_at':       exp.isoformat() if exp else None,
                    'confirmado_at':   reserva.get('confirmado_at').isoformat() if reserva.get('confirmado_at') else None,
                    'token':           reserva.get('token'),
                    'reserva_url':     f'/reserva/{reserva["token"]}' if reserva.get('token') else None,
                }
            else:
                row['slot_reserva'] = None

            out.append(row)
        return jsonify({'ok': True, 'leads': out})
    except Exception as e:
        log.exception('list_leads')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/lost-reasons', methods=['GET'])
@auth_required
@require_feature('crm')
def list_lost_reasons():
    """Lista los motivos de pérdida estándar (frontend los usa en dropdown)."""
    return jsonify({'ok': True, 'reasons': LOST_REASONS})


@bp.route('/funnel', methods=['GET'])
@auth_required
@require_feature('crm')
def funnel_analytics():
    """Analítica del embudo: conteo por etapa, tasa de conversión, motivos perdida,
    tiempo medio entre etapas, score medio. Manager ve todos, trainer solo los suyos."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            if g.id_trainer:
                cur.execute("""SELECT * FROM lead_asignacion
                                WHERE id_manager=%s AND id_trainer=%s""",
                            (g.id_manager, g.id_trainer))
            else:
                cur.execute("""SELECT * FROM lead_asignacion WHERE id_manager=%s""",
                            (g.id_manager,))
            asignaciones = cur.fetchall()

        # Datos Odoo para conocer la etapa actual
        oc = get_cuotas()
        ids = [a['odoo_lead_id'] for a in asignaciones if a.get('odoo_lead_id')]
        leads_by_id = {}
        if ids:
            try:
                arr = oc._call('crm.lead', 'search_read',
                    [('id', 'in', ids)], fields=['id','stage_id'])
                leads_by_id = {l['id']: l for l in arr}
                faltan = sorted(set(ids) - set(leads_by_id.keys()))
                if faltan:
                    log.warning(f'funnel: {len(faltan)} leads bloqueados por rules: {faltan}')
            except Exception as e:
                log.warning(f'funnel search_read: {e}')

        # ── Conteo por etapa actual + perdidos ──
        stages_count = defaultdict(int)
        lost_count = 0
        scores = []
        lost_reasons_count = defaultdict(int)
        time_in_stage = defaultdict(list)   # transiciones X→Y en horas
        avg_first_contact_h = []

        for a in asignaciones:
            l = leads_by_id.get(a['odoo_lead_id']) or {}
            stage_name = ''
            try: stage_name = (l.get('stage_id') and l['stage_id'][1] or '').strip()
            except: pass
            if a.get('lost_at') or stage_name.lower() in LOST_STAGE_NAMES:
                lost_count += 1
                lr = a.get('lost_reason') or 'sin_motivo'
                lost_reasons_count[lr] += 1
            else:
                stages_count[stage_name or 'Sin etapa'] += 1
            scores.append(calcular_score(a, lead_odoo=l))

            # Tiempos entre etapas (a partir de stage_history)
            history = a.get('stage_history') or []
            for i in range(1, len(history)):
                try:
                    prev_at = datetime.fromisoformat(history[i-1]['at'].replace('Z','+00:00'))
                    curr_at = datetime.fromisoformat(history[i]['at'].replace('Z','+00:00'))
                    key = f"{history[i-1]['stage']} → {history[i]['stage']}"
                    time_in_stage[key].append((curr_at - prev_at).total_seconds() / 3600)
                except Exception:
                    pass

            # Tiempo hasta primer contacto
            if a.get('last_contact_at') and a.get('created_at'):
                ct = a['created_at']
                lc = a['last_contact_at']
                if ct.tzinfo is None: ct = ct.replace(tzinfo=timezone.utc)
                if lc.tzinfo is None: lc = lc.replace(tzinfo=timezone.utc)
                avg_first_contact_h.append((lc - ct).total_seconds() / 3600)

        total = len(asignaciones)
        won = stages_count.get('Alta', 0)
        avg_score = round(sum(scores) / len(scores), 1) if scores else 0
        conversion_rate = round((won / total) * 100, 1) if total else 0

        return jsonify({
            'ok': True,
            'total_leads': total,
            'won': won,
            'lost': lost_count,
            'open': total - won - lost_count,
            'conversion_rate_pct': conversion_rate,
            'avg_score': avg_score,
            'avg_first_contact_hours':
                round(sum(avg_first_contact_h) / len(avg_first_contact_h), 1)
                if avg_first_contact_h else None,
            'by_stage': [{'stage': k, 'count': v} for k, v in stages_count.items()],
            'lost_reasons': [{'reason': k, 'count': v} for k, v in lost_reasons_count.items()],
            'avg_time_between_stages_hours': {
                k: round(sum(v)/len(v), 1) for k, v in time_in_stage.items() if v
            },
        })
    except Exception as e:
        log.exception('funnel_analytics')
        return jsonify({'ok': False, 'error': str(e)}), 500
