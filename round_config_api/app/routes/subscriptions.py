"""Endpoints CRUD round.subscription (Odoo).

Cada cliente puede tener N subscriptions (multicuota). Cualquier cambio en
una subscription se hace mediante reemplazo (cierra la actual y crea nueva)
para mantener histórico contable estricto.

Endpoints:
  GET    /api/subscriptions/cliente/<id_noofit>     lista (activas + canceladas)
  POST   /api/subscriptions                          crea nueva
  POST   /api/subscriptions/<id>/replace             cierra+crea (mantiene histórico)
  POST   /api/subscriptions/<id>/cancel              solo cancela (fecha_fin=hoy)
  GET    /api/subscriptions/cuotas-catalogo          dropdown de cuotas Odoo
  GET    /api/subscriptions/descuentos-catalogo      dropdown de descuentos Odoo
"""
import datetime as dt
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission, require_seccion
from ..audit_log import log_action, actor_from_request
from ..odoo_guard import require_feature

bp = Blueprint('subscriptions', __name__)
log = logging.getLogger(__name__)


def _odoo():
    """Lazy import OdooAlta para evitar conexión en cada arranque."""
    from ..odoo_alta import OdooAlta
    o = OdooAlta()
    o._connect()
    return o


def _company_id():
    from .. import config as appconfig
    return getattr(appconfig, 'ODOO_COMPANY', 3) or 3


@bp.route('/cuotas-catalogo', methods=['GET'])
@auth_required
@require_feature('cuotas')
def cuotas_catalogo():
    """Lista cuotas del catálogo Odoo (para dropdowns).

    Filtra por:
      - company del manager (CONFIG_ODOO_COMPANY) → evita leak cross-company.
      - trainer: si llega `?trainer=<id>`, devuelve las cuotas de ESE trainer
        + las legacy (id_trainer NULL/'') como fallback retrocompat.
        Si no llega, devuelve solo las legacy (compat con llamadas antiguas).
    """
    try:
        trainer = (request.args.get('trainer') or '').strip()
        domain = [['company_id', '=', _company_id()]]
        if trainer:
            # Cuotas de ese trainer O legacy sin trainer asignado
            domain += ['|',
                       ['id_trainer', '=', trainer],
                       ['id_trainer', 'in', [False, '']]]
        o = _odoo()
        rows = o._call('round.cuota.catalogo', 'search_read', domain,
            ['id', 'codigo', 'descripcion', 'id_trainer',
             'precio_mensual', 'precio_trimestral',
             'precio_semestral', 'precio_anual', 'matricula'])
        for r in rows:
            for k in ('precio_mensual', 'precio_trimestral',
                      'precio_semestral', 'precio_anual', 'matricula'):
                if r.get(k) is not None:
                    try: r[k] = float(r[k])
                    except Exception: pass
        return jsonify({'ok': True, 'cuotas': rows})
    except Exception as e:
        log.exception('cuotas_catalogo')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/descuentos-catalogo', methods=['GET'])
@auth_required
@require_feature('cuotas')
def descuentos_catalogo():
    try:
        o = _odoo()
        rows = o._call('round.descuento.catalogo', 'search_read',
            [['company_id', '=', _company_id()]],
            ['id', 'codigo', 'descripcion', 'tipo', 'valor'])
        for r in rows:
            v = r.get('valor')
            if v is not None:
                try: r['valor'] = float(v)
                except Exception: pass
        return jsonify({'ok': True, 'descuentos': rows})
    except Exception as e:
        log.exception('descuentos_catalogo')
        return jsonify({'ok': False, 'error': str(e)}), 500


def _serialize_sub(s):
    """Convierte sub Odoo (dict) → forma plana JSON-friendly."""
    def m2o(v):
        if not v: return None
        if isinstance(v, list) and len(v) == 2:
            return {'id': v[0], 'name': v[1]}
        return v
    s = dict(s)
    for k in ('partner_id', 'cuota_id', 'mandate_id', 'pasarela_id',
              'trainer_analytic_id', 'company_id', 'currency_id'):
        if k in s: s[k] = m2o(s.get(k))
    if 'descuentos_activos_ids' in s and isinstance(s['descuentos_activos_ids'], list):
        # Es una lista de ids (int). La dejamos como tal.
        s['descuentos_activos_ids'] = list(s['descuentos_activos_ids'])
    return s


