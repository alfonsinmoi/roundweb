"""Configuración de facturación (manager-only).

Reemplaza al antiguo `modo_facturacion` de 3 modos por el modelo de 2 sistemas
× 2 destinos + config per-trainer (430XXX, serie, tipos de IVA).

Premisas (CLAUDE.md):
- SOLO el manager modifica (gating por `@require_permission('configuracion.facturacion.editar')`;
  el manager NoofitPro -perfil None- pasa siempre; un trainer/usuario_web sin
  la clave → 403).
- `sistema`/`destino` son por EMPRESA (entidad jurídica) → iguales para todos
  los trainers que comparten company.
- Todo scopeado por `g.id_manager`. Toda mutación llama a `log_action`.
- `activo=false` (default) → el sistema de facturación actual sigue intacto
  (gate). Nada cambia hasta que el manager active + Odoo esté listo.
"""
import logging
from flask import Blueprint, request, jsonify, g
from ..auth import auth_required, require_permission
from ..db import get_conn
from ..audit_log import log_action, actor_from_request, diff_dict

bp = Blueprint('facturacion_config', __name__)
log = logging.getLogger(__name__)

SISTEMAS = {'inmediata', 'fin_de_mes'}
DESTINOS = {'por_cliente', 'agregada_430'}


def _company_id_manager(cur):
    """company_id Odoo del manager (de manager_config). Puede ser None si no
    está provisionado todavía."""
    cur.execute("SELECT odoo_company_id FROM manager_config WHERE id_manager=%s",
                (str(g.id_manager),))
    r = cur.fetchone()
    return (r.get('odoo_company_id') if r else None)


