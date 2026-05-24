"""Endpoints de fichaje, QR rotativo y correcciones (Control horario Fase 1).

Cubre dos audiencias:

  ▸ TRABAJADOR (JWT de trabajador, vía mynoofit/web simple):
      POST /api/horario/auth/login           — credenciales NoofitPro → JWT propio
      GET  /api/horario/me                   — datos del trabajador logueado
      POST /api/horario/fichaje              — registrar evento atómico
      GET  /api/horario/estado               — estado actual (fuera/dentro/en_pausa)
      GET  /api/horario/mi-jornada/hoy       — eventos del día (Europe/Madrid)
      POST /api/horario/correccion           — solicitar corrección

  ▸ ADMIN (X-Round-Token + @require_feature):
      GET  /api/horario/qr-actual/<trainer_id>           — QR rotativo (HS256, exp 10 min)
      GET  /api/horario/eventos                          — listado filtrado
      GET  /api/horario/correcciones?estado=…            — bandeja
      POST /api/horario/correcciones/<id>/aprobar
      POST /api/horario/correcciones/<id>/rechazar
      POST /api/horario/eventos/correccion               — admin inserta sin pasar por solicitud
      GET  /api/horario/verify-chain/<trabajador_id>     — comprueba integridad SHA-256

INTEGRIDAD (hash chain):
  cada fila de `fichaje_evento` guarda `hash` = SHA-256 sobre un payload
  canónico (id_manager, trabajador_id, tipo, ts_evento ISO-UTC, motivo,
  origen, autor_rol, corrige_id, correccion_sol_id) prefijado con el
  `prev_hash` (hash del último evento del mismo trabajador). Una edición
  manual rompe la cadena → `verify-chain` lo detecta.

QR token (HS256):
  iss='round-horario', sub=trainer_id, mgr=id_manager, iat, exp (10 min),
  jti (random) — firmado con `manager_config.control_horario_qr_secret`.
"""
import hashlib
import json
import logging
import secrets
import datetime as dt

import jwt
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..auth_trabajador import (
    issue_jwt_trabajador,
    login_noofit_cliente,
    trabajador_required,
)
from ..db import get_conn
from ..odoo_guard import require_feature
from ..audit_log import log_action, actor_from_request

bp = Blueprint('horario_fichaje', __name__)
log = logging.getLogger(__name__)


QR_TTL_SECONDS = 10 * 60       # 10 min (rotación)
QR_JWT_ALGO    = 'HS256'
QR_ISSUER      = 'round-horario'

EVENT_TYPES = ('ENTRADA', 'SALIDA', 'PAUSA_INI', 'PAUSA_FIN')


# ═══════════════════════════════════════════════════════════════════════════
# ║  HELPERS DE INTEGRIDAD                                                  ║
# ═══════════════════════════════════════════════════════════════════════════

def _canonical_payload(d: dict) -> bytes:
    """JSON canónico (keys ordenadas, sin espacios, sin Unicode escape)
    para que el hash sea reproducible entre máquinas."""
    return json.dumps(d, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, default=str).encode('utf-8')


def _compute_hash(prev_hash: str | None, payload: dict) -> str:
    h = hashlib.sha256()
    h.update((prev_hash or '').encode('ascii'))
    h.update(b'|')
    h.update(_canonical_payload(payload))
    return h.hexdigest()


def _payload_for_hash(evento: dict) -> dict:
    """Subset de campos que entran en el hash. Si cambias esto invalidas
    todas las cadenas existentes — sólo añadir/quitar campos al definir
    versiones nuevas del esquema."""
    return {
        'id_manager':              evento.get('id_manager'),
        'trabajador_id':           evento.get('trabajador_id'),
        'id_trainer':              evento.get('id_trainer'),
        'tipo':                    evento.get('tipo'),
        'ts_evento':               evento.get('ts_evento_iso'),
        'pausa_motivo_id':         evento.get('pausa_motivo_id'),
        'origen':                  evento.get('origen'),
        'verificacion_ubicacion':  evento.get('verificacion_ubicacion'),
        'qr_origen':               evento.get('qr_origen'),
        'qr_token_jti':            evento.get('qr_token_jti'),
        'qr_clase_id':             evento.get('qr_clase_id'),
        'corrige_evento_id':       evento.get('corrige_evento_id'),
        'correccion_solicitud_id': evento.get('correccion_solicitud_id'),
        'correccion_motivo':       evento.get('correccion_motivo'),
        'autor_rol':               evento.get('autor_rol'),
        'autor_usuario_id':        evento.get('autor_usuario_id'),
        'autor_cliente_idnoofit':  evento.get('autor_cliente_idnoofit'),
    }


def _insert_evento(cur, evento: dict) -> dict:
    """Inserta un evento aplicando hash chain. `evento` debe contener todos
    los campos lógicos del fichaje. Recupera `prev_hash` del último evento
    del mismo trabajador con FOR UPDATE para serializar inserciones
    concurrentes."""
    cur.execute("""
        SELECT id, hash FROM fichaje_evento
         WHERE trabajador_id = %s
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE
    """, (evento['trabajador_id'],))
    last = cur.fetchone()
    prev_hash = last['hash'] if last else None

    ts_iso = evento['ts_evento'].astimezone(dt.timezone.utc).isoformat()
    evento['ts_evento_iso'] = ts_iso
    hash_val = _compute_hash(prev_hash, _payload_for_hash(evento))

    cur.execute("""
        INSERT INTO fichaje_evento
          (id_manager, trabajador_id, id_trainer, tipo, ts_evento,
           pausa_motivo_id, origen, origen_version, origen_ip, origen_user_agent,
           verificacion_ubicacion, qr_origen, qr_token_jti, qr_clase_id,
           lat, lng, geo_accuracy_m,
           corrige_evento_id, correccion_solicitud_id, correccion_motivo,
           autor_rol, autor_usuario_id, autor_cliente_idnoofit,
           prev_hash, hash)
        VALUES (%(id_manager)s, %(trabajador_id)s, %(id_trainer)s, %(tipo)s, %(ts_evento)s,
                %(pausa_motivo_id)s, %(origen)s, %(origen_version)s, %(origen_ip)s, %(origen_user_agent)s,
                %(verificacion_ubicacion)s, %(qr_origen)s, %(qr_token_jti)s, %(qr_clase_id)s,
                %(lat)s, %(lng)s, %(geo_accuracy_m)s,
                %(corrige_evento_id)s, %(correccion_solicitud_id)s, %(correccion_motivo)s,
                %(autor_rol)s, %(autor_usuario_id)s, %(autor_cliente_idnoofit)s,
                %(prev_hash)s, %(hash)s)
        RETURNING id, ts_evento
    """, {**evento, 'prev_hash': prev_hash, 'hash': hash_val})
    inserted = cur.fetchone()
    return {
        'id': inserted['id'],
        'ts_evento': inserted['ts_evento'],
        'prev_hash': prev_hash,
        'hash': hash_val,
    }


