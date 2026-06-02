"""Endpoints para redes sociales: cuentas Meta + agenda de publicaciones.

Cuentas Meta (manager-only):
  GET    /api/social/cuentas
  PUT    /api/social/cuentas                       (upsert con id_trainer null/valor)
  DELETE /api/social/cuentas?id_trainer=...&red=...
  GET    /api/social/cuentas/<id>/info             (info real desde Meta API)

Agenda (manager + trainer):
  GET    /api/social/posts?desde=&hasta=&estado=
  POST   /api/social/posts                         (crear/programar)
  PATCH  /api/social/posts/<id>
  DELETE /api/social/posts/<id>
  POST   /api/social/posts/<id>/publicar-ya        (forzar publicación inmediata)
"""
import json, logging
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request
from .. import meta_client as mc

bp = Blueprint('social', __name__)
log = logging.getLogger(__name__)


def _t(v):
    if v is None: return None
    if isinstance(v, str) and v.strip().lower() in ('', 'null', 'none'): return None
    return str(v)


def _safe_cuenta(r):
    """Quita el access_token de la respuesta y deja solo preview."""
    if not r: return r
    out = dict(r)
    tok = out.pop('access_token', None) or ''
    out['has_access_token'] = bool(tok)
    out['access_token_preview'] = (tok[:6] + '…' + tok[-4:]) if tok and len(tok) > 12 else ('***' if tok else '')
    return out


# ── CUENTAS META ─────────────────────────────────────────────────────────────