@bp.route('/cliente/<id_noofit>', methods=['GET'])
@auth_required
@require_feature('cuotas')
@require_seccion('economico.cuotas_mensuales')
def list_by_cliente(id_noofit):
    """Lista subscriptions del cliente (activas + canceladas) ordenadas."""
    # Aislamiento por trainer: si el cliente no pertenece al trainer
    # impersonado, devolver vacío.
    from ..trainer_scope import cliente_pertenece_a_trainer
    if not cliente_pertenece_a_trainer(id_noofit):
        return jsonify({'ok': True, 'subscriptions': [], 'partner_id': None})
    try:
        o = _odoo()
        company_id = _company_id()
        # Localizar partner por id_noofit
        partner_ids = o._call('res.partner', 'search',
            [('id_noofit', '=', str(id_noofit))], limit=1)
        if not partner_ids:
            return jsonify({'ok': True, 'subscriptions': [], 'partner_id': None})
        pid = partner_ids[0]
        subs = o._call('round.subscription', 'search_read',
            [('partner_id', '=', pid), ('company_id', '=', company_id)],
            ['id', 'partner_id', 'cuota_id', 'fecha_inicio', 'fecha_fin',
             'periodicidad', 'forma_pago', 'mandate_id', 'token_tarjeta',
             'pasarela_id', 'descuentos_activos_ids', 'estado',
             'trainer_analytic_id', 'id_noofit_subscription',
             'company_id', 'currency_id'],
            order='estado, fecha_inicio DESC')
        return jsonify({'ok': True,
                        'partner_id': pid,
                        'subscriptions': [_serialize_sub(s) for s in subs]})
    except Exception as e:
        log.exception('list_by_cliente')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.asignar')
