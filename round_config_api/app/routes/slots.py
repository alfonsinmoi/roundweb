"""Endpoints públicos de reserva de prueba gratuita.

  GET  /api/crm/slots-disponibles?centro=<slug>          → lista slots
  POST /api/crm/lead-prueba                              → crea lead + reserva
  GET  /reserva/<token>                                  → página HTML pública
  POST /api/crm/reserva/<token>/confirmar                → confirma plaza
  POST /api/crm/reserva/<token>/cambiar                  → cambia a otro slot
  GET  /api/crm/reserva/<token>/slots                    → slots para cambiar

Todos públicos (sin auth_required) excepto rate-limit por IP.
"""
import os, re, json, secrets, logging, threading, time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify, render_template_string, abort, redirect
from ..db import get_conn
from ..slot_affluence import slots_disponibles, get_sala_info, _ms_to_dt
from ..email_templates import trigger as trigger_email
from ..email_sender import enviar as enviar_email
from .. import noofit_client as nc
from .centros import buscar_centro

# Cache clientes NoofitPro por manager (TTL 5 min) — get_clientes es lenta
_CLI_CACHE = {'data': None, 'expires_at': 0, 'lock': threading.Lock()}
_CLI_TTL = 300


def _clientes_cached():
    """Devuelve la lista de clientes NoofitPro cacheada. Refresca cada 5 min."""
    now = time.time()
    if _CLI_CACHE['data'] is not None and now < _CLI_CACHE['expires_at']:
        return _CLI_CACHE['data']
    with _CLI_CACHE['lock']:
        if _CLI_CACHE['data'] is not None and time.time() < _CLI_CACHE['expires_at']:
            return _CLI_CACHE['data']
        try:
            data = nc.get_clientes() or []
            _CLI_CACHE['data'] = data
            _CLI_CACHE['expires_at'] = now + _CLI_TTL
            return data
        except Exception as e:
            log.warning(f'_clientes_cached: {e}')
            return _CLI_CACHE['data'] or []


def _invalidate_clientes_cache():
    """Llamar tras crear un cliente nuevo para forzar refresh la próxima vez."""
    _CLI_CACHE['expires_at'] = 0

bp = Blueprint('slots', __name__)
log = logging.getLogger(__name__)

# Validación DNI / NIE / Pasaporte
_DNI_LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE'
DNI_RE   = re.compile(r'^([0-9]{8})([A-Z])$', re.I)
NIE_RE   = re.compile(r'^([XYZ])([0-9]{7})([A-Z])$', re.I)
PASS_RE  = re.compile(r'^[A-Z0-9]{5,15}$', re.I)


def _validar_documento(doc):
    """Devuelve ('dni'|'nie'|'pasaporte', valor_normalizado) o (None, error_msg)."""
    if not doc: return None, 'documento_requerido'
    doc = doc.strip().upper().replace(' ', '').replace('-', '')

    m = DNI_RE.match(doc)
    if m:
        num, letra = m.group(1), m.group(2)
        if _DNI_LETRAS[int(num) % 23] == letra:
            return 'dni', f'{num}{letra}'
        return None, 'dni_letra_incorrecta'

    m = NIE_RE.match(doc)
    if m:
        prefix, num, letra = m.group(1), m.group(2), m.group(3)
        prefix_num = {'X':'0','Y':'1','Z':'2'}[prefix]
        if _DNI_LETRAS[int(prefix_num + num) % 23] == letra:
            return 'nie', f'{prefix}{num}{letra}'
        return None, 'nie_letra_incorrecta'

    if PASS_RE.match(doc):
        return 'pasaporte', doc

    return None, 'formato_invalido'


def _new_token():
    return secrets.token_urlsafe(32)


def _public_url():
    return os.getenv('ROUND_PUBLIC_URL', 'https://noofit.wiemspro.com')


def _email_valid(s):
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$', (s or '').strip()))


# ── 1) Listar slots disponibles ─────────────────────────────────────────────
@bp.route('/api/crm/slots-disponibles', methods=['GET', 'OPTIONS'])
def listar_slots():
    """GET /api/crm/slots-disponibles?centro=<slug>&actividad=<id>

    Parámetros:
        centro      (obligatorio): slug del centro
        actividad   (opcional):    id de actividad NoofitPro para filtrar
        max         (opcional):    nº máximo de slots a devolver (default 12,
                                   máx 50)

    Devuelve:
        ok, centro, total, slots, por_dia, actividades
        donde `actividades` es la lista de actividades disponibles en la
        ventana de 14 días (para que el frontend público pueda mostrar un
        selector y filtrar). El listado se calcula SIN aplicar el filtro
        de actividad → así el selector siempre tiene todas las opciones.
    """
    if request.method == 'OPTIONS': return ('', 204)
    centro_slug = (request.args.get('centro') or '').strip().lower()
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '17675')
    if not centro_slug:
        return jsonify({'ok': False, 'error': 'centro_requerido'}), 400
    centro = buscar_centro(id_manager, slug=centro_slug)
    if not centro:
        return jsonify({'ok': False, 'error': 'centro_no_encontrado'}), 404

    # Filtros opcionales
    id_actividad = (request.args.get('actividad') or '').strip() or None
    try:
        max_resultados = min(int(request.args.get('max', '12')), 50)
    except ValueError:
        max_resultados = 12

    # Config del centro: días/actividades permitidos definidos por el manager
    dias_permitidos = centro.get('dias_permitidos') or []
    actividades_permitidas = centro.get('actividades_permitidas') or []

    try:
        result = slots_disponibles(id_trainer=centro['id_trainer'],
                                   dias_adelante=14,
                                   max_resultados=max_resultados,
                                   id_actividad=id_actividad,
                                   devolver_actividades=True,
                                   dias_permitidos=dias_permitidos,
                                   actividades_permitidas=actividades_permitidas)
        slots = result['slots']
        actividades = result['actividades']
        # Agrupar por día para que el form lo muestre fácil
        por_dia = defaultdict(list)
        for s in slots:
            por_dia[s['fecha_local']].append(s)
        return jsonify({
            'ok': True,
            'centro': {'slug': centro['slug'], 'nombre': centro['nombre_centro']},
            'actividad_filtro': id_actividad,
            'total': len(slots),
            'slots': slots,
            'por_dia': [{'fecha': d, 'slots': por_dia[d]}
                        for d in sorted(por_dia.keys())],
            'actividades': actividades,
        })
    except Exception as e:
        log.exception('listar_slots')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── 1.b) Marcar leads en una clase: para que la UI distinga lead vs cliente ─