# ═══════════════════════════════════════════════════════════════════════════
# ║  QR ROTATIVO (firma HS256 con secret del manager)                       ║
# ═══════════════════════════════════════════════════════════════════════════

def _get_or_init_qr_secret(id_manager: str) -> str:
    """Devuelve el secret HS256 del manager para firmar QR. Si está NULL
    en BD (módulo recién activado) lo genera y persiste."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT control_horario_qr_secret FROM manager_config
             WHERE id_manager = %s
        """, (str(id_manager),))
        r = cur.fetchone()
        secret = (r or {}).get('control_horario_qr_secret') if r else None
        if not secret:
            secret = secrets.token_urlsafe(48)
            cur.execute("""
                UPDATE manager_config
                   SET control_horario_qr_secret = %s,
                       updated_at = NOW()
                 WHERE id_manager = %s
            """, (secret, str(id_manager)))
    return secret


def _issue_qr_token(id_manager: str, id_trainer: str) -> tuple[str, dt.datetime, str]:
    """Emite JWT del QR. Devuelve (token, expires_at, jti)."""
    secret = _get_or_init_qr_secret(id_manager)
    now = dt.datetime.utcnow()
    exp = now + dt.timedelta(seconds=QR_TTL_SECONDS)
    jti = secrets.token_urlsafe(12)
    payload = {
        'iss': QR_ISSUER,
        'sub': str(id_trainer),
        'mgr': str(id_manager),
        'iat': now,
        'exp': exp,
        'jti': jti,
    }
    tok = jwt.encode(payload, secret, algorithm=QR_JWT_ALGO)
    return tok, exp, jti


def _validate_qr_token(id_manager: str, id_trainer: str, token: str) -> dict | None:
    """Valida un token de QR propio (origen=menu). Devuelve los claims si
    OK, None si firma/exp/manager/trainer no cuadran."""
    if not token:
        return None
    secret = _get_or_init_qr_secret(id_manager)
    try:
        claims = jwt.decode(
            token, secret, algorithms=[QR_JWT_ALGO],
            issuer=QR_ISSUER, options={'require': ['exp', 'iat', 'jti']},
        )
    except jwt.PyJWTError:
        return None
    if str(claims.get('mgr')) != str(id_manager):
        return None
    if str(claims.get('sub')) != str(id_trainer):
        return None
    return claims


# ═══════════════════════════════════════════════════════════════════════════
# ║  AUTH: login del trabajador                                              ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/auth/login', methods=['POST'])
def login_trabajador():
    """Login del trabajador con credenciales NoofitPro.

    Body: { email, password, id_manager? }
    Resuelve cliente_idnoofit + id_manager buscando en `cliente_cache`
    (debe estar la categoría 'Trabajador' asignada y el trabajador
    activado en `trabajador`).

    NO requiere `control_horario_enabled` — la verificación final ocurre
    en `trabajador_required` al usar el JWT emitido. Permitimos login para
    poder devolver un mensaje claro al trabajador.
    """
    d = request.get_json() or {}
    email = (d.get('email') or '').strip().lower()
    password = d.get('password') or ''
    id_manager_hint = (d.get('id_manager') or '').strip() or None
    if not email or not password:
        return jsonify({'ok': False, 'error': 'email_y_password_requeridos'}), 400

    # Valida contra NoofitPro.
    ok, info = login_noofit_cliente(email, password)
    if not ok:
        return jsonify({'ok': False, 'error': info}), 401

    # Resuelve cliente_idnoofit + id_manager desde cliente_cache.
    with get_conn() as conn, conn.cursor() as cur:
        sql = """
            SELECT id_manager, id::TEXT AS cliente_idnoofit, name, surname, email
              FROM cliente_cache
             WHERE LOWER(email) = %s
        """
        params = [email]
        if id_manager_hint:
            sql += " AND id_manager = %s"
            params.append(id_manager_hint)
        cur.execute(sql, params)
        candidatos = cur.fetchall()

    if not candidatos:
        return jsonify({'ok': False, 'error': 'cliente_no_encontrado'}), 404
    if len(candidatos) > 1:
        return jsonify({
            'ok': False, 'error': 'manager_ambiguo',
            'managers': [c['id_manager'] for c in candidatos],
        }), 409
    c = candidatos[0]

    # Busca trabajador match.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT t.id, t.id_manager, t.cliente_idnoofit, t.nombre_completo,
                   t.estado, mc.control_horario_enabled
              FROM trabajador t
              LEFT JOIN manager_config mc ON mc.id_manager = t.id_manager
             WHERE t.id_manager = %s AND t.cliente_idnoofit = %s
        """, (c['id_manager'], c['cliente_idnoofit']))
        trab = cur.fetchone()
    if not trab:
        return jsonify({'ok': False, 'error': 'no_eres_trabajador'}), 403
    if trab['estado'] != 'activo':
        return jsonify({'ok': False, 'error': f'trabajador_{trab["estado"]}'}), 403
    if not trab.get('control_horario_enabled'):
        return jsonify({'ok': False, 'error': 'feature_not_enabled'}), 403

    token = issue_jwt_trabajador(trab['id'], trab['id_manager'], trab['cliente_idnoofit'])
    return jsonify({
        'ok': True,
        'token': token,
        'trabajador': {
            'id': trab['id'],
            'id_manager': trab['id_manager'],
            'cliente_idnoofit': trab['cliente_idnoofit'],
            'nombre_completo': trab['nombre_completo'] or '',
        },
    })


@bp.route('/me', methods=['GET'])
@trabajador_required
def trabajador_me():
    t = g.trabajador
    return jsonify({'ok': True, 'trabajador': {
        'id': t['id'],
        'id_manager': t['id_manager'],
        'cliente_idnoofit': t['cliente_idnoofit'],
        'id_trainer_empleador': t['id_trainer_empleador'],
        'nombre_completo': t['nombre_completo'] or '',
    }})


# ═══════════════════════════════════════════════════════════════════════════
# ║  FICHAJE                                                                 ║
# ═══════════════════════════════════════════════════════════════════════════

def _client_ip() -> str | None:
    ip = (request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
          or request.headers.get('X-Real-IP', '')
          or request.remote_addr or '')
    return ip or None


def _trainer_from_qr_or_fallback(id_manager: str, qr_token: str | None,
                                 trabajador_id: int, fallback_trainer: str | None):
    """Decide qué trainer registrar en el fichaje:

      1. Si `qr_token` valida como token propio → trainer del token, origen='menu', verificado.
      2. (Reservado) Si valida contra NoofitPro como QR de clase → origen='clase'.
      3. Si no → trainer empleador del trabajador, sin verificación.

    Devuelve (id_trainer, verificacion_ubicacion, qr_origen, qr_token_jti, qr_clase_id).
    """
    if qr_token:
        # Probamos validación local. Hay que iterar los trainers a los que
        # el trabajador esté vinculado, porque el sub del token es un trainer
        # concreto y debe estar entre los autorizados.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT id_trainer FROM trabajador_trainer
                 WHERE trabajador_id = %s AND id_manager = %s
                   AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE)
                UNION
                SELECT id_trainer_empleador AS id_trainer FROM trabajador
                 WHERE id = %s
            """, (trabajador_id, id_manager, trabajador_id))
            trainers_autorizados = {r['id_trainer'] for r in cur.fetchall() if r['id_trainer']}
        for trn in trainers_autorizados:
            claims = _validate_qr_token(id_manager, trn, qr_token)
            if claims:
                return (str(trn), 'QR', 'menu', claims.get('jti'), None)
        # TODO: integración NoofitPro para QR de clase (origen='clase').

    # Sin verificación.
    return (str(fallback_trainer) if fallback_trainer else None, 'NO', None, None, None)


