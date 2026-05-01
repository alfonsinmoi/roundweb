"""Validación token + HMAC-SHA256 de webhooks entrantes desde NoofitPro."""
import hmac
import hashlib
from functools import wraps
from flask import request, jsonify, current_app
from . import config


def _verify_signature(body: bytes, signature_header: str) -> bool:
    """Verifica HMAC-SHA256 del body con WEBHOOK_SECRET.

    El header X-Webhook-Signature se espera con formato 'sha256=<hex>'.
    """
    if not signature_header:
        return False
    if signature_header.startswith('sha256='):
        signature_header = signature_header[len('sha256='):]
    expected = hmac.new(config.WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def auth_required(fn):
    """Decorator: valida X-Webhook-Token + X-Webhook-Signature."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        # En modo dev solo se exige token (no HMAC)
        token = request.headers.get('X-Webhook-Token', '')
        if not config.WEBHOOK_TOKEN or token != config.WEBHOOK_TOKEN:
            return jsonify({'ok': False, 'error': 'invalid_token'}), 401

        if not config.DEV_MODE:
            sig = request.headers.get('X-Webhook-Signature', '')
            if not config.WEBHOOK_SECRET:
                return jsonify({'ok': False, 'error': 'mcp_misconfigured'}), 500
            if not _verify_signature(request.get_data(), sig):
                return jsonify({'ok': False, 'error': 'invalid_signature'}), 401

        return fn(*args, **kwargs)
    return wrapper
