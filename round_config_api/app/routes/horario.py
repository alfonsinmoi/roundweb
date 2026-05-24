"""Endpoints admin del módulo Control horario laboral (Fase 1).

Cubre:

  Convenios               GET /convenios
  Datos empresa trainer   GET /trainer-empresa
                          GET /trainer-empresa/<id_trainer>
                          PUT /trainer-empresa/<id_trainer>           (upsert)
  Motivos de pausa        GET /pausa-motivos
                          POST /pausa-motivos
                          PATCH /pausa-motivos/<id>
                          DELETE /pausa-motivos/<id>
  Trabajadores            GET /trabajadores
                          GET /trabajadores/pendientes
                          POST /trabajadores                          (alta laboral)
                          GET /trabajadores/<id>
                          PATCH /trabajadores/<id>
                          POST /trabajadores/<id>/baja                (soft)
                          POST /trabajadores/<id>/reactivar
                          POST /trabajadores/<id>/trainers            (vincular trainer)
                          DELETE /trabajadores/<id>/trainers/<pivote_id>

Todos los endpoints aquí son **admin** (manager/trainer/recepción) y exigen:
  - X-Round-Token + X-Round-Manager-Id (vía @auth_required)
  - El manager tiene `control_horario_enabled=true` (vía @require_feature)

El endpoint POST /fichaje y la verificación QR rotativa van en otro
blueprint distinto (fichaje.py) porque autenticarán con JWT NoofitPro
del trabajador en lugar del token compartido.
"""
import logging
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..odoo_guard import require_feature
from ..audit_log import log_action, actor_from_request, diff_dict

bp = Blueprint('horario', __name__)
log = logging.getLogger(__name__)


# Categorías NoofitPro que identifican a un "trabajador" (cliente
# elegible para fichaje). Admitimos variantes de escritura.
TRABAJADOR_CATEGORIAS = ('Trabajador', 'Trabajadores', 'Empleado', 'Empleados')


# ═══════════════════════════════════════════════════════════════════════════
# ║  ACTIVACIÓN DEL MÓDULO (suscripción)                                    ║
# ═══════════════════════════════════════════════════════════════════════════

# `/activar` y `/desactivar` se decoran con @auth_required pero NO con
# @require_feature — son los endpoints que controlan precisamente esa flag.

@bp.route('/activar', methods=['POST'])
@auth_required
def activar_modulo():
    """Activa el módulo control horario para el manager actual.

    Idempotente. Genera `control_horario_qr_secret` si está vacío.
    Más adelante esta activación llegará vía GET desde NoofitPro
    (suscripción pagada) — por ahora se activa desde admin.
    """
    import secrets as _secrets
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE manager_config
               SET control_horario_enabled = TRUE,
                   control_horario_activated_at = COALESCE(control_horario_activated_at, NOW()),
                   control_horario_qr_secret = COALESCE(control_horario_qr_secret, %s),
                   updated_at = NOW()
             WHERE id_manager = %s
            RETURNING control_horario_enabled, control_horario_activated_at
        """, (_secrets.token_urlsafe(48), str(g.id_manager)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'manager_no_encontrado'}), 404
    log_action(actor_from_request(), entidad='manager_config',
               entidad_id=g.id_manager, accion='activar_control_horario',
               resumen='')
    return jsonify({
        'ok': True,
        'control_horario_enabled': True,
        'activated_at': row['control_horario_activated_at'].isoformat() if row['control_horario_activated_at'] else None,
    })


@bp.route('/desactivar', methods=['POST'])
@auth_required
def desactivar_modulo():
    """Desactiva el módulo. NO borra datos (los fichajes históricos se
    conservan 4 años por normativa). Sólo deshabilita nuevos fichajes."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE manager_config
               SET control_horario_enabled = FALSE,
                   updated_at = NOW()
             WHERE id_manager = %s
            RETURNING control_horario_enabled
        """, (str(g.id_manager),))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'manager_no_encontrado'}), 404
    log_action(actor_from_request(), entidad='manager_config',
               entidad_id=g.id_manager, accion='desactivar_control_horario',
               resumen='')
    return jsonify({'ok': True, 'control_horario_enabled': False})


# ═══════════════════════════════════════════════════════════════════════════
# ║  CONVENIOS                                                              ║
# ═══════════════════════════════════════════════════════════════════════════

def _convenio_to_dict(r):
    return {
        'id': r['id'],
        'id_manager': r['id_manager'],
        'es_global': r['id_manager'] is None,
        'nombre': r['nombre'],
        'horas_anuales': r['horas_anuales'],
        'horas_semana': float(r['horas_semana']) if r['horas_semana'] is not None else None,
        'vacaciones_dias': r['vacaciones_dias'],
        'vacaciones_tipo': r.get('vacaciones_tipo') or 'naturales',
        'asuntos_propios_dias': r['asuntos_propios_dias'],
        'descanso_min_jornada_h': float(r['descanso_min_jornada_h']) if r['descanso_min_jornada_h'] is not None else None,
        'notas': r['notas'] or '',
        'activo': bool(r['activo']),
    }


@bp.route('/convenios', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_convenios():
    """Devuelve los convenios visibles para el manager: globales + propios."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, nombre, horas_anuales, horas_semana,
                   vacaciones_dias, vacaciones_tipo, asuntos_propios_dias,
                   descanso_min_jornada_h, notas, activo
              FROM convenio
             WHERE (id_manager IS NULL OR id_manager = %s)
               AND activo = TRUE
             ORDER BY (id_manager IS NULL) DESC, nombre
        """, (str(g.id_manager),))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'convenios': [_convenio_to_dict(r) for r in rows]})


# ═══════════════════════════════════════════════════════════════════════════
# ║  TRAINER EMPRESA                                                        ║
# ═══════════════════════════════════════════════════════════════════════════

def _empresa_to_dict(r):
    return {
        'id': r['id'],
        'id_manager': r['id_manager'],
        'id_trainer': r['id_trainer'],
        'razon_social': r['razon_social'] or '',
        'cif': r['cif'] or '',
        'direccion_fiscal': r['direccion_fiscal'] or '',
        'convenio_id': r['convenio_id'],
        'convenio_nombre': r.get('convenio_nombre'),
        'horas_anuales_override': r['horas_anuales_override'],
        'horas_semana_override': float(r['horas_semana_override']) if r['horas_semana_override'] is not None else None,
        'vacaciones_dias_override': r['vacaciones_dias_override'],
        'vacaciones_tipo_override': r.get('vacaciones_tipo_override'),
        'asuntos_propios_dias_override': r['asuntos_propios_dias_override'],
        'representante_legal': r['representante_legal'] or '',
        'fecha_acuerdo_representantes': r['fecha_acuerdo_representantes'].isoformat() if r['fecha_acuerdo_representantes'] else None,
        'notas': r['notas'] or '',
    }


@bp.route('/trainer-empresa', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_trainer_empresa():
    """Una fila por cada trainer del manager con datos de empresa."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT te.id, te.id_manager, te.id_trainer,
                   te.razon_social, te.cif, te.direccion_fiscal,
                   te.convenio_id, c.nombre AS convenio_nombre,
                   te.horas_anuales_override, te.horas_semana_override,
                   te.vacaciones_dias_override, te.vacaciones_tipo_override,
                   te.asuntos_propios_dias_override,
                   te.representante_legal, te.fecha_acuerdo_representantes, te.notas
              FROM trainer_empresa te
              LEFT JOIN convenio c ON c.id = te.convenio_id
             WHERE te.id_manager = %s
             ORDER BY te.id_trainer
        """, (str(g.id_manager),))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'empresas': [_empresa_to_dict(r) for r in rows]})


@bp.route('/trainer-empresa/<id_trainer>', methods=['GET'])
@auth_required
@require_feature('control_horario')
def get_trainer_empresa(id_trainer):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT te.id, te.id_manager, te.id_trainer,
                   te.razon_social, te.cif, te.direccion_fiscal,
                   te.convenio_id, c.nombre AS convenio_nombre,
                   te.horas_anuales_override, te.horas_semana_override,
                   te.vacaciones_dias_override, te.vacaciones_tipo_override,
                   te.asuntos_propios_dias_override,
                   te.representante_legal, te.fecha_acuerdo_representantes, te.notas
              FROM trainer_empresa te
              LEFT JOIN convenio c ON c.id = te.convenio_id
             WHERE te.id_manager = %s AND te.id_trainer = %s
        """, (str(g.id_manager), str(id_trainer)))
        r = cur.fetchone()
    if not r:
        return jsonify({'ok': True, 'empresa': None})
    return jsonify({'ok': True, 'empresa': _empresa_to_dict(r)})