@bp.route('/fichaje', methods=['POST'])
@trabajador_required
def fichaje():
    """Registra un evento de fichaje.

    Body:
      tipo            (str)   uno de ENTRADA/SALIDA/PAUSA_INI/PAUSA_FIN  [obligatorio]
      qr_token        (str)   token escaneado del QR (opcional)
      pausa_motivo_id (int)   sólo para PAUSA_INI; en PAUSA_FIN se infiere
                              del último PAUSA_INI abierto
      lat, lng, geo_accuracy_m (opt)
      origen          ('mynoofit' por defecto si vino del móvil; 'web' si web)
      app_version     (str)   versión de mynoofit / build del frontend
    """
    d = request.get_json() or {}
    tipo = (d.get('tipo') or '').upper().strip()
    if tipo not in EVENT_TYPES:
        return jsonify({'ok': False, 'error': 'tipo_invalido',
                        'permitidos': list(EVENT_TYPES)}), 400

    qr_token = (d.get('qr_token') or '').strip() or None
    pausa_motivo_id = d.get('pausa_motivo_id')
    try:
        pausa_motivo_id = int(pausa_motivo_id) if pausa_motivo_id not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'pausa_motivo_id_invalido'}), 400

    # Fallback: si el cliente nos manda `pausa_motivo_codigo` (porque aún no
    # tiene el id), lo resolvemos contra el catálogo (manager + globales).
    if pausa_motivo_id is None:
        codigo = (d.get('pausa_motivo_codigo') or '').strip().lower()
        if codigo:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT id FROM pausa_motivo
                     WHERE codigo = %s
                       AND activo = TRUE
                       AND (id_manager = %s OR id_manager IS NULL)
                     ORDER BY (id_manager IS NULL) ASC
                     LIMIT 1
                """, (codigo, str(g.trabajador['id_manager'])))
                row = cur.fetchone()
            if row:
                pausa_motivo_id = row['id']

    lat = d.get('lat'); lng = d.get('lng'); acc = d.get('geo_accuracy_m')
    try:
        lat = float(lat) if lat not in (None, '') else None
        lng = float(lng) if lng not in (None, '') else None
        acc = int(acc)   if acc not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'geo_invalida'}), 400

    origen = (d.get('origen') or 'mynoofit').strip().lower()
    if origen not in ('mynoofit', 'web', 'admin'):
        origen = 'mynoofit'
    origen_version = (d.get('app_version') or d.get('origen_version') or '').strip() or None

    trab = g.trabajador
    id_manager = trab['id_manager']
    trabajador_id = trab['id']
    fallback_trainer = trab['id_trainer_empleador']

    id_trainer, verif, qr_origen, qr_jti, qr_clase_id = _trainer_from_qr_or_fallback(
        id_manager, qr_token, trabajador_id, fallback_trainer
    )
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'trainer_no_determinado'}), 400

    # Coherencia con el estado actual: rechaza secuencias absurdas
    # (ej. PAUSA_FIN sin PAUSA_INI). Anti-bloqueo del trabajador: si la
    # secuencia es imposible, lo decimos claro para que use Corrección.
    estado = _estado_actual(trabajador_id)
    if not _es_transicion_valida(estado['estado'], tipo):
        return jsonify({
            'ok': False, 'error': 'transicion_invalida',
            'estado_actual': estado['estado'], 'tipo_solicitado': tipo,
        }), 409

    # Para PAUSA_FIN, hereda el motivo del PAUSA_INI abierto si no nos
    # llega. Para PAUSA_INI requerimos motivo si así lo exige el catálogo.
    if tipo == 'PAUSA_FIN' and pausa_motivo_id is None:
        pausa_motivo_id = estado.get('pausa_motivo_id')
    elif tipo == 'PAUSA_INI':
        if pausa_motivo_id is None:
            return jsonify({'ok': False, 'error': 'pausa_motivo_requerido'}), 400

    ts_evento = dt.datetime.now(dt.timezone.utc)

    evento = {
        'id_manager': id_manager,
        'trabajador_id': trabajador_id,
        'id_trainer': id_trainer,
        'tipo': tipo,
        'ts_evento': ts_evento,
        'pausa_motivo_id': pausa_motivo_id,
        'origen': origen,
        'origen_version': origen_version,
        'origen_ip': _client_ip(),
        'origen_user_agent': (request.headers.get('User-Agent') or '')[:512] or None,
        'verificacion_ubicacion': verif,
        'qr_origen': qr_origen,
        'qr_token_jti': qr_jti,
        'qr_clase_id': qr_clase_id,
        'lat': lat, 'lng': lng, 'geo_accuracy_m': acc,
        'corrige_evento_id': None,
        'correccion_solicitud_id': None,
        'correccion_motivo': None,
        'autor_rol': 'trabajador',
        'autor_usuario_id': None,
        'autor_cliente_idnoofit': trab['cliente_idnoofit'],
    }
    with get_conn() as conn, conn.cursor() as cur:
        inserted = _insert_evento(cur, evento)
    return jsonify({
        'ok': True,
        'evento': {
            'id': inserted['id'],
            'tipo': tipo,
            'ts_evento': inserted['ts_evento'].astimezone(dt.timezone.utc).isoformat(),
            'id_trainer': id_trainer,
            'verificacion_ubicacion': verif,
            'hash': inserted['hash'],
        },
    })


def _estado_actual(trabajador_id: int) -> dict:
    """Devuelve estado actual del trabajador derivado del último evento.

    Estados:
      fuera     → último evento ENTRADA no presente, o SALIDA reciente.
      dentro    → último evento ENTRADA o PAUSA_FIN.
      en_pausa  → último evento PAUSA_INI sin PAUSA_FIN posterior.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, tipo, ts_evento, id_trainer, pausa_motivo_id
              FROM fichaje_evento
             WHERE trabajador_id = %s
               AND tipo IN ('ENTRADA','SALIDA','PAUSA_INI','PAUSA_FIN')
             ORDER BY ts_evento DESC, id DESC
             LIMIT 1
        """, (trabajador_id,))
        last = cur.fetchone()
    if not last:
        return {'estado': 'fuera', 'ultimo_evento': None, 'pausa_motivo_id': None}
    mapping = {
        'ENTRADA': 'dentro', 'PAUSA_FIN': 'dentro',
        'PAUSA_INI': 'en_pausa', 'SALIDA': 'fuera',
    }
    return {
        'estado': mapping.get(last['tipo'], 'fuera'),
        'ultimo_evento': {
            'id': last['id'], 'tipo': last['tipo'],
            'ts_evento': last['ts_evento'].astimezone(dt.timezone.utc).isoformat(),
            'id_trainer': last['id_trainer'],
        },
        'pausa_motivo_id': last['pausa_motivo_id'] if last['tipo'] == 'PAUSA_INI' else None,
    }


def _es_transicion_valida(estado_actual: str, nuevo_tipo: str) -> bool:
    if estado_actual == 'fuera':
        return nuevo_tipo == 'ENTRADA'
    if estado_actual == 'dentro':
        return nuevo_tipo in ('SALIDA', 'PAUSA_INI')
    if estado_actual == 'en_pausa':
        return nuevo_tipo in ('PAUSA_FIN', 'SALIDA')
    return False


@bp.route('/estado', methods=['GET'])
@trabajador_required
def estado_trabajador():
    return jsonify({'ok': True, **_estado_actual(g.trabajador['id'])})


@bp.route('/mi-jornada/hoy', methods=['GET'])
@trabajador_required
def mi_jornada_hoy():
    """Eventos del día (Europe/Madrid) del trabajador logueado."""
    return jsonify(_jornada_dia(g.trabajador['id'], dt.date.today()))


@bp.route('/mi-horario', methods=['GET'])
@trabajador_required
def mi_horario():
    """Horario teórico semanal del trabajador logueado (Fase 2 A).

    Devuelve { "1": [...], "2": [...], ..., "7": [...] } con bloques
    {id, hora_inicio "HH:MM", hora_fin "HH:MM", orden} agrupados por día
    ISO (1=lunes, 7=domingo).
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, dia_semana, hora_inicio, hora_fin, tipo, orden
              FROM horario_trabajador
             WHERE trabajador_id = %s
             ORDER BY dia_semana, orden
        """, (g.trabajador['id'],))
        rows = cur.fetchall()
    out = {str(d): [] for d in range(1, 8)}
    for r in rows:
        out[str(r['dia_semana'])].append({
            'id': r['id'],
            'hora_inicio': r['hora_inicio'].strftime('%H:%M'),
            'hora_fin':    r['hora_fin'].strftime('%H:%M'),
            'tipo':        r['tipo'],
            'orden':       r['orden'],
        })
    return jsonify({'ok': True, 'horario': out})


@bp.route('/mi-resumen', methods=['GET'])
@trabajador_required
def mi_resumen():
    """Resumen agregado del trabajador para un año natural.

    Query:
      ano=YYYY  (opcional, default: año actual en Europe/Madrid)

    Devuelve:
      {
        ok, ano,
        anual:    {trabajo_seg, pausa_seg, dias_trabajados},
        mensual:  [{mes:1..12, trabajo_seg, pausa_seg, dias_trabajados}],
        semanal:  [{iso_year, iso_week, fecha_lunes, trabajo_seg, pausa_seg, dias_trabajados}],
        diario:   [{fecha (YYYY-MM-DD), trabajo_seg, pausa_seg, n_eventos}]
      }

    Zona horaria: todos los agrupamientos por día/semana/mes se calculan
    en Europe/Madrid (el día que ve el trabajador), no en UTC.
    """
    try:
        ano = int(request.args.get('ano') or '')
    except ValueError:
        return jsonify({'ok': False, 'error': 'ano_invalido'}), 400
    if not ano:
        ano = dt.datetime.now(dt.timezone.utc).astimezone().year

    trab_id = g.trabajador['id']

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT (ts_evento AT TIME ZONE 'Europe/Madrid')::DATE AS fecha_local,
                   ts_evento, tipo
              FROM fichaje_evento
             WHERE trabajador_id = %s
               AND EXTRACT(YEAR FROM (ts_evento AT TIME ZONE 'Europe/Madrid')) = %s
               AND tipo IN ('ENTRADA','SALIDA','PAUSA_INI','PAUSA_FIN','CORRECCION_INSERT')
             ORDER BY ts_evento ASC, id ASC
        """, (trab_id, ano))
        rows = cur.fetchall()

    # Agrupa eventos por fecha local
    por_dia = {}
    for r in rows:
        por_dia.setdefault(r['fecha_local'], []).append(r)

    diario, anual_trab, anual_pausa, anual_dias = [], 0, 0, 0
    mensual = [{'mes': m, 'trabajo_seg': 0, 'pausa_seg': 0, 'dias_trabajados': 0}
               for m in range(1, 13)]
    semanal_map = {}    # (iso_year, iso_week) -> dict

    for fecha, evs in sorted(por_dia.items()):
        trabajo_seg, pausa_seg = _calcular_seg(evs)
        if trabajo_seg == 0 and pausa_seg == 0:
            continue
        diario.append({
            'fecha': fecha.isoformat(),
            'trabajo_seg': trabajo_seg,
            'pausa_seg': pausa_seg,
            'n_eventos': len(evs),
        })
        anual_trab += trabajo_seg
        anual_pausa += pausa_seg
        anual_dias += 1
        # Mes
        m = mensual[fecha.month - 1]
        m['trabajo_seg'] += trabajo_seg
        m['pausa_seg'] += pausa_seg
        m['dias_trabajados'] += 1
        # Semana ISO
        iso_year, iso_week, iso_dow = fecha.isocalendar()
        key = (iso_year, iso_week)
        if key not in semanal_map:
            # lunes de esa semana ISO
            lunes = fecha - dt.timedelta(days=iso_dow - 1)
            semanal_map[key] = {
                'iso_year': iso_year, 'iso_week': iso_week,
                'fecha_lunes': lunes.isoformat(),
                'trabajo_seg': 0, 'pausa_seg': 0, 'dias_trabajados': 0,
            }
        w = semanal_map[key]
        w['trabajo_seg'] += trabajo_seg
        w['pausa_seg'] += pausa_seg
        w['dias_trabajados'] += 1

    semanal = sorted(semanal_map.values(),
                     key=lambda x: (x['iso_year'], x['iso_week']))

    return jsonify({
        'ok': True,
        'ano': ano,
        'anual': {
            'trabajo_seg': anual_trab,
            'pausa_seg': anual_pausa,
            'dias_trabajados': anual_dias,
        },
        'mensual': mensual,
        'semanal': semanal,
        'diario': diario,
    })