@bp.route('/cuentas', methods=['GET'])
@auth_required
def list_cuentas():
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM social_cuenta
                        WHERE id_manager=%s
                        ORDER BY id_trainer NULLS FIRST, red""",
                    (g.id_manager,))
        rows = cur.fetchall() or []
    return jsonify({'ok': True, 'rows': [_safe_cuenta(r) for r in rows]})


@bp.route('/cuentas', methods=['PUT'])
@auth_required
@require_permission('configuracion.meta.conectar')
def upsert_cuenta():
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    d = request.get_json() or {}
    red = (d.get('red') or '').strip().lower()
    if red not in ('instagram', 'facebook', 'meta'):
        return jsonify({'ok': False, 'error': 'red_invalida'}), 400
    id_trainer = _t(d.get('id_trainer'))
    access_token = (d.get('access_token') or '').strip()

    # Si no viene token, mantenemos el existente
    with get_conn() as conn, conn.cursor() as cur:
        if id_trainer:
            cur.execute("""SELECT id, access_token FROM social_cuenta
                            WHERE id_manager=%s AND id_trainer=%s AND red=%s""",
                        (g.id_manager, id_trainer, red))
        else:
            cur.execute("""SELECT id, access_token FROM social_cuenta
                            WHERE id_manager=%s AND id_trainer IS NULL AND red=%s""",
                        (g.id_manager, red))
        existing = cur.fetchone()
        if existing and not access_token:
            access_token = existing.get('access_token') or ''

        # Calcular expires_at: 60 días tras update si vino token nuevo
        expires_at = None
        if d.get('access_token'):
            expires_at = datetime.now(timezone.utc) + timedelta(days=60)

        if existing:
            cur.execute("""UPDATE social_cuenta SET
                             nombre=%s, fb_page_id=%s, fb_page_name=%s,
                             ig_business_account_id=%s, ig_username=%s,
                             access_token=%s, token_type=%s,
                             expires_at = COALESCE(%s, expires_at),
                             active=%s, notas=%s
                            WHERE id=%s RETURNING *""",
                        (d.get('nombre'), d.get('fb_page_id'), d.get('fb_page_name'),
                         d.get('ig_business_account_id'), d.get('ig_username'),
                         access_token, d.get('token_type') or 'page',
                         expires_at,
                         bool(d.get('active', True)), d.get('notas'),
                         existing['id']))
        else:
            cur.execute("""INSERT INTO social_cuenta
                             (id_manager, id_trainer, red, nombre,
                              fb_page_id, fb_page_name,
                              ig_business_account_id, ig_username,
                              access_token, token_type, expires_at,
                              active, notas)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            RETURNING *""",
                        (g.id_manager, id_trainer, red, d.get('nombre'),
                         d.get('fb_page_id'), d.get('fb_page_name'),
                         d.get('ig_business_account_id'), d.get('ig_username'),
                         access_token, d.get('token_type') or 'page', expires_at,
                         bool(d.get('active', True)), d.get('notas')))
        row = cur.fetchone()
    _campos = [k for k in ('nombre', 'fb_page_id', 'fb_page_name',
                           'ig_business_account_id', 'ig_username',
                           'access_token', 'token_type', 'active', 'notas')
               if k in d]
    log_action(actor_from_request(), 'social_cuenta',
               'update' if existing else 'connect',
               entidad_id=row.get('id') if row else (existing['id'] if existing else None),
               resumen=f"{'Actualizada' if existing else 'Conectada'} cuenta Meta {red}",
               cambios={'campos_modificados': _campos,
                        'token_actualizado': bool(d.get('access_token'))})
    return jsonify({'ok': True, 'row': _safe_cuenta(row)})


@bp.route('/cuentas/<int:cuenta_id>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.meta.desconectar')
def delete_cuenta(cuenta_id):
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM social_cuenta WHERE id=%s AND id_manager=%s",
                    (cuenta_id, g.id_manager))
    log_action(actor_from_request(), 'social_cuenta', 'disconnect',
               entidad_id=cuenta_id,
               resumen='Desconectada cuenta Meta')
    return jsonify({'ok': True})


@bp.route('/cuentas/<int:cuenta_id>/info', methods=['GET'])
@auth_required
def info_cuenta(cuenta_id):
    """Hace una llamada real a Meta para validar el token y traer info actual."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM social_cuenta
                        WHERE id=%s AND id_manager=%s""",
                    (cuenta_id, g.id_manager))
        cuenta = cur.fetchone()
    if not cuenta: return jsonify({'ok': False, 'error': 'not_found'}), 404
    if not cuenta.get('access_token'):
        return jsonify({'ok': False, 'error': 'sin_token'}), 400
    info = {}
    try:
        if cuenta.get('ig_business_account_id'):
            info['instagram'] = mc.get_ig_account_info(
                cuenta['ig_business_account_id'], cuenta['access_token'])
        if cuenta.get('fb_page_id'):
            info['facebook'] = mc.get_fb_page_info(
                cuenta['fb_page_id'], cuenta['access_token'])
    except mc.MetaError as e:
        return jsonify({'ok': False, 'error': str(e)}), 502
    return jsonify({'ok': True, 'info': info})


# ── POSTS / AGENDA ───────────────────────────────────────────────────────────

@bp.route('/posts', methods=['GET'])
@auth_required
def list_posts():
    desde = request.args.get('desde')
    hasta = request.args.get('hasta')
    estado = request.args.get('estado')
    sql = """SELECT p.*, c.nombre AS cuenta_nombre, c.red AS cuenta_red,
                    c.ig_username, c.fb_page_name
               FROM social_post p
               JOIN social_cuenta c ON c.id = p.social_cuenta_id
              WHERE p.id_manager=%s"""
    params = [g.id_manager]
    if g.id_trainer:
        sql += " AND p.id_trainer=%s"; params.append(g.id_trainer)
    if desde:
        sql += " AND p.schedule_at >= %s"; params.append(desde)
    if hasta:
        sql += " AND p.schedule_at <= %s"; params.append(hasta)
    if estado:
        sql += " AND p.estado=%s"; params.append(estado)
    sql += " ORDER BY p.schedule_at ASC LIMIT 500"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall() or []
    return jsonify({'ok': True, 'rows': rows})


@bp.route('/posts', methods=['POST'])
@auth_required
@require_permission('crm.agenda_social.crear_post')
def crear_post():
    d = request.get_json() or {}
    cuenta_id = d.get('social_cuenta_id')
    if not cuenta_id: return jsonify({'ok': False, 'error': 'social_cuenta_id_requerido'}), 400

    # Verificar pertenencia de la cuenta
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, id_trainer, red FROM social_cuenta
                        WHERE id=%s AND id_manager=%s""",
                    (cuenta_id, g.id_manager))
        cuenta = cur.fetchone()
    if not cuenta: return jsonify({'ok': False, 'error': 'cuenta_no_encontrada'}), 404
    # Trainer impersonando solo puede usar SU cuenta
    if g.id_trainer and cuenta['id_trainer'] and str(cuenta['id_trainer']) != str(g.id_trainer):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403

    tipo = (d.get('tipo') or '').strip().lower()
    if tipo not in ('image', 'carousel', 'reel', 'story', 'fb_post'):
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    schedule_at = d.get('schedule_at')
    if not schedule_at:
        return jsonify({'ok': False, 'error': 'schedule_at_requerido'}), 400

    media_urls = d.get('media_urls') or []
    if isinstance(media_urls, str): media_urls = [media_urls]
    if tipo == 'carousel' and (len(media_urls) < 2 or len(media_urls) > 10):
        return jsonify({'ok': False, 'error': 'carousel_2_a_10_imagenes'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO social_post
                         (id_manager, id_trainer, social_cuenta_id, red, tipo,
                          media_urls, caption, hashtags, schedule_at,
                          estado, created_by)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'pendiente',%s)
                        RETURNING *""",
                    (g.id_manager, g.id_trainer or cuenta.get('id_trainer'),
                     cuenta_id, cuenta['red'], tipo,
                     json.dumps(media_urls, ensure_ascii=False),
                     d.get('caption'), d.get('hashtags'), schedule_at,
                     getattr(g, 'user_email', None) or g.id_manager))
        row = cur.fetchone()
    log_action(actor_from_request(), 'social_post', 'programar',
               entidad_id=row.get('id') if row else None,
               resumen=f"Post {tipo} programado para {schedule_at}",
               cambios={'tipo': tipo, 'schedule_at': str(schedule_at),
                        'social_cuenta_id': cuenta_id})
    return jsonify({'ok': True, 'row': row})


@bp.route('/posts/<int:post_id>', methods=['PATCH'])
@auth_required
@require_permission('crm.agenda_social.editar_post')
def update_post(post_id):
    d = request.get_json() or {}
    sets, params = [], []
    for k in ('caption', 'hashtags', 'schedule_at', 'estado'):
        if k in d: sets.append(f"{k}=%s"); params.append(d[k])
    if 'media_urls' in d:
        sets.append("media_urls=%s")
        params.append(json.dumps(d['media_urls'] or [], ensure_ascii=False))
    if not sets: return jsonify({'ok': False, 'error': 'no_fields'}), 400
    params.extend([post_id, g.id_manager])
    sql_extra = ' AND id_trainer=%s' if g.id_trainer else ''
    if g.id_trainer: params.append(g.id_trainer)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""UPDATE social_post SET {', '.join(sets)}
                          WHERE id=%s AND id_manager=%s{sql_extra}
                          RETURNING *""", params)
        row = cur.fetchone()
    if not row: return jsonify({'ok': False, 'error': 'not_found_or_forbidden'}), 404
    _campos = [k for k in ('caption', 'hashtags', 'schedule_at', 'estado', 'media_urls')
               if k in d]
    log_action(actor_from_request(), 'social_post', 'update',
               entidad_id=post_id,
               resumen='Post de agenda social editado',
               cambios={'campos_modificados': _campos})
    return jsonify({'ok': True, 'row': row})


