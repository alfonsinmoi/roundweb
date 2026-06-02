"""CRUD del proveedor de email transaccional por manager.
Solo el manager puede gestionar (no impersonando trainer).
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission
from ..db import get_conn
from ..email_sender import test_proveedor
from ..audit_log import log_action, actor_from_request

bp = Blueprint('email_config', __name__)
log = logging.getLogger(__name__)


def _manager_only():
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    return None


def _safe_row(r):
    if not r: return r
    out = dict(r)
    # Ocultar API key y password
    for k in ('api_key', 'smtp_pass'):
        v = out.pop(k, '')
        out[f'has_{k}'] = bool(v)
        out[f'{k}_preview'] = (v[:4] + '…' + v[-4:]) if v and len(v) > 8 else ('***' if v else '')
    return out


def _t(v):
    """Normaliza id_trainer: '' / 'null' → None; resto → str."""
    if v is None: return None
    if isinstance(v, str) and v.strip().lower() in ('', 'null', 'none'): return None
    return str(v)


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def get():
    """Devuelve TODAS las configs (manager + por trainer) para este manager.
    Si pasan ?id_trainer=XXX o trainer=XXX, devuelve solo esa.
    Por compat: row = config del manager (id_trainer NULL); rows = lista completa."""
    err = _manager_only()
    if err: return err
    try:
        trainer_filter = _t(request.args.get('id_trainer') or request.args.get('trainer'))
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT * FROM email_proveedor
                            WHERE id_manager=%s
                            ORDER BY id_trainer NULLS FIRST""",
                        (g.id_manager,))
            rows = cur.fetchall() or []
        rows_safe = [_safe_row(r) for r in rows]
        manager_row = next((r for r in rows_safe if not r.get('id_trainer')), None)
        if trainer_filter:
            row = next((r for r in rows_safe if str(r.get('id_trainer') or '') == trainer_filter), None)
            return jsonify({'ok': True, 'row': row})
        return jsonify({'ok': True, 'row': manager_row, 'rows': rows_safe})
    except Exception as e:
        log.exception('email_config get')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('', methods=['PUT'])
