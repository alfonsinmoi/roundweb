"""Función única para enviar notificaciones — el resto de la app la usa.

Resuelve la audiencia (cliente / lista / cluster / broadcast) a una lista de
clientes NoofitPro, persiste la fila notif_envio + notif_destinatario, y
opcionalmente envía YA via OneSignal (o se queda pendiente para que el cron
la coja si está programada a futuro).

Uso típico desde otros módulos:

    from app.notif_sender import enviar_notificacion

    enviar_notificacion(
        id_manager='17675', id_trainer='17675',
        seccion='cobros', tipo='impago_efectivo',
        titulo='Recibo pendiente',
        cuerpo='Tienes un recibo de 45€ pendiente.',
        audience={'tipo': 'cliente', 'ref': 1779325},
        origen='cron_impago', origen_ref='recibo:42',
    )
"""
import json
import logging
from datetime import datetime, timezone

from .db import get_conn
from .notif_catalog import is_seccion_valida, is_tipo_valido, get_plantilla, render_plantilla
from .onesignal_client import get_client as get_onesignal, OneSignalError

log = logging.getLogger(__name__)


# ── Mapeo errores OneSignal → mensaje amigable ─────────────────────────────
def _friendly_onesignal_error(raw: str) -> str:
    """Convierte errores técnicos de OneSignal en algo legible para el manager.

    El error más común hoy: 'All included players are not subscribed' →
    NoofitPro todavía no llama a OneSignal.login() en mynoofit, así que el
    cliente_idnoofit no está vinculado a ningún dispositivo en OneSignal.
    """
    if not raw:
        return 'Error desconocido enviando push'
    rl = raw.lower()
    if 'all included players are not subscribed' in rl or 'no users with' in rl:
        return ('El cliente no recibe notificaciones porque aún no se ha vinculado '
                'su mynoofit con su cuenta. Pendiente de que NoofitPro implemente '
                'OneSignal.login() en su app — ver INTEGRACION_NOOFIT_PENDIENTE.md.')
    if 'invalid_external_user_ids' in rl:
        return 'Cliente desconocido para OneSignal (External ID inválido).'
    if 'unauthorized' in rl or '401' in rl:
        return 'API Key OneSignal inválida o sin permisos. Revisa configuración.'
    if 'rate' in rl and 'limit' in rl:
        return 'Demasiados envíos en poco tiempo (rate limit OneSignal). Espera unos minutos.'
    # Acortar el mensaje técnico
    return raw[:200]


# ── Audience resolvers ─────────────────────────────────────────────────────
def _resolver_audience(id_manager, id_trainer, audience):
    """Convierte un descriptor de audience a una lista de cliente_idnoofit (str).

    audience formats:
      {'tipo':'cliente',    'ref': 1779325}                   → [1779325]
      {'tipo':'lista',      'ref': [1, 2, 3]}                 → [1, 2, 3]
      {'tipo':'cluster',    'ref': cluster_id, 'clientes': [...]}  → la lista que mande el caller
      {'tipo':'broadcast'}                                    → [] vacío + segments=['Subscribed Users']

    Para 'cluster' el caller pasa la lista de clientes ya resuelta porque la
    lógica de qué clientes están en qué cluster vive en el frontend (donde
    se calcula con clustering.js). Aquí no recomputamos.

    Devuelve: (lista_ids, scope, scope_ref)
    """
    if not audience or not isinstance(audience, dict):
        raise ValueError('audience requerido')
    tipo = audience.get('tipo')
    if tipo == 'cliente':
        ref = audience.get('ref')
        if not ref:
            raise ValueError('audience.ref requerido para tipo=cliente')
        return [str(ref)], 'cliente', json.dumps({'ref': str(ref)})
    if tipo == 'lista':
        ref = audience.get('ref') or []
        if not isinstance(ref, list) or not ref:
            raise ValueError('audience.ref debe ser lista no vacía para tipo=lista')
        return [str(x) for x in ref], 'lista', json.dumps({'ref': [str(x) for x in ref]})
    if tipo == 'cluster':
        clientes = audience.get('clientes') or audience.get('ref_clientes') or []
        cluster_id = audience.get('ref') or audience.get('cluster_id')
        if not clientes:
            raise ValueError('audience.clientes requerido para tipo=cluster (lista de ids resueltos)')
        return [str(x) for x in clientes], 'cluster', json.dumps({
            'cluster_id': cluster_id,
            'clientes_count': len(clientes),
        })
    if tipo == 'broadcast':
        return [], 'broadcast', json.dumps({'scope': 'all'})
    if tipo == 'subscription':
        # Modo "directo a device" — útil para tests o cuando NoofitPro todavía
        # no pobla external_user_id. ref puede ser un subscription_id o lista.
        ref = audience.get('ref')
        sub_ids = ref if isinstance(ref, list) else [ref]
        sub_ids = [str(x) for x in sub_ids if x]
        if not sub_ids:
            raise ValueError('audience.ref requerido para tipo=subscription')
        return [], 'subscription', json.dumps({'subscription_ids': sub_ids})
    raise ValueError(f'audience.tipo desconocido: {tipo}')


