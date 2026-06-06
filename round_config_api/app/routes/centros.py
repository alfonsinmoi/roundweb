"""CRUD de centros / contactos por trainer.

Cada trainer en NoofitPro = un centro físico (Round Málaga Centro, Málaga Este…).
El manager configura aquí el email donde llegan los leads, ciudad, slug para
URLs (?centro=malagacentro), si entra en round-robin, etc.

Solo el manager puede listar/editar (no impersonando trainer).
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request, diff_dict

bp = Blueprint('centros', __name__)
log = logging.getLogger(__name__)


# ── Catálogo de actividades del centro (para el selector admin) ─────────
@bp.route('/<id_trainer>/actividades', methods=['GET'])
@auth_required
def list_actividades(id_trainer):
    """Devuelve actividades únicas que tiene el trainer en las próximas 4
    semanas en NoofitPro. Útil para que el admin pueda elegir qué actividades
    se muestran al público."""
    err = _manager_only()
    if err: return err
    try:
        from ..slot_affluence import slots_disponibles
        # Llamamos sin filtros para conseguir TODAS las actividades del trainer
        # Excluimos el filtro de días pasando todos los días permitidos.
        result = slots_disponibles(id_trainer=str(id_trainer),
                                   dias_adelante=28,
                                   max_resultados=0,
                                   devolver_actividades=True,
                                   dias_permitidos=[0, 1, 2, 3, 4, 5, 6])
        return jsonify({'ok': True, 'actividades': result['actividades']})
    except Exception as e:
        log.exception('list_actividades')
        return jsonify({'ok': False, 'error': str(e)}), 500


def _manager_only():
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    return None


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_all():
    """Lista de centros del manager. Lectura permitida tanto al manager bare
    (devuelve TODOS sus centros) como al usuario logueado en un centro
    concreto (devuelve SOLO el suyo) — necesario para que el badge top-right
    pueda mostrar el nombre del centro al usuario sin permisos de manager.
    La escritura/borrado SÍ requieren manager (_manager_only en PUT/DELETE).
    """
    try:
        with get_conn() as conn, conn.cursor() as cur:
            if g.id_trainer:
                cur.execute("""
                    SELECT * FROM centro_contacto
                     WHERE id_manager = %s AND id_trainer = %s
                """, (g.id_manager, str(g.id_trainer)))
            else:
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
@require_permission('configuracion.centros_trainers.editar')
def upsert(id_trainer):
    err = _manager_only()
    if err: return err
    try:
        import json as _json
        d = request.get_json() or {}
        if not d.get('email') or not d.get('nombre_centro'):
            return jsonify({'ok': False, 'error': 'email y nombre_centro requeridos'}), 400
        # Validar dias_permitidos: lista de int 0-6 (lun=0 ... dom=6)
        dias = d.get('dias_permitidos') or []
        if not isinstance(dias, list):
            return jsonify({'ok': False, 'error': 'dias_permitidos debe ser una lista'}), 400
        try:
            dias_norm = sorted({int(x) for x in dias if 0 <= int(x) <= 6})
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'dias_permitidos: solo enteros 0-6'}), 400
        # Validar actividades_permitidas: lista de int (id_actividad NoofitPro)
        actividades = d.get('actividades_permitidas') or []
        if not isinstance(actividades, list):
            return jsonify({'ok': False, 'error': 'actividades_permitidas debe ser una lista'}), 400
        try:
            actividades_norm = sorted({int(x) for x in actividades if str(x).strip()})
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'actividades_permitidas: solo enteros'}), 400

        # Normalizar campos SEPA empresa (mayo 2026). Espacios fuera y
        # mayúsculas en IBAN/Creditor; BIC también en mayúsculas.
        iban_cobro = (d.get('iban_cobro') or '').replace(' ', '').upper() or None
        bic = (d.get('bic') or '').replace(' ', '').upper() or None
        sepa_creditor_id = (d.get('sepa_creditor_id') or '').replace(' ', '').upper() or None

        with get_conn() as conn, conn.cursor() as cur:
            # Leemos la fila previa para auditar QUÉ cambió (IBAN/CIF/creditor
            # SEPA son datos fiscales sensibles que acaban en las remesas).
            cur.execute("""SELECT * FROM centro_contacto
                            WHERE id_manager=%s AND id_trainer=%s""",
                        (g.id_manager, str(id_trainer)))
            before = cur.fetchone()
            cur.execute("""
                INSERT INTO centro_contacto
                  (id_manager, id_trainer, nombre_centro, slug, email, email_cc,
                   telefono, ciudad, direccion, cif, razon_social,
                   activo, recibe_round_robin, notas,
                   dias_permitidos, actividades_permitidas,
                   iban_cobro, bic, sepa_creditor_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE
                SET nombre_centro          = EXCLUDED.nombre_centro,
                    slug                   = EXCLUDED.slug,
                    email                  = EXCLUDED.email,
                    email_cc               = EXCLUDED.email_cc,
                    telefono               = EXCLUDED.telefono,
                    ciudad                 = EXCLUDED.ciudad,
                    direccion              = EXCLUDED.direccion,
                    cif                    = EXCLUDED.cif,
                    razon_social           = EXCLUDED.razon_social,
                    activo                 = EXCLUDED.activo,
                    recibe_round_robin     = EXCLUDED.recibe_round_robin,
                    notas                  = EXCLUDED.notas,
                    dias_permitidos        = EXCLUDED.dias_permitidos,
                    actividades_permitidas = EXCLUDED.actividades_permitidas,
                    iban_cobro             = EXCLUDED.iban_cobro,
                    bic                    = EXCLUDED.bic,
                    sepa_creditor_id       = EXCLUDED.sepa_creditor_id
                RETURNING *
            """, (g.id_manager, str(id_trainer),
                  d.get('nombre_centro'),
                  (d.get('slug') or '').strip().lower() or None,
                  d.get('email'),
                  d.get('email_cc') or None,
                  d.get('telefono'), d.get('ciudad'), d.get('direccion'),
                  (d.get('cif') or '').strip().upper() or None,
                  d.get('razon_social') or None,
                  bool(d.get('activo', True)),
                  bool(d.get('recibe_round_robin', True)),
                  d.get('notas'),
                  _json.dumps(dias_norm),
                  _json.dumps(actividades_norm),
                  iban_cobro, bic, sepa_creditor_id))
            row = cur.fetchone()
        log_action(actor_from_request(), 'centro_contacto',
                   'update' if before else 'create',
                   entidad_id=str(id_trainer),
                   resumen='Datos centro/SEPA creados' if not before
                           else 'Datos centro/SEPA modificados',
                   cambios=diff_dict(before, row))
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('centros upsert')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Alta de cliente — modo per-trainer ──────────────────────────────────────
# Configura cómo se da de alta un nuevo cliente desde el web/mynoofit.
# Tres modos:
#   'centro'     → QR del centro visible en /clientes. Cliente escanea con
#                  mynoofit y se da de alta directamente vinculándose al
#                  trainer (sin ficha previa).
#   'individual' → QR del centro NO visible. El gestor crea primero la ficha
#                  del cliente y le entrega su QR personal para vincular su
#                  mynoofit a esa ficha existente.
#   'ambos'      → ambos QR disponibles a la vez.
# Aceptamos lectura tanto para manager como para trainer (cualquiera puede
# leer SU modo); la escritura SOLO la hace el manager.
MODOS_ALTA = ('centro', 'individual', 'ambos')


@bp.route('/alta-cliente-modo', methods=['GET'])
@bp.route('/<id_trainer>/alta-cliente-modo', methods=['GET'])
@auth_required
def get_alta_modo(id_trainer=None):
    """Devuelve {modo: 'centro'|'individual'|'ambos'} del trainer indicado
    (o del trainer impersonado si no se pasa id_trainer)."""
    try:
        tid = id_trainer or g.id_trainer
        if not tid:
            return jsonify({'ok': False, 'error': 'id_trainer_required'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT alta_cliente_modo FROM centro_contacto
                            WHERE id_manager=%s AND id_trainer=%s""",
                        (g.id_manager, str(tid)))
            r = cur.fetchone()
        modo = (r or {}).get('alta_cliente_modo') or 'centro'
        return jsonify({'ok': True, 'modo': modo, 'id_trainer': str(tid)})
    except Exception as e:
        log.exception('get_alta_modo')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_trainer>/alta-cliente-modo', methods=['PUT'])
