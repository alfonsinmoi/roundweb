"""Cron diario: snapshot del estado de los retos de cada manager.

Recorre todos los managers activos en `manager_config` y llama a
`snapshot_retos_manager(id_manager)` que guarda una fila por reto y día
en `reto_snapshot`.

Ejecutado por systemd timer `round_retos_snapshot.timer` (diario 04:30).
"""
import logging
import sys

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
log = logging.getLogger('cron_retos_snapshot')


def main():
    from .db import get_conn
    from .routes.retos import snapshot_retos_manager

    managers = []
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id_manager, nombre FROM manager_config WHERE activo=TRUE")
        managers = cur.fetchall()

    total = 0
    for m in managers:
        try:
            n = snapshot_retos_manager(m['id_manager'])
            log.info(f"manager={m['id_manager']} ({m.get('nombre')}): "
                     f'{n} retos snapshot')
            total += n
        except Exception as e:
            log.exception(f"manager={m['id_manager']}: {e}")

    log.info(f'TOTAL: {total} snapshots guardados')
    return 0


if __name__ == '__main__':
    sys.exit(main())
