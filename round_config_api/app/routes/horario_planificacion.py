"""Configuración de planificación de personal (Fase 2 B.1).

Endpoints admin:

  Temporadas y horario apertura
    GET    /api/horario/temporadas
    POST   /api/horario/temporadas
    PATCH  /api/horario/temporadas/<id>
    DELETE /api/horario/temporadas/<id>
    GET    /api/horario/temporadas/<id>/apertura
    PUT    /api/horario/temporadas/<id>/apertura

  Catálogo de puestos
    GET    /api/horario/puestos
    POST   /api/horario/puestos
    PATCH  /api/horario/puestos/<id>
    DELETE /api/horario/puestos/<id>
    GET    /api/horario/puestos/compatibilidades
    PUT    /api/horario/puestos/compatibilidades   (sustituye la matriz entera)

  Demanda por puesto
    GET    /api/horario/puestos/<id>/demanda?temporada_id=
    PUT    /api/horario/puestos/<id>/demanda

  Trabajador: capacidades + preferencias
    GET    /api/horario/trabajadores/<id>/puestos          capacidades
    PUT    /api/horario/trabajadores/<id>/puestos          [{puesto_id, nivel, preferente}]
    GET    /api/horario/trabajadores/<id>/preferencias
    PUT    /api/horario/trabajadores/<id>/preferencias

Fase 2 B.2 (planificacion manual + visualizacion):

  Plantillas reutilizables (turno_plantilla + sus bloques)
    GET    /api/horario/turno-plantillas
    GET    /api/horario/turno-plantillas/<id>
    POST   /api/horario/turno-plantillas
    PATCH  /api/horario/turno-plantillas/<id>
    DELETE /api/horario/turno-plantillas/<id>
    PUT    /api/horario/turno-plantillas/<id>/bloques

  Asignacion semanal (trabajador x fecha -> plantilla)
    GET    /api/horario/turno-asignaciones?fecha_lunes=YYYY-MM-DD
    PUT    /api/horario/turno-asignaciones/bulk

  Cobertura calculada (demanda vs asignaciones reales)
    GET    /api/horario/cobertura?fecha_lunes=YYYY-MM-DD&temporada_id=

El algoritmo automatico (B.3) vendra mas tarde.
"""
import logging
from flask import Blueprint, request, jsonify, g
from psycopg.types.json import Json

from ..auth import auth_required
from ..db import get_conn
from ..odoo_guard import require_feature
from ..audit_log import log_action, actor_from_request

bp = Blueprint('horario_planificacion', __name__)
log = logging.getLogger(__name__)


def _opt_str(v):
    if v is None: return None
    s = str(v).strip()
    return s or None

def _opt_int(v):
    if v in (None, ''): return None
    try: return int(v)
    except (TypeError, ValueError): return None

def _opt_num(v):
    if v in (None, ''): return None
    try: return float(v)
    except (TypeError, ValueError): return None

def _is_hhmm(s):
    if not s: return False
    s = str(s)
    if len(s) == 5 and s[2] == ':':
        try:
            h, m = int(s[:2]), int(s[3:])
            return 0 <= h <= 23 and 0 <= m <= 59
        except ValueError: return False
    return False


# ═══════════════════════════════════════════════════════════════════════════
# ║  TEMPORADAS                                                              ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/temporadas', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_temporadas():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, nombre, fecha_desde, fecha_hasta, activa, notas
              FROM temporada WHERE id_manager = %s
             ORDER BY (fecha_desde IS NULL) ASC, fecha_desde, nombre
        """, (str(g.id_manager),))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'temporadas': [{
        'id': r['id'], 'nombre': r['nombre'],
        'fecha_desde': r['fecha_desde'].isoformat() if r['fecha_desde'] else None,
        'fecha_hasta': r['fecha_hasta'].isoformat() if r['fecha_hasta'] else None,
        'activa': bool(r['activa']), 'notas': r['notas'] or '',
    } for r in rows]})


@bp.route('/temporadas', methods=['POST'])
@auth_required
@require_feature('control_horario')
def crear_temporada():
    d = request.get_json() or {}
    nombre = _opt_str(d.get('nombre'))
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_requerido'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO temporada (id_manager, nombre, fecha_desde, fecha_hasta, notas)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, nombre, fecha_desde, fecha_hasta, activa, notas
            """, (str(g.id_manager), nombre,
                  _opt_str(d.get('fecha_desde')), _opt_str(d.get('fecha_hasta')),
                  _opt_str(d.get('notas'))))
            r = cur.fetchone()
        except Exception as e:
            log.warning(f'crear_temporada: {e}')
            return jsonify({'ok': False, 'error': 'conflicto_o_invalido'}), 400
    log_action(actor_from_request(), entidad='temporada',
               entidad_id=r['id'], accion='crear', resumen=nombre)
    return jsonify({'ok': True, 'temporada': {
        'id': r['id'], 'nombre': r['nombre'],
        'fecha_desde': r['fecha_desde'].isoformat() if r['fecha_desde'] else None,
        'fecha_hasta': r['fecha_hasta'].isoformat() if r['fecha_hasta'] else None,
        'activa': bool(r['activa']), 'notas': r['notas'] or '',
    }})


@bp.route('/temporadas/<int:tid>', methods=['PATCH'])
@auth_required
@require_feature('control_horario')
def actualizar_temporada(tid):
    d = request.get_json() or {}
    sets, params = [], []
    for col, key, conv in (
        ('nombre',      'nombre',      _opt_str),
        ('fecha_desde', 'fecha_desde', _opt_str),
        ('fecha_hasta', 'fecha_hasta', _opt_str),
        ('notas',       'notas',       _opt_str),
        ('activa',      'activa',      lambda v: bool(v)),
    ):
        if key in d:
            sets.append(f'{col} = %s'); params.append(conv(d[key]))
    if not sets:
        return jsonify({'ok': False, 'error': 'sin_cambios'}), 400
    params.extend([tid, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE temporada SET {', '.join(sets)}, updated_at = NOW()
             WHERE id = %s AND id_manager = %s
            RETURNING id, nombre, fecha_desde, fecha_hasta, activa, notas
        """, params)
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='temporada',
               entidad_id=tid, accion='editar', resumen=r['nombre'])
    return jsonify({'ok': True, 'temporada': {
        'id': r['id'], 'nombre': r['nombre'],
        'fecha_desde': r['fecha_desde'].isoformat() if r['fecha_desde'] else None,
        'fecha_hasta': r['fecha_hasta'].isoformat() if r['fecha_hasta'] else None,
        'activa': bool(r['activa']), 'notas': r['notas'] or '',
    }})


@bp.route('/temporadas/<int:tid>', methods=['DELETE'])
@auth_required
@require_feature('control_horario')
def borrar_temporada(tid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM temporada WHERE id=%s AND id_manager=%s",
                    (tid, str(g.id_manager)))
        if cur.rowcount == 0:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='temporada',
               entidad_id=tid, accion='borrar', resumen='')
    return jsonify({'ok': True})


@bp.route('/temporadas/<int:tid>/apertura', methods=['GET'])
@auth_required
@require_feature('control_horario')
def get_apertura(tid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM temporada WHERE id=%s AND id_manager=%s",
                    (tid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""
            SELECT id, dia_semana, hora_inicio, hora_fin, orden
              FROM horario_apertura
             WHERE temporada_id = %s
             ORDER BY dia_semana, orden
        """, (tid,))
        rows = cur.fetchall()
    out = {str(d): [] for d in range(1, 8)}
    for r in rows:
        out[str(r['dia_semana'])].append({
            'id': r['id'],
            'hora_inicio': r['hora_inicio'].strftime('%H:%M'),
            'hora_fin':    r['hora_fin'].strftime('%H:%M'),
            'orden':       r['orden'],
        })
    return jsonify({'ok': True, 'apertura': out})


@bp.route('/temporadas/<int:tid>/apertura', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def put_apertura(tid):
    """Reemplaza el horario de apertura completo. Body: { apertura: {dia: [bloques]} }"""
    d = request.get_json() or {}
    apertura = d.get('apertura') or {}
    if not isinstance(apertura, dict):
        return jsonify({'ok': False, 'error': 'apertura_invalida'}), 400

    bloques = []
    for k, blocks in apertura.items():
        try:
            dia = int(k)
            if dia < 1 or dia > 7: raise ValueError
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'dia_invalido', 'detalle': k}), 400
        if not isinstance(blocks, list): continue
        bs = []
        for b in blocks:
            hi = (b.get('hora_inicio') or '').strip()
            hf = (b.get('hora_fin') or '').strip()
            if not _is_hhmm(hi) or not _is_hhmm(hf):
                return jsonify({'ok': False, 'error': 'hora_invalida',
                                'detalle': f'dia {dia}: {hi}-{hf}'}), 400
            if hi >= hf:
                return jsonify({'ok': False, 'error': 'rango_invalido',
                                'detalle': f'dia {dia}'}), 400
            bs.append((hi, hf))
        bs.sort()
        for h1, h2 in zip(bs, bs[1:]):
            if h2[0] < h1[1]:
                return jsonify({'ok': False, 'error': 'bloques_solapan',
                                'detalle': f'dia {dia}'}), 400
        for i, (hi, hf) in enumerate(bs, start=1):
            bloques.append((dia, hi, hf, i))

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM temporada WHERE id=%s AND id_manager=%s",
                    (tid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("DELETE FROM horario_apertura WHERE temporada_id = %s", (tid,))
        for (dia, hi, hf, orden) in bloques:
            cur.execute("""
                INSERT INTO horario_apertura
                  (temporada_id, dia_semana, hora_inicio, hora_fin, orden)
                VALUES (%s, %s, %s::TIME, %s::TIME, %s)
            """, (tid, dia, hi, hf, orden))
    log_action(actor_from_request(), entidad='temporada',
               entidad_id=tid, accion='apertura_editar',
               resumen=f'{len(bloques)} bloques')
    return jsonify({'ok': True, 'bloques': len(bloques)})


# ═══════════════════════════════════════════════════════════════════════════
# ║  PUESTOS                                                                 ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/puestos', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_puestos():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, codigo, nombre, color, descripcion, activo
              FROM puesto_trabajo WHERE id_manager = %s
             ORDER BY nombre
        """, (str(g.id_manager),))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'puestos': [{
        'id': r['id'], 'codigo': r['codigo'], 'nombre': r['nombre'],
        'color': r['color'], 'descripcion': r['descripcion'] or '',
        'activo': bool(r['activo']),
    } for r in rows]})


@bp.route('/puestos', methods=['POST'])
@auth_required
@require_feature('control_horario')
def crear_puesto():
    d = request.get_json() or {}
    codigo = _opt_str(d.get('codigo'))
    nombre = _opt_str(d.get('nombre'))
    if not codigo or not nombre:
        return jsonify({'ok': False, 'error': 'codigo_y_nombre_requeridos'}), 400
    codigo = codigo.lower()
    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO puesto_trabajo (id_manager, codigo, nombre, color, descripcion)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, codigo, nombre, color, descripcion, activo
            """, (str(g.id_manager), codigo, nombre,
                  _opt_str(d.get('color')) or 'cyan',
                  _opt_str(d.get('descripcion'))))
            r = cur.fetchone()
        except Exception as e:
            log.warning(f'crear_puesto: {e}')
            return jsonify({'ok': False, 'error': 'conflicto_o_invalido'}), 400
    log_action(actor_from_request(), entidad='puesto_trabajo',
               entidad_id=r['id'], accion='crear', resumen=nombre)
    return jsonify({'ok': True, 'puesto': {
        'id': r['id'], 'codigo': r['codigo'], 'nombre': r['nombre'],
        'color': r['color'], 'descripcion': r['descripcion'] or '',
        'activo': bool(r['activo']),
    }})


