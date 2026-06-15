"""CRUD de Pagadores — instrumento de cobro compartido (docs/PLAN_PAGADOR.md).

Un pagador (atado a UN trainer) cede su instrumento (IBAN si SEPA / token si
tarjeta) para que se carguen en su cuenta los recibos de uno o varios clientes
de ese trainer. La factura/recibo/pago siguen siendo del CLIENTE; solo cambia,
al emitir, qué instrumento se debita (lo resuelve `pagadores_core`).

Endpoints (perm `cuotas_clientes.pagadores.{ver,editar}`):
  GET    /api/pagadores
  POST   /api/pagadores
  PATCH  /api/pagadores/<id>
  DELETE /api/pagadores/<id>                      (inactiva; solo sin clientes activos)
  GET    /api/pagadores/<id>/clientes
  POST   /api/pagadores/<id>/clientes             body {clientes:[idnoofit,...]}
  DELETE /api/pagadores/<id>/clientes/<idnoofit>  (baja → informa forma de pago que queda)
"""
import datetime as dt
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..odoo_guard import require_feature
from ..db import get_conn
from ..audit_log import log_action, actor_from_request
from ..trainer_scope import clientes_id_noofit_del_trainer, trainer_bloquea
from ..iban_validator import validar_iban
from ..pagadores_core import forma_pago_cliente_activa

bp = Blueprint('pagadores', __name__)
log = logging.getLogger(__name__)

FORMAS_VALIDAS = {'sepa', 'tarjeta_token'}


def _mask(s, keep=4):
    if not s:
        return None
    s = str(s)
    return ('•' * max(0, len(s) - keep)) + s[-keep:] if len(s) > keep else s


def _serialize(r, n_clientes=None):
    """Pagador para JSON: enmascara IBAN, nunca expone el token completo."""
    out = dict(r)
    out['iban'] = _mask(r.get('iban'))
    out['card_token_set'] = bool(r.get('card_token'))
    out.pop('card_token', None)
    for k in ('created_at', 'updated_at'):
        if out.get(k) and hasattr(out[k], 'isoformat'):
            out[k] = out[k].isoformat()
    if n_clientes is not None:
        out['n_clientes'] = n_clientes
    return out


def _get_pagador(pid):
    """Lee el pagador validando manager + scope de trainer. None si no procede."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM pagador WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), pid))
        p = cur.fetchone()
    if not p:
        return None
    if trainer_bloquea(p['id_trainer']):   # sesión scopeada a otro trainer
        return None
    return p


def _validar_instrumento(d, forma):
    """Valida/normaliza el instrumento según forma. Devuelve (campos, error)."""
    campos = {'iban': None, 'iban_titular': None, 'bic': None, 'mandate_ref': None,
              'card_token': None, 'card_brand': None, 'card_last4': None}
    if forma == 'sepa':
        iban = (d.get('iban') or '').replace(' ', '').upper()
        if not iban:
            return None, ('iban_required_sepa', 'SEPA requiere IBAN del pagador')
        v = validar_iban(iban)
        if not v['ok']:
            return None, ('iban_invalido', v.get('detalle'))
        campos['iban'] = v['iban_normalizado']
        campos['iban_titular'] = d.get('iban_titular')
        campos['bic'] = d.get('bic')
        campos['mandate_ref'] = d.get('mandate_ref')
    elif forma == 'tarjeta_token':
        token = (d.get('card_token') or '').strip()
        if not token:
            return None, ('card_token_required', 'Tarjeta tokenizada requiere el token')
        campos['card_token'] = token
        campos['card_brand'] = d.get('card_brand')
        campos['card_last4'] = (d.get('card_last4') or '')[:4] or None
    return campos, None


# ─── Pagadores ────────────────────────────────────────────────────────────────

@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
@require_permission('cuotas_clientes.pagadores.ver')
def list_pagadores():
    where, vals = ['id_manager=%s'], [str(g.id_manager)]
    if g.id_trainer:
        where.append('id_trainer=%s'); vals.append(str(g.id_trainer))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM pagador WHERE {' AND '.join(where)} "
                    f"ORDER BY estado, nombre", vals)
        rows = cur.fetchall()
        ids = [r['id'] for r in rows]
        counts = {}
        if ids:
            cur.execute("""SELECT pagador_id, count(*) AS n FROM pagador_cliente
                            WHERE pagador_id = ANY(%s) AND estado='activo'
                            GROUP BY pagador_id""", (ids,))
            counts = {r['pagador_id']: r['n'] for r in cur.fetchall()}
    return jsonify({'ok': True,
                    'pagadores': [_serialize(r, counts.get(r['id'], 0)) for r in rows]})


@bp.route('', methods=['POST'])
@bp.route('/', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.pagadores.editar')
def create_pagador():
    d = request.get_json() or {}
    nombre = (d.get('nombre') or '').strip()
    forma = d.get('forma_pago')
    id_trainer = str(d.get('id_trainer') or g.id_trainer or '').strip()
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_required'}), 400
    if forma not in FORMAS_VALIDAS:
        return jsonify({'ok': False, 'error': 'forma_pago_invalid',
                        'detalle': f'acepta: {sorted(FORMAS_VALIDAS)}'}), 400
    # Atado a UN trainer (decisión 1). Si la sesión es de un trainer, debe ser el suyo.
    if not id_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_required',
                        'detalle': 'El pagador debe pertenecer a un trainer'}), 400
    if g.id_trainer and id_trainer != str(g.id_trainer):
        return jsonify({'ok': False, 'error': 'trainer_no_permitido'}), 403

    campos, err = _validar_instrumento(d, forma)
    if err:
        return jsonify({'ok': False, 'error': err[0], 'detalle': err[1]}), 400

    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'API'
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO pagador
              (id_manager, id_trainer, nombre, nif, forma_pago,
               iban, iban_titular, bic, mandate_ref,
               card_token, card_brand, card_last4, notas,
               created_by, updated_by)
            VALUES (%s,%s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s, %s,%s)
            RETURNING id
        """, (str(g.id_manager), id_trainer, nombre, d.get('nif'), forma,
              campos['iban'], campos['iban_titular'], campos['bic'], campos['mandate_ref'],
              campos['card_token'], campos['card_brand'], campos['card_last4'],
              d.get('notas'), actor_label, actor_label))
        pid = cur.fetchone()['id']
    log_action(actor, entidad='pagador', entidad_id=pid, accion='create',
               resumen=f'Alta pagador {nombre} ({forma}) trainer {id_trainer}',
               cambios={'campos_modificados': ['nombre', 'forma_pago',
                        'iban' if forma == 'sepa' else 'card_token']})
    return jsonify({'ok': True, 'id': pid})