def _calcular_seg(eventos):
    """Dada una lista de eventos ordenados por ts ASC del mismo día, devuelve
    (trabajo_seg, pausa_seg) calculando los pares ENTRADA→SALIDA y
    PAUSA_INI→PAUSA_FIN. PAUSA_INI interrumpe el cómputo de trabajo."""
    total_trab, total_pausa = 0, 0
    ult_entrada = None
    ult_pausa = None
    for e in eventos:
        t = e['tipo']; ts = e['ts_evento']
        if t == 'ENTRADA':
            ult_entrada = ts
        elif t == 'SALIDA' and ult_entrada:
            total_trab += int((ts - ult_entrada).total_seconds())
            ult_entrada = None
        elif t == 'PAUSA_INI':
            ult_pausa = ts
            if ult_entrada:
                total_trab += int((ts - ult_entrada).total_seconds())
                ult_entrada = None
        elif t == 'PAUSA_FIN':
            if ult_pausa:
                total_pausa += int((ts - ult_pausa).total_seconds())
                ult_pausa = None
            ult_entrada = ts
    return total_trab, total_pausa


def _jornada_dia(trabajador_id: int, fecha: dt.date) -> dict:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, tipo, ts_evento, id_trainer, pausa_motivo_id,
                   origen, verificacion_ubicacion, hash
              FROM fichaje_evento
             WHERE trabajador_id = %s
               AND (ts_evento AT TIME ZONE 'Europe/Madrid')::DATE = %s
               AND tipo IN ('ENTRADA','SALIDA','PAUSA_INI','PAUSA_FIN','CORRECCION_INSERT')
             ORDER BY ts_evento ASC, id ASC
        """, (trabajador_id, fecha))
        rows = cur.fetchall()
    eventos = [{
        'id': r['id'], 'tipo': r['tipo'],
        'ts_evento': r['ts_evento'].astimezone(dt.timezone.utc).isoformat(),
        'id_trainer': r['id_trainer'],
        'pausa_motivo_id': r['pausa_motivo_id'],
        'origen': r['origen'],
        'verificacion_ubicacion': r['verificacion_ubicacion'],
    } for r in rows]
    # Total trabajado y pausado (segundos)
    total_trabajo = 0
    total_pausa = 0
    ultimo_entrada = None
    ultimo_pausa = None
    for r in rows:
        t = r['tipo']; ts = r['ts_evento']
        if t == 'ENTRADA':
            ultimo_entrada = ts
        elif t == 'SALIDA' and ultimo_entrada:
            total_trabajo += int((ts - ultimo_entrada).total_seconds())
            ultimo_entrada = None
        elif t == 'PAUSA_INI':
            ultimo_pausa = ts
            if ultimo_entrada:
                total_trabajo += int((ts - ultimo_entrada).total_seconds())
                ultimo_entrada = None
        elif t == 'PAUSA_FIN':
            if ultimo_pausa:
                total_pausa += int((ts - ultimo_pausa).total_seconds())
                ultimo_pausa = None
            ultimo_entrada = ts
    return {
        'ok': True, 'fecha': fecha.isoformat(),
        'eventos': eventos,
        'total_trabajo_seg': total_trabajo,
        'total_pausa_seg': total_pausa,
    }


# ═══════════════════════════════════════════════════════════════════════════
# ║  CORRECCIONES — trabajador solicita                                     ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/correccion', methods=['POST'])
@trabajador_required
def crear_solicitud_correccion():
    d = request.get_json() or {}
    tipo = (d.get('tipo_propuesto') or d.get('tipo') or '').upper().strip()
    if tipo not in ('ENTRADA', 'SALIDA', 'PAUSA_INI', 'PAUSA_FIN', 'ANULAR'):
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    ts = d.get('ts_propuesto')
    if not ts:
        return jsonify({'ok': False, 'error': 'ts_propuesto_requerido'}), 400
    try:
        ts_propuesto = dt.datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return jsonify({'ok': False, 'error': 'ts_propuesto_invalido'}), 400
    motivo = (d.get('motivo') or '').strip()
    if not motivo:
        return jsonify({'ok': False, 'error': 'motivo_requerido'}), 400
    pausa_motivo_id = d.get('pausa_motivo_id')
    try:
        pausa_motivo_id = int(pausa_motivo_id) if pausa_motivo_id not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'pausa_motivo_id_invalido'}), 400
    corrige_id = d.get('corrige_evento_id')
    try:
        corrige_id = int(corrige_id) if corrige_id not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'corrige_evento_id_invalido'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO correccion_solicitud
              (id_manager, trabajador_id, tipo_propuesto, ts_propuesto,
               pausa_motivo_id, corrige_evento_id, motivo)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            RETURNING id, estado, created_at
        """, (g.trabajador['id_manager'], g.trabajador['id'], tipo,
              ts_propuesto, pausa_motivo_id, corrige_id, motivo))
        row = cur.fetchone()
    return jsonify({
        'ok': True, 'solicitud': {
            'id': row['id'], 'estado': row['estado'],
            'created_at': row['created_at'].astimezone(dt.timezone.utc).isoformat(),
        },
    })


