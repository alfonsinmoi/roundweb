"""CRUD de plantillas de email transaccional (manager-only).

GET    /api/config/email-templates                      → lista
GET    /api/config/email-templates/events               → eventos disponibles
POST   /api/config/email-templates                      → crear
PUT    /api/config/email-templates/<id>                 → modificar
DELETE /api/config/email-templates/<id>                 → borrar
POST   /api/config/email-templates/seed                 → insertar defaults
POST   /api/config/email-templates/<id>/test            → enviar a un email de prueba
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required
from ..db import get_conn
from ..email_templates import (
    seed_templates, render, html_to_text, DEFAULT_TEMPLATES,
)
from ..email_sender import enviar as enviar_email

bp = Blueprint('email_templates', __name__)
log = logging.getLogger(__name__)


# Eventos válidos (los que dispara el backend automáticamente)
EVENTOS = [
    {'value': 'lead_creado_lead',         'label': 'Lead recién creado → al lead',                       'destinatario_default': 'lead'},
    {'value': 'lead_creado_trainer',      'label': 'Lead recién creado → al trainer',                    'destinatario_default': 'trainer'},
    {'value': 'lead_creado_manager',      'label': 'Lead recién creado → al manager',                    'destinatario_default': 'manager'},
    {'value': 'etapa_contactado_lead',    'label': 'Etapa "Contactado" → al lead',                       'destinatario_default': 'lead'},
    {'value': 'etapa_visita_lead',        'label': 'Etapa "Visita" → al lead',                           'destinatario_default': 'lead'},
    {'value': 'etapa_prueba_lead',        'label': 'Etapa "Prueba" → al lead',                           'destinatario_default': 'lead'},
    {'value': 'etapa_alta_lead',          'label': 'Etapa "Alta" → al lead',                             'destinatario_default': 'lead'},
    {'value': 'lead_perdido_lead',        'label': 'Lead perdido → al lead',                             'destinatario_default': 'lead'},
    {'value': 'slot_reservado_lead',      'label': 'Reserva de prueba creada → al lead (confirmar)',     'destinatario_default': 'lead'},
    {'value': 'slot_confirmado_lead',     'label': 'Reserva de prueba confirmada → al lead',             'destinatario_default': 'lead'},
    {'value': 'slot_recordatorio_lead',   'label': 'Recordatorio 24h antes de la prueba → al lead',      'destinatario_default': 'lead'},
]
DESTINATARIOS = ['lead', 'trainer', 'manager']
VARIABLES_DOC = [
    'lead_name', 'lead_email', 'lead_phone', 'lead_message', 'lead_url', 'lead_id',
    'trainer_name', 'trainer_phone', 'trainer_email',
    'centro_name', 'centro_email', 'centro_slug', 'centro_ciudad',
    'cuota_interes', 'manager_email',
]


def _manager_only():
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    return None


@bp.route('/events', methods=['GET'])
@bp.route('/events/', methods=['GET'])
@auth_required
def events():
    return jsonify({
        'ok': True,
        'eventos': EVENTOS,
        'destinatarios': DESTINATARIOS,
        'variables': VARIABLES_DOC,
    })


@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
def list_all():
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, evento, destinatario, subject, body_html, active,
                       delay_minutes, created_at, updated_at
                  FROM email_template
                 WHERE id_manager=%s
                 ORDER BY evento, destinatario
            """, (g.id_manager,))
            rows = cur.fetchall()
        return jsonify({'ok': True, 'rows': rows})
    except Exception as e:
        log.exception('email_templates list')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
