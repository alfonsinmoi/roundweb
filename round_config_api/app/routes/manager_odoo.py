"""Gate y estado del Odoo per-manager.

Endpoints:

  GET  /api/manager/odoo-status
       Estado actual del Odoo del manager logueado:
         { odoo_enabled, odoo_company_id, odoo_activated_at,
           wcommerce_cliente_id, tipo_pago_wc, is_default_manager,
           features: { crm, cuotas, contabilidad } }

  POST /api/manager/wc-check
       Body: { wcommerce_cliente_id?: int }   (opcional, si lo manda usa ese;
       si no, usa el que tiene `manager_config.wcommerce_cliente_id`)
       Consulta wcommerce on-demand y devuelve:
         { ok, tipo_pago, elegible, cliente, motivo }
       Si elegible=true, el frontend muestra el modal de confirmación
       "Desplegar contabilidad" → tras Aceptar llamará a /activate (FASE 2).

  PATCH /api/manager/wcommerce-cliente
       Body: { wcommerce_cliente_id: int }
       Permite al manager (admin) introducir/cambiar manualmente el id
       wcommerce que enlaza Round con su cliente B2B. Después se puede
       verificar con /wc-check.
"""
import datetime as dt
import json
import logging

from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from .. import wcommerce_check
from ..audit_log import log_action, actor_from_request, diff_dict

bp = Blueprint('manager_odoo', __name__)
log = logging.getLogger(__name__)

# Manager histórico Round — exento del wizard, ya tiene Odoo desplegado
DEFAULT_MANAGER_ID = '17675'


