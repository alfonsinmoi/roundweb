"""Inactividad TEMPORAL del cliente (pausa con fecha de inicio y fin + motivo).

A diferencia de la baja programada (desactivación permanente en una fecha),
aquí el cliente se ARCHIVA en NoofitPro al llegar `fecha_inicio` y se REACTIVA
automáticamente al pasar `fecha_fin`. Durante la ventana:
  - no puede reservar ni asistir (lo bloquea NoofitPro con enabled=false),
  - no se le emite cuota (guard en la preemisión, junto al de baja programada),
  - si la pausa cubre un mes con recibo YA emitido y NO pagado → se anula.

Estados: programada → en_curso → finalizada (o cancelada).
El cron diario `cron_baja_programada` aplica las transiciones por fecha
(reutiliza `aplicar_inicio` / `aplicar_fin` de este módulo).

Endpoints (bajo /api/clientes):
  POST   /<cliente_id>/inactivo-temporal   body {fecha_inicio, fecha_fin, motivo, motivo_detalle?}
  DELETE /<cliente_id>/inactivo-temporal   cancela (programada) o termina+reactiva (en_curso)
  GET    /inactivo-temporal                lista pausas activas del manager
  GET    /<cliente_id>/inactivo-temporal   pausa activa del cliente (o null)
"""
import datetime as dt
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from .. import noofit_client as nc
from ..audit_log import log_action, actor_from_request
from ..trainer_scope import cliente_pertenece_a_trainer

bp = Blueprint('inactivo_temporal', __name__)
log = logging.getLogger(__name__)

MOTIVOS = {'baja_medica', 'lesion', 'vacaciones', 'cambio_trabajo_domicilio', 'otros'}


def _parse_fecha(s):
    if not s: return None
    if isinstance(s, dt.date): return s
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _serialize(row):
    if not row: return None
    def iso(d): return d.isoformat() if hasattr(d, 'isoformat') else d
    return {
        'id': row['id'],
        'cliente_idnoofit': row['cliente_idnoofit'],
        'fecha_inicio': iso(row.get('fecha_inicio')),
        'fecha_fin': iso(row.get('fecha_fin')),
        'motivo': row.get('motivo'),
        'motivo_detalle': row.get('motivo_detalle'),
        'estado': row.get('estado'),
        'creada_por_email': row.get('creada_por_email'),
        'creada_at': iso(row.get('creada_at')),
        'aplicado_inicio_at': iso(row.get('aplicado_inicio_at')),
        'aplicado_fin_at': iso(row.get('aplicado_fin_at')),
        'error': row.get('error'),
    }


# ── Helpers de credenciales / NoofitPro ────────────────────────────────────
def _creds_trainer_de_cliente(id_manager, cliente_idnoofit):
    """Devuelve (id_trainer, email, password) de la cuenta NoofitPro que VE a
    este cliente (la de su trainer). Así archivamos/reactivamos con las creds
    correctas tanto si el cliente es del manager como de un trainer hijo."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT id_trainer FROM cliente_cache WHERE id_manager=%s AND id=%s",
                        (str(id_manager), int(cliente_idnoofit)))
            r = cur.fetchone()
        if not r or not r.get('id_trainer'):
            return (None, None, None)
        tid = str(r['id_trainer'])
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT noofit_email, noofit_password FROM trainer_noofit_creds
                            WHERE id_manager=%s AND id_trainer=%s AND activo=TRUE
                              AND noofit_email IS NOT NULL AND noofit_password IS NOT NULL
                            LIMIT 1""", (str(id_manager), tid))
            c = cur.fetchone()
        if not c:
            return (tid, None, None)
        return (tid, c['noofit_email'], c['noofit_password'])
    except Exception as e:
        log.warning(f'_creds_trainer_de_cliente {cliente_idnoofit}: {e}')
        return (None, None, None)