def _opt_int(v):
    if v is None or v == '':
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _opt_num(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _opt_str(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


@bp.route('/trainer-empresa/<id_trainer>', methods=['PUT'])
@auth_required
@require_feature('control_horario')
def upsert_trainer_empresa(id_trainer):
    d = request.get_json() or {}
    razon_social = _opt_str(d.get('razon_social'))
    cif = _opt_str(d.get('cif'))
    direccion = _opt_str(d.get('direccion_fiscal'))
    convenio_id = _opt_int(d.get('convenio_id'))
    horas_anuales_ov = _opt_int(d.get('horas_anuales_override'))
    horas_semana_ov = _opt_num(d.get('horas_semana_override'))
    vacaciones_ov = _opt_int(d.get('vacaciones_dias_override'))
    vac_tipo_ov = _opt_str(d.get('vacaciones_tipo_override'))
    if vac_tipo_ov and vac_tipo_ov not in ('naturales', 'laborales'):
        return jsonify({'ok': False, 'error': 'vacaciones_tipo_override_invalido'}), 400
    asuntos_ov = _opt_int(d.get('asuntos_propios_dias_override'))
    repr_legal = _opt_str(d.get('representante_legal'))
    fecha_acuerdo = _opt_str(d.get('fecha_acuerdo_representantes'))
    notas = _opt_str(d.get('notas'))

    # Validar convenio_id (debe ser global o del manager)
    if convenio_id is not None:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM convenio
                 WHERE id = %s AND (id_manager IS NULL OR id_manager = %s)
            """, (convenio_id, str(g.id_manager)))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'convenio_invalido'}), 400

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO trainer_empresa
              (id_manager, id_trainer, razon_social, cif, direccion_fiscal,
               convenio_id, horas_anuales_override, horas_semana_override,
               vacaciones_dias_override, vacaciones_tipo_override,
               asuntos_propios_dias_override,
               representante_legal, fecha_acuerdo_representantes, notas)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id_manager, id_trainer) DO UPDATE SET
              razon_social                  = EXCLUDED.razon_social,
              cif                           = EXCLUDED.cif,
              direccion_fiscal              = EXCLUDED.direccion_fiscal,
              convenio_id                   = EXCLUDED.convenio_id,
              horas_anuales_override        = EXCLUDED.horas_anuales_override,
              horas_semana_override         = EXCLUDED.horas_semana_override,
              vacaciones_dias_override      = EXCLUDED.vacaciones_dias_override,
              vacaciones_tipo_override      = EXCLUDED.vacaciones_tipo_override,
              asuntos_propios_dias_override = EXCLUDED.asuntos_propios_dias_override,
              representante_legal           = EXCLUDED.representante_legal,
              fecha_acuerdo_representantes  = EXCLUDED.fecha_acuerdo_representantes,
              notas                         = EXCLUDED.notas,
              updated_at                    = NOW()
            RETURNING id
        """, (str(g.id_manager), str(id_trainer), razon_social, cif, direccion,
              convenio_id, horas_anuales_ov, horas_semana_ov, vacaciones_ov, vac_tipo_ov,
              asuntos_ov, repr_legal, fecha_acuerdo, notas))
        row = cur.fetchone()
        # Re-leer con join al convenio para devolver el nombre.
        cur.execute("""
            SELECT te.id, te.id_manager, te.id_trainer,
                   te.razon_social, te.cif, te.direccion_fiscal,
                   te.convenio_id, c.nombre AS convenio_nombre,
                   te.horas_anuales_override, te.horas_semana_override,
                   te.vacaciones_dias_override, te.vacaciones_tipo_override,
                   te.asuntos_propios_dias_override,
                   te.representante_legal, te.fecha_acuerdo_representantes, te.notas
              FROM trainer_empresa te
              LEFT JOIN convenio c ON c.id = te.convenio_id
             WHERE te.id = %s
        """, (row['id'],))
        row = cur.fetchone()
    log_action(actor_from_request(), entidad='trainer_empresa',
               entidad_id=row['id'], accion='upsert',
               resumen=f'trainer={id_trainer} razon_social={razon_social or ""}')
    return jsonify({'ok': True, 'empresa': _empresa_to_dict(row)})


# ═══════════════════════════════════════════════════════════════════════════
# ║  MOTIVOS DE PAUSA                                                       ║
# ═══════════════════════════════════════════════════════════════════════════

def _motivo_to_dict(r):
    return {
        'id': r['id'],
        'id_manager': r['id_manager'],
        'es_global': r['id_manager'] is None,
        'codigo': r['codigo'],
        'etiqueta': r['etiqueta'],
        'computa_jornada': bool(r['computa_jornada']),
        'requiere_justificante': bool(r['requiere_justificante']),
        'orden': r['orden'],
        'activo': bool(r['activo']),
    }


@bp.route('/pausa-motivos', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_pausa_motivos():
    """Devuelve la lista efectiva: globales + overrides del manager.

    Si el manager tiene un motivo con `codigo` igual a uno global y
    `activo=FALSE`, se considera que ha desactivado ese global y NO
    aparece. Si tiene uno con código no global, se añade.
    """
    with get_conn() as conn, conn.cursor() as cur:
        # Globales
        cur.execute("""
            SELECT id, id_manager, codigo, etiqueta, computa_jornada,
                   requiere_justificante, orden, activo
              FROM pausa_motivo
             WHERE id_manager IS NULL
        """)
        globales = cur.fetchall()
        # Del manager
        cur.execute("""
            SELECT id, id_manager, codigo, etiqueta, computa_jornada,
                   requiere_justificante, orden, activo
              FROM pausa_motivo
             WHERE id_manager = %s
        """, (str(g.id_manager),))
        propios = cur.fetchall()

    propios_by_codigo = {p['codigo']: p for p in propios}
    efectivos = []
    for gl in globales:
        ov = propios_by_codigo.pop(gl['codigo'], None)
        if ov and not ov['activo']:
            continue  # desactivado por el manager
        if ov:
            efectivos.append(ov)
        elif gl['activo']:
            efectivos.append(gl)
    # Motivos del manager con código nuevo
    for p in propios_by_codigo.values():
        if p['activo']:
            efectivos.append(p)
    efectivos.sort(key=lambda r: (r['orden'] or 0, r['etiqueta']))
    return jsonify({'ok': True, 'motivos': [_motivo_to_dict(r) for r in efectivos]})


@bp.route('/pausa-motivos', methods=['POST'])
@auth_required
@require_feature('control_horario')
def crear_pausa_motivo():
    d = request.get_json() or {}
    codigo = _opt_str(d.get('codigo'))
    etiqueta = _opt_str(d.get('etiqueta'))
    if not codigo or not etiqueta:
        return jsonify({'ok': False, 'error': 'codigo_y_etiqueta_requeridos'}), 400
    codigo = codigo.lower()
    computa = bool(d.get('computa_jornada'))
    just = bool(d.get('requiere_justificante'))
    orden = int(d.get('orden') or 50)
    activo = bool(d.get('activo', True))
    with get_conn() as conn, conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO pausa_motivo
                  (id_manager, codigo, etiqueta, computa_jornada,
                   requiere_justificante, orden, activo)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                RETURNING id, id_manager, codigo, etiqueta, computa_jornada,
                          requiere_justificante, orden, activo
            """, (str(g.id_manager), codigo, etiqueta, computa, just, orden, activo))
            row = cur.fetchone()
        except Exception as e:
            log.warning(f'crear pausa_motivo: {e}')
            return jsonify({'ok': False, 'error': 'conflicto_o_invalido'}), 400
    log_action(actor_from_request(), entidad='pausa_motivo',
               entidad_id=row['id'], accion='crear', resumen=etiqueta)
    return jsonify({'ok': True, 'motivo': _motivo_to_dict(row)})


@bp.route('/pausa-motivos/<int:motivo_id>', methods=['PATCH'])
@auth_required
@require_feature('control_horario')
def actualizar_pausa_motivo(motivo_id):
    d = request.get_json() or {}
    sets, params = [], []
    if 'etiqueta' in d:
        sets.append('etiqueta = %s'); params.append((d['etiqueta'] or '').strip())
    if 'computa_jornada' in d:
        sets.append('computa_jornada = %s'); params.append(bool(d['computa_jornada']))
    if 'requiere_justificante' in d:
        sets.append('requiere_justificante = %s'); params.append(bool(d['requiere_justificante']))
    if 'orden' in d:
        sets.append('orden = %s'); params.append(int(d['orden'] or 0))
    if 'activo' in d:
        sets.append('activo = %s'); params.append(bool(d['activo']))
    if not sets:
        return jsonify({'ok': False, 'error': 'sin_cambios'}), 400
    params.extend([motivo_id, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE pausa_motivo SET {', '.join(sets)}
             WHERE id = %s AND id_manager = %s
            RETURNING id, id_manager, codigo, etiqueta, computa_jornada,
                      requiere_justificante, orden, activo
        """, params)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found_o_global'}), 404
    log_action(actor_from_request(), entidad='pausa_motivo',
               entidad_id=motivo_id, accion='editar', resumen=row['etiqueta'])
    return jsonify({'ok': True, 'motivo': _motivo_to_dict(row)})


@bp.route('/pausa-motivos/<int:motivo_id>', methods=['DELETE'])
@auth_required
@require_feature('control_horario')
def borrar_pausa_motivo(motivo_id):
    """Solo permite eliminar motivos del manager. Los globales no se
    pueden borrar — para "ocultarlos" se crea un override con
    `activo=FALSE`."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            DELETE FROM pausa_motivo
             WHERE id = %s AND id_manager = %s
        """, (motivo_id, str(g.id_manager)))
        if cur.rowcount == 0:
            return jsonify({'ok': False, 'error': 'not_found_o_global'}), 404
    log_action(actor_from_request(), entidad='pausa_motivo',
               entidad_id=motivo_id, accion='borrar', resumen='')
    return jsonify({'ok': True})


