"""Auth: token compartido + headers de identidad (id_manager, id_trainer)."""
from functools import wraps
from flask import request, jsonify, g
from . import config


def auth_required(fn):
    """Valida el token compartido y carga g.id_manager, g.id_trainer.

    Acepta token vía header X-Round-Token o query param ?token= (este último
    para `<a href>` directos donde el navegador no manda headers — p.ej.
    'ver archivo' subido).
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get('X-Round-Token', '') or request.args.get('token', '')
        if not config.API_TOKEN or token != config.API_TOKEN:
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401

        g.id_manager = (request.headers.get('X-Round-Manager-Id', '')
                        or request.args.get('manager', '')).strip()
        g.id_trainer = (request.headers.get('X-Round-Trainer-Id', '')
                        or request.args.get('trainer', '')).strip() or None

        if not g.id_manager:
            return jsonify({'ok': False, 'error': 'missing_manager_id'}), 400

        return fn(*args, **kwargs)
    return wrapper
