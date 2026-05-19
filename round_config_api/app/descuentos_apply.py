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


def get_descuentos_activos(id_manager, idnoofit):
    """Devuelve descuentos activos asignados al cliente."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT a.id AS asig_id, a.descuento_id, a.estado AS asig_estado,
                   d.codigo, d.tipo, d.valor, d.active, d.unidad,
                   d.cuota_requerida_codigo, d.cuota_aplicada_codigo,
                   d.precio_final, d.combo_secundarias
              FROM descuento_asignacion a
              JOIN descuento d ON d.id = a.descuento_id
             WHERE a.id_manager=%s AND a.cliente_idnoofit=%s
               AND a.estado='activa' AND d.active=TRUE
        """, (str(id_manager), str(idnoofit)))
        return cur.fetchall()


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
                   cuota_aplicada_codigo, combo_secundarias
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
                                   precio_normal, cuotas_activas_codigos=None):
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
    descuentos = get_descuentos_activos(id_manager, idnoofit) or []
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
        elif tipo == 'importe':
            v = float(d['valor'] or 0)
            if v > 0:
                nuevo = max(0.0, round(precio - v, 2))
                aplica = True
        elif tipo == 'varias_cuotas':
            req = d.get('cuota_requerida_codigo')
            if req and req in cuotas_activas:
                # Buscar la cuota actual en combo_secundarias
                cs = d.get('combo_secundarias') or []
                if isinstance(cs, str):
                    import json as _j
                    try: cs = _j.loads(cs)
                    except Exception: cs = []
                for s in cs:
                    if s.get('cuota_codigo') == cuota_codigo:
                        nuevo = round(float(s.get('precio') or 0), 2)
                        aplica = True
                        break
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
                                  descuentos_familiares=None):
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

    info = []
    precio = float(precio_actual or 0)
    for a in aplicables:
        original = precio
        unidad = a['unidad']
        v = a['valor']
        if v <= 0: continue
        if unidad == 'porcentaje':
            precio = round(precio * (1 - v / 100.0), 2)
        elif unidad == 'importe':
            precio = max(0.0, round(precio - v, 2))
        else:
            continue
        info.append({
            'descuento_codigo': a['desc']['codigo'],
            'tipo': 'familiares',
            'unidad': unidad, 'valor': v,
            'miembros_cuota': miembros_con_cuota,
            'precio_antes': original,
            'precio_despues': precio,
        })
    return precio, info
