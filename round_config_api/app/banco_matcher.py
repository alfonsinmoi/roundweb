"""Matching banco ↔ facturas (gasto_documento).

Pasada 1:1 con scoring multi-criterio:
  - Importe exacto (±0.05) → +50 pts
  - Importe = -importe_factura (banco sale, factura entra al gasto) → +50 pts
  - Diferencia de fechas en días: +20 si ≤3, +10 si ≤7, +5 si ≤30
  - Coincidencia parcial concepto ↔ proveedor: hasta +25 pts (similitud tokens)
  - Coincidencia ref ↔ num_factura: +20 pts si subsecuencia

Si score ≥ THRESHOLD_AUTO_MATCH, propone match automático.
Si entre THRESHOLD_NEAR_MATCH y AUTO, sugerencia para revisión humana.
"""
import logging
import re
from datetime import date, timedelta

log = logging.getLogger(__name__)

THRESHOLD_AUTO_MATCH = 80     # score ≥ 80 → match automático
THRESHOLD_NEAR_MATCH = 50     # 50 ≤ score < 80 → sugerencia humana


def _normalizar(s: str) -> str:
    if not s: return ''
    s = str(s).lower().strip()
    repl = (('á','a'),('é','e'),('í','i'),('ó','o'),('ú','u'),('ñ','n'))
    for a, b in repl:
        s = s.replace(a, b)
    s = re.sub(r'[^\w\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def _tokens(s: str) -> set:
    """Tokens ≥3 chars sin stop-words."""
    STOP = {'del','los','las','con','por','para','que','sas','sau','sl','slu','sa',
            'ltd','inc','com','www','net','factura','recibo'}
    n = _normalizar(s)
    return {t for t in n.split() if len(t) >= 3 and t not in STOP}


def _score_pair(mov: dict, fac: dict) -> tuple:
    """Devuelve (score, breakdown) entre un movimiento y una factura.

    `mov`: {fecha, concepto, importe, ref_externa}
    `fac`: {fecha_documento, proveedor, importe_total, num_factura}
    """
    score = 0
    bd = {}
    # Importe (banco viene en negativo cuando es gasto; comparamos absoluto)
    try:
        imp_b = abs(float(mov.get('importe') or 0))
        imp_f = abs(float(fac.get('importe_total') or 0))
        if imp_b > 0 and imp_f > 0 and abs(imp_b - imp_f) <= 0.05:
            score += 50
            bd['importe'] = '+50 (exacto)'
        elif imp_b > 0 and imp_f > 0 and abs(imp_b - imp_f) <= 1.00:
            score += 30
            bd['importe'] = '+30 (≈)'
    except Exception:
        pass

    # Fecha (proximidad)
    try:
        f_b = mov.get('fecha')
        f_f = fac.get('fecha_documento')
        if f_b and f_f:
            if isinstance(f_f, str):
                from datetime import datetime as _dt
                f_f = _dt.strptime(f_f[:10], '%Y-%m-%d').date()
            diff = abs((f_b - f_f).days)
            if diff <= 3:
                score += 20; bd['fecha'] = f'+20 ({diff}d)'
            elif diff <= 7:
                score += 10; bd['fecha'] = f'+10 ({diff}d)'
            elif diff <= 30:
                score += 5;  bd['fecha'] = f'+5 ({diff}d)'
    except Exception:
        pass

    # Concepto ↔ proveedor (overlap de tokens)
    tb = _tokens(mov.get('concepto', ''))
    tf = _tokens(fac.get('proveedor', ''))
    if tb and tf:
        common = tb & tf
        if common:
            pts = min(25, 5 * len(common))
            score += pts
            bd['concepto'] = f'+{pts} ({", ".join(list(common)[:3])})'

    # Referencia ↔ num_factura
    ref_b = (mov.get('ref_externa') or '').strip()
    nf = (fac.get('num_factura') or '').strip()
    if ref_b and nf:
        rn = re.sub(r'\W', '', ref_b).upper()
        nn = re.sub(r'\W', '', nf).upper()
        if rn and nn and (rn in nn or nn in rn):
            score += 20
            bd['ref'] = '+20 (ref↔num)'

    return score, bd


def proponer_matches(movimientos: list, facturas: list, asignados_ids: set = None):
    """Devuelve lista de matches propuestos.

    `movimientos`: lista de banco_movimiento dicts (los aún sin cuadrar)
    `facturas`: lista de gasto_documento dicts (validadas, no anuladas)
    `asignados_ids`: set de factura.id ya vinculadas a otro movimiento

    Retorna:
      [{movimiento_id, factura_id, score, breakdown, accion}]
      con accion ∈ {'auto', 'sugerencia'}.
    """
    asignados_ids = asignados_ids or set()
    out = []
    for mov in movimientos:
        best = (0, None, None)  # (score, factura_id, breakdown)
        for fac in facturas:
            if fac['id'] in asignados_ids:
                continue
            score, bd = _score_pair(mov, fac)
            if score > best[0]:
                best = (score, fac['id'], bd)
        if best[1] and best[0] >= THRESHOLD_NEAR_MATCH:
            out.append({
                'movimiento_id': mov['id'],
                'factura_id': best[1],
                'score': best[0],
                'breakdown': best[2],
                'accion': 'auto' if best[0] >= THRESHOLD_AUTO_MATCH else 'sugerencia',
            })
    return out