# ═══════════════════════════════════════════════════════════════════════════
# ║  TRABAJADORES                                                           ║
# ═══════════════════════════════════════════════════════════════════════════

def _trabajador_to_dict(r):
    return {
        'id': r['id'],
        'id_manager': r['id_manager'],
        'cliente_idnoofit': r['cliente_idnoofit'],
        'id_trainer_empleador': r['id_trainer_empleador'],
        'nif': r['nif'] or '',
        'nombre_completo': r['nombre_completo'] or '',
        'email': r['email'] or '',
        'jornada_h_semana': float(r['jornada_h_semana']) if r['jornada_h_semana'] is not None else None,
        'categoria_profesional': r['categoria_profesional'] or '',
        'tipo_contrato': r['tipo_contrato'] or '',
        'fecha_alta_laboral': r['fecha_alta_laboral'].isoformat() if r['fecha_alta_laboral'] else None,
        'fecha_baja_laboral': r['fecha_baja_laboral'].isoformat() if r['fecha_baja_laboral'] else None,
        'vacaciones_dias_override': r['vacaciones_dias_override'],
        'asuntos_propios_dias_override': r['asuntos_propios_dias_override'],
        'estado': r['estado'],
        'notas': r['notas'] or '',
    }


@bp.route('/trabajadores', methods=['GET'])
@auth_required
@require_feature('control_horario')
def listar_trabajadores():
    """Lista trabajadores del manager. Filtros: estado, trainer_empleador."""
    estado = (request.args.get('estado') or '').strip()
    trainer = (request.args.get('trainer') or '').strip()
    incluir_bajas = (request.args.get('incluir_bajas') or '').lower() in ('1', 'true', 'yes')
    sql = """
        SELECT id, id_manager, cliente_idnoofit, id_trainer_empleador, nif,
               nombre_completo, email, jornada_h_semana, categoria_profesional,
               tipo_contrato, fecha_alta_laboral, fecha_baja_laboral,
               vacaciones_dias_override, asuntos_propios_dias_override,
               estado, notas
          FROM trabajador
         WHERE id_manager = %s
    """
    params = [str(g.id_manager)]
    if estado in ('pendiente_alta', 'activo', 'baja'):
        sql += " AND estado = %s"
        params.append(estado)
    elif not incluir_bajas:
        sql += " AND estado <> 'baja'"
    if trainer:
        sql += " AND id_trainer_empleador = %s"
        params.append(trainer)
    sql += " ORDER BY nombre_completo, id"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return jsonify({'ok': True, 'trabajadores': [_trabajador_to_dict(r) for r in rows]})


