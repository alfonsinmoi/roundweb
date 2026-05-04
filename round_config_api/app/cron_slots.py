"""Tarea programada: liberar reservas de slot expiradas.

Se ejecuta cada 5 minutos (vía systemd timer o cron del sistema). Para cada
reserva en estado 'pendiente' cuya `expira_at` ya pasó:
  1. Cancela la plaza en NoofitPro (userRemoveSala)
  2. Marca la fila como 'expirada'
  3. (Opcional) Envía email "tu plaza ha caducado"

El cliente NoofitPro NO se borra: queda como contacto para que el trainer
pueda hacer follow-up. Si el lead vuelve a reservar, lo reutilizamos.
"""
import logging
from datetime import datetime, timezone
from .db import get_conn
from . import noofit_client as nc

log = logging.getLogger(__name__)


def liberar_expiradas():
    """Devuelve número de reservas liberadas."""
    n = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT * FROM slot_reserva
             WHERE estado='pendiente' AND expira_at < NOW()
             ORDER BY expira_at ASC LIMIT 50
        """)
        rows = cur.fetchall()
    if not rows: return 0

    for r in rows:
        try:
            if r.get('noofit_sala_id') and r.get('noofit_cliente_id'):
                try:
                    nc.cancelar_reserva(r['noofit_sala_id'], r['noofit_cliente_id'])
                except Exception as e:
                    log.warning(f'cancelar reserva sala={r["noofit_sala_id"]} cliente={r["noofit_cliente_id"]}: {e}')
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("UPDATE slot_reserva SET estado='expirada' WHERE id=%s",
                            (r['id'],))
            n += 1
            log.info(f'reserva {r["id"]} expirada (cliente={r.get("noofit_cliente_id")} sala={r.get("noofit_sala_id")})')
        except Exception as e:
            log.exception(f'liberar_expiradas id={r["id"]}')
    return n


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    n = liberar_expiradas()
    print(f'liberadas: {n}')