def _row_manager(id_manager: str):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id_manager, nombre, noofit_email,
                   odoo_enabled, odoo_company_id, odoo_url, odoo_activated_at,
                   odoo_analytic_plan_id, odoo_analytic_default_id,
                   odoo_crm_enabled, odoo_cuotas_enabled, odoo_contabilidad_enabled,
                   sistemas_cobro,
                   wcommerce_cliente_id, tipo_pago_wc,
                   control_horario_enabled, control_horario_activated_at
              FROM manager_config
             WHERE id_manager = %s
        """, (str(id_manager),))
        return cur.fetchone()


def _features_from_row(row: dict) -> dict:
    """Devuelve qué módulos están habilitados a partir de la fila
    manager_config con las columnas granulares (Fase 6 + Fase 7).
    """
    if not row:
        return {'crm': False, 'cuotas': False, 'contabilidad': False,
                'control_horario': False}
    return {
        'crm':              bool(row.get('odoo_crm_enabled')),
        'cuotas':           bool(row.get('odoo_cuotas_enabled')),
        'contabilidad':     bool(row.get('odoo_contabilidad_enabled')),
        'control_horario':  bool(row.get('control_horario_enabled')),
    }


# ─── GET /odoo-status ──────────────────────────────────────────────────────

@bp.route('/odoo-status', methods=['GET'])
@auth_required
def odoo_status():
    """Estado actual + qué features están habilitadas para el manager.

    Si el manager NO existe en `manager_config` (caso típico: trainer
    nuevo que entra por primera vez y aún no tiene registro Round),
    devolvemos shape válido con `odoo_enabled=false` y features=false.
    NO 404, porque el frontend interpretaría 404 como "error de red" y
    aplicaría el fallback `features=true` (para no romper Round actual).
    """
    row = _row_manager(g.id_manager)
    if not row:
        return jsonify({
            'ok': True,
            'id_manager': g.id_manager,
            'nombre': None,
            'odoo_enabled': False,
            'odoo_crm_enabled': False,
            'odoo_cuotas_enabled': False,
            'odoo_contabilidad_enabled': False,
            'control_horario_enabled': False,
            'control_horario_activated_at': None,
            'sistemas_cobro': [],
            'odoo_company_id': None,
            'odoo_activated_at': None,
            'wcommerce_cliente_id': None,
            'tipo_pago_wc': None,
            'is_default_manager': False,
            'features': _features_from_row(None),
            'no_registrado_en_round': True,
        })
    odoo_enabled = bool(row['odoo_enabled'])
    # sistemas_cobro viene como JSONB (lista) o NULL → normalizamos a list
    sistemas = row.get('sistemas_cobro') or []
    if isinstance(sistemas, str):
        try:
            sistemas = json.loads(sistemas) or []
        except Exception:
            sistemas = []
    return jsonify({
        'ok': True,
        'id_manager': row['id_manager'],
        'nombre': row.get('nombre'),
        'odoo_enabled': odoo_enabled,
        'odoo_crm_enabled':          bool(row.get('odoo_crm_enabled')),
        'odoo_cuotas_enabled':       bool(row.get('odoo_cuotas_enabled')),
        'odoo_contabilidad_enabled': bool(row.get('odoo_contabilidad_enabled')),
        'control_horario_enabled':   bool(row.get('control_horario_enabled')),
        'control_horario_activated_at': (row['control_horario_activated_at'].isoformat()
                                          if row.get('control_horario_activated_at') else None),
        'sistemas_cobro': sistemas,
        'odoo_company_id': row.get('odoo_company_id'),
        'odoo_activated_at': (row['odoo_activated_at'].isoformat()
                              if row.get('odoo_activated_at') else None),
        'wcommerce_cliente_id': row.get('wcommerce_cliente_id'),
        'tipo_pago_wc': row.get('tipo_pago_wc'),
        'is_default_manager': str(row['id_manager']) == DEFAULT_MANAGER_ID,
        'features': _features_from_row(row),
    })


# ─── GET /checklist ────────────────────────────────────────────────────────

@bp.route('/checklist', methods=['GET'])
@auth_required
def checklist():
    """Estado de configuración del manager por módulo.

    Query params:
      modulo=crm|cuotas|contabilidad  → solo ese (default: los 3)

    Devuelve {ok, modulos: {<m>: {items:[...], critical_missing, warn,
    ok_count, total}}}. Cada item lleva status (ok|warn|missing) y
    `deeplink_tab` (id de la pestaña de Configuración para "Ir a configurar").
    """
    from ..checklist import compute_checklist
    modulo = (request.args.get('modulo') or '').strip().lower() or None
    if modulo and modulo not in ('crm', 'cuotas', 'contabilidad'):
        return jsonify({'ok': False, 'error': 'modulo_invalid'}), 400
    return jsonify(compute_checklist(g.id_manager, modulo))


# ─── POST /wc-check ────────────────────────────────────────────────────────

@bp.route('/wc-check', methods=['POST'])
@auth_required
def wc_check():
    """Consulta wcommerce on-demand y devuelve si el manager es elegible
    para desplegar Odoo. Si el manager ya lo tiene desplegado, devuelve
    `ya_desplegado=true` directamente (no consulta wcommerce).

    Persiste el `tipo_pago_wc` recibido para mostrarlo en UI sin re-llamar.
    """
    row = _row_manager(g.id_manager)
    if not row:
        return jsonify({'ok': False, 'error': 'manager_not_found'}), 404
    if row.get('odoo_enabled'):
        return jsonify({
            'ok': True,
            'ya_desplegado': True,
            'odoo_company_id': row.get('odoo_company_id'),
        })

    # Resolver el id wcommerce: del body si viene, si no de BD. En wcommerce
    # el "id" canónico es el campo `codigo`, una cadena tipo '00004645'.
    data = request.get_json(silent=True) or {}
    wc_id = data.get('wcommerce_cliente_id') or row.get('wcommerce_cliente_id')
    if wc_id is None or str(wc_id).strip() == '':
        return jsonify({
            'ok': False,
            'error': 'sin_wcommerce_id',
            'motivo': ('No tenemos el id de cliente en wcommerce. '
                       'Configúralo primero en Configuración → Contabilidad.'),
        }), 400
    wc_id = str(wc_id).strip()

    # Consulta wcommerce
    res = wcommerce_check.get_tipo_pago(wc_id)
    tipo = res.get('tipo_pago')
    err = res.get('error')

    # Persistir lo último que sabemos
    if tipo is not None:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE manager_config
                   SET tipo_pago_wc = %s,
                       wcommerce_cliente_id = COALESCE(wcommerce_cliente_id, %s)
                 WHERE id_manager = %s
            """, (tipo, wc_id, str(g.id_manager)))
        log_action(actor_from_request(), 'manager_odoo', 'wc_check',
                   entidad_id=str(g.id_manager),
                   resumen=f'Consulta wcommerce: tipo_pago={tipo}',
                   cambios=diff_dict({'tipo_pago_wc': row.get('tipo_pago_wc')},
                                     {'tipo_pago_wc': tipo}))

    elegible = (tipo == 'S')
    motivo = None
    if err == 'cliente_not_found':
        motivo = f'No encuentro el cliente {wc_id} en wcommerce. Verifica el id.'
    elif err and err.startswith('wcommerce_unreachable'):
        motivo = 'No puedo conectar con wcommerce ahora mismo. Intenta más tarde.'
    elif tipo and not elegible:
        motivo = (f'Tu tipo de suscripción wcommerce es "{tipo}", no incluye '
                  'contabilidad/CRM/remesas. Contacta con Wiemspro para '
                  'cambiar a tipo S.')

    return jsonify({
        'ok': tipo is not None,
        'ya_desplegado': False,
        'tipo_pago': tipo,
        'elegible': elegible,
        'cliente': res.get('cliente'),
        'error': err,
        'motivo': motivo,
    })


# ─── PATCH /wcommerce-cliente ──────────────────────────────────────────────

