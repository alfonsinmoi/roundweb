"""Cron diario: barrido del namespace `/api/competicion/*` de NoofitPro.

Recorre los managers activos en `manager_config` y llama a
`_sync_all(id_manager, only_stale=False)` para refrescar:
  - competicion_circuito       (catálogo de circuitos, ~42 por manager)
  - competicion_edicion        (catálogo de ediciones oficiales)
  - competicion_participacion  (histórico de participaciones por cliente)

Fuente NoofitPro (v2, sep 2026):
  GET /api/competicion/circuitos/all
  GET /api/competicion/ediciones/all
  GET /api/competicion/participaciones/cliente/{idCliente}

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

    total_part = 0
    for m in managers:
        try:
            result = _sync_all(m['id_manager'], None, only_stale=False)
            if isinstance(result, dict) and result.get('ok'):
                circ = result.get('circuitos_barridos', 0)
                edi  = result.get('ediciones_barridas', 0)
                part = result.get('participaciones_upsert', 0)
                clis = result.get('clientes_barridos', 0)
                errs = result.get('errores_por_cliente', 0)
                log.info(f"manager={m['id_manager']} ({m.get('nombre')}): "
                         f'{circ} circuitos, {edi} ediciones, '
                         f'{part} participaciones upsert '
                         f'(clientes barridos={clis}, errores={errs})')
                total_part += part
            else:
                log.warning(f"manager={m['id_manager']}: {result}")
        except Exception as e:
            log.exception(f"manager={m['id_manager']}: {e}")

    log.info(f'TOTAL: {total_part} participaciones upsert en esta pasada')
    return 0


if __name__ == '__main__':
    sys.exit(main())
