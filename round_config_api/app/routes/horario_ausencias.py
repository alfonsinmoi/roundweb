"""Solicitudes de ausencia (vacaciones, asuntos propios, médico, …).

Fase 2 C del módulo Control horario.

Endpoints trabajador (JWT propio):
  POST   /api/horario/solicitud-ausencia               crear
  GET    /api/horario/mis-ausencias                    listado propio + saldo
  POST   /api/horario/solicitud-ausencia/<id>/cancelar

Endpoints admin (X-Round-Token):
  GET    /api/horario/ausencias?estado=&trabajador_id=
  POST   /api/horario/ausencias/<id>/aprobar
  POST   /api/horario/ausencias/<id>/rechazar
  GET    /api/horario/trabajadores/<id>/saldo-ausencias?ano=YYYY

Saldo de días: el cómputo lo hace `_saldo()` mirando:
  - vacaciones_dias / asuntos_propios_dias del convenio
  - overrides en trainer_empresa (override del convenio)
  - overrides en trabajador (override del trainer_empresa)
  - solicitudes APROBADAS de tipo='vacaciones' o 'asuntos_propios' del año natural

`vacaciones_tipo` (naturales|laborales) determina cómo se cuentan los días:
  - naturales: todos los días entre fecha_desde y fecha_hasta (inclusive)
  - laborales: solo lunes a viernes
"""
import datetime as dt
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..auth_trabajador import trabajador_required
from ..db import get_conn
from ..odoo_guard import require_feature
from ..audit_log import log_action, actor_from_request

bp = Blueprint('horario_ausencias', __name__)
log = logging.getLogger(__name__)


TIPOS = ('vacaciones', 'asuntos_propios', 'medico', 'personal',
         'baja_medica', 'permiso_retribuido', 'otros')


def _dias_entre(desde: dt.date, hasta: dt.date, modo: str = 'naturales') -> int:
    """Cuenta días entre dos fechas (inclusive). modo: 'naturales' o 'laborales'."""
    delta = (hasta - desde).days
    if modo == 'laborales':
        n = 0
        for i in range(delta + 1):
            d = desde + dt.timedelta(days=i)
            if d.weekday() < 5:   # lun=0 .. vie=4
                n += 1
        return n
    return delta + 1


def _saldo(trab_id: int, id_manager: str, ano: int) -> dict:
    """Calcula saldo de vacaciones y asuntos propios para el año natural."""
    with get_conn() as conn, conn.cursor() as cur:
        # Datos del convenio + overrides empresa + overrides trabajador
        cur.execute("""
            SELECT
              t.id, t.id_trainer_empleador,
              t.vacaciones_dias_override        AS trab_vac_ov,
              t.asuntos_propios_dias_override   AS trab_ap_ov,
              te.vacaciones_dias_override        AS empr_vac_ov,
              te.vacaciones_tipo_override        AS empr_vac_tipo_ov,
              te.asuntos_propios_dias_override   AS empr_ap_ov,
              c.vacaciones_dias                  AS conv_vac,
              c.vacaciones_tipo                  AS conv_vac_tipo,
              c.asuntos_propios_dias             AS conv_ap
              FROM trabajador t
              LEFT JOIN trainer_empresa te
                ON te.id_manager = t.id_manager AND te.id_trainer = t.id_trainer_empleador
              LEFT JOIN convenio c ON c.id = te.convenio_id
             WHERE t.id = %s AND t.id_manager = %s
        """, (trab_id, str(id_manager)))
        r = cur.fetchone()
        if not r:
            return {'ok': False, 'error': 'trabajador_no_encontrado'}

        vacaciones_dias = (r['trab_vac_ov']
                           or r['empr_vac_ov']
                           or r['conv_vac']
                           or 30)
        vacaciones_tipo = r['empr_vac_tipo_ov'] or r['conv_vac_tipo'] or 'naturales'
        asuntos_dias    = (r['trab_ap_ov']
                           or r['empr_ap_ov']
                           or r['conv_ap']
                           or 0)

        # Solicitudes aprobadas + pendientes del año
        cur.execute("""
            SELECT tipo, fecha_desde, fecha_hasta, jornada_completa, estado
              FROM solicitud_ausencia
             WHERE id_manager = %s
               AND trabajador_id = %s
               AND tipo IN ('vacaciones','asuntos_propios')
               AND EXTRACT(YEAR FROM fecha_desde) = %s
               AND estado IN ('pendiente','aprobada')
        """, (str(id_manager), trab_id, ano))
        sols = cur.fetchall()

    vac_aprob, vac_pend = 0, 0
    ap_aprob,  ap_pend  = 0, 0
    for s in sols:
        # Solo cuentan jornadas completas para saldo; las parciales (médico
        # de 2h) no descuentan días enteros.
        if not s['jornada_completa']:
            continue
        modo = vacaciones_tipo if s['tipo'] == 'vacaciones' else 'naturales'
        dias = _dias_entre(s['fecha_desde'], s['fecha_hasta'], modo=modo)
        if s['tipo'] == 'vacaciones':
            if s['estado'] == 'aprobada': vac_aprob += dias
            else:                          vac_pend  += dias
        else:
            if s['estado'] == 'aprobada': ap_aprob  += dias
            else:                          ap_pend   += dias

    return {
        'ok': True,
        'ano': ano,
        'vacaciones': {
            'total': int(vacaciones_dias),
            'tipo': vacaciones_tipo,
            'aprobadas': vac_aprob,
            'pendientes': vac_pend,
            'disponibles': max(0, int(vacaciones_dias) - vac_aprob - vac_pend),
        },
        'asuntos_propios': {
            'total': int(asuntos_dias),
            'aprobadas': ap_aprob,
            'pendientes': ap_pend,
            'disponibles': max(0, int(asuntos_dias) - ap_aprob - ap_pend),
        },
    }


