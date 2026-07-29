"""Aplicación de modificaciones activas del cliente al precio de un recibo.

Las modificaciones son ajustes puntuales a recibos individuales (no plantillas
recurrentes como los descuentos). Cada una tiene:
  - tipo: descuento | cargo_extra | precio_alternativo  (sólo etiqueta /
          categorización; la math se rige por el SIGNO de `valor`)
  - valor: importe € CON SIGNO (positivo = suma, negativo = resta)
  - cuota_id: si está definido, aplica solo a esa cuota; si NULL aplica al total
  - fecha_desde / fecha_hasta: ventana de validez
  - estado: activa | aplicada | cancelada

Comportamiento al emitir un recibo del mes M:
  - Se buscan modificaciones con estado='activa' cuya ventana solapa con M
  - Para los tipos descuento / cargo_extra:
      · precio = max(0, precio + valor)
        (si valor>0 suma al recibo; si valor<0 reduce)
  - Para precio_alternativo:
      · precio = valor (sustituye el precio; valor se interpreta absoluto)
  - Las modificaciones SIN cuota_id (globales) se aplican al total con la
    misma regla.
  - Tras emitir, se marcan como estado='aplicada' (no vuelven a usarse).

Migración histórica: los registros antiguos con tipo='descuento' guardaban
`valor` positivo (significaba restar). Una migración idempotente al arranque
los neg-a (ver db/__init__.py — bloque de migrations).

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
    """Devuelve modificaciones del cliente vigentes en el mes `mes_str`.

    Vigente = estado='activa' AND la ventana [fecha_desde, fecha_hasta] solapa
    con el mes. JOIN con `cuota` para añadir `cuota_codigo` — necesario para
    matchear contra subs Odoo (los IDs locales y los de Odoo no coinciden).
    """
    primer, ultimo = _bounds_mes(mes_str)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT m.id, m.cuota_id, c.codigo AS cuota_codigo,
                   m.tipo, m.valor, m.fecha_desde, m.fecha_hasta,
                   m.razon, m.estado
              FROM modificacion m
              LEFT JOIN cuota c ON c.id = m.cuota_id
             WHERE m.id_manager=%s
               AND m.cliente_idnoofit=%s
               AND m.estado='activa'
               AND m.fecha_desde <= %s
               AND (m.fecha_hasta IS NULL OR m.fecha_hasta >= %s)
        """, (str(id_manager), str(idnoofit), ultimo, primer))
        return cur.fetchall() or []


def aplicar_modif_a_cuota(modificaciones, cuota_id, precio_actual,
                           cuota_codigo=None):
    """Aplica las modificaciones que apunten a `cuota_id` sobre `precio_actual`.

    Match: si `cuota_codigo` viene dado y la modificación tiene `cuota_codigo`
    (vía JOIN con cuota local), comparamos por código (estable entre BDs).
    Fallback por `cuota_id` (compat con datos sin código).

    Math: el SIGNO de `valor` rige (positivo suma, negativo resta) para los
    tipos descuento / cargo_extra. `precio_alternativo` sustituye el precio
    por el valor absoluto.

    Returns (nuevo_precio, info_aplicada, ids_consumidas)
    """
    info = []
    ids = []
    precio = float(precio_actual or 0)
    for m in modificaciones:
        # Match preferente por código (estable Local↔Odoo); fallback por id.
        m_cod = m.get('cuota_codigo')
        if cuota_codigo and m_cod:
            if m_cod != cuota_codigo: continue
        elif m.get('cuota_id') != cuota_id:
            continue
        tipo = m['tipo']
        original = precio
        v = float(m.get('valor') or 0)
        if tipo in ('descuento', 'cargo_extra'):
            precio = max(0.0, round(precio + v, 2))
        elif tipo == 'precio_alternativo':
            precio = max(0.0, round(abs(v), 2))
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
    """Aplica las modificaciones SIN cuota_id (globales) al total. El signo
    de `valor` rige la operación (positivo suma, negativo resta).

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
        if tipo in ('descuento', 'cargo_extra'):
            total = max(0.0, round(total + v, 2))
        elif tipo == 'precio_alternativo':
            total = max(0.0, round(abs(v), 2))
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


def marcar_modificaciones_aplicadas(ids, recibo_id=None, mes_str=None):
    """Marca las modificaciones consumidas como estado='aplicada'.

    IMPORTANTE (multi-mes): si `mes_str` (YYYY-MM) se pasa, SOLO se consumen las
    modificaciones cuya ventana TERMINA en ese mes o antes (`fecha_hasta` <=
    último día del mes) o que no tienen `fecha_hasta` (one-shot). Las de varios
    meses cuya ventana sigue abierta a meses futuros se dejan en 'activa' para
    que `get_modificaciones_activas_mes` vuelva a recogerlas y se apliquen
    también en las próximas emisiones dentro de su rango.

    Sin `mes_str` (compat) se marca todo lo consumido, como antes."""
    if not ids: return 0
    with get_conn() as conn, conn.cursor() as cur:
        if mes_str:
            _, ultimo = _bounds_mes(mes_str)
            cur.execute("""
                UPDATE modificacion
                   SET estado='aplicada', updated_at=NOW()
                 WHERE id = ANY(%s) AND estado='activa'
                   AND (fecha_hasta IS NULL OR fecha_hasta <= %s)
            """, (list(ids), ultimo))
        else:
            cur.execute("""
                UPDATE modificacion
                   SET estado='aplicada', updated_at=NOW()
                 WHERE id = ANY(%s) AND estado='activa'
            """, (list(ids),))
        return cur.rowcount


def resumen_aplicadas(info_por_cuota, info_global):
    """Devuelve un string corto para incluir en notas del recibo."""
    def _sig(x):
        if x['tipo'] == 'precio_alternativo': return '='
        v = float(x.get('valor') or 0)
        return '+' if v >= 0 else '−'
    def _abs(x):
        return abs(float(x.get('valor') or 0))
    partes = []
    for inf in info_por_cuota:
        for x in inf:
            partes.append(f"{_sig(x)}{_abs(x)}€ ({x['tipo']})"
                          + (f": {x['razon']}" if x['razon'] else ''))
    for x in info_global:
        partes.append(f"global {_sig(x)}{_abs(x)}€ ({x['tipo']})"
                      + (f": {x['razon']}" if x['razon'] else ''))
    return ', '.join(partes)