@bp.route('/posts/<int:post_id>', methods=['DELETE'])
@auth_required
@require_permission('crm.agenda_social.borrar_post')
def delete_post(post_id):
    sql_extra = ' AND id_trainer=%s' if g.id_trainer else ''
    params = [post_id, g.id_manager]
    if g.id_trainer: params.append(g.id_trainer)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"DELETE FROM social_post WHERE id=%s AND id_manager=%s{sql_extra}",
                    params)
        n = cur.rowcount
    if not n: return jsonify({'ok': False, 'error': 'not_found_or_forbidden'}), 404
    log_action(actor_from_request(), 'social_post', 'delete',
               entidad_id=post_id,
               resumen='Post de agenda social eliminado')
    return jsonify({'ok': True})


@bp.route('/posts/<int:post_id>/publicar-ya', methods=['POST'])
@auth_required
@require_permission('crm.agenda_social.publicar_ya')
def publicar_ya(post_id):
    """Adelanta el schedule_at a NOW() — el cron lo publicará en su próxima ronda."""
    sql_extra = ' AND id_trainer=%s' if g.id_trainer else ''
    params = [post_id, g.id_manager]
    if g.id_trainer: params.append(g.id_trainer)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""UPDATE social_post SET schedule_at=NOW(), estado='pendiente',
                                                attempts=0, error_msg=NULL
                          WHERE id=%s AND id_manager=%s{sql_extra}
                          RETURNING *""", params)
        row = cur.fetchone()
    if not row: return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), 'social_post', 'publish',
               entidad_id=post_id,
               resumen='Post forzado a publicación inmediata')
    return jsonify({'ok': True, 'row': row, 'mensaje':
                    'Programado para publicar en próximos 5 min (siguiente ciclo del cron)'})
