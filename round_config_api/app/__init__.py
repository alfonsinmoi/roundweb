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

    return app
