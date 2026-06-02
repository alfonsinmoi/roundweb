"""CRUD de credenciales de pasarela (PayComet, Redsys...) por trainer.

Reglas:
  - Solo el manager (no impersonando trainer) puede LISTAR / CREAR / EDITAR
    / BORRAR. Si la request viene con X-Round-Trainer-Id (modo impersonando),
    la operación se bloquea.
  - El api_token NO se devuelve íntegro al GET; en su lugar se envía un
    indicador {has_token: true, token_preview: 'xxx...yyy'}. Solo se guarda
    cuando el manager lo escribe en un PUT.
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('pasarelas', __name__)
log = logging.getLogger(__name__)


def _manager_only():
    """Bloquea si el caller está impersonando un trainer."""
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    return None


def _mask(token):
    if not token: return ''
    if len(token) <= 8: return '***'
    return f'{token[:4]}…{token[-4:]}'


def _safe_row(r):
    """Quita api_token del dict, deja preview."""
    if not r: return r
    out = dict(r)
    tok = out.pop('api_token', '')
    out['has_token'] = bool(tok)
    out['token_preview'] = _mask(tok)
    return out


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_all():
    """Lista todas las credenciales del manager (uno por trainer/proveedor)."""
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, id_trainer, proveedor, terminal, url_ok, url_ko,
                       url_notif, sandbox, active, notas, api_token, updated_at
                  FROM pasarela_credenciales
                 WHERE id_manager = %s
                 ORDER BY id_trainer, proveedor
            """, (g.id_manager,))
            rows = cur.fetchall()
        return jsonify({'ok': True, 'rows': [_safe_row(r) for r in rows]})
    except Exception as e:
        log.exception('pasarelas list')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_trainer>', methods=['PUT'])
@auth_required
@require_permission('configuracion.pasarelas.editar')
def upsert(id_trainer):
    """Crea o actualiza una credencial. Body:
      { proveedor: 'paycomet', api_token: '...', terminal: '...',
        url_ok: '', url_ko: '', url_notif: '', sandbox: false, active: true,
        notas: '' }
    Si api_token está vacío en el body, se MANTIENE el existente (permite
    editar el resto sin re-tipear el token).
    """
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        proveedor = (d.get('proveedor') or 'paycomet').strip().lower()
        api_token = (d.get('api_token') or '').strip()
        terminal = (d.get('terminal') or '').strip()
        if not terminal:
            return jsonify({'ok': False, 'error': 'terminal_required'}), 400

        with get_conn() as conn, conn.cursor() as cur:
            # Si no nos mandan token, mantener el existente
            if not api_token:
                cur.execute("""
                    SELECT api_token FROM pasarela_credenciales
                     WHERE id_manager=%s AND id_trainer=%s AND proveedor=%s
                """, (g.id_manager, str(id_trainer), proveedor))
                ex = cur.fetchone()
                if not ex:
                    return jsonify({'ok': False, 'error': 'api_token_required_for_create'}), 400
                api_token = ex['api_token']

            cur.execute("""
                INSERT INTO pasarela_credenciales
                  (id_manager, id_trainer, proveedor, api_token, terminal,
                   url_ok, url_ko, url_notif, sandbox, active, notas)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id_manager, id_trainer, proveedor) DO UPDATE
                SET api_token = EXCLUDED.api_token,
                    terminal  = EXCLUDED.terminal,
                    url_ok    = EXCLUDED.url_ok,
                    url_ko    = EXCLUDED.url_ko,
                    url_notif = EXCLUDED.url_notif,
                    sandbox   = EXCLUDED.sandbox,
                    active    = EXCLUDED.active,
                    notas     = EXCLUDED.notas
                RETURNING id, id_trainer, proveedor, terminal, url_ok, url_ko,
                          url_notif, sandbox, active, notas, api_token, updated_at
            """, (g.id_manager, str(id_trainer), proveedor, api_token, terminal,
                  d.get('url_ok'), d.get('url_ko'), d.get('url_notif'),
                  bool(d.get('sandbox')), bool(d.get('active', True)),
                  d.get('notas')))
            row = cur.fetchone()
        # Audit: registrar QUIÉN tocó credenciales y QUÉ campos, sin secretos.
        campos = [k for k in ('proveedor', 'api_token', 'terminal', 'url_ok',
                              'url_ko', 'url_notif', 'sandbox', 'active', 'notas')
                  if d.get(k) is not None]
        log_action(actor_from_request(), 'pasarela_credenciales', 'update',
                   entidad_id=str(id_trainer),
                   resumen=f'Credenciales {proveedor} actualizadas',
                   cambios={'campos_modificados': campos,
                            'api_token_actualizado': bool((d.get('api_token') or '').strip())})
        return jsonify({'ok': True, 'row': _safe_row(row)})
    except Exception as e:
        log.exception('pasarelas upsert')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_trainer>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.pasarelas.editar')
def delete(id_trainer):
    err = _manager_only()
    if err: return err
    try:
        proveedor = (request.args.get('proveedor') or 'paycomet').strip().lower()
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                DELETE FROM pasarela_credenciales
                 WHERE id_manager=%s AND id_trainer=%s AND proveedor=%s
            """, (g.id_manager, str(id_trainer), proveedor))
            n = cur.rowcount
        log_action(actor_from_request(), 'pasarela_credenciales', 'delete',
                   entidad_id=str(id_trainer),
                   resumen=f'Credenciales {proveedor} eliminadas',
                   cambios={'proveedor': proveedor, 'filas_eliminadas': n})
        return jsonify({'ok': True, 'deleted': n})
    except Exception as e:
        log.exception('pasarelas delete')
        return jsonify({'ok': False, 'error': str(e)}), 500


# Helper interno (no expuesto vía REST) — devuelve credenciales completas
# para uso desde odoo_alta. NO usar en endpoints públicos.
def get_credenciales(id_manager, id_trainer, proveedor='paycomet'):
    if not id_manager: return None
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT api_token, terminal, url_ok, url_ko, url_notif,
                       sandbox, active
                  FROM pasarela_credenciales
                 WHERE id_manager=%s AND id_trainer=%s
                   AND proveedor=%s AND active = TRUE
            """, (str(id_manager), str(id_trainer or ''), proveedor))
            row = cur.fetchone()
        return row
    except Exception as e:
        log.error(f'get_credenciales: {e}')
        return None
