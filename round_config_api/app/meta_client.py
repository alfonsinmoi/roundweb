"""Cliente Meta Graph API para publicación programada en Instagram y Facebook.

Soporta:
  - Instagram (Business/Creator account): foto, carrusel, Reel, Story
  - Facebook Page: post de texto, imagen, link

Requisitos del lado Meta (gestiona el manager):
  - Instagram Business o Creator vinculada a una Página de Facebook
  - App Meta con permisos `instagram_content_publish`, `pages_read_engagement`,
    `pages_manage_posts`, `business_management`
  - Page Access Token de larga duración (60 días)
  - App Review aprobado por Meta

API doc: https://developers.facebook.com/docs/instagram-platform/content-publishing
"""
import logging, time, requests

log = logging.getLogger(__name__)

GRAPH_VERSION = 'v21.0'
GRAPH_BASE = f'https://graph.facebook.com/{GRAPH_VERSION}'


class MetaError(Exception):
    """Error específico de la API de Meta."""
    pass


def _post(path, access_token, payload=None, files=None):
    url = f'{GRAPH_BASE}{path}'
    payload = dict(payload or {})
    payload['access_token'] = access_token
    r = requests.post(url, data=payload, files=files, timeout=60)
    if r.status_code >= 300:
        try: err = r.json().get('error', {})
        except Exception: err = {'message': r.text[:200]}
        raise MetaError(f'{r.status_code}: {err.get("message", "?")} '
                        f'(type={err.get("type")} code={err.get("code")})')
    return r.json()


def _get(path, access_token, params=None):
    url = f'{GRAPH_BASE}{path}'
    p = dict(params or {})
    p['access_token'] = access_token
    r = requests.get(url, params=p, timeout=30)
    if r.status_code >= 300:
        try: err = r.json().get('error', {})
        except Exception: err = {'message': r.text[:200]}
        raise MetaError(f'{r.status_code}: {err.get("message", "?")}')
    return r.json()


# ── INSTAGRAM ────────────────────────────────────────────────────────────────

def ig_publicar_imagen(ig_business_id, access_token, image_url, caption='',
                        location_id=None, user_tags=None):
    """Publica una imagen en Instagram en 2 pasos: create container → publish.
    Devuelve (media_id, permalink)."""
    # Paso 1: crear container
    payload = {'image_url': image_url, 'caption': caption}
    if location_id: payload['location_id'] = location_id
    if user_tags:   payload['user_tags'] = user_tags
    res = _post(f'/{ig_business_id}/media', access_token, payload)
    container_id = res.get('id')
    if not container_id: raise MetaError('no container_id')

    # Paso 2: publicar el container
    return _ig_publish_container(ig_business_id, access_token, container_id)


def ig_publicar_carrusel(ig_business_id, access_token, image_urls, caption=''):
    """Carrusel de hasta 10 imágenes. Cada imagen → container hijo IS_CAROUSEL_ITEM,
    luego un container padre que los agrupa, luego publish."""
    if len(image_urls) < 2 or len(image_urls) > 10:
        raise MetaError('carrusel requiere 2-10 imágenes')

    # Containers hijos
    children = []
    for url in image_urls:
        res = _post(f'/{ig_business_id}/media', access_token,
                    {'image_url': url, 'is_carousel_item': 'true'})
        children.append(res.get('id'))

    # Container padre
    res = _post(f'/{ig_business_id}/media', access_token, {
        'media_type': 'CAROUSEL',
        'caption': caption,
        'children': ','.join(children),
    })
    container_id = res.get('id')
    return _ig_publish_container(ig_business_id, access_token, container_id)


def ig_publicar_reel(ig_business_id, access_token, video_url, caption='',
                      cover_url=None):
    """Reel = vídeo MP4 H.264, máx 90s, ratio 9:16 recomendado."""
    payload = {
        'media_type': 'REELS',
        'video_url': video_url,
        'caption': caption,
        'share_to_feed': 'true',
    }
    if cover_url: payload['cover_url'] = cover_url
    res = _post(f'/{ig_business_id}/media', access_token, payload)
    container_id = res.get('id')

    # Reels necesitan tiempo de procesado. Pollear status hasta FINISHED
    if not _wait_container_ready(container_id, access_token):
        raise MetaError('container Reel no terminó de procesarse en 5 min')

    return _ig_publish_container(ig_business_id, access_token, container_id)


def ig_publicar_story(ig_business_id, access_token, image_url=None, video_url=None):
    """Story (24h). Se especifica image_url o video_url, no ambos."""
    payload = {'media_type': 'STORIES'}
    if image_url: payload['image_url'] = image_url
    elif video_url: payload['video_url'] = video_url
    else: raise MetaError('story requiere image_url o video_url')
    res = _post(f'/{ig_business_id}/media', access_token, payload)
    container_id = res.get('id')
    if video_url:
        _wait_container_ready(container_id, access_token)
    return _ig_publish_container(ig_business_id, access_token, container_id)


