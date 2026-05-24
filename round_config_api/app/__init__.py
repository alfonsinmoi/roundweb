"""Flask app — Round Configuración API."""
import logging
from datetime import datetime
from flask import Flask, jsonify
from flask_cors import CORS

from . import config
from .db import init_schema
from .routes.cuotas           import bp as bp_cuotas
from .routes.descuentos       import bp as bp_descuentos
from .routes.modificaciones   import bp as bp_modificaciones
from .routes.familias          import bp as bp_familias
from .routes.clientes_atendidos import bp as bp_clientes_atendidos
from .routes.retos          import bp as bp_retos
from .routes.estado_fisico  import bp as bp_estado_fisico
from .routes.cuotas_clientes  import bp as bp_cuotas_clientes
from .routes.cliente_gympass  import bp as bp_cliente_gympass
from .routes.categorias       import bp as bp_categorias
from .routes.notif            import bp as bp_notif
from .routes.contabilidad     import bp as bp_contab
from .routes.pasarelas         import bp as bp_pasarelas
from .routes.centros           import bp as bp_centros
from .routes.crm               import bp as bp_crm
from .routes.email_config      import bp as bp_email_config
from .routes.email_templates   import bp as bp_email_templates
from .routes.slots             import bp as bp_slots
from .routes.clientes_log      import bp as bp_clientes_log
from .routes.social            import bp as bp_social
from .routes.auth_usuario      import bp as bp_auth_usuario
from .routes.perfiles          import bp as bp_perfiles
from .routes.usuarios_web      import bp as bp_usuarios_web
from .routes.notas             import bp as bp_notas
from .routes.audit             import bp as bp_audit
from .routes.trainer_data      import bp as bp_trainer_data
from .routes.trainer_creds     import bp as bp_trainer_creds
from .routes.recibos           import bp as bp_recibos
from .routes.subscriptions     import bp as bp_subscriptions
from .routes.forma_pago        import bp as bp_forma_pago
from .routes.modo_facturacion  import bp as bp_modo_facturacion
from .routes.manager_odoo      import bp as bp_manager_odoo
from .routes.auth_bootstrap    import bp as bp_auth_bootstrap
from .routes.preemision_validar import bp as bp_preemision_validar
from .routes.preemision_v2     import bp as bp_preemision_v2
from .routes.emision_v2        import bp as bp_emision_v2
from .routes.facturacion_trimestre import bp as bp_fact_trim
from .routes.trimestre         import bp as bp_trimestre
from .routes.canales_captacion import bp as bp_canales_captacion
from .routes.horario           import bp as bp_horario
from .routes.horario_fichaje   import bp as bp_horario_fichaje


