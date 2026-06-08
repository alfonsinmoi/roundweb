"""Configuración de facturación (manager-only).

Reemplaza al antiguo `modo_facturacion` de 3 modos por el modelo de 2 sistemas
× 2 destinos + config per-trainer (430XXX, serie, tipos de IVA).

Premisas (CLAUDE.md):
- SOLO el manager modifica (gating por `@require_permission('configuracion.modo_facturacion.editar')`;
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
from ..auth import auth_required, require_permission, require_manager
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


def _validar_completitud(cur, m, fecha_corte):
    """Devuelve lista de problemas que IMPIDEN activar. Vacía = listo.

    Garantiza que activar no deje el sistema a medias:
      - fecha de corte (no facturar lo anterior al arranque)
      - empresa Odoo del manager provisionada
      - al menos una serie con ir.sequence (journal) materializada
      - cada trainer que TIENE cuotas: 430XXX asignado + serie con sequence
    """
    faltantes = []
    if not fecha_corte:
        faltantes.append('fecha_corte_requerida')
    # Empresa Odoo del manager
    if not _company_id_manager(cur):
        faltantes.append('manager_sin_empresa_odoo (provisionar contabilidad/cuotas)')
    # Series con sequence materializada
    cur.execute("""SELECT count(*) n FROM facturacion_serie
                    WHERE id_manager=%s AND ir_sequence_id IS NOT NULL""", (m,))
    if (cur.fetchone() or {}).get('n', 0) == 0:
        faltantes.append('sin_serie_provisionada (pulsa Provisionar)')
    # Trainers con cuotas que aún no tienen 430XXX + serie provisionada
    cur.execute("""
        SELECT DISTINCT c.id_trainer
          FROM cuota c
         WHERE c.id_manager=%s AND c.id_trainer IS NOT NULL
    """, (m,))
    trainers_con_cuotas = [str(r['id_trainer']) for r in cur.fetchall()]
    for t in trainers_con_cuotas:
        cur.execute("""SELECT ft.cuenta_430_sufijo, fs.ir_sequence_id
                         FROM facturacion_trainer ft
                         LEFT JOIN facturacion_serie fs ON fs.id = ft.serie_id
                        WHERE ft.id_manager=%s AND ft.id_trainer=%s""", (m, t))
        ft = cur.fetchone()
        if not ft or ft.get('cuenta_430_sufijo') is None:
            faltantes.append(f'trainer_{t}_sin_cuenta_430')
        elif ft.get('ir_sequence_id') is None:
            faltantes.append(f'trainer_{t}_sin_serie_provisionada')
    return faltantes


# ─────────────────────────── LECTURA (snapshot) ──────────────────────────
@bp.route('', methods=['GET'])
@bp.route('/', methods=['GET'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.ver')
def get_config():
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT sistema, destino, activo, company_id, fecha_corte, updated_at
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


# ─────────────────────────── VALIDACIÓN (readiness) ──────────────────────
@bp.route('/validacion', methods=['GET'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.ver')
def validacion():
    """¿Está el manager listo para ACTIVAR? Devuelve {listo, faltantes}.
    La UI lo usa para habilitar/deshabilitar el botón de activar."""
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT fecha_corte FROM facturacion_config
                        WHERE id_manager=%s ORDER BY id LIMIT 1""", (m,))
        row = cur.fetchone()
        fc = (row.get('fecha_corte') if row else None)
        faltantes = _validar_completitud(cur, m, fc)
    return jsonify({'ok': True, 'listo': len(faltantes) == 0, 'faltantes': faltantes})


