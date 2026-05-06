"""Cron diario: detecta recibos en efectivo impagados y notifica al cliente.

Para cada manager activo:
  Para cada trainer del manager:
    - Carga `notif_config` (manager,trainer) o el default del manager.
    - Si hoy.day != cfg.dia_envio_impago_efectivo → skip.
    - Si auto_impago_efectivo == False → skip.
    - Buscar recibos efectivo en Odoo emitidos este mes y aún no pagados.
    - Para cada recibo: enviar_notificacion(seccion='cobros',
                                            tipo='impago_efectivo',
                                            audience={'tipo':'cliente','ref':cliente_id},
                                            origen='cron_impago',
                                            origen_ref=f'recibo:{id}')

Idempotencia: comprobamos si ya existe un envío con
   origen='cron_impago' + origen_ref=f'recibo:{id}' en los últimos 30 días.
   Si existe, no re-enviamos (evita spam si el cron corre 2 veces).

Ejecutar:
  python -m app.cron_notif_impago
o vía systemd timer round_notif_impago.timer (configurable, recomendado diario 09:00).
"""
import logging
import os
from datetime import date, datetime
from .db import get_conn, iter_active_managers
from .notif_sender import enviar_notificacion

log = logging.getLogger(__name__)


def _config_for(id_manager: str, id_trainer: str | None) -> dict:
    """Devuelve la config del trainer o, si no la tiene, la del manager;
    si tampoco, defaults."""
    with get_conn() as conn, conn.cursor() as cur:
        # 1) Específica per trainer
        if id_trainer:
            cur.execute("""
                SELECT * FROM notif_config
                 WHERE id_manager=%s AND id_trainer=%s
            """, (id_manager, id_trainer))
            row = cur.fetchone()
            if row:
                return row
        # 2) Manager-wide
        cur.execute("""
            SELECT * FROM notif_config
             WHERE id_manager=%s AND id_trainer IS NULL
        """, (id_manager,))
        row = cur.fetchone()
        if row:
            return row
    # 3) Defaults
    return {
        'id_manager': id_manager,
        'id_trainer': id_trainer,
        'dia_envio_impago_efectivo': 5,
        'auto_impago_efectivo': True,
        'auto_devolucion': True,
        'auto_enlace_pago': True,
        'auto_pago_alta': True,
        'plantillas': {},
    }


def _ya_notificado(id_manager: str, recibo_id) -> bool:
    """Anti-duplicado: ya hemos avisado de este recibo en los últimos 30 días?"""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM notif_envio
                 WHERE id_manager=%s
                   AND origen='cron_impago'
                   AND origen_ref=%s
                   AND created_at >= NOW() - INTERVAL '30 days'
                 LIMIT 1
            """, (id_manager, f'recibo:{recibo_id}'))
            return cur.fetchone() is not None
    except Exception:
        return False


def _buscar_recibos_impagos_efectivo(id_manager: str, id_trainer: str | None):
    """Lista recibos emitidos en el mes corriente, en efectivo, no pagados.

    Devuelve: lista de dicts {recibo_id, cliente_idnoofit, importe,
                              fecha_emision, centro, recibo_ref}
    """
    try:
        from .odoo_cuotas import get_cuotas
        oc = get_cuotas()
        mes_str = date.today().strftime('%Y-%m')
        recibos = oc.list_recibos_filtrado(mes_str=mes_str, estado='not_paid')
        log.info(f'cron_impago: {len(recibos)} recibos not_paid en {mes_str}')
    except Exception as e:
        log.exception('cron_impago: list_recibos_filtrado')
        return []
    out = []
    for r in recibos:
        # Solo efectivo (no SEPA / tokenización / link)
        if (r.get('forma_pago') or '').lower() != 'efectivo':
            continue
        cliente_idnoofit = (r.get('partner_idnoofit') or '').strip()
        if not cliente_idnoofit:
            continue  # sin id_noofit no podemos notificar
        out.append({
            'recibo_id': r['id'],
            'cliente_idnoofit': cliente_idnoofit,
            'importe': float(r.get('amount_total') or 0),
            'fecha_emision': str(r.get('invoice_date') or ''),
            'recibo_ref': r.get('name') or '',
            'centro': '',  # TODO: derivar del trainer si quieres mostrarlo en el cuerpo
        })
    return out


def procesar_impagos(id_manager: str = None) -> dict:
    """Procesa impagos de un manager (o de todos si None)."""
    if id_manager is not None:
        return _procesar_one(id_manager)
    out = {}
    for m in iter_active_managers():
        out[m['id_manager']] = _procesar_one(m['id_manager'])
    return {'ok': True, 'managers': out}


def _procesar_one(id_manager: str) -> dict:
    """Lógica para un manager. Itera sus trainers (o solo manager-wide)."""
    today = date.today()
    enviados = 0
    skipped_dia = 0
    skipped_off = 0
    skipped_dup = 0
    fallidos = 0

    # Para cada (manager, trainer): sacamos config y procesamos
    # En el escenario actual de Round (1 manager con varios trainers) iteramos
    # sobre trainers definidos en `centro_contacto`.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT id_trainer FROM centro_contacto
             WHERE id_manager=%s AND id_trainer IS NOT NULL
        """, (id_manager,))
        trainer_ids = [r['id_trainer'] for r in cur.fetchall()] or [None]

    for trainer_id in trainer_ids:
        cfg = _config_for(id_manager, trainer_id)
        if cfg.get('dia_envio_impago_efectivo', 0) != today.day:
            skipped_dia += 1
            continue
        if not cfg.get('auto_impago_efectivo', True):
            skipped_off += 1
            continue
        recibos = _buscar_recibos_impagos_efectivo(id_manager, trainer_id)
        for r in recibos:
            recibo_id = r['recibo_id']
            if _ya_notificado(id_manager, recibo_id):
                skipped_dup += 1
                continue
            res = enviar_notificacion(
                id_manager=id_manager,
                id_trainer=trainer_id,
                seccion='cobros',
                tipo='impago_efectivo',
                titulo=None,  # usa plantilla
                cuerpo=None,
                audience={'tipo': 'cliente', 'ref': r['cliente_idnoofit']},
                plantilla_vars={
                    'importe': f"{r.get('importe', 0):.2f}",
                    'fecha_emision': r.get('fecha_emision', ''),
                    'centro': r.get('centro', ''),
                },
                origen='cron_impago',
                origen_ref=f'recibo:{recibo_id}',
            )
            if res.get('ok'):
                enviados += 1
            else:
                fallidos += 1
                log.warning(f'cron_impago manager={id_manager} trainer={trainer_id} recibo={recibo_id} → {res}')

    return {
        'ok': True, 'manager': id_manager, 'fecha': today.isoformat(),
        'enviados': enviados, 'fallidos': fallidos,
        'skipped_dia_no_coincide': skipped_dia,
        'skipped_auto_desactivado': skipped_off,
        'skipped_duplicado': skipped_dup,
    }


if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    r = procesar_impagos()
    print(r)
