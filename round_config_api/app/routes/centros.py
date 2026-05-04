"""CRUD de centros / contactos por trainer.

Cada trainer en NoofitPro = un centro físico (Round Málaga Centro, Málaga Este…).
El manager configura aquí el email donde llegan los leads, ciudad, slug para
URLs (?centro=malagacentro), si entra en round-robin, etc.

Solo el manager puede listar/editar (no impersonando trainer).
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn

bp = Blueprint('centros', __name__)
log = logging.getLogger(__name__)


def _manager_only():
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    return None


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_all():
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM centro_contacto
                 WHERE id_manager = %s
                 ORDER BY nombre_centro
            """, (g.id_manager,))
            rows = cur.fetchall()
        return jsonify({'ok': True, 'rows': rows})
    except Exception as e:
        log.exception('centros list')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_trainer>', methods=['PUT'])
@auth_required
def upsert(id_trainer):
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        if not d.get('email') or not d.get('nombre_centro'):
            return jsonify({'ok': False, 'error': 'email y nombre_centro requeridos'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO centro_contacto
                  (id_manager, id_trainer, nombre_centro, slug, email, email_cc,
                   telefono, ciudad, direccion, activo, recibe_round_robin, notas)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE
                SET nombre_centro       = EXCLUDED.nombre_centro,
                    slug                = EXCLUDED.slug,
                    email               = EXCLUDED.email,
                    email_cc            = EXCLUDED.email_cc,
                    telefono            = EXCLUDED.telefono,
                    ciudad              = EXCLUDED.ciudad,
                    direccion           = EXCLUDED.direccion,
                    activo              = EXCLUDED.activo,
                    recibe_round_robin  = EXCLUDED.recibe_round_robin,
                    notas               = EXCLUDED.notas
                RETURNING *
            """, (g.id_manager, str(id_trainer),
                  d.get('nombre_centro'),
                  (d.get('slug') or '').strip().lower() or None,
                  d.get('email'),
                  d.get('email_cc') or None,
                  d.get('telefono'), d.get('ciudad'), d.get('direccion'),
                  bool(d.get('activo', True)),
                  bool(d.get('recibe_round_robin', True)),
                  d.get('notas')))
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('centros upsert')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_trainer>', methods=['DELETE'])
@auth_required
def delete(id_trainer):
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                DELETE FROM centro_contacto
                 WHERE id_manager=%s AND id_trainer=%s
            """, (g.id_manager, str(id_trainer)))
        return jsonify({'ok': True, 'deleted': cur.rowcount})
    except Exception as e:
        log.exception('centros delete')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Helpers internos para el flujo CRM ──────────────────────────────────────
def get_centros_activos(id_manager):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT * FROM centro_contacto
             WHERE id_manager=%s AND activo=TRUE
        """, (id_manager,))
        return cur.fetchall()


def buscar_centro(id_manager, slug=None, id_trainer=None):
    with get_conn() as conn, conn.cursor() as cur:
        if id_trainer:
            cur.execute("""
                SELECT * FROM centro_contacto
                 WHERE id_manager=%s AND id_trainer=%s
            """, (id_manager, str(id_trainer)))
            return cur.fetchone()
        if slug:
            cur.execute("""
                SELECT * FROM centro_contacto
                 WHERE id_manager=%s AND slug=%s AND activo=TRUE
                 LIMIT 1
            """, (id_manager, slug.lower().strip()))
            return cur.fetchone()
        return None


def proximo_centro_round_robin(id_manager):
    """Devuelve el centro activo con menos leads asignados en últimos 30 días.
    (Estrategia simple — más justa que round-robin estricto si algún trainer
    se ausenta.)"""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT c.*, COALESCE(la.n, 0) AS leads_recientes
              FROM centro_contacto c
              LEFT JOIN (
                SELECT id_trainer, COUNT(*) AS n
                  FROM lead_asignacion
                 WHERE id_manager=%s
                   AND created_at > NOW() - INTERVAL '30 days'
                 GROUP BY id_trainer
              ) la ON la.id_trainer = c.id_trainer
             WHERE c.id_manager=%s AND c.activo=TRUE AND c.recibe_round_robin=TRUE
             ORDER BY leads_recientes ASC, c.created_at ASC
             LIMIT 1
        """, (id_manager, id_manager))
        return cur.fetchone()