def create_app():
    app = Flask(__name__)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    log = logging.getLogger('round_config_api')

    # CORS
    CORS(app, origins=config.CORS_ORIGINS,
         allow_headers=['Content-Type','Authorization','X-Round-Token','X-Round-Manager-Id','X-Round-Trainer-Id'],
         expose_headers=['X-New-Token'],
         methods=['GET','POST','PUT','PATCH','DELETE','OPTIONS'])

    # Inyecta `X-New-Token` cuando un endpoint autenticado ha renovado el JWT
    # (ver `usuario_web_required`). El frontend lo guarda en sessionStorage y
    # sigue trabajando sin que el usuario lo note.
    from flask import g as _g
    @app.after_request
    def _inject_refresh_jwt(resp):
        try:
            new_jwt = getattr(_g, '_refresh_jwt', None)
            if new_jwt:
                resp.headers['X-New-Token'] = new_jwt
        except Exception:
            pass
        return resp

    # Init schema (idempotente — CREATE TABLE IF NOT EXISTS)
    try:
        init_schema()
        log.info('Schema BD verificado/creado')
    except Exception as e:
        log.error(f'Error inicializando schema: {e}')

    # Health
    @app.route('/health')
    @app.route('/api/config/health')
    def health():
        return jsonify({
            'ok': True,
            'service': 'round_config_api',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'formas_pago': config.FORMAS_PAGO,
            'periodicidades': config.PERIODICIDADES,
            'tipos_modificacion': config.TIPOS_MODIFICACION,
            'tipos_descuento': config.TIPOS_DESCUENTO,
        })

    # Registrar Blueprints — ambas rutas (con y sin /api/config) para flexibilidad nginx
    for prefix in ('/cuotas', '/api/config/cuotas'):
        app.register_blueprint(bp_cuotas, name=f'cuotas{prefix}', url_prefix=prefix)
    for prefix in ('/descuentos', '/api/config/descuentos'):
        app.register_blueprint(bp_descuentos, name=f'descuentos{prefix}', url_prefix=prefix)
    for prefix in ('/modificaciones', '/api/config/modificaciones'):
        app.register_blueprint(bp_modificaciones, name=f'modificaciones{prefix}', url_prefix=prefix)
    for prefix in ('/familias', '/api/familias'):
        app.register_blueprint(bp_familias, name=f'familias{prefix}', url_prefix=prefix)
    for prefix in ('/clientes-atendidos', '/api/clientes-atendidos'):
        app.register_blueprint(bp_clientes_atendidos,
                                name=f'cat_b{prefix}', url_prefix=prefix)
    for prefix in ('/retos', '/api/retos'):
        app.register_blueprint(bp_retos, name=f'retos{prefix}', url_prefix=prefix)
    for prefix in ('/estado-fisico', '/api/estado-fisico'):
        app.register_blueprint(bp_estado_fisico, name=f'ef{prefix}', url_prefix=prefix)
    for prefix in ('/cuotas-clientes', '/api/cuotas'):
        app.register_blueprint(bp_cuotas_clientes, name=f'cc{prefix}', url_prefix=prefix)
    for prefix in ('/cliente-gympass', '/api/config/cliente-gympass'):
        app.register_blueprint(bp_cliente_gympass, name=f'cg{prefix}', url_prefix=prefix)
    for prefix in ('/categorias', '/api/config/categorias'):
        app.register_blueprint(bp_categorias, name=f'cat{prefix}', url_prefix=prefix)
    for prefix in ('/notif', '/api/notif'):
        app.register_blueprint(bp_notif, name=f'nt{prefix}', url_prefix=prefix)
    for prefix in ('/contab', '/api/contab'):
        app.register_blueprint(bp_contab, name=f'co{prefix}', url_prefix=prefix)
    for prefix in ('/pasarelas', '/api/config/pasarelas'):
        app.register_blueprint(bp_pasarelas, name=f'ps{prefix}', url_prefix=prefix)
    for prefix in ('/centros', '/api/config/centros'):
        app.register_blueprint(bp_centros, name=f'ce{prefix}', url_prefix=prefix)
    for prefix in ('/crm', '/api/crm'):
        app.register_blueprint(bp_crm, name=f'crm{prefix}', url_prefix=prefix)
    for prefix in ('/email-config', '/api/config/email'):
        app.register_blueprint(bp_email_config, name=f'em{prefix}', url_prefix=prefix)
    for prefix in ('/email-templates', '/api/config/email-templates'):
        app.register_blueprint(bp_email_templates, name=f'emt{prefix}', url_prefix=prefix)

    # ── Reservas de prueba (rutas públicas, sin prefijo /api/config) ─────
    # Las rutas internas del blueprint ya empiezan con /api/crm o /reserva
    app.register_blueprint(bp_slots, name='slots_public', url_prefix='')

    # ── Clientes log (cambios de estado activo↔archivado) ─────────────────
    for prefix in ('/clientes', '/api/clientes'):
        app.register_blueprint(bp_clientes_log, name=f'cli_log{prefix}', url_prefix=prefix)

    # ── Redes sociales (cuentas Meta + agenda) ────────────────────────────
    for prefix in ('/social', '/api/social'):
        app.register_blueprint(bp_social, name=f'soc{prefix}', url_prefix=prefix)

    # ── Auth usuarios web (login propio, distinto del NoofitPro manager) ──
    for prefix in ('/auth/usuario-web', '/api/auth/usuario-web'):
        app.register_blueprint(bp_auth_usuario, name=f'auw{prefix}', url_prefix=prefix)

    # ── CRUD perfiles + usuarios web ──────────────────────────────────────
    for prefix in ('/perfiles', '/api/config/perfiles'):
        app.register_blueprint(bp_perfiles, name=f'pf{prefix}', url_prefix=prefix)
    for prefix in ('/usuarios-web', '/api/config/usuarios-web'):
        app.register_blueprint(bp_usuarios_web, name=f'uw{prefix}', url_prefix=prefix)

    # ── Notas de cliente + Audit log ─────────────────────────────────────
    for prefix in ('/notas', '/api/notas'):
        app.register_blueprint(bp_notas, name=f'nt{prefix}', url_prefix=prefix)
    for prefix in ('/audit', '/api/config/audit'):
        app.register_blueprint(bp_audit, name=f'au{prefix}', url_prefix=prefix)

    # ── Proxy trainer-data: filtrado server-side por id_trainer del usuario_web
    for prefix in ('/trainer-data', '/api/trainer-data'):
        app.register_blueprint(bp_trainer_data, name=f'td{prefix}', url_prefix=prefix)

    # ── CRUD credenciales NoofitPro por trainer ──────────────────────────
    for prefix in ('/trainer-creds', '/api/config/trainer-creds'):
        app.register_blueprint(bp_trainer_creds, name=f'tc{prefix}', url_prefix=prefix)

    # ── Recibos (sistema nuevo: emisión mensual + facturación trimestral)
    for prefix in ('/recibos', '/api/recibos'):
        app.register_blueprint(bp_recibos, name=f'rec{prefix}', url_prefix=prefix)

    # ── Subscriptions (round.subscription en Odoo: cuotas asignadas a cliente)
    for prefix in ('/subscriptions', '/api/subscriptions'):
        app.register_blueprint(bp_subscriptions, name=f'sub{prefix}', url_prefix=prefix)

    # ── Forma de pago por cliente (con histórico)
    for prefix in ('/forma-pago', '/api/forma-pago'):
        app.register_blueprint(bp_forma_pago, name=f'fp{prefix}', url_prefix=prefix)

    # ── Modo de facturación (config del manager)
    for prefix in ('/modo-facturacion', '/api/config/modo-facturacion'):
        app.register_blueprint(bp_modo_facturacion, name=f'mf{prefix}', url_prefix=prefix)

    # ── Estado del Odoo per-manager y gate de despliegue (Fase 1)
    for prefix in ('/manager', '/api/manager'):
        app.register_blueprint(bp_manager_odoo, name=f'mo{prefix}', url_prefix=prefix)

    # ── Auto-registro del manager/trainer tras login NF (multimanager)
    for prefix in ('/auth', '/api/auth'):
        app.register_blueprint(bp_auth_bootstrap, name=f'ab{prefix}', url_prefix=prefix)

    # ── Validación previa antes de emitir (preemision)
    for prefix in ('/preemision-validar', '/api/cuotas/preemision'):
        app.register_blueprint(bp_preemision_validar, name=f'pv{prefix}', url_prefix=prefix)

    # ── Preemisión v2 + Emisión v2 (modo α: recibo + trimestral)
    for prefix in ('/preemision-v2', '/api/cuotas/preemision-v2'):
        app.register_blueprint(bp_preemision_v2, name=f'pv2{prefix}', url_prefix=prefix)
    for prefix in ('/emitir-v2', '/api/cuotas/emitir-v2'):
        app.register_blueprint(bp_emision_v2, name=f'ev2{prefix}', url_prefix=prefix)

    # ── Facturación trimestral
    for prefix in ('/facturacion-trimestre', '/api/cuotas/facturacion-trimestre'):
        app.register_blueprint(bp_fact_trim, name=f'ft{prefix}', url_prefix=prefix)

    # ── Aviso trimestre (banner)
    for prefix in ('/trimestre', '/api/cuotas/trimestre'):
        app.register_blueprint(bp_trimestre, name=f'tri{prefix}', url_prefix=prefix)

    # ── Canales de captación (UTMs → canal con nombre amigable)
    for prefix in ('/canales-captacion', '/api/config/canales-captacion'):
        app.register_blueprint(bp_canales_captacion,
                                name=f'cc{prefix}', url_prefix=prefix)

    # ── Control horario laboral (módulo Fase 1: endpoints admin)
    for prefix in ('/horario', '/api/horario'):
        app.register_blueprint(bp_horario, name=f'hor{prefix}', url_prefix=prefix)
    for prefix in ('/horario', '/api/horario'):
        app.register_blueprint(bp_horario_fichaje, name=f'horf{prefix}', url_prefix=prefix)

    return app
