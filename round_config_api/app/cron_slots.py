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


def _creds_para_slot(id_manager, id_trainer):
    """Devuelve (email, password) priorizando el trainer (más específico) y
    cayendo al manager parent si no hay credenciales del trainer."""
    with get_conn() as conn, conn.cursor() as cur:
        if id_trainer:
            cur.execute("""SELECT noofit_email, noofit_password
                             FROM trainer_noofit_creds
                            WHERE id_manager=%s AND id_trainer=%s AND activo=TRUE
                            LIMIT 1""", (str(id_manager), str(id_trainer)))
            t = cur.fetchone()
            if t:
                return t['noofit_email'], t['noofit_password']
        cur.execute("""SELECT noofit_email, noofit_password
                         FROM manager_config
                        WHERE id_manager=%s AND activo=TRUE LIMIT 1""",
                    (str(id_manager),))
        m = cur.fetchone()
        return (m['noofit_email'], m['noofit_password']) if m else (None, None)


def liberar_expiradas():
    """Devuelve número de reservas liberadas. Para cancelar en NoofitPro
    autentica como el trainer del slot (o el manager si no hay creds de
    trainer), nunca con un token global default."""
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
                email, pwd = _creds_para_slot(r.get('id_manager'), r.get('id_trainer'))
                if not email:
                    log.warning(f'slot {r["id"]}: sin credenciales para '
                                f'manager={r.get("id_manager")} '
                                f'trainer={r.get("id_trainer")}')
                else:
                    try:
                        nc.cancelar_reserva_with_creds(
                            r['noofit_sala_id'], r['noofit_cliente_id'],
                            email, pwd)
                    except Exception as e:
                        log.warning(f'cancelar reserva sala={r["noofit_sala_id"]} '
                                    f'cliente={r["noofit_cliente_id"]} '
                                    f'auth={email}: {e}')
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