@bp.route('/api/crm/leads-en-sala/<int:id_sala>', methods=['GET', 'OPTIONS'])
def leads_en_sala(id_sala):
    """Devuelve los `noofit_cliente_id` apuntados a una sala que provienen
    de una reserva de prueba (es decir: SON LEADS, no clientes pagantes
    todavía).

    Respuesta:
        {ok: true,
         leads: [
             {idnoofit, estado, nombre, apellidos, email, telefono, dni,
              token, fecha_clase, expira_at, confirmado_at, lead_creado_at,
              odoo_lead_id}, …
         ]}
    """
    if request.method == 'OPTIONS': return ('', 204)
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '17675')
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, noofit_cliente_id, estado,
                       nombre_lead, apellidos_lead, email_lead, telefono_lead,
                       dni, token, fecha_clase, expira_at, confirmado_at,
                       odoo_lead_id, created_at
                  FROM slot_reserva
                 WHERE id_manager = %s
                   AND noofit_sala_id = %s
                   AND estado IN ('creando','pendiente','confirmada')
                   AND noofit_cliente_id IS NOT NULL
                 ORDER BY created_at DESC
            """, (id_manager, int(id_sala)))
            rows = cur.fetchall()
        leads = [{
            'idnoofit':       r['noofit_cliente_id'],
            'estado':         r['estado'],
            'nombre':         r['nombre_lead'],
            'apellidos':      r['apellidos_lead'],
            'email':          r['email_lead'],
            'telefono':       r['telefono_lead'],
            'dni':            r['dni'],
            'token':          r['token'],
            'fecha_clase':    r['fecha_clase'].isoformat() if r['fecha_clase'] else None,
            'expira_at':      r['expira_at'].isoformat() if r['expira_at'] else None,
            'confirmado_at':  r['confirmado_at'].isoformat() if r['confirmado_at'] else None,
            'lead_creado_at': r['created_at'].isoformat() if r['created_at'] else None,
            'odoo_lead_id':   r['odoo_lead_id'],
        } for r in rows]
        return jsonify({'ok': True, 'id_sala': int(id_sala), 'leads': leads})
    except Exception as e:
        log.exception('leads_en_sala')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── 2) Crear lead + reservar slot ──────────────────────────────────────────
@bp.route('/api/crm/lead-prueba', methods=['POST', 'OPTIONS'])
def crear_lead_con_reserva():
    if request.method == 'OPTIONS': return ('', 204)
    try:
        d = request.get_json(silent=True) or request.form.to_dict() or {}
    except Exception:
        d = {}

    if d.get('website') or d.get('url'):
        return jsonify({'ok': True, 'skipped': True}), 200

    # El form builder usa /api/crm/form/<id> con su propio manager; este
    # endpoint legacy (form WP roundtrainingcenter) sigue mono-manager.
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '17677')
    return crear_reserva_core(id_manager, d)


def crear_reserva_core(id_manager, d):
    """Núcleo de creación de lead + reserva de slot de prueba, multi-tenant.
    Reutilizado por el form WP legacy y por el form builder embebible. Recibe
    el manager destino explícito y el dict plano `d` (ya sin honeypot)."""
    nombre = (d.get('nombre') or d.get('name') or '').strip()
    apellidos = (d.get('apellidos') or d.get('surname') or '').strip()
    email = (d.get('email') or '').strip().lower()
    telefono = (d.get('telefono') or d.get('phone') or '').strip()
    centro_slug = (d.get('centro') or d.get('centro_slug') or '').strip().lower()
    sala_id = d.get('id_sala') or d.get('sala_id')
    documento = d.get('dni') or d.get('documento') or ''

    if not nombre or not email or not telefono:
        return jsonify({'ok': False, 'error': 'nombre_email_telefono_requeridos'}), 400
    if not _email_valid(email):
        return jsonify({'ok': False, 'error': 'email_invalido'}), 400
    if not sala_id:
        return jsonify({'ok': False, 'error': 'id_sala_requerido'}), 400
    try: sala_id = int(sala_id)
    except: return jsonify({'ok': False, 'error': 'id_sala_invalido'}), 400

    tipo_doc, doc_norm = _validar_documento(documento)
    if not tipo_doc:
        return jsonify({'ok': False, 'error': f'documento_{doc_norm}'}), 400

    centro = buscar_centro(id_manager, slug=centro_slug)
    if not centro:
        return jsonify({'ok': False, 'error': 'centro_no_encontrado'}), 404

    # Verificar que la sala existe, no está llena y es del trainer correcto
    sala = get_sala_info(sala_id)
    if not sala:
        return jsonify({'ok': False, 'error': 'sala_no_encontrada'}), 404
    if str(sala.get('idTrainer')) != str(centro['id_trainer']):
        return jsonify({'ok': False, 'error': 'sala_no_pertenece_al_centro'}), 400
    aforo = sala.get('aforo') or 0
    users = sala.get('users') or []
    ocupados = sum(1 for u in users if u.get('enabled', True))
    if ocupados >= aforo:
        return jsonify({'ok': False, 'error': 'sala_llena'}), 409

    # ── PERSISTIR RESERVA EN BD (rápido, sin NoofitPro/Odoo todavía) ──
    token = _new_token()
    expira_at = datetime.now(timezone.utc) + timedelta(hours=1)
    fecha_clase = _ms_to_dt(sala.get('dateStart'))
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO slot_reserva
                  (id_manager, id_trainer, odoo_lead_id, noofit_cliente_id,
                   noofit_sala_id, fecha_clase, nombre_clase, estado, token,
                   dni, nombre_lead, apellidos_lead, email_lead, telefono_lead,
                   expira_at)
                VALUES (%s,%s,NULL,NULL,%s,%s,%s,'creando',%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (id_manager, str(centro['id_trainer']),
                  sala_id, fecha_clase, sala.get('name'),
                  token, doc_norm, nombre, apellidos, email, telefono, expira_at))
            reserva = cur.fetchone()
    except Exception as e:
        log.exception('insert slot_reserva')
        return jsonify({'ok': False, 'error': 'error_persistiendo'}), 500

    # ── Lanzar TODO lo lento en background thread ──
    payload_bg = {
        'reserva_id': reserva['id'],
        'token':      token,
        'id_manager': id_manager,
        'centro':     dict(centro),     # copia para evitar mutaciones
        'sala':       sala,
        'sala_id':    sala_id,
        'fecha_clase': fecha_clase,
        'tipo_doc':   tipo_doc,
        'doc_norm':   doc_norm,
        'nombre':     nombre,
        'apellidos':  apellidos,
        'email':      email,
        'telefono':   telefono,
        'expira_at':  expira_at,
        'raw_form':   d,
    }
    threading.Thread(target=_procesar_reserva_async, args=(payload_bg,),
                     daemon=True, name=f'reserva-{reserva["id"]}').start()

    # ── Respuesta INMEDIATA (en <500ms) ──
    return jsonify({
        'ok': True,
        'reserva_id': reserva['id'],
        'token':      token,
        'expira_at':  expira_at.isoformat(),
        'sala': {
            'id':     sala_id,
            'nombre': sala.get('name'),
            'fecha':  fecha_clase.isoformat() if fecha_clase else None,
        },
        'estado': 'creando',
        'mensaje': 'Tu reserva se está procesando. Recibirás un email en breve para confirmarla.',
    })


def _procesar_reserva_async(p):
    """Hace la parte lenta: buscar/crear cliente NoofitPro, reservar sala,
    crear lead Odoo, mandar email. Si algo falla, marca la reserva como
    'error' en BD para que un admin pueda ver qué pasó."""
    try:
        log.info(f'[bg reserva-{p["reserva_id"]}] iniciando')

        # Resolver credenciales del TRAINER del centro (espacio propio en
        # NoofitPro). Si las hay, el cliente del lead-prueba se crea en la
        # cuenta del trainer; si no, fallback a manager (legacy).
        id_manager = p.get('id_manager') or (p.get('centro') or {}).get('id_manager')
        id_trainer = (p.get('centro') or {}).get('id_trainer')
        trn_email, trn_pwd = (None, None)
        if id_manager and id_trainer:
            trn_email, trn_pwd = nc.get_trainer_creds(id_manager, id_trainer)
        use_trainer_auth = bool(trn_email and trn_pwd)
        if not use_trainer_auth:
            log.warning(f'[bg reserva-{p["reserva_id"]}] sin trainer_noofit_creds '
                        f'(manager={id_manager} trainer={id_trainer}) — fallback a manager')

        # 1) Buscar cliente existente — en el ESPACIO del trainer si lo
        #    usamos como auth, o en el del manager si fallback.
        cliente_id = None
        try:
            if use_trainer_auth:
                clientes = nc.get_clientes_as_trainer(trn_email, trn_pwd)
            else:
                clientes = _clientes_cached()
            for c in clientes:
                c_dni = (c.get('dni') or '').strip().upper()
                c_email = (c.get('email') or '').strip().lower()
                if (c_dni and c_dni == p['doc_norm']) or (c_email and c_email == p['email']):
                    cliente_id = c.get('id')
                    log.info(f'[bg reserva-{p["reserva_id"]}] cliente reutilizado id={cliente_id} '
                             f'(scope={"trainer" if use_trainer_auth else "manager"})')
                    break
        except Exception as e:
            log.warning(f'[bg reserva-{p["reserva_id"]}] búsqueda cliente: {e}')

        # 2) Crear si no existía — en la cuenta del trainer (preferido) o
        #    del manager (fallback).
        if not cliente_id:
            try:
                payload = {
                    'name':    p['nombre'],
                    'surname': p['apellidos'],
                    'email':   p['email'],
                    'tlf':     p['telefono'],
                    'dni':     p['doc_norm'],
                }
                if use_trainer_auth:
                    res = nc.post_cliente_as_trainer(payload, trn_email, trn_pwd)
                else:
                    res = nc.post_cliente(payload)
                new_cli = (res.get('clientes') or res.get('data') or [])
                if new_cli and isinstance(new_cli, list):
                    cliente_id = new_cli[0].get('id') or new_cli[0].get('idClient')
                _invalidate_clientes_cache()
                log.info(f'[bg reserva-{p["reserva_id"]}] cliente creado id={cliente_id} '
                         f'(scope={"trainer" if use_trainer_auth else "manager"})')
            except Exception as e:
                log.exception(f'[bg reserva-{p["reserva_id"]}] post_cliente')

        if not cliente_id:
            _marcar_estado(p['reserva_id'], 'error_cliente')
            return

        # 3) Apuntar cliente a la sala
        try:
            full_name = f"{p['nombre']} {p['apellidos']}".strip()
            nc.reservar_clase(p['sala_id'], cliente_id, full_name)
        except Exception as e:
            log.exception(f'[bg reserva-{p["reserva_id"]}] reservar_clase')
            _marcar_estado(p['reserva_id'], 'error_reserva', cliente_id=cliente_id)
            return

        # 4) Crear lead Odoo
        odoo_lead_id = None
        try:
            from ..odoo_cuotas import get_cuotas
            from .. import config as cfg
            # Instancia ligada al manager de la reserva: el lead debe crearse
            # en SU company (con la default iría a la company de Round).
            oc = get_cuotas(p['id_manager'])
            full_name = f"{p['nombre']} {p['apellidos']}".strip() or p['email']
            sala = p['sala']
            fecha_clase = p['fecha_clase']
            desc = (
                f'<b>Origen:</b> Form web roundtrainingcenter.com (prueba)<br/>'
                f'<b>Slot reservado:</b> {sala.get("name")} · {fecha_clase.astimezone().strftime("%Y-%m-%d %H:%M") if fecha_clase else "?"}<br/>'
                f'<b>Documento:</b> {p["tipo_doc"].upper()} {p["doc_norm"]}<br/>'
                f'<b>Cliente NoofitPro:</b> #{cliente_id}<br/>'
                f'<b>Estado:</b> pendiente confirmación (1h)'
            )
            odoo_lead_id = oc._call('crm.lead', 'create', {
                'name': f'Web · {full_name}',
                'contact_name': full_name,
                'email_from': p['email'],
                'phone': p['telefono'],
                'description': desc,
                'type': 'opportunity',
                'priority': '0',
                'company_id': oc.company_id,
            })
        except Exception as e:
            log.warning(f'[bg reserva-{p["reserva_id"]}] odoo lead: {e}')

        # 5) Actualizar BD: estado='pendiente' + cliente + odoo_lead_id
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE slot_reserva SET
                                 estado='pendiente',
                                 noofit_cliente_id=%s,
                                 odoo_lead_id=%s
                               WHERE id=%s""",
                            (cliente_id, odoo_lead_id, p['reserva_id']))
                if odoo_lead_id:
                    # Resolver UTM → canal_id (si el manager tiene canales).
                    try:
                        from .canales_captacion import resolver_canal_id
                        utm_src = (p.get('raw_form') or {}).get('utm_source')
                        canal_id = resolver_canal_id(p['id_manager'], utm_src)
                    except Exception:
                        canal_id = None
                    cur.execute("""
                        INSERT INTO lead_asignacion
                          (id_manager, id_trainer, odoo_lead_id, origen,
                           qualification, raw_payload, canal_id,
                           utm_source, utm_medium, utm_campaign)
                        VALUES (%s,%s,%s,'web_form',%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (odoo_lead_id) DO NOTHING
                    """, (p['id_manager'], str(p['centro']['id_trainer']), odoo_lead_id,
                          json.dumps({'documento': f'{p["tipo_doc"]}:{p["doc_norm"]}',
                                      'slot_reserva_id': p['reserva_id']}),
                          json.dumps(p['raw_form'], ensure_ascii=False),
                          canal_id,
                          (p.get('raw_form') or {}).get('utm_source'),
                          (p.get('raw_form') or {}).get('utm_medium'),
                          (p.get('raw_form') or {}).get('utm_campaign')))
        except Exception as e:
            log.exception(f'[bg reserva-{p["reserva_id"]}] update bd')

        # 6) Email de confirmación
        try:
            centro = p['centro']
            sala = p['sala']
            fecha_clase = p['fecha_clase']
            confirm_url = f'{_public_url()}/reserva/{p["token"]}'
            ctx = {
                'lead_name':     f"{p['nombre']} {p['apellidos']}".strip(),
                'lead_email':    p['email'],
                'lead_phone':    p['telefono'],
                'lead_url':      confirm_url,
                'centro_name':   centro.get('nombre_centro') or '',
                'centro_email':  centro.get('email') or '',
                'centro_slug':   centro.get('slug') or '',
                'centro_ciudad': centro.get('ciudad') or '',
                'trainer_name':  centro.get('nombre_centro') or '',
                'trainer_phone': centro.get('telefono') or '',
                'trainer_email': centro.get('email') or '',
                'id_trainer':    centro.get('id_trainer') or '',
                'slot_nombre':   sala.get('name') or '',
                'slot_fecha':    fecha_clase.astimezone().strftime('%A %d/%m/%Y') if fecha_clase else '',
                'slot_hora':     fecha_clase.astimezone().strftime('%H:%M') if fecha_clase else '',
                'confirm_url':   confirm_url,
                'expira_at':     p['expira_at'].astimezone().strftime('%H:%M'),
                'lead_id':       str(odoo_lead_id or ''),
                'manager_email': '',
            }
            results = trigger_email('slot_reservado_lead', p['id_manager'], ctx)
            log.info(f'[bg reserva-{p["reserva_id"]}] email enviado: {results}')
        except Exception as e:
            log.warning(f'[bg reserva-{p["reserva_id"]}] email: {e}')

        log.info(f'[bg reserva-{p["reserva_id"]}] FIN ok')
    except Exception as e:
        log.exception(f'[bg reserva-{p["reserva_id"]}] error general')
        _marcar_estado(p['reserva_id'], 'error_general')