def _row_to_dict(r):
    return {
        'id': r['id'],
        'trabajador_id': r['trabajador_id'],
        'trabajador_nombre': r.get('trabajador_nombre') or '',
        'tipo': r['tipo'],
        'fecha_desde': r['fecha_desde'].isoformat() if r['fecha_desde'] else None,
        'fecha_hasta': r['fecha_hasta'].isoformat() if r['fecha_hasta'] else None,
        'jornada_completa': bool(r['jornada_completa']),
        'hora_desde': r['hora_desde'].strftime('%H:%M') if r['hora_desde'] else None,
        'hora_hasta': r['hora_hasta'].strftime('%H:%M') if r['hora_hasta'] else None,
        'motivo_trabajador': r['motivo_trabajador'] or '',
        'estado': r['estado'],
        'motivo_resolucion': r['motivo_resolucion'] or '',
        'ts_resolucion': r['ts_resolucion'].isoformat() if r['ts_resolucion'] else None,
        'created_at': r['created_at'].isoformat() if r['created_at'] else None,
    }


def _opt_str(v):
    s = (v or '').strip() if v is not None else ''
    return s or None


# ═══════════════════════════════════════════════════════════════════════════
# ║  TRABAJADOR                                                              ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/solicitud-ausencia', methods=['POST'])
@trabajador_required
def crear_ausencia():
    """El trabajador solicita una ausencia. Quedará 'pendiente' hasta que
    un admin la apruebe o rechace.

    Body: { tipo, fecha_desde, fecha_hasta, jornada_completa (default true),
            hora_desde, hora_hasta, motivo_trabajador }
    """
    d = request.get_json() or {}
    tipo = (d.get('tipo') or '').strip().lower()
    if tipo not in TIPOS:
        return jsonify({'ok': False, 'error': 'tipo_invalido', 'permitidos': list(TIPOS)}), 400
    try:
        fd = dt.date.fromisoformat((d.get('fecha_desde') or '').strip())
        fh = dt.date.fromisoformat((d.get('fecha_hasta') or '').strip())
    except ValueError:
        return jsonify({'ok': False, 'error': 'fechas_invalidas'}), 400
    if fh < fd:
        return jsonify({'ok': False, 'error': 'rango_fechas_invalido'}), 400

    jornada_completa = d.get('jornada_completa')
    jornada_completa = True if jornada_completa is None else bool(jornada_completa)
    hora_desde = hora_hasta = None
    if not jornada_completa:
        if fd != fh:
            return jsonify({'ok': False, 'error': 'parcial_requiere_misma_fecha'}), 400
        try:
            hora_desde = dt.time.fromisoformat((d.get('hora_desde') or '').strip())
            hora_hasta = dt.time.fromisoformat((d.get('hora_hasta') or '').strip())
        except ValueError:
            return jsonify({'ok': False, 'error': 'horas_invalidas'}), 400
        if hora_hasta <= hora_desde:
            return jsonify({'ok': False, 'error': 'rango_horas_invalido'}), 400

    motivo = _opt_str(d.get('motivo_trabajador'))

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO solicitud_ausencia
              (id_manager, trabajador_id, tipo, fecha_desde, fecha_hasta,
               jornada_completa, hora_desde, hora_hasta, motivo_trabajador)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id, id_manager, trabajador_id, tipo, fecha_desde, fecha_hasta,
                      jornada_completa, hora_desde, hora_hasta, motivo_trabajador,
                      estado, motivo_resolucion, ts_resolucion, created_at
        """, (str(g.id_manager), g.trabajador['id'], tipo,
              fd, fh, jornada_completa, hora_desde, hora_hasta, motivo))
        row = cur.fetchone()
    return jsonify({'ok': True, 'solicitud': _row_to_dict(row)})


@bp.route('/mis-ausencias', methods=['GET'])
@trabajador_required
def mis_ausencias():
    """Listado propio + saldo de vacaciones/asuntos propios del año actual."""
    ano = dt.date.today().year
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, trabajador_id, tipo, fecha_desde, fecha_hasta,
                   jornada_completa, hora_desde, hora_hasta,
                   motivo_trabajador, estado, motivo_resolucion,
                   ts_resolucion, created_at
              FROM solicitud_ausencia
             WHERE trabajador_id = %s AND id_manager = %s
             ORDER BY fecha_desde DESC, id DESC
             LIMIT 200
        """, (g.trabajador['id'], str(g.id_manager)))
        rows = cur.fetchall()
    return jsonify({
        'ok': True,
        'ano': ano,
        'saldo': _saldo(g.trabajador['id'], g.id_manager, ano),
        'solicitudes': [_row_to_dict(r) for r in rows],
    })


