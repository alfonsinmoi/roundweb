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

Sin algoritmo de asignación todavía — solo la base de datos configurada.
La planificación manual + visualización + algoritmo vienen en B.2 y B.3.
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