@bp.route('/puestos/<int:pid>', methods=['PATCH'])
@auth_required
@require_feature('control_horario')
def actualizar_puesto(pid):
    d = request.get_json() or {}
    sets, params = [], []
    for col, key, conv in (
        ('nombre',      'nombre',      _opt_str),
        ('color',       'color',       _opt_str),
        ('descripcion', 'descripcion', _opt_str),
        ('activo',      'activo',      lambda v: bool(v)),
    ):
        if key in d:
            sets.append(f'{col} = %s'); params.append(conv(d[key]))
    if not sets:
        return jsonify({'ok': False, 'error': 'sin_cambios'}), 400
    params.extend([pid, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE puesto_trabajo SET {', '.join(sets)}, updated_at = NOW()
             WHERE id = %s AND id_manager = %s
            RETURNING id, codigo, nombre, color, descripcion, activo
        """, params)
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'puesto': {
        'id': r['id'], 'codigo': r['codigo'], 'nombre': r['nombre'],
        'color': r['color'], 'descripcion': r['descripcion'] or '',
        'activo': bool(r['activo']),
    }})


@bp.route('/puestos/<int:pid>', methods=['DELETE'])
@auth_required
@require_feature('control_horario')
def borrar_puesto(pid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM puesto_trabajo WHERE id=%s AND id_manager=%s",
                    (pid, str(g.id_manager)))
        if cur.rowcount == 0:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True})


# Compatibilidad simétrica entre puestos. La guardamos siempre con a<b.
@bp.route('/puestos/compatibilidades', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_compatibilidades():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT pc.puesto_a_id, pc.puesto_b_id
              FROM puesto_compatible pc
              JOIN puesto_trabajo a ON a.id = pc.puesto_a_id
              JOIN puesto_trabajo b ON b.id = pc.puesto_b_id
             WHERE a.id_manager = %s AND b.id_manager = %s
        """, (str(g.id_manager), str(g.id_manager)))
        rows = cur.fetchall()
    return jsonify({'ok': True,
                    'pares': [[r['puesto_a_id'], r['puesto_b_id']] for r in rows]})


@bp.route('/puestos/compatibilidades', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def put_compatibilidades():
    """Body: { pares: [[a, b], [a, c], ...] }. Reemplaza la matriz entera."""
    d = request.get_json() or {}
    pares_raw = d.get('pares') or []
    if not isinstance(pares_raw, list):
        return jsonify({'ok': False, 'error': 'pares_invalido'}), 400
    pares_norm = set()
    for p in pares_raw:
        if not isinstance(p, (list, tuple)) or len(p) != 2: continue
        a, b = int(p[0]), int(p[1])
        if a == b: continue
        if a > b: a, b = b, a
        pares_norm.add((a, b))

    with get_conn() as conn, conn.cursor() as cur:
        # Verifica que todos los puestos pertenecen al manager
        if pares_norm:
            ids = {x for p in pares_norm for x in p}
            cur.execute("""
                SELECT id FROM puesto_trabajo
                 WHERE id = ANY(%s) AND id_manager = %s
            """, (list(ids), str(g.id_manager)))
            ok_ids = {r['id'] for r in cur.fetchall()}
            if ok_ids != ids:
                return jsonify({'ok': False, 'error': 'puesto_no_pertenece'}), 400
        # Borrar e insertar
        cur.execute("""
            DELETE FROM puesto_compatible pc
             USING puesto_trabajo a, puesto_trabajo b
             WHERE pc.puesto_a_id = a.id AND pc.puesto_b_id = b.id
               AND a.id_manager = %s AND b.id_manager = %s
        """, (str(g.id_manager), str(g.id_manager)))
        for (a, b) in pares_norm:
            cur.execute("""
                INSERT INTO puesto_compatible (puesto_a_id, puesto_b_id)
                VALUES (%s, %s)
            """, (a, b))
    return jsonify({'ok': True, 'pares': sorted(pares_norm)})


# ═══════════════════════════════════════════════════════════════════════════
# ║  DEMANDA POR PUESTO                                                      ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/puestos/<int:pid>/demanda', methods=['GET'])
@auth_required
@require_feature('control_horario')
def get_demanda(pid):
    temp = _opt_int(request.args.get('temporada_id'))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM puesto_trabajo WHERE id=%s AND id_manager=%s",
                    (pid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        sql = """
            SELECT id, temporada_id, dia_semana, hora_inicio, hora_fin,
                   n_trabajadores, notas
              FROM puesto_demanda
             WHERE puesto_id = %s AND id_manager = %s
        """
        params = [pid, str(g.id_manager)]
        if temp is not None:
            sql += " AND (temporada_id = %s OR temporada_id IS NULL)"
            params.append(temp)
        sql += " ORDER BY dia_semana, hora_inicio"
        cur.execute(sql, params)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'demanda': [{
        'id': r['id'], 'temporada_id': r['temporada_id'],
        'dia_semana': r['dia_semana'],
        'hora_inicio': r['hora_inicio'].strftime('%H:%M'),
        'hora_fin':    r['hora_fin'].strftime('%H:%M'),
        'n_trabajadores': r['n_trabajadores'],
        'notas': r['notas'] or '',
    } for r in rows]})


@bp.route('/puestos/<int:pid>/demanda', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def put_demanda(pid):
    """Reemplaza la demanda completa del puesto (todas las temporadas).

    Body: { filas: [{temporada_id?, dia_semana, hora_inicio, hora_fin,
                     n_trabajadores, notas?}] }
    """
    d = request.get_json() or {}
    filas = d.get('filas') or []
    if not isinstance(filas, list):
        return jsonify({'ok': False, 'error': 'filas_invalidas'}), 400

    norm = []
    for f in filas:
        try:
            dia = int(f.get('dia_semana'))
            if dia < 1 or dia > 7: raise ValueError
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'dia_invalido'}), 400
        hi = (f.get('hora_inicio') or '').strip()
        hf = (f.get('hora_fin') or '').strip()
        if not _is_hhmm(hi) or not _is_hhmm(hf):
            return jsonify({'ok': False, 'error': 'hora_invalida'}), 400
        if hi >= hf:
            return jsonify({'ok': False, 'error': 'rango_invalido'}), 400
        try:
            n = int(f.get('n_trabajadores', 1))
            if n < 1: raise ValueError
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'n_trabajadores_invalido'}), 400
        norm.append({
            'temporada_id': _opt_int(f.get('temporada_id')),
            'dia_semana': dia, 'hora_inicio': hi, 'hora_fin': hf,
            'n_trabajadores': n, 'notas': _opt_str(f.get('notas')),
        })

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM puesto_trabajo WHERE id=%s AND id_manager=%s",
                    (pid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""
            DELETE FROM puesto_demanda
             WHERE puesto_id = %s AND id_manager = %s
        """, (pid, str(g.id_manager)))
        for r in norm:
            cur.execute("""
                INSERT INTO puesto_demanda
                  (id_manager, puesto_id, temporada_id, dia_semana,
                   hora_inicio, hora_fin, n_trabajadores, notas)
                VALUES (%s, %s, %s, %s, %s::TIME, %s::TIME, %s, %s)
            """, (str(g.id_manager), pid, r['temporada_id'], r['dia_semana'],
                  r['hora_inicio'], r['hora_fin'], r['n_trabajadores'], r['notas']))
    return jsonify({'ok': True, 'filas': len(norm)})


# ═══════════════════════════════════════════════════════════════════════════
# ║  CAPACIDADES Y PREFERENCIAS DEL TRABAJADOR                              ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/trabajadores/<int:tid>/puestos', methods=['GET'])
@auth_required
@require_feature('control_horario')
def get_trabajador_puestos(tid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM trabajador WHERE id=%s AND id_manager=%s",
                    (tid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""
            SELECT tp.puesto_id, p.nombre AS puesto_nombre, p.color,
                   tp.nivel, tp.preferente
              FROM trabajador_puesto tp
              JOIN puesto_trabajo p ON p.id = tp.puesto_id
             WHERE tp.trabajador_id = %s AND p.id_manager = %s
             ORDER BY p.nombre
        """, (tid, str(g.id_manager)))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'puestos': [{
        'puesto_id': r['puesto_id'], 'puesto_nombre': r['puesto_nombre'],
        'color': r['color'], 'nivel': r['nivel'] or '',
        'preferente': bool(r['preferente']),
    } for r in rows]})