@bp.route('/solicitud-ausencia/<int:sol_id>/cancelar', methods=['POST'])
@trabajador_required
def cancelar_ausencia(sol_id):
    """El trabajador cancela una solicitud propia (sólo si está pendiente)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE solicitud_ausencia
               SET estado = 'cancelada', ts_resolucion = NOW(), updated_at = NOW()
             WHERE id = %s AND trabajador_id = %s AND id_manager = %s
               AND estado = 'pendiente'
            RETURNING id
        """, (sol_id, g.trabajador['id'], str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found_o_no_pendiente'}), 404
    return jsonify({'ok': True})


# ═══════════════════════════════════════════════════════════════════════════
# ║  ADMIN                                                                   ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/ausencias', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_ausencias_admin():
    """Bandeja de solicitudes. Filtros: estado, trabajador_id, año."""
    estado = (request.args.get('estado') or '').strip()
    trab   = (request.args.get('trabajador_id') or '').strip()
    ano    = (request.args.get('ano') or '').strip()

    sql = """
        SELECT s.id, s.trabajador_id, t.nombre_completo AS trabajador_nombre,
               s.tipo, s.fecha_desde, s.fecha_hasta,
               s.jornada_completa, s.hora_desde, s.hora_hasta,
               s.motivo_trabajador, s.estado, s.motivo_resolucion,
               s.ts_resolucion, s.created_at
          FROM solicitud_ausencia s
          JOIN trabajador t ON t.id = s.trabajador_id
         WHERE s.id_manager = %s
    """
    params = [str(g.id_manager)]
    if estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada'):
        sql += " AND s.estado = %s"; params.append(estado)
    if trab:
        sql += " AND s.trabajador_id = %s"; params.append(int(trab))
    if ano:
        sql += " AND EXTRACT(YEAR FROM s.fecha_desde) = %s"; params.append(int(ano))
    sql += " ORDER BY s.created_at DESC LIMIT 500"

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'solicitudes': [_row_to_dict(r) for r in rows]})


def _autor_admin_id():
    u = getattr(g, 'usuario_web', None)
    return u['id'] if u else None


@bp.route('/ausencias/<int:sol_id>/aprobar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def aprobar_ausencia(sol_id):
    d = request.get_json() or {}
    motivo = _opt_str(d.get('motivo'))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE solicitud_ausencia
               SET estado = 'aprobada',
                   ts_resolucion = NOW(),
                   resuelto_por_usuario_id = %s,
                   motivo_resolucion = %s,
                   updated_at = NOW()
             WHERE id = %s AND id_manager = %s AND estado = 'pendiente'
            RETURNING id, trabajador_id, tipo, fecha_desde, fecha_hasta
        """, (_autor_admin_id(), motivo, sol_id, str(g.id_manager)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found_o_no_pendiente'}), 404
    log_action(actor_from_request(), entidad='solicitud_ausencia',
               entidad_id=sol_id, accion='aprobar',
               resumen=f'trab={row["trabajador_id"]} tipo={row["tipo"]} {row["fecha_desde"]}..{row["fecha_hasta"]}')
    return jsonify({'ok': True})


@bp.route('/ausencias/<int:sol_id>/rechazar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def rechazar_ausencia(sol_id):
    d = request.get_json() or {}
    motivo = _opt_str(d.get('motivo'))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE solicitud_ausencia
               SET estado = 'rechazada',
                   ts_resolucion = NOW(),
                   resuelto_por_usuario_id = %s,
                   motivo_resolucion = %s,
                   updated_at = NOW()
             WHERE id = %s AND id_manager = %s AND estado = 'pendiente'
            RETURNING id, trabajador_id, tipo
        """, (_autor_admin_id(), motivo, sol_id, str(g.id_manager)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found_o_no_pendiente'}), 404
    log_action(actor_from_request(), entidad='solicitud_ausencia',
               entidad_id=sol_id, accion='rechazar',
               resumen=f'trab={row["trabajador_id"]} motivo={motivo or ""}')
    return jsonify({'ok': True})


@bp.route('/trabajadores/<int:trab_id>/saldo-ausencias', methods=['GET'])
@auth_required
@require_feature('control_horario')
def saldo_ausencias_admin(trab_id):
    try:
        ano = int(request.args.get('ano') or '')
    except ValueError:
        return jsonify({'ok': False, 'error': 'ano_invalido'}), 400
    if not ano:
        ano = dt.date.today().year
    return jsonify(_saldo(trab_id, g.id_manager, ano))
