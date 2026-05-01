"""MCP Round — receptor de webhooks NoofitPro → Odoo round_facturacion."""
import logging
import json
from datetime import datetime
from flask import Flask, request, jsonify

from . import config
from .auth import auth_required
from .handlers import get_handler
from .odoo_client import get_client


def create_app():
    app = Flask(__name__)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    log = logging.getLogger('mcp_round')

    # Las rutas se sirven en dos prefijos para soportar tanto acceso directo (port 8090)
    # como acceso vía nginx (que reescribe /mcp/* → /*).
    @app.route('/health', methods=['GET'])
    @app.route('/mcp/health', methods=['GET'])
    def health():
        return jsonify({
            'ok': True,
            'service': 'mcp_round',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'odoo_configured': bool(config.ODOO_PWD),
            'webhook_auth_configured': bool(config.WEBHOOK_TOKEN and config.WEBHOOK_SECRET),
            'dev_mode': config.DEV_MODE,
        })

    @app.route('/eventos/<evento>', methods=['POST'])
    @app.route('/mcp/eventos/<evento>', methods=['POST'])
    @auth_required
    def recibir_evento(evento):
        webhook_id = request.headers.get('X-Webhook-Id', '')
        payload = request.get_json(silent=True) or {}

        log.info(f"Evento recibido: {evento} (webhook_id={webhook_id})")

        # Idempotencia
        odoo = get_client()
        try:
            existing = odoo.log_webhook_already_processed(webhook_id)
            if existing and existing['estado'] == 'procesado':
                log.info(f"Webhook duplicado, devolviendo respuesta cacheada: {webhook_id}")
                resp = json.loads(existing['response']) if existing.get('response') else {}
                return jsonify({'ok': True, 'cached': True, **resp}), 200
        except Exception as e:
            log.error(f"Idempotency check fail: {e}")
            # Seguimos procesando — no falla el flujo principal por esto

        # Buscar handler
        handler = get_handler(evento)
        if not handler:
            log.warning(f"Evento desconocido: {evento}")
            _log_webhook(odoo, evento, webhook_id, payload, None, 'error',
                         f"evento_desconocido: {evento}")
            return jsonify({'ok': False, 'error': f'unknown_event: {evento}'}), 400

        # Procesar
        try:
            result = handler(payload)
            estado = 'procesado' if result.get('ok') else 'error'
            err_msg = None if result.get('ok') else result.get('error')
            _log_webhook(odoo, evento, webhook_id, payload, result, estado, err_msg)
            return jsonify({'ok': True, 'result': result, 'webhook_id': webhook_id}), 200
        except Exception as e:
            log.exception(f"Handler error processing {evento}: {e}")
            _log_webhook(odoo, evento, webhook_id, payload, None, 'error', str(e))
            return jsonify({'ok': False, 'error': str(e)}), 500

    return app


def _log_webhook(odoo, evento, webhook_id, payload, response, estado, error=None):
    """Persiste el evento en round.log.webhook para trazabilidad."""
    try:
        odoo.log_webhook({
            'direccion': 'entrada',
            'evento': evento,
            'webhook_id': webhook_id or False,
            'payload': json.dumps(payload, default=str),
            'response': json.dumps(response, default=str) if response else False,
            'estado': estado,
            'error_msg': error,
            # Odoo no acepta ISO con T+microsegundos, formato concreto:
            'procesado_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S') if estado != 'pendiente' else False,
        })
    except Exception as e:
        # Si no podemos loggear, lo escupimos al log del proceso pero seguimos
        import logging
        logging.getLogger('mcp_round').error(f"Error guardando log webhook: {e}")