def _enabled_actual(id_manager, cliente_idnoofit):
    """Estado enabled actual del cliente según cliente_cache (None si no consta)."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT enabled FROM cliente_cache WHERE id_manager=%s AND id=%s",
                        (str(id_manager), int(cliente_idnoofit)))
            r = cur.fetchone()
        return None if not r else bool(r['enabled'])
    except Exception:
        return None


def _archivar(id_manager, cliente_idnoofit, motivo):
    tid, email, pwd = _creds_trainer_de_cliente(id_manager, cliente_idnoofit)
    if email and pwd:
        return nc.archivar_cliente_as_trainer(int(cliente_idnoofit), motivo, email, pwd)
    return nc.archivar_cliente(int(cliente_idnoofit), motivo)


def _reactivar(id_manager, cliente_idnoofit):
    tid, email, pwd = _creds_trainer_de_cliente(id_manager, cliente_idnoofit)
    if email and pwd:
        return nc.reactivar_cliente_as_trainer(int(cliente_idnoofit), email, pwd)
    return nc.reactivar_cliente(int(cliente_idnoofit))


def _periodos_cubiertos(fi: dt.date, ff: dt.date):
    """Lista de 'YYYY-MM' que la ventana [fi, ff] toca (cualquier día)."""
    out = []
    y, m = fi.year, fi.month
    while (y, m) <= (ff.year, ff.month):
        out.append(f'{y:04d}-{m:02d}')
        m += 1
        if m > 12:
            m = 1; y += 1
    return out


def _anular_recibos_no_pagados(id_manager, cliente_idnoofit, fi, ff):
    """Anula (estado='cancelado') los recibos BD del cliente de los meses que
    la pausa cubre, SOLO si no están pagados y aún no se facturaron a Odoo
    (account_move_id IS NULL). Devuelve (anulados, requieren_revision_odoo).

    Los recibos ya facturados a Odoo (account_move_id set) no se tocan
    automáticamente — se devuelven aparte para que el admin los anule por la
    vía de recibos (que revierte en Odoo correctamente)."""
    periodos = _periodos_cubiertos(fi, ff)
    if not periodos:
        return 0, 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE recibo SET estado='cancelado', updated_at=NOW()
             WHERE id_manager=%s AND cliente_idnoofit=%s
               AND periodo = ANY(%s)
               AND estado NOT IN ('pagado','facturado','cancelado')
               AND account_move_id IS NULL
            RETURNING id
        """, (str(id_manager), str(cliente_idnoofit), periodos))
        anulados = len(cur.fetchall())
        cur.execute("""
            SELECT count(*) AS n FROM recibo
             WHERE id_manager=%s AND cliente_idnoofit=%s
               AND periodo = ANY(%s)
               AND estado NOT IN ('pagado','facturado','cancelado')
               AND account_move_id IS NOT NULL
        """, (str(id_manager), str(cliente_idnoofit), periodos))
        revision = cur.fetchone()['n']
    return anulados, revision