# ═══════════════════════════════════════════════════════════════════════════
# ║  QR ROTATIVO — endpoint admin                                           ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/qr-actual/<id_trainer>', methods=['GET'])
@auth_required
@require_feature('control_horario')
def qr_actual(id_trainer):
    """Devuelve el token QR vigente para `id_trainer` (10 min). El frontend
    lo renderiza como QR y autorefresca antes de la expiración.

    Si llega `?clase=1` y la integración NoofitPro está disponible se
    devuelve un token de clase activa (TODO Fase 1.5)."""
    # Verifica que el trainer pertenece al manager actual (centro_contacto)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM centro_contacto
             WHERE id_manager = %s AND id_trainer = %s
        """, (str(g.id_manager), str(id_trainer)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'trainer_no_pertenece_al_manager'}), 403

    tok, exp, jti = _issue_qr_token(str(g.id_manager), str(id_trainer))
    return jsonify({
        'ok': True,
        'qr_payload': tok,           # string a renderizar como QR
        'qr_origen': 'menu',
        'jti': jti,
        'expires_at': exp.replace(tzinfo=dt.timezone.utc).isoformat(),
        'ttl_seconds': QR_TTL_SECONDS,
    })


# ═══════════════════════════════════════════════════════════════════════════
# ║  ADMIN: listado de eventos                                              ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/eventos', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_eventos():
    """Listado de eventos con filtros. Default: hoy."""
    trainer = (request.args.get('trainer') or '').strip()
    trab = (request.args.get('trabajador_id') or '').strip()
    desde = (request.args.get('desde') or '').strip()
    hasta = (request.args.get('hasta') or '').strip()
    limit = min(int(request.args.get('limit') or 500), 5000)

    sql = """
        SELECT e.id, e.trabajador_id, t.nombre_completo, e.id_trainer, e.tipo,
               e.ts_evento, e.pausa_motivo_id, pm.etiqueta AS pausa_motivo,
               e.origen, e.origen_ip, e.verificacion_ubicacion, e.qr_origen,
               e.corrige_evento_id, e.correccion_motivo, e.autor_rol,
               e.hash, e.prev_hash
          FROM fichaje_evento e
          JOIN trabajador t  ON t.id = e.trabajador_id
          LEFT JOIN pausa_motivo pm ON pm.id = e.pausa_motivo_id
         WHERE e.id_manager = %s
    """
    params = [str(g.id_manager)]
    if trainer:
        sql += " AND e.id_trainer = %s"; params.append(trainer)
    if trab:
        sql += " AND e.trabajador_id = %s"; params.append(int(trab))
    if desde:
        sql += " AND e.ts_evento >= %s"; params.append(desde)
    if hasta:
        sql += " AND e.ts_evento <= %s"; params.append(hasta)
    sql += " ORDER BY e.ts_evento DESC, e.id DESC LIMIT %s"
    params.append(limit)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    out = [{
        'id': r['id'], 'trabajador_id': r['trabajador_id'],
        'trabajador_nombre': r['nombre_completo'] or '',
        'id_trainer': r['id_trainer'], 'tipo': r['tipo'],
        'ts_evento': r['ts_evento'].astimezone(dt.timezone.utc).isoformat(),
        'pausa_motivo_id': r['pausa_motivo_id'],
        'pausa_motivo': r['pausa_motivo'],
        'origen': r['origen'], 'origen_ip': str(r['origen_ip']) if r['origen_ip'] else None,
        'verificacion_ubicacion': r['verificacion_ubicacion'],
        'qr_origen': r['qr_origen'],
        'corrige_evento_id': r['corrige_evento_id'],
        'correccion_motivo': r['correccion_motivo'],
        'autor_rol': r['autor_rol'],
        'hash': r['hash'], 'prev_hash': r['prev_hash'],
    } for r in rows]
    return jsonify({'ok': True, 'eventos': out})


# ═══════════════════════════════════════════════════════════════════════════
# ║  ADMIN: correcciones — bandeja + aprobar/rechazar + directa             ║
# ═══════════════════════════════════════════════════════════════════════════

def _correccion_to_dict(r):
    return {
        'id': r['id'], 'id_manager': r['id_manager'],
        'trabajador_id': r['trabajador_id'],
        'trabajador_nombre': r.get('trabajador_nombre') or '',
        'tipo_propuesto': r['tipo_propuesto'],
        'ts_propuesto': r['ts_propuesto'].astimezone(dt.timezone.utc).isoformat() if r['ts_propuesto'] else None,
        'pausa_motivo_id': r['pausa_motivo_id'],
        'corrige_evento_id': r['corrige_evento_id'],
        'motivo': r['motivo'],
        'estado': r['estado'],
        'ts_resolucion': r['ts_resolucion'].astimezone(dt.timezone.utc).isoformat() if r['ts_resolucion'] else None,
        'comentario_resolucion': r['comentario_resolucion'],
        'resuelto_por_usuario_id': r['resuelto_por_usuario_id'],
        'evento_resultante_id': r['evento_resultante_id'],
        'created_at': r['created_at'].astimezone(dt.timezone.utc).isoformat() if r['created_at'] else None,
    }


@bp.route('/correcciones', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_correcciones():
    estado = (request.args.get('estado') or 'pendiente').strip()
    sql = """
        SELECT c.id, c.id_manager, c.trabajador_id, t.nombre_completo AS trabajador_nombre,
               c.tipo_propuesto, c.ts_propuesto, c.pausa_motivo_id, c.corrige_evento_id,
               c.motivo, c.estado, c.ts_resolucion, c.comentario_resolucion,
               c.resuelto_por_usuario_id, c.evento_resultante_id, c.created_at
          FROM correccion_solicitud c
          JOIN trabajador t ON t.id = c.trabajador_id
         WHERE c.id_manager = %s
    """
    params = [str(g.id_manager)]
    if estado in ('pendiente', 'aprobada', 'rechazada'):
        sql += " AND c.estado = %s"; params.append(estado)
    sql += " ORDER BY c.created_at DESC LIMIT 500"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'correcciones': [_correccion_to_dict(r) for r in rows]})


def _autor_admin_id():
    """Si hay usuario_web logueado vía JWT, devuelve su id; si no, None
    (manager NoofitPro clásico)."""
    u = getattr(g, 'usuario_web', None)
    return u['id'] if u else None


@bp.route('/correcciones/<int:cor_id>/aprobar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def aprobar_correccion(cor_id):
    d = request.get_json() or {}
    comentario = (d.get('comentario') or '').strip() or None

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.id_manager, c.trabajador_id, c.tipo_propuesto, c.ts_propuesto,
                   c.pausa_motivo_id, c.corrige_evento_id, c.motivo, c.estado,
                   t.id_trainer_empleador
              FROM correccion_solicitud c
              JOIN trabajador t ON t.id = c.trabajador_id
             WHERE c.id = %s AND c.id_manager = %s
             FOR UPDATE
        """, (cor_id, str(g.id_manager)))
        sol = cur.fetchone()
        if not sol:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if sol['estado'] != 'pendiente':
            return jsonify({'ok': False, 'error': f'estado_{sol["estado"]}'}), 409

        # Resuelve trainer del evento original si hay corrige_evento_id;
        # si no, usa el trainer empleador.
        id_trainer = sol['id_trainer_empleador']
        if sol['corrige_evento_id']:
            cur.execute("""
                SELECT id_trainer FROM fichaje_evento
                 WHERE id = %s AND id_manager = %s
            """, (sol['corrige_evento_id'], str(g.id_manager)))
            r = cur.fetchone()
            if r and r['id_trainer']:
                id_trainer = r['id_trainer']

        tipo_insert = ('CORRECCION_ANULAR' if sol['tipo_propuesto'] == 'ANULAR'
                       else 'CORRECCION_INSERT')

        evento = {
            'id_manager': str(g.id_manager),
            'trabajador_id': sol['trabajador_id'],
            'id_trainer': id_trainer,
            'tipo': tipo_insert,
            'ts_evento': sol['ts_propuesto'],
            'pausa_motivo_id': sol['pausa_motivo_id'],
            'origen': 'admin',
            'origen_version': None, 'origen_ip': _client_ip(),
            'origen_user_agent': (request.headers.get('User-Agent') or '')[:512] or None,
            'verificacion_ubicacion': 'NO',
            'qr_origen': None, 'qr_token_jti': None, 'qr_clase_id': None,
            'lat': None, 'lng': None, 'geo_accuracy_m': None,
            'corrige_evento_id': sol['corrige_evento_id'],
            'correccion_solicitud_id': sol['id'],
            'correccion_motivo': sol['motivo'],
            'autor_rol': 'admin',
            'autor_usuario_id': _autor_admin_id(),
            'autor_cliente_idnoofit': None,
        }
        inserted = _insert_evento(cur, evento)
        cur.execute("""
            UPDATE correccion_solicitud
               SET estado = 'aprobada',
                   ts_resolucion = NOW(),
                   comentario_resolucion = %s,
                   resuelto_por_usuario_id = %s,
                   evento_resultante_id = %s,
                   updated_at = NOW()
             WHERE id = %s
        """, (comentario, _autor_admin_id(), inserted['id'], cor_id))
    log_action(actor_from_request(), entidad='correccion_solicitud',
               entidad_id=cor_id, accion='aprobar',
               resumen=f'evento={inserted["id"]}')
    return jsonify({'ok': True, 'evento_id': inserted['id']})


