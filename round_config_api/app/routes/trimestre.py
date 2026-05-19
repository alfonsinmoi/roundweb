"""Endpoint para informar al frontend si toca facturar trimestre.

Lógica:
  - Si estamos dentro de los primeros 15 días del trimestre siguiente Y hay
    recibos pagados pendientes de facturar del trimestre cerrado → aviso ON.
  - El frontend usa esto para mostrar banner naranja con call-to-action.

Endpoint:
  GET  /api/cuotas/trimestre/aviso  → {pendiente: bool, trim: '2026-T2', ...}
"""
import datetime as dt
import logging
from flask import Blueprint, jsonify, g
from ..auth import auth_required
from ..db import get_conn

bp = Blueprint('trimestre', __name__)
log = logging.getLogger(__name__)


def _trim_actual_y_anterior():
    """Devuelve (trim_actual, trim_anterior) en formato 'YYYY-Tn'."""
    hoy = dt.date.today()
    t = (hoy.month - 1) // 3 + 1
    y = hoy.year
    if t == 1:
        prev = f'{y - 1}-T4'
    else:
        prev = f'{y}-T{t - 1}'
    return f'{y}-T{t}', prev


def _meses_de_trim(trim):
    y, t = trim.split('-T')
    y = int(y); t = int(t)
    base = (t - 1) * 3 + 1
    return [f'{y}-{m:02d}' for m in (base, base + 1, base + 2)]


@bp.route('/aviso', methods=['GET'])
@auth_required
def aviso():
    """¿Hay recibos pendientes de facturar del trimestre anterior?"""
    hoy = dt.date.today()
    trim_actual, trim_prev = _trim_actual_y_anterior()
    # Solo mostramos aviso si estamos en los primeros 15 días del trim actual
    # (alta visibilidad inicial; pasados los 15 días seguimos avisando si hay
    # pendientes pero menos prominente).
    primer_dia_trim = dt.date(hoy.year, ((hoy.month - 1) // 3) * 3 + 1, 1)
    dias_desde_inicio = (hoy - primer_dia_trim).days
    es_inicio_trim = dias_desde_inicio < 15

    meses_prev = _meses_de_trim(trim_prev)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) AS n, COALESCE(SUM(importe_total), 0) AS total
              FROM recibo
             WHERE id_manager = %s AND periodo = ANY(%s)
               AND estado = 'pagado' AND account_move_id IS NULL
        """, (str(g.id_manager), meses_prev))
        r = cur.fetchone()

    pagados_pte = int(r['n'])
    importe_pte = float(r['total'] or 0)

    pendiente = pagados_pte > 0

    return jsonify({
        'ok': True,
        'pendiente': pendiente,
        'trim_actual': trim_actual,
        'trim_anterior': trim_prev,
        'pagados_pendientes_facturar': pagados_pte,
        'importe_pendiente_eur': importe_pte,
        'es_inicio_trim': es_inicio_trim,
        'dias_desde_inicio_trim': dias_desde_inicio,
    })