@bp.route('/<int:pid>', methods=['PATCH', 'PUT'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.pagadores.editar')
def update_pagador(pid):
    """Modifica datos / instrumento / mandato del pagador."""
    p = _get_pagador(pid)
    if not p:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    d = request.get_json() or {}
    sets, vals, cambios = [], [], []

    for f in ('nombre', 'nif', 'notas', 'estado'):
        if f in d:
            sets.append(f"{f}=%s"); vals.append(d[f]); cambios.append(f)

    # Cambio de instrumento: revalidar según la forma (nueva o actual).
    if any(k in d for k in ('forma_pago', 'iban', 'mandate_ref', 'card_token',
                            'bic', 'iban_titular', 'card_brand', 'card_last4')):
        forma = d.get('forma_pago') or p['forma_pago']
        if forma not in FORMAS_VALIDAS:
            return jsonify({'ok': False, 'error': 'forma_pago_invalid'}), 400
        campos, err = _validar_instrumento(d, forma)
        if err:
            return jsonify({'ok': False, 'error': err[0], 'detalle': err[1]}), 400
        sets.append("forma_pago=%s"); vals.append(forma)
        for k, v in campos.items():
            sets.append(f"{k}=%s"); vals.append(v)
        cambios.append('instrumento')

    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    actor = actor_from_request()
    sets.append("updated_by=%s"); vals.append(actor.get('label') or actor.get('email'))
    vals.extend([str(g.id_manager), pid])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE pagador SET {', '.join(sets)} "
                    f"WHERE id_manager=%s AND id=%s RETURNING id", vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    # NUNCA registrar secretos en cambios: solo nombres de campo.
    log_action(actor, entidad='pagador', entidad_id=pid, accion='update',
               resumen='Modificación pagador',
               cambios={'campos_modificados': cambios})
    return jsonify({'ok': True})


@bp.route('/<int:pid>', methods=['DELETE'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.pagadores.editar')
def delete_pagador(pid):
    """Inactiva el pagador. Solo si no tiene clientes activos."""
    p = _get_pagador(pid)
    if not p:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT count(*) AS n FROM pagador_cliente
                        WHERE pagador_id=%s AND estado='activo'""", (pid,))
        if cur.fetchone()['n'] > 0:
            return jsonify({'ok': False, 'error': 'tiene_clientes_activos',
                            'detalle': 'Da de baja sus clientes antes de inactivar el pagador.'}), 409
        cur.execute("""UPDATE pagador SET estado='inactivo', updated_by=%s
                        WHERE id_manager=%s AND id=%s""",
                    (actor_from_request().get('label'), str(g.id_manager), pid))
    log_action(actor_from_request(), entidad='pagador', entidad_id=pid, accion='delete',
               resumen=f'Pagador {p["nombre"]} inactivado')
    return jsonify({'ok': True})


# ─── Clientes del pagador ───────────────────────────────────────────────────────

@bp.route('/<int:pid>/clientes', methods=['GET'])
@auth_required
@require_permission('cuotas_clientes.pagadores.ver')
def list_clientes(pid):
    if not _get_pagador(pid):
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, cliente_idnoofit, estado, fecha_inicio, fecha_fin, motivo
                         FROM pagador_cliente WHERE pagador_id=%s
                        ORDER BY estado, cliente_idnoofit""", (pid,))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'clientes': rows})


@bp.route('/<int:pid>/clientes', methods=['POST'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.pagadores.editar')
def add_clientes(pid):
    """Alta de cliente(s) al pagador. body {clientes:[idnoofit,...]}.
    Cada cliente debe pertenecer al MISMO trainer del pagador y no tener ya
    otro pagador activo (UNIQUE parcial uq_pagcli_activo)."""
    p = _get_pagador(pid)
    if not p:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    d = request.get_json() or {}
    clientes = d.get('clientes') or ([d['cliente_idnoofit']] if d.get('cliente_idnoofit') else [])
    clientes = [str(c).strip() for c in clientes if str(c).strip()]
    if not clientes:
        return jsonify({'ok': False, 'error': 'sin_clientes'}), 400

    # Clientes válidos del trainer del pagador (no de g.id_trainer: el pagador
    # tiene su propio trainer fijo).
    validos = clientes_id_noofit_del_trainer(g.id_manager, p['id_trainer'])
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'API'
    añadidos, errores = [], []
    with get_conn() as conn, conn.cursor() as cur:
        for cid in clientes:
            if validos is not None and cid not in validos:
                errores.append({'cliente': cid, 'error': 'no_pertenece_al_trainer'}); continue
            # ¿ya tiene otro pagador activo?
            cur.execute("""SELECT pagador_id FROM pagador_cliente
                            WHERE id_manager=%s AND cliente_idnoofit=%s AND estado='activo'""",
                        (str(g.id_manager), cid))
            ex = cur.fetchone()
            if ex:
                if ex['pagador_id'] == pid:
                    añadidos.append(cid)  # idempotente
                else:
                    errores.append({'cliente': cid, 'error': 'ya_tiene_pagador',
                                    'pagador_id': ex['pagador_id']})
                continue
            cur.execute("""INSERT INTO pagador_cliente
                             (id_manager, pagador_id, cliente_idnoofit, created_by, updated_by)
                           VALUES (%s,%s,%s,%s,%s)""",
                        (str(g.id_manager), pid, cid, actor_label, actor_label))
            añadidos.append(cid)
    if añadidos:
        log_action(actor, entidad='pagador', entidad_id=pid, accion='add_clientes',
                   resumen=f'Pagador {p["nombre"]}: +{len(añadidos)} cliente(s)',
                   cambios={'clientes': añadidos})
    return jsonify({'ok': True, 'añadidos': añadidos, 'errores': errores})


@bp.route('/<int:pid>/clientes/<idnoofit>', methods=['DELETE'])
@auth_required
@require_feature('cuotas')
@require_permission('cuotas_clientes.pagadores.editar')
def baja_cliente(pid, idnoofit):
    """Baja de un cliente del pagador → vuelve a auto-pago. Informa la forma de
    pago que le queda (decisión 4)."""
    p = _get_pagador(pid)
    if not p:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    d = request.get_json(silent=True) or {}
    actor = actor_from_request()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE pagador_cliente
                          SET estado='baja', fecha_fin=CURRENT_DATE,
                              motivo=%s, updated_by=%s
                        WHERE id_manager=%s AND pagador_id=%s
                          AND cliente_idnoofit=%s AND estado='activo'
                        RETURNING id""",
                    (d.get('motivo') or 'Baja manual',
                     actor.get('label') or actor.get('email'),
                     str(g.id_manager), pid, str(idnoofit)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found_or_already_baja'}), 404
    # Forma de pago que le QUEDA (auto-pago) — para avisar en la UI.
    fp = forma_pago_cliente_activa(g.id_manager, idnoofit)
    queda = (fp['forma_pago'] if fp else None)
    log_action(actor, entidad='pagador', entidad_id=pid, accion='baja_cliente',
               resumen=f'Baja cliente {idnoofit} del pagador {p["nombre"]}',
               cambios={'cliente': str(idnoofit), 'forma_pago_resultante': queda})
    return jsonify({'ok': True,
                    'forma_pago_resultante': queda,
                    'aviso': (f'El cliente vuelve a auto-pago con su forma de pago: {queda}.'
                              if queda else
                              'El cliente queda SIN forma de pago configurada (no se le emitirá '
                              'SEPA hasta configurarla).')})