@bp.route('/trabajadores/pendientes', methods=['GET'])
@auth_required
@require_feature('control_horario')
def trabajadores_pendientes():
    """Solicitudes de alta pendientes de autorización + (compat) clientes
    NoofitPro con categoría Trabajador que aún no han solicitado.

    Devuelve la unión:
      - trabajador.estado IN ('pendiente_autorizacion','pendiente_alta')
        → tienen solicitud y/o datos previos
      - clientes con categoría Trabajador en NF sin fila trabajador
        → todavía no solicitaron desde mynoofit/portal (informativo)
    """
    placeholders = ','.join(['%s'] * len(TRABAJADOR_CATEGORIAS))
    sql = f"""
        SELECT cc.cliente_idnoofit,
               cli.name        AS nombre,
               cli.surname     AS apellidos,
               cli.email       AS email,
               cli.id_trainer  AS id_trainer_actual,
               cat.nombre      AS categoria_nombre,
               t.id            AS trabajador_id,
               t.estado        AS trabajador_estado,
               t.nif, t.jornada_h_semana, t.id_trainer_empleador,
               t.fecha_alta_laboral, t.solicitud_motivo, t.created_at AS solicitud_at
          FROM cliente_categoria cc
          JOIN categoria cat
            ON cat.id = cc.categoria_id AND cat.id_manager = cc.id_manager
          LEFT JOIN cliente_cache cli
            ON cli.id_manager = cc.id_manager
           AND cli.id::TEXT   = cc.cliente_idnoofit
          LEFT JOIN trabajador t
            ON t.id_manager       = cc.id_manager
           AND t.cliente_idnoofit = cc.cliente_idnoofit
         WHERE cc.id_manager = %s
           AND cat.nombre IN ({placeholders})
           AND (t.id IS NULL
                OR t.estado IN ('pendiente_autorizacion','pendiente_alta'))
         ORDER BY (t.id IS NOT NULL) DESC, t.created_at DESC NULLS LAST,
                  cli.surname, cli.name
    """
    params = [str(g.id_manager), *TRABAJADOR_CATEGORIAS]
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    out = []
    for r in rows:
        nombre = (r['nombre'] or '').strip()
        apell = (r['apellidos'] or '').strip()
        full = f"{nombre} {apell}".strip()
        out.append({
            'cliente_idnoofit': r['cliente_idnoofit'],
            'nombre': nombre,
            'apellidos': apell,
            'nombre_completo': full or r['cliente_idnoofit'],
            'email': r['email'] or '',
            'id_trainer_actual': str(r['id_trainer_actual']) if r['id_trainer_actual'] is not None else None,
            'categoria_nombre': r['categoria_nombre'],
            'trabajador_id': r['trabajador_id'],
            'trabajador_estado': r['trabajador_estado'],
            # Datos enviados por el trabajador en su solicitud (cuando aplica):
            'nif': r['nif'] or '',
            'jornada_h_semana': float(r['jornada_h_semana']) if r['jornada_h_semana'] is not None else None,
            'id_trainer_empleador': r['id_trainer_empleador'],
            'fecha_alta_laboral': r['fecha_alta_laboral'].isoformat() if r['fecha_alta_laboral'] else None,
            'solicitud_motivo': r['solicitud_motivo'] or '',
            'solicitud_at': r['solicitud_at'].isoformat() if r['solicitud_at'] else None,
            'tipo': 'solicitud' if r['trabajador_id'] else 'sin_solicitud',
        })
    return jsonify({'ok': True, 'pendientes': out})