def _marcar_estado(reserva_id, estado, cliente_id=None):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            if cliente_id:
                cur.execute("UPDATE slot_reserva SET estado=%s, noofit_cliente_id=%s WHERE id=%s",
                            (estado, cliente_id, reserva_id))
            else:
                cur.execute("UPDATE slot_reserva SET estado=%s WHERE id=%s",
                            (estado, reserva_id))
    except Exception as e:
        log.exception(f'_marcar_estado {reserva_id}')


# ── 3) Página HTML pública para confirmar/cambiar ───────────────────────────
PAGE_HTML = """<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{ titulo }}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #060608; color: #f4f4f6;
         margin: 0; padding: 24px; min-height: 100vh; }
  .card { max-width: 540px; margin: 32px auto; background: #16171c;
          border: 1px solid #26282e; border-radius: 16px; padding: 32px; }
  h1 { font-size: 24px; margin: 0 0 8px; color: #f4f4f6; }
  .muted { color: #b0b0bc; font-size: 14px; }
  .slot-info { background: #1e2025; border-radius: 12px; padding: 16px;
               margin: 20px 0; border: 1px solid #2dd4a826; }
  .slot-info b { color: #2dd4a8; }
  .timer { background: #fbbf241a; border: 1px solid #fbbf2440; padding: 12px;
           border-radius: 8px; font-size: 13px; color: #fbbf24; margin: 16px 0; }
  .btn { display: inline-block; padding: 14px 28px; border-radius: 10px;
         background: linear-gradient(135deg,#2dd4a8,#1a9a7a); color: #060608;
         font-weight: 700; text-decoration: none; border: none; cursor: pointer;
         margin: 8px 4px; font-size: 15px; }
  .btn-secondary { background: #26282e; color: #f4f4f6; }
  .btn-danger { background: #f87171; color: #fff; }
  .err { background: #f871711a; border: 1px solid #f8717140; padding: 12px;
         border-radius: 8px; color: #f87171; }
  .ok { background: #2dd4a81a; border: 1px solid #2dd4a840; padding: 12px;
        border-radius: 8px; color: #2dd4a8; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .anular-form { background: #1e2025; border: 1px solid #f8717140; padding: 16px;
                 border-radius: 12px; margin-top: 12px; display: none; }
  .anular-form.active { display: block; }
  .anular-form textarea { width: 100%; min-height: 80px; padding: 10px;
                          background: #060608; color: #f4f4f6;
                          border: 1px solid #26282e; border-radius: 8px;
                          font-size: 14px; font-family: inherit; resize: vertical; }
  .anular-form label { display: block; font-size: 12px; color: #b0b0bc; margin-bottom: 6px; }
  .anular-form .row { display: flex; gap: 6px; margin-top: 10px; }
  .motivo-box { background: #1e2025; border-left: 3px solid #f87171;
                padding: 12px; border-radius: 6px; margin-top: 12px; font-size: 13px; }
  .motivo-box b { color: #f87171; display: block; margin-bottom: 4px; }
</style></head>
<body><div class="card">
{% if estado == 'pendiente' %}
  <h1>Confirma tu prueba en {{ reserva.centro_nombre }}</h1>
  <p class="muted">Hola <b>{{ reserva.nombre_lead }}</b>, tienes esta plaza reservada:</p>
  <div class="slot-info">
    <p><b>Clase:</b> {{ reserva.nombre_clase }}</p>
    <p><b>Día:</b> {{ reserva.fecha_local }}</p>
    <p><b>Hora:</b> {{ reserva.hora_local }}</p>
  </div>
  <div class="timer">⏰ Caduca a las <b>{{ reserva.expira_local }}</b>. Si no confirmas, la plaza se libera.</div>
  <div class="actions">
    <form method="POST" action="/api/crm/reserva/{{ token }}/confirmar" style="display:inline">
      <button type="submit" class="btn">✓ Confirmar plaza</button>
    </form>
    <a href="/reserva/{{ token }}/cambiar" class="btn btn-secondary">🔄 Cambiar día/hora</a>
    <button type="button" class="btn btn-danger"
            onclick="document.getElementById('anular').classList.add('active');this.style.display='none'">
      ✕ Anular
    </button>
  </div>
  <form id="anular" method="POST" action="/api/crm/reserva/{{ token }}/anular" class="anular-form">
    <label for="motivo">¿Por qué quieres anular? (opcional, nos ayuda a mejorar)</label>
    <textarea name="motivo" id="motivo" placeholder="Ej. me ha surgido un imprevisto, ya no me interesa, prefiero otro centro…"></textarea>
    <div class="row">
      <button type="submit" class="btn btn-danger">Sí, anular reserva</button>
      <button type="button" class="btn btn-secondary"
              onclick="this.closest('form').classList.remove('active')">Volver</button>
    </div>
  </form>
{% elif estado == 'confirmada' %}
  <h1>¡Plaza confirmada! 🎉</h1>
  <div class="ok">Tu plaza está confirmada. Te esperamos en <b>{{ reserva.centro_nombre }}</b>:</div>
  <div class="slot-info">
    <p><b>Clase:</b> {{ reserva.nombre_clase }}</p>
    <p><b>Día:</b> {{ reserva.fecha_local }}</p>
    <p><b>Hora:</b> {{ reserva.hora_local }}</p>
  </div>
  <p class="muted">Recibirás un email con los detalles. Si no puedes asistir, anula la reserva con un motivo:</p>
  <div class="actions">
    <a href="/reserva/{{ token }}/cambiar" class="btn btn-secondary">🔄 Cambiar día/hora</a>
    <button type="button" class="btn btn-danger"
            onclick="document.getElementById('anular').classList.add('active');this.style.display='none'">
      ✕ Anular plaza
    </button>
  </div>
  <form id="anular" method="POST" action="/api/crm/reserva/{{ token }}/anular" class="anular-form">
    <label for="motivo">¿Por qué anulas? (opcional, nos ayuda a entender)</label>
    <textarea name="motivo" id="motivo" placeholder="Ej. enfermedad, imprevisto laboral, cambio de planes…"></textarea>
    <div class="row">
      <button type="submit" class="btn btn-danger">Sí, anular plaza</button>
      <button type="button" class="btn btn-secondary"
              onclick="this.closest('form').classList.remove('active')">Volver</button>
    </div>
  </form>
{% elif estado == 'expirada' %}
  <h1>Reserva expirada ⌛</h1>
  <div class="err">Lo sentimos, tu reserva caducó por falta de confirmación. La plaza ha vuelto a estar disponible.</div>
  <p>Puedes hacer una nueva reserva desde <a href="https://roundtrainingcenter.com/prueba-gratuita/">la web</a>.</p>
{% elif estado == 'cancelada' %}
  <h1>Reserva cancelada</h1>
  <div class="err">Esta reserva fue cancelada{% if reserva.cancelado_local %} el {{ reserva.cancelado_local }}{% endif %}.</div>
  {% if reserva.motivo_cancelacion %}
  <div class="motivo-box">
    <b>Motivo:</b>
    {{ reserva.motivo_cancelacion }}
  </div>
  {% endif %}
  <p class="muted" style="margin-top:16px">¿Cambio de planes? Puedes hacer una nueva reserva desde <a href="https://roundtrainingcenter.com/prueba-gratuita/" style="color:#2dd4a8">la web</a>.</p>
{% else %}
  <h1>Reserva no encontrada</h1>
  <div class="err">El enlace no es válido o ha expirado.</div>
{% endif %}
</div></body></html>
"""


