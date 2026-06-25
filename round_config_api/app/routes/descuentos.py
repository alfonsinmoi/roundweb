"""CRUD de descuentos (mismo patrón que cuotas)."""
import logging
from functools import wraps
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission, _has_permission
from ..db import get_conn
from ..odoo_sync import get_sync
from ..audit_log import log_action, actor_from_request
from .. import config

bp = Blueprint('descuentos', __name__)
log = logging.getLogger(__name__)


def require_any_permission(*paths):
    """Como `require_permission` pero pasa si el perfil tiene CUALQUIERA de
    los permisos dados (OR). Útil cuando una misma acción se puede conceder
    desde dos sitios del árbol de permisos. Caso de uso: asignar/quitar un
    descuento a un cliente, que el manager concede de forma natural bajo
    'Cuotas asignadas del cliente' (`cuotas_clientes.asignar_descuento`) pero
    que históricamente solo miraba el permiso de catálogo
    (`configuracion.descuentos.asignar_a_cliente`). Aceptar ambos no rompe los
    perfiles antiguos y hace que el toggle intuitivo por fin funcione.

    Debe ir DESPUÉS de `@auth_required` (que carga `g.perfil`)."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            perfil = getattr(g, 'perfil', None)
            if not any(_has_permission(perfil, p) for p in paths):
                try:
                    log_action(actor_from_request(),
                               entidad='permission_check',
                               entidad_id=paths[0],
                               accion='denied',
                               resumen=(f'perm_any={list(paths)} '
                                        f'perfil={perfil.get("nombre") if perfil else "?"}'))
                except Exception:
                    pass
                return jsonify({'ok': False, 'error': 'permission_denied',
                                'perm': list(paths)}), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco

FIELDS = ("id, scope, id_manager, id_trainer, plantilla_origen_id, codigo, "
          "descripcion, tipo, valor, unidad, active, odoo_id, "
          "cuota_requerida_codigo, cuota_aplicada_codigo, precio_final, "
          "combo_secundarias, actividades_idnoofit, "
          "created_at, updated_at")


def _row(r):
    if not r: return None
    out = dict(r)
    for k in ('created_at','updated_at'):
        if out.get(k): out[k] = out[k].isoformat()
    if out.get('valor') is not None:
        out['valor'] = float(out['valor'])
    if out.get('precio_final') is not None:
        out['precio_final'] = float(out['precio_final'])
    # combo_secundarias normalizado: lista de {cuota_codigo, precio}
    cs = out.get('combo_secundarias')
    if cs is None:
        out['combo_secundarias'] = []
    elif isinstance(cs, str):
        try:
            import json as _j
            out['combo_secundarias'] = _j.loads(cs)
        except Exception:
            out['combo_secundarias'] = []
    # actividades_idnoofit (filtro por actividad de descuentos 'importe')
    ai = out.get('actividades_idnoofit')
    if ai is None:
        out['actividades_idnoofit'] = []
    elif isinstance(ai, str):
        try:
            import json as _j
            out['actividades_idnoofit'] = _j.loads(ai)
        except Exception:
            out['actividades_idnoofit'] = []
    return out


@bp.route('', methods=['GET'])
@auth_required
def list_():
    with get_conn() as conn, conn.cursor() as cur:
        if g.id_trainer:
            # Para un trainer: sus descuentos adoptados (scope='trainer') + las
            # plantillas del manager que AÚN NO haya adoptado. Si ya adoptó una
            # plantilla (tiene copia trainer con el mismo codigo), NO mostramos
            # también la plantilla → evita que el descuento salga dos veces al
            # asignarlo a un cliente.
            cur.execute(f"""SELECT {FIELDS} FROM descuento d
                WHERE id_manager=%s AND (
                    (scope='trainer' AND id_trainer=%s)
                    OR (scope='plantilla_manager'
                        AND NOT EXISTS (SELECT 1 FROM descuento t
                                         WHERE t.id_manager=d.id_manager
                                           AND t.scope='trainer' AND t.id_trainer=%s
                                           AND t.codigo=d.codigo)))
                ORDER BY scope, codigo""",
                (g.id_manager, g.id_trainer, g.id_trainer))
        else:
            cur.execute(f"""SELECT {FIELDS} FROM descuento
                WHERE id_manager=%s ORDER BY scope, id_trainer NULLS FIRST, codigo""",
                (g.id_manager,))
        return jsonify({'ok': True, 'descuentos': [_row(r) for r in cur.fetchall()]})


@bp.route('', methods=['POST'])
@auth_required
@require_permission('configuracion.descuentos.crear')
def create():
    d = request.get_json() or {}
    if d.get('tipo') not in config.TIPOS_DESCUENTO:
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    if not d.get('codigo'):
        return jsonify({'ok': False, 'error': 'codigo_obligatorio'}), 400
    # Validar campos del tipo precio_combo (legacy: cuota_aplicada única)
    if d['tipo'] == 'precio_combo':
        if not d.get('cuota_requerida_codigo') or not d.get('cuota_aplicada_codigo'):
            return jsonify({'ok': False, 'error':
                'precio_combo requiere cuota_requerida_codigo y cuota_aplicada_codigo'}), 400
        if d.get('precio_final') is None:
            return jsonify({'ok': False, 'error':
                'precio_combo requiere precio_final'}), 400
    # Validar campos del tipo varias_cuotas (nuevo: lista de cuotas secundarias)
    if d['tipo'] == 'varias_cuotas':
        if not d.get('cuota_requerida_codigo'):
            return jsonify({'ok': False, 'error':
                'varias_cuotas requiere cuota_requerida_codigo'}), 400
        cs = d.get('combo_secundarias') or []
        if not isinstance(cs, list) or not cs:
            return jsonify({'ok': False, 'error':
                'varias_cuotas requiere combo_secundarias no vacío'}), 400
        for item in cs:
            if not isinstance(item, dict) or not item.get('cuota_codigo'):
                return jsonify({'ok': False, 'error':
                    'cada combo_secundarias debe ser {cuota_codigo, precio}'}), 400
            if item.get('precio') is None:
                return jsonify({'ok': False, 'error':
                    'cada combo debe tener precio'}), 400
    # Validar campos del tipo familiares (descuento automático por grupo familiar)
    # Para familiares: combo_secundarias = [{cuota_codigo, valor, unidad}]
    # con un descuento independiente por actividad.
    if d['tipo'] == 'familiares':
        cs = d.get('combo_secundarias') or []
        if not isinstance(cs, list) or not cs:
            return jsonify({'ok': False, 'error':
                'familiares requiere combo_secundarias=[{cuota_codigo,valor,unidad}] no vacío'}), 400
        for item in cs:
            if not isinstance(item, dict) or not item.get('cuota_codigo'):
                return jsonify({'ok': False, 'error':
                    'cada entrada familiares debe ser {cuota_codigo,valor,unidad}'}), 400
            u = item.get('unidad')
            if u not in ('porcentaje', 'importe'):
                return jsonify({'ok': False, 'error':
                    f'unidad inválida para {item.get("cuota_codigo")}: {u}'}), 400
            v = item.get('valor')
            if v is None or float(v) <= 0:
                return jsonify({'ok': False, 'error':
                    f'valor inválido para {item.get("cuota_codigo")}'}), 400
    import json as _json_mod
    # POLÍTICA (mayo 2026): por DEFECTO una regla se guarda como
    # `plantilla_manager` para que aplique a todos los trainers del manager.
    # Solo se crea trainer-scoped si el body lo pide explícitamente con
    # `scope='trainer'` (+ opcional `id_trainer`). El hecho de que el operador
    # esté impersonando un trainer al crearla NO la limita automáticamente
    # a ese trainer — debe poder reutilizarse en otros centros.
    body_scope = (d.get('scope') or '').strip().lower()
    if body_scope == 'trainer':
        scope = 'trainer'
        id_trainer = (d.get('id_trainer') or '').strip() or g.id_trainer
        if not id_trainer:
            return jsonify({'ok': False,
                            'error': 'scope=trainer requiere id_trainer'}), 400
    else:
        scope = 'plantilla_manager'
        id_trainer = None
    combo_json = _json_mod.dumps(d.get('combo_secundarias') or [])
    acts_json = _json_mod.dumps(d.get('actividades_idnoofit') or [])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            INSERT INTO descuento (scope, id_manager, id_trainer, plantilla_origen_id,
              codigo, descripcion, tipo, valor, unidad, active,
              cuota_requerida_codigo, cuota_aplicada_codigo, precio_final,
              combo_secundarias, actividades_idnoofit)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)
            RETURNING {FIELDS}
        """, (scope, g.id_manager, id_trainer, d.get('plantilla_origen_id'),
              d['codigo'], d.get('descripcion'), d['tipo'], d.get('valor', 0),
              d.get('unidad'),
              d.get('active', True),
              d.get('cuota_requerida_codigo'), d.get('cuota_aplicada_codigo'),
              d.get('precio_final'), combo_json, acts_json))
        row = cur.fetchone()
    if scope == 'plantilla_manager':
        oid = get_sync(g.id_manager).descuento_create(row)
        if oid and isinstance(oid, int):
            with get_conn() as conn2, conn2.cursor() as cur2:
                cur2.execute("UPDATE descuento SET odoo_id=%s WHERE id=%s", (oid, row['id']))
            row['odoo_id'] = oid
    log_action(actor_from_request(), 'descuento', 'create',
               entidad_id=row['id'],
               resumen=f"Alta descuento {row.get('codigo')}",
               cambios={'codigo': row.get('codigo'), 'tipo': row.get('tipo'),
                        'valor': d.get('valor', 0), 'unidad': row.get('unidad'),
                        'scope': scope})
    return jsonify({'ok': True, 'descuento': _row(row)}), 201