@bp.route('/trabajadores', methods=['POST'])
@auth_required
@require_feature('control_horario')
def alta_trabajador():
    """Alta laboral del trabajador (transición pendiente_alta → activo).

    Obligatorios para activar: nif, jornada_h_semana, id_trainer_empleador.
    Si la fila ya existe (cliente_idnoofit ya alta previa, ej. tras baja),
    la reactivamos. Si no, la creamos.
    """
    d = request.get_json() or {}
    cli = _opt_str(d.get('cliente_idnoofit'))
    nif = _opt_str(d.get('nif'))
    jornada = _opt_num(d.get('jornada_h_semana'))
    trainer = _opt_str(d.get('id_trainer_empleador'))
    if not cli or not nif or jornada is None or not trainer:
        return jsonify({
            'ok': False, 'error': 'campos_requeridos',
            'detalle': 'cliente_idnoofit, nif, jornada_h_semana e id_trainer_empleador son obligatorios',
        }), 400

    nombre = _opt_str(d.get('nombre_completo'))
    email = _opt_str(d.get('email'))
    cat_prof = _opt_str(d.get('categoria_profesional'))
    tipo_ct = _opt_str(d.get('tipo_contrato'))
    fecha_alta = _opt_str(d.get('fecha_alta_laboral'))
    vac_ov = _opt_int(d.get('vacaciones_dias_override'))
    asu_ov = _opt_int(d.get('asuntos_propios_dias_override'))
    notas = _opt_str(d.get('notas'))

    with get_conn() as conn, conn.cursor() as cur:
        # Si no nos llega nombre_completo/email, los sacamos de cliente_cache
        # para tener un snapshot razonable para los informes.
        if not nombre or not email:
            cur.execute("""
                SELECT name, surname, email FROM cliente_cache
                 WHERE id_manager = %s AND id::TEXT = %s
            """, (str(g.id_manager), cli))
            cache = cur.fetchone()
            if cache:
                if not nombre:
                    nombre = (f"{cache['name'] or ''} {cache['surname'] or ''}").strip() or None
                if not email:
                    email = cache['email'] or None

        cur.execute("""
            INSERT INTO trabajador
              (id_manager, cliente_idnoofit, id_trainer_empleador, nif,
               nombre_completo, email, jornada_h_semana, categoria_profesional,
               tipo_contrato, fecha_alta_laboral,
               vacaciones_dias_override, asuntos_propios_dias_override,
               estado, notas)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,COALESCE(%s, CURRENT_DATE),%s,%s,'activo',%s)
            ON CONFLICT (id_manager, cliente_idnoofit) DO UPDATE SET
              id_trainer_empleador          = EXCLUDED.id_trainer_empleador,
              nif                           = EXCLUDED.nif,
              nombre_completo               = COALESCE(EXCLUDED.nombre_completo, trabajador.nombre_completo),
              email                         = COALESCE(EXCLUDED.email, trabajador.email),
              jornada_h_semana              = EXCLUDED.jornada_h_semana,
              categoria_profesional         = EXCLUDED.categoria_profesional,
              tipo_contrato                 = EXCLUDED.tipo_contrato,
              fecha_alta_laboral            = COALESCE(EXCLUDED.fecha_alta_laboral, trabajador.fecha_alta_laboral),
              fecha_baja_laboral            = NULL,
              vacaciones_dias_override      = EXCLUDED.vacaciones_dias_override,
              asuntos_propios_dias_override = EXCLUDED.asuntos_propios_dias_override,
              estado                        = 'activo',
              notas                         = COALESCE(EXCLUDED.notas, trabajador.notas),
              updated_at                    = NOW()
            RETURNING id, id_manager, cliente_idnoofit, id_trainer_empleador,
                      nif, nombre_completo, email, jornada_h_semana,
                      categoria_profesional, tipo_contrato, fecha_alta_laboral,
                      fecha_baja_laboral, vacaciones_dias_override,
                      asuntos_propios_dias_override, estado, notas
        """, (str(g.id_manager), cli, trainer, nif, nombre, email,
              jornada, cat_prof, tipo_ct, fecha_alta, vac_ov, asu_ov, notas))
        row = cur.fetchone()

        # Asegura un vínculo trabajador_trainer con el empleador (idempotente).
        cur.execute("""
            INSERT INTO trabajador_trainer
              (trabajador_id, id_manager, id_trainer, fecha_inicio)
            VALUES (%s, %s, %s, CURRENT_DATE)
            ON CONFLICT (trabajador_id, id_trainer, fecha_inicio) DO NOTHING
        """, (row['id'], str(g.id_manager), trainer))

    log_action(actor_from_request(), entidad='trabajador',
               entidad_id=row['id'], accion='alta_laboral',
               resumen=f'cli={cli} trainer={trainer} nif={nif}')
    return jsonify({'ok': True, 'trabajador': _trabajador_to_dict(row)})


