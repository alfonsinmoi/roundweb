"""Cron: publica posts sociales programados cuya hora ya llegó.

Cada 5 min busca `social_post` con:
  - estado = 'pendiente'
  - schedule_at <= now() + 1 min (margen de holgura)
  - attempts < 3

Para cada uno:
  1. Marca estado='publicando' (atomic, evita concurrencia)
  2. Llama meta_client.publicar_post()
  3. Si OK → estado='publicado', meta_post_id, meta_permalink, publicado_at
  4. Si error → attempts++, error_msg. Si attempts>=3 → estado='fallido'.

Diseñado para ejecutarse cada 5 min via systemd timer.
Facebook nativo soporta scheduled_publish_time (lo programa Meta), pero
para Instagram NO existe scheduling nativo, por eso el cron lo dispara.
"""
import logging
from datetime import datetime, timezone
from .db import get_conn
from . import meta_client as mc

log = logging.getLogger(__name__)


def publicar_pendientes():
    """Publica los posts pendientes que toca. Devuelve {publicados, fallidos, intentos}."""
    publicados, fallidos, intentos = 0, 0, 0
    with get_conn() as conn, conn.cursor() as cur:
        # Atomic: marca como 'publicando' los que vamos a procesar
        # Reclama también los 'publicando' atascados >15 min (TTL): si un worker
        # crashea entre el claim y el resultado, el post quedaría 'publicando'
        # para siempre. Patrón del lock POS (auditoría #7). attempts<3 corta el bucle.
        cur.execute("""
            UPDATE social_post SET estado='publicando', attempts=attempts+1
             WHERE id IN (
               SELECT id FROM social_post
                WHERE ((estado='pendiente' AND schedule_at <= NOW() + INTERVAL '1 minute')
                       OR (estado='publicando' AND updated_at < NOW() - INTERVAL '15 minutes'))
                  AND attempts < 3
                ORDER BY schedule_at ASC
                LIMIT 20
                FOR UPDATE SKIP LOCKED
             )
            RETURNING id
        """)
        ids = [r['id'] for r in (cur.fetchall() or [])]

    if not ids:
        return {'publicados': 0, 'fallidos': 0, 'intentos': 0}

    log.info(f'cron_social_publish: procesando {len(ids)} posts')

    for post_id in ids:
        intentos += 1
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""SELECT p.*, c.fb_page_id, c.ig_business_account_id,
                                       c.access_token, c.expires_at,
                                       c.fb_page_name, c.ig_username
                                  FROM social_post p
                                  JOIN social_cuenta c ON c.id = p.social_cuenta_id
                                 WHERE p.id = %s""", (post_id,))
                row = cur.fetchone()
            if not row:
                continue

            # Token caducado? → avisar al admin (incidencia idempotente por cuenta)
            # para que reconecte la cuenta Meta; el post no se puede publicar.
            if row.get('expires_at') and row['expires_at'] < datetime.now(timezone.utc):
                _incidencia_cuenta_meta(row, 'access_token caducado')
                _marcar_fallido(post_id, 'access_token caducado · renueva la cuenta Meta')
                fallidos += 1
                continue
            if not row.get('access_token'):
                _incidencia_cuenta_meta(row, 'sin access_token configurado')
                _marcar_fallido(post_id, 'sin access_token configurado')
                fallidos += 1
                continue

            cuenta = {
                'access_token':           row['access_token'],
                'fb_page_id':             row.get('fb_page_id'),
                'ig_business_account_id': row.get('ig_business_account_id'),
            }
            post = {
                'tipo':       row['tipo'],
                'media_urls': row.get('media_urls') or [],
                'caption':    row.get('caption') or '',
            }

            meta_post_id, permalink = mc.publicar_post(cuenta, post)

            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""UPDATE social_post SET
                                  estado='publicado',
                                  publicado_at=NOW(),
                                  meta_post_id=%s,
                                  meta_permalink=%s,
                                  error_msg=NULL
                                WHERE id=%s""",
                            (meta_post_id, permalink, post_id))
            publicados += 1
            log.info(f'social_post {post_id} publicado: {meta_post_id} {permalink}')
        except Exception as e:
            log.exception(f'cron_social_publish post {post_id}')
            _marcar_fallido(post_id, str(e)[:500])
            fallidos += 1

    return {'publicados': publicados, 'fallidos': fallidos, 'intentos': intentos}


def _incidencia_cuenta_meta(row, motivo):
    """Avisa al admin (incidencia_admin 'warning') de que una cuenta Meta no
    puede publicar (token caducado / sin token) → hay que reconectarla.
    Idempotente por cuenta: no crea una nueva si ya hay una sin leer para esa
    social_cuenta (auditoría #31). Antes el post fallaba en silencio."""
    try:
        cuenta_id = row.get('social_cuenta_id')
        idm = row.get('id_manager')
        if not cuenta_id or not idm:
            return
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT 1 FROM incidencia_admin
                            WHERE tipo='meta_token' AND entidad='social_cuenta'
                              AND entidad_id=%s AND leida_at IS NULL LIMIT 1""",
                        (cuenta_id,))
            if cur.fetchone():
                return
        nombre = row.get('fb_page_name') or row.get('ig_username') or f'cuenta {cuenta_id}'
        from .incidencias import crear_incidencia_admin
        crear_incidencia_admin(
            id_manager=idm, tipo='meta_token', entidad='social_cuenta',
            entidad_id=cuenta_id, severidad='warning',
            titulo=f'Cuenta Meta «{nombre}» necesita reconexión',
            mensaje=(f'No se pueden publicar posts programados: {motivo}. '
                     f'Reconecta la cuenta en Configuración → Redes sociales. '
                     f'Los posts pendientes quedarán fallidos hasta entonces.'),
            created_by='cron_social_publish')
    except Exception as e:
        log.warning(f'_incidencia_cuenta_meta: {e}')


def _marcar_fallido(post_id, error_msg):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            # Si attempts >= 3 → 'fallido' definitivo, si no → 'pendiente' para reintento
            cur.execute("""UPDATE social_post SET
                              estado = CASE WHEN attempts >= 3 THEN 'fallido' ELSE 'pendiente' END,
                              error_msg = %s
                            WHERE id=%s""", (error_msg, post_id))
    except Exception as e:
        log.exception(f'_marcar_fallido {post_id}')


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    r = publicar_pendientes()
    print(r)