@bp.route('/<int:_id>', methods=['PUT', 'PATCH'])
@auth_required
@require_permission('configuracion.descuentos.editar')
def update(_id):
    d = request.get_json() or {}
    if 'tipo' in d and d['tipo'] not in config.TIPOS_DESCUENTO:
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    allowed = ('codigo','descripcion','tipo','valor','unidad','active',
               'cuota_requerida_codigo','cuota_aplicada_codigo','precio_final')
    sets, params = [], []
    for k in allowed:
        if k in d:
            sets.append(f"{k}=%s"); params.append(d[k])
    # combo_secundarias necesita cast a jsonb
    if 'combo_secundarias' in d:
        import json as _json_mod
        sets.append('combo_secundarias=%s::jsonb')
        params.append(_json_mod.dumps(d.get('combo_secundarias') or []))
    if 'actividades_idnoofit' in d:
        import json as _json_mod
        sets.append('actividades_idnoofit=%s::jsonb')
        params.append(_json_mod.dumps(d.get('actividades_idnoofit') or []))
    if not sets:
        return jsonify({'ok': False, 'error': 'no_changes'}), 400
    params.extend([_id, g.id_manager])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE descuento SET {','.join(sets)} WHERE id=%s AND id_manager=%s RETURNING {FIELDS}", params)
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if r['scope'] == 'plantilla_manager':
        if r.get('odoo_id'):
            get_sync(g.id_manager).descuento_update(r['odoo_id'], r)
        else:
            oid = get_sync(g.id_manager).descuento_create(r)
            if oid and isinstance(oid, int):
                with get_conn() as conn2, conn2.cursor() as cur2:
                    cur2.execute("UPDATE descuento SET odoo_id=%s WHERE id=%s", (oid, r['id']))
                r['odoo_id'] = oid
    log_action(actor_from_request(), 'descuento', 'update',
               entidad_id=_id,
               resumen=f"Edición descuento {r.get('codigo')}",
               cambios={k: d[k] for k in d if k in allowed
                        or k in ('combo_secundarias', 'actividades_idnoofit')})
    return jsonify({'ok': True, 'descuento': _row(r)})