def _ig_publish_container(ig_business_id, access_token, container_id):
    """Paso 2 final: publica el container creado."""
    res = _post(f'/{ig_business_id}/media_publish', access_token,
                {'creation_id': container_id})
    media_id = res.get('id')
    # Obtener permalink
    permalink = None
    try:
        info = _get(f'/{media_id}', access_token, {'fields': 'permalink'})
        permalink = info.get('permalink')
    except Exception: pass
    return media_id, permalink


def _wait_container_ready(container_id, access_token, max_wait_s=300, interval=5):
    """Para Reels/Stories de vídeo: el container tarda en procesarse."""
    waited = 0
    while waited < max_wait_s:
        info = _get(f'/{container_id}', access_token,
                    {'fields': 'status_code,status'})
        sc = info.get('status_code')
        if sc == 'FINISHED': return True
        if sc in ('ERROR', 'EXPIRED'): return False
        time.sleep(interval)
        waited += interval
    return False


# ── FACEBOOK PAGE ────────────────────────────────────────────────────────────

def fb_publicar_post(page_id, access_token, message='', link=None, image_urls=None,
                      scheduled_publish_time=None):
    """Publica en una Página de Facebook. Soporta scheduled_publish_time nativo
    (epoch seconds) — Facebook lo programa él mismo y aparece como "Scheduled".

    Si image_urls hay 1 → /photos, si hay varios → carrusel manual (no nativo).
    Si no hay imágenes y no hay link → text post."""
    if image_urls and len(image_urls) == 1:
        payload = {
            'url':     image_urls[0],
            'caption': message,
            'message': message,
            'published': 'false' if scheduled_publish_time else 'true',
        }
        if scheduled_publish_time:
            payload['scheduled_publish_time'] = scheduled_publish_time
        res = _post(f'/{page_id}/photos', access_token, payload)
        post_id = res.get('post_id') or res.get('id')
    else:
        payload = {
            'message': message,
            'published': 'false' if scheduled_publish_time else 'true',
        }
        if link: payload['link'] = link
        if scheduled_publish_time:
            payload['scheduled_publish_time'] = scheduled_publish_time
        res = _post(f'/{page_id}/feed', access_token, payload)
        post_id = res.get('id')
    permalink = None
    try:
        info = _get(f'/{post_id}', access_token, {'fields': 'permalink_url'})
        permalink = info.get('permalink_url')
    except Exception: pass
    return post_id, permalink


# ── HELPERS ──────────────────────────────────────────────────────────────────

def get_ig_account_info(ig_business_id, access_token):
    """Devuelve {username, name, profile_picture_url, followers_count}."""
    return _get(f'/{ig_business_id}', access_token, {
        'fields': 'username,name,profile_picture_url,followers_count,media_count'
    })


def get_fb_page_info(page_id, access_token):
    return _get(f'/{page_id}', access_token, {
        'fields': 'name,category,fan_count,picture'
    })


def renovar_token_pagina(short_token, app_id, app_secret):
    """Convierte un token de usuario corto en token de página de larga duración (60 días)."""
    r = requests.get(f'{GRAPH_BASE}/oauth/access_token', params={
        'grant_type': 'fb_exchange_token',
        'client_id':     app_id,
        'client_secret': app_secret,
        'fb_exchange_token': short_token,
    }, timeout=15)
    if r.status_code >= 300: raise MetaError(f'token exchange: {r.text[:200]}')
    return r.json().get('access_token')


# ── DISPATCH POR TIPO DE POST ────────────────────────────────────────────────

def publicar_post(cuenta, post):
    """Despacha la publicación según tipo. Devuelve (meta_post_id, permalink).
    cuenta: dict con ig_business_account_id, fb_page_id, access_token
    post:   dict con tipo, media_urls (list), caption
    """
    tipo = post.get('tipo')
    media = post.get('media_urls') or []
    caption = post.get('caption') or ''
    token = cuenta.get('access_token')
    if not token: raise MetaError('access_token no configurado')

    if tipo == 'image':
        if not media: raise MetaError('image requiere 1 media_url')
        return ig_publicar_imagen(cuenta['ig_business_account_id'], token,
                                   media[0], caption)
    elif tipo == 'carousel':
        return ig_publicar_carrusel(cuenta['ig_business_account_id'], token,
                                     media, caption)
    elif tipo == 'reel':
        if not media: raise MetaError('reel requiere video_url')
        return ig_publicar_reel(cuenta['ig_business_account_id'], token,
                                 media[0], caption)
    elif tipo == 'story':
        if not media: raise MetaError('story requiere media_url')
        url = media[0]
        if url.lower().endswith(('.mp4','.mov')):
            return ig_publicar_story(cuenta['ig_business_account_id'], token,
                                      video_url=url)
        else:
            return ig_publicar_story(cuenta['ig_business_account_id'], token,
                                      image_url=url)
    elif tipo == 'fb_post':
        return fb_publicar_post(cuenta['fb_page_id'], token, caption,
                                 image_urls=media)
    else:
        raise MetaError(f'tipo desconocido: {tipo}')