def create():
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        evento = (d.get('evento') or '').strip()
        destinatario = (d.get('destinatario') or '').strip().lower()
        subject = (d.get('subject') or '').strip()
        body_html = d.get('body_html') or ''
        if not evento or not destinatario or not subject or not body_html:
            return jsonify({'ok': False, 'error': 'campos_requeridos'}), 400
        if destinatario not in DESTINATARIOS:
            return jsonify({'ok': False, 'error': 'destinatario_invalido'}), 400

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO email_template
                  (id_manager, evento, destinatario, subject, body_html, active, delay_minutes)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id_manager, evento, destinatario) DO UPDATE
                  SET subject = EXCLUDED.subject,
                      body_html = EXCLUDED.body_html,
                      active = EXCLUDED.active,
                      delay_minutes = EXCLUDED.delay_minutes
                RETURNING *
            """, (g.id_manager, evento, destinatario, subject, body_html,
                  bool(d.get('active', True)), int(d.get('delay_minutes') or 0)))
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('email_templates create')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:tpl_id>', methods=['PUT'])
@auth_required
def update(tpl_id):
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        with get_conn() as conn, conn.cursor() as cur:
            # Comprobar pertenencia
            cur.execute("SELECT id FROM email_template WHERE id=%s AND id_manager=%s",
                        (tpl_id, g.id_manager))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'not_found'}), 404
            sets, params = [], []
            for k in ('subject', 'body_html'):
                if k in d:
                    sets.append(f"{k}=%s"); params.append(d[k])
            if 'active' in d:
                sets.append("active=%s"); params.append(bool(d['active']))
            if 'delay_minutes' in d:
                sets.append("delay_minutes=%s"); params.append(int(d['delay_minutes']))
            if not sets:
                return jsonify({'ok': False, 'error': 'no_fields'}), 400
            params.extend([tpl_id, g.id_manager])
            cur.execute(f"""
                UPDATE email_template SET {', '.join(sets)}
                 WHERE id=%s AND id_manager=%s RETURNING *
            """, params)
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('email_templates update')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:tpl_id>', methods=['DELETE'])
@auth_required
def delete(tpl_id):
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM email_template WHERE id=%s AND id_manager=%s",
                        (tpl_id, g.id_manager))
            n = cur.rowcount
        if n == 0:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        return jsonify({'ok': True})
    except Exception as e:
        log.exception('email_templates delete')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/seed', methods=['POST'])
@auth_required
def seed():
    """Inserta las plantillas por defecto (solo crea las que faltan)."""
    err = _manager_only()
    if err: return err
    try:
        n = seed_templates(g.id_manager)
        return jsonify({'ok': True, 'inserted': n, 'total_defaults': len(DEFAULT_TEMPLATES)})
    except Exception as e:
        log.exception('email_templates seed')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<int:tpl_id>/test', methods=['POST'])
@auth_required
def test(tpl_id):
    """Renderiza la plantilla con un payload de ejemplo y la envía a dest_email."""
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        dest = (d.get('dest_email') or '').strip()
        if not dest:
            return jsonify({'ok': False, 'error': 'dest_email_required'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT * FROM email_template
                            WHERE id=%s AND id_manager=%s""",
                        (tpl_id, g.id_manager))
            tpl = cur.fetchone()
        if not tpl: return jsonify({'ok': False, 'error': 'not_found'}), 404

        ctx_demo = {
            'lead_name':     'Juan Pérez',
            'lead_email':    'juan.perez@example.com',
            'lead_phone':    '+34 666 123 456',
            'lead_message':  'Quiero información sobre los planes mensuales',
            'lead_url':      'https://noofit.wiemspro.com/crm',
            'lead_id':       '999',
            'trainer_name':  'Trainer Demo',
            'trainer_phone': '+34 600 000 000',
            'trainer_email': 'demo@roundtrainingcenter.com',
            'centro_name':   'Round Málaga Centro',
            'centro_email':  'malagacentro@roundtrainingcenter.com',
            'centro_slug':   'malagacentro',
            'centro_ciudad': 'Málaga',
            'cuota_interes': 'Mensual ilimitada',
            'manager_email': '',
        }
        subject = render(tpl['subject'], ctx_demo)
        body_html = render(tpl['body_html'], ctx_demo)
        body_text = html_to_text(body_html)
        ok = enviar_email(dest, '[TEST] ' + subject, body_text,
                          body_html=body_html, id_manager=g.id_manager)
        return jsonify({'ok': ok})
    except Exception as e:
        log.exception('email_templates test')
        return jsonify({'ok': False, 'error': str(e)}), 500