@bp.route('/', methods=['PUT'])
@auth_required
@require_permission('configuracion.email.editar')
def upsert():
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        id_trainer = _t(d.get('id_trainer'))
        proveedor = (d.get('proveedor') or 'resend').strip().lower()
        from_email = (d.get('from_email') or '').strip()
        if not from_email:
            return jsonify({'ok': False, 'error': 'from_email_required'}), 400
        if proveedor not in ('resend', 'postmark', 'smtp', 'gmail'):
            return jsonify({'ok': False, 'error': 'proveedor_invalido'}), 400

        # Para 'gmail', autorrellenamos host/port/tls si vienen vacíos
        smtp_host = (d.get('smtp_host') or '').strip()
        smtp_port = d.get('smtp_port')
        smtp_user = (d.get('smtp_user') or '').strip()
        smtp_tls = bool(d.get('smtp_tls', True))
        if proveedor == 'gmail':
            if not smtp_host: smtp_host = 'smtp.gmail.com'
            if not smtp_port: smtp_port = 587
            if not smtp_user: smtp_user = from_email
            smtp_tls = True
            # Gmail SMTP exige From == usuario autenticado.
            # Si no coinciden, forzamos from_email al smtp_user (con prioridad smtp_user
            # ya que es el único que puede autenticar). Avisamos al log.
            if from_email and from_email.lower() != smtp_user.lower():
                log.warning(f'gmail config: from_email={from_email} != smtp_user={smtp_user}; '
                            f'forzando from_email=smtp_user')
                from_email = smtp_user

        # Si vienen vacíos los secretos, mantener los existentes (de esa misma fila)
        api_key = (d.get('api_key') or '').strip()
        smtp_pass = (d.get('smtp_pass') or '').strip()
        with get_conn() as conn, conn.cursor() as cur:
            if not api_key or not smtp_pass:
                if id_trainer:
                    cur.execute("""SELECT api_key, smtp_pass FROM email_proveedor
                                    WHERE id_manager=%s AND id_trainer=%s""",
                                (g.id_manager, id_trainer))
                else:
                    cur.execute("""SELECT api_key, smtp_pass FROM email_proveedor
                                    WHERE id_manager=%s AND id_trainer IS NULL""",
                                (g.id_manager,))
                ex = cur.fetchone()
                if ex:
                    if not api_key: api_key = ex.get('api_key') or ''
                    if not smtp_pass: smtp_pass = ex.get('smtp_pass') or ''

            # Upsert manual (no tenemos un único UNIQUE, sino dos parciales)
            if id_trainer:
                cur.execute("""SELECT id FROM email_proveedor
                                WHERE id_manager=%s AND id_trainer=%s""",
                            (g.id_manager, id_trainer))
            else:
                cur.execute("""SELECT id FROM email_proveedor
                                WHERE id_manager=%s AND id_trainer IS NULL""",
                            (g.id_manager,))
            existing = cur.fetchone()

            if existing:
                cur.execute("""
                    UPDATE email_proveedor SET
                      proveedor=%s, api_key=%s,
                      smtp_host=%s, smtp_port=%s, smtp_user=%s, smtp_pass=%s, smtp_tls=%s,
                      from_name=%s, from_email=%s, reply_to=%s, active=%s, notas=%s
                    WHERE id=%s RETURNING *
                """, (proveedor, api_key, smtp_host or None, smtp_port, smtp_user or None,
                      smtp_pass, smtp_tls, d.get('from_name'), from_email,
                      d.get('reply_to'), bool(d.get('active', True)), d.get('notas'),
                      existing['id']))
            else:
                cur.execute("""
                    INSERT INTO email_proveedor
                      (id_manager, id_trainer, proveedor, api_key,
                       smtp_host, smtp_port, smtp_user, smtp_pass, smtp_tls,
                       from_name, from_email, reply_to, active, notas)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING *
                """, (g.id_manager, id_trainer, proveedor, api_key,
                      smtp_host or None, smtp_port, smtp_user or None,
                      smtp_pass, smtp_tls, d.get('from_name'), from_email,
                      d.get('reply_to'), bool(d.get('active', True)), d.get('notas')))
            row = cur.fetchone()
        # Audit: QUIÉN y QUÉ campos, nunca los secretos (api_key / smtp_pass).
        campos = [k for k in ('proveedor', 'api_key', 'smtp_host', 'smtp_port',
                              'smtp_user', 'smtp_pass', 'smtp_tls', 'from_name',
                              'from_email', 'reply_to', 'active', 'notas')
                  if d.get(k) is not None]
        log_action(actor_from_request(), 'email_proveedor',
                   'update' if existing else 'create',
                   entidad_id=(row.get('id') if row else None),
                   resumen=f'Proveedor email {proveedor} configurado',
                   cambios={'campos_modificados': campos,
                            'api_key_actualizada': bool((d.get('api_key') or '').strip()),
                            'smtp_pass_actualizada': bool((d.get('smtp_pass') or '').strip())})
        return jsonify({'ok': True, 'row': _safe_row(row)})
    except Exception as e:
        log.exception('email_config upsert')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('', methods=['DELETE'])
@bp.route('/', methods=['DELETE'])
@auth_required
@require_permission('configuracion.email.editar')
def delete_trainer_config():
    """Borra la config específica de un trainer (vuelve a usar fallback del manager)."""
    err = _manager_only()
    if err: return err
    id_trainer = _t(request.args.get('id_trainer') or (request.get_json(silent=True) or {}).get('id_trainer'))
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_requerido'}), 400
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""DELETE FROM email_proveedor
                            WHERE id_manager=%s AND id_trainer=%s""",
                        (g.id_manager, id_trainer))
        log_action(actor_from_request(), 'email_proveedor', 'delete',
                   entidad_id=id_trainer,
                   resumen='Config email de trainer eliminada')
        return jsonify({'ok': True})
    except Exception as e:
        log.exception('email_config delete')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/test', methods=['POST'])
@auth_required
@require_permission('configuracion.email.editar')
def test():
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        dest = (d.get('dest_email') or '').strip()
        id_trainer = _t(d.get('id_trainer'))
        if not dest: return jsonify({'ok': False, 'error': 'dest_email_required'}), 400
        ok, msg = test_proveedor(g.id_manager, dest, id_trainer=id_trainer)
        return jsonify({'ok': ok, 'detail': msg})
    except Exception as e:
        log.exception('email test')
        return jsonify({'ok': False, 'error': str(e)}), 500