# ── Plantilla rendering ────────────────────────────────────────────────────
def _render_si_plantilla(tipo_id, titulo, cuerpo, plantilla_vars):
    """Si el caller no pasa titulo/cuerpo y existe plantilla del tipo, la usa.

    Si pasa titulo/cuerpo, los sustituye con las variables tal cual.
    """
    plantilla = get_plantilla(tipo_id)
    titulo_final = titulo or plantilla.get('titulo', '')
    cuerpo_final = cuerpo or plantilla.get('cuerpo', '')
    if plantilla_vars:
        titulo_final = render_plantilla(titulo_final, plantilla_vars)
        cuerpo_final = render_plantilla(cuerpo_final, plantilla_vars)
    return titulo_final, cuerpo_final


# ── Función principal ─────────────────────────────────────────────────────
def enviar_notificacion(*,
        id_manager,
        id_trainer=None,
        seccion,
        tipo,
        titulo=None,
        cuerpo=None,
        cuerpo_html=None,
        url=None,
        audience,
        plantilla_vars=None,
        fecha_desaparicion=None,
        programada_at=None,
        origen='manual',
        origen_ref=None,
        created_by=None,
        send_now=True):
    """Crea un envío + sus destinatarios y opcionalmente lo manda via OneSignal.

    Devuelve: dict con {ok, envio_id, total_destinatarios, onesignal_id, estado}.

    Ver docstring del módulo para forma de `audience`.
    """
    # ── Validaciones ──
    if not id_manager:
        return {'ok': False, 'error': 'id_manager_required'}
    if not is_seccion_valida(seccion):
        return {'ok': False, 'error': f'seccion_invalida:{seccion}'}
    if not is_tipo_valido(tipo, seccion):
        return {'ok': False, 'error': f'tipo_invalido:{tipo}'}

    # Resolver audiencia
    try:
        clientes, scope, scope_ref = _resolver_audience(id_manager, id_trainer, audience)
    except ValueError as e:
        return {'ok': False, 'error': str(e)}

    # Render plantilla
    titulo_f, cuerpo_f = _render_si_plantilla(tipo, titulo, cuerpo, plantilla_vars)
    if not titulo_f:
        return {'ok': False, 'error': 'titulo_vacio'}

    # Decisión de envío
    enviar_ahora = send_now and not programada_at
    estado_inicial = 'pendiente'
    fecha_envio = None
    onesignal_id = None
    error_envio = None

    # ── Envío OneSignal (antes de persistir, para guardar el id) ──
    if enviar_ahora:
        try:
            cli = get_onesignal()
            kwargs = {
                'titulo': titulo_f,
                'cuerpo': cuerpo_f,
                'cuerpo_html': cuerpo_html,
                'url': url,
                'data': {
                    'seccion': seccion,
                    'tipo': tipo,
                    'origen': origen,
                    'origen_ref': origen_ref or '',
                },
            }
            if scope == 'broadcast':
                kwargs['segments'] = ['Subscribed Users']
            elif scope == 'subscription':
                # Subscription IDs van en player_ids (v1) — extraerlos de scope_ref
                sub_ids = json.loads(scope_ref).get('subscription_ids', [])
                kwargs['player_ids'] = sub_ids
            else:
                kwargs['external_user_ids'] = clientes
            r = cli.enviar(**kwargs)
            onesignal_id = r.get('id')
            fecha_envio = datetime.now(timezone.utc)
            estado_inicial = 'enviada'
        except OneSignalError as e:
            log.warning(f'OneSignal envío falló: {e}')
            estado_inicial = 'fallida'
            error_envio = _friendly_onesignal_error(str(e))
        except Exception as e:
            log.exception('OneSignal unexpected')
            estado_inicial = 'fallida'
            error_envio = f'unexpected: {str(e)[:480]}'

    # ── Persistir envío + destinatarios ──
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO notif_envio (
                    id_manager, id_trainer, seccion, tipo, scope, scope_ref,
                    titulo, cuerpo, cuerpo_html, url,
                    programada_at, fecha_envio, fecha_desaparicion,
                    estado, onesignal_id, error,
                    origen, origen_ref, total_destinatarios, created_by
                ) VALUES (%s,%s,%s,%s,%s,%s::jsonb, %s,%s,%s,%s,
                          %s,%s,%s, %s,%s,%s, %s,%s,%s,%s)
                RETURNING id
            """, (
                str(id_manager), str(id_trainer or '') or None,
                seccion, tipo, scope, scope_ref,
                titulo_f, cuerpo_f, cuerpo_html, url,
                programada_at, fecha_envio, fecha_desaparicion,
                estado_inicial, onesignal_id, error_envio,
                origen, origen_ref, len(clientes), created_by,
            ))
            envio_id = cur.fetchone()['id']

            # Destinatarios — solo si tenemos lista (broadcast no genera filas individuales,
            # se sigue el conteo via OneSignal recipients)
            if clientes:
                cur.executemany("""
                    INSERT INTO notif_destinatario
                        (envio_id, id_manager, id_trainer, cliente_idnoofit)
                    VALUES (%s,%s,%s,%s)
                """, [
                    (envio_id, str(id_manager), str(id_trainer or '') or None, c)
                    for c in clientes
                ])
    except Exception as e:
        log.exception('persist notif')
        return {'ok': False, 'error': f'db_error: {e}', 'onesignal_id': onesignal_id}

    return {
        'ok': True,
        'envio_id': envio_id,
        'total_destinatarios': len(clientes),
        'onesignal_id': onesignal_id,
        'estado': estado_inicial,
        'titulo': titulo_f,
        'cuerpo': cuerpo_f,
        'error': error_envio,
    }


# ── Marcar leída ──────────────────────────────────────────────────────────
def marcar_leida(envio_id: int, cliente_idnoofit: str) -> dict:
    """Marca como leída la notificación para ese cliente. Idempotente.

    Llamado por la app vía PUT /api/notif/<envio_id>/leida (público con token).
    """
    if not envio_id or not cliente_idnoofit:
        return {'ok': False, 'error': 'envio_id_y_cliente_requeridos'}
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE notif_destinatario
                   SET leida = TRUE, fecha_lectura = COALESCE(fecha_lectura, NOW())
                 WHERE envio_id = %s AND cliente_idnoofit = %s
                RETURNING id, leida, fecha_lectura
            """, (envio_id, str(cliente_idnoofit)))
            row = cur.fetchone()
        if not row:
            return {'ok': False, 'error': 'destinatario_no_encontrado'}
        return {'ok': True, 'destinatario_id': row['id'], 'leida': True,
                'fecha_lectura': row['fecha_lectura'].isoformat() if row['fecha_lectura'] else None}
    except Exception as e:
        log.exception('marcar_leida')
        return {'ok': False, 'error': str(e)}