@bp.route('/reserva/<token>', methods=['GET'])
def pagina_reserva(token):
    """Página HTML pública (no JSON)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT r.*, c.nombre_centro AS centro_nombre, c.email AS centro_email "
                    "FROM slot_reserva r LEFT JOIN centro_contacto c "
                    " ON c.id_trainer = r.id_trainer AND c.id_manager = r.id_manager "
                    "WHERE r.token=%s LIMIT 1", (token,))
        reserva = cur.fetchone()
    if not reserva:
        return render_template_string(PAGE_HTML, titulo='Reserva no encontrada',
                                       estado='not_found', reserva={}, token=token)
    estado = reserva['estado']
    # Auto-marcar como expirada si pasó la hora
    if estado == 'pendiente' and reserva['expira_at'] and \
       reserva['expira_at'] < datetime.now(timezone.utc):
        estado = 'expirada'
    fecha = reserva['fecha_clase']
    if fecha:
        if fecha.tzinfo is None: fecha = fecha.replace(tzinfo=timezone.utc)
        fecha_local = fecha.astimezone().strftime('%A %d/%m/%Y')
        hora_local = fecha.astimezone().strftime('%H:%M')
    else:
        fecha_local = hora_local = '?'
    expira = reserva['expira_at']
    if expira and expira.tzinfo is None: expira = expira.replace(tzinfo=timezone.utc)
    cancelado = reserva.get('cancelado_at')
    if cancelado and cancelado.tzinfo is None:
        cancelado = cancelado.replace(tzinfo=timezone.utc)
    return render_template_string(PAGE_HTML,
        titulo=f'Reserva — {reserva.get("centro_nombre") or "Round"}',
        estado=estado, token=token,
        reserva={
            'centro_nombre':  reserva.get('centro_nombre') or '',
            'nombre_lead':    reserva.get('nombre_lead') or '',
            'nombre_clase':   reserva.get('nombre_clase') or '',
            'fecha_local':    fecha_local,
            'hora_local':     hora_local,
            'expira_local':   expira.astimezone().strftime('%H:%M') if expira else '',
            'motivo_cancelacion': reserva.get('motivo_cancelacion') or '',
            'cancelado_local':    cancelado.astimezone().strftime('%d/%m/%Y a las %H:%M') if cancelado else '',
        })


@bp.route('/reserva/<token>/anular', methods=['POST'])
@bp.route('/api/crm/reserva/<token>/anular', methods=['POST'])
def anular_reserva(token):
    """Anula una reserva (estado→'cancelada'). Acepta motivo opcional via form.
    Cancela también la plaza en NoofitPro y notifica al trainer."""
    motivo = (request.form.get('motivo') or
              (request.get_json(silent=True) or {}).get('motivo') or '').strip()
    motivo = motivo[:500]  # límite de la columna

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM slot_reserva WHERE token=%s", (token,))
        r = cur.fetchone()
    if not r:
        return redirect(f'/reserva/{token}')
    if r['estado'] in ('cancelada', 'expirada', 'asistio'):
        # idempotente — ya estaba cerrada
        return redirect(f'/reserva/{token}')

    # Cancelar plaza en NoofitPro (best-effort, no rompe si falla)
    if r.get('noofit_sala_id') and r.get('noofit_cliente_id'):
        try:
            nc.cancelar_reserva(r['noofit_sala_id'], r['noofit_cliente_id'])
        except Exception as e:
            log.warning(f'anular_reserva: cancelar NoofitPro {r["id"]}: {e}')

    # Marcar en BD
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE slot_reserva SET
                          estado='cancelada',
                          cancelado_at=NOW(),
                          motivo_cancelacion=%s
                        WHERE id=%s""", (motivo or None, r['id']))

    # Mover lead Odoo a "Perdido" si existe (con motivo si hay)
    try:
        if r.get('odoo_lead_id'):
            from ..odoo_cuotas import get_cuotas
            oc = get_cuotas(r.get('id_manager'))
            stages = oc._call('crm.stage', 'search',
                [('name', 'ilike', 'perdido')], limit=1)
            if stages:
                oc._call('crm.lead', 'write', [r['odoo_lead_id']],
                         {'stage_id': stages[0]})
            # Actualizar también lead_asignacion local
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE lead_asignacion SET
                                 lost_at = NOW(),
                                 lost_reason = COALESCE(NULLIF(%s, ''), 'cancelacion_lead')
                                WHERE odoo_lead_id=%s""",
                            (motivo, r['odoo_lead_id']))
    except Exception as e:
        log.warning(f'anular_reserva: mover lead Odoo: {e}')

    # Email al trainer del centro avisándole de la anulación (si tiene email)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT nombre_centro, email FROM centro_contacto
                            WHERE id_manager=%s AND id_trainer=%s LIMIT 1""",
                        (r['id_manager'], r['id_trainer']))
            centro = cur.fetchone()
        if centro and centro.get('email'):
            fecha = r.get('fecha_clase')
            if fecha and fecha.tzinfo is None:
                fecha = fecha.replace(tzinfo=timezone.utc)
            full_name = f"{r.get('nombre_lead','')} {r.get('apellidos_lead','')}".strip()
            subject = f'Reserva ANULADA: {full_name} ({r.get("nombre_clase","?")})'
            html = (
                f'<p>El lead <b>{full_name}</b> '
                f'(<a href="mailto:{r.get("email_lead","")}">{r.get("email_lead","")}</a>, '
                f'tel: {r.get("telefono_lead","")}) '
                f'ha <b>anulado su reserva</b> de prueba en <b>{r.get("nombre_clase","?")}</b> '
                f'el {fecha.astimezone().strftime("%A %d/%m/%Y a las %H:%M") if fecha else "?"}.</p>'
                f'{"<p><b>Motivo:</b> " + motivo + "</p>" if motivo else "<p>(sin motivo indicado)</p>"}'
                f'<p>La plaza queda libre. Puedes contactar al lead si quieres re-encantarlo.</p>'
                f'<hr/><p style="color:#888;font-size:12px">Round Training Center · Reserva #{r["id"]}</p>'
            )
            from ..email_sender import enviar as enviar_email
            enviar_email(centro['email'], subject,
                         f'{full_name} anuló su prueba. Motivo: {motivo or "no indicado"}',
                         body_html=html, id_manager=r['id_manager'],
                         id_trainer=r['id_trainer'])
    except Exception as e:
        log.warning(f'anular_reserva: email trainer: {e}')

    return redirect(f'/reserva/{token}')


