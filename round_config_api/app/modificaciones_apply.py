"""Aplicación de modificaciones activas del cliente al precio de un recibo.

Las modificaciones son ajustes puntuales a recibos individuales (no plantillas
recurrentes como los descuentos). Cada una tiene:
  - tipo: descuento | cargo_extra | precio_alternativo
  - valor: importe €
  - cuota_id: si está definido, aplica solo a esa cuota; si NULL aplica al total
  - fecha_desde / fecha_hasta: ventana de validez
  - estado: activa | aplicada | cancelada

Comportamiento al emitir un recibo del mes M:
  - Se buscan modificaciones con estado='activa' cuya ventana solapa con M
  - Las que tengan cuota_id se aplican durante el cálculo per-cuota:
      · descuento:           precio_cuota -= valor (mín 0)
      · cargo_extra:         precio_cuota += valor
      · precio_alternativo:  precio_cuota  = valor
  - Las que NO tengan cuota_id (modificaciones globales) se aplican al total.
  - Tras emitir, se marcan como estado='aplicada' (no vuelven a usarse).

Uso:
    from .modificaciones_apply import (
        get_modificaciones_activas_mes, aplicar_modif_a_cuota,
        aplicar_modif_globales, marcar_modificaciones_aplicadas,
    )
"""
import datetime as dt
import logging
from .db import get_conn

log = logging.getLogger(__name__)


def _bounds_mes(mes_str):
    """Devuelve (primer_dia, ultimo_dia) del mes 'YYYY-MM'."""
    y, m = map(int, mes_str.split('-'))
    primer = dt.date(y, m, 1)
    if m == 12:
        ultimo = dt.date(y, 12, 31)
    else:
        ultimo = dt.date(y, m + 1, 1) - dt.timedelta(days=1)
    return primer, ultimo


def get_modificaciones_activas_mes(id_manager, idnoofit, mes_str):
    """Devuelve modificaciones del cliente vigentes en el mes `mes_str` (YYYY-MM).

    Vigente = estado='activa' AND la ventana [fecha_desde, fecha_hasta] solapa
    con el mes. Si fecha_hasta es NULL → abierta (aplica a partir de fecha_desde).
    """
    primer, ultimo = _bounds_mes(mes_str)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, cuota_id, tipo, valor, fecha_desde, fecha_hasta, razon, estado
              FROM modificacion
             WHERE id_manager=%s
               AND cliente_idnoofit=%s
               AND estado='activa'
               AND fecha_desde <= %s
               AND (fecha_hasta IS NULL OR fecha_hasta >= %s)
        """, (str(id_manager), str(idnoofit), ultimo, primer))
        return cur.fetchall() or []


def aplicar_modif_a_cuota(modificaciones, cuota_id, precio_actual):
    """Aplica las modificaciones que apunten a `cuota_id` sobre `precio_actual`.

    Returns (nuevo_precio, info_aplicada, ids_consumidas)
    """
    info = []
    ids = []
    precio = float(precio_actual or 0)
    for m in modificaciones:
        if m.get('cuota_id') != cuota_id: continue
        tipo = m['tipo']
        original = precio
        v = float(m.get('valor') or 0)
        if tipo == 'descuento':
            precio = max(0.0, round(precio - v, 2))
        elif tipo == 'cargo_extra':
            precio = round(precio + v, 2)
        elif tipo == 'precio_alternativo':
            precio = round(v, 2)
        else:
            continue
        info.append({
            'modificacion_id': m['id'],
            'tipo': tipo, 'valor': v,
            'precio_antes': original, 'precio_despues': precio,
            'razon': m.get('razon') or '',
        })
        ids.append(m['id'])
    return precio, info, ids


def aplicar_modif_globales(modificaciones, total_actual):
    """Aplica las modificaciones SIN cuota_id (globales) al total.

    Returns (nuevo_total, info_aplicada, ids_consumidas)
    """
    info = []
    ids = []
    total = float(total_actual or 0)
    for m in modificaciones:
        if m.get('cuota_id') is not None: continue
        tipo = m['tipo']
        original = total
        v = float(m.get('valor') or 0)
        if tipo == 'descuento':
            total = max(0.0, round(total - v, 2))
        elif tipo == 'cargo_extra':
            total = round(total + v, 2)
        elif tipo == 'precio_alternativo':
            total = round(v, 2)
        else:
            continue
        info.append({
            'modificacion_id': m['id'],
            'tipo': tipo, 'valor': v,
            'total_antes': original, 'total_despues': total,
            'razon': m.get('razon') or '',
        })
        ids.append(m['id'])
    return total, info, ids


def marcar_modificaciones_aplicadas(ids, recibo_id=None):
    """Marca las modificaciones consumidas como estado='aplicada'."""
    if not ids: return 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE modificacion
               SET estado='aplicada', updated_at=NOW()
             WHERE id = ANY(%s) AND estado='activa'
        """, (list(ids),))
        return cur.rowcount


def resumen_aplicadas(info_por_cuota, info_global):
    """Devuelve un string corto para incluir en notas del recibo."""
    partes = []
    for inf in info_por_cuota:
        for x in inf:
            sig = '−' if x['tipo'] == 'descuento' else ('+' if x['tipo'] == 'cargo_extra' else '=')
            partes.append(f"{sig}{x['valor']}€ ({x['tipo']})"
                          + (f": {x['razon']}" if x['razon'] else ''))
    for x in info_global:
        sig = '−' if x['tipo'] == 'descuento' else ('+' if x['tipo'] == 'cargo_extra' else '=')
        partes.append(f"global {sig}{x['valor']}€ ({x['tipo']})"
                      + (f": {x['razon']}" if x['razon'] else ''))
    return ', '.join(partes)