# ─────────────────────── CONFIG empresa (sistema/destino) ─────────────────
@bp.route('', methods=['PUT'])
@bp.route('/', methods=['PUT'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
def set_config():
    d = request.get_json() or {}
    sistema = (d.get('sistema') or '').strip()
    destino = (d.get('destino') or '').strip()
    activo = bool(d.get('activo'))
    fecha_corte = (d.get('fecha_corte') or '').strip() or None  # YYYY-MM-DD
    if sistema not in SISTEMAS:
        return jsonify({'ok': False, 'error': f'sistema_invalido (valores: {sorted(SISTEMAS)})'}), 400
    if destino not in DESTINOS:
        return jsonify({'ok': False, 'error': f'destino_invalido (valores: {sorted(DESTINOS)})'}), 400
    # Seguridad: no se puede ACTIVAR sin fecha de corte (evita facturar lo viejo)
    if activo and not fecha_corte:
        return jsonify({'ok': False, 'error': 'fecha_corte_requerida_para_activar'}), 400
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        # Validador de completitud: NO permitir activar si falta algo crítico
        # (evita arrancar el sistema a medias).
        if activo:
            faltantes = _validar_completitud(cur, m, fecha_corte)
            if faltantes:
                return jsonify({'ok': False, 'error': 'config_incompleta',
                                'faltantes': faltantes}), 400
        company_id = _company_id_manager(cur)
        cur.execute("""SELECT sistema, destino, activo, fecha_corte FROM facturacion_config
                        WHERE id_manager=%s ORDER BY id LIMIT 1""", (m,))
        antes = cur.fetchone()
        cur.execute("""
            INSERT INTO facturacion_config (id_manager, company_id, sistema, destino, activo, fecha_corte, updated_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id_manager, company_id) DO UPDATE
              SET sistema=EXCLUDED.sistema, destino=EXCLUDED.destino,
                  activo=EXCLUDED.activo, fecha_corte=EXCLUDED.fecha_corte,
                  updated_by=EXCLUDED.updated_by, updated_at=now()
            RETURNING sistema, destino, activo, fecha_corte
        """, (m, company_id, sistema, destino, activo, fecha_corte,
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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


# ─────── Cuotas de un trainer con su IVA efectivo (UI simplificada) ───────
@bp.route('/trainer/<id_trainer>/cuotas', methods=['GET'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.ver')
def cuotas_de_trainer(id_trainer):
    """Lista las cuotas del trainer con su IVA efectivo. Las que no tienen
    tipo de IVA asignado se facturan al 21% por defecto."""
    m = str(g.id_manager)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.codigo, c.descripcion, c.tipo_cuota,
                   COALESCE(ti.pct, 21)::float AS iva_pct,
                   (c.tipo_iva_id IS NOT NULL) AS iva_personalizado
              FROM cuota c
              LEFT JOIN facturacion_tipo_iva ti ON ti.id = c.tipo_iva_id
             WHERE c.id_manager=%s AND c.id_trainer=%s AND c.active=true
             ORDER BY c.codigo
        """, (m, str(id_trainer)))
        cuotas = cur.fetchall()
    return jsonify({'ok': True, 'cuotas': cuotas})


@bp.route('/cuota/<int:cuota_id>/iva', methods=['PUT'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
def set_cuota_iva(cuota_id):
    """Fija el % de IVA de una cuota. pct=21 (o nulo) → vuelve al 21% por
    defecto (desasigna). Internamente reutiliza `facturacion_tipo_iva`
    (dedupe por manager+trainer+pct) para no tocar el motor de facturación."""
    d = request.get_json() or {}
    pct_raw = d.get('pct')
    m = str(g.id_manager)
    # Normalizar pct
    if pct_raw is None or pct_raw == '':
        pct = None
    else:
        try:
            pct = float(pct_raw)
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'error': 'pct_invalido'}), 400
        if not (0 <= pct <= 100):
            return jsonify({'ok': False, 'error': 'pct_fuera_de_rango'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id_trainer, tipo_iva_id FROM cuota WHERE id_manager=%s AND id=%s",
                    (m, cuota_id))
        cu = cur.fetchone()
        if not cu:
            return jsonify({'ok': False, 'error': 'cuota_no_del_manager'}), 404
        id_trainer = cu['id_trainer']
        # 21% o nulo → desasignar (queda en el default del motor)
        if pct is None or abs(pct - 21.0) < 1e-9:
            cur.execute("UPDATE cuota SET tipo_iva_id=NULL WHERE id_manager=%s AND id=%s",
                        (m, cuota_id))
            conn.commit()
            log_action(actor_from_request(), entidad='cuota', entidad_id=str(cuota_id),
                       accion='update', resumen='IVA cuota → 21% (por defecto)')
            return jsonify({'ok': True, 'iva_pct': 21.0, 'iva_personalizado': False})
        # pct ≠ 21 → asegurar tipo de IVA (dedupe por manager+trainer+pct) y asignar
        cur.execute("""SELECT id FROM facturacion_tipo_iva
                        WHERE id_manager=%s AND id_trainer=%s AND pct=%s LIMIT 1""",
                    (m, str(id_trainer), pct))
        ti = cur.fetchone()
        if ti:
            tipo_id = ti['id']
        else:
            cur.execute("""INSERT INTO facturacion_tipo_iva (id_manager, id_trainer, nombre, pct)
                            VALUES (%s,%s,%s,%s) RETURNING id""",
                        (m, str(id_trainer), f'IVA {pct:g}%', pct))
            tipo_id = cur.fetchone()['id']
        cur.execute("UPDATE cuota SET tipo_iva_id=%s WHERE id_manager=%s AND id=%s",
                    (tipo_id, m, cuota_id))
        conn.commit()
    log_action(actor_from_request(), entidad='cuota', entidad_id=str(cuota_id),
               accion='update', resumen=f'IVA cuota → {pct:g}%')
    return jsonify({'ok': True, 'iva_pct': pct, 'iva_personalizado': True})


# ─────────────────── Asignar cuota → tipo de IVA (legacy) ─────────────────
@bp.route('/cuota/<int:cuota_id>/tipo-iva', methods=['PUT'])
@auth_required
@require_manager
@require_permission('configuracion.modo_facturacion.editar')
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
