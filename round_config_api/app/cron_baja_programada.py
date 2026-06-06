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
        # Bajas pendientes con fecha <= hoy (incluye las que ya han fallado:
        # cada noche se reintentan — el ejecutada_error se sobrescribe).
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

        # Construir índice cliente_id → credenciales:
        #   1) Para el manager parent: getClienteSimple con sus creds.
        #   2) Para CADA trainer activo del manager: getClienteSimple como el
        #      trainer (cada trainer en NoofitPro tiene un "espacio" propio
        #      de clientes).
        # Recorremos todos los managers+trainers que estén dados de alta en
        # la web (manager_config + trainer_noofit_creds). Si un cliente
        # aparece en más de un espacio (raro), priorizamos trainer.
        cred_por_cliente = {}    # int cliente_id → ('manager'|'trainer:<id>', email, pwd)
        # 1) Manager parent
        try:
            tok, mhdr = nc._login(m['noofit_email'], m['noofit_password'])
            r = nc._request_as(tok, mhdr, 'GET', '/api/dispositivos/getClienteSimple')
            r.raise_for_status()
            for c in (((r.json() or {}).get('clientes')) or []):
                cid = c.get('id')
                if cid is None: continue
                cred_por_cliente[int(cid)] = ('manager', m['noofit_email'], m['noofit_password'])
            log.info(f'  manager {idm}: {len(cred_por_cliente)} clientes vistos')
        except Exception as e:
            log.warning(f'  manager {idm} getClienteSimple: {e}')

        # 2) Trainers del manager
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id_trainer, noofit_email, noofit_password
                             FROM trainer_noofit_creds
                            WHERE id_manager=%s AND activo=TRUE""", (idm,))
            trainers = cur.fetchall()
        for t in trainers:
            try:
                clis_t = nc.get_clientes_as_trainer(t['noofit_email'], t['noofit_password']) or []
                added = 0
                for c in clis_t:
                    cid = c.get('id')
                    if cid is None: continue
                    # trainer prevalece sobre manager (el trainer "posee" al
                    # cliente; archivar como trainer funciona aunque manager
                    # también lo vea)
                    cred_por_cliente[int(cid)] = (
                        f'trainer:{t["id_trainer"]}',
                        t['noofit_email'], t['noofit_password'])
                    added += 1
                log.info(f'  trainer {t["id_trainer"]}: {len(clis_t)} clientes')
            except Exception as e:
                log.warning(f'  trainer {t["id_trainer"]} getClienteSimple: {e}')

        for baja in bajas:
            cli_id = int(baja['cliente_idnoofit'])
            motivo = baja.get('motivo') or ''
            ok = False
            err = None
            cred = cred_por_cliente.get(cli_id)
            if cred:
                src, email, pwd = cred
                try:
                    if src == 'manager':
                        ok = nc.archivar_cliente(cli_id, motivo)
                    else:
                        ok = nc.archivar_cliente_as_trainer(cli_id, motivo, email, pwd)
                except Exception as e:
                    log.exception(f'baja {baja["id"]}: archivar via {src}')
                    err = f'{src}:{e}'[:200]
                if not ok and not err:
                    err = f'archivar_returned_false (via {src})'
            else:
                # Cliente no encontrado en ningún espacio del manager ni de
                # sus trainers. Probable que ya esté archivado en NoofitPro,
                # que pertenezca a otro manager, o que no exista. NO marcamos
                # como ejecutada para que admin pueda revisarlo.
                err = 'cliente_no_encontrado_en_ningun_manager_ni_trainer'

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

    # ── Inactividad temporal: aplicar inicio (archivar) y fin (reactivar) ────
    rc_temp = _procesar_inactivo_temporal()
    return 0 if (total_fail == 0 and rc_temp == 0) else 2


def _procesar_inactivo_temporal():
    """Aplica las transiciones por fecha de las pausas temporales:
      - programada con fecha_inicio <= hoy  → archivar (aplicar_inicio)
      - en_curso   con fecha_fin    <  hoy  → reactivar (aplicar_fin)
    aplicar_inicio/aplicar_fin resuelven las creds NoofitPro por cliente.
    Si falla (NF caído), deja el registro como está → se reintenta mañana."""
    from .routes.inactivo_temporal import aplicar_inicio, aplicar_fin
    today = dt.date.today()
    fail = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM cliente_inactivo_temporal
                        WHERE estado='programada' AND fecha_inicio <= %s
                        ORDER BY fecha_inicio, id""", (today,))
        a_iniciar = cur.fetchall()
        cur.execute("""SELECT * FROM cliente_inactivo_temporal
                        WHERE estado='en_curso' AND fecha_fin < %s
                        ORDER BY fecha_fin, id""", (today,))
        a_terminar = cur.fetchall()
    log.info(f'INACTIVO TEMPORAL: a_iniciar={len(a_iniciar)} a_terminar={len(a_terminar)}')
    for row in a_iniciar:
        try:
            ok, err = aplicar_inicio(row)
            if ok: log.info(f'  ▶ pausa {row["id"]} cliente={row["cliente_idnoofit"]} INICIADA')
            else:  fail += 1; log.warning(f'  ✗ pausa {row["id"]} inicio: {err}')
        except Exception as e:
            fail += 1; log.exception(f'  ✗ pausa {row["id"]} inicio: {e}')
    for row in a_terminar:
        try:
            ok, err = aplicar_fin(row)
            if ok: log.info(f'  ◀ pausa {row["id"]} cliente={row["cliente_idnoofit"]} FINALIZADA')
            else:  fail += 1; log.warning(f'  ✗ pausa {row["id"]} fin: {err}')
        except Exception as e:
            fail += 1; log.exception(f'  ✗ pausa {row["id"]} fin: {e}')
    return 0 if fail == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
