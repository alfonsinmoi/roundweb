"""Form builder embebible (junio 2026).

Los managers crean formularios desde Configuración → Formularios y los
incrustan en su web vía <iframe src="…/f/<public_id>">.

Flujo:
  - Página pública /f/<public_id> (SPA React) hace:
      GET  /api/crm/form/<public_id>            → definición del form
      GET  /api/crm/form/<public_id>/slots      → slots de prueba (si tipo=prueba)
      POST /api/crm/form/<public_id>            → submit (crea lead o reserva)
  - El submit reutiliza:
      tipo='lead'    → crm._procesar_lead(id_manager, d, company_id=...)
      tipo='prueba'  → slots.crear_reserva_core(id_manager, d)
    Ambos ya son multi-tenant (crean en la company / trainer del manager).

CRUD autenticado (Configuración → Formularios), gated con permiso fino
`configuracion.formularios.*`:
  GET/POST/PATCH/DELETE /api/config/formularios[/<id>]
"""
import json
import logging
import secrets
import time
from collections import defaultdict
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from .. import config as cfg
from .centros import buscar_centro, proximo_centro_round_robin

log = logging.getLogger(__name__)
bp = Blueprint('lead_forms', __name__)

# Rate limit por IP en memoria (igual patrón que crm.py)
_RL = defaultdict(list)
_RL_MAX = 10
_RL_WINDOW = 60 * 5


def _rate_ok(ip):
    now = time.time()
    b = [t for t in _RL[ip] if now - t < _RL_WINDOW]
    b.append(now)
    _RL[ip] = b
    return len(b) <= _RL_MAX


def _gen_public_id():
    return secrets.token_urlsafe(9).replace('-', '').replace('_', '')[:12]


def _row_to_form(r, *, public=False):
    """Serializa una fila lead_form. public=True omite datos internos."""
    o = {
        'public_id': r['public_id'],
        'nombre':    r['nombre'],
        'tipo':      r['tipo'],
        'campos':    r['campos'] or [],
        'config':    r['config'] or {},
    }
    if not public:
        o.update({
            'id':         r['id'],
            'id_trainer': r.get('id_trainer'),
            'activo':     r['activo'],
            'created_at': r['created_at'].isoformat() if r.get('created_at') else None,
            'updated_at': r['updated_at'].isoformat() if r.get('updated_at') else None,
        })
    return o


def _manager_company(id_manager):
    """Devuelve odoo_company_id del manager (o el global por defecto)."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT odoo_company_id FROM manager_config WHERE id_manager=%s",
                        (str(id_manager),))
            row = cur.fetchone()
        if row and row.get('odoo_company_id'):
            return row['odoo_company_id']
    except Exception:
        log.exception('_manager_company')
    return cfg.ODOO_COMPANY


def _load_form(public_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM lead_form WHERE public_id=%s AND activo=TRUE""",
                    (public_id,))
        return cur.fetchone()


# ════════════════════════ ENDPOINTS PÚBLICOS ════════════════════════════════

@bp.route('/api/crm/form/<public_id>', methods=['GET', 'OPTIONS'])
def form_definicion(public_id):
    if request.method == 'OPTIONS':
        return ('', 204)
    form = _load_form(public_id)
    if not form:
        return jsonify({'ok': False, 'error': 'form_no_encontrado'}), 404
    out = _row_to_form(form, public=True)
    # Adjuntar info del centro (para el slot picker / branding)
    centro_slug = (form['config'] or {}).get('centro_slug')
    centro = (buscar_centro(form['id_manager'], slug=centro_slug) if centro_slug
              else (buscar_centro(form['id_manager'], id_trainer=form['id_trainer'])
                    if form.get('id_trainer') else proximo_centro_round_robin(form['id_manager'])))
    if centro:
        out['centro'] = {'slug': centro.get('slug'),
                         'nombre': centro.get('nombre_centro')}
    return jsonify({'ok': True, 'form': out})


