"""Aplicación de descuentos activos del cliente al precio de una cuota.

Para cada recibo a emitir, recorremos los descuentos asignados al cliente
(`descuento_asignacion` con estado='activa') y aplicamos los que correspondan
al precio de cada cuota. Los tipos soportados:

  - porcentaje:    precio = precio * (1 - valor/100)
  - importe:       precio = precio - valor          (mínimo 0)
  - varias_cuotas: si el cliente tiene la cuota_requerida activa Y la cuota
                    actual está en combo_secundarias → precio = combo.precio
  - precio_combo (legacy): igual que varias_cuotas con una sola cuota_aplicada

Uso:
    from .descuentos_apply import calcular_precio_con_descuentos
    nuevo, info = calcular_precio_con_descuentos(
        id_manager, idnoofit, cuota_codigo, precio_normal,
        cuotas_activas_codigos=set([...])  # opcional: códigos de cuotas activas
    )
"""
import logging
from .db import get_conn

log = logging.getLogger(__name__)


def get_descuentos_activos(id_manager, idnoofit, id_trainer_cliente=None):
    """Devuelve descuentos activos asignados al cliente.

    Scope por trainer (auditoría #28): un descuento MANUAL asignado a un cliente
    aplica si es manager-wide (id_trainer NULL) o del propio trainer del cliente,
    NUNCA si es de OTRO trainer (asignación errónea cross-trainer). Si
    `id_trainer_cliente` es None no se filtra (compat)."""
    sql = """
        SELECT a.id AS asig_id, a.descuento_id, a.estado AS asig_estado,
               d.codigo, d.tipo, d.valor, d.active, d.unidad, d.id_trainer,
               d.cuota_requerida_codigo, d.cuota_aplicada_codigo,
               d.precio_final, d.combo_secundarias, d.actividades_idnoofit
          FROM descuento_asignacion a
          JOIN descuento d ON d.id = a.descuento_id
         WHERE a.id_manager=%s AND a.cliente_idnoofit=%s
           AND a.estado='activa' AND d.active=TRUE
    """
    params = [str(id_manager), str(idnoofit)]
    if id_trainer_cliente is not None:
        sql += " AND (d.id_trainer IS NULL OR d.id_trainer::text = %s)"
        params.append(str(id_trainer_cliente))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _cuota_actividades(id_manager, cuota_codigo):
    """Devuelve el set de id_actividad (int) que incluye una cuota por código.
    Usado para el filtro por actividad de los descuentos tipo 'importe'."""
    if not cuota_codigo:
        return set()
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT actividades_idnoofit FROM cuota
                            WHERE id_manager=%s AND codigo=%s LIMIT 1""",
                        (str(id_manager), cuota_codigo))
            row = cur.fetchone()
        acts = (row or {}).get('actividades_idnoofit') or []
        if isinstance(acts, str):
            import json as _json
            try: acts = _json.loads(acts)
            except Exception: acts = []
        return {int(x) for x in acts if str(x).strip().lstrip('-').isdigit()}
    except Exception:
        log.exception('_cuota_actividades')
        return set()


def _norm_acts(raw):
    """Normaliza actividades_idnoofit (JSONB list o str) a set de int."""
    if isinstance(raw, str):
        import json as _json
        try: raw = _json.loads(raw)
        except Exception: raw = []
    return {int(x) for x in (raw or []) if str(x).strip().lstrip('-').isdigit()}


def get_familia_de_cliente(id_manager, idnoofit):
    """Devuelve (familia_id, [miembros_idnoofit]) o (None, [])."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT f.id, ARRAY(
                SELECT cliente_idnoofit FROM familia_miembro
                 WHERE familia_id = f.id) AS miembros
              FROM familia f
              JOIN familia_miembro m ON m.familia_id = f.id
             WHERE f.id_manager = %s AND m.cliente_idnoofit = %s
             LIMIT 1
        """, (str(id_manager), str(idnoofit)))
        r = cur.fetchone()
        if not r: return None, []
        return r['id'], (r.get('miembros') or [])


def get_descuentos_varias_cuotas_activos(id_manager):
    """Lista los descuentos tipo='varias_cuotas' activos del manager.

    Estos descuentos se aplican AUTOMÁTICAMENTE durante la emisión cuando el
    cliente cumple las condiciones (tiene tanto la cuota_requerida como una
    de las cuotas_secundarias activas). NO requieren asignación manual al
    cliente — basta con que el cliente tenga las cuotas configuradas.

    Devuelve [{id, codigo, descripcion, cuota_requerida_codigo,
               combo_secundarias: [{cuota_codigo, precio}, ...]}].
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, codigo, descripcion, cuota_requerida_codigo,
                   combo_secundarias, id_trainer
              FROM descuento
             WHERE id_manager=%s AND tipo='varias_cuotas' AND active=TRUE
        """, (str(id_manager),))
        rows = cur.fetchall() or []
        for r in rows:
            cs = r.get('combo_secundarias')
            if isinstance(cs, str):
                try:
                    import json as _j
                    r['combo_secundarias'] = _j.loads(cs)
                except Exception:
                    r['combo_secundarias'] = []
            elif cs is None:
                r['combo_secundarias'] = []
        return rows


def _solo_trainer_propio(descuentos, id_trainer_cliente):
    """Filtra una lista de descuentos AUTO al trainer del cliente (auditoría #28):
    solo aplican los del PROPIO trainer (id_trainer == trainer del cliente);
    NI manager-wide (NULL) NI de otro trainer. Si id_trainer_cliente es None,
    no filtra (compat)."""
    if id_trainer_cliente is None:
        return descuentos
    ct = str(id_trainer_cliente)
    return [d for d in (descuentos or [])
            if str(d.get('id_trainer') or '') == ct]


def aplicar_descuentos_varias_cuotas_auto(id_manager, idnoofit, cuota_codigo,
                                          precio_actual, cuotas_activas_codigos,
                                          descuentos_varias=None,
                                          id_trainer_cliente=None):
    """Aplica AUTOMÁTICAMENTE descuentos tipo='varias_cuotas' al precio.

    Reglas:
      - El cliente tiene `cuota_requerida_codigo` en sus cuotas activas.
      - La cuota actual (`cuota_codigo`) está en `combo_secundarias` con
        un precio definido.
      → Sustituye `precio_actual` por el precio del combo (no porcentual).

    NO requiere que el cliente tenga el descuento asignado en
    `descuento_asignacion` — es 100% automático. Permite que el manager
    configure el descuento una vez y todos los clientes que cumplan
    condiciones lo reciban sin intervención manual.

    Args:
        cuotas_activas_codigos: set/list de códigos de cuotas que el cliente
            tiene activas (incluida la que se está cobrando ahora).

    Returns:
        (precio_final, info_aplicado: list[dict])
    """
    if descuentos_varias is None:
        descuentos_varias = get_descuentos_varias_cuotas_activos(id_manager)
    descuentos_varias = _solo_trainer_propio(descuentos_varias, id_trainer_cliente)
    cuotas_activas = set(cuotas_activas_codigos or [])
    info = []
    precio = float(precio_actual or 0)

    for d in descuentos_varias:
        req = d.get('cuota_requerida_codigo')
        if not req or req not in cuotas_activas:
            continue
        cs = d.get('combo_secundarias') or []
        for s in cs:
            if s.get('cuota_codigo') == cuota_codigo:
                nuevo = round(float(s.get('precio') or 0), 2)
                # Solo aplicar si baja el precio (el descuento no debe encarecer)
                if nuevo < precio:
                    info.append({
                        'descuento_codigo': d['codigo'],
                        'tipo': 'varias_cuotas',
                        'precio_antes': precio,
                        'precio_despues': nuevo,
                        'auto': True,
                    })
                    precio = nuevo
                break

    return precio, info


def get_descuentos_familiares_activos(id_manager):
    """Lista los descuentos tipo='familiares' activos del manager.
    Devuelve [{id, codigo, valor, unidad, cuota_aplicada_codigo, combo_secundarias}].

    El descuento por familiares opera sobre N actividades (multi-select), cada
    una con su propio valor + unidad. La lista por actividad se almacena en
    `combo_secundarias` como [{cuota_codigo, valor, unidad}].
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, codigo, descripcion, valor, unidad,
                   cuota_aplicada_codigo, combo_secundarias, id_trainer
              FROM descuento
             WHERE id_manager=%s AND tipo='familiares' AND active=TRUE
        """, (str(id_manager),))
        rows = cur.fetchall() or []
        # Normalizar combo_secundarias (psycopg lo devuelve ya como list para JSONB)
        for r in rows:
            cs = r.get('combo_secundarias')
            if isinstance(cs, str):
                try:
                    import json as _j
                    r['combo_secundarias'] = _j.loads(cs)
                except Exception:
                    r['combo_secundarias'] = []
            elif cs is None:
                r['combo_secundarias'] = []
        return rows


def calcular_precio_con_descuentos(id_manager, idnoofit, cuota_codigo,
                                   precio_normal, cuotas_activas_codigos=None,
                                   id_trainer_cliente=None):
    """Aplica los descuentos activos del cliente sobre `precio_normal` para
    la cuota `cuota_codigo`.

    Args:
        id_manager: VARCHAR
        idnoofit: VARCHAR (cliente)
        cuota_codigo: código de la cuota a la que aplicar
        precio_normal: float (precio de catálogo)
        cuotas_activas_codigos: set/list de códigos de cuotas que el cliente
            tiene activas (necesario para validar 'varias_cuotas').
            Si None, los descuentos por acumulación NO se aplican.

    Returns:
        (precio_final: float, info: list[{tipo, codigo, ajuste, precio_resultante}])
    """
    cuotas_activas = set(cuotas_activas_codigos or [])
    descuentos = get_descuentos_activos(id_manager, idnoofit, id_trainer_cliente) or []
    info = []
    precio = float(precio_normal or 0)

    for d in descuentos:
        tipo = d['tipo']
        original = precio
        aplica = False
        nuevo = precio

        if tipo == 'porcentaje':
            v = float(d['valor'] or 0)
            if v > 0:
                nuevo = round(precio * (1 - v / 100.0), 2)
                aplica = True
        elif tipo == 'restar_cuota':
            # Resta un importe fijo SOLO a la cuota indicada en
            # cuota_aplicada_codigo. Si la cuota actual no es esa, no aplica.
            v = float(d['valor'] or 0)
            if v > 0 and d.get('cuota_aplicada_codigo') == cuota_codigo:
                nuevo = max(0.0, round(precio - v, 2))
                aplica = True
        elif tipo == 'importe':
            v = float(d['valor'] or 0)
            # Filtro por actividad (junio 2026): si el descuento 'restar €' tiene
            # actividades seleccionadas, solo aplica si la cuota incluye alguna
            # de ellas. Sin actividades seleccionadas = aplica a cualquier cuota
            # (compat retro).
            acts_desc = _norm_acts(d.get('actividades_idnoofit'))
            pasa_filtro = True
            if acts_desc:
                acts_cuota = _cuota_actividades(id_manager, cuota_codigo)
                pasa_filtro = bool(acts_desc & acts_cuota)
            if v > 0 and pasa_filtro:
                nuevo = max(0.0, round(precio - v, 2))
                aplica = True
        elif tipo == 'varias_cuotas':
            # Desde mayo 2026 los descuentos `varias_cuotas` son AUTOMÁTICOS:
            # se aplican vía `aplicar_descuentos_varias_cuotas_auto` (a todos
            # los clientes que cumplan condiciones, sin asignación previa).
            # Aquí los ignoramos para evitar doble aplicación. Si el cliente
            # tiene una asignación legacy, se ignora — el efecto es el mismo.
            continue
        elif tipo == 'familiar_trabajador':
            # Descuento manual a familiares de un trabajador. Multi-cuota: en
            # `combo_secundarias` se define, por cada actividad seleccionada, su
            # valor + unidad ([{cuota_codigo, valor, unidad}]). Solo aplica a las
            # cuotas listadas. Fallback legacy: si no hay lista, se aplica el
            # valor/unidad raíz a cualquier cuota. El trabajador + relación van
            # en la asignación (informativos a efectos de cobro).
            cs = d.get('combo_secundarias') or []
            if isinstance(cs, str):
                try:
                    cs = _j.loads(cs)
                except Exception:
                    cs = []
            entry = next((s for s in cs if s.get('cuota_codigo') == cuota_codigo), None)
            if entry:
                v = float(entry.get('valor') or 0)
                unidad = entry.get('unidad') or 'porcentaje'
                if v > 0:
                    if unidad == 'importe':
                        nuevo = max(0.0, round(precio - v, 2))
                    else:
                        nuevo = round(precio * (1 - v / 100.0), 2)
                    aplica = True
            elif not cs:
                # Legacy: valor/unidad raíz aplica a cualquier cuota
                v = float(d['valor'] or 0)
                unidad = (d.get('unidad') or 'porcentaje')
                if v > 0:
                    if unidad == 'importe':
                        nuevo = max(0.0, round(precio - v, 2))
                    else:
                        nuevo = round(precio * (1 - v / 100.0), 2)
                    aplica = True
        elif tipo == 'precio_combo':   # legacy
            req = d.get('cuota_requerida_codigo')
            apl = d.get('cuota_aplicada_codigo')
            if req and apl and req in cuotas_activas and apl == cuota_codigo:
                nuevo = round(float(d.get('precio_final') or 0), 2)
                aplica = True

        if aplica:
            info.append({
                'descuento_codigo': d['codigo'],
                'tipo': tipo,
                'precio_antes': original,
                'precio_despues': nuevo,
            })
            precio = nuevo

    return precio, info


def es_descuento_acumulacion(tipo):
    """¿Es un descuento automático? (no se puede quitar manualmente desde el
    perfil del cliente — se gestiona automáticamente por sistema)."""
    return tipo in ('varias_cuotas', 'precio_combo', 'familiares')


def aplicar_descuentos_familiares(id_manager, idnoofit, cuota_codigo,
                                  precio_actual, cuotas_por_miembro,
                                  descuentos_familiares=None,
                                  id_trainer_cliente=None):
    """Aplica descuentos de tipo 'familiares' al precio de una cuota.

    El descuento se aplica AUTOMÁTICAMENTE si:
      - El cliente está en una familia.
      - Hay ≥ 2 miembros (incluido él) con la cuota_codigo activa.
      - Existe un descuento tipo='familiares' configurado con
        cuota_aplicada_codigo == cuota_codigo.

    Args:
        cuotas_por_miembro: {idnoofit: set(codigos_cuotas)} para los miembros
            de la familia. El propio cliente debe estar incluido.
        descuentos_familiares: lista pre-cargada (opcional). Si None se
            consulta la BD.

    Returns:
        (nuevo_precio: float, info: list[{...}])
    """
    if descuentos_familiares is None:
        descuentos_familiares = get_descuentos_familiares_activos(id_manager)
    # Scope por trainer (auditoría #28): solo el descuento familiar del PROPIO
    # trainer del cliente (ni manager-wide ni de otro trainer).
    descuentos_familiares = _solo_trainer_propio(descuentos_familiares, id_trainer_cliente)

    # Recorrer todos los descuentos tipo='familiares' del manager y, para cada
    # uno, buscar en `combo_secundarias` la entrada de la cuota actual.
    # Fallback legacy: si no hay combo_secundarias y la cuota_aplicada_codigo
    # del descuento coincide con `cuota_codigo`, aplicamos valor/unidad raíz.
    aplicables = []
    for d in descuentos_familiares:
        cs = d.get('combo_secundarias') or []
        match = None
        for s in cs:
            if not isinstance(s, dict): continue
            if (s.get('cuota_codigo') or '') == cuota_codigo:
                match = {
                    'valor': float(s.get('valor') or 0),
                    'unidad': s.get('unidad') or d.get('unidad') or 'porcentaje',
                }
                break
        if not match:
            if (d.get('cuota_aplicada_codigo') or '') == cuota_codigo:
                match = {
                    'valor': float(d.get('valor') or 0),
                    'unidad': d.get('unidad') or 'porcentaje',
                }
        if match:
            aplicables.append({'desc': d, **match})

    if not aplicables:
        return float(precio_actual or 0), []

    miembros_con_cuota = sum(
        1 for cuotas in (cuotas_por_miembro or {}).values()
        if cuota_codigo in (cuotas or set())
    )
    if miembros_con_cuota < 2:
        return float(precio_actual or 0), []

    # Blindaje (auditoría #27): se aplica SOLO UN descuento familiar por
    # actividad — el MEJOR para el cliente (menor precio resultante). Antes se
    # acumulaban TODOS los descuentos tipo='familiares' que tocaran la misma
    # cuota; si el catálogo tenía un duplicado (mismo concepto creado dos veces,
    # p.ej. uno manager-wide + otro per-trainer), el descuento se aplicaba 2+
    # veces (RAQUEL/NACHO: −15€ en vez de −7,5€). Un descuento familiar por
    # actividad es lo correcto.
    base = float(precio_actual or 0)
    mejor = None  # (precio_resultante, info_dict)
    for a in aplicables:
        unidad = a['unidad']
        v = a['valor']
        if v <= 0: continue
        if unidad == 'porcentaje':
            p = round(base * (1 - v / 100.0), 2)
        elif unidad == 'importe':
            p = max(0.0, round(base - v, 2))
        else:
            continue
        if mejor is None or p < mejor[0]:
            mejor = (p, {
                'descuento_codigo': a['desc']['codigo'],
                'tipo': 'familiares',
                'unidad': unidad, 'valor': v,
                'miembros_cuota': miembros_con_cuota,
                'precio_antes': base,
                'precio_despues': p,
            })
    if mejor is None:
        return base, []
    return mejor[0], [mejor[1]]
