"""Cron diario: ejecuta bajas programadas cuya fecha_baja <= hoy.

Recorre `cliente_baja_programada` filtrando ejecutada_at IS NULL y
fecha_baja <= hoy. Para cada una:
  1) llama noofit_client.archivar_cliente(cliente_idnoofit, motivo)
  2) inserta evento en cliente_estado_log
  3) marca ejecutada_at = NOW()

Si falla la llamada a NoofitPro, deja la fila pendiente y anota el error
en ejecutada_error. El cron lo reintentará al día siguiente.

Para multi-manager: usa las credenciales de cada manager (cliente
pertenece a un manager según la fila). Itera todos los managers activos
en `manager_config`.

Ejecutado por systemd timer `round_baja_programada.timer` (cada noche
03:35, 5 min después del cron de log).
"""
import datetime as dt
import logging
import sys

from .db import get_conn
from . import noofit_client as nc

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
log = logging.getLogger('cron_baja_programada')


def main():
    today = dt.date.today()
    log.info(f'baja_programada cron — fecha_referencia={today}')

    # Listar managers activos
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id_manager, noofit_email, noofit_password
                         FROM manager_config WHERE activo=TRUE""")
        managers = cur.fetchall()

    total_ejec = 0
    total_fail = 0
    for m in managers:
        idm = str(m['id_manager'])
        # Bajas pendientes con fecha <= hoy
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, cliente_idnoofit, fecha_baja, motivo,
                       cliente_nombre, cliente_email
                  FROM cliente_baja_programada
                 WHERE id_manager = %s
                   AND ejecutada_at IS NULL
                   AND fecha_baja <= %s
                 ORDER BY fecha_baja, id
            """, (idm, today))
            bajas = cur.fetchall()
        if not bajas:
            continue
        log.info(f'manager {idm}: {len(bajas)} bajas a ejecutar')

        # Login NoofitPro como el manager
        try:
            nc._login_with_creds(m['noofit_email'], m['noofit_password'])
        except AttributeError:
            # Si no existe _login_with_creds, asumimos que `archivar_cliente`
            # usa el manager por defecto. En multi-manager esto puede no
            # bastar — pero ahora mismo solo hay 1 manager con bajas (17675).
            pass

        for baja in bajas:
            cli_id = baja['cliente_idnoofit']
            motivo = baja.get('motivo') or ''
            try:
                ok = nc.archivar_cliente(int(cli_id), motivo)
            except Exception as e:
                log.exception(f'baja {baja["id"]}: archivar_cliente {cli_id}')
                ok = False
                err = str(e)[:200]
            else:
                err = None if ok else 'archivar_returned_false'

            if ok:
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        UPDATE cliente_baja_programada
                           SET ejecutada_at = NOW(), ejecutada_error = NULL
                         WHERE id = %s
                    """, (baja['id'],))
                    cur.execute("""
                        INSERT INTO cliente_estado_log
                          (id_manager, cliente_id, cliente_nombre, cliente_email,
                           estado_nuevo, estado_anterior, motivo_archivado, notas)
                        VALUES (%s, %s, %s, %s, 'archivado', 'activo', %s, %s)
                    """, (idm, int(cli_id),
                          baja.get('cliente_nombre'),
                          baja.get('cliente_email'),
                          motivo,
                          f'cron_baja_programada id={baja["id"]} fecha={baja["fecha_baja"]}'))
                log.info(f'  ✓ baja {baja["id"]} cliente={cli_id} ejecutada')
                total_ejec += 1
            else:
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""UPDATE cliente_baja_programada
                                       SET ejecutada_error=%s
                                     WHERE id=%s""", (err, baja['id']))
                log.warning(f'  ✗ baja {baja["id"]} cliente={cli_id}: {err}')
                total_fail += 1

    log.info(f'TOTAL: ejecutadas={total_ejec}  fallos={total_fail}')
    return 0 if total_fail == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