@bp.route('/reserva/<token>/confirmar', methods=['POST', 'GET'])
def confirmar_reserva(token):
    """Confirma la reserva (idempotente). Acepta POST o GET para que funcione
    bien con clicks de email aunque el cliente no envíe POST."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM slot_reserva WHERE token=%s", (token,))
        r = cur.fetchone()
        if not r:
            return redirect(f'/reserva/{token}')
        if r['estado'] == 'pendiente':
            if r['expira_at'] < datetime.now(timezone.utc):
                cur.execute("UPDATE slot_reserva SET estado='expirada' WHERE id=%s", (r['id'],))
            else:
                cur.execute("UPDATE slot_reserva SET estado='confirmada', confirmado_at=NOW() WHERE id=%s",
                            (r['id'],))
                # Disparar email de "plaza confirmada"
                try:
                    fecha = r['fecha_clase']
                    if fecha and fecha.tzinfo is None: fecha = fecha.replace(tzinfo=timezone.utc)
                    ctx = {
                        'lead_name':     f"{r.get('nombre_lead','')} {r.get('apellidos_lead','')}".strip(),
                        'lead_email':    r.get('email_lead'),
                        'lead_phone':    r.get('telefono_lead'),
                        'centro_name':   '',
                        'slot_nombre':   r.get('nombre_clase') or '',
                        'slot_fecha':    fecha.astimezone().strftime('%A %d/%m/%Y') if fecha else '',
                        'slot_hora':     fecha.astimezone().strftime('%H:%M') if fecha else '',
                        'lead_id':       str(r.get('odoo_lead_id') or ''),
                        'manager_email': '',
                    }
                    cur.execute("SELECT nombre_centro FROM centro_contacto "
                                "WHERE id_manager=%s AND id_trainer=%s LIMIT 1",
                                (r['id_manager'], r['id_trainer']))
                    cn = cur.fetchone()
                    if cn: ctx['centro_name'] = cn.get('nombre_centro')
                    trigger_email('slot_confirmado_lead', r['id_manager'], ctx)
                except Exception as e:
                    log.warning(f'email confirmado: {e}')
    return redirect(f'/reserva/{token}')


# Endpoints API JSON para las acciones (útil para frontend SPA si lo necesita)
@bp.route('/api/crm/reserva/<token>/confirmar', methods=['POST'])
def confirmar_reserva_api(token):
    return confirmar_reserva(token)


# ── 4) Cambiar de slot ──────────────────────────────────────────────────────
CAMBIAR_HTML = """<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cambiar día/hora — {{ centro_nombre }}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #060608; color: #f4f4f6;
         margin: 0; padding: 24px; min-height: 100vh; }
  .card { max-width: 720px; margin: 32px auto; background: #16171c;
          border: 1px solid #26282e; border-radius: 16px; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .muted { color: #b0b0bc; font-size: 14px; }
  .day { margin: 20px 0 8px; font-weight: 700; color: #2dd4a8;
         text-transform: uppercase; font-size: 12px; letter-spacing: 0.06em; }
  .slot { background: #1e2025; border: 1px solid #26282e; border-radius: 10px;
          padding: 12px 14px; margin: 6px 0; display: flex;
          justify-content: space-between; align-items: center; cursor: pointer;
          transition: all 0.15s; }
  .slot:hover { border-color: #2dd4a8; background: #1e2225; }
  .slot.selected { border-color: #2dd4a8; background: #2dd4a81a; }
  .slot input[type=radio] { display: none; }
  .slot-info { font-size: 14px; }
  .slot-info b { color: #f4f4f6; display: block; margin-bottom: 2px; }
  .nivel { font-size: 11px; padding: 3px 8px; border-radius: 999px;
           background: #26282e; color: #b0b0bc; }
  .nivel.tranquila { background: #2dd4a826; color: #2dd4a8; }
  .nivel.normal { background: #5b9cf61a; color: #5b9cf6; }
  .nivel.concurrida { background: #fbbf241a; color: #fbbf24; }
  .nivel.casi_llena { background: #f871711a; color: #f87171; }
  .btn { display: inline-block; padding: 14px 28px; border-radius: 10px;
         background: linear-gradient(135deg,#2dd4a8,#1a9a7a); color: #060608;
         font-weight: 700; text-decoration: none; border: none; cursor: pointer;
         margin: 16px 4px 4px; font-size: 15px; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .err { background: #f871711a; border: 1px solid #f8717140; padding: 12px;
         border-radius: 8px; color: #f87171; }
</style></head>
<body><div class="card">
<h1>Cambia tu prueba en {{ centro_nombre }}</h1>
<p class="muted">Elige otro día/hora — los slots están ordenados de menos concurridos a más:</p>
{% if slots|length == 0 %}
  <div class="err">Por ahora no hay otros huecos disponibles. Vuelve a intentarlo en un rato.</div>
{% else %}
<form method="POST" action="/api/crm/reserva/{{ token }}/cambiar">
  {% set last_day = '' %}
  {% for s in slots %}
    {% if s.fecha_local != last_day %}
      <div class="day">{{ s.dia_nombre }} {{ s.fecha_local }}</div>
      {% set last_day = s.fecha_local %}
    {% endif %}
    <label class="slot" onclick="document.querySelectorAll('.slot').forEach(e=>e.classList.remove('selected'));this.classList.add('selected');document.getElementById('btn').disabled=false;">
      <input type="radio" name="id_sala" value="{{ s.id_sala }}" required>
      <div class="slot-info">
        <b>{{ s.hora }} — {{ s.nombre }}</b>
        <span>{{ s.libres }}/{{ s.aforo }} plazas libres</span>
      </div>
      <span class="nivel {{ s.nivel }}">{{ s.nivel|replace('_',' ') }}</span>
    </label>
  {% endfor %}
  <button id="btn" type="submit" class="btn" disabled>Confirmar nuevo día/hora</button>
</form>
{% endif %}
<a href="/reserva/{{ token }}" class="muted" style="display:block;margin-top:16px">← Volver</a>
</div></body></html>
"""


@bp.route('/reserva/<token>/cambiar', methods=['GET'])
def pagina_cambiar(token):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT r.*, c.nombre_centro AS centro_nombre, c.slug AS centro_slug
                         FROM slot_reserva r LEFT JOIN centro_contacto c
                           ON c.id_trainer=r.id_trainer AND c.id_manager=r.id_manager
                        WHERE r.token=%s LIMIT 1""", (token,))
        r = cur.fetchone()
    if not r:
        return render_template_string(PAGE_HTML, titulo='Reserva no encontrada',
                                       estado='not_found', reserva={}, token=token)
    if r['estado'] not in ('pendiente',):
        # Si está confirmada permitimos cambiar también
        if r['estado'] != 'confirmada':
            return redirect(f'/reserva/{token}')
    try:
        slots = slots_disponibles(id_trainer=r['id_trainer'],
                                  dias_adelante=14, max_resultados=15)
        # Quitar el slot actual
        slots = [s for s in slots if s['id_sala'] != r['noofit_sala_id']]
    except Exception as e:
        log.exception('cambiar slots')
        slots = []
    return render_template_string(CAMBIAR_HTML,
        centro_nombre=r.get('centro_nombre') or 'Round',
        token=token, slots=slots)


@bp.route('/reserva/<token>/cambiar', methods=['POST'])
@bp.route('/api/crm/reserva/<token>/cambiar', methods=['POST'])
def cambiar_reserva(token):
    nuevo_id = request.form.get('id_sala') or (request.get_json(silent=True) or {}).get('id_sala')
    if not nuevo_id:
        return jsonify({'ok': False, 'error': 'id_sala_requerido'}), 400
    try: nuevo_id = int(nuevo_id)
    except: return jsonify({'ok': False, 'error': 'id_sala_invalido'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM slot_reserva WHERE token=%s", (token,))
        r = cur.fetchone()
    if not r: return jsonify({'ok': False, 'error': 'reserva_no_encontrada'}), 404
    if r['estado'] not in ('pendiente', 'confirmada'):
        return jsonify({'ok': False, 'error': f'estado_no_permite_cambio_{r["estado"]}'}), 400
    if nuevo_id == r['noofit_sala_id']:
        return redirect(f'/reserva/{token}')

    nueva = get_sala_info(nuevo_id)
    if not nueva: return jsonify({'ok': False, 'error': 'sala_no_encontrada'}), 404
    if str(nueva.get('idTrainer')) != str(r['id_trainer']):
        return jsonify({'ok': False, 'error': 'sala_otro_centro'}), 400
    aforo = nueva.get('aforo') or 0
    ocupados = sum(1 for u in (nueva.get('users') or []) if u.get('enabled', True))
    if ocupados >= aforo:
        return jsonify({'ok': False, 'error': 'sala_llena'}), 409

    # Cancelar reserva anterior + apuntar a la nueva en NoofitPro
    try:
        nc.cancelar_reserva(r['noofit_sala_id'], r['noofit_cliente_id'])
    except Exception as e:
        log.warning(f'cancelar sala anterior: {e}')
    try:
        nc.reservar_clase(nuevo_id, r['noofit_cliente_id'])
    except Exception as e:
        log.exception('reservar nueva sala')
        return jsonify({'ok': False, 'error': 'error_reservando'}), 502

    # Actualizar BD: extiende expiración 1h más si seguía pendiente
    nueva_expira = (datetime.now(timezone.utc) + timedelta(hours=1)
                    if r['estado'] == 'pendiente' else r['expira_at'])
    fecha_nueva = _ms_to_dt(nueva.get('dateStart'))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE slot_reserva SET
                         noofit_sala_id=%s, fecha_clase=%s, nombre_clase=%s,
                         cambiado_de_sala_id=%s, expira_at=%s
                       WHERE token=%s""",
                    (nuevo_id, fecha_nueva, nueva.get('name'),
                     r['noofit_sala_id'], nueva_expira, token))
    return redirect(f'/reserva/{token}')