@bp.route('/trabajadores/<int:tid>/puestos', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def put_trabajador_puestos(tid):
    """Body: { puestos: [{puesto_id, nivel?, preferente?}, ...] }. Reemplaza."""
    d = request.get_json() or {}
    lst = d.get('puestos') or []
    if not isinstance(lst, list):
        return jsonify({'ok': False, 'error': 'puestos_invalido'}), 400
    norm = []
    seen = set()
    for x in lst:
        pid = _opt_int(x.get('puesto_id'))
        if not pid or pid in seen: continue
        seen.add(pid)
        norm.append({
            'puesto_id': pid,
            'nivel': _opt_str(x.get('nivel')),
            'preferente': bool(x.get('preferente')),
        })
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM trabajador WHERE id=%s AND id_manager=%s",
                    (tid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if norm:
            cur.execute("""
                SELECT id FROM puesto_trabajo
                 WHERE id = ANY(%s) AND id_manager = %s
            """, ([x['puesto_id'] for x in norm], str(g.id_manager)))
            ok_ids = {r['id'] for r in cur.fetchall()}
            for x in norm:
                if x['puesto_id'] not in ok_ids:
                    return jsonify({'ok': False, 'error': 'puesto_no_pertenece'}), 400
        cur.execute("DELETE FROM trabajador_puesto WHERE trabajador_id = %s", (tid,))
        for x in norm:
            cur.execute("""
                INSERT INTO trabajador_puesto (trabajador_id, puesto_id, nivel, preferente)
                VALUES (%s, %s, %s, %s)
            """, (tid, x['puesto_id'], x['nivel'], x['preferente']))
    return jsonify({'ok': True, 'puestos': len(norm)})


@bp.route('/trabajadores/<int:tid>/preferencias', methods=['GET'])
@auth_required
@require_feature('control_horario')
def get_preferencias(tid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM trabajador WHERE id=%s AND id_manager=%s",
                    (tid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""
            SELECT max_horas_semana, max_turnos_semana, prefiere_franja,
                   dias_libres_preferidos, acepta_partido, acepta_nocturno,
                   acepta_findesemana, notas
              FROM trabajador_preferencias
             WHERE trabajador_id = %s
        """, (tid,))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': True, 'preferencias': {
            'max_horas_semana': None, 'max_turnos_semana': None,
            'prefiere_franja': 'cualquiera', 'dias_libres_preferidos': [],
            'acepta_partido': True, 'acepta_nocturno': True,
            'acepta_findesemana': True, 'notas': '',
        }})
    return jsonify({'ok': True, 'preferencias': {
        'max_horas_semana': float(r['max_horas_semana']) if r['max_horas_semana'] is not None else None,
        'max_turnos_semana': r['max_turnos_semana'],
        'prefiere_franja': r['prefiere_franja'] or 'cualquiera',
        'dias_libres_preferidos': r['dias_libres_preferidos'] or [],
        'acepta_partido': bool(r['acepta_partido']),
        'acepta_nocturno': bool(r['acepta_nocturno']),
        'acepta_findesemana': bool(r['acepta_findesemana']),
        'notas': r['notas'] or '',
    }})


@bp.route('/trabajadores/<int:tid>/preferencias', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def put_preferencias(tid):
    d = request.get_json() or {}
    franja = (d.get('prefiere_franja') or 'cualquiera').strip().lower()
    if franja not in ('manana', 'tarde', 'noche', 'cualquiera'):
        franja = 'cualquiera'
    dias_libres = d.get('dias_libres_preferidos') or []
    if not isinstance(dias_libres, list): dias_libres = []
    dias_libres = sorted({int(x) for x in dias_libres if isinstance(x, (int, str)) and str(x).isdigit() and 1 <= int(x) <= 7})

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM trabajador WHERE id=%s AND id_manager=%s",
                    (tid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""
            INSERT INTO trabajador_preferencias
              (trabajador_id, max_horas_semana, max_turnos_semana,
               prefiere_franja, dias_libres_preferidos,
               acepta_partido, acepta_nocturno, acepta_findesemana, notas)
            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s)
            ON CONFLICT (trabajador_id) DO UPDATE SET
              max_horas_semana       = EXCLUDED.max_horas_semana,
              max_turnos_semana      = EXCLUDED.max_turnos_semana,
              prefiere_franja        = EXCLUDED.prefiere_franja,
              dias_libres_preferidos = EXCLUDED.dias_libres_preferidos,
              acepta_partido         = EXCLUDED.acepta_partido,
              acepta_nocturno        = EXCLUDED.acepta_nocturno,
              acepta_findesemana     = EXCLUDED.acepta_findesemana,
              notas                  = EXCLUDED.notas,
              updated_at             = NOW()
        """, (tid, _opt_num(d.get('max_horas_semana')), _opt_int(d.get('max_turnos_semana')),
              franja, Json(dias_libres),
              bool(d.get('acepta_partido', True)),
              bool(d.get('acepta_nocturno', True)),
              bool(d.get('acepta_findesemana', True)),
              _opt_str(d.get('notas'))))
    return jsonify({'ok': True})


# ═══════════════════════════════════════════════════════════════════════════
# ║  TURNO PLANTILLAS (B.2)                                                  ║
# ═══════════════════════════════════════════════════════════════════════════

def _row_to_plantilla(r):
    return {
        'id': r['id'], 'nombre': r['nombre'],
        'color': r['color'] or 'cyan',
        'notas': r['notas'] or '',
        'activo': bool(r['activo']),
    }


def _bloques_de_plantilla(cur, pid):
    cur.execute("""
        SELECT b.id, b.hora_inicio, b.hora_fin, b.tipo,
               b.puesto_id, p.nombre AS puesto_nombre, p.color AS puesto_color,
               b.orden
          FROM turno_plantilla_bloque b
          LEFT JOIN puesto_trabajo p ON p.id = b.puesto_id
         WHERE b.turno_plantilla_id = %s
         ORDER BY b.orden, b.hora_inicio
    """, (pid,))
    return [{
        'id': r['id'],
        'hora_inicio': r['hora_inicio'].strftime('%H:%M'),
        'hora_fin':    r['hora_fin'].strftime('%H:%M'),
        'tipo': r['tipo'],
        'puesto_id': r['puesto_id'],
        'puesto_nombre': r['puesto_nombre'] or '',
        'puesto_color':  r['puesto_color']  or '',
        'orden': r['orden'],
    } for r in cur.fetchall()]


@bp.route('/turno-plantillas', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_plantillas():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT p.id, p.nombre, p.color, p.notas, p.activo,
                   COUNT(b.id) AS n_bloques,
                   COALESCE(SUM(EXTRACT(EPOCH FROM (b.hora_fin - b.hora_inicio)))
                            FILTER (WHERE b.tipo = 'trabajo'), 0) AS seg_trabajo
              FROM turno_plantilla p
              LEFT JOIN turno_plantilla_bloque b ON b.turno_plantilla_id = p.id
             WHERE p.id_manager = %s OR p.id_manager IS NULL
             GROUP BY p.id
             ORDER BY p.nombre
        """, (str(g.id_manager),))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'plantillas': [{
        **_row_to_plantilla(r),
        'n_bloques': r['n_bloques'],
        'horas_trabajo': round(float(r['seg_trabajo'] or 0) / 3600.0, 2),
    } for r in rows]})


@bp.route('/turno-plantillas/<int:pid>', methods=['GET'])
@auth_required
@require_feature('control_horario')
def get_plantilla(pid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, nombre, color, notas, activo
              FROM turno_plantilla
             WHERE id = %s AND (id_manager = %s OR id_manager IS NULL)
        """, (pid, str(g.id_manager)))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        bloques = _bloques_de_plantilla(cur, pid)
    return jsonify({'ok': True, 'plantilla': {**_row_to_plantilla(r), 'bloques': bloques}})


@bp.route('/turno-plantillas', methods=['POST'])
@auth_required
@require_feature('control_horario')
def crear_plantilla():
    d = request.get_json() or {}
    nombre = _opt_str(d.get('nombre'))
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_requerido'}), 400
    color = _opt_str(d.get('color')) or 'cyan'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO turno_plantilla (id_manager, nombre, color, notas)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id_manager, nombre) DO NOTHING
            RETURNING id, nombre, color, notas, activo
        """, (str(g.id_manager), nombre, color, _opt_str(d.get('notas'))))
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'nombre_duplicado'}), 409
    log_action(actor_from_request(), entidad='turno_plantilla',
               entidad_id=r['id'], accion='crear',
               cambios={'nombre': nombre})
    return jsonify({'ok': True, 'plantilla': _row_to_plantilla(r)})


@bp.route('/turno-plantillas/<int:pid>', methods=['PATCH'])
@auth_required
@require_feature('control_horario')
def actualizar_plantilla(pid):
    d = request.get_json() or {}
    sets, params = [], []
    if 'nombre' in d:
        nombre = _opt_str(d.get('nombre'))
        if not nombre:
            return jsonify({'ok': False, 'error': 'nombre_requerido'}), 400
        sets.append('nombre = %s'); params.append(nombre)
    if 'color' in d:
        sets.append('color = %s'); params.append(_opt_str(d.get('color')) or 'cyan')
    if 'notas' in d:
        sets.append('notas = %s'); params.append(_opt_str(d.get('notas')))
    if 'activo' in d:
        sets.append('activo = %s'); params.append(bool(d.get('activo')))
    if not sets:
        return jsonify({'ok': True})
    sets.append('updated_at = NOW()')
    params.extend([pid, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE turno_plantilla SET {', '.join(sets)}
             WHERE id = %s AND id_manager = %s
             RETURNING id, nombre, color, notas, activo
        """, params)
        r = cur.fetchone()
        if not r:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='turno_plantilla',
               entidad_id=pid, accion='actualizar', cambios=d)
    return jsonify({'ok': True, 'plantilla': _row_to_plantilla(r)})