@bp.route('/api/crm/form/<public_id>/slots', methods=['GET', 'OPTIONS'])
def form_slots(public_id):
    """Slots de prueba para el form (solo tipo='prueba')."""
    if request.method == 'OPTIONS':
        return ('', 204)
    form = _load_form(public_id)
    if not form:
        return jsonify({'ok': False, 'error': 'form_no_encontrado'}), 404
    if form['tipo'] != 'prueba':
        return jsonify({'ok': False, 'error': 'form_no_es_prueba'}), 400

    cfg_form = form['config'] or {}
    centro_slug = cfg_form.get('centro_slug')
    centro = (buscar_centro(form['id_manager'], slug=centro_slug) if centro_slug
              else (buscar_centro(form['id_manager'], id_trainer=form['id_trainer'])
                    if form.get('id_trainer') else proximo_centro_round_robin(form['id_manager'])))
    if not centro:
        return jsonify({'ok': False, 'error': 'centro_no_configurado'}), 503

    from ..slot_affluence import slots_disponibles
    id_actividad = (request.args.get('actividad') or '').strip() or None
    try:
        max_resultados = min(int(request.args.get('max', '12')), 50)
    except ValueError:
        max_resultados = 12
    try:
        result = slots_disponibles(
            id_trainer=centro['id_trainer'], dias_adelante=14,
            max_resultados=max_resultados, id_actividad=id_actividad,
            devolver_actividades=True,
            dias_permitidos=centro.get('dias_permitidos') or [],
            actividades_permitidas=centro.get('actividades_permitidas') or [])
        slots = result['slots']
        por_dia = defaultdict(list)
        for s in slots:
            por_dia[s['fecha_local']].append(s)
        return jsonify({
            'ok': True,
            'centro': {'slug': centro['slug'], 'nombre': centro['nombre_centro']},
            'total': len(slots),
            'slots': slots,
            'por_dia': [{'fecha': dia, 'slots': por_dia[dia]} for dia in sorted(por_dia)],
            'actividades': result['actividades'],
        })
    except Exception as e:
        log.exception('form_slots')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/api/crm/form/<public_id>', methods=['POST'])
def form_submit(public_id):
    ip = (request.headers.get('X-Real-IP')
          or request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
          or request.remote_addr or 'unknown')
    if not _rate_ok(ip):
        return jsonify({'ok': False, 'error': 'rate_limited'}), 429

    form = _load_form(public_id)
    if not form:
        return jsonify({'ok': False, 'error': 'form_no_encontrado'}), 404

    try:
        d = request.get_json(silent=True) or request.form.to_dict() or {}
    except Exception:
        d = {}

    # Honeypot
    if d.get('website') or d.get('url'):
        return jsonify({'ok': True, 'skipped': True}), 200

    cfg_form = form['config'] or {}

    # Consentimiento RGPD obligatorio si el form lo exige
    if cfg_form.get('consent_required') and not d.get('consentimiento'):
        return jsonify({'ok': False, 'error': 'consentimiento_requerido',
                        'detalle': 'Debes aceptar la política de privacidad.'}), 400

    # Validar requeridos definidos en el form
    for campo in (form['campos'] or []):
        if campo.get('required') and campo.get('type') not in ('consentimiento', 'oculto'):
            key = campo.get('key')
            if key and not (d.get(key) or '').strip():
                return jsonify({'ok': False, 'error': 'campo_requerido',
                                'campo': key, 'label': campo.get('label')}), 400

    # Fijar el centro del form (si lo pinó) para que el core lo respete
    if cfg_form.get('centro_slug') and not d.get('centro'):
        d['centro'] = cfg_form['centro_slug']

    id_manager = str(form['id_manager'])
    origen = f'form_{public_id}'

    if form['tipo'] == 'prueba':
        from .slots import crear_reserva_core
        return crear_reserva_core(id_manager, d)

    # tipo='lead'
    from .crm import _procesar_lead
    company_id = _manager_company(id_manager)
    return _procesar_lead(id_manager, d, origen=origen,
                          company_id=company_id, origen_label=f'Formulario: {form["nombre"]}')