@bp.route('/<int:_id>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.descuentos.borrar')
def delete(_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT odoo_id, scope FROM descuento WHERE id=%s AND id_manager=%s", (_id, g.id_manager))
        r = cur.fetchone()
        cur.execute("DELETE FROM descuento WHERE id=%s AND id_manager=%s", (_id, g.id_manager))
        n = cur.rowcount
    if r and r.get('odoo_id') and r.get('scope') == 'plantilla_manager':
        get_sync(g.id_manager).descuento_delete(r['odoo_id'])
    if n:
        log_action(actor_from_request(), 'descuento', 'delete',
                   entidad_id=_id,
                   resumen=f"Baja descuento id={_id}",
                   cambios={'scope': r.get('scope') if r else None,
                            'odoo_id': r.get('odoo_id') if r else None})
    return jsonify({'ok': True, 'deleted': n})


# ── ASIGNACIONES de descuento a uno o varios clientes ──────────────────────

ASIGN_FIELDS = """id, descuento_id, id_manager, id_trainer, cliente_idnoofit,
                  fecha_desde, fecha_hasta, estado, odoo_id, created_at, updated_at,
                  trabajador_id, relacion"""

def _asig_row(r):
    if not r: return None
    out = dict(r)
    for k in ('created_at','updated_at','fecha_desde','fecha_hasta'):
        if out.get(k): out[k] = out[k].isoformat()
    return out


@bp.route('/<int:desc_id>/asignaciones', methods=['GET'])
@auth_required
def list_asignaciones(desc_id):
    """Lista clientes a quienes se aplica un descuento.

    Para descuentos normales: lee de `descuento_asignacion` (asignación manual).
    Para descuentos tipo='familiares': calcula dinámicamente las familias del
    manager con ≥2 miembros que tienen activa la cuota_aplicada_codigo y los
    devuelve agrupados (`familias`).

    En ambos casos enriquece con `cliente_nombre` desde res.partner en Odoo.
    """
    # Cargar descuento para saber tipo + sus actividades (familiares)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, tipo, cuota_aplicada_codigo, combo_secundarias
                         FROM descuento WHERE id=%s AND id_manager=%s""",
                    (desc_id, g.id_manager))
        desc = cur.fetchone()
    if not desc:
        return jsonify({'ok': False, 'error': 'not_found'}), 404

    if desc['tipo'] == 'familiares':
        cs = desc.get('combo_secundarias') or []
        if isinstance(cs, str):
            try:
                import json as _j; cs = _j.loads(cs)
            except Exception: cs = []
        cuotas_codigos = [s.get('cuota_codigo') for s in cs
                          if isinstance(s, dict) and s.get('cuota_codigo')]
        if not cuotas_codigos and desc.get('cuota_aplicada_codigo'):
            cuotas_codigos = [desc['cuota_aplicada_codigo']]
        return _list_asig_familiares(desc_id, cuotas_codigos, cs)

    # Asignaciones manuales (resto de tipos).
    # Aislamiento por trainer: si está impersonado, restringir a asignaciones
    # cuyo cliente pertenece a su cliente_cache.
    where = ['descuento_id=%s', 'id_manager=%s']
    vals = [desc_id, g.id_manager]
    if g.id_trainer:
        where.append("""cliente_idnoofit IN (
            SELECT id::text FROM cliente_cache
             WHERE id_manager = %s AND id_trainer = %s
        )""")
        vals.extend([str(g.id_manager), str(g.id_trainer)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""SELECT {ASIGN_FIELDS} FROM descuento_asignacion
                        WHERE {' AND '.join(where)}
                        ORDER BY created_at DESC""", vals)
        rows = [_asig_row(r) for r in cur.fetchall()]

    nombres = _resolver_nombres_odoo([r['cliente_idnoofit'] for r in rows
                                       if r.get('cliente_idnoofit')])
    for r in rows:
        r['cliente_nombre'] = nombres.get(str(r.get('cliente_idnoofit') or ''), '')

    # Enriquecer con nombre del trabajador (para familiar_trabajador)
    trab_ids = [r['trabajador_id'] for r in rows if r.get('trabajador_id')]
    if trab_ids:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id, nombre_completo, nif FROM trabajador
                            WHERE id_manager=%s AND id = ANY(%s)""",
                        (g.id_manager, list(set(trab_ids))))
            trab_map = {t['id']: t for t in cur.fetchall()}
        for r in rows:
            if r.get('trabajador_id') and trab_map.get(r['trabajador_id']):
                t = trab_map[r['trabajador_id']]
                r['trabajador_nombre'] = t.get('nombre_completo') or f"Trabajador {t['id']}"
                r['trabajador_nif'] = t.get('nif')

    return jsonify({'ok': True, 'asignaciones': rows})


def _resolver_nombres_odoo(idnoofits):
    """Devuelve dict {idnoofit: nombre} consultando res.partner una sola vez."""
    nombres = {}
    idnoofits = list({str(i) for i in idnoofits if i})
    if not idnoofits:
        return nombres
    try:
        from ..odoo_alta import OdooAlta
        o = OdooAlta(); o._connect()
        partners = o._call('res.partner', 'search_read',
            [('id_noofit', 'in', idnoofits)], ['id_noofit', 'name'])
        for p in partners:
            if p.get('id_noofit'):
                nombres[str(p['id_noofit'])] = p.get('name') or ''
    except Exception:
        pass
    return nombres


def _list_asig_familiares(desc_id, cuotas_codigos, combo_secundarias):
    """Para descuentos tipo='familiares' (multi-cuota): devuelve las familias
    del manager + para cada miembro qué cuotas (del descuento) tiene activas.
    Estructura:
       { ok: True,
         tipo: 'familiares',
         cuotas: [{cuota_codigo, valor, unidad}],
         familias: [
            { familia_id, nombre,
              cuotas_aplicadas: [{cuota_codigo, n_miembros}],   # n≥2 = aplica
              miembros: [
                {cliente_idnoofit, cliente_nombre,
                 cuotas_activas: ['RT 2 dias',...]}     # restringido a las del descuento
              ],
              aplica: bool                                       # alguna cuota con ≥2
            }
         ] }
    """
    cuotas_codigos = list(dict.fromkeys(cuotas_codigos or []))     # dedup conservando orden
    # 1) Familias del manager + miembros.
    # Aislamiento por trainer: filtrar a familias con ≥1 miembro perteneciente
    # al trainer impersonado.
    where = ['f.id_manager=%s']; vals = [str(g.id_manager)]
    if g.id_trainer:
        where.append("""EXISTS (
            SELECT 1 FROM familia_miembro fm
              JOIN cliente_cache cc
                ON cc.id::text = fm.cliente_idnoofit
               AND cc.id_manager = fm.id_manager
             WHERE fm.familia_id = f.id
               AND cc.id_trainer = %s
        )""")
        vals.append(str(g.id_trainer))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT f.id, f.nombre,
                   ARRAY(SELECT cliente_idnoofit FROM familia_miembro
                          WHERE familia_id=f.id) AS miembros
              FROM familia f
             WHERE {' AND '.join(where)}
        """, vals)
        familias_db = cur.fetchall()

    if not familias_db or not cuotas_codigos:
        return jsonify({'ok': True, 'tipo': 'familiares',
                        'cuotas': combo_secundarias or [],
                        'familias': []})

    # 2) Resolver nombres + cuotas activas vía Odoo (un solo round-trip)
    todos_idn = sorted({idn for f in familias_db for idn in (f.get('miembros') or [])})
    nombres = _resolver_nombres_odoo(todos_idn)

    cuotas_por_idn = {}    # idnoofit → set(codigos cuota activa)
    if todos_idn:
        try:
            from ..odoo_alta import OdooAlta
            o = OdooAlta(); o._connect()
            partners = o._call('res.partner', 'search_read',
                [('id_noofit', 'in', todos_idn)], ['id', 'id_noofit'])
            partner_id_to_idn = {p['id']: p['id_noofit'] for p in partners}
            partner_ids = list(partner_id_to_idn.keys())
            if partner_ids:
                subs = o._call('round.subscription', 'search_read',
                    [('estado', '=', 'activa'),
                     ('partner_id', 'in', partner_ids)],
                    ['partner_id', 'cuota_id'])
                cuota_ids = list({s['cuota_id'][0] for s in subs if s.get('cuota_id')})
                cuotas_lookup = {}
                if cuota_ids:
                    crows = o._call('round.cuota.catalogo', 'read', cuota_ids,
                        ['id', 'codigo'])
                    cuotas_lookup = {r['id']: r['codigo'] for r in crows}
                for s in subs:
                    if not s.get('partner_id') or not s.get('cuota_id'): continue
                    pid = s['partner_id'][0]
                    cid = s['cuota_id'][0]
                    idn = partner_id_to_idn.get(pid)
                    if not idn: continue
                    cuotas_por_idn.setdefault(idn, set()).add(cuotas_lookup.get(cid))
        except Exception:
            pass

    # 3) Construir familias enriquecidas
    out = []
    for f in familias_db:
        miembros_idn = f.get('miembros') or []
        miembros = []
        conteo_por_cuota = {c: 0 for c in cuotas_codigos}
        for idn in miembros_idn:
            cuotas_cli = cuotas_por_idn.get(idn) or set()
            activas_relevantes = [c for c in cuotas_codigos if c in cuotas_cli]
            for c in activas_relevantes:
                conteo_por_cuota[c] += 1
            miembros.append({
                'cliente_idnoofit': idn,
                'cliente_nombre': nombres.get(str(idn), ''),
                'cuotas_activas': activas_relevantes,
            })
        cuotas_aplicadas = [
            {'cuota_codigo': c, 'n_miembros': n, 'aplica': n >= 2}
            for c, n in conteo_por_cuota.items()
        ]
        aplica_alguna = any(x['aplica'] for x in cuotas_aplicadas)
        out.append({
            'familia_id': f['id'],
            'nombre': f.get('nombre'),
            'cuotas_aplicadas': cuotas_aplicadas,
            'aplica': aplica_alguna,
            'miembros': miembros,
        })
    # Mostrar primero las que aplican, luego el resto
    out.sort(key=lambda x: (not x['aplica'], x.get('nombre') or ''))
    return jsonify({'ok': True, 'tipo': 'familiares',
                    'cuotas': combo_secundarias or [],
                    'familias': out})