@bp.route('/correcciones/<int:cor_id>/rechazar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def rechazar_correccion(cor_id):
    d = request.get_json() or {}
    comentario = (d.get('comentario') or '').strip() or None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE correccion_solicitud
               SET estado = 'rechazada',
                   ts_resolucion = NOW(),
                   comentario_resolucion = %s,
                   resuelto_por_usuario_id = %s,
                   updated_at = NOW()
             WHERE id = %s AND id_manager = %s AND estado = 'pendiente'
            RETURNING id
        """, (comentario, _autor_admin_id(), cor_id, str(g.id_manager)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found_o_no_pendiente'}), 404
    log_action(actor_from_request(), entidad='correccion_solicitud',
               entidad_id=cor_id, accion='rechazar', resumen=comentario or '')
    return jsonify({'ok': True})


@bp.route('/eventos/correccion', methods=['POST'])
@auth_required
@require_feature('control_horario')
def correccion_directa_admin():
    """Inserta una corrección directamente sin pasar por solicitud.

    Body: trabajador_id, tipo, ts_evento, [pausa_motivo_id], [corrige_evento_id],
          motivo, [id_trainer]  (si no se da, se infiere del corrige_evento_id
                                  o del trainer empleador)
    """
    d = request.get_json() or {}
    trab_id = d.get('trabajador_id')
    tipo = (d.get('tipo') or '').upper().strip()
    ts = d.get('ts_evento')
    motivo = (d.get('motivo') or '').strip()
    if not trab_id or tipo not in ('ENTRADA', 'SALIDA', 'PAUSA_INI', 'PAUSA_FIN', 'ANULAR') or not ts or not motivo:
        return jsonify({'ok': False, 'error': 'campos_requeridos',
                        'detalle': 'trabajador_id, tipo, ts_evento, motivo'}), 400
    try:
        ts_evento = dt.datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        return jsonify({'ok': False, 'error': 'ts_evento_invalido'}), 400
    pausa_motivo_id = d.get('pausa_motivo_id')
    try:
        pausa_motivo_id = int(pausa_motivo_id) if pausa_motivo_id not in (None, '') else None
    except (TypeError, ValueError):
        pausa_motivo_id = None
    corrige_id = d.get('corrige_evento_id')
    try:
        corrige_id = int(corrige_id) if corrige_id not in (None, '') else None
    except (TypeError, ValueError):
        corrige_id = None

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id_trainer_empleador FROM trabajador
             WHERE id = %s AND id_manager = %s
        """, (int(trab_id), str(g.id_manager)))
        trab = cur.fetchone()
        if not trab:
            return jsonify({'ok': False, 'error': 'trabajador_not_found'}), 404
        id_trainer = (d.get('id_trainer') or trab['id_trainer_empleador'])
        if corrige_id and not d.get('id_trainer'):
            cur.execute("""
                SELECT id_trainer FROM fichaje_evento
                 WHERE id = %s AND id_manager = %s
            """, (corrige_id, str(g.id_manager)))
            r = cur.fetchone()
            if r:
                id_trainer = r['id_trainer']

        tipo_insert = ('CORRECCION_ANULAR' if tipo == 'ANULAR'
                       else 'CORRECCION_INSERT')

        evento = {
            'id_manager': str(g.id_manager),
            'trabajador_id': int(trab_id),
            'id_trainer': str(id_trainer) if id_trainer else None,
            'tipo': tipo_insert,
            'ts_evento': ts_evento,
            'pausa_motivo_id': pausa_motivo_id,
            'origen': 'admin',
            'origen_version': None, 'origen_ip': _client_ip(),
            'origen_user_agent': (request.headers.get('User-Agent') or '')[:512] or None,
            'verificacion_ubicacion': 'NO',
            'qr_origen': None, 'qr_token_jti': None, 'qr_clase_id': None,
            'lat': None, 'lng': None, 'geo_accuracy_m': None,
            'corrige_evento_id': corrige_id,
            'correccion_solicitud_id': None,
            'correccion_motivo': motivo,
            'autor_rol': 'admin',
            'autor_usuario_id': _autor_admin_id(),
            'autor_cliente_idnoofit': None,
        }
        if not evento['id_trainer']:
            return jsonify({'ok': False, 'error': 'trainer_no_determinado'}), 400
        inserted = _insert_evento(cur, evento)
    log_action(actor_from_request(), entidad='fichaje_evento',
               entidad_id=inserted['id'], accion='correccion_directa',
               resumen=f'trab={trab_id} tipo={tipo} motivo={motivo[:80]}')
    return jsonify({'ok': True, 'evento_id': inserted['id']})


