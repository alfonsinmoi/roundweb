"""Auth: token compartido + headers de identidad (id_manager, id_trainer)."""
from functools import wraps
from flask import request, jsonify, g
from . import config


def auth_required(fn):
    """Valida el token compartido y carga g.id_manager, g.id_trainer."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get('X-Round-Token', '')
        if not config.API_TOKEN or token != config.API_TOKEN:
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401

        g.id_manager = request.headers.get('X-Round-Manager-Id', '').strip()
        g.id_trainer = request.headers.get('X-Round-Trainer-Id', '').strip() or None

        if not g.id_manager:
            return jsonify({'ok': False, 'error': 'missing_manager_id'}), 400

        return fn(*args, **kwargs)
    return wrapper
