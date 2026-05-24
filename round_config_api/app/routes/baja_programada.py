"""Endpoints de baja programada de cliente.

Permite al manager marcar a un cliente como "Inactivo a partir de una fecha"
(no instantáneo). El cliente sigue activo en NoofitPro hasta esa fecha, y
los recibos mensuales se filtran para no emitir si el cliente está inactivo
el día 1 del mes.

Flujo:
  POST   /api/clientes/<cliente_id>/baja-programada     body: {fecha, motivo}
  DELETE /api/clientes/<cliente_id>/baja-programada     cancela
  GET    /api/clientes/baja-programada                  lista pendientes

Reglas:
  - fecha <= hoy → ejecuta inmediato (archiva en NoofitPro + log).
    Si fecha < hoy es retroactivo; la anulación de recibos del mes(es)
    afectados queda como TODO Fase 3.
  - fecha > hoy → guarda pendiente. Cron diario `cron_baja_programada`
    la ejecuta cuando llega la fecha.
"""
import datetime as dt
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from .. import noofit_client as nc
from ..audit_log import log_action, actor_from_request

bp = Blueprint('baja_programada', __name__)
log = logging.getLogger(__name__)


def _parse_fecha(s):
    if not s: return None
    if isinstance(s, dt.date): return s
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _serialize(row):
    return {
        'id': row['id'],
        'cliente_idnoofit': row['cliente_idnoofit'],
        'fecha_baja': row['fecha_baja'].isoformat() if row.get('fecha_baja') else None,
        'motivo': row.get('motivo'),
        'cliente_nombre': row.get('cliente_nombre'),
        'cliente_email': row.get('cliente_email'),
        'creada_por_email': row.get('creada_por_email'),
        'creada_at': row['creada_at'].isoformat() if row.get('creada_at') else None,
        'ejecutada_at': row['ejecutada_at'].isoformat() if row.get('ejecutada_at') else None,
        'ejecutada_error': row.get('ejecutada_error'),
        'estado': ('ejecutada' if row.get('ejecutada_at')
                   else ('pendiente' if row.get('fecha_baja') and row['fecha_baja'] > dt.date.today()
                         else 'lista_para_ejecutar')),
    }