# ═══════════════════════════════════════════════════════════════════════════
# ║  ADMIN: verify-chain                                                    ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/verify-chain/<int:trab_id>', methods=['GET'])
@auth_required
@require_feature('control_horario')
def verify_chain(trab_id):
    """Recalcula la cadena de hashes del trabajador y comprueba que cuadra
    con la almacenada. Si algún evento ha sido manipulado fuera del
    backend, devuelve el primer id roto.

    Coste: O(n) sobre los eventos del trabajador. Pensado para auditoría
    bajo demanda o cron mensual."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM trabajador WHERE id=%s AND id_manager=%s
        """, (trab_id, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""
            SELECT id, id_manager, trabajador_id, id_trainer, tipo, ts_evento,
                   pausa_motivo_id, origen, verificacion_ubicacion,
                   qr_origen, qr_token_jti, qr_clase_id,
                   corrige_evento_id, correccion_solicitud_id, correccion_motivo,
                   autor_rol, autor_usuario_id, autor_cliente_idnoofit,
                   prev_hash, hash
              FROM fichaje_evento
             WHERE trabajador_id = %s
             ORDER BY id ASC
        """, (trab_id,))
        rows = cur.fetchall()
    prev = None
    primer_roto = None
    for r in rows:
        ts_iso = r['ts_evento'].astimezone(dt.timezone.utc).isoformat()
        payload = _payload_for_hash({**r, 'ts_evento_iso': ts_iso})
        expected = _compute_hash(prev, payload)
        if expected != r['hash'] or (prev or '') != (r['prev_hash'] or ''):
            primer_roto = r['id']
            break
        prev = r['hash']
    return jsonify({
        'ok': primer_roto is None,
        'total_eventos': len(rows),
        'primer_evento_inconsistente': primer_roto,
    })
