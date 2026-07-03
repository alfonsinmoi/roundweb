"""Cron de reconciliación recibo BD ↔ Odoo (auditoría #31).

Detecta divergencias entre el estado LOCAL del recibo y el estado REAL en Odoo
(account.payment / account.move). NO muta datos — solo alerta.

Divergencias detectadas (recibo con vínculo Odoo):
  - pago_inexistente : recibo 'pagado'/'facturado' cuyo account.payment NO existe
                       en Odoo (id stale, típico de migración).
  - pago_cancelado   : ídem pero el pago está 'cancel' en Odoo.
  - factura_desajustada : recibo 'facturado' cuyo account.move no está 'posted'.
  - devolucion_no_propagada : recibo 'devuelto' cuyo account.payment sigue 'posted'.

Emite UNA incidencia_admin RESUMEN por manager (severidad 'warning'), refrescada
en cada ejecución (update-or-insert sobre la resumen sin leer) → NO inunda la
bandeja con una incidencia por recibo. El backlog histórico se vigila por su
CANTIDAD: si el número sube, hay desync nuevo que investigar. El detalle completo
(ids) va al log de la ejecución.

Lecturas Odoo EN LOTE por manager. Ejecutado por systemd timer
`round_reconciliacion_recibos.timer` (diario).
"""
import logging
from collections import defaultdict

from .db import get_conn
from .odoo_alta import OdooAlta

log = logging.getLogger(__name__)

LIMIT = 2000   # recibos vinculados a Odoo por ejecución


def _candidatos():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, id_trainer, cliente_idnoofit, estado,
                   account_payment_id, account_move_id
              FROM recibo
             WHERE (account_payment_id IS NOT NULL OR account_move_id IS NOT NULL)
               AND estado IN ('pagado', 'facturado', 'devuelto')
             ORDER BY id DESC
             LIMIT %s
        """, (LIMIT,))
        return cur.fetchall()


def _upsert_resumen(id_manager, titulo, mensaje, meta):
    """Mantiene UNA incidencia resumen sin leer por manager: si ya existe una
    sin leer, actualiza su mensaje/fecha; si no, la crea. Evita el flood."""
    import json
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE incidencia_admin
                          SET titulo=%s, mensaje=%s, meta=%s, created_at=now()
                        WHERE id_manager=%s AND tipo='reconciliacion_resumen'
                          AND leida_at IS NULL""",
                    (titulo, mensaje, json.dumps(meta, default=str), str(id_manager)))
        if cur.rowcount == 0:
            cur.execute("""INSERT INTO incidencia_admin
                             (id_manager, tipo, entidad, severidad, titulo, mensaje,
                              meta, created_by)
                           VALUES (%s, 'reconciliacion_resumen', 'recibo', 'warning',
                                   %s, %s, %s, 'cron_reconciliacion')""",
                        (str(id_manager), titulo, mensaje,
                         json.dumps(meta, default=str)))
        conn.commit()


def run():
    filas = _candidatos()
    if not filas:
        log.info('cron_reconciliacion_recibos: nada que revisar')
        return {'revisados': 0, 'divergencias': 0}

    por_manager = defaultdict(list)
    for r in filas:
        por_manager[str(r['id_manager'])].append(r)

    total_rev = total_div = 0
    for idm, recibos in por_manager.items():
        try:
            o = OdooAlta(id_manager=idm); o._connect()
        except Exception as e:
            log.warning(f'reconciliacion manager {idm}: no conecta Odoo: {e}')
            continue

        pids = sorted({r['account_payment_id'] for r in recibos if r['account_payment_id']})
        mids = sorted({r['account_move_id'] for r in recibos if r['account_move_id']})
        pay_state, move_state = {}, {}
        try:
            if pids:
                for p in (o._call('account.payment', 'read', pids, ['state']) or []):
                    pay_state[p['id']] = p.get('state')
            if mids:
                for m in (o._call('account.move', 'read', mids, ['state']) or []):
                    move_state[m['id']] = m.get('state')
        except Exception as e:
            log.warning(f'reconciliacion manager {idm}: read Odoo falló: {e}')
            continue

        cont = defaultdict(int)
        ejemplos = []
        for r in recibos:
            total_rev += 1
            pid, mid, est = r['account_payment_id'], r['account_move_id'], r['estado']
            problema = None
            if pid and est in ('pagado', 'facturado'):
                st = pay_state.get(pid, '__missing__')
                if st == 'cancel':
                    problema = 'pago_cancelado'
                elif st == '__missing__':
                    problema = 'pago_inexistente'
                elif st != 'posted':
                    problema = f'pago_{st}'
            if not problema and mid and est == 'facturado':
                if move_state.get(mid, '__missing__') != 'posted':
                    problema = 'factura_desajustada'
            if not problema and pid and est == 'devuelto' and pay_state.get(pid) == 'posted':
                problema = 'devolucion_no_propagada'
            if problema:
                total_div += 1
                cont[problema] += 1
                if len(ejemplos) < 30:
                    ejemplos.append(r['id'])

        if cont:
            desglose = ', '.join(f'{k}={v}' for k, v in sorted(cont.items(), key=lambda x: -x[1]))
            n = sum(cont.values())
            titulo = f'{n} recibos con desajuste BD ↔ Odoo'
            mensaje = (f'Reconciliación diaria: {n} recibos vinculados a Odoo cuyo estado no cuadra. '
                       f'Desglose: {desglose}. La mayoría suele ser backlog histórico (ids de pago '
                       f'stale de migración); vigilar que el número NO suba (desync nuevo). '
                       f'Ejemplos recibo id: {ejemplos}. Detalle completo en el log del cron.')
            log.warning(f'reconciliacion manager {idm}: {mensaje}')
            _upsert_resumen(idm, titulo, mensaje,
                            {'desglose': dict(cont), 'ejemplos': ejemplos, 'total': n})

    log.info(f'cron_reconciliacion_recibos: revisados={total_rev} divergencias={total_div}')
    return {'revisados': total_rev, 'divergencias': total_div}


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    run()