# ── Transiciones (reutilizables por el cron) ───────────────────────────────
def aplicar_inicio(row):
    """programada → en_curso: archiva en NoofitPro + anula recibos no pagados.
    `row` debe traer id, id_manager, cliente_idnoofit, motivo, fecha_inicio,
    fecha_fin. Devuelve (ok, error|None)."""
    idm = str(row['id_manager']); cid = str(row['cliente_idnoofit'])
    enabled_prev = _enabled_actual(idm, cid)
    motivo_txt = f"Inactividad temporal ({row.get('motivo')})"
    ok = _archivar(idm, cid, motivo_txt)
    if not ok:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("UPDATE cliente_inactivo_temporal SET error=%s WHERE id=%s",
                        ('fallo_archivar_noofit', row['id']))
        return False, 'fallo_archivar_noofit'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE cliente_inactivo_temporal
               SET estado='en_curso', aplicado_inicio_at=NOW(),
                   enabled_anterior=%s, error=NULL
             WHERE id=%s
        """, (True if enabled_prev is None else enabled_prev, row['id']))
        cur.execute("""
            INSERT INTO cliente_estado_log
              (id_manager, cliente_id, estado_nuevo, estado_anterior,
               motivo_archivado, notas)
            VALUES (%s, %s, 'archivado', 'activo', %s, %s)
        """, (idm, int(cid), motivo_txt, f'inactivo_temporal id={row["id"]}'))
    # PAUSAR (no cancelar) las suscripciones Odoo del cliente. Reversible: al
    # finalizar la pausa se reactivan (aplicar_fin). Si Odoo falla, el cron
    # nocturno `sync_nf_subs` lo reconcilia (cliente enabled=False → suspender).
    try:
        from ..odoo_sync import get_sync
        get_sync(idm).subs_pausar(cid)
    except Exception as e:
        log.warning(f'aplicar_inicio: no se pudieron pausar subs de {cid}: {e}')
    return True, None


def aplicar_fin(row):
    """en_curso → finalizada: reactiva en NoofitPro (solo si antes estaba
    activo). Devuelve (ok, error|None)."""
    idm = str(row['id_manager']); cid = str(row['cliente_idnoofit'])
    enabled_prev = row.get('enabled_anterior')
    ok = True
    if enabled_prev is None or enabled_prev:
        ok = _reactivar(idm, cid)
    if not ok:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("UPDATE cliente_inactivo_temporal SET error=%s WHERE id=%s",
                        ('fallo_reactivar_noofit', row['id']))
        return False, 'fallo_reactivar_noofit'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE cliente_inactivo_temporal
               SET estado='finalizada', aplicado_fin_at=NOW(), error=NULL
             WHERE id=%s
        """, (row['id'],))
        if enabled_prev is None or enabled_prev:
            cur.execute("""
                INSERT INTO cliente_estado_log
                  (id_manager, cliente_id, estado_nuevo, estado_anterior, notas)
                VALUES (%s, %s, 'activo', 'archivado', %s)
            """, (idm, int(cid), f'fin inactivo_temporal id={row["id"]}'))
    # REACTIVAR las suscripciones que se pausaron al inicio (suspendida→activa),
    # solo si el cliente vuelve a estar activo. Si Odoo falla, el cron nocturno
    # `sync_nf_subs` lo reconcilia (cliente enabled=True → reactivar suspendidas).
    if enabled_prev is None or enabled_prev:
        try:
            from ..odoo_sync import get_sync
            get_sync(idm).subs_reactivar(cid)
        except Exception as e:
            log.warning(f'aplicar_fin: no se pudieron reactivar subs de {cid}: {e}')
    return True, None


# ── POST: crear pausa temporal ─────────────────────────────────────────────
@bp.route('/<int:cliente_id>/inactivo-temporal', methods=['POST'])
@auth_required
@require_permission('clientes.archivar')
def crear(cliente_id):
    if not cliente_pertenece_a_trainer(cliente_id):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    d = request.get_json() or {}
    fi = _parse_fecha(d.get('fecha_inicio'))
    ff = _parse_fecha(d.get('fecha_fin'))
    if not fi or not ff:
        return jsonify({'ok': False, 'error': 'fechas_invalidas'}), 400
    if ff < fi:
        return jsonify({'ok': False, 'error': 'fin_antes_de_inicio'}), 400
    motivo = (d.get('motivo') or '').strip()
    if motivo not in MOTIVOS:
        return jsonify({'ok': False, 'error': 'motivo_invalido'}), 400
    motivo_detalle = (d.get('motivo_detalle') or '').strip() or None
    nombre = (d.get('cliente_nombre') or '').strip() or None
    email  = (d.get('cliente_email') or '').strip() or None
    actor  = actor_from_request()
    actor_email = actor.get('email') if isinstance(actor, dict) else None

    # Mutua exclusión: no si ya hay pausa activa o baja programada pendiente.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id FROM cliente_inactivo_temporal
                        WHERE id_manager=%s AND cliente_idnoofit=%s
                          AND estado IN ('programada','en_curso')""",
                    (str(g.id_manager), str(cliente_id)))
        if cur.fetchone():
            return jsonify({'ok': False, 'error': 'ya_existe_pausa_activa'}), 409
        cur.execute("""SELECT id FROM cliente_baja_programada
                        WHERE id_manager=%s AND cliente_idnoofit=%s AND ejecutada_at IS NULL""",
                    (str(g.id_manager), str(cliente_id)))
        if cur.fetchone():
            return jsonify({'ok': False, 'error': 'tiene_baja_programada'}), 409

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO cliente_inactivo_temporal
              (id_manager, cliente_idnoofit, cliente_nombre, cliente_email,
               fecha_inicio, fecha_fin, motivo, motivo_detalle, estado, creada_por_email)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'programada', %s)
            RETURNING *
        """, (str(g.id_manager), str(cliente_id), nombre, email,
              fi, ff, motivo, motivo_detalle, actor_email))
        row = cur.fetchone()

    # Si la pausa ya empezó (inicio <= hoy), aplicar ahora.
    today = dt.date.today()
    aplicada = False
    error = None
    if fi <= today:
        ok, err = aplicar_inicio(row)
        aplicada = ok
        error = err

    # Anular recibos NO pagados de los meses cubiertos ya emitidos.
    anulados, revision_odoo = _anular_recibos_no_pagados(
        g.id_manager, cliente_id, fi, ff)

    log_action(actor, entidad='cliente_inactivo_temporal',
               entidad_id=row['id'], accion='crear',
               resumen=(f'cliente={cliente_id} {fi}→{ff} motivo={motivo} '
                        f'aplicada_ya={aplicada} recibos_anulados={anulados}'),
               cambios={'fecha_inicio': fi.isoformat(), 'fecha_fin': ff.isoformat(),
                        'motivo': motivo})

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM cliente_inactivo_temporal WHERE id=%s", (row['id'],))
        row = cur.fetchone()
    payload = {'ok': True, 'pausa': _serialize(row),
               'aplicada_inmediato': aplicada,
               'recibos_anulados': anulados}
    if revision_odoo:
        payload['recibos_odoo_revision_manual'] = revision_odoo
    if error:
        payload['warning'] = error
    return jsonify(payload)


