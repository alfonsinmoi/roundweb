"""Tarea programada: enviar recordatorios de prueba 24h antes.

Para cada `slot_reserva` confirmada cuya `fecha_clase` cae entre
`now() + 22h` y `now() + 26h` y que NO tiene `recordatorio_at` puesto:
  1. Renderiza la plantilla `slot_recordatorio_lead` con los datos del lead/centro
  2. Envía el email vía email_sender (con override Gmail del centro si lo tiene)
  3. Marca `recordatorio_at = NOW()` para no enviar dos veces

Diseñado para ejecutarse cada 30 min via systemd timer.
"""
import logging
from datetime import datetime, timezone
from .db import get_conn
from .email_templates import trigger as trigger_email

log = logging.getLogger(__name__)


def enviar_recordatorios():
    """Devuelve número de recordatorios enviados con éxito."""
    n_ok, n_fail = 0, 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT r.*, c.nombre_centro AS centro_name, c.email AS centro_email,
                   c.telefono AS centro_telefono, c.slug AS centro_slug,
                   c.ciudad AS centro_ciudad
              FROM slot_reserva r
              LEFT JOIN centro_contacto c
                ON c.id_manager = r.id_manager AND c.id_trainer = r.id_trainer
             WHERE r.estado = 'confirmada'
               AND r.recordatorio_at IS NULL
               AND r.fecha_clase BETWEEN NOW() + INTERVAL '22 hours'
                                     AND NOW() + INTERVAL '26 hours'
             ORDER BY r.fecha_clase ASC LIMIT 100
        """)
        rows = cur.fetchall()
    if not rows:
        return 0
    log.info(f'enviar_recordatorios: {len(rows)} reservas en ventana 24h±2h')

    for r in rows:
        try:
            fecha = r.get('fecha_clase')
            if fecha and fecha.tzinfo is None:
                fecha = fecha.replace(tzinfo=timezone.utc)
            ctx = {
                'lead_name':     f"{r.get('nombre_lead','')} {r.get('apellidos_lead','')}".strip(),
                'lead_email':    r.get('email_lead'),
                'lead_phone':    r.get('telefono_lead'),
                'lead_id':       str(r.get('odoo_lead_id') or ''),
                'centro_name':   r.get('centro_name') or '',
                'centro_email':  r.get('centro_email') or '',
                'centro_slug':   r.get('centro_slug') or '',
                'centro_ciudad': r.get('centro_ciudad') or '',
                'trainer_name':  r.get('centro_name') or '',
                'trainer_phone': r.get('centro_telefono') or '',
                'trainer_email': r.get('centro_email') or '',
                'slot_nombre':   r.get('nombre_clase') or '',
                'slot_fecha':    fecha.astimezone().strftime('%A %d/%m/%Y') if fecha else '',
                'slot_hora':     fecha.astimezone().strftime('%H:%M') if fecha else '',
                'id_trainer':    r.get('id_trainer') or '',
                'manager_email': '',
            }
            results = trigger_email('slot_recordatorio_lead', r['id_manager'], ctx)
            sent = any(ok for _, ok in results)
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("UPDATE slot_reserva SET recordatorio_at=NOW() WHERE id=%s",
                            (r['id'],))
            if sent:
                n_ok += 1
                log.info(f'recordatorio reserva-{r["id"]} enviado a {r.get("email_lead")}')
            else:
                n_fail += 1
                log.warning(f'recordatorio reserva-{r["id"]} no enviado (sin plantilla activa o error)')
        except Exception as e:
            n_fail += 1
            log.exception(f'enviar_recordatorios id={r["id"]}')
    return n_ok


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    n = enviar_recordatorios()
    print(f'recordatorios enviados: {n}')