@bp.route('/turno-plantillas/<int:pid>', methods=['DELETE'])
@auth_required
@require_feature('control_horario')
def borrar_plantilla(pid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) AS n FROM turno_asignacion
             WHERE turno_plantilla_id = %s AND id_manager = %s
        """, (pid, str(g.id_manager)))
        if (cur.fetchone() or {}).get('n', 0) > 0:
            return jsonify({'ok': False, 'error': 'plantilla_en_uso'}), 409
        cur.execute("""
            DELETE FROM turno_plantilla
             WHERE id = %s AND id_manager = %s
             RETURNING id
        """, (pid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='turno_plantilla',
               entidad_id=pid, accion='borrar')
    return jsonify({'ok': True})


@bp.route('/turno-plantillas/<int:pid>/bloques', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def put_bloques(pid):
    """Body: { bloques: [{hora_inicio, hora_fin, tipo, puesto_id?, orden?}] }.
    Reemplaza la lista completa de bloques."""
    d = request.get_json() or {}
    bloques = d.get('bloques') or []
    if not isinstance(bloques, list):
        return jsonify({'ok': False, 'error': 'bloques_invalido'}), 400

    norm = []
    for i, b in enumerate(bloques):
        hi = (b.get('hora_inicio') or '').strip()
        hf = (b.get('hora_fin') or '').strip()
        if not _is_hhmm(hi) or not _is_hhmm(hf):
            return jsonify({'ok': False, 'error': 'hora_invalida'}), 400
        if hi >= hf:
            return jsonify({'ok': False, 'error': 'rango_invalido'}), 400
        tipo = (b.get('tipo') or 'trabajo').strip().lower()
        if tipo not in ('trabajo', 'comida', 'descanso', 'otros'):
            tipo = 'trabajo'
        puesto_id = _opt_int(b.get('puesto_id'))
        if tipo != 'trabajo':
            puesto_id = None
        norm.append({
            'hora_inicio': hi, 'hora_fin': hf, 'tipo': tipo,
            'puesto_id': puesto_id,
            'orden': _opt_int(b.get('orden')) or (i + 1),
        })

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM turno_plantilla
             WHERE id = %s AND id_manager = %s
        """, (pid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        # Validar que los puestos pertenecen al manager
        puestos = [b['puesto_id'] for b in norm if b['puesto_id']]
        if puestos:
            cur.execute("""
                SELECT id FROM puesto_trabajo
                 WHERE id = ANY(%s) AND id_manager = %s
            """, (puestos, str(g.id_manager)))
            ok_ids = {r['id'] for r in cur.fetchall()}
            for b in norm:
                if b['puesto_id'] and b['puesto_id'] not in ok_ids:
                    return jsonify({'ok': False, 'error': 'puesto_no_pertenece'}), 400
        cur.execute("DELETE FROM turno_plantilla_bloque WHERE turno_plantilla_id = %s", (pid,))
        for b in norm:
            cur.execute("""
                INSERT INTO turno_plantilla_bloque
                  (turno_plantilla_id, hora_inicio, hora_fin, tipo, puesto_id, orden)
                VALUES (%s, %s::TIME, %s::TIME, %s, %s, %s)
            """, (pid, b['hora_inicio'], b['hora_fin'], b['tipo'], b['puesto_id'], b['orden']))
        cur.execute("UPDATE turno_plantilla SET updated_at = NOW() WHERE id = %s", (pid,))
    log_action(actor_from_request(), entidad='turno_plantilla',
               entidad_id=pid, accion='bloques',
               cambios={'n': len(norm)})
    return jsonify({'ok': True, 'bloques': len(norm)})


# ═══════════════════════════════════════════════════════════════════════════
# ║  ASIGNACION SEMANAL (B.2)                                                ║
# ═══════════════════════════════════════════════════════════════════════════

import datetime as _dt


def _parse_lunes(s):
    """Acepta YYYY-MM-DD. Devuelve date del lunes de esa semana."""
    if not s:
        return None
    try:
        d = _dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        return None
    return d - _dt.timedelta(days=d.isoweekday() - 1)


@bp.route('/turno-asignaciones', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_asignaciones():
    lunes = _parse_lunes(request.args.get('fecha_lunes'))
    if not lunes:
        return jsonify({'ok': False, 'error': 'fecha_lunes_invalida'}), 400
    domingo = lunes + _dt.timedelta(days=6)
    with get_conn() as conn, conn.cursor() as cur:
        # Trabajadores activos del manager
        cur.execute("""
            SELECT t.id, t.cliente_idnoofit, t.nif, t.estado,
                   t.id_trainer_empleador,
                   COALESCE(t.nombre_completo, '') AS nombre_completo
              FROM trabajador t
             WHERE t.id_manager = %s AND t.estado = 'activo'
             ORDER BY t.id
        """, (str(g.id_manager),))
        trabajadores = [{
            'id': r['id'],
            'cliente_idnoofit': r['cliente_idnoofit'],
            'nif': r['nif'],
            'nombre': r['nombre_completo'] or '',
            'id_trainer_empleador': r['id_trainer_empleador'],
        } for r in cur.fetchall()]
        # Asignaciones del rango
        cur.execute("""
            SELECT a.id, a.trabajador_id, a.fecha, a.turno_plantilla_id,
                   a.notas,
                   p.nombre AS plantilla_nombre, p.color AS plantilla_color
              FROM turno_asignacion a
              LEFT JOIN turno_plantilla p ON p.id = a.turno_plantilla_id
             WHERE a.id_manager = %s
               AND a.fecha BETWEEN %s AND %s
             ORDER BY a.trabajador_id, a.fecha
        """, (str(g.id_manager), lunes, domingo))
        asign = [{
            'id': r['id'],
            'trabajador_id': r['trabajador_id'],
            'fecha': r['fecha'].isoformat(),
            'turno_plantilla_id': r['turno_plantilla_id'],
            'plantilla_nombre': r['plantilla_nombre'] or '',
            'plantilla_color':  r['plantilla_color']  or '',
            'libre': r['turno_plantilla_id'] is None,
            'notas': r['notas'] or '',
        } for r in cur.fetchall()]
    return jsonify({
        'ok': True,
        'fecha_lunes': lunes.isoformat(),
        'fecha_domingo': domingo.isoformat(),
        'trabajadores': trabajadores,
        'asignaciones': asign,
    })


@bp.route('/turno-asignaciones/bulk', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def bulk_asignaciones():
    """Body: { ops: [{trabajador_id, fecha, accion: 'asignar'|'libre'|'borrar',
                       turno_plantilla_id?, notas?}] }"""
    d = request.get_json() or {}
    ops = d.get('ops') or []
    if not isinstance(ops, list):
        return jsonify({'ok': False, 'error': 'ops_invalido'}), 400

    norm = []
    for o in ops:
        tid = _opt_int(o.get('trabajador_id'))
        fecha_s = (o.get('fecha') or '').strip()
        try:
            fecha = _dt.date.fromisoformat(fecha_s)
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'fecha_invalida'}), 400
        accion = (o.get('accion') or '').strip().lower()
        if accion not in ('asignar', 'libre', 'borrar'):
            return jsonify({'ok': False, 'error': 'accion_invalida'}), 400
        pl_id = _opt_int(o.get('turno_plantilla_id')) if accion == 'asignar' else None
        if accion == 'asignar' and not pl_id:
            return jsonify({'ok': False, 'error': 'plantilla_requerida'}), 400
        norm.append({
            'trabajador_id': tid, 'fecha': fecha, 'accion': accion,
            'turno_plantilla_id': pl_id, 'notas': _opt_str(o.get('notas')),
        })

    with get_conn() as conn, conn.cursor() as cur:
        # Validar trabajadores y plantillas pertenecen al manager
        tids = {x['trabajador_id'] for x in norm if x['trabajador_id']}
        if tids:
            cur.execute("""
                SELECT id FROM trabajador
                 WHERE id = ANY(%s) AND id_manager = %s
            """, (list(tids), str(g.id_manager)))
            ok_tids = {r['id'] for r in cur.fetchall()}
            for x in norm:
                if x['trabajador_id'] not in ok_tids:
                    return jsonify({'ok': False, 'error': 'trabajador_no_pertenece'}), 400
        pids = {x['turno_plantilla_id'] for x in norm if x['turno_plantilla_id']}
        if pids:
            cur.execute("""
                SELECT id FROM turno_plantilla
                 WHERE id = ANY(%s) AND (id_manager = %s OR id_manager IS NULL)
            """, (list(pids), str(g.id_manager)))
            ok_pids = {r['id'] for r in cur.fetchall()}
            for x in norm:
                if x['turno_plantilla_id'] and x['turno_plantilla_id'] not in ok_pids:
                    return jsonify({'ok': False, 'error': 'plantilla_no_pertenece'}), 400

        n_upsert, n_delete = 0, 0
        for x in norm:
            if x['accion'] == 'borrar':
                cur.execute("""
                    DELETE FROM turno_asignacion
                     WHERE trabajador_id = %s AND fecha = %s AND id_manager = %s
                """, (x['trabajador_id'], x['fecha'], str(g.id_manager)))
                n_delete += 1
            else:
                cur.execute("""
                    INSERT INTO turno_asignacion
                      (id_manager, trabajador_id, fecha, turno_plantilla_id, notas)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (trabajador_id, fecha) DO UPDATE SET
                      turno_plantilla_id = EXCLUDED.turno_plantilla_id,
                      notas              = EXCLUDED.notas,
                      updated_at         = NOW()
                """, (str(g.id_manager), x['trabajador_id'], x['fecha'],
                      x['turno_plantilla_id'], x['notas']))
                n_upsert += 1
    log_action(actor_from_request(), entidad='turno_asignacion',
               accion='bulk',
               cambios={'upsert': n_upsert, 'delete': n_delete})
    return jsonify({'ok': True, 'upsert': n_upsert, 'delete': n_delete})


# ═══════════════════════════════════════════════════════════════════════════
# ║  COBERTURA (demanda vs asignaciones reales) — B.2                        ║
# ═══════════════════════════════════════════════════════════════════════════

def _solapa(hi1, hf1, hi2, hf2):
    """True si los rangos [hi1,hf1) y [hi2,hf2) se solapan (HH:MM strings)."""
    return hi1 < hf2 and hi2 < hf1


@bp.route('/cobertura', methods=['GET'])
@auth_required
@require_feature('control_horario')
def cobertura():
    """Devuelve, para cada (fecha, puesto, franja demanda) de la semana, la
    cantidad de trabajadores requeridos vs asignados (segun plantilla del
    dia de cada trabajador). Tambien resumen por trabajador (horas semanales)
    y por puesto."""
    lunes = _parse_lunes(request.args.get('fecha_lunes'))
    if not lunes:
        return jsonify({'ok': False, 'error': 'fecha_lunes_invalida'}), 400
    temporada_id = _opt_int(request.args.get('temporada_id'))
    domingo = lunes + _dt.timedelta(days=6)

    with get_conn() as conn, conn.cursor() as cur:
        # 1) Demanda activa: si pasas temporada_id, ese + global (NULL);
        #    si no, todas.
        if temporada_id is not None:
            cur.execute("""
                SELECT puesto_id, dia_semana,
                       hora_inicio, hora_fin, n_trabajadores
                  FROM puesto_demanda
                 WHERE id_manager = %s
                   AND (temporada_id = %s OR temporada_id IS NULL)
                 ORDER BY dia_semana, hora_inicio
            """, (str(g.id_manager), temporada_id))
        else:
            cur.execute("""
                SELECT puesto_id, dia_semana,
                       hora_inicio, hora_fin, n_trabajadores
                  FROM puesto_demanda
                 WHERE id_manager = %s
                 ORDER BY dia_semana, hora_inicio
            """, (str(g.id_manager),))
        demanda = [{
            'puesto_id': r['puesto_id'], 'dia_semana': r['dia_semana'],
            'hora_inicio': r['hora_inicio'].strftime('%H:%M'),
            'hora_fin':    r['hora_fin'].strftime('%H:%M'),
            'requerido':   r['n_trabajadores'],
        } for r in cur.fetchall()]

        # 2) Puestos del manager
        cur.execute("""
            SELECT id, nombre, color FROM puesto_trabajo
             WHERE id_manager = %s
        """, (str(g.id_manager),))
        puestos = {r['id']: {'nombre': r['nombre'], 'color': r['color']}
                   for r in cur.fetchall()}

        # 2b) Pares compatibles (un trabajador en puesto X cubre tambien Y)
        cur.execute("""
            SELECT pc.puesto_a_id, pc.puesto_b_id
              FROM puesto_compatible pc
              JOIN puesto_trabajo p ON p.id = pc.puesto_a_id
             WHERE p.id_manager = %s
        """, (str(g.id_manager),))
        compat = {}
        for r in cur.fetchall():
            a, b = r['puesto_a_id'], r['puesto_b_id']
            compat.setdefault(a, set()).add(b)
            compat.setdefault(b, set()).add(a)

        # 3) Asignaciones de la semana con sus bloques expandidos
        cur.execute("""
            SELECT a.trabajador_id, a.fecha, a.turno_plantilla_id,
                   b.hora_inicio, b.hora_fin, b.tipo, b.puesto_id,
                   COALESCE(t.nombre_completo, '') AS nombre,
                   t.nif
              FROM turno_asignacion a
              JOIN trabajador t ON t.id = a.trabajador_id
              LEFT JOIN turno_plantilla_bloque b
                     ON b.turno_plantilla_id = a.turno_plantilla_id
             WHERE a.id_manager = %s
               AND a.fecha BETWEEN %s AND %s
        """, (str(g.id_manager), lunes, domingo))
        bloques_dia = []
        for r in cur.fetchall():
            if r['turno_plantilla_id'] is None:
                continue  # día libre
            if r['hora_inicio'] is None:
                continue
            bloques_dia.append({
                'trabajador_id': r['trabajador_id'],
                'trabajador_nombre': r['nombre'] or r['nif'] or f"#{r['trabajador_id']}",
                'fecha': r['fecha'].isoformat(),
                'hora_inicio': r['hora_inicio'].strftime('%H:%M'),
                'hora_fin':    r['hora_fin'].strftime('%H:%M'),
                'tipo': r['tipo'],
                'puesto_id': r['puesto_id'],
            })

    # 4) Calcular cobertura por (fecha, puesto, franja demanda)
    franjas = []
    deficits = 0
    excesos  = 0
    for off in range(7):
        fecha = lunes + _dt.timedelta(days=off)
        dia_iso = off + 1  # 1=lun..7=dom
        for f in demanda:
            if f['dia_semana'] != dia_iso:
                continue
            # Separar asignados exactos (puesto=el pedido) vs compatibles.
            # Los compatibles solo rellenan deficit; nunca generan exceso.
            asignados_exactos = set()
            compatibles_disp  = set()
            puestos_compat    = compat.get(f['puesto_id'], set())
            for b in bloques_dia:
                if b['fecha'] != fecha.isoformat(): continue
                if b['tipo'] != 'trabajo': continue
                if not _solapa(f['hora_inicio'], f['hora_fin'], b['hora_inicio'], b['hora_fin']): continue
                if b['puesto_id'] == f['puesto_id']:
                    asignados_exactos.add(b['trabajador_id'])
                elif b['puesto_id'] in puestos_compat:
                    compatibles_disp.add(b['trabajador_id'])
            exactos  = len(asignados_exactos)
            faltan   = max(0, f['requerido'] - exactos)
            usados_compat = min(faltan, len(compatibles_disp))
            asignado = exactos + usados_compat
            deficit  = max(0, f['requerido'] - asignado)
            exceso   = max(0, exactos - f['requerido'])  # solo los exactos
            # ids visibles: los exactos + los compatibles realmente usados
            asignados = set(asignados_exactos) | set(list(compatibles_disp)[:usados_compat])
            if deficit > 0: deficits += 1
            if exceso  > 0: excesos  += 1
            franjas.append({
                'fecha': fecha.isoformat(),
                'dia_semana': dia_iso,
                'puesto_id': f['puesto_id'],
                'puesto_nombre': puestos.get(f['puesto_id'], {}).get('nombre', ''),
                'puesto_color':  puestos.get(f['puesto_id'], {}).get('color', ''),
                'hora_inicio': f['hora_inicio'],
                'hora_fin':    f['hora_fin'],
                'requerido': f['requerido'],
                'asignado': asignado,
                'deficit': deficit,
                'exceso':  exceso,
                'estado': 'critico' if deficit > 0 else ('exceso' if exceso > 0 else 'ok'),
                'trabajadores_ids': sorted(asignados),
            })

    # 5) Resumen por trabajador: horas semanales trabajadas (suma bloques 'trabajo')
    por_trab = {}
    for b in bloques_dia:
        if b['tipo'] != 'trabajo': continue
        hi = b['hora_inicio']; hf = b['hora_fin']
        h1, m1 = int(hi[:2]), int(hi[3:])
        h2, m2 = int(hf[:2]), int(hf[3:])
        mins = (h2 * 60 + m2) - (h1 * 60 + m1)
        if mins <= 0: continue
        slot = por_trab.setdefault(b['trabajador_id'], {
            'trabajador_id': b['trabajador_id'],
            'trabajador_nombre': b['trabajador_nombre'],
            'minutos_trabajo': 0,
            'dias_trabajo': set(),
            'puestos': {},
        })
        slot['minutos_trabajo'] += mins
        slot['dias_trabajo'].add(b['fecha'])
        if b['puesto_id']:
            slot['puestos'][b['puesto_id']] = slot['puestos'].get(b['puesto_id'], 0) + mins
    resumen_trab = [{
        'trabajador_id': s['trabajador_id'],
        'trabajador_nombre': s['trabajador_nombre'],
        'horas_trabajo': round(s['minutos_trabajo'] / 60.0, 2),
        'dias_trabajo':  len(s['dias_trabajo']),
        'puestos': [{
            'puesto_id': pid,
            'puesto_nombre': puestos.get(pid, {}).get('nombre', ''),
            'horas': round(mins / 60.0, 2),
        } for pid, mins in sorted(s['puestos'].items(), key=lambda kv: -kv[1])],
    } for s in por_trab.values()]
    resumen_trab.sort(key=lambda x: -x['horas_trabajo'])

    return jsonify({
        'ok': True,
        'fecha_lunes': lunes.isoformat(),
        'fecha_domingo': domingo.isoformat(),
        'temporada_id': temporada_id,
        'franjas': franjas,
        'kpi': {
            'total_franjas': len(franjas),
            'franjas_criticas': deficits,
            'franjas_exceso':   excesos,
            'franjas_ok':       len(franjas) - deficits - excesos,
        },
        'resumen_trabajadores': resumen_trab,
    })


# ═══════════════════════════════════════════════════════════════════════════
# ║  CALENDARIO POR TRABAJADOR (vista expandible: dia x puestos)             ║
# ═══════════════════════════════════════════════════════════════════════════

def _bloques_semana(cur, id_manager, lunes, domingo):
    """Devuelve los bloques expandidos de la semana (con datos del trabajador)."""
    cur.execute("""
        SELECT a.trabajador_id, a.fecha, a.turno_plantilla_id,
               b.hora_inicio, b.hora_fin, b.tipo, b.puesto_id,
               COALESCE(t.nombre_completo, '') AS nombre, t.nif,
               p.nombre AS puesto_nombre, p.color AS puesto_color, p.codigo
          FROM turno_asignacion a
          JOIN trabajador t ON t.id = a.trabajador_id
          LEFT JOIN turno_plantilla_bloque b ON b.turno_plantilla_id = a.turno_plantilla_id
          LEFT JOIN puesto_trabajo p ON p.id = b.puesto_id
         WHERE a.id_manager = %s
           AND a.fecha BETWEEN %s AND %s
         ORDER BY a.trabajador_id, a.fecha, b.hora_inicio
    """, (str(id_manager), lunes, domingo))
    rows = []
    for r in cur.fetchall():
        if r['turno_plantilla_id'] is None or r['hora_inicio'] is None:
            continue
        rows.append({
            'trabajador_id': r['trabajador_id'],
            'trabajador_nombre': r['nombre'] or r['nif'] or f"#{r['trabajador_id']}",
            'fecha': r['fecha'].isoformat(),
            'hora_inicio': r['hora_inicio'].strftime('%H:%M'),
            'hora_fin':    r['hora_fin'].strftime('%H:%M'),
            'tipo': r['tipo'],
            'puesto_id': r['puesto_id'],
            'puesto_nombre': r['puesto_nombre'] or '',
            'puesto_color':  r['puesto_color']  or 'gray',
            'puesto_codigo': r['codigo'] or '',
        })
    return rows


def _mins(hi, hf):
    h1, m1 = int(hi[:2]), int(hi[3:])
    h2, m2 = int(hf[:2]), int(hf[3:])
    return max(0, (h2 * 60 + m2) - (h1 * 60 + m1))


@bp.route('/calendario-trabajador', methods=['GET'])
@auth_required
@require_feature('control_horario')
def calendario_trabajador():
    """Vista por trabajador: dias de la semana con bloques agrupados por puesto.
    Devuelve totales por dia y por semana."""
    lunes = _parse_lunes(request.args.get('fecha_lunes'))
    if not lunes:
        return jsonify({'ok': False, 'error': 'fecha_lunes_invalida'}), 400
    domingo = lunes + _dt.timedelta(days=6)

    with get_conn() as conn, conn.cursor() as cur:
        # Trabajadores activos
        cur.execute("""
            SELECT id, COALESCE(nombre_completo,'') AS nombre, nif, jornada_h_semana
              FROM trabajador
             WHERE id_manager = %s AND estado='activo'
             ORDER BY nombre_completo, id
        """, (str(g.id_manager),))
        trab_meta = {r['id']: {
            'id': r['id'],
            'nombre': r['nombre'] or r['nif'] or f"#{r['id']}",
            'nif': r['nif'] or '',
            'jornada_h_semana': float(r['jornada_h_semana']) if r['jornada_h_semana'] is not None else None,
        } for r in cur.fetchall()}

        bloques = _bloques_semana(cur, g.id_manager, lunes, domingo)

    # Estructura: {tid: {fecha: {puesto_id: {nombre, color, codigo, minutos, bloques:[(hi,hf)]}}}}
    data = {tid: {} for tid in trab_meta}
    for b in bloques:
        if b['tipo'] != 'trabajo':
            continue
        tid = b['trabajador_id']
        if tid not in data: continue
        dia = data[tid].setdefault(b['fecha'], {})
        slot = dia.setdefault(b['puesto_id'] or 0, {
            'puesto_id': b['puesto_id'],
            'puesto_nombre': b['puesto_nombre'] or 'Sin puesto',
            'puesto_color':  b['puesto_color'],
            'puesto_codigo': b['puesto_codigo'],
            'minutos': 0,
            'bloques': [],
        })
        slot['minutos'] += _mins(b['hora_inicio'], b['hora_fin'])
        slot['bloques'].append([b['hora_inicio'], b['hora_fin']])

    # Construir respuesta
    out = []
    for tid, meta in trab_meta.items():
        dias_out = []
        min_semana = 0
        puestos_semana = {}
        for off in range(7):
            fecha = (lunes + _dt.timedelta(days=off)).isoformat()
            por_puesto = data.get(tid, {}).get(fecha, {})
            puestos_lst = []
            min_dia = 0
            for p in sorted(por_puesto.values(), key=lambda x: -x['minutos']):
                puestos_lst.append({
                    'puesto_id': p['puesto_id'],
                    'puesto_nombre': p['puesto_nombre'],
                    'puesto_color':  p['puesto_color'],
                    'puesto_codigo': p['puesto_codigo'],
                    'horas': round(p['minutos'] / 60.0, 2),
                    'bloques': p['bloques'],
                })
                min_dia += p['minutos']
                puestos_semana[p['puesto_id']] = puestos_semana.get(p['puesto_id'], {
                    'puesto_id': p['puesto_id'],
                    'puesto_nombre': p['puesto_nombre'],
                    'puesto_color':  p['puesto_color'],
                    'puesto_codigo': p['puesto_codigo'],
                    'minutos': 0,
                })
                puestos_semana[p['puesto_id']]['minutos'] += p['minutos']
            min_semana += min_dia
            dias_out.append({
                'fecha': fecha,
                'dia_semana': off + 1,
                'horas': round(min_dia / 60.0, 2),
                'puestos': puestos_lst,
            })
        out.append({
            **meta,
            'horas_semana': round(min_semana / 60.0, 2),
            'horas_por_puesto': [{
                'puesto_id': v['puesto_id'],
                'puesto_nombre': v['puesto_nombre'],
                'puesto_color':  v['puesto_color'],
                'puesto_codigo': v['puesto_codigo'],
                'horas': round(v['minutos'] / 60.0, 2),
            } for v in sorted(puestos_semana.values(), key=lambda x: -x['minutos'])],
            'dias': dias_out,
        })

    return jsonify({
        'ok': True,
        'fecha_lunes': lunes.isoformat(),
        'fecha_domingo': domingo.isoformat(),
        'trabajadores': out,
    })


# ═══════════════════════════════════════════════════════════════════════════
# ║  EQUILIBRIO entre trabajadores (manana/tarde, partidos, fin de semana)   ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/equilibrio', methods=['GET'])
@auth_required
@require_feature('control_horario')
def equilibrio():
    """Compara la carga semanal entre trabajadores en varias dimensiones:
    horas totales, manana/tarde, turnos partidos, fin de semana, por puesto."""
    lunes = _parse_lunes(request.args.get('fecha_lunes'))
    if not lunes:
        return jsonify({'ok': False, 'error': 'fecha_lunes_invalida'}), 400
    domingo = lunes + _dt.timedelta(days=6)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, COALESCE(nombre_completo,'') AS nombre, nif, jornada_h_semana
              FROM trabajador
             WHERE id_manager = %s AND estado='activo'
             ORDER BY nombre_completo, id
        """, (str(g.id_manager),))
        trab_meta = {r['id']: {
            'id': r['id'],
            'nombre': r['nombre'] or r['nif'] or f"#{r['id']}",
            'jornada_h_semana': float(r['jornada_h_semana']) if r['jornada_h_semana'] is not None else None,
        } for r in cur.fetchall()}

        bloques = _bloques_semana(cur, g.id_manager, lunes, domingo)

    # Agrupar bloques por trabajador y fecha
    # tid -> fecha -> [(hi, hf, puesto_id, puesto_nombre, puesto_color)]
    por_tf = {}
    for b in bloques:
        if b['tipo'] != 'trabajo': continue
        por_tf.setdefault(b['trabajador_id'], {}).setdefault(b['fecha'], []).append(b)

    UMBRAL_MANANA_FIN = 14 * 60   # <14:00 cuenta como manana, >=14:00 tarde

    def minutos_manana(hi, hf):
        h1 = int(hi[:2]) * 60 + int(hi[3:])
        h2 = int(hf[:2]) * 60 + int(hf[3:])
        if h2 <= UMBRAL_MANANA_FIN: return h2 - h1
        if h1 >= UMBRAL_MANANA_FIN: return 0
        return UMBRAL_MANANA_FIN - h1

    out = []
    promedios = {'horas_total': 0, 'horas_manana': 0, 'horas_tarde': 0,
                 'horas_finde': 0, 'n_turnos': 0, 'dias_partidos': 0}
    for tid, meta in trab_meta.items():
        min_total = 0
        min_manana = 0
        min_finde = 0
        n_turnos = 0          # cada bloque cuenta como turno
        n_partidos = 0        # dias con >=2 bloques continuos separados por hueco >= 60min
        dias_trabajados = 0
        horas_por_puesto = {}
        horas_por_dia = []    # array 7 con horas
        for off in range(7):
            fecha = (lunes + _dt.timedelta(days=off)).isoformat()
            bls = sorted(por_tf.get(tid, {}).get(fecha, []), key=lambda x: x['hora_inicio'])
            if bls: dias_trabajados += 1
            # detectar partido: ordenar bloques y ver si hay hueco grande entre dos
            bloques_ordenados = [(int(b['hora_inicio'][:2])*60+int(b['hora_inicio'][3:]),
                                  int(b['hora_fin'][:2])*60+int(b['hora_fin'][3:]),
                                  b) for b in bls]
            es_partido = False
            if len(bloques_ordenados) >= 2:
                # fusionar adyacentes (hueco < 30 min) y luego ver si quedan >=2 grupos con hueco >=60
                grupos = [list(bloques_ordenados[0])]  # [[ini, fin, b], ...]
                for ini, fin, b in bloques_ordenados[1:]:
                    if ini - grupos[-1][1] < 30:
                        grupos[-1][1] = max(grupos[-1][1], fin)
                    else:
                        grupos.append([ini, fin, b])
                for i in range(1, len(grupos)):
                    if grupos[i][0] - grupos[i-1][1] >= 60:
                        es_partido = True
                        break
            if es_partido: n_partidos += 1

            min_dia = 0
            for b in bls:
                m = _mins(b['hora_inicio'], b['hora_fin'])
                min_total += m
                min_dia += m
                min_manana += minutos_manana(b['hora_inicio'], b['hora_fin'])
                if off + 1 >= 6:  # sabado o domingo
                    min_finde += m
                n_turnos += 1
                horas_por_puesto[b['puesto_id']] = horas_por_puesto.get(b['puesto_id'], {
                    'puesto_id': b['puesto_id'],
                    'puesto_nombre': b['puesto_nombre'],
                    'puesto_color':  b['puesto_color'],
                    'puesto_codigo': b['puesto_codigo'],
                    'minutos': 0,
                })
                horas_por_puesto[b['puesto_id']]['minutos'] += m
            horas_por_dia.append(round(min_dia / 60.0, 2))

        h_total  = round(min_total  / 60.0, 2)
        h_manana = round(min_manana / 60.0, 2)
        h_tarde  = round((min_total - min_manana) / 60.0, 2)
        h_finde  = round(min_finde  / 60.0, 2)

        promedios['horas_total']    += h_total
        promedios['horas_manana']   += h_manana
        promedios['horas_tarde']    += h_tarde
        promedios['horas_finde']    += h_finde
        promedios['n_turnos']       += n_turnos
        promedios['dias_partidos']  += n_partidos

        # cumplimiento jornada
        jor = meta['jornada_h_semana']
        cumple_pct = None
        if jor and jor > 0:
            cumple_pct = round(100.0 * h_total / jor, 1)

        out.append({
            **meta,
            'horas_total':   h_total,
            'horas_manana':  h_manana,
            'horas_tarde':   h_tarde,
            'horas_finde':   h_finde,
            'horas_por_dia': horas_por_dia,
            'n_turnos':      n_turnos,
            'dias_partidos': n_partidos,
            'dias_trabajados': dias_trabajados,
            'cumple_jornada_pct': cumple_pct,
            'horas_por_puesto': [{
                'puesto_id': v['puesto_id'],
                'puesto_nombre': v['puesto_nombre'],
                'puesto_color':  v['puesto_color'],
                'puesto_codigo': v['puesto_codigo'],
                'horas': round(v['minutos'] / 60.0, 2),
            } for v in sorted(horas_por_puesto.values(), key=lambda x: -x['minutos'])],
        })

    n = len(out) or 1
    return jsonify({
        'ok': True,
        'fecha_lunes': lunes.isoformat(),
        'fecha_domingo': domingo.isoformat(),
        'trabajadores': out,
        'promedio': {
            'horas_total':   round(promedios['horas_total']   / n, 2),
            'horas_manana':  round(promedios['horas_manana']  / n, 2),
            'horas_tarde':   round(promedios['horas_tarde']   / n, 2),
            'horas_finde':   round(promedios['horas_finde']   / n, 2),
            'n_turnos':      round(promedios['n_turnos']      / n, 1),
            'dias_partidos': round(promedios['dias_partidos'] / n, 1),
        },
    })


# ═══════════════════════════════════════════════════════════════════════════
# ║  REPLICACION DE ASIGNACIONES (copiar semana, replicar N, patron rotativo)║
# ═══════════════════════════════════════════════════════════════════════════

def _copiar_asignaciones(cur, id_manager, lunes_origen, lunes_destino, replace):
    """Copia las asignaciones de la semana lunes_origen a lunes_destino.
    Si replace=True, borra antes lo que hubiera en destino.
    Devuelve (n_copiadas, n_borradas)."""
    domingo_destino = lunes_destino + _dt.timedelta(days=6)
    n_borradas = 0
    if replace:
        cur.execute("""
            DELETE FROM turno_asignacion
             WHERE id_manager = %s
               AND fecha BETWEEN %s AND %s
        """, (str(id_manager), lunes_destino, domingo_destino))
        n_borradas = cur.rowcount or 0
    # Origen
    domingo_origen = lunes_origen + _dt.timedelta(days=6)
    cur.execute("""
        SELECT trabajador_id, fecha, turno_plantilla_id, notas
          FROM turno_asignacion
         WHERE id_manager = %s
           AND fecha BETWEEN %s AND %s
    """, (str(id_manager), lunes_origen, domingo_origen))
    rows = cur.fetchall()
    delta = (lunes_destino - lunes_origen).days
    n_copiadas = 0
    for r in rows:
        nueva_fecha = r['fecha'] + _dt.timedelta(days=delta)
        cur.execute("""
            INSERT INTO turno_asignacion
              (id_manager, trabajador_id, fecha, turno_plantilla_id, notas)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (trabajador_id, fecha) DO UPDATE SET
              turno_plantilla_id = EXCLUDED.turno_plantilla_id,
              notas              = EXCLUDED.notas,
              updated_at         = NOW()
        """, (str(id_manager), r['trabajador_id'], nueva_fecha,
              r['turno_plantilla_id'], r['notas']))
        n_copiadas += 1
    return n_copiadas, n_borradas


@bp.route('/turno-asignaciones/copiar-semana', methods=['POST'])
@auth_required
@require_feature('control_horario')
def copiar_semana():
    """Copia las asignaciones de una semana origen a una semana destino.
    Body: { desde_lunes: 'YYYY-MM-DD', hasta_lunes: 'YYYY-MM-DD', replace: true }"""
    d = request.get_json() or {}
    origen = _parse_lunes(d.get('desde_lunes'))
    destino = _parse_lunes(d.get('hasta_lunes'))
    if not origen or not destino:
        return jsonify({'ok': False, 'error': 'fechas_invalidas'}), 400
    if origen == destino:
        return jsonify({'ok': False, 'error': 'mismo_origen_destino'}), 400
    replace = bool(d.get('replace', True))
    with get_conn() as conn, conn.cursor() as cur:
        n_cop, n_del = _copiar_asignaciones(cur, g.id_manager, origen, destino, replace)
    log_action(actor_from_request(), entidad='turno_asignacion',
               accion='copiar_semana',
               cambios={'origen': origen.isoformat(), 'destino': destino.isoformat(),
                        'copiadas': n_cop, 'borradas': n_del, 'replace': replace})
    return jsonify({'ok': True, 'copiadas': n_cop, 'borradas': n_del})


@bp.route('/turno-asignaciones/replicar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def replicar_semana():
    """Replica una semana origen en las N semanas SIGUIENTES.
    Body: { desde_lunes, num_semanas: 4, replace: true }"""
    d = request.get_json() or {}
    origen = _parse_lunes(d.get('desde_lunes'))
    try:
        num = int(d.get('num_semanas', 1))
        if num < 1 or num > 52: raise ValueError
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'num_semanas_invalido'}), 400
    if not origen:
        return jsonify({'ok': False, 'error': 'fecha_invalida'}), 400
    replace = bool(d.get('replace', True))
    total_cop = 0
    total_del = 0
    with get_conn() as conn, conn.cursor() as cur:
        for i in range(1, num + 1):
            destino = origen + _dt.timedelta(days=7 * i)
            c, b = _copiar_asignaciones(cur, g.id_manager, origen, destino, replace)
            total_cop += c
            total_del += b
    log_action(actor_from_request(), entidad='turno_asignacion',
               accion='replicar_semana',
               cambios={'origen': origen.isoformat(), 'num_semanas': num,
                        'copiadas': total_cop, 'borradas': total_del})
    return jsonify({'ok': True, 'semanas': num,
                    'copiadas': total_cop, 'borradas': total_del})


@bp.route('/turno-asignaciones/patron-rotativo', methods=['POST'])
@auth_required
@require_feature('control_horario')
def patron_rotativo():
    """Aplica un patron ciclico A,B,C,... de semanas origen durante N ciclos.
    Body: { semanas_origen: ['YYYY-MM-DD', 'YYYY-MM-DD', ...],
            desde_lunes: 'YYYY-MM-DD',  // primer destino
            num_ciclos: 4, replace: true }"""
    d = request.get_json() or {}
    origenes_raw = d.get('semanas_origen') or []
    if not isinstance(origenes_raw, list) or len(origenes_raw) < 2:
        return jsonify({'ok': False, 'error': 'minimo_2_semanas_origen'}), 400
    origenes = [_parse_lunes(s) for s in origenes_raw]
    if any(o is None for o in origenes):
        return jsonify({'ok': False, 'error': 'fecha_origen_invalida'}), 400
    destino_inicial = _parse_lunes(d.get('desde_lunes'))
    if not destino_inicial:
        return jsonify({'ok': False, 'error': 'desde_lunes_invalida'}), 400
    try:
        ciclos = int(d.get('num_ciclos', 1))
        if ciclos < 1 or ciclos > 52: raise ValueError
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'num_ciclos_invalido'}), 400
    replace = bool(d.get('replace', True))
    total_cop = 0
    total_del = 0
    total_semanas = ciclos * len(origenes)
    with get_conn() as conn, conn.cursor() as cur:
        for k in range(total_semanas):
            origen = origenes[k % len(origenes)]
            destino = destino_inicial + _dt.timedelta(days=7 * k)
            if destino == origen:
                continue
            c, b = _copiar_asignaciones(cur, g.id_manager, origen, destino, replace)
            total_cop += c
            total_del += b
    log_action(actor_from_request(), entidad='turno_asignacion',
               accion='patron_rotativo',
               cambios={'origenes': [o.isoformat() for o in origenes],
                        'destino_inicial': destino_inicial.isoformat(),
                        'ciclos': ciclos, 'copiadas': total_cop, 'borradas': total_del})
    return jsonify({'ok': True, 'semanas_aplicadas': total_semanas,
                    'copiadas': total_cop, 'borradas': total_del})


# ═══════════════════════════════════════════════════════════════════════════
# ║  VISTA MENSUAL (read-only, todo el mes en una sola llamada)              ║
# ═══════════════════════════════════════════════════════════════════════════

@bp.route('/turno-asignaciones-mes', methods=['GET'])
@auth_required
@require_feature('control_horario')
def asignaciones_mes():
    """Devuelve asignaciones de un mes natural (extendido a semanas completas).
    Query: ?mes=YYYY-MM"""
    mes_str = (request.args.get('mes') or '').strip()
    try:
        anio, mes = mes_str.split('-')
        anio, mes = int(anio), int(mes)
        primer_dia = _dt.date(anio, mes, 1)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'mes_invalido'}), 400
    # Lunes de la primera semana (puede caer en mes anterior)
    primer_lunes = primer_dia - _dt.timedelta(days=primer_dia.isoweekday() - 1)
    # Ultimo dia del mes
    if mes == 12:
        ultimo_dia = _dt.date(anio, 12, 31)
    else:
        ultimo_dia = _dt.date(anio, mes + 1, 1) - _dt.timedelta(days=1)
    # Domingo de la ultima semana (puede caer en mes siguiente)
    ultimo_domingo = ultimo_dia + _dt.timedelta(days=7 - ultimo_dia.isoweekday())

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, COALESCE(nombre_completo,'') AS nombre, nif
              FROM trabajador
             WHERE id_manager = %s AND estado='activo'
             ORDER BY nombre_completo, id
        """, (str(g.id_manager),))
        trabajadores = [{
            'id': r['id'],
            'nombre': r['nombre'] or r['nif'] or f"#{r['id']}",
            'nif': r['nif'] or '',
        } for r in cur.fetchall()]

        cur.execute("""
            SELECT a.trabajador_id, a.fecha, a.turno_plantilla_id,
                   p.nombre AS plantilla_nombre, p.color AS plantilla_color
              FROM turno_asignacion a
              LEFT JOIN turno_plantilla p ON p.id = a.turno_plantilla_id
             WHERE a.id_manager = %s
               AND a.fecha BETWEEN %s AND %s
             ORDER BY a.trabajador_id, a.fecha
        """, (str(g.id_manager), primer_lunes, ultimo_domingo))
        asign = [{
            'trabajador_id': r['trabajador_id'],
            'fecha': r['fecha'].isoformat(),
            'turno_plantilla_id': r['turno_plantilla_id'],
            'plantilla_nombre': r['plantilla_nombre'] or 'Libre',
            'plantilla_color':  r['plantilla_color']  or 'gray',
            'libre': r['turno_plantilla_id'] is None,
        } for r in cur.fetchall()]

    # Estructura por trabajador → fecha → asignacion
    return jsonify({
        'ok': True,
        'mes': mes_str,
        'primer_lunes': primer_lunes.isoformat(),
        'ultimo_domingo': ultimo_domingo.isoformat(),
        'primer_dia_mes': primer_dia.isoformat(),
        'ultimo_dia_mes': ultimo_dia.isoformat(),
        'trabajadores': trabajadores,
        'asignaciones': asign,
    })