def create_subscription():
    """Crea una nueva subscription para el cliente.
    body = {
      cliente_idnoofit: '<id>',
      cuota_id: int,
      periodicidad: 'mensual'|'trimestral'|...,
      forma_pago: 'sepa'|'tarjeta_token'|'efectivo'|'enlace_pago',
      fecha_inicio?: 'YYYY-MM-DD' (default: hoy),
      descuento_ids?: [int],
      estado?: 'activa' (default)
    }
    """
    d = request.get_json() or {}
    # cliente_idnoofit puede llegar como int (NoofitPro lo devuelve numérico)
    # o como string. Normalizamos a string aquí para evitar AttributeError.
    raw = d.get('cliente_idnoofit')
    cliente_idnoofit = str(raw).strip() if raw is not None else ''
    cuota_id = d.get('cuota_id')
    if not cliente_idnoofit or not cuota_id:
        return jsonify({'ok': False, 'error': 'cliente_idnoofit y cuota_id requeridos'}), 400

    # Aislamiento por trainer: el cliente debe pertenecer al trainer impersonado.
    from ..trainer_scope import cliente_pertenece_a_trainer
    if not cliente_pertenece_a_trainer(cliente_idnoofit):
        return jsonify({'ok': False, 'error': 'not_found'}), 404

    try:
        o = _odoo()
        company_id = _company_id()
        # Resolver partner
        partner_ids = o._call('res.partner', 'search',
            [('id_noofit', '=', str(cliente_idnoofit))], limit=1)
        if partner_ids:
            pid = partner_ids[0]
        else:
            # No existe en Odoo todavía — leemos los datos del cliente desde
            # `cliente_cache` (ya per-manager, mantenida por trainer_data/
            # round_clientes_sync) y creamos el partner sobre la marcha.
            log.info(f'subscription create: partner {cliente_idnoofit} no existe en Odoo, creando...')
            try:
                import json as _json
                from ..db import get_conn
                from ..odoo_alta import OdooAlta
                from .. import noofit_client as nc
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        SELECT raw_data FROM cliente_cache
                         WHERE id_manager = %s AND id = %s
                         LIMIT 1
                    """, (str(g.id_manager), int(cliente_idnoofit)))
                    row = cur.fetchone()
                cli = None
                if row:
                    cli = row['raw_data']
                    if isinstance(cli, str):
                        try: cli = _json.loads(cli)
                        except Exception: cli = None
                if not cli:
                    # Fallback: cache miss (cliente recién creado en NoofitPro
                    # antes de que el sync background lo recoja). Disparamos un
                    # sync síncrono que itera TODAS las credenciales de trainer
                    # del manager (no solo las del .env roundgestion). Esto
                    # cubre el caso de clientes que pertenecen a un trainer
                    # distinto del manager por defecto.
                    log.info(f'subscription create: cliente {cliente_idnoofit} no en cache, '
                             f'forzando sync síncrono del manager {g.id_manager}')
                    try:
                        from .trainer_data import _sync_clientes_manager
                        _sync_clientes_manager(str(g.id_manager))
                        # Reintentar lectura tras sync
                        with get_conn() as conn3, conn3.cursor() as cur3:
                            cur3.execute("""
                                SELECT raw_data FROM cliente_cache
                                 WHERE id_manager = %s AND id = %s
                                 LIMIT 1
                            """, (str(g.id_manager), int(cliente_idnoofit)))
                            row3 = cur3.fetchone()
                        if row3:
                            cli = row3['raw_data']
                            if isinstance(cli, str):
                                try: cli = _json.loads(cli)
                                except Exception: cli = None
                    except Exception as live_e:
                        log.warning(f'fallback sync_clientes_manager idnoofit={cliente_idnoofit}: {live_e}')
                if not cli:
                    return jsonify({
                        'ok': False,
                        'error': 'cliente_no_encontrado_en_noofit',
                        'detail': ('El cliente no aparece ni en la cache local ni en NoofitPro. '
                                   'Comprueba que sigue dado de alta o refresca el listado.'),
                    }), 400
                oa = OdooAlta()
                oa._connect()
                pid = oa.upsert_partner({
                    'idnoofit': str(cliente_idnoofit),
                    'nombre':   cli.get('name'),
                    'apellidos': cli.get('surname'),
                    'dni':      cli.get('dni') or cli.get('nif'),
                    'email':    cli.get('email'),
                    'movil':    cli.get('cellPhone') or cli.get('telefono'),
                    'direccion': cli.get('address'),
                    'localidad': cli.get('town'),
                    'cp':       cli.get('zip'),
                })
                log.info(f'subscription create: partner Odoo creado id={pid} para idnoofit={cliente_idnoofit}')
            except Exception as e:
                log.exception(f'auto-crear partner Odoo idnoofit={cliente_idnoofit}: {e}')
                return jsonify({'ok': False, 'error': 'partner_no_encontrado_en_odoo',
                                'detail': f'No se pudo crear el partner automáticamente: {e}'}), 400

        vals = {
            'partner_id': pid,
            'cuota_id': int(cuota_id),
            'periodicidad': d.get('periodicidad', 'mensual'),
            'forma_pago': d.get('forma_pago', 'sepa'),
            'fecha_inicio': d.get('fecha_inicio') or str(dt.date.today()),
            'estado': d.get('estado', 'activa'),
            'company_id': company_id,
        }
        if d.get('descuento_ids'):
            vals['descuentos_activos_ids'] = [(6, 0, list(d['descuento_ids']))]
        sid = o._call('round.subscription', 'create', vals)
        log_action(actor_from_request(), entidad='subscription', entidad_id=sid,
                   accion='create',
                   resumen=f"Nueva suscripción cliente {cliente_idnoofit} cuota_id={cuota_id} {vals['periodicidad']}/{vals['forma_pago']}")
        return jsonify({'ok': True, 'id': sid})
    except Exception as e:
        log.exception('create_subscription')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:sid>/replace', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.reemplazar')
def replace_subscription(sid):
    """Cierra la subscription <sid> (fecha_fin=hoy, estado=cancelada) y crea
    una nueva con los datos del body. Mantiene histórico estricto.

    body = mismo formato que create + opcional 'fecha_corte' (default: hoy)
    """
    d = request.get_json() or {}
    fecha_corte = d.get('fecha_corte') or str(dt.date.today())
    motivo = d.get('motivo') or 'Cambio de cuota / periodicidad / descuento'

    try:
        o = _odoo()
        company_id = _company_id()
        # Leer la actual
        old = o._call('round.subscription', 'read', [sid],
            ['id', 'partner_id', 'cuota_id', 'estado', 'fecha_inicio'])
        if not old:
            return jsonify({'ok': False, 'error': 'subscription_no_encontrada'}), 404
        old = old[0]
        if old['estado'] == 'cancelada':
            return jsonify({'ok': False, 'error': 'subscription_ya_cancelada'}), 400

        partner_id = old['partner_id'][0] if old.get('partner_id') else None
        if not partner_id:
            return jsonify({'ok': False, 'error': 'partner_no_resuelto'}), 400

        # 1) Cerrar la actual
        # NOTA: write() de Odoo espera primer arg como lista de IDs ([sid]),
        # NO lista de listas ([[sid]]). Lo segundo provoca TypeError en
        # _track_prepare de mail.thread: "unhashable type: 'list'".
        o._call('round.subscription', 'write', [sid],
            {'fecha_fin': fecha_corte, 'estado': 'cancelada'})

        # 2) Crear la nueva
        new_vals = {
            'partner_id': partner_id,
            'cuota_id': int(d.get('cuota_id') or old['cuota_id'][0]),
            'periodicidad': d.get('periodicidad', 'mensual'),
            'forma_pago': d.get('forma_pago', 'sepa'),
            'fecha_inicio': d.get('fecha_inicio') or fecha_corte,
            'estado': 'activa',
            'company_id': company_id,
        }
        if d.get('descuento_ids') is not None:
            new_vals['descuentos_activos_ids'] = [(6, 0, list(d['descuento_ids']))]
        new_sid = o._call('round.subscription', 'create', new_vals)
        log_action(actor_from_request(), entidad='subscription', entidad_id=sid,
                   accion='replace',
                   resumen=f'Subscripción reemplazada — motivo: {motivo} · old={sid} · new={new_sid}',
                   cambios={'old_id': sid, 'new_id': new_sid, 'motivo': motivo, 'cambios': d})
        return jsonify({'ok': True, 'old_id': sid, 'new_id': new_sid})
    except Exception as e:
        log.exception('replace_subscription')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:sid>/cancel', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.cancelar')
def cancel_subscription(sid):
    """Cancela una subscription sin crear sustituto.
    body = {motivo?: str, fecha_corte?: YYYY-MM-DD}"""
    d = request.get_json() or {}
    fecha_corte = d.get('fecha_corte') or str(dt.date.today())
    motivo = d.get('motivo') or 'Cancelación manual'
    try:
        o = _odoo()
        old = o._call('round.subscription', 'read', [sid], ['id', 'estado'])
        if not old:
            return jsonify({'ok': False, 'error': 'subscription_no_encontrada'}), 404
        if old[0]['estado'] == 'cancelada':
            return jsonify({'ok': False, 'error': 'ya_cancelada'}), 400
        # write() espera [sid], no [[sid]] — ver nota en replace_subscription.
        o._call('round.subscription', 'write', [sid],
            {'fecha_fin': fecha_corte, 'estado': 'cancelada'})
        log_action(actor_from_request(), entidad='subscription', entidad_id=sid,
                   accion='cancel', resumen=f'Cancelada · motivo: {motivo}')
        return jsonify({'ok': True})
    except Exception as e:
        log.exception('cancel_subscription')
        return jsonify({'ok': False, 'error': str(e)}), 500
