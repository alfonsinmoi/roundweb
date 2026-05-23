"""Cron horario: refresca cliente_cache desde NoofitPro.

Recorre todos los managers activos en `manager_config` y llama a
`_sync_clientes_manager(id_manager)` que hace login + getClienteSimple +
UPSERT en cliente_cache. Tarda 2-3 s por manager (login + 1 request).

Ejecutado por systemd timer `round_clientes_sync.timer` (cada hora).
La granularidad horaria es suficiente porque:
  - El sync background también se dispara en cada apertura de la lista
    (anti-stampede 60 s), así que los cambios son visibles a los pocos
    segundos para cualquier usuario activo.
  - El cron solo garantiza que la cache se mantiene caliente cuando
    nadie ha abierto la app en mucho tiempo.
"""
import logging
import sys

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
log = logging.getLogger('cron_clientes_sync')


def main():
    from .db import get_conn
    from .routes.trainer_data import _sync_clientes_manager

    managers = []
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id_manager, nombre FROM manager_config WHERE activo=TRUE")
        managers = cur.fetchall()

    total = 0
    for m in managers:
        try:
            r = _sync_clientes_manager(m['id_manager'])
            n = r.get('n_clientes', 0)
            log.info(f"manager={m['id_manager']} ({m.get('nombre')}): "
                     f'{n} clientes (ok={r.get("ok")})')
            total += n
        except Exception as e:
            log.exception(f"manager={m['id_manager']}: {e}")

    log.info(f'TOTAL: {total} clientes refrescados')
    return 0


if __name__ == '__main__':
    sys.exit(main())