@bp.route('/trabajadores/<int:trab_id>', methods=['GET'])
@auth_required
@require_feature('control_horario')
def get_trabajador(trab_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, cliente_idnoofit, id_trainer_empleador, nif,
                   nombre_completo, email, jornada_h_semana, categoria_profesional,
                   tipo_contrato, fecha_alta_laboral, fecha_baja_laboral,
                   vacaciones_dias_override, asuntos_propios_dias_override,
                   estado, notas
              FROM trabajador
             WHERE id = %s AND id_manager = %s
        """, (trab_id, str(g.id_manager)))
        row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        cur.execute("""
            SELECT id, id_trainer, fecha_inicio, fecha_fin
              FROM trabajador_trainer
             WHERE trabajador_id = %s AND id_manager = %s
             ORDER BY fecha_inicio DESC
        """, (trab_id, str(g.id_manager)))
        vinculos = cur.fetchall()
    out = _trabajador_to_dict(row)
    out['trainers'] = [{
        'id': v['id'],
        'id_trainer': v['id_trainer'],
        'fecha_inicio': v['fecha_inicio'].isoformat() if v['fecha_inicio'] else None,
        'fecha_fin': v['fecha_fin'].isoformat() if v['fecha_fin'] else None,
    } for v in vinculos]
    return jsonify({'ok': True, 'trabajador': out})


_TRABAJADOR_EDITABLE = (
    # (column, key_in_body, conversor)
    ('id_trainer_empleador',           'id_trainer_empleador',           _opt_str),
    ('nif',                            'nif',                            _opt_str),
    ('nombre_completo',                'nombre_completo',                _opt_str),
    ('email',                          'email',                          _opt_str),
    ('jornada_h_semana',               'jornada_h_semana',               _opt_num),
    ('categoria_profesional',          'categoria_profesional',          _opt_str),
    ('tipo_contrato',                  'tipo_contrato',                  _opt_str),
    ('fecha_alta_laboral',             'fecha_alta_laboral',             _opt_str),
    ('vacaciones_dias_override',       'vacaciones_dias_override',       _opt_int),
    ('asuntos_propios_dias_override',  'asuntos_propios_dias_override',  _opt_int),
    ('notas',                          'notas',                          _opt_str),
)


def _trabajador_snapshot(row):
    """Subset de campos que entran en el diff de auditoría."""
    if not row:
        return None
    out = {}
    for col, _, _conv in _TRABAJADOR_EDITABLE:
        v = row.get(col) if hasattr(row, 'get') else row[col]
        # Normalizamos tipos para que el diff no marque cambios cosméticos
        # (Decimal vs float, date vs string, …).
        if v is None:
            out[col] = None
        elif hasattr(v, 'isoformat'):
            out[col] = v.isoformat()
        else:
            try:
                out[col] = float(v) if isinstance(v, (int, float)) or str(v).replace('.', '', 1).replace('-', '', 1).isdigit() else str(v)
            except Exception:
                out[col] = str(v)
    return out


@bp.route('/trabajadores/<int:trab_id>', methods=['PATCH'])
@auth_required
@require_feature('control_horario')
def actualizar_trabajador(trab_id):
    d = request.get_json() or {}
    sets, params = [], []
    for col, key, conv in _TRABAJADOR_EDITABLE:
        if key in d:
            sets.append(f'{col} = %s'); params.append(conv(d[key]))
    if not sets:
        return jsonify({'ok': False, 'error': 'sin_cambios'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        # Snapshot ANTES del UPDATE para el diff de auditoría.
        cur.execute("""
            SELECT id, id_manager, cliente_idnoofit, id_trainer_empleador,
                   nif, nombre_completo, email, jornada_h_semana,
                   categoria_profesional, tipo_contrato, fecha_alta_laboral,
                   fecha_baja_laboral, vacaciones_dias_override,
                   asuntos_propios_dias_override, estado, notas
              FROM trabajador
             WHERE id = %s AND id_manager = %s
        """, (trab_id, str(g.id_manager)))
        before = cur.fetchone()
        if not before:
            return jsonify({'ok': False, 'error': 'not_found'}), 404

        params.extend([trab_id, str(g.id_manager)])
        cur.execute(f"""
            UPDATE trabajador SET {', '.join(sets)}, updated_at = NOW()
             WHERE id = %s AND id_manager = %s
            RETURNING id, id_manager, cliente_idnoofit, id_trainer_empleador,
                      nif, nombre_completo, email, jornada_h_semana,
                      categoria_profesional, tipo_contrato, fecha_alta_laboral,
                      fecha_baja_laboral, vacaciones_dias_override,
                      asuntos_propios_dias_override, estado, notas
        """, params)
        after = cur.fetchone()

    cambios = diff_dict(_trabajador_snapshot(before), _trabajador_snapshot(after))
    if cambios:
        resumen = ', '.join(sorted(cambios.keys()))[:240]
        log_action(actor_from_request(), entidad='trabajador',
                   entidad_id=trab_id, accion='editar',
                   resumen=f'cambios: {resumen}',
                   cambios=cambios)
    return jsonify({'ok': True, 'trabajador': _trabajador_to_dict(after)})


@bp.route('/trabajadores/<int:trab_id>/historial', methods=['GET'])
@auth_required
@require_feature('control_horario')
def historial_trabajador(trab_id):
    """Devuelve la timeline de acciones registradas para este trabajador.

    Lee `accion_log` filtrando por entidad='trabajador' y entidad_id=<id>.
    Acciones típicas: alta_laboral, editar, baja, reactivar, autorizar, rechazar.
    """
    # Comprobamos primero que el trabajador pertenece al manager actual.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM trabajador WHERE id=%s AND id_manager=%s",
                    (trab_id, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404

        cur.execute("""
            SELECT id, ts, actor_kind, actor_label, actor_email,
                   accion, resumen, cambios
              FROM accion_log
             WHERE entidad = 'trabajador'
               AND entidad_id = %s
               AND id_manager = %s
             ORDER BY ts DESC
             LIMIT 200
        """, (str(trab_id), str(g.id_manager)))
        rows = cur.fetchall()
    return jsonify({
        'ok': True,
        'historial': [{
            'id': r['id'],
            'ts': r['ts'].isoformat() if r['ts'] else None,
            'actor': r['actor_label'] or r['actor_email'] or r['actor_kind'] or '?',
            'actor_kind': r['actor_kind'],
            'accion': r['accion'],
            'resumen': r['resumen'] or '',
            'cambios': r['cambios'],
        } for r in rows],
    })


@bp.route('/trabajadores/<int:trab_id>/autorizar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def autorizar_trabajador(trab_id):
    """Autoriza una solicitud pendiente del trabajador. Acepta sobrescritura
    de datos (NIF, jornada, trainer) por si el admin quiere ajustar lo
    que envió el trabajador.

    Body opcional: { nif, jornada_h_semana, id_trainer_empleador,
                     fecha_alta_laboral, categoria_profesional, tipo_contrato,
                     notas }
    """
    d = request.get_json() or {}
    sets = ["estado = 'activo'",
            'resuelto_at = NOW()',
            'rechazo_motivo = NULL',
            'fecha_baja_laboral = NULL',
            f'autorizado_por_usuario_id = %s']
    params = [_autor_admin_id_horario()]
    for col, key, conv in (
        ('nif',                  'nif',                  _opt_str),
        ('jornada_h_semana',     'jornada_h_semana',     _opt_num),
        ('id_trainer_empleador', 'id_trainer_empleador', _opt_str),
        ('fecha_alta_laboral',   'fecha_alta_laboral',   _opt_str),
        ('categoria_profesional','categoria_profesional',_opt_str),
        ('tipo_contrato',        'tipo_contrato',        _opt_str),
        ('notas',                'notas',                _opt_str),
    ):
        if key in d:
            sets.append(f'{col} = %s'); params.append(conv(d[key]))
    # Si no hay fecha_alta_laboral en BD ni en el body, ponemos hoy
    sets.append("fecha_alta_laboral = COALESCE(fecha_alta_laboral, CURRENT_DATE)")
    params.extend([trab_id, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE trabajador SET {', '.join(sets)}, updated_at = NOW()
             WHERE id = %s AND id_manager = %s
               AND estado IN ('pendiente_autorizacion','pendiente_alta','rechazada')
            RETURNING id, estado
        """, params)
        row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found_o_no_pendiente'}), 404
        # Asegurar vinculo trabajador_trainer al empleador
        cur.execute("""
            SELECT id_trainer_empleador FROM trabajador WHERE id = %s
        """, (trab_id,))
        tr = cur.fetchone()
        if tr and tr['id_trainer_empleador']:
            cur.execute("""
                INSERT INTO trabajador_trainer
                  (trabajador_id, id_manager, id_trainer, fecha_inicio)
                VALUES (%s, %s, %s, CURRENT_DATE)
                ON CONFLICT (trabajador_id, id_trainer, fecha_inicio) DO NOTHING
            """, (trab_id, str(g.id_manager), tr['id_trainer_empleador']))
    log_action(actor_from_request(), entidad='trabajador',
               entidad_id=trab_id, accion='autorizar', resumen='')
    return jsonify({'ok': True})


