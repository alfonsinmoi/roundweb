"""Cálculo de slots disponibles para reserva de prueba.

Para cada clase futura (próximos 14 días):
  - Identificamos su "patrón" (mismo nombre + mismo idTrainer + mismo idActividad)
  - Buscamos instancias pasadas del mismo patrón en dos ventanas:
      · 4 semanas (peso 0.6) → reactivo a tendencias
      · 12 semanas (peso 0.4) → estabilidad
  - Afluencia = ocupación media (asistentes_verificados / aforo)
  - Score final = blend ponderado de las dos ventanas
  - Excluimos lunes y martes (días de mayor afluencia)
  - Excluimos clases ya llenas o sin aforo definido

Devolvemos los N slots con menor afluencia, agrupados por día.
"""
import logging
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from . import noofit_client as nc

log = logging.getLogger(__name__)

DIA_NOMBRES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
DIAS_EXCLUIDOS = {0, 1}  # 0=Lunes, 1=Martes (datetime.weekday())

# Margen mínimo desde ahora para que el lead pueda llegar
ANTELACION_MINIMA_HORAS = 24


def _ms_to_dt(ms):
    if not ms: return None
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)


def _occupancy(sala):
    """% ocupación de una sala (0.0-1.0) o None si no se puede calcular."""
    aforo = sala.get('aforo')
    if not aforo or aforo <= 0: return None
    users = sala.get('users') or []
    # Solo asistentes con verify=True (asistencia real, no solo reserva)
    asistencias = sum(1 for u in users if u.get('verify') and u.get('enabled', True))
    return min(1.0, asistencias / aforo)


def _futuro_occupancy(sala):
    """Para clases futuras: ocupación de reservas (no asistencia, todavía)."""
    aforo = sala.get('aforo')
    if not aforo or aforo <= 0: return None
    users = sala.get('users') or []
    reservas = sum(1 for u in users if u.get('enabled', True))
    return min(1.0, reservas / aforo)


def _patron(sala):
    """Clave de patrón: nombre + idTrainer (ignora idActividad ya que name suele
    incluir la actividad)."""
    return (
        (sala.get('name') or '').strip().lower(),
        sala.get('idTrainer'),
    )


def _afluencia_historica(salas_pasadas, weeks_window):
    """Devuelve dict {patron: ocupacion_media} para salas en la ventana dada."""
    cutoff = datetime.now(timezone.utc) - timedelta(weeks=weeks_window)
    bucket = defaultdict(list)
    for s in salas_pasadas:
        dt = _ms_to_dt(s.get('dateStart'))
        if not dt or dt < cutoff or dt > datetime.now(timezone.utc):
            continue
        occ = _occupancy(s)
        if occ is None: continue
        bucket[_patron(s)].append(occ)
    return {k: sum(v)/len(v) for k, v in bucket.items() if v}


def _serialize(sala, score, occ_proyectada, capacidad_libre):
    dt = _ms_to_dt(sala.get('dateStart'))
    return {
        'id_sala':       sala.get('id'),
        'id_trainer':    sala.get('idTrainer'),
        'nombre':        sala.get('name'),
        'fecha_iso':     dt.isoformat() if dt else None,
        'fecha_local':   dt.astimezone().strftime('%Y-%m-%d') if dt else None,
        'hora':          dt.astimezone().strftime('%H:%M') if dt else None,
        'dia_nombre':    DIA_NOMBRES[dt.weekday()] if dt else None,
        'dia_iso':       dt.weekday() if dt else None,
        'aforo':         sala.get('aforo'),
        'reservados':    (sala.get('aforo') or 0) - capacidad_libre,
        'libres':        capacidad_libre,
        'afluencia_pct': round(score * 100, 1),  # 0-100, menor = más vacía
        'nivel':         _nivel(score),
    }


def _nivel(score):
    if score < 0.30: return 'tranquila'
    if score < 0.60: return 'normal'
    if score < 0.85: return 'concurrida'
    return 'casi_llena'