# ════════════════════════ CRUD AUTENTICADO ══════════════════════════════════

@bp.route('/api/config/formularios', methods=['GET'])
@auth_required
@require_permission('configuracion.formularios.ver')
def listar_formularios():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM lead_form
                        WHERE id_manager=%s ORDER BY activo DESC, created_at DESC""",
                    (str(g.id_manager),))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'formularios': [_row_to_form(r) for r in rows]})


@bp.route('/api/config/formularios', methods=['POST'])
@auth_required
@require_permission('configuracion.formularios.editar')
def crear_formulario():
    d = request.get_json() or {}
    nombre = (d.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_required'}), 400
    tipo = d.get('tipo') if d.get('tipo') in ('lead', 'prueba') else 'lead'
    campos = d.get('campos') if isinstance(d.get('campos'), list) else []
    config = d.get('config') if isinstance(d.get('config'), dict) else {}
    id_trainer = (str(d.get('id_trainer')).strip() if d.get('id_trainer') else None) or None
    # public_id único (reintenta ante colisión improbable)
    for _ in range(5):
        pid = _gen_public_id()
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""INSERT INTO lead_form
                      (id_manager, id_trainer, public_id, nombre, tipo, campos, config)
                      VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb) RETURNING *""",
                    (str(g.id_manager), id_trainer, pid, nombre, tipo,
                     json.dumps(campos), json.dumps(config)))
                row = cur.fetchone()
            return jsonify({'ok': True, 'formulario': _row_to_form(row)})
        except Exception as e:
            if 'public_id' in str(e).lower():
                continue
            log.exception('crear_formulario')
            return jsonify({'ok': False, 'error': str(e)}), 500
    return jsonify({'ok': False, 'error': 'no_public_id'}), 500


@bp.route('/api/config/formularios/<int:fid>', methods=['PATCH', 'PUT'])
@auth_required
@require_permission('configuracion.formularios.editar')
def actualizar_formulario(fid):
    d = request.get_json() or {}
    sets, vals = [], []
    if 'nombre' in d:
        sets.append('nombre=%s'); vals.append((d['nombre'] or '').strip())
    if 'tipo' in d and d['tipo'] in ('lead', 'prueba'):
        sets.append('tipo=%s'); vals.append(d['tipo'])
    if 'campos' in d and isinstance(d['campos'], list):
        sets.append('campos=%s::jsonb'); vals.append(json.dumps(d['campos']))
    if 'config' in d and isinstance(d['config'], dict):
        sets.append('config=%s::jsonb'); vals.append(json.dumps(d['config']))
    if 'id_trainer' in d:
        sets.append('id_trainer=%s')
        vals.append((str(d['id_trainer']).strip() if d['id_trainer'] else None) or None)
    if 'activo' in d:
        sets.append('activo=%s'); vals.append(bool(d['activo']))
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    sets.append('updated_at=NOW()')
    vals.extend([str(g.id_manager), fid])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""UPDATE lead_form SET {', '.join(sets)}
                         WHERE id_manager=%s AND id=%s RETURNING *""", vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'formulario': _row_to_form(row)})


@bp.route('/api/config/formularios/<int:fid>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.formularios.borrar')
def borrar_formulario(fid):
    hard = request.args.get('hard') == '1'
    with get_conn() as conn, conn.cursor() as cur:
        if hard:
            cur.execute("DELETE FROM lead_form WHERE id_manager=%s AND id=%s RETURNING id",
                        (str(g.id_manager), fid))
        else:
            cur.execute("""UPDATE lead_form SET activo=FALSE, updated_at=NOW()
                            WHERE id_manager=%s AND id=%s RETURNING id""",
                        (str(g.id_manager), fid))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'mode': 'hard' if hard else 'soft'})
