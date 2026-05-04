"""Endpoints CRUD para tabla cliente_gympass.

NoofitPro acepta el campo gympassId en sus POST pero NO lo persiste
(silenciosamente lo descarta). Por eso mantenemos esta extensión local en
PostgreSQL del VPS, scoped por id_manager.
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn

bp = Blueprint('cliente_gympass', __name__)
log = logging.getLogger(__name__)


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_all():
    """Lista todos los cliente_gympass del manager. Devuelve mapa idnoofit→gympass_id."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cliente_idnoofit, gympass_id, notas, updated_at
                  FROM cliente_gympass
                 WHERE id_manager = %s
                 ORDER BY updated_at DESC
            """, (g.id_manager,))
            rows = cur.fetchall()
        # Mapa para uso rápido en frontend
        mapa = {r['cliente_idnoofit']: r['gympass_id'] for r in rows}
        return jsonify({'ok': True, 'mapa': mapa, 'rows': rows})
    except Exception as e:
        log.exception('list_all gympass')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_noofit>', methods=['GET'])
@auth_required
def get_one(id_noofit):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM cliente_gympass
                 WHERE id_manager = %s AND cliente_idnoofit = %s
            """, (g.id_manager, str(id_noofit)))
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('get gympass')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_noofit>', methods=['PUT'])
@auth_required
def upsert(id_noofit):
    """Crea o actualiza el gympass_id de un cliente. body = {gympass_id, notas?}"""
    try:
        d = request.get_json() or {}
        gympass_id = (d.get('gympass_id') or '').strip()
        notas = d.get('notas')
        if not gympass_id:
            return jsonify({'ok': False, 'error': 'gympass_id_required'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cliente_gympass (id_manager, id_trainer, cliente_idnoofit, gympass_id, notas)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id_manager, cliente_idnoofit)
                DO UPDATE SET gympass_id = EXCLUDED.gympass_id,
                              notas      = COALESCE(EXCLUDED.notas, cliente_gympass.notas),
                              id_trainer = EXCLUDED.id_trainer
                RETURNING *
            """, (g.id_manager, g.id_trainer, str(id_noofit), gympass_id, notas))
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('upsert gympass')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_noofit>', methods=['DELETE'])
@auth_required
def delete(id_noofit):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                DELETE FROM cliente_gympass
                 WHERE id_manager = %s AND cliente_idnoofit = %s
            """, (g.id_manager, str(id_noofit)))
            n = cur.rowcount
        return jsonify({'ok': True, 'deleted': n})
    except Exception as e:
        log.exception('delete gympass')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/bulk', methods=['POST'])
@auth_required
def bulk():
    """Bulk upsert. body = {items: [{cliente_idnoofit, gympass_id, notas?}]}"""
    try:
        d = request.get_json() or {}
        items = d.get('items') or []
        if not items: return jsonify({'ok': False, 'error': 'no_items'}), 400
        ok = err = 0
        with get_conn() as conn, conn.cursor() as cur:
            for it in items:
                cid = str(it.get('cliente_idnoofit') or '').strip()
                gid = (it.get('gympass_id') or '').strip()
                if not cid or not gid:
                    err += 1; continue
                cur.execute("""
                    INSERT INTO cliente_gympass (id_manager, id_trainer, cliente_idnoofit, gympass_id, notas)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id_manager, cliente_idnoofit)
                    DO UPDATE SET gympass_id = EXCLUDED.gympass_id,
                                  notas      = COALESCE(EXCLUDED.notas, cliente_gympass.notas),
                                  id_trainer = EXCLUDED.id_trainer
                """, (g.id_manager, g.id_trainer, cid, gid, it.get('notas')))
                ok += 1
        return jsonify({'ok': True, 'inserted_or_updated': ok, 'errors': err})
    except Exception as e:
        log.exception('bulk gympass')
        return jsonify({'ok': False, 'error': str(e)}), 500