# ── PATCH: editar fechas de la pausa (solo ADMIN) ──────────────────────────
@bp.route('/<int:cliente_id>/inactivo-temporal', methods=['PATCH'])
@auth_required
@require_permission('clientes.editar_pausa')
def editar(cliente_id):
    """Modifica la pausa activa (programada|en_curso). Pensado para corregir la
    FECHA FIN (ampliar/acortar la inactividad). Requiere el permiso
    `clientes.editar_pausa` (el manager decide qué perfiles lo tienen).

    - `fecha_inicio` solo es editable si la pausa aún NO ha empezado (programada).
    - Al ampliar la ventana se anulan los recibos NO pagados de los meses recién
      cubiertos (idempotente sobre los ya anulados).
    - Al acortar, los recibos ya anulados de meses que quedan fuera NO se
      restauran automáticamente (se avisa en `meses_destapados`)."""
    if not cliente_pertenece_a_trainer(cliente_id):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    d = request.get_json() or {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM cliente_inactivo_temporal
                        WHERE id_manager=%s AND cliente_idnoofit=%s
                          AND estado IN ('programada','en_curso')
                        ORDER BY id DESC LIMIT 1""",
                    (str(g.id_manager), str(cliente_id)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'sin_pausa_activa'}), 404

    fi = row['fecha_inicio']
    nueva_fi = _parse_fecha(d.get('fecha_inicio')) if 'fecha_inicio' in d else None
    if nueva_fi is not None:
        if row['estado'] != 'programada':
            return jsonify({'ok': False, 'error': 'inicio_no_editable_en_curso',
                            'detalle': 'La pausa ya empezó; solo puede cambiarse la fecha fin.'}), 400
        fi = nueva_fi
    ff = _parse_fecha(d.get('fecha_fin')) if 'fecha_fin' in d else row['fecha_fin']
    if not ff:
        return jsonify({'ok': False, 'error': 'fecha_fin_invalida'}), 400
    if ff < fi:
        return jsonify({'ok': False, 'error': 'fin_antes_de_inicio'}), 400

    sets, vals = ['fecha_fin=%s'], [ff]
    if nueva_fi is not None:
        sets.append('fecha_inicio=%s'); vals.append(fi)
    if 'motivo' in d:
        motivo = (d.get('motivo') or '').strip()
        if motivo not in MOTIVOS:
            return jsonify({'ok': False, 'error': 'motivo_invalido'}), 400
        sets.append('motivo=%s'); vals.append(motivo)
    if 'motivo_detalle' in d:
        sets.append('motivo_detalle=%s')
        vals.append((d.get('motivo_detalle') or '').strip() or None)
    vals.append(row['id'])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE cliente_inactivo_temporal SET {', '.join(sets)} WHERE id=%s RETURNING *", vals)
        updated = cur.fetchone()

    # Ampliación → anular recibos no pagados de los meses de la nueva ventana.
    anulados, revision = _anular_recibos_no_pagados(g.id_manager, cliente_id, fi, ff)
    old_per = set(_periodos_cubiertos(row['fecha_inicio'], row['fecha_fin']))
    new_per = set(_periodos_cubiertos(fi, ff))
    destapados = sorted(old_per - new_per)

    log_action(actor_from_request(), entidad='cliente_inactivo_temporal',
               entidad_id=row['id'], accion='editar',
               resumen=(f'cliente={cliente_id} fin {row["fecha_fin"]}→{ff} '
                        f'inicio {row["fecha_inicio"]}→{fi} recibos_anulados={anulados}'),
               cambios={'fecha_inicio': {'antes': str(row['fecha_inicio']), 'despues': fi.isoformat()},
                        'fecha_fin': {'antes': str(row['fecha_fin']), 'despues': ff.isoformat()}})
    payload = {'ok': True, 'pausa': _serialize(updated), 'recibos_anulados': anulados}
    if revision:
        payload['recibos_odoo_revision_manual'] = revision
    if destapados:
        payload['meses_destapados'] = destapados
    return jsonify(payload)


# ── DELETE: cancelar (programada) o terminar+reactivar (en_curso) ──────────
@bp.route('/<int:cliente_id>/inactivo-temporal', methods=['DELETE'])
@auth_required
@require_permission('clientes.archivar')
def cancelar(cliente_id):
    if not cliente_pertenece_a_trainer(cliente_id):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM cliente_inactivo_temporal
                        WHERE id_manager=%s AND cliente_idnoofit=%s
                          AND estado IN ('programada','en_curso')
                        LIMIT 1""", (str(g.id_manager), str(cliente_id)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'sin_pausa_activa'}), 404

    reactivado = False
    if row['estado'] == 'en_curso':
        # Estaba archivado por la pausa → reactivar (si antes estaba activo).
        ok, err = aplicar_fin(row)
        if not ok:
            return jsonify({'ok': False, 'error': err or 'fallo_reactivar'}), 502
        reactivado = True
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("UPDATE cliente_inactivo_temporal SET estado='cancelada' WHERE id=%s",
                        (row['id'],))
    else:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("UPDATE cliente_inactivo_temporal SET estado='cancelada' WHERE id=%s",
                        (row['id'],))

    log_action(actor_from_request(), entidad='cliente_inactivo_temporal',
               entidad_id=row['id'], accion='cancelar',
               resumen=f'cliente={cliente_id} estado_previo={row["estado"]} reactivado={reactivado}')
    return jsonify({'ok': True, 'reactivado': reactivado})