@bp.route('/asignaciones/cliente/<idnoofit>', methods=['GET'])
@auth_required
def list_asignaciones_cliente(idnoofit):
    """Lista descuentos asignados a un cliente concreto (con histórico).
    Devuelve: [{asig: {...}, descuento: {codigo, descripcion, tipo, valor,
                                         cuota_requerida_codigo, cuota_aplicada_codigo,
                                         precio_final}}]

    Aislamiento por trainer: si el cliente no pertenece al trainer
    impersonado, devolver vacío."""
    from ..trainer_scope import cliente_pertenece_a_trainer
    if not cliente_pertenece_a_trainer(idnoofit):
        return jsonify({'ok': True, 'asignaciones': []})
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT a.id AS asig_id, a.descuento_id, a.fecha_desde, a.fecha_hasta,
                   a.estado, a.odoo_id, a.created_at, a.updated_at,
                   a.origen, a.auto_motivo, a.auto_evaluado_at,
                   d.codigo, d.descripcion, d.tipo, d.valor,
                   d.cuota_requerida_codigo, d.cuota_aplicada_codigo, d.precio_final,
                   d.combo_secundarias
              FROM descuento_asignacion a
              JOIN descuento d ON d.id = a.descuento_id
             WHERE a.id_manager=%s AND a.cliente_idnoofit=%s
             ORDER BY a.estado, a.created_at DESC
        """, (g.id_manager, str(idnoofit)))
        rows = cur.fetchall()
    out = []
    for r in rows:
        d = dict(r)
        for k in ('created_at','updated_at','fecha_desde','fecha_hasta','auto_evaluado_at'):
            if d.get(k): d[k] = d[k].isoformat()
        if d.get('valor') is not None: d['valor'] = float(d['valor'])
        if d.get('precio_final') is not None: d['precio_final'] = float(d['precio_final'])
        out.append(d)
    return jsonify({'ok': True, 'asignaciones': out})


@bp.route('/<int:desc_id>/asignaciones', methods=['POST'])
@auth_required
@require_any_permission('configuracion.descuentos.asignar_a_cliente',
                        'cuotas_clientes.asignar_descuento')
def create_asignacion(desc_id):
    """Asignar el descuento a uno o varios clientes a la vez.

    Body: {
      'clientes_idnoofit': ['12345','67890', ...]  (1 o N)
      'fecha_desde': 'yyyy-mm-dd',
      'fecha_hasta': 'yyyy-mm-dd' (opcional),
      'id_trainer': '...' (opcional, si no, usa el de header),
      'trabajador_id': <int>  (obligatorio si tipo='familiar_trabajador'),
      'relacion': 'cónyuge|hijo|...' (obligatorio si tipo='familiar_trabajador')
    }
    """
    d = request.get_json() or {}
    clientes = d.get('clientes_idnoofit') or []
    if not isinstance(clientes, list) or not clientes:
        return jsonify({'ok': False, 'error': 'clientes_idnoofit_obligatorio'}), 400
    id_trainer = d.get('id_trainer') or g.id_trainer
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_obligatorio'}), 400

    # Verificar que el descuento existe y obtener su odoo_id + tipo
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, odoo_id, tipo FROM descuento WHERE id=%s AND id_manager=%s",
                    (desc_id, g.id_manager))
        desc_row = cur.fetchone()
    if not desc_row:
        return jsonify({'ok': False, 'error': 'descuento_not_found'}), 404
    desc_odoo_id = desc_row.get('odoo_id')

    # Campos especiales para familiar_trabajador (obligatorios).
    trabajador_id = d.get('trabajador_id')
    relacion = (d.get('relacion') or '').strip() or None
    if desc_row.get('tipo') == 'familiar_trabajador':
        if not trabajador_id:
            return jsonify({'ok': False, 'error': 'trabajador_obligatorio'}), 400
        if not relacion:
            return jsonify({'ok': False, 'error': 'relacion_obligatoria'}), 400
        try:
            trabajador_id = int(trabajador_id)
        except Exception:
            return jsonify({'ok': False, 'error': 'trabajador_id_invalido'}), 400
        # Validar que el trabajador pertenece al manager
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id FROM trabajador
                            WHERE id=%s AND id_manager=%s""",
                        (trabajador_id, g.id_manager))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'trabajador_not_found'}), 400
    else:
        # Para otros tipos no guardamos estos campos
        trabajador_id = None
        relacion = None

    creadas, ya_existentes, errores = [], [], []
    for cliente in clientes:
        cliente = str(cliente).strip()
        if not cliente:
            continue
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO descuento_asignacion
                        (descuento_id, id_manager, id_trainer, cliente_idnoofit,
                         fecha_desde, fecha_hasta, estado, trabajador_id, relacion)
                    VALUES (%s,%s,%s,%s,%s,%s,'activa',%s,%s)
                    ON CONFLICT (descuento_id, cliente_idnoofit) DO NOTHING
                    RETURNING {ASIGN_FIELDS}
                """, (desc_id, g.id_manager, id_trainer, cliente,
                      d.get('fecha_desde'), d.get('fecha_hasta'),
                      trabajador_id, relacion))
                row = cur.fetchone()
            if not row:
                ya_existentes.append(cliente)
                continue
            # Sync Odoo: añadir descuento a suscripciones activas del cliente
            if desc_odoo_id:
                get_sync(g.id_manager).asignacion_apply(desc_odoo_id, cliente)
            creadas.append(_asig_row(row))
        except Exception as e:
            errores.append({'cliente': cliente, 'error': str(e)})

    if creadas:
        log_action(actor_from_request(), 'descuento_asignacion', 'asignar',
                   entidad_id=desc_id,
                   resumen=f"Asignación descuento {desc_id} a {len(creadas)} cliente(s)",
                   cambios={'descuento_id': desc_id, 'id_trainer': id_trainer,
                            'clientes': [a.get('cliente_idnoofit') for a in creadas],
                            'ya_existentes': ya_existentes})
    return jsonify({
        'ok': True,
        'creadas': creadas,
        'ya_existentes': ya_existentes,
        'errores': errores,
    }), 201 if creadas else 200


@bp.route('/<int:desc_id>/asignaciones/<int:asig_id>', methods=['DELETE'])
@auth_required
@require_any_permission('configuracion.descuentos.borrar_asignacion',
                        'cuotas_clientes.asignar_descuento')
def delete_asignacion(desc_id, asig_id):
    """Revoca una asignación.

    Bloqueado para asignaciones origen='auto_*' — esas las gestiona
    automáticamente el cron `round_descuentos_auto`. Si el cliente ya no
    cumple condiciones, el cron las cancelará en su próxima pasada (o
    forzando POST /api/clientes/descuentos-auto/recalcular). Si el manager
    quiere "quitar" un descuento auto, debe ajustar las cuotas/familia
    que dispararon el match, no la asignación.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT cliente_idnoofit, origen FROM descuento_asignacion
                       WHERE id=%s AND descuento_id=%s AND id_manager=%s""",
                    (asig_id, desc_id, g.id_manager))
        r = cur.fetchone()
        if r and (r.get('origen') or 'manual').startswith('auto_'):
            return jsonify({
                'ok': False,
                'error': 'asignacion_automatica',
                'detail': (f'Esta asignación es automática (origen={r["origen"]}). '
                           'La gestiona el cron diario según las cuotas/familia '
                           'del cliente. Para quitarla, ajusta las condiciones '
                           '(quitar cuota o sacar de la familia) y el cron '
                           'la cancelará en su próxima pasada.'),
            }), 409
        cur.execute("DELETE FROM descuento_asignacion WHERE id=%s AND id_manager=%s",
                    (asig_id, g.id_manager))
        n = cur.rowcount

    # Sync Odoo: quitar el descuento de las suscripciones del cliente.
    # FAIL-SOFT: el DELETE en BD (arriba) ya commiteó y es la fuente de verdad.
    # Si la sincronización con Odoo falla (Odoo caído, descuento no presente en
    # la sub, etc.) NO debe romper la petición — antes lanzaba 500 y el frontend
    # mostraba "Error" pese a que el descuento SÍ se había quitado, dando la
    # sensación de "no se puede quitar el descuento".
    if r and n > 0:
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("SELECT odoo_id FROM descuento WHERE id=%s", (desc_id,))
                desc_r = cur.fetchone()
            if desc_r and desc_r.get('odoo_id'):
                get_sync(g.id_manager).asignacion_revoke(desc_r['odoo_id'], r['cliente_idnoofit'])
        except Exception as e:
            log.warning(f'delete_asignacion {asig_id}: sync Odoo (revoke) falló '
                        f'(no fatal, descuento ya quitado en BD): {e}')

    if n > 0:
        log_action(actor_from_request(), 'descuento_asignacion', 'desasignar',
                   entidad_id=asig_id,
                   resumen=f"Revocada asignación descuento {desc_id}",
                   cambios={'descuento_id': desc_id,
                            'cliente_idnoofit': r.get('cliente_idnoofit') if r else None})
    return jsonify({'ok': True, 'deleted': n})


@bp.route('/<int:_id>/adoptar', methods=['POST'])
@auth_required
@require_permission('configuracion.descuentos.adoptar')
def adoptar(_id):
    if not g.id_trainer:
        return jsonify({'ok': False, 'error': 'requires_trainer_id'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT {FIELDS} FROM descuento WHERE id=%s AND id_manager=%s AND scope='plantilla_manager'",
                    (_id, g.id_manager))
        p = cur.fetchone()
        if not p: return jsonify({'ok': False, 'error': 'plantilla_not_found'}), 404
        cur.execute("SELECT id FROM descuento WHERE id_trainer=%s AND plantilla_origen_id=%s AND scope='trainer'",
                    (g.id_trainer, _id))
        ex = cur.fetchone()
        if ex: return jsonify({'ok': True, 'already_adopted': True, 'descuento_id': ex['id']})
        cur.execute(f"""
            INSERT INTO descuento (scope, id_manager, id_trainer, plantilla_origen_id,
              codigo, descripcion, tipo, valor, active)
            VALUES ('trainer', %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {FIELDS}
        """, (g.id_manager, g.id_trainer, _id, p['codigo'], p['descripcion'], p['tipo'], p['valor'], p['active']))
        nuevo = cur.fetchone()
    log_action(actor_from_request(), 'descuento', 'create',
               entidad_id=nuevo['id'],
               resumen=f"Adopción plantilla descuento {p.get('codigo')} por trainer {g.id_trainer}",
               cambios={'plantilla_origen_id': _id, 'codigo': p.get('codigo'),
                        'tipo': p.get('tipo'), 'id_trainer': g.id_trainer})
    return jsonify({'ok': True, 'descuento': _row(nuevo)}), 201
