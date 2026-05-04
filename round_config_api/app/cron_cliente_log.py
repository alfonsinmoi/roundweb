"""Tarea programada DIARIA: detecta cambios de estado de clientes NoofitPro.

Para cada cliente que devuelve `nc.get_clientes()`:
  1. Calcula su estado actual: 'activo' (enabled=True) o 'archivado' (enabled=False)
  2. Lee la última entrada en `cliente_estado_log` para ese cliente_id
  3. Si NO hay entrada previa → INSERT inicial (estado_anterior=NULL)
  4. Si la última entrada tiene estado_nuevo distinto al actual → INSERT entrada de transición
  5. Si igual → no hace nada (no contamina el log)

Diseñado para ejecutarse 1× al día. Se ejecuta sin --dry-run.
Ejecutado vía systemd timer round_cliente_log.timer.
"""
import os, logging
from .db import get_conn
from . import noofit_client as nc

log = logging.getLogger(__name__)


def _estado_de(cliente):
    return 'activo' if cliente.get('enabled') is not False else 'archivado'


def sincronizar_log(id_manager=None):
    """Compara clientes vivos con su última entrada de log y registra cambios."""
    if id_manager is None:
        id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '17677')

    try:
        clientes = nc.get_clientes() or []
    except Exception as e:
        log.exception('sincronizar_log: get_clientes')
        return {'ok': False, 'error': str(e)}

    log.info(f'sincronizar_log manager={id_manager} clientes_total={len(clientes)}')
    inicial, cambios, sin_cambio = 0, 0, 0

    with get_conn() as conn, conn.cursor() as cur:
        for c in clientes:
            cli_id = c.get('id')
            if not cli_id: continue
            estado_actual = _estado_de(c)

            # Última entry para este cliente
            cur.execute("""SELECT estado_nuevo FROM cliente_estado_log
                            WHERE cliente_id=%s
                            ORDER BY detected_at DESC LIMIT 1""", (cli_id,))
            row = cur.fetchone()
            estado_prev = row['estado_nuevo'] if row else None

            if estado_prev is None:
                # Primera observación — entry inicial
                _insertar(cur, id_manager, c, estado_actual, None)
                inicial += 1
            elif estado_prev != estado_actual:
                # Cambio detectado — entry de transición
                _insertar(cur, id_manager, c, estado_actual, estado_prev)
                cambios += 1
                log.info(f'cambio cliente {cli_id} ({c.get("name","")} {c.get("surname","")}): '
                         f'{estado_prev} → {estado_actual}')
            else:
                sin_cambio += 1

    log.info(f'sincronizar_log fin: iniciales={inicial} cambios={cambios} sin_cambio={sin_cambio}')
    return {'ok': True, 'inicial': inicial, 'cambios': cambios,
            'sin_cambio': sin_cambio, 'total': len(clientes)}


def _insertar(cur, id_manager, c, estado_nuevo, estado_anterior):
    full_name = f"{c.get('name','') or ''} {c.get('surname','') or ''}".strip()
    cur.execute("""INSERT INTO cliente_estado_log
                     (id_manager, cliente_id, cliente_nombre, cliente_email,
                      cliente_dni, estado_nuevo, estado_anterior,
                      motivo_archivado, id_trainer)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (str(id_manager), c['id'], full_name or None,
                 c.get('email'), c.get('dni'),
                 estado_nuevo, estado_anterior,
                 c.get('motivoArchivado') if estado_nuevo == 'archivado' else None,
                 str(c.get('idTrainer') or '') or None))


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    r = sincronizar_log()
    print(r)