def slots_disponibles(id_trainer, dias_adelante=14, max_resultados=12):
    """Devuelve los slots con menor afluencia para reserva de prueba.

    id_trainer: id del centro/trainer en NoofitPro (ej. 17675)
    dias_adelante: cuántos días al futuro mirar
    max_resultados: cuántos slots devolver (los más vacíos)
    """
    ahora = datetime.now(timezone.utc)
    futuro = ahora + timedelta(days=dias_adelante)
    pasado_4w = ahora - timedelta(weeks=4)
    pasado_12w = ahora - timedelta(weeks=12)

    # 1) Traer salas en una ventana grande (12 semanas atrás → 14 días futuro)
    desde_iso = pasado_12w.astimezone().strftime('%Y-%m-%dT%H:%M:%S%z')
    hasta_iso = futuro.astimezone().strftime('%Y-%m-%dT%H:%M:%S%z')
    # Inserta colon en offset (NoofitPro acepta ISO con +02:00)
    def _fix_offset(s):
        if len(s) >= 5 and (s[-5] == '+' or s[-5] == '-') and s[-3] != ':':
            return s[:-2] + ':' + s[-2:]
        return s
    desde_iso = _fix_offset(desde_iso)
    hasta_iso = _fix_offset(hasta_iso)

    todas = nc.get_clases_por_rango(desde_iso, hasta_iso) or []
    log.info(f'slots_disponibles trainer={id_trainer} salas_total={len(todas)}')

    # 2) Filtrar por id_trainer si se pidió uno
    if id_trainer:
        todas = [s for s in todas if str(s.get('idTrainer') or '') == str(id_trainer)]

    pasadas, futuras = [], []
    for s in todas:
        dt = _ms_to_dt(s.get('dateStart'))
        if not dt: continue
        if dt < ahora: pasadas.append(s)
        else:          futuras.append(s)

    # 3) Calcular afluencia histórica con dos ventanas (blend 0.6 / 0.4)
    afluencia_4w  = _afluencia_historica(pasadas, weeks_window=4)
    afluencia_12w = _afluencia_historica(pasadas, weeks_window=12)

    def _score(sala):
        p = _patron(sala)
        s4  = afluencia_4w.get(p)
        s12 = afluencia_12w.get(p)
        if s4 is not None and s12 is not None:
            return 0.6 * s4 + 0.4 * s12
        return s4 if s4 is not None else (s12 if s12 is not None else 0.5)

    # 4) Filtrar futuras: aforo válido, no llenas, antelación mínima, sin lun/mar
    candidatas = []
    for s in futuras:
        dt = _ms_to_dt(s.get('dateStart'))
        if not dt: continue
        if dt.weekday() in DIAS_EXCLUIDOS: continue
        if (dt - ahora) < timedelta(hours=ANTELACION_MINIMA_HORAS): continue
        aforo = s.get('aforo') or 0
        if aforo <= 0: continue
        users = s.get('users') or []
        ocupados = sum(1 for u in users if u.get('enabled', True))
        libres = aforo - ocupados
        if libres < 1: continue
        candidatas.append((s, _score(s), libres))

    # 5) Ordenar por afluencia ascendente y luego por fecha
    candidatas.sort(key=lambda x: (x[1], _ms_to_dt(x[0].get('dateStart'))))

    out = []
    for sala, sc, libres in candidatas[:max_resultados]:
        out.append(_serialize(sala, sc, None, libres))
    return out


import threading, time as _time
_SALAS_CACHE = {'data': None, 'expires_at': 0, 'lock': threading.Lock()}
_SALAS_TTL = 60  # 1 min — se llama varias veces seguidas en flujos de reserva


def get_sala_info(sala_id):
    """Re-consulta una sala concreta (para confirmar disponibilidad antes de reservar).
    Cachea el listado completo durante 60s para acelerar reservas consecutivas."""
    sala_id = int(sala_id)
    now = _time.time()
    # Cache hit?
    if _SALAS_CACHE['data'] is not None and now < _SALAS_CACHE['expires_at']:
        for s in _SALAS_CACHE['data']:
            if s.get('id') == sala_id:
                return s
        return None
    # Cache miss — refresca con lock
    with _SALAS_CACHE['lock']:
        if _SALAS_CACHE['data'] is not None and _time.time() < _SALAS_CACHE['expires_at']:
            for s in _SALAS_CACHE['data']:
                if s.get('id') == sala_id: return s
            return None
        ahora = datetime.now(timezone.utc)
        futuro = ahora + timedelta(days=30)
        pasado = ahora - timedelta(days=2)
        def _fix(s):
            return s[:-2] + ':' + s[-2:] if len(s) >= 5 and s[-3] != ':' else s
        desde = _fix(pasado.astimezone().strftime('%Y-%m-%dT%H:%M:%S%z'))
        hasta = _fix(futuro.astimezone().strftime('%Y-%m-%dT%H:%M:%S%z'))
        salas = nc.get_clases_por_rango(desde, hasta) or []
        _SALAS_CACHE['data'] = salas
        _SALAS_CACHE['expires_at'] = now + _SALAS_TTL
    for s in salas:
        if s.get('id') == sala_id:
            return s
    return None