def _ejecutar_baja(id_baja: int, cliente_idnoofit, motivo):
    """Marca enabled=false en NoofitPro + actualiza fila + log."""
    ok = nc.archivar_cliente(int(cliente_idnoofit), motivo)
    if not ok:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE cliente_baja_programada
                   SET ejecutada_error = %s
                 WHERE id = %s
            """, ('archivar_cliente returned False', id_baja))
        return False, 'fallo_archivar_noofit'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE cliente_baja_programada
               SET ejecutada_at = NOW(), ejecutada_error = NULL
             WHERE id = %s
            RETURNING id_manager, cliente_idnoofit, cliente_nombre, cliente_email, motivo
        """, (id_baja,))
        info = cur.fetchone()
    if info:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cliente_estado_log
                  (id_manager, cliente_id, cliente_nombre, cliente_email,
                   estado_nuevo, estado_anterior, motivo_archivado, notas)
                VALUES (%s, %s, %s, %s, 'archivado', 'activo', %s, %s)
            """, (info['id_manager'], int(cliente_idnoofit),
                  info.get('cliente_nombre'), info.get('cliente_email'),
                  motivo, f'baja_programada id={id_baja}'))
    return True, None


# ─── POST: programar/aplicar baja ─────────────────────────────────────────
@bp.route('/<int:cliente_id>/baja-programada', methods=['POST'])
@auth_required
@require_permission('clientes.archivar')
def crear(cliente_id):
    """Crea (o ejecuta inmediato si fecha<=hoy) una baja programada.

    Body:
      { fecha_baja: 'YYYY-MM-DD', motivo: 'string opcional',
        cliente_nombre: 'snapshot opcional',
        cliente_email: 'snapshot opcional' }
    """
    d = request.get_json() or {}
    fecha = _parse_fecha(d.get('fecha_baja'))
    if not fecha:
        return jsonify({'ok': False, 'error': 'fecha_baja_invalida'}), 400
    motivo = (d.get('motivo') or '').strip() or None
    nombre = (d.get('cliente_nombre') or '').strip() or None
    email  = (d.get('cliente_email') or '').strip() or None
    actor  = actor_from_request()
    actor_email = (actor.get('email') if isinstance(actor, dict) else None)

    # Si ya hay una baja pendiente para este cliente, devolver error
    # (el frontend debe llamar a DELETE primero para reprogramar).
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, fecha_baja FROM cliente_baja_programada
             WHERE id_manager=%s AND cliente_idnoofit=%s AND ejecutada_at IS NULL
        """, (str(g.id_manager), str(cliente_id)))
        existente = cur.fetchone()
    if existente:
        return jsonify({
            'ok': False,
            'error': 'ya_existe_baja_pendiente',
            'baja_id': existente['id'],
            'fecha_baja': existente['fecha_baja'].isoformat(),
        }), 409

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO cliente_baja_programada
              (id_manager, cliente_idnoofit, fecha_baja, motivo,
               cliente_nombre, cliente_email, creada_por_email)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, id_manager, cliente_idnoofit, fecha_baja, motivo,
                      cliente_nombre, cliente_email, creada_por_email,
                      creada_at, ejecutada_at, ejecutada_error
        """, (str(g.id_manager), str(cliente_id), fecha, motivo,
              nombre, email, actor_email))
        row = cur.fetchone()

    # Si la fecha es hoy o pasada, ejecuta YA (no esperamos al cron).
    today = dt.date.today()
    ejecutada_ya = False
    error = None
    if fecha <= today:
        ok, err = _ejecutar_baja(row['id'], cliente_id, motivo)
        ejecutada_ya = ok
        error = err

    log_action(actor, entidad='cliente_baja_programada',
               entidad_id=row['id'], accion='crear',
               resumen=f'cliente={cliente_id} fecha={fecha.isoformat()} '
                       f'ejecutada_ya={ejecutada_ya} motivo={motivo!r}')

    # Re-leer la fila tras la posible ejecución para devolver estado actualizado.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM cliente_baja_programada WHERE id=%s", (row['id'],))
        row = cur.fetchone()

    payload = {
        'ok': True,
        'baja': _serialize(row),
        'ejecutada_inmediato': ejecutada_ya,
        'retroactiva': (fecha < today),
    }
    if error:
        payload['warning'] = error
    return jsonify(payload)


# ─── DELETE: cancelar baja pendiente ─────────────────────────────────────
@bp.route('/<int:cliente_id>/baja-programada', methods=['DELETE'])
@auth_required
@require_permission('clientes.archivar')
def cancelar(cliente_id):
    """Cancela una baja pendiente (no ejecutada todavía).

    Si la baja ya estaba ejecutada (enabled=false en NoofitPro), este
    endpoint NO reactiva al cliente. Para eso usa el botón "Reactivar"
    del perfil (que llama directamente a NoofitPro vía postClientes).
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            DELETE FROM cliente_baja_programada
             WHERE id_manager=%s AND cliente_idnoofit=%s AND ejecutada_at IS NULL
            RETURNING id, fecha_baja
        """, (str(g.id_manager), str(cliente_id)))
        deleted = cur.fetchone()
    if not deleted:
        return jsonify({'ok': False, 'error': 'sin_baja_pendiente'}), 404
    log_action(actor_from_request(), entidad='cliente_baja_programada',
               entidad_id=deleted['id'], accion='cancelar',
               resumen=f'cliente={cliente_id} fecha={deleted["fecha_baja"]}')
    return jsonify({'ok': True})


# ─── GET: lista bajas del manager ─────────────────────────────────────────
@bp.route('/baja-programada', methods=['GET'])
@auth_required
@require_permission('clientes.ver_listado')
def listar():
    """Lista bajas programadas del manager. ?incluir_ejecutadas=1 las muestra
    también (default: solo pendientes)."""
    incluir_ejec = (request.args.get('incluir_ejecutadas') or '').lower() in ('1', 'true', 'yes')
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT * FROM cliente_baja_programada
             WHERE id_manager = %s
               AND (%s OR ejecutada_at IS NULL)
             ORDER BY fecha_baja, id
        """, (str(g.id_manager), incluir_ejec))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'bajas': [_serialize(r) for r in rows]})


# ─── GET: baja programada de UN cliente concreto ──────────────────────────
@bp.route('/<int:cliente_id>/baja-programada', methods=['GET'])
@auth_required
@require_permission('clientes.ver_perfil')
def get_de_cliente(cliente_id):
    """Devuelve la baja pendiente del cliente (o null si no tiene)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT * FROM cliente_baja_programada
             WHERE id_manager=%s AND cliente_idnoofit=%s AND ejecutada_at IS NULL
             LIMIT 1
        """, (str(g.id_manager), str(cliente_id)))
        row = cur.fetchone()
    return jsonify({'ok': True, 'baja': _serialize(row) if row else None})
