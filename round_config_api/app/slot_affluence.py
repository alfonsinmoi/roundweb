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
# Días excluidos por defecto si el centro no configura nada en `dias_permitidos`.
# El manager puede sobrescribir esto desde Configuración → Centros.
# Default actual: solo miércoles y jueves disponibles para pruebas.
DIAS_EXCLUIDOS = {0, 1, 4, 5, 6}

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
        'id_actividad':  sala.get('idActividad'),
        'actividad':     sala.get('actividad') or sala.get('nameActividad') or '',
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


def slots_disponibles(id_trainer, dias_adelante=14, max_resultados=12,
                      id_actividad=None, devolver_actividades=False,
                      dias_permitidos=None, actividades_permitidas=None):
    """Devuelve los slots con menor afluencia para reserva de prueba.

    id_trainer: id del centro/trainer en NoofitPro (ej. 17675)
    dias_adelante: cuántos días al futuro mirar
    max_resultados: cuántos slots devolver (los más vacíos)
    id_actividad: si se pasa, filtra solo clases de esa actividad NoofitPro
    devolver_actividades: si True, devuelve también la lista de actividades
                          únicas disponibles en la ventana (para selector web)
    dias_permitidos: set/list de int 0-6 (lun=0...dom=6). Si se pasa, sólo se
                     muestran clases en esos días. Si None o lista vacía, se
                     usa el default DIAS_EXCLUIDOS.
    actividades_permitidas: set/list de id_actividad. Si se pasa y no vacía,
                            sólo se muestran clases de esas actividades.

    Retorna:
        - lista de slots si devolver_actividades=False (compat)
        - dict {slots, actividades} si devolver_actividades=True
    """
    # Normalizar dias_permitidos → set de excluidos
    if dias_permitidos:
        try:
            dp = {int(x) for x in dias_permitidos if 0 <= int(x) <= 6}
            dias_excluidos = {0,1,2,3,4,5,6} - dp if dp else DIAS_EXCLUIDOS
        except (TypeError, ValueError):
            dias_excluidos = DIAS_EXCLUIDOS
    else:
        dias_excluidos = DIAS_EXCLUIDOS

    # Normalizar actividades_permitidas → set de int (vacío = todas)
    actividades_filtro = set()
    if actividades_permitidas:
        try:
            actividades_filtro = {int(x) for x in actividades_permitidas if str(x).strip()}
        except (TypeError, ValueError):
            actividades_filtro = set()
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

    # 4) Filtrar futuras: aforo válido, no llenas, antelación mínima, días permitidos
    candidatas = []
    actividades_set = {}    # id_actividad → {id, nombre, n_clases}
    for s in futuras:
        dt = _ms_to_dt(s.get('dateStart'))
        if not dt: continue
        if dt.weekday() in dias_excluidos: continue
        if (dt - ahora) < timedelta(hours=ANTELACION_MINIMA_HORAS): continue
        aforo = s.get('aforo') or 0
        if aforo <= 0: continue
        users = s.get('users') or []
        ocupados = sum(1 for u in users if u.get('enabled', True))
        libres = aforo - ocupados
        if libres < 1: continue
        # Filtrar por whitelist de actividades del centro (config admin)
        act_id_int = s.get('idActividad')
        try: act_id_int = int(act_id_int) if act_id_int is not None else None
        except (TypeError, ValueError): act_id_int = None
        if actividades_filtro and act_id_int not in actividades_filtro:
            continue
        # Recopilar actividades disponibles ANTES de aplicar filtro id_actividad
        # (para que el selector frontend muestre las opciones reales)
        act_id = s.get('idActividad')
        act_name = s.get('actividad') or s.get('nameActividad') or s.get('name') or ''
        if act_id is not None:
            key = str(act_id)
            if key not in actividades_set:
                actividades_set[key] = {
                    'id': act_id, 'nombre': act_name, 'n_clases': 0,
                }
            actividades_set[key]['n_clases'] += 1
        # Filtrar por actividad si se pidió (parámetro URL ?actividad=)
        if id_actividad is not None and str(s.get('idActividad') or '') != str(id_actividad):
            continue
        candidatas.append((s, _score(s), libres))

    # 5) Ordenar por afluencia ascendente y luego por fecha
    candidatas.sort(key=lambda x: (x[1], _ms_to_dt(x[0].get('dateStart'))))

    out = []
    for sala, sc, libres in candidatas[:max_resultados]:
        out.append(_serialize(sala, sc, None, libres))

    if devolver_actividades:
        actividades = sorted(actividades_set.values(), key=lambda a: a['nombre'])
        return {'slots': out, 'actividades': actividades}
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
