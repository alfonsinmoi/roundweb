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


def create_app():
    app = Flask(__name__)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    log = logging.getLogger('round_config_api')

    # CORS
    CORS(app, origins=config.CORS_ORIGINS,
         allow_headers=['Content-Type','X-Round-Token','X-Round-Manager-Id','X-Round-Trainer-Id'],
         methods=['GET','POST','PUT','PATCH','DELETE','OPTIONS'])

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

    return app