@auth_required
@require_permission('configuracion.centros_trainers.editar')
def set_alta_modo(id_trainer):
    """Cambia el modo para un trainer. Solo manager (no impersonando)."""
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        modo = (d.get('modo') or '').strip().lower()
        if modo not in MODOS_ALTA:
            return jsonify({'ok': False,
                             'error': f'modo invalido (acepta: {MODOS_ALTA})'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            # UPSERT — si no existe centro_contacto, crear con valores mínimos.
            cur.execute("""
                INSERT INTO centro_contacto (id_manager, id_trainer,
                                              nombre_centro, email,
                                              alta_cliente_modo)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE
                SET alta_cliente_modo = EXCLUDED.alta_cliente_modo
                RETURNING alta_cliente_modo
            """, (g.id_manager, str(id_trainer),
                  f'Centro {id_trainer}', f'noreply+{id_trainer}@example.com',
                  modo))
            row = cur.fetchone()
        log_action(actor_from_request(), 'centro_contacto', 'update',
                   entidad_id=str(id_trainer),
                   resumen=f'Modo alta cliente → {row["alta_cliente_modo"]}')
        return jsonify({'ok': True, 'modo': row['alta_cliente_modo'],
                         'id_trainer': str(id_trainer)})
    except Exception as e:
        log.exception('set_alta_modo')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<id_trainer>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.centros_trainers.borrar')
def delete(id_trainer):
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                DELETE FROM centro_contacto
                 WHERE id_manager=%s AND id_trainer=%s
            """, (g.id_manager, str(id_trainer)))
            deleted = cur.rowcount
        if deleted:
            log_action(actor_from_request(), 'centro_contacto', 'delete',
                       entidad_id=str(id_trainer),
                       resumen='Centro/datos SEPA eliminados')
        return jsonify({'ok': True, 'deleted': deleted})
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
