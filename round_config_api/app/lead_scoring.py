"""Cálculo de score de lead 0-100 (heurística simple).

El score sirve para priorizar la atención del trainer:
  - VERDE  (≥70): muy probable conversión
  - AMARILLO (40-69): seguimiento normal
  - ROJO   (<40): contactar igualmente, pero baja probabilidad

Factores positivos:
  + Email Y teléfono presentes        (+15)
  + Cuota de interés especificada     (+15)
  + Mensaje libre escrito (>20 chars) (+10)
  + Objetivo o presupuesto detallados (+10)
  + UTM source de campaña pagada      (+10)
  + Etapa avanzada (Contactado/+)     (+10–25)
  + Edad rango óptimo (25-45)         (+5)

Factores negativos:
  - >24h sin contactar y sigue 'Nuevo' (-15)
  - >7 días sin contactar              (-25)
  - Lead marcado perdido               score = 0
"""
from datetime import datetime, timezone

PAID_UTM_SOURCES = {
    'instagram', 'facebook', 'meta', 'google', 'google_ads',
    'tiktok', 'youtube', 'paid', 'cpc',
}

STAGE_BONUS = {
    'nuevo':       0,
    'contactado': 10,
    'visita':     20,
    'prueba':     25,
    'alta':       25,   # Alta no se va a usar para priorizar (ya cliente), pero le ponemos 25
}

LOST_REASONS = [
    {'value': 'precio',       'label': 'Demasiado caro'},
    {'value': 'ubicacion',    'label': 'Ubicación inadecuada'},
    {'value': 'no_responde',  'label': 'No responde / contacto fallido'},
    {'value': 'horario',      'label': 'Horario incompatible'},
    {'value': 'competencia',  'label': 'Eligió competencia'},
    {'value': 'no_listo',     'label': 'No está listo para empezar'},
    {'value': 'duplicado',    'label': 'Lead duplicado'},
    {'value': 'spam',         'label': 'Spam / fake'},
    {'value': 'otro',         'label': 'Otro'},
]


def _hours_since(ts):
    if not ts: return None
    if ts.tzinfo is None: ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds() / 3600


def calcular_score(asignacion, lead_odoo=None):
    """asignacion: row dict de lead_asignacion (raw_payload, qualification, last_contact_at, created_at, lost_at, stage_history)
       lead_odoo:  dict con stage_id (tuple [id,name]) opcional
    Devuelve int 0-100.
    """
    if asignacion.get('lost_at'):
        return 0

    raw = asignacion.get('raw_payload') or {}
    qual = asignacion.get('qualification') or {}
    score = 30  # base

    # 1) Datos de contacto
    if raw.get('email') and raw.get('telefono'): score += 15
    elif raw.get('email') or raw.get('telefono'): score += 5

    # 2) Cuota interés
    if (raw.get('cuota') or raw.get('cuota_interes') or qual.get('cuota_interes')):
        score += 15

    # 3) Mensaje
    msg = (raw.get('mensaje') or raw.get('message') or '').strip()
    if len(msg) > 20: score += 10

    # 4) Qualification rica
    if qual.get('objetivo') or qual.get('presupuesto'): score += 10

    # 5) UTM pagada
    utm = (asignacion.get('utm_source') or raw.get('utm_source') or '').lower()
    if any(s in utm for s in PAID_UTM_SOURCES): score += 10

    # 6) Bonus por etapa
    stage_name = ''
    if lead_odoo and lead_odoo.get('stage_id'):
        try:    stage_name = (lead_odoo['stage_id'][1] or '').lower()
        except: stage_name = ''
    bonus = STAGE_BONUS.get(stage_name, 0)
    score += bonus

    # 7) Edad rango óptimo
    edad = qual.get('edad')
    try:
        edad_int = int(edad) if edad else None
        if edad_int and 25 <= edad_int <= 45: score += 5
    except (ValueError, TypeError):
        pass

    # 8) Penalizaciones por inactividad (solo si sigue en Nuevo)
    if stage_name == 'nuevo':
        ref_ts = asignacion.get('created_at')
        h = _hours_since(ref_ts)
        if h is not None:
            if h > 24 * 7:    score -= 25
            elif h > 24:      score -= 15

    return max(0, min(100, score))


def color_for_score(s):
    if s is None: return 'gray'
    if s >= 70: return 'green'
    if s >= 40: return 'amber'
    return 'red'