@bp.route('/trabajadores/<int:trab_id>/rechazar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def rechazar_trabajador(trab_id):
    """Rechaza una solicitud pendiente. El trabajador puede volver a solicitar."""
    d = request.get_json() or {}
    motivo = (d.get('motivo') or '').strip() or None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE trabajador
               SET estado = 'rechazada',
                   rechazo_motivo = %s,
                   resuelto_at = NOW(),
                   autorizado_por_usuario_id = %s,
                   updated_at = NOW()
             WHERE id = %s AND id_manager = %s
               AND estado IN ('pendiente_autorizacion','pendiente_alta')
            RETURNING id
        """, (motivo, _autor_admin_id_horario(), trab_id, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found_o_no_pendiente'}), 404
    log_action(actor_from_request(), entidad='trabajador',
               entidad_id=trab_id, accion='rechazar', resumen=motivo or '')
    return jsonify({'ok': True})


def _autor_admin_id_horario():
    u = getattr(g, 'usuario_web', None)
    return u['id'] if u else None


@bp.route('/trabajadores/<int:trab_id>/baja', methods=['POST'])
@auth_required
@require_feature('control_horario')
def baja_trabajador(trab_id):
    d = request.get_json() or {}
    fecha = _opt_str(d.get('fecha_baja_laboral'))
    motivo = _opt_str(d.get('motivo'))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE trabajador
               SET estado = 'baja',
                   fecha_baja_laboral = COALESCE(%s::DATE, CURRENT_DATE),
                   notas = COALESCE(notas || E'\\n', '') || COALESCE(%s, ''),
                   updated_at = NOW()
             WHERE id = %s AND id_manager = %s
            RETURNING id
        """, (fecha, motivo, trab_id, str(g.id_manager)))
        row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        # Cierra vínculos abiertos.
        cur.execute("""
            UPDATE trabajador_trainer
               SET fecha_fin = COALESCE(fecha_fin, COALESCE(%s::DATE, CURRENT_DATE))
             WHERE trabajador_id = %s AND id_manager = %s
        """, (fecha, trab_id, str(g.id_manager)))
    log_action(actor_from_request(), entidad='trabajador',
               entidad_id=trab_id, accion='baja',
               resumen=f'motivo={motivo or ""}')
    return jsonify({'ok': True})