# ─────────────────────────── LECTURA (snapshot) ──────────────────────────
@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
@require_permission('configuracion.facturacion.ver')
def get_config():
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT sistema, destino, activo, company_id, updated_at
                         FROM facturacion_config WHERE id_manager=%s
                        ORDER BY id LIMIT 1""", (m,))
        cfg = cur.fetchone()
        cur.execute("""SELECT id, clave, prefijo, descripcion, es_cliente_final,
                              ir_sequence_id
                         FROM facturacion_serie WHERE id_manager=%s ORDER BY clave""", (m,))
        series = cur.fetchall()
        cur.execute("""SELECT id_trainer, cuenta_430_sufijo, serie_id
                         FROM facturacion_trainer WHERE id_manager=%s
                        ORDER BY id_trainer""", (m,))
        trainers = cur.fetchall()
        cur.execute("""SELECT id, id_trainer, nombre, pct
                         FROM facturacion_tipo_iva WHERE id_manager=%s
                        ORDER BY id_trainer, nombre""", (m,))
        tipos = cur.fetchall()
    return jsonify({
        'ok': True,
        'config': cfg or {'sistema': 'fin_de_mes', 'destino': 'por_cliente',
                          'activo': False, 'company_id': None},
        'series': series,
        'trainers': trainers,
        'tipos_iva': tipos,
    })


# ─────────────────────── CONFIG empresa (sistema/destino) ─────────────────
@bp.route('', methods=['PUT'])
@bp.route('/', methods=['PUT'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def set_config():
    d = request.get_json() or {}
    sistema = (d.get('sistema') or '').strip()
    destino = (d.get('destino') or '').strip()
    activo = bool(d.get('activo'))
    if sistema not in SISTEMAS:
        return jsonify({'ok': False, 'error': f'sistema_invalido (valores: {sorted(SISTEMAS)})'}), 400
    if destino not in DESTINOS:
        return jsonify({'ok': False, 'error': f'destino_invalido (valores: {sorted(DESTINOS)})'}), 400
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        company_id = _company_id_manager(cur)
        cur.execute("""SELECT sistema, destino, activo FROM facturacion_config
                        WHERE id_manager=%s ORDER BY id LIMIT 1""", (m,))
        antes = cur.fetchone()
        cur.execute("""
            INSERT INTO facturacion_config (id_manager, company_id, sistema, destino, activo, updated_by)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id_manager, company_id) DO UPDATE
              SET sistema=EXCLUDED.sistema, destino=EXCLUDED.destino,
                  activo=EXCLUDED.activo, updated_by=EXCLUDED.updated_by, updated_at=now()
            RETURNING sistema, destino, activo
        """, (m, company_id, sistema, destino, activo,
              (actor_from_request() or {}).get('label')))
        despues = cur.fetchone()
        conn.commit()
    log_action(actor_from_request(), entidad='facturacion_config', entidad_id=m,
               accion='update', resumen=f'Facturación → {sistema}/{destino} activo={activo}',
               cambios=diff_dict(antes or {}, despues))
    return jsonify({'ok': True, **despues})


# ─────────── Provisión Odoo (materializar 430XXX + journals) ──────────────
@bp.route('/provisionar', methods=['POST'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def provisionar():
    """Materializa en Odoo la estructura (430XXX por trainer + journal por
    serie) desde la config. Idempotente. NO toca partners."""
    from ..odoo_facturacion import provision_estructura
    try:
        rep = provision_estructura(g.id_manager)
    except Exception as e:
        log.exception('provisionar facturacion')
        return jsonify({'ok': False, 'error': str(e)}), 502
    log_action(actor_from_request(), entidad='facturacion_config', entidad_id=str(g.id_manager),
               accion='provisionar',
               resumen=f'Provisión Odoo: {len(rep.get("cuentas",[]))} cuentas, '
                       f'{len(rep.get("journals",[]))} journals, {len(rep.get("errores",[]))} errores')
    return jsonify({'ok': True, **rep})


# ─────────────────────────────── SERIES ──────────────────────────────────
@bp.route('/series', methods=['POST'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def crear_serie():
    d = request.get_json() or {}
    clave = (d.get('clave') or '').strip()
    if not clave:
        return jsonify({'ok': False, 'error': 'clave_requerida'}), 400
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO facturacion_serie (id_manager, clave, prefijo, descripcion, es_cliente_final)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (id_manager, clave) DO NOTHING
            RETURNING id
        """, (m, clave, (d.get('prefijo') or '').strip() or None,
              (d.get('descripcion') or '').strip() or None, bool(d.get('es_cliente_final'))))
        row = cur.fetchone()
        conn.commit()
    if not row:
        return jsonify({'ok': False, 'error': 'serie_ya_existe'}), 409
    log_action(actor_from_request(), entidad='facturacion_serie', entidad_id=str(row['id']),
               accion='create', resumen=f'Serie {clave}')
    return jsonify({'ok': True, 'id': row['id']})


