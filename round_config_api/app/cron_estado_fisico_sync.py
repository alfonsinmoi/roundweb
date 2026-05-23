"""Cron diario: sync masivo de test_estado_fisico desde NoofitPro.

Recorre todos los managers activos en `manager_config` y llama a
`_sync_all(id_manager, only_stale=False)` para refrescar la cache local
de test_estado_fisico con TODOS los clientes (ignora el TTL de 6h).

Ejecutado por systemd timer `round_estado_fisico_sync.timer` (diario 03:45).
Tarda 5-30s con ~300 clientes/manager.
"""
import logging
import sys

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
log = logging.getLogger('cron_estado_fisico_sync')


def main():
    from .db import get_conn
    from .routes.estado_fisico import _sync_all

    managers = []
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id_manager, nombre FROM manager_config WHERE activo=TRUE")
        managers = cur.fetchall()

    total = 0
    for m in managers:
        try:
            result = _sync_all(m['id_manager'], None, only_stale=False)
            n = result.get('total_sesiones_procesadas', 0) if isinstance(result, dict) else 0
            log.info(f"manager={m['id_manager']} ({m.get('nombre')}): "
                     f'{n} sesiones procesadas')
            total += n
        except Exception as e:
            log.exception(f"manager={m['id_manager']}: {e}")

    log.info(f'TOTAL: {total} sesiones procesadas')
    return 0


if __name__ == '__main__':
    sys.exit(main())