@bp.route('/wcommerce-cliente', methods=['PATCH', 'PUT'])
@auth_required
def set_wcommerce_cliente():
    """Permite (al admin del manager) introducir/cambiar manualmente el id
    de cliente en wcommerce."""
    data = request.get_json(silent=True) or {}
    wc_id = data.get('wcommerce_cliente_id')
    if wc_id is not None and str(wc_id).strip() != '':
        wc_id = str(wc_id).strip()
    else:
        wc_id = None

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE manager_config
               SET wcommerce_cliente_id = %s,
                   tipo_pago_wc = NULL   -- forzamos re-chequeo
             WHERE id_manager = %s
            RETURNING wcommerce_cliente_id
        """, (wc_id, str(g.id_manager)))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'manager_not_found'}), 404
    log_action(actor_from_request(), 'manager_odoo', 'set_wcommerce',
               entidad_id=str(g.id_manager),
               resumen='Actualizado id cliente wcommerce',
               cambios={'wcommerce_cliente_id': r['wcommerce_cliente_id'],
                        'tipo_pago_wc': None})
    return jsonify({'ok': True, 'wcommerce_cliente_id': r['wcommerce_cliente_id']})


# ─── Activación per-módulo (Fase 6) ────────────────────────────────────────
#
# Tres endpoints idempotentes — el nuevo "Suscripciones" en Configuración
# llama a cada uno desde su sub-tab cuando el manager pulsa Activar.
# Comparten validación: el manager debe ser tipo S en wcommerce.

_MODULE_PROVISIONERS = {
    'crm':          ('provision_crm',          'odoo_crm_enabled'),
    'cuotas':       ('provision_cuotas',       'odoo_cuotas_enabled'),
    'contabilidad': ('provision_contabilidad', 'odoo_contabilidad_enabled'),
}

# Campos requeridos del wizard. Lista canónica: si alguno falta, 400.
# (Definido aquí en lugar de más abajo para que tanto el endpoint nuevo
# `/provision/<modulo>` como el legacy `/solicitud-despliegue` lo usen.
# Python lo resolvería en cualquier orden por lexical scoping at-call-time,
# pero ponerlo arriba aclara la lectura.)
_REQUIRED_FIELDS = ['razon_social', 'cif']

# Campos opcionales que persistimos si vienen (legacy wizard)
_OPTIONAL_FIELDS = [
    'direccion', 'poblacion', 'cp', 'provincia', 'pais',
    'telefono', 'email_facturacion',
    'plan_contable', 'factura_secuencia_prefijo', 'factura_ultimo_numero',
    'iban_principal', 'banco_nombre',
    'notas_manager',
]


def _validar_elegibilidad(row, modulo_flag_col=None):
    """Devuelve None si OK, tuple (response, status) si denegado.

    Exceptions a la regla "tipo_pago_wc=S obligatorio":
      - El manager por defecto (Round histórico): siempre permitido.
      - Re-activación idempotente: si el módulo ya está ON, no exigimos
        tipo S (el manager ya fue validado en su día).
    """
    if not row:
        return jsonify({'ok': False, 'error': 'manager_not_found'}), 404
    # Manager por defecto — exento del check wcommerce
    if str(row.get('id_manager')) == DEFAULT_MANAGER_ID:
        return None
    # Re-activación idempotente — el módulo ya estaba activo
    if modulo_flag_col and row.get(modulo_flag_col):
        return None
    if (row.get('tipo_pago_wc') or '').upper() != 'S':
        return jsonify({'ok': False, 'error': 'not_eligible',
                        'motivo': ('Tu suscripción wcommerce no es de tipo S. '
                                   'Verifica primero en Configuración → '
                                   'Suscripciones.')}), 403
    return None


@bp.route('/provision/<modulo>', methods=['POST'])
@auth_required
@require_permission('configuracion.suscripciones.activar')
def provision_modulo(modulo):
    """Activa un módulo concreto (crm / cuotas / contabilidad) idempotente.

    Body: payload del wizard del módulo correspondiente. Mínimo:
      - razon_social + cif (solo si la company aún no existe)
      - cuotas: iban_principal, factura_secuencia_prefijo, factura_ultimo_numero,
                sistemas_cobro (lista), plan_contable
      - contabilidad: plan_contable
      - crm: nada extra
    """
    if modulo not in _MODULE_PROVISIONERS:
        return jsonify({'ok': False, 'error': 'modulo_invalido',
                        'validos': list(_MODULE_PROVISIONERS)}), 400

    row = _row_manager(g.id_manager)
    fn_name, flag_col = _MODULE_PROVISIONERS[modulo]
    denied = _validar_elegibilidad(row, modulo_flag_col=flag_col)
    if denied: return denied

    # Si la company ya existe, no exigimos razon_social/cif
    data = request.get_json(silent=True) or {}
    if not row.get('odoo_company_id'):
        faltan = [f for f in _REQUIRED_FIELDS if not (data.get(f) or '').strip()]
        if faltan:
            return jsonify({'ok': False, 'error': 'missing_fields',
                            'campos_faltantes': faltan}), 400

    # Cargar el provisioner por nombre (whitelist evita import dinámico inseguro)
    from .. import odoo_provisioner as op
    fn = getattr(op, fn_name)

    log_steps = []
    try:
        out = fn(str(g.id_manager), data, steps=log_steps)
    except op.ProvisionerError as e:
        log.exception(f'provision_modulo {modulo} {g.id_manager}')
        return jsonify({'ok': False, 'error': 'provisioner_failed',
                        'step': e.step,
                        'motivo': ('No pudimos completar la activación '
                                   f'de {modulo}. Nuestro equipo lo revisará.'),
                        'detalle': str(e)[:200],
                        'log': log_steps}), 502
    except Exception as e:
        log.exception(f'provision_modulo {modulo} {g.id_manager} crash')
        return jsonify({'ok': False, 'error': 'crash',
                        'detalle': str(e)[:200],
                        'log': log_steps}), 500

    log_action(actor_from_request(), 'provision', f'provision_{modulo}',
               entidad_id=str(g.id_manager),
               resumen=f'Activado módulo Odoo {modulo}',
               cambios=diff_dict({flag_col: bool((row or {}).get(flag_col))},
                                 {flag_col: True}))
    return jsonify({'ok': True, 'modulo': modulo,
                    'company_id': out.get('company_id'),
                    'log': log_steps,
                    'mensaje': f'Módulo {modulo} activado correctamente.'})


# ─── Solicitud de despliegue (Fase 2A — legacy) ────────────────────────────
# `_REQUIRED_FIELDS` y `_OPTIONAL_FIELDS` están definidos arriba (los usa
# también /provision/<modulo>).


@bp.route('/solicitud-despliegue', methods=['GET'])
@auth_required
def get_solicitud_despliegue():
    """Devuelve la solicitud activa (pendiente o en_proceso) del manager,
    o la última completada/rechazada si no hay activa. None si nunca pidió."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT * FROM odoo_solicitud_despliegue
             WHERE id_manager = %s
             ORDER BY
               (estado IN ('pendiente','en_proceso')) DESC,
               created_at DESC
             LIMIT 1
        """, (str(g.id_manager),))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': True, 'solicitud': None})
    # Normalizar tipos para JSON
    out = dict(row)
    for k in ('created_at', 'updated_at', 'procesado_at'):
        if out.get(k): out[k] = out[k].isoformat()
    return jsonify({'ok': True, 'solicitud': out})


@bp.route('/solicitud-despliegue', methods=['POST'])
@auth_required
def post_solicitud_despliegue():
    """Crea una solicitud nueva. Solo permitida si:
      - el manager tiene tipoPago='S' (verificable on-demand) o ya lo tenía guardado
      - no hay ya otra solicitud activa (pendiente/en_proceso)
      - el manager NO está ya desplegado
    """
    data = request.get_json(silent=True) or {}
    # Validación campos obligatorios
    faltan = [f for f in _REQUIRED_FIELDS if not (data.get(f) or '').strip()]
    if faltan:
        return jsonify({'ok': False, 'error': 'missing_fields',
                        'campos_faltantes': faltan}), 400

    # Comprobaciones de estado del manager
    row = _row_manager(g.id_manager)
    if not row:
        return jsonify({'ok': False, 'error': 'manager_not_found'}), 404
    if row.get('odoo_enabled'):
        return jsonify({'ok': False, 'error': 'already_deployed',
                        'motivo': 'Este manager ya tiene Odoo desplegado.'}), 409
    if (row.get('tipo_pago_wc') or '').upper() != 'S':
        return jsonify({'ok': False, 'error': 'not_eligible',
                        'motivo': ('Tu suscripción wcommerce no es de tipo S. '
                                   'Comprueba primero la elegibilidad.')}), 403

    # Construir payload. Trim solo strings; los otros tipos los dejamos pasar.
    def _opt(field):
        v = data.get(field)
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    valores = {f: _opt(f) for f in _OPTIONAL_FIELDS}
    valores['razon_social'] = data['razon_social'].strip()
    valores['cif']          = data['cif'].strip().upper()
    # plan contable: validar lista cerrada
    plan = str(valores.get('plan_contable') or 'es_pymes').lower()
    if plan not in ('es_pymes', 'es_full', 'es_assoc'):
        plan = 'es_pymes'
    valores['plan_contable'] = plan
    # último número de factura: int seguro
    try:
        valores['factura_ultimo_numero'] = int(valores.get('factura_ultimo_numero') or 0)
    except (TypeError, ValueError):
        valores['factura_ultimo_numero'] = 0

    # INSERT en estado 'en_proceso' — el provisioner se ejecuta a continuación
    # síncronamente. Si peta a mitad, la fila queda como 'pendiente' con el
    # error en motivo_rechazo para retry/intervención manual.
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO odoo_solicitud_despliegue
                    (id_manager, estado,
                     razon_social, cif, direccion, poblacion, cp, provincia,
                     pais, telefono, email_facturacion,
                     plan_contable, factura_secuencia_prefijo, factura_ultimo_numero,
                     iban_principal, banco_nombre,
                     notas_manager)
                VALUES (%s, 'en_proceso',
                        %s, %s, %s, %s, %s, %s,
                        COALESCE(%s, 'España'), %s, %s,
                        %s, %s, %s,
                        %s, %s,
                        %s)
                RETURNING id, created_at
            """, (
                str(g.id_manager),
                valores['razon_social'], valores['cif'],
                valores.get('direccion'), valores.get('poblacion'),
                valores.get('cp'), valores.get('provincia'),
                valores.get('pais'), valores.get('telefono'),
                valores.get('email_facturacion'),
                valores['plan_contable'],
                valores.get('factura_secuencia_prefijo'),
                valores['factura_ultimo_numero'],
                valores.get('iban_principal'), valores.get('banco_nombre'),
                valores.get('notas_manager'),
            ))
            new = cur.fetchone()
    except Exception as e:
        msg = str(e).lower()
        if 'unique' in msg or 'duplicate' in msg:
            return jsonify({'ok': False, 'error': 'solicitud_ya_pendiente',
                            'motivo': ('Ya tienes una solicitud pendiente en '
                                       'curso. Espera a que se procese.')}), 409
        log.exception('post_solicitud_despliegue')
        return jsonify({'ok': False, 'error': 'db_error', 'detalle': str(e)[:200]}), 500

    solicitud_id = new['id']

    # ── Ejecutar provisioner SÍNCRONO (~15-30s) ───────────────────────────
    from ..odoo_provisioner import OdooProvisioner, ProvisionerError, rollback
    prov = OdooProvisioner(g.id_manager, valores)
    try:
        created = prov.run()
    except ProvisionerError as e:
        # Falló a mitad — intentar rollback y dejar la solicitud para retry
        rb = rollback(e.partial)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE odoo_solicitud_despliegue
                   SET estado='pendiente',
                       motivo_rechazo=%s,
                       resultado=%s::jsonb,
                       updated_at=NOW()
                 WHERE id=%s
            """, (
                f'[{e.step}] {str(e)[:300]}',
                json.dumps({'partial': e.partial, 'rollback': rb,
                            'log': prov.log_steps},
                           ensure_ascii=False, default=str),
                solicitud_id,
            ))
        _notificar_admin_provisioner_fallo(solicitud_id, g.id_manager,
                                            valores, e, rb)
        return jsonify({'ok': False,
                        'error': 'provisioner_failed',
                        'step': e.step,
                        'motivo': ('No pudimos completar el despliegue '
                                   'automáticamente. Nuestro equipo lo '
                                   'revisará y se pondrá en contacto contigo.'),
                        'detalle': str(e)[:200],
                        'solicitud_id': solicitud_id}), 502
    except Exception as e:
        log.exception(f'provisioner crash solicitud_id={solicitud_id}')
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE odoo_solicitud_despliegue
                   SET estado='pendiente', motivo_rechazo=%s, updated_at=NOW()
                 WHERE id=%s
            """, (f'crash: {str(e)[:300]}', solicitud_id))
        return jsonify({'ok': False, 'error': 'crash',
                        'detalle': str(e)[:200],
                        'solicitud_id': solicitud_id}), 500

    # ── Provisioner OK → marcar como completada y activar manager ─────────
    company_id = created['company_id']
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE odoo_solicitud_despliegue
                   SET estado='completada',
                       odoo_company_id=%s,
                       procesado_at=NOW(),
                       procesado_por='auto-provisioner',
                       resultado=%s::jsonb,
                       updated_at=NOW()
                 WHERE id=%s
            """, (
                company_id,
                json.dumps({'created': created, 'log': prov.log_steps},
                           ensure_ascii=False, default=str),
                solicitud_id,
            ))
            cur.execute("""
                UPDATE manager_config
                   SET odoo_enabled=TRUE,
                       odoo_company_id=%s,
                       odoo_activated_at=NOW()
                 WHERE id_manager=%s
            """, (company_id, str(g.id_manager)))
    except Exception as e:
        log.exception(f'activar manager_config solicitud_id={solicitud_id}')

    # Sync inicial de partners en BACKGROUND (no bloquea el response).
    # El manager ya ve el menú activado al instante; los partners llegan
    # progresivamente. El frontend puede consultar el progreso con
    # GET /api/manager/solicitud-despliegue.
    # IMPORTANTE: capturamos id_manager FUERA del thread porque `g` solo
    # vive en el contexto del request.
    import threading
    from ..odoo_provisioner import sync_partners_from_cache
    _mgr_for_bg = str(g.id_manager)
    _sol_for_bg = solicitud_id
    def _bg_sync():
        try:
            sync_partners_from_cache(_mgr_for_bg, solicitud_id=_sol_for_bg)
        except Exception as e:
            log.exception(f'background sync_partners {_mgr_for_bg}: {e}')
    threading.Thread(target=_bg_sync, daemon=True).start()

    # Notificar al manager
    _notificar_manager_odoo_activo(g.id_manager, valores, company_id)

    log_action(actor_from_request(), 'manager_odoo', 'solicitud_despliegue',
               entidad_id=str(g.id_manager),
               resumen='Despliegue Odoo completado (contabilidad/cuotas/CRM)',
               cambios={'solicitud_id': solicitud_id,
                        'odoo_company_id': company_id,
                        'odoo_enabled': {'before': False, 'after': True}})

    return jsonify({
        'ok': True,
        'solicitud_id': solicitud_id,
        'odoo_company_id': company_id,
        'mensaje': ('¡Contabilidad activada! Ya puedes ver CRM, Cuotas y '
                    'Contabilidad en el menú. Estamos importando tus clientes '
                    'en segundo plano.'),
        'log': prov.log_steps,
    })


def _notificar_manager_odoo_activo(id_manager, datos, company_id):
    """Email al manager confirmando que su Odoo está listo."""
    try:
        from ..email_sender import enviar
    except Exception:
        return
    to = (datos.get('email_facturacion') or '').strip()
    if not to:
        return
    subject = '✅ Round: tu contabilidad está activa'
    body = (
        f'¡Hola!\n\n'
        f'Hemos desplegado correctamente la contabilidad, recibos y CRM '
        f'para {datos["razon_social"]}.\n\n'
        f'Ya puedes ver los nuevos módulos en tu menú:\n'
        f'  · CRM (Leads)\n'
        f'  · Económico → Cuotas mensuales\n'
        f'  · Económico → Contabilidad\n\n'
        f'Recarga la página de Round si no aparecen automáticamente.\n\n'
        f'Si tienes cualquier duda, contacta con nosotros.\n\n'
        f'— Equipo Round'
    )
    try:
        enviar(to, subject, body, id_manager=id_manager)
    except Exception as e:
        log.warning(f'notif manager_odoo_activo {id_manager}: {e}')


# ─── Config analytic per-trainer (Fase 4) ─────────────────────────────────

@bp.route('/trainers-contabilidad', methods=['GET'])
@auth_required
def get_trainers_contabilidad():
    """Lista todos los trainers del manager con su config analytic actual.

    Devuelve por trainer: id_trainer, noofit_email, heredar_contabilidad,
    analytic_account_id (puede ser null si hereda).
    """
    from ..odoo_analytics import list_trainer_configs
    rows = list_trainer_configs(g.id_manager)
    # Serializar fechas
    out = []
    for r in rows:
        d = dict(r)
        for k in ('created_at', 'updated_at'):
            if d.get(k): d[k] = d[k].isoformat()
        out.append(d)
    # También devolvemos el analytic default del manager (referencia visual)
    row = _row_manager(g.id_manager)
    return jsonify({
        'ok': True,
        'trainers': out,
        'manager_analytic_default_id': (row or {}).get('odoo_analytic_default_id'),
    })


@bp.route('/trainers-contabilidad/<id_trainer>', methods=['PATCH'])
@auth_required
def patch_trainer_contabilidad(id_trainer):
    """Cambia el modo del trainer (`heredar=true|false`).

    Si pasa de heredar a no-heredar (false): se le crea su propio
    `account.analytic.account` en Odoo (reusando uno previo si existía).
    Si pasa de no-heredar a heredar: solo marca el flag local; el
    analytic propio se mantiene en Odoo por si lo recupera más tarde.
    """
    data = request.get_json(silent=True) or {}
    heredar = data.get('heredar_contabilidad')
    nombre = (data.get('nombre_trainer') or '').strip() or f'Trainer {id_trainer}'
    if heredar is None:
        return jsonify({'ok': False, 'error': 'missing_heredar'}), 400
    heredar = bool(heredar)

    from ..odoo_analytics import (set_trainer_independent, set_trainer_inherit,
                                   resolve_analytic)
    try:
        if heredar:
            set_trainer_inherit(g.id_manager, id_trainer)
            analytic_id = resolve_analytic(g.id_manager, id_trainer)
        else:
            analytic_id = set_trainer_independent(g.id_manager, id_trainer, nombre)
    except Exception as e:
        log.exception(f'patch_trainer_contabilidad {g.id_manager}/{id_trainer}')
        return jsonify({'ok': False, 'error': 'odoo_error',
                        'detalle': str(e)[:300]}), 502
    log_action(actor_from_request(), 'trainer_contabilidad', 'toggle_contabilidad',
               entidad_id=str(id_trainer),
               resumen=('Trainer hereda contabilidad del manager' if heredar
                        else 'Trainer con contabilidad independiente'),
               cambios={'heredar_contabilidad': heredar,
                        'analytic_account_id': analytic_id})
    return jsonify({'ok': True, 'id_trainer': id_trainer,
                    'heredar_contabilidad': heredar,
                    'analytic_account_id': analytic_id})


# ─── Endpoints admin (super-admin Wiemspro) ───────────────────────────────
# Protegidos por header X-Round-Admin-Key que debe coincidir con
# ROUND_ADMIN_KEY en /opt/round_config_api/.env. Para invocar:
#
#   curl -H "X-Round-Token: ..." \
#        -H "X-Round-Admin-Key: <secret>" \
#        https://noofit.wiemspro.com/api/admin/solicitudes-despliegue
#
# Si la clave no está configurada en el .env, los endpoints devuelven 503
# "admin desactivado" — esto es intencional para que el sistema sea seguro
# por defecto.

def _check_admin_key():
    """Devuelve None si OK; tuple (response, status) si denegado."""
    import os
    expected = (os.getenv('ROUND_ADMIN_KEY') or '').strip()
    if not expected:
        return jsonify({'ok': False,
                        'error': 'admin_disabled',
                        'motivo': 'ROUND_ADMIN_KEY no configurado en el .env.'}), 503
    got = (request.headers.get('X-Round-Admin-Key') or '').strip()
    if not got or got != expected:
        return jsonify({'ok': False, 'error': 'admin_key_invalid'}), 403
    return None


@bp.route('/admin/solicitudes-despliegue', methods=['GET'])
@auth_required
def admin_list_solicitudes():
    """Lista TODAS las solicitudes de despliegue (cualquier manager).
    Filtros opcionales: ?estado=pendiente|en_proceso|completada|rechazada
    y ?id_manager=X. Por defecto devuelve las pendientes (con error)."""
    denied = _check_admin_key()
    if denied: return denied
    estado = request.args.get('estado')
    id_manager_filter = request.args.get('id_manager')
    wheres, params = [], []
    if estado:
        wheres.append('estado = %s'); params.append(estado)
    elif id_manager_filter is None:
        # Por defecto, mostramos las que requieren atención
        wheres.append("estado = 'pendiente' AND motivo_rechazo IS NOT NULL")
    if id_manager_filter:
        wheres.append('id_manager = %s'); params.append(id_manager_filter)
    where_sql = (' WHERE ' + ' AND '.join(wheres)) if wheres else ''
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT id, id_manager, estado, razon_social, cif,
                   odoo_company_id, motivo_rechazo,
                   procesado_at, created_at, updated_at,
                   partners_total, partners_synced
              FROM odoo_solicitud_despliegue
              {where_sql}
             ORDER BY created_at DESC LIMIT 100
        """, params)
        rows = cur.fetchall() or []
    out = []
    for r in rows:
        d = dict(r)
        for k in ('procesado_at', 'created_at', 'updated_at'):
            if d.get(k): d[k] = d[k].isoformat()
        out.append(d)
    return jsonify({'ok': True, 'solicitudes': out})


