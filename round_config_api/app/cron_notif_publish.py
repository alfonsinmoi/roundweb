"""Cron cada 5 min: dispara notif_envio con programada_at <= NOW() y estado=pendiente.

Para cada envío:
  - Si scope='broadcast' → mandar a OneSignal con segments=['Subscribed Users']
  - Si scope='subscription' → player_ids del scope_ref
  - Resto → external_user_ids = lista de cliente_idnoofit en notif_destinatario
  - Marca estado='enviada' + onesignal_id, o 'fallida' + error

Ejecutado vía systemd timer round_notif_publish.timer cada 5 min.
"""
import json
import logging
from datetime import datetime, timezone
from .db import get_conn
from .onesignal_client import get_client as get_onesignal, OneSignalError

log = logging.getLogger(__name__)


def _disparar_envio(envio: dict) -> dict:
    """Manda un envío individual y devuelve {ok, onesignal_id, error}."""
    cli = get_onesignal()
    kwargs = {
        'titulo': envio['titulo'],
        'cuerpo': envio.get('cuerpo') or '',
        'cuerpo_html': envio.get('cuerpo_html') or None,
        'url': envio.get('url') or None,
        'data': {
            'seccion': envio['seccion'],
            'tipo': envio['tipo'],
            'origen': envio.get('origen') or 'manual',
            'origen_ref': envio.get('origen_ref') or '',
            'envio_id': envio['id'],
        },
    }
    scope = envio.get('scope')
    if scope == 'broadcast':
        kwargs['segments'] = ['Subscribed Users']
    elif scope == 'subscription':
        sr = envio.get('scope_ref') or {}
        if isinstance(sr, str):
            try: sr = json.loads(sr)
            except: sr = {}
        kwargs['player_ids'] = sr.get('subscription_ids', [])
    else:
        # cliente / lista / cluster: leer destinatarios de BD
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cliente_idnoofit FROM notif_destinatario
                 WHERE envio_id = %s
            """, (envio['id'],))
            kwargs['external_user_ids'] = [r['cliente_idnoofit'] for r in cur.fetchall()]
    try:
        r = cli.enviar(**kwargs)
        return {'ok': True, 'onesignal_id': r.get('id'), 'error': None}
    except OneSignalError as e:
        return {'ok': False, 'onesignal_id': None, 'error': str(e)[:500]}
    except Exception as e:
        return {'ok': False, 'onesignal_id': None, 'error': f'unexpected: {str(e)[:480]}'}


def procesar_pendientes(limit: int = 100) -> dict:
    """Busca envíos pendientes con programada_at vencida y los dispara."""
    enviados = 0
    fallidos = 0
    procesados = []
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, id_manager, id_trainer, seccion, tipo, scope, scope_ref,
                       titulo, cuerpo, cuerpo_html, url, origen, origen_ref,
                       programada_at
                  FROM notif_envio
                 WHERE estado = 'pendiente'
                   AND programada_at IS NOT NULL
                   AND programada_at <= NOW()
                 ORDER BY programada_at ASC
                 LIMIT %s
            """, (limit,))
            envios = cur.fetchall()
        log.info(f'cron_notif_publish: {len(envios)} pendientes vencidos')
        for e in envios:
            r = _disparar_envio(dict(e))
            estado_nuevo = 'enviada' if r['ok'] else 'fallida'
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    UPDATE notif_envio
                       SET estado = %s,
                           onesignal_id = COALESCE(%s, onesignal_id),
                           error = %s,
                           fecha_envio = COALESCE(fecha_envio, NOW())
                     WHERE id = %s
                """, (estado_nuevo, r['onesignal_id'], r['error'], e['id']))
            if r['ok']:
                enviados += 1
            else:
                fallidos += 1
            procesados.append({'id': e['id'], 'estado': estado_nuevo,
                               'onesignal_id': r['onesignal_id']})
    except Exception as e:
        log.exception('procesar_pendientes')
        return {'ok': False, 'error': str(e)}
    return {'ok': True, 'enviados': enviados, 'fallidos': fallidos,
            'total': len(procesados), 'procesados': procesados}


if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    r = procesar_pendientes()
    print(r)
