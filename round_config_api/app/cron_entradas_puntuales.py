"""Cron de detección de entradas puntuales.

Para cada alta activa en una cuota de entrada puntual, busca las reservas
CONFIRMADAS del cliente en las actividades de esa cuota (NoofitPro) e inserta
una fila en `entrada_puntual_evento` por cada reserva nueva (idempotente vía
UNIQUE cliente+sala+fecha).

  - modo por_entrada → la fila queda 'pendiente' y aparece en el banner de
    "cobrar en recepción".
  - modo por_mes     → la fila queda 'pendiente' y se factura agregada al
    cierre de mes (POST /api/entradas-puntuales/emitir-mes).

Ejecutado por systemd timer `round_entradas_puntuales.timer`. También se puede
disparar a demanda desde POST /api/entradas-puntuales/detectar.

Itera el manager + todos sus trainers con credenciales en `trainer_noofit_creds`
para obtener una vista completa de las reservas (cada tenant en NoofitPro ve
solo lo asociado a su login). Las reservas duplicadas (mismo cliente+sala+fecha)
se deduplican por la UNIQUE constraint de la tabla `entrada_puntual_evento`.
"""
import logging
from datetime import date, timedelta

from .db import get_conn
from . import noofit_client as nc

log = logging.getLogger(__name__)


def _credenciales_manager_y_trainers(id_manager):
    """Devuelve [(label, email, pwd)] con el manager parent + cada trainer
    activo del manager que tenga credenciales."""
    out = []
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT noofit_email, noofit_password FROM manager_config
                        WHERE id_manager=%s AND activo=TRUE""", (str(id_manager),))
        m = cur.fetchone()
        if m:
            out.append(('manager', m['noofit_email'], m['noofit_password']))
        cur.execute("""SELECT id_trainer, noofit_email, noofit_password
                         FROM trainer_noofit_creds
                        WHERE id_manager=%s AND activo=TRUE""", (str(id_manager),))
        for r in cur.fetchall():
            out.append((f'trainer:{r["id_trainer"]}',
                        r['noofit_email'], r['noofit_password']))
    return out


def detectar_entradas_manager(id_manager, dias_atras=7):
    """Detecta reservas confirmadas e inserta eventos para un manager.
    Devuelve el nº de eventos nuevos insertados."""
    id_manager = str(id_manager)
    # 1) Altas activas de entrada puntual de este manager
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_trainer, cliente_idnoofit, cliente_nombre, cuota_codigo,
                   actividades_idnoofit, modo, precio_entrada
              FROM entrada_puntual_alta
             WHERE id_manager=%s AND activo=TRUE
        """, (id_manager,))
        altas = cur.fetchall()
    if not altas:
        return 0

    # 2) Reservas confirmadas: iterar manager + cada trainer del manager con
    #    credenciales propias, deduplicar por (sala_id, fecha, cliente_id).
    hoy = date.today()
    desde = (hoy - timedelta(days=dias_atras)).isoformat() + 'T00:00:00+02:00'
    hasta = (hoy + timedelta(days=1)).isoformat() + 'T00:00:00+02:00'

    reservas_dedup = {}  # (sala_id, fecha, cliente_id) → reserva
    for label, email, pwd in _credenciales_manager_y_trainers(id_manager):
        try:
            rs = nc.get_reservas_confirmadas_with_creds(desde, hasta, email, pwd) or []
        except Exception as e:
            log.warning(f'manager={id_manager} {label}: get_reservas '
                        f'falló: {e}')
            continue
        log.info(f'  manager={id_manager} {label}: {len(rs)} reservas')
        for r in rs:
            k = (r.get('sala_id'), r.get('fecha'), r.get('cliente_id'))
            if k not in reservas_dedup:
                reservas_dedup[k] = r
    reservas = list(reservas_dedup.values())
    log.info(f'entradas_puntuales manager={id_manager} altas={len(altas)} '
             f'reservas_rango={len(reservas)} (deduplicadas)')

    # Index reservas por cliente_id
    por_cliente = {}
    for r in reservas:
        por_cliente.setdefault(r['cliente_id'], []).append(r)

    nuevos = 0
    with get_conn() as conn, conn.cursor() as cur:
        for alta in altas:
            cid = str(alta['cliente_idnoofit'])
            acts = set(alta['actividades_idnoofit'] or [])
            for r in por_cliente.get(cid, []):
                # Filtrar por las actividades de la cuota (si la cuota define
                # actividades). Si no define ninguna, contamos todas.
                if acts:
                    try:
                        if int(r.get('actividad_id')) not in acts:
                            continue
                    except (TypeError, ValueError):
                        continue
                if not r.get('fecha') or not r.get('sala_id'):
                    continue
                mes = r['fecha'][:7]
                cur.execute("""
                    INSERT INTO entrada_puntual_evento
                      (id_manager, id_trainer, alta_id, cliente_idnoofit, cliente_nombre,
                       cuota_codigo, actividad_nombre, sala_id, fecha_clase, hora_clase,
                       modo, precio_entrada, estado, mes)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pendiente',%s)
                    ON CONFLICT (id_manager, cliente_idnoofit, sala_id, fecha_clase)
                      DO NOTHING
                """, (id_manager, alta['id_trainer'], alta['id'], cid,
                      alta['cliente_nombre'], alta['cuota_codigo'],
                      r.get('actividad_nombre'), r['sala_id'], r['fecha'], r.get('hora'),
                      alta['modo'], alta['precio_entrada'], mes))
                if cur.rowcount:
                    nuevos += 1
    log.info(f'entradas_puntuales manager={id_manager} nuevos={nuevos}')
    return nuevos


def main():
    """Itera los managers que tienen altas de entrada puntual activas."""
    logging.basicConfig(level=logging.INFO)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT id_manager FROM entrada_puntual_alta WHERE activo=TRUE
        """)
        managers = [r['id_manager'] for r in cur.fetchall()]
    total = 0
    for m in managers:
        try:
            total += detectar_entradas_manager(m)
        except Exception:
            log.exception(f'detectar entradas manager={m}')
    log.info(f'entradas_puntuales total_nuevos={total}')


if __name__ == '__main__':
    main()
