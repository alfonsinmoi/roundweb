"""Limpieza: borrar las 938 account.move + 874 account.payment de la
migración GestPlus en Odoo (company 3) y actualizar los recibos en BD a
estado 'pagado' o 'impagado' (sin vínculo a factura).

Modo: CONFIRM=1 para aplicar; default dry-run.
Backup hecho previamente: /root/backup_odoo_pre_limpieza_*.sql
"""
import os, sys
sys.path.insert(0, '/opt/round_config_api')
from app.odoo_alta import OdooAlta
from app.db import get_conn

CONFIRM = os.getenv('CONFIRM') == '1'
COMPANY_ID = 3
ID_MANAGER_BD = '17677'  # corresponde a los recibos del backfill


def main():
    o = OdooAlta(); o._connect()
    print(f'Odoo uid={o._uid}')

    # 1. Listar
    moves = o._call('account.move', 'search',
        [('ref', 'like', 'GP-%'), ('move_type', '=', 'out_invoice'),
         ('company_id', '=', COMPANY_ID)])
    payments = o._call('account.payment', 'search',
        [('ref', 'like', 'PAGO-GP-%'), ('company_id', '=', COMPANY_ID)])
    print(f'\naccount.move (out_invoice GP): {len(moves)}')
    print(f'account.payment (PAGO-GP):     {len(payments)}')

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) AS n, SUM(importe_total) AS total
              FROM recibo
             WHERE id_manager=%s AND origen='gestplus_migracion' AND estado='facturado'
        """, (ID_MANAGER_BD,))
        r = cur.fetchone()
    print(f'\nrecibos BD (facturado, gestplus_migracion): {r["n"]} · total {r["total"]} €')

    if not CONFIRM:
        print('\n[DRY-RUN] CONFIRM=1 para aplicar.')
        return

    # 2. Borrar account.payment
    print('\n=== Borrando account.payment ===')
    p_borrados = 0
    p_errores = 0
    # Procesar en batches de 100
    for i in range(0, len(payments), 100):
        batch = payments[i:i+100]
        try:
            # Cancelar primero (action_cancel)
            try: o._call('account.payment', 'action_cancel', batch)
            except Exception: pass  # si ya está cancelado o no aplica
            o._call('account.payment', 'unlink', batch)
            p_borrados += len(batch)
            print(f'  borrados {p_borrados}/{len(payments)}')
        except Exception as e:
            p_errores += len(batch)
            print(f'  ⚠ error batch: {e}')

    # 3. Borrar account.move (necesita button_draft primero si están posteados)
    print('\n=== Borrando account.move ===')
    m_borrados = 0
    m_errores = 0
    for i in range(0, len(moves), 50):
        batch = moves[i:i+50]
        try:
            # 1. Reset to draft
            try: o._call('account.move', 'button_draft', batch)
            except Exception as e:
                # Algunas no se pueden reset — intentamos cancel
                try: o._call('account.move', 'button_cancel', batch)
                except Exception: pass
            # 2. Borrar
            o._call('account.move', 'unlink', batch)
            m_borrados += len(batch)
            print(f'  borrados {m_borrados}/{len(moves)}')
        except Exception as e:
            # Si falla todo el batch, intentar 1 a 1
            for mid in batch:
                try:
                    try: o._call('account.move', 'button_draft', [mid])
                    except Exception:
                        try: o._call('account.move', 'button_cancel', [mid])
                        except Exception: pass
                    o._call('account.move', 'unlink', [mid])
                    m_borrados += 1
                except Exception as e2:
                    m_errores += 1
                    if m_errores <= 5:
                        print(f'  ⚠ {mid}: {e2}')

    # 4. Actualizar recibos BD
    print('\n=== Actualizando recibos BD ===')
    with get_conn() as conn, conn.cursor() as cur:
        # Si metodo era sepa o tarjeta_token o cobrado=1 → 'pagado'; sino 'impagado'
        # Determinar pagado por: account_payment_id IS NOT NULL O metodo IN (sepa, tarjeta_token)
        # En la migración GP, todos los que tenían cobrado=1 generaron payment, entonces
        # metodo_pago='sepa' es sepa real, metodo_pago='caja_efectivo' eran cobrados también
        # pero en caja. Para distinguir, usamos fecha_pago: si tiene → pagado.
        cur.execute("""
            UPDATE recibo
               SET estado = CASE WHEN fecha_pago IS NOT NULL THEN 'pagado' ELSE 'impagado' END,
                   account_move_id = NULL,
                   account_move_ref = NULL,
                   account_payment_id = NULL
             WHERE id_manager = %s
               AND origen = 'gestplus_migracion'
               AND estado = 'facturado'
            RETURNING id, estado
        """, (ID_MANAGER_BD,))
        rows = cur.fetchall()
    pagados = sum(1 for r in rows if r['estado'] == 'pagado')
    impagados = sum(1 for r in rows if r['estado'] == 'impagado')
    print(f'  Recibos BD actualizados: {len(rows)}')
    print(f'    pagados:   {pagados}')
    print(f'    impagados: {impagados}')

    # 5. Resumen
    print(f'\n=== RESUMEN ===')
    print(f'  account.payment borrados:  {p_borrados}/{len(payments)}  · errores {p_errores}')
    print(f'  account.move borrados:     {m_borrados}/{len(moves)}     · errores {m_errores}')
    print(f'  recibos BD reasignados:    {len(rows)}')


if __name__ == '__main__':
    main()