@bp.route('/trabajadores/<int:trab_id>/reactivar', methods=['POST'])
@auth_required
@require_feature('control_horario')
def reactivar_trabajador(trab_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE trabajador
               SET estado = 'activo',
                   fecha_baja_laboral = NULL,
                   updated_at = NOW()
             WHERE id = %s AND id_manager = %s
            RETURNING id
        """, (trab_id, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='trabajador',
               entidad_id=trab_id, accion='reactivar', resumen='')
    return jsonify({'ok': True})


@bp.route('/trabajadores/<int:trab_id>/trainers', methods=['POST'])
@auth_required
@require_feature('control_horario')
def vincular_trainer(trab_id):
    """Añade un trainer adicional al trabajador (puede fichar también allí)."""
    d = request.get_json() or {}
    trainer = _opt_str(d.get('id_trainer'))
    fecha_ini = _opt_str(d.get('fecha_inicio'))
    if not trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_requerido'}), 400
    with get_conn() as conn, conn.cursor() as cur:
        # Verifica que el trabajador existe en el manager
        cur.execute("SELECT 1 FROM trabajador WHERE id=%s AND id_manager=%s",
                    (trab_id, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        try:
            cur.execute("""
                INSERT INTO trabajador_trainer
                  (trabajador_id, id_manager, id_trainer, fecha_inicio)
                VALUES (%s, %s, %s, COALESCE(%s::DATE, CURRENT_DATE))
                RETURNING id, id_trainer, fecha_inicio, fecha_fin
            """, (trab_id, str(g.id_manager), trainer, fecha_ini))
            row = cur.fetchone()
        except Exception as e:
            log.warning(f'vincular_trainer: {e}')
            return jsonify({'ok': False, 'error': 'ya_vinculado_o_invalido'}), 400
    log_action(actor_from_request(), entidad='trabajador_trainer',
               entidad_id=row['id'], accion='vincular',
               resumen=f'trab={trab_id} trainer={trainer}')
    return jsonify({'ok': True, 'vinculo': {
        'id': row['id'], 'id_trainer': row['id_trainer'],
        'fecha_inicio': row['fecha_inicio'].isoformat() if row['fecha_inicio'] else None,
        'fecha_fin': row['fecha_fin'].isoformat() if row['fecha_fin'] else None,
    }})


@bp.route('/trabajadores/<int:trab_id>/trainers/<int:vinculo_id>', methods=['DELETE'])
@auth_required
@require_feature('control_horario')
def desvincular_trainer(trab_id, vinculo_id):
    """Cierra el vínculo (fecha_fin = hoy). NO borra para preservar histórico
    de fichajes en ese trainer.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE trabajador_trainer
               SET fecha_fin = COALESCE(fecha_fin, CURRENT_DATE)
             WHERE id = %s AND trabajador_id = %s AND id_manager = %s
            RETURNING id
        """, (vinculo_id, trab_id, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='trabajador_trainer',
               entidad_id=vinculo_id, accion='desvincular',
               resumen=f'trab={trab_id}')
    return jsonify({'ok': True})