@bp.route('/series/<int:sid>', methods=['PATCH'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def editar_serie(sid):
    d = request.get_json() or {}
    m = str(g.id_manager)
    campos, vals = [], []
    for k in ('prefijo', 'descripcion'):
        if k in d:
            campos.append(f'{k}=%s'); vals.append((d.get(k) or '').strip() or None)
    if 'es_cliente_final' in d:
        campos.append('es_cliente_final=%s'); vals.append(bool(d['es_cliente_final']))
    if not campos:
        return jsonify({'ok': False, 'error': 'sin_cambios'}), 400
    vals += [m, sid]
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""UPDATE facturacion_serie SET {', '.join(campos)}
                         WHERE id_manager=%s AND id=%s RETURNING id""", vals)
        row = cur.fetchone()
        conn.commit()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='facturacion_serie', entidad_id=str(sid),
               accion='update', resumen='Editada serie')
    return jsonify({'ok': True})


@bp.route('/series/<int:sid>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def borrar_serie(sid):
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        # No borrar si algún trainer la usa (integridad).
        cur.execute("SELECT count(*) n FROM facturacion_trainer WHERE id_manager=%s AND serie_id=%s",
                    (m, sid))
        if (cur.fetchone() or {}).get('n', 0) > 0:
            return jsonify({'ok': False, 'error': 'serie_en_uso'}), 409
        cur.execute("DELETE FROM facturacion_serie WHERE id_manager=%s AND id=%s RETURNING id",
                    (m, sid))
        row = cur.fetchone()
        conn.commit()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='facturacion_serie', entidad_id=str(sid),
               accion='delete', resumen='Serie borrada')
    return jsonify({'ok': True})


# ──────────────── CONFIG por trainer (430XXX + serie) ─────────────────────
@bp.route('/trainer/<id_trainer>', methods=['PUT'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def set_trainer(id_trainer):
    d = request.get_json() or {}
    m = str(g.id_manager)
    sufijo = d.get('cuenta_430_sufijo')
    if sufijo is not None:
        try:
            sufijo = int(sufijo)
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'sufijo_invalido'}), 400
        if not (1 <= sufijo <= 999):
            return jsonify({'ok': False, 'error': 'sufijo_fuera_de_rango (1..999)'}), 400
    serie_id = d.get('serie_id')
    with get_conn() as conn, conn.cursor() as cur:
        # Integridad: el trainer debe ser del manager (existe en trainer_noofit_creds o cliente_cache)
        cur.execute("""SELECT 1 FROM trainer_noofit_creds
                        WHERE id_manager=%s AND id_trainer=%s LIMIT 1""", (m, str(id_trainer)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'trainer_no_pertenece_al_manager'}), 403
        # Integridad: la serie (si viene) es del mismo manager
        if serie_id is not None:
            cur.execute("SELECT 1 FROM facturacion_serie WHERE id_manager=%s AND id=%s",
                        (m, serie_id))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'serie_no_del_manager'}), 400
        # Integridad: el sufijo no puede repetirse en otro trainer del manager
        if sufijo is not None:
            cur.execute("""SELECT id_trainer FROM facturacion_trainer
                            WHERE id_manager=%s AND cuenta_430_sufijo=%s AND id_trainer<>%s""",
                        (m, sufijo, str(id_trainer)))
            otro = cur.fetchone()
            if otro:
                return jsonify({'ok': False, 'error': f'sufijo_430_en_uso por trainer {otro["id_trainer"]}'}), 409
        cur.execute("""
            INSERT INTO facturacion_trainer (id_manager, id_trainer, cuenta_430_sufijo, serie_id)
            VALUES (%s,%s,%s,%s)
            ON CONFLICT (id_manager, id_trainer) DO UPDATE
              SET cuenta_430_sufijo=EXCLUDED.cuenta_430_sufijo,
                  serie_id=EXCLUDED.serie_id, updated_at=now()
            RETURNING id
        """, (m, str(id_trainer), sufijo, serie_id))
        conn.commit()
    log_action(actor_from_request(), entidad='facturacion_trainer', entidad_id=str(id_trainer),
               accion='update',
               resumen=f'430-sufijo={sufijo} serie={serie_id}')
    return jsonify({'ok': True, 'cuenta_430': (f'430{sufijo:03d}' if sufijo else None)})


# ───────────────────────── TIPOS DE IVA (por trainer) ─────────────────────
@bp.route('/tipos-iva', methods=['POST'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def crear_tipo_iva():
    d = request.get_json() or {}
    id_trainer = (str(d.get('id_trainer') or '').strip())
    nombre = (d.get('nombre') or '').strip()
    if not id_trainer or not nombre:
        return jsonify({'ok': False, 'error': 'id_trainer_y_nombre_requeridos'}), 400
    try:
        pct = float(d.get('pct', 21))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'pct_invalido'}), 400
    if not (0 <= pct <= 100):
        return jsonify({'ok': False, 'error': 'pct_fuera_de_rango'}), 400
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO facturacion_tipo_iva (id_manager, id_trainer, nombre, pct)
                        VALUES (%s,%s,%s,%s) RETURNING id""",
                    (m, id_trainer, nombre, pct))
        row = cur.fetchone()
        conn.commit()
    log_action(actor_from_request(), entidad='facturacion_tipo_iva', entidad_id=str(row['id']),
               accion='create', resumen=f'IVA {nombre} {pct}% (trainer {id_trainer})')
    return jsonify({'ok': True, 'id': row['id']})


@bp.route('/tipos-iva/<int:tid>', methods=['PATCH'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def editar_tipo_iva(tid):
    d = request.get_json() or {}
    m = str(g.id_manager)
    campos, vals = [], []
    if 'nombre' in d:
        nombre = (d.get('nombre') or '').strip()
        if not nombre:
            return jsonify({'ok': False, 'error': 'nombre_vacio'}), 400
        campos.append('nombre=%s'); vals.append(nombre)
    if 'pct' in d:
        try:
            pct = float(d['pct'])
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'pct_invalido'}), 400
        if not (0 <= pct <= 100):
            return jsonify({'ok': False, 'error': 'pct_fuera_de_rango'}), 400
        campos.append('pct=%s'); vals.append(pct)
    if not campos:
        return jsonify({'ok': False, 'error': 'sin_cambios'}), 400
    vals += [m, tid]
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""UPDATE facturacion_tipo_iva SET {', '.join(campos)}
                         WHERE id_manager=%s AND id=%s RETURNING id""", vals)
        row = cur.fetchone()
        conn.commit()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='facturacion_tipo_iva', entidad_id=str(tid),
               accion='update', resumen='Editado tipo IVA')
    return jsonify({'ok': True})


@bp.route('/tipos-iva/<int:tid>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def borrar_tipo_iva(tid):
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        # Integridad: no borrar si hay cuotas asignadas a este tipo
        cur.execute("SELECT count(*) n FROM cuota WHERE id_manager=%s AND tipo_iva_id=%s", (m, tid))
        if (cur.fetchone() or {}).get('n', 0) > 0:
            return jsonify({'ok': False, 'error': 'tipo_iva_en_uso (hay cuotas asignadas)'}), 409
        cur.execute("DELETE FROM facturacion_tipo_iva WHERE id_manager=%s AND id=%s RETURNING id",
                    (m, tid))
        row = cur.fetchone()
        conn.commit()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='facturacion_tipo_iva', entidad_id=str(tid),
               accion='delete', resumen='Tipo IVA borrado')
    return jsonify({'ok': True})


# ─────────────────── Asignar cuota → tipo de IVA ──────────────────────────
@bp.route('/cuota/<int:cuota_id>/tipo-iva', methods=['PUT'])
@auth_required
@require_permission('configuracion.facturacion.editar')
def asignar_cuota_iva(cuota_id):
    d = request.get_json() or {}
    tipo_iva_id = d.get('tipo_iva_id')  # puede ser None para desasignar
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        if tipo_iva_id is not None:
            cur.execute("SELECT id_trainer FROM facturacion_tipo_iva WHERE id_manager=%s AND id=%s",
                        (m, tipo_iva_id))
            tipo = cur.fetchone()
            if not tipo:
                return jsonify({'ok': False, 'error': 'tipo_iva_no_del_manager'}), 400
            # Integridad: el tipo y la cuota deben ser del mismo trainer
            cur.execute("SELECT id_trainer FROM cuota WHERE id_manager=%s AND id=%s", (m, cuota_id))
            cu = cur.fetchone()
            if not cu:
                return jsonify({'ok': False, 'error': 'cuota_no_del_manager'}), 404
            if str(cu['id_trainer']) != str(tipo['id_trainer']):
                return jsonify({'ok': False, 'error': 'tipo_iva_de_otro_trainer'}), 409
        cur.execute("""UPDATE cuota SET tipo_iva_id=%s WHERE id_manager=%s AND id=%s RETURNING id""",
                    (tipo_iva_id, m, cuota_id))
        row = cur.fetchone()
        conn.commit()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='cuota', entidad_id=str(cuota_id),
               accion='update', resumen=f'tipo_iva → {tipo_iva_id}')
    return jsonify({'ok': True})
