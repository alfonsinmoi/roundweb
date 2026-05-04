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
from ..db import get_conn
from ..odoo_cuotas import get_cuotas
from .centros import buscar_centro, proximo_centro_round_robin, get_centros_activos
from ..email_sender import enviar as enviar_email
from ..email_templates import trigger as trigger_email
from ..lead_scoring import calcular_score, color_for_score, LOST_REASONS
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
        'lead_url':      f'https://round.wiemspro.com/crm',
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

    # id_manager fijo (Round Málaga / único manager por ahora). Multi-tenant en el futuro.
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '17675')

    # 1) Determinar centro
    centro = None
    if centro_slug:
        centro = buscar_centro(id_manager, slug=centro_slug)
    if not centro:
        centro = proximo_centro_round_robin(id_manager)
    if not centro:
        return jsonify({'ok': False, 'error': 'no_hay_centros_configurados'}), 503

    full_name = (f'{nombre} {apellidos}'.strip()) or email or telefono

    # 2) Crear lead en Odoo
    description_lines = [f'<b>Origen:</b> Formulario web roundtrainingcenter.com']
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
            'company_id': cfg.ODOO_COMPANY,
        }
        odoo_lead_id = oc._call('crm.lead', 'create', vals)
        log.info(f'Lead Odoo creado id={odoo_lead_id} centro={centro["nombre_centro"]}')
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
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO lead_asignacion
                  (id_manager, id_trainer, odoo_lead_id, origen,
                   utm_source, utm_medium, utm_campaign, raw_payload,
                   qualification, score, stage_history)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (odoo_lead_id) DO NOTHING
                RETURNING *
            """, (id_manager, centro['id_trainer'], odoo_lead_id or 0, 'web_form',
                  d.get('utm_source'), d.get('utm_medium'), d.get('utm_campaign'),
                  json.dumps(d, ensure_ascii=False),
                  json.dumps(qualification, ensure_ascii=False),
                  0,  # score se calcula a continuación
                  json.dumps([{'stage': 'Nuevo', 'at': datetime.now(timezone.utc).isoformat()}], ensure_ascii=False)))
            row = cur.fetchone()
            # Score inicial
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

        # Fallback: si NO hay ninguna plantilla activa para "lead_creado_trainer",
        # mandamos el email hardcoded de toda la vida para no perder el aviso.
        sent_trainer = any(d == 'trainer' and ok for d, ok in results)
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
<p>Gestionar: <a href="https://round.wiemspro.com/crm">panel CRM</a></p>"""
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


# ── Listar leads para el dashboard Round (manager + trainer) ────────────────
@bp.route('/leads/<int:lead_id>', methods=['PATCH'])
@auth_required
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
def list_stages():
    """Lista las etapas del pipeline CRM (crm.stage)."""
    try:
        oc = get_cuotas()
        ids = oc._call('crm.stage','search',[],{'order':'sequence,id'})
        if not ids: return jsonify({'ok': True, 'stages': []})
        stages = oc._call('crm.stage','read', ids,
            ['id','name','sequence','is_won','fold'])
        return jsonify({'ok': True, 'stages': stages})
    except Exception as e:
        log.exception('list_stages')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/leads', methods=['GET'])
@auth_required
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

        # Enriquecer con datos de Odoo crm.lead
        oc = get_cuotas()
        ids = [a['odoo_lead_id'] for a in asignaciones if a.get('odoo_lead_id')]
        leads_by_id = {}
        if ids:
            try:
                arr = oc._call('crm.lead', 'read', ids,
                    ['id','name','contact_name','email_from','phone','stage_id',
                     'priority','create_date','date_deadline','description','probability'])
                leads_by_id = {l['id']: l for l in arr}
            except Exception as e:
                log.warning(f'crm.lead read: {e}')

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
def list_lost_reasons():
    """Lista los motivos de pérdida estándar (frontend los usa en dropdown)."""
    return jsonify({'ok': True, 'reasons': LOST_REASONS})


@bp.route('/funnel', methods=['GET'])
@auth_required
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
                arr = oc._call('crm.lead','read', ids, ['id','stage_id'])
                leads_by_id = {l['id']: l for l in arr}
            except Exception as e:
                log.warning(f'funnel odoo read: {e}')

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
