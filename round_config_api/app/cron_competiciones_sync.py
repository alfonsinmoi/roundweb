"""Cron diario: barrido de competicion_realizada desde NoofitPro.

Recorre los managers activos en `manager_config` y llama a
`_sync_all(id_manager, only_stale=False)` para refrescar la cache local de
participaciones en competiciones (barrido por ventana de fechas sobre las salas
del grupo con `competicion=true`). UPSERT idempotente por participación.

Ejecutado por systemd timer `round_competiciones_sync.timer` (diario 04:45).
"""
import logging
import sys

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
log = logging.getLogger('cron_competiciones_sync')


def main():
    from .db import get_conn
    from .routes.informe_competiciones import _sync_all

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id_manager, nombre FROM manager_config WHERE activo=TRUE")
        managers = cur.fetchall()

    total = 0
    for m in managers:
        try:
            result = _sync_all(m['id_manager'], None, only_stale=False)
            n = result.get('participaciones', 0) if isinstance(result, dict) else 0
            log.info(f"manager={m['id_manager']} ({m.get('nombre')}): "
                     f'{n} participaciones en competiciones')
            total += n
        except Exception as e:
            log.exception(f"manager={m['id_manager']}: {e}")

    log.info(f'TOTAL: {total} participaciones')
    return 0


if __name__ == '__main__':
    sys.exit(main())