@bp.route('/admin/solicitudes-despliegue/<int:sol_id>', methods=['GET'])
@auth_required
def admin_get_solicitud(sol_id):
    """Devuelve TODOS los campos de una solicitud (incluido resultado JSONB
    completo con el log del provisioner) para diagnóstico."""
    denied = _check_admin_key()
    if denied: return denied
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM odoo_solicitud_despliegue
                        WHERE id = %s""", (sol_id,))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    d = dict(row)
    for k in ('procesado_at', 'created_at', 'updated_at',
              'partners_sync_started_at', 'partners_sync_finished_at'):
        if d.get(k): d[k] = d[k].isoformat()
    return jsonify({'ok': True, 'solicitud': d})


@bp.route('/admin/solicitudes-despliegue/<int:sol_id>/reintentar', methods=['POST'])
@auth_required
def admin_reintentar_solicitud(sol_id):
    """Re-ejecuta el provisioner sobre una solicitud en estado pendiente
    con motivo_rechazo. Útil cuando el primer intento falló por un error
    transitorio (red, timeout) o cuando se ha corregido alguna cosa
    manualmente (CIF, IBAN…)."""
    denied = _check_admin_key()
    if denied: return denied

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM odoo_solicitud_despliegue
                        WHERE id = %s""", (sol_id,))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    if row['estado'] == 'completada':
        return jsonify({'ok': False, 'error': 'already_completed'}), 409
    if row['estado'] == 'en_proceso':
        return jsonify({'ok': False, 'error': 'in_progress'}), 409

    # Construir datos del wizard a partir de la fila
    datos = {
        'razon_social': row['razon_social'],
        'cif':          row['cif'],
        'direccion':    row.get('direccion'),
        'poblacion':    row.get('poblacion'),
        'cp':           row.get('cp'),
        'provincia':    row.get('provincia'),
        'pais':         row.get('pais') or 'España',
        'telefono':     row.get('telefono'),
        'email_facturacion': row.get('email_facturacion'),
        'plan_contable': row.get('plan_contable') or 'es_pymes',
        'factura_secuencia_prefijo': row.get('factura_secuencia_prefijo'),
        'factura_ultimo_numero':     row.get('factura_ultimo_numero') or 0,
        'iban_principal':            row.get('iban_principal'),
        'banco_nombre':              row.get('banco_nombre'),
        'notas_manager':             row.get('notas_manager'),
    }

    # Marcar en proceso y limpiar motivo previo
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE odoo_solicitud_despliegue
                          SET estado='en_proceso', motivo_rechazo=NULL,
                              updated_at=NOW()
                        WHERE id=%s""", (sol_id,))

    from ..odoo_provisioner import OdooProvisioner, ProvisionerError, rollback
    prov = OdooProvisioner(row['id_manager'], datos)
    try:
        created = prov.run()
    except ProvisionerError as e:
        rb = rollback(e.partial)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE odoo_solicitud_despliegue
                              SET estado='pendiente',
                                  motivo_rechazo=%s,
                                  resultado=%s::jsonb, updated_at=NOW()
                            WHERE id=%s""",
                        (f'[{e.step}] {str(e)[:300]}',
                         json.dumps({'partial': e.partial, 'rollback': rb,
                                     'log': prov.log_steps}, default=str),
                         sol_id))
        return jsonify({'ok': False, 'error': 'provisioner_failed',
                        'step': e.step, 'detalle': str(e)[:300]}), 502

    # OK
    company_id = created['company_id']
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE odoo_solicitud_despliegue
                          SET estado='completada', odoo_company_id=%s,
                              procesado_at=NOW(), procesado_por='admin-retry',
                              resultado=%s::jsonb, updated_at=NOW()
                        WHERE id=%s""",
                    (company_id,
                     json.dumps({'created': created, 'log': prov.log_steps},
                                default=str),
                     sol_id))
        cur.execute("""UPDATE manager_config
                          SET odoo_enabled=TRUE, odoo_company_id=%s,
                              odoo_activated_at=NOW()
                        WHERE id_manager=%s""",
                    (company_id, str(row['id_manager'])))

    # Background sync de partners
    import threading
    from ..odoo_provisioner import sync_partners_from_cache
    _mgr = str(row['id_manager'])
    threading.Thread(
        target=lambda: sync_partners_from_cache(_mgr, solicitud_id=sol_id),
        daemon=True).start()

    log_action(actor_from_request(), 'manager_odoo', 'solicitud_despliegue',
               entidad_id=str(row['id_manager']),
               resumen='Reintento admin de despliegue Odoo completado',
               cambios={'solicitud_id': sol_id,
                        'odoo_company_id': company_id,
                        'odoo_enabled': {'before': False, 'after': True},
                        'procesado_por': 'admin-retry'})
    return jsonify({'ok': True, 'solicitud_id': sol_id,
                    'odoo_company_id': company_id,
                    'log': prov.log_steps})


def _notificar_admin_provisioner_fallo(solicitud_id, id_manager, datos,
                                        error, rollback_info):
    """Email al admin Wiemspro avisando de un fallo del provisioner."""
    import os
    admin_email = os.getenv('ROUND_ADMIN_EMAIL', '').strip()
    if not admin_email:
        return
    try:
        from ..email_sender import enviar
    except Exception:
        return
    subject = (f'[Round] ⚠ FALLÓ provisioner Odoo solicitud #{solicitud_id} '
               f'({datos["razon_social"]})')
    body = (
        f'El provisioner automático falló en el paso "{error.step}":\n\n'
        f'  {str(error)[:400]}\n\n'
        f'Manager:   {id_manager}\n'
        f'Solicitud: #{solicitud_id}\n'
        f'Empresa:   {datos["razon_social"]} ({datos["cif"]})\n\n'
        f'Datos parciales creados antes del fallo: {error.partial}\n'
        f'Rollback intentado: {rollback_info}\n\n'
        f'Revisa la solicitud en BD (odoo_solicitud_despliegue.id={solicitud_id}) '
        f'y, si procede, completa el despliegue a mano.\n'
    )
    try:
        enviar(admin_email, subject, body, id_manager='17675')
    except Exception as e:
        log.warning(f'notif admin fallo prov solicitud {solicitud_id}: {e}')


def _notificar_admin_nueva_solicitud(solicitud_id, id_manager, datos):
    """Envía email al admin Wiemspro avisando de una nueva solicitud.
    No bloquea — los errores se loguean pero no se devuelven al manager."""
    try:
        from ..email_sender import enviar
    except Exception:
        log.warning(f'email_sender no disponible para notif admin sol={solicitud_id}')
        return
    import os
    admin_email = os.getenv('ROUND_ADMIN_EMAIL', '').strip()
    if not admin_email:
        log.info(f'ROUND_ADMIN_EMAIL no configurado; notif admin omitida (sol={solicitud_id})')
        return
    subject = f'[Round] Solicitud de despliegue Odoo #{solicitud_id} ({datos["razon_social"]})'
    body_text = (
        f'Nueva solicitud de despliegue de Odoo:\n\n'
        f'Solicitud: #{solicitud_id}\n'
        f'Manager:   {id_manager}\n'
        f'Razón social: {datos["razon_social"]}\n'
        f'CIF:        {datos["cif"]}\n'
        f'Dirección:  {datos.get("direccion") or "—"}, '
        f'{datos.get("cp") or ""} {datos.get("poblacion") or ""} '
        f'({datos.get("provincia") or ""})\n'
        f'País:       {datos.get("pais") or "España"}\n'
        f'Email fact: {datos.get("email_facturacion") or "—"}\n'
        f'Teléfono:   {datos.get("telefono") or "—"}\n\n'
        f'Plan contable: {datos.get("plan_contable")}\n'
        f'Numeración:  prefijo={datos.get("factura_secuencia_prefijo") or "—"}  '
        f'último={datos.get("factura_ultimo_numero")}\n'
        f'IBAN:       {datos.get("iban_principal") or "—"} ({datos.get("banco_nombre") or ""})\n\n'
        f'Notas:\n{datos.get("notas_manager") or "(ninguna)"}\n\n'
        f'Para procesarla:\n'
        f'  1. Crea la res.company en Odoo con estos datos\n'
        f'  2. Aplica plan contable {datos.get("plan_contable")}\n'
        f'  3. Vuelve a Round → Configuración → Contabilidad (impersonando este manager)\n'
        f'     e introduce el odoo_company_id recién creado\n'
        f'  4. Round automatiza journals, IBAN, secuencias y permisos.\n'
    )
    try:
        # Mandamos como manager 17675 (Round) y trainer None — usa la config
        # de email del manager por defecto. No usamos el id_manager solicitante
        # porque ese aún no tiene proveedor de email configurado.
        enviar(admin_email, subject, body_text,
               id_manager='17675', id_trainer=None)
        log.info(f'Notif admin enviada para solicitud {solicitud_id} → {admin_email}')
    except Exception as e:
        log.warning(f'Notif admin solicitud {solicitud_id} falló: {e}')
