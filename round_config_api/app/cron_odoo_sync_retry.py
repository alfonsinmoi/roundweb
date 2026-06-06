"""Cron B9 — reintento de sincronización de cobros (recibo → account.payment Odoo).

Outbox + reintento idempotente. Cuando Odoo está lento/caído al cobrar, el
recibo se marca pagado en LOCAL al instante y queda con
`sync_status='pending'|'error'`. Este cron reintenta crear el `account.payment`
de forma IDEMPOTENTE (por `ref=COBRO-RECIBO-<id>`, ver odoo_payments.B9), de
modo que ni los reintentos ni la concurrencia generan pagos duplicados.

- Éxito        → sync_status='synced', vincula payment, reconcilia si hay
                 factura posteada, y registra el cobro en `movimiento_financiero`.
- Fallo        → sync_status='error', incrementa sync_intentos, sella
                 sync_attempted_at. Tras MAX_INTENTOS → incidencia admin y deja
                 de reintentar (filtro por intentos).

Empresa por (manager, trainer) vía OdooAlta.resolve_company (B1/B10).
Ejecutado por systemd timer `round_odoo_sync_retry.timer` (cada ~10 min).
"""
import logging

from .db import get_conn
from .odoo_alta import OdooAlta
from .odoo_payments import crear_account_payment, vincular_payment_a_recibo

log = logging.getLogger(__name__)

TTL_MIN      = 10    # no reintentar el mismo recibo más de 1 vez cada 10 min
MAX_INTENTOS = 8     # tras N intentos fallidos → incidencia y parar
LIMIT        = 100   # recibos por ejecución


def _pendientes():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, id_trainer, cliente_idnoofit, importe_total,
                   metodo_pago, account_move_id, fecha_pago,
                   COALESCE(sync_intentos, 0) AS intentos
              FROM recibo
             WHERE estado = 'pagado'
               AND account_payment_id IS NULL
               AND sync_status IN ('pending', 'error')
               AND COALESCE(sync_intentos, 0) < %s
               AND (sync_attempted_at IS NULL
                    OR sync_attempted_at < now() - make_interval(mins => %s))
             ORDER BY sync_attempted_at NULLS FIRST
             LIMIT %s
        """, (MAX_INTENTOS, TTL_MIN, LIMIT))
        return cur.fetchall()


def _marcar_synced(rid, payment_id, id_manager, id_trainer, importe, fecha, reconciliado):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE recibo
               SET sync_status='synced', sync_error=NULL, sync_attempted_at=now()
             WHERE id=%s
        """, (rid,))
        # B12.2 — trazabilidad de la actuación de cobro (idempotente por ref)
        cur.execute("""
            INSERT INTO movimiento_financiero
                (id_manager, id_trainer, recibo_id, tipo, referencia, importe, fecha, odoo_ref)
            VALUES (%s, %s, %s, 'cobro', %s, %s, %s, %s)
            ON CONFLICT (id_manager, tipo, recibo_id, referencia) DO NOTHING
        """, (str(id_manager), str(id_trainer) if id_trainer else '',
              rid, f'COBRO-RECIBO-{rid}', importe, fecha,
              f'account.payment:{payment_id}'))
        conn.commit()


def _marcar_error(rid, intentos, err):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE recibo
               SET sync_status='error', sync_intentos=%s,
                   sync_attempted_at=now(), sync_error=%s
             WHERE id=%s
        """, (intentos + 1, (err or '')[:500], rid))
        conn.commit()


def _incidencia_max(r):
    try:
        from .incidencias import crear_incidencia_admin
        crear_incidencia_admin(
            id_manager=r['id_manager'], id_trainer=r.get('id_trainer'),
            tipo='odoo_sync', entidad='recibo', entidad_id=r['id'], severidad='error',
            titulo=f"Cobro recibo {r['id']} no sincroniza con Odoo",
            mensaje=(f"Tras {MAX_INTENTOS} intentos el account.payment no se ha "
                     f"podido crear/postear. Revisar Odoo (periodo contable, "
                     f"journal, disponibilidad). idnoofit={r['cliente_idnoofit']}."))
    except Exception as e:
        log.warning(f'cron_odoo_sync_retry: incidencia recibo {r["id"]} falló: {e}')


def run():
    filas = _pendientes()
    if not filas:
        log.info('cron_odoo_sync_retry: nada pendiente')
        return {'procesados': 0, 'ok': 0, 'error': 0}
    ok = err = 0
    cache = {}  # id_manager -> OdooAlta
    for r in filas:
        rid = r['id']
        idm = str(r['id_manager'])
        try:
            o = cache.get(idm)
            if o is None:
                o = OdooAlta(id_manager=idm)
                o._connect()
                cache[idm] = o
            comp = o.resolve_company(idm, r.get('id_trainer'))
            if not comp:
                _marcar_error(rid, r['intentos'], 'sin_company')
                err += 1
                continue
            res = crear_account_payment(
                o, company_id=comp, recibo_id=rid,
                cliente_idnoofit=r['cliente_idnoofit'],
                importe_total=float(r['importe_total'] or 0),
                metodo_pago=r['metodo_pago'],
                fecha_emision=r.get('fecha_pago'),
            )
            if res.get('ok') and res.get('payment_id'):
                vincular_payment_a_recibo(rid, res['payment_id'],
                                          fecha_pago=r.get('fecha_pago'),
                                          actor_label='cron_sync_retry')
                reconciliado = False
                move_id = r.get('account_move_id')
                if move_id:
                    try:
                        from .odoo_pos_sync import _reconcile
                        inv = o._call('account.move', 'read', [move_id], ['state', 'amount_residual'])
                        if inv and inv[0].get('state') == 'posted':
                            _reconcile(o, move_id, res['payment_id'], comp)
                            chk = o._call('account.move', 'read', [move_id], ['amount_residual'])
                            reconciliado = bool(chk and abs(chk[0].get('amount_residual') or 0) < 0.01)
                    except Exception as e:
                        log.warning(f'cron_odoo_sync_retry recibo {rid}: reconcile falló: {e}')
                _marcar_synced(rid, res['payment_id'], idm, r.get('id_trainer'),
                               float(r['importe_total'] or 0), r.get('fecha_pago'), reconciliado)
                ok += 1
            else:
                _marcar_error(rid, r['intentos'], res.get('error'))
                err += 1
                if r['intentos'] + 1 >= MAX_INTENTOS:
                    _incidencia_max(r)
        except Exception as e:
            log.exception(f'cron_odoo_sync_retry recibo {rid}')
            try:
                _marcar_error(rid, r['intentos'], str(e))
            except Exception:
                pass
            err += 1
    log.info(f'cron_odoo_sync_retry: procesados={len(filas)} ok={ok} error={err}')
    return {'procesados': len(filas), 'ok': ok, 'error': err}


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    run()