# ── GET: lista pausas activas del manager ──────────────────────────────────
@bp.route('/inactivo-temporal', methods=['GET'])
@auth_required
@require_permission('clientes.ver_listado')
def listar():
    incluir_fin = (request.args.get('incluir_finalizadas') or '').lower() in ('1', 'true', 'yes')
    estados = ('programada', 'en_curso', 'finalizada', 'cancelada') if incluir_fin \
              else ('programada', 'en_curso')
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM cliente_inactivo_temporal
                        WHERE id_manager=%s AND estado = ANY(%s)
                        ORDER BY fecha_inicio, id""",
                    (str(g.id_manager), list(estados)))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'items': [_serialize(r) for r in rows]})


# ── GET: pausa activa de un cliente ────────────────────────────────────────
@bp.route('/<int:cliente_id>/inactivo-temporal', methods=['GET'])
@auth_required
@require_permission('clientes.ver_listado')
def get_de_cliente(cliente_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM cliente_inactivo_temporal
                        WHERE id_manager=%s AND cliente_idnoofit=%s
                          AND estado IN ('programada','en_curso')
                        ORDER BY id DESC LIMIT 1""",
                    (str(g.id_manager), str(cliente_id)))
        row = cur.fetchone()
    return jsonify({'ok': True, 'pausa': _serialize(row) if row else None})
