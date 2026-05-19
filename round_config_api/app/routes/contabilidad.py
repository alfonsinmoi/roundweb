"""Endpoints contabilidad — fase 1.

  GET    /api/contab/config                     → trainer_contab_config (toggle)
  PUT    /api/contab/config/<id_trainer>        → activar/desactivar control contable
  GET    /api/contab/config/listados            → visibilidad listados per trainer

  GET    /api/contab/categorias                 → catálogo manager (siembra si vacío)
  POST   /api/contab/categorias                 → crear categoría
  PATCH  /api/contab/categorias/<id>            → editar
  DELETE /api/contab/categorias/<id>            → desactivar (soft) o borrar
  PUT    /api/contab/categorias/<id>/visibilidad → set visibilidad per trainer

  GET    /api/contab/documentos                 → lista filtrable
  POST   /api/contab/documentos                 → upload (multipart) — crea borrador
  GET    /api/contab/documentos/<id>            → detalle
  GET    /api/contab/documentos/<id>/file       → stream del binario
  PATCH  /api/contab/documentos/<id>            → edit metadata
  POST   /api/contab/documentos/<id>/validar    → estado=validado (crea Odoo move en fase 2)
  POST   /api/contab/documentos/<id>/rechazar   → estado=rechazado
  DELETE /api/contab/documentos/<id>            → borra archivo + fila
"""
import os
import hashlib
import logging
import json
from pathlib import Path
from datetime import datetime, date
from flask import Blueprint, request, jsonify, g, send_file, abort
from werkzeug.utils import secure_filename
from ..auth import auth_required
from ..db import get_conn, seed_gasto_categorias_for_manager

bp = Blueprint('contabilidad', __name__)
log = logging.getLogger(__name__)

# Storage en disco VPS
STORAGE_BASE = Path(os.getenv('CONTAB_STORAGE', '/var/round/contabilidad'))
ALLOWED_EXT = {'.pdf', '.jpg', '.jpeg', '.png', '.csv', '.xls', '.xlsx', '.xml', '.txt'}
MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB


# Listados disponibles (enum hardcoded — espejo en frontend)
LISTADOS = [
    {'id': 'facturas',         'nombre': 'Listado de facturas'},
    {'id': 'totales_periodo',  'nombre': 'Totales por período / tipo / proveedor'},
    {'id': 'banco_sin_cuadrar','nombre': 'Movimientos banco sin cuadrar'},
    {'id': 'faltantes',        'nombre': 'Posibles facturas que faltan'},
    {'id': 'resultados',       'nombre': 'Cuenta de resultados'},
]


def _manager_only():
    if g.id_trainer:
        return jsonify({'ok': False, 'error': 'manager_only'}), 403
    return None


def _normalizar_vat(vat):
    """Normaliza CIF/NIF: mayúsculas, sin espacios, sin guiones, prefijo ES."""
    if not vat:
        return None
    s = str(vat).strip().upper().replace(' ', '').replace('-', '').replace('.', '')
    if not s:
        return None
    # Quitar prefijo "ES" si lo tiene (luego lo normalizamos sin él para comparar)
    if s.startswith('ES') and len(s) > 9:
        s = s[2:]
    return s


def _storage_path(id_manager, id_trainer, fecha, categoria_codigo, filename) -> Path:
    """Path determinístico bajo STORAGE_BASE."""
    año = (fecha or date.today()).strftime('%Y')
    trainer = id_trainer or 'manager'
    cat = categoria_codigo or 'sin_cat'
    safe = secure_filename(filename) or f'doc_{int(datetime.utcnow().timestamp())}.bin'
    base = STORAGE_BASE / str(id_manager) / str(trainer) / año / cat
    base.mkdir(parents=True, exist_ok=True)
    # Evitar colisiones: prefijo timestamp
    ts = datetime.utcnow().strftime('%Y%m%d%H%M%S')
    return base / f'{ts}_{safe}'


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            h.update(chunk)
    return h.hexdigest()


# ── Toggle contabilidad per trainer ────────────────────────────────────────

@bp.route('/config', methods=['GET'])
@auth_required
def get_contab_config():
    """Devuelve { trainers: [{id_trainer, activo, notas, ...}] } del manager."""
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_trainer, activo, notas, updated_at
                  FROM trainer_contab_config
                 WHERE id_manager=%s
                 ORDER BY id_trainer
            """, (g.id_manager,))
            rows = cur.fetchall()
        return jsonify({'ok': True, 'trainers': rows})
    except Exception as e:
        log.exception('get_contab_config')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/config/<id_trainer>', methods=['PUT'])
@auth_required
def put_contab_config(id_trainer):
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        activo = bool(d.get('activo', False))
        notas = d.get('notas')
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO trainer_contab_config (id_manager, id_trainer, activo, notas)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE
                  SET activo = EXCLUDED.activo,
                      notas  = COALESCE(EXCLUDED.notas, trainer_contab_config.notas)
                RETURNING *
            """, (g.id_manager, str(id_trainer), activo, notas))
            row = cur.fetchone()
        # Si activo=true y aún no hay categorías, sembramos defaults
        if activo:
            seed_gasto_categorias_for_manager(g.id_manager)
        return jsonify({'ok': True, 'config': row})
    except Exception as e:
        log.exception('put_contab_config')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/config/listados', methods=['GET'])
@auth_required
def get_listados_visibilidad():
    """Devuelve catálogo listados + visibilidad per (manager, trainer)."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_trainer, listado_id, visible
                  FROM gasto_listado_visibilidad
                 WHERE id_manager=%s
            """, (g.id_manager,))
            rows = cur.fetchall()
        # mapa: {trainer_id: {listado_id: visible}}
        by_trainer = {}
        for r in rows:
            by_trainer.setdefault(r['id_trainer'], {})[r['listado_id']] = r['visible']
        return jsonify({'ok': True, 'catalogo': LISTADOS, 'por_trainer': by_trainer})
    except Exception as e:
        log.exception('get_listados_visibilidad')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/config/listados/<id_trainer>/<listado_id>', methods=['PUT'])
@auth_required
def put_listado_visibilidad(id_trainer, listado_id):
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        visible = bool(d.get('visible', True))
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO gasto_listado_visibilidad (id_manager, id_trainer, listado_id, visible)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (id_manager, id_trainer, listado_id) DO UPDATE
                  SET visible = EXCLUDED.visible
                RETURNING *
            """, (g.id_manager, str(id_trainer), listado_id, visible))
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('put_listado_visibilidad')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Catálogo de categorías ─────────────────────────────────────────────────

@bp.route('/categorias', methods=['GET'])
@auth_required
def list_categorias():
    """Lista categorías + visibilidad per trainer (filtrada si trainer impersona)."""
    try:
        # Sembrar si vacío (idempotente)
        seed_gasto_categorias_for_manager(g.id_manager)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM gasto_categoria
                 WHERE id_manager=%s
                 ORDER BY orden ASC, nombre ASC
            """, (g.id_manager,))
            cats = cur.fetchall()
            cur.execute("""
                SELECT categoria_id, id_trainer, visible
                  FROM gasto_categoria_visibilidad
                 WHERE categoria_id IN (
                    SELECT id FROM gasto_categoria WHERE id_manager=%s
                 )
            """, (g.id_manager,))
            visibilidad = cur.fetchall()
        # Si trainer impersona, filtrar las que NO sean visibles para él
        if g.id_trainer:
            visibles_trainer = {v['categoria_id']: v['visible'] for v in visibilidad
                               if str(v['id_trainer']) == str(g.id_trainer)}
            cats = [c for c in cats if visibles_trainer.get(c['id'], True)]
        return jsonify({'ok': True, 'categorias': cats, 'visibilidad': visibilidad})
    except Exception as e:
        log.exception('list_categorias')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/categorias', methods=['POST'])
@auth_required
def create_categoria():
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        codigo = (d.get('codigo') or '').strip().lower()
        nombre = (d.get('nombre') or '').strip()
        if not codigo or not nombre:
            return jsonify({'ok': False, 'error': 'codigo_y_nombre_requeridos'}), 400
        tipo = d.get('tipo', 'gasto')
        if tipo not in ('gasto','nomina','banco','impuesto','otro'):
            return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO gasto_categoria
                  (id_manager, codigo, nombre, tipo, periodicidad,
                   proveedor_default, cuenta_contable_odoo, iva_default,
                   color, orden, activa)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id_manager, codigo) DO UPDATE SET
                  nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo,
                  periodicidad = EXCLUDED.periodicidad,
                  proveedor_default = EXCLUDED.proveedor_default,
                  cuenta_contable_odoo = EXCLUDED.cuenta_contable_odoo,
                  iva_default = EXCLUDED.iva_default,
                  color = EXCLUDED.color, orden = EXCLUDED.orden,
                  activa = EXCLUDED.activa
                RETURNING *
            """, (
                g.id_manager, codigo, nombre, tipo, d.get('periodicidad'),
                d.get('proveedor_default'), d.get('cuenta_contable_odoo'),
                d.get('iva_default'), d.get('color'), int(d.get('orden') or 100),
                bool(d.get('activa', True)),
            ))
            row = cur.fetchone()
        return jsonify({'ok': True, 'categoria': row})
    except Exception as e:
        log.exception('create_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/categorias/<int:cat_id>', methods=['PATCH'])
@auth_required
def update_categoria(cat_id):
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        allowed = ('nombre','tipo','periodicidad','proveedor_default',
                   'cuenta_contable_odoo','iva_default','color','orden','activa')
        sets, vals = [], []
        for k in allowed:
            if k in d:
                sets.append(f'{k} = %s'); vals.append(d[k])
        if not sets:
            return jsonify({'ok': False, 'error': 'no_fields'}), 400
        vals.extend([g.id_manager, cat_id])
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(f"""
                UPDATE gasto_categoria SET {', '.join(sets)}
                 WHERE id_manager=%s AND id=%s
                RETURNING *
            """, vals)
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        return jsonify({'ok': True, 'categoria': row})
    except Exception as e:
        log.exception('update_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/categorias/<int:cat_id>', methods=['DELETE'])
@auth_required
def delete_categoria(cat_id):
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            # Si tiene documentos, soft-delete (activa=false)
            cur.execute("SELECT COUNT(*) AS n FROM gasto_documento WHERE categoria_id=%s", (cat_id,))
            n = cur.fetchone()['n']
            if n > 0:
                cur.execute("""
                    UPDATE gasto_categoria SET activa=FALSE
                     WHERE id_manager=%s AND id=%s
                    RETURNING *
                """, (g.id_manager, cat_id))
                row = cur.fetchone()
                return jsonify({'ok': True, 'mode': 'deactivated', 'in_use': n, 'categoria': row})
            cur.execute("""
                DELETE FROM gasto_categoria
                 WHERE id_manager=%s AND id=%s
            """, (g.id_manager, cat_id))
            return jsonify({'ok': True, 'mode': 'hard', 'deleted': cur.rowcount})
    except Exception as e:
        log.exception('delete_categoria')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/categorias/<int:cat_id>/visibilidad/<id_trainer>', methods=['PUT'])
@auth_required
def put_categoria_visibilidad(cat_id, id_trainer):
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        visible = bool(d.get('visible', True))
        with get_conn() as conn, conn.cursor() as cur:
            # Verificar que la categoría es del manager
            cur.execute("SELECT 1 FROM gasto_categoria WHERE id=%s AND id_manager=%s",
                        (cat_id, g.id_manager))
            if not cur.fetchone():
                return jsonify({'ok': False, 'error': 'not_found'}), 404
            cur.execute("""
                INSERT INTO gasto_categoria_visibilidad (categoria_id, id_trainer, visible)
                VALUES (%s,%s,%s)
                ON CONFLICT (categoria_id, id_trainer) DO UPDATE SET visible = EXCLUDED.visible
                RETURNING *
            """, (cat_id, str(id_trainer), visible))
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('put_categoria_visibilidad')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Documentos: upload + lista + detalle ───────────────────────────────────

@bp.route('/documentos', methods=['GET'])
@auth_required
def list_documentos():
    """Filtros: estado, categoria_id, id_trainer, periodo, desde, hasta, tipo, q"""
    try:
        wheres = ['d.id_manager = %s']
        params = [g.id_manager]
        if g.id_trainer:
            wheres.append('d.id_trainer = %s')
            params.append(g.id_trainer)
        for k, col in [('estado','d.estado'), ('categoria_id','d.categoria_id'),
                       ('periodo','d.periodo'), ('id_trainer','d.id_trainer')]:
            v = request.args.get(k)
            if v:
                wheres.append(f'{col} = %s'); params.append(v)
        if request.args.get('desde'):
            wheres.append('d.fecha_documento >= %s'); params.append(request.args['desde'])
        if request.args.get('hasta'):
            wheres.append('d.fecha_documento <= %s'); params.append(request.args['hasta'])
        if request.args.get('q'):
            wheres.append('(d.proveedor ILIKE %s OR d.num_factura ILIKE %s OR d.concepto ILIKE %s)')
            qq = f"%{request.args['q']}%"
            params.extend([qq, qq, qq])
        sql = f"""
            SELECT d.id, d.id_trainer, d.categoria_id, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
                   d.proveedor, d.proveedor_vat, d.num_factura,
                   d.fecha_documento, d.fecha_recepcion, d.periodo,
                   d.importe_base, d.importe_iva, d.importe_total, d.iva_pct,
                   d.concepto, d.filename_original, d.mime_type, d.tamaño_bytes,
                   d.estado, d.odoo_move_id, d.odoo_move_state,
                   d.extraido_por_llm, d.confianza_llm,
                   d.created_by, d.validado_by, d.validado_at, d.created_at, d.updated_at
              FROM gasto_documento d
              LEFT JOIN gasto_categoria c ON c.id = d.categoria_id
             WHERE {' AND '.join(wheres)}
             ORDER BY d.fecha_documento DESC NULLS LAST, d.created_at DESC
             LIMIT 500
        """
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return jsonify({'ok': True, 'documentos': rows})
    except Exception as e:
        log.exception('list_documentos')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos', methods=['POST'])
@auth_required
def upload_documento():
    """Upload multipart/form-data: campo 'file' + form fields opcionales:
    categoria_id, id_trainer, proveedor, num_factura, fecha_documento,
    importe_base, importe_iva, importe_total, iva_pct, concepto, periodo,
    proveedor_vat, notas.
    """
    try:
        f = request.files.get('file')
        if not f or not f.filename:
            return jsonify({'ok': False, 'error': 'file_required'}), 400
        ext = Path(f.filename).suffix.lower()
        if ext not in ALLOWED_EXT:
            return jsonify({'ok': False, 'error': f'extension_no_permitida:{ext}'}), 400
        # Tamaño
        f.seek(0, os.SEEK_END); size = f.tell(); f.seek(0)
        if size > MAX_FILE_BYTES:
            return jsonify({'ok': False, 'error': f'fichero_muy_grande:{size}'}), 400

        form = request.form
        categoria_id = form.get('categoria_id', type=int)
        id_trainer = form.get('id_trainer') or g.id_trainer  # si trainer impersona, asignar a él

        # Resolver categoría → para path determinístico
        cat_codigo = 'sin_cat'
        if categoria_id:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("SELECT codigo FROM gasto_categoria WHERE id=%s AND id_manager=%s",
                            (categoria_id, g.id_manager))
                r = cur.fetchone()
                if r: cat_codigo = r['codigo']

        fecha_doc = None
        if form.get('fecha_documento'):
            try: fecha_doc = datetime.strptime(form['fecha_documento'], '%Y-%m-%d').date()
            except Exception: pass

        # Guardar archivo
        path = _storage_path(g.id_manager, id_trainer, fecha_doc, cat_codigo, f.filename)
        f.save(str(path))
        h = _hash_file(path)

        # Anti-duplicado por hash dentro del mismo manager.
        # Si ya existe lo devolvemos como `existing: True` con TODO el row,
        # así el frontend lo abre directamente en review en lugar de fallar.
        # Si el doc estaba en estado 'rechazado', lo revivimos a 'borrador'.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM gasto_documento
                 WHERE id_manager=%s AND hash_sha256=%s LIMIT 1
            """, (g.id_manager, h))
            existing = cur.fetchone()
        if existing:
            try: path.unlink()
            except Exception: pass
            revivido = False
            if existing['estado'] == 'rechazado':
                # Revivir: volver a borrador para que el user lo pueda editar/validar.
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        UPDATE gasto_documento
                           SET estado='borrador',
                               motivo_rechazo=NULL,
                               notas=COALESCE(notas,'') || %s
                         WHERE id_manager=%s AND id=%s
                        RETURNING *
                    """, (
                        f"\n[reactivado {datetime.now().isoformat()}] subido de nuevo el mismo archivo",
                        g.id_manager, existing['id'],
                    ))
                    existing = cur.fetchone()
                    revivido = True
            mensaje = (f'Documento ya existente (id={existing["id"]}, {existing["filename_original"]}). '
                       + ('Estaba RECHAZADO — lo he reactivado a borrador. ' if revivido else '')
                       + 'Se abre el original para que lo revises.')
            return jsonify({
                'ok': True,
                'existing': True,
                'revivido': revivido,
                'documento': existing,
                'mensaje': mensaje,
            })

        # Insertar fila
        def _num(k):
            v = form.get(k)
            if v in (None, '', 'null'): return None
            try: return float(v)
            except Exception: return None

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO gasto_documento (
                    id_manager, id_trainer, categoria_id,
                    proveedor, proveedor_vat, num_factura,
                    fecha_documento, fecha_recepcion, periodo,
                    importe_base, importe_iva, importe_total, iva_pct,
                    concepto, filename_original, storage_path,
                    mime_type, "tamaño_bytes", hash_sha256,
                    estado, notas, created_by
                ) VALUES (
                    %s,%s,%s,
                    %s,%s,%s,
                    %s,%s,%s,
                    %s,%s,%s,%s,
                    %s,%s,%s,
                    %s,%s,%s,
                    'borrador',%s,%s
                ) RETURNING *
            """, (
                g.id_manager, id_trainer, categoria_id,
                form.get('proveedor'), form.get('proveedor_vat'), form.get('num_factura'),
                fecha_doc, date.today(), form.get('periodo'),
                _num('importe_base'), _num('importe_iva'), _num('importe_total'), _num('iva_pct'),
                form.get('concepto'), f.filename, str(path),
                f.mimetype or 'application/octet-stream', size, h,
                form.get('notas'), getattr(g, 'created_by', None) or 'manager',
            ))
            row = cur.fetchone()
        log.info(f'gasto_documento.upload id={row["id"]} size={size} hash={h[:8]}…')
        return jsonify({'ok': True, 'documento': row})
    except Exception as e:
        log.exception('upload_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>', methods=['GET'])
@auth_required
def get_documento(doc_id):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM gasto_documento WHERE id=%s AND id_manager=%s",
                        (doc_id, g.id_manager))
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if g.id_trainer and row.get('id_trainer') and str(row['id_trainer']) != str(g.id_trainer):
            return jsonify({'ok': False, 'error': 'forbidden'}), 403
        # No exponer storage_path absoluto
        out = dict(row); out.pop('storage_path', None)
        return jsonify({'ok': True, 'documento': out})
    except Exception as e:
        log.exception('get_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>/file', methods=['GET'])
@auth_required
def get_documento_file(doc_id):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_trainer, storage_path, filename_original, mime_type
                  FROM gasto_documento WHERE id=%s AND id_manager=%s
            """, (doc_id, g.id_manager))
            row = cur.fetchone()
        if not row:
            return abort(404)
        if g.id_trainer and row.get('id_trainer') and str(row['id_trainer']) != str(g.id_trainer):
            return abort(403)
        path = Path(row['storage_path'])
        if not path.exists():
            return abort(410)  # gone
        return send_file(str(path), mimetype=row.get('mime_type'),
                         as_attachment=False, download_name=row.get('filename_original'))
    except Exception:
        log.exception('get_documento_file')
        return abort(500)


@bp.route('/documentos/<int:doc_id>', methods=['PATCH'])
@auth_required
def patch_documento(doc_id):
    try:
        d = request.get_json() or {}
        allowed = ('categoria_id','id_trainer','proveedor','proveedor_vat','num_factura',
                   'fecha_documento','periodo','importe_base','importe_iva',
                   'importe_total','iva_pct','concepto','notas')
        sets, vals = [], []
        for k in allowed:
            if k in d:
                sets.append(f'{k} = %s'); vals.append(d[k])
        if not sets:
            return jsonify({'ok': False, 'error': 'no_fields'}), 400
        vals.extend([doc_id, g.id_manager])
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(f"""
                UPDATE gasto_documento SET {', '.join(sets)}
                 WHERE id=%s AND id_manager=%s
                RETURNING *
            """, vals)
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        return jsonify({'ok': True, 'documento': row})
    except Exception as e:
        log.exception('patch_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>/escanear', methods=['POST'])
@auth_required
def escanear_documento(doc_id):
    """Llama al LLM para extraer campos del archivo y rellena el doc.

    Idempotente: se puede re-escanear varias veces. La extracción NO valida
    el doc — el user debe revisar los campos y luego /validar.

    Devuelve {ok, documento, extraction: {confidence, notes, …}}.
    """
    try:
        # Cargar doc + categorías del manager
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, storage_path, filename_original, categoria_id
                  FROM gasto_documento
                 WHERE id=%s AND id_manager=%s
            """, (doc_id, g.id_manager))
            doc = cur.fetchone()
            if not doc:
                return jsonify({'ok': False, 'error': 'not_found'}), 404
            cur.execute("""
                SELECT id, codigo, nombre, tipo, activa, iva_default, cuenta_contable_odoo
                  FROM gasto_categoria
                 WHERE id_manager=%s AND activa=TRUE
                 ORDER BY orden, nombre
            """, (g.id_manager,))
            cats = cur.fetchall()

        path = Path(doc['storage_path'])
        if not path.exists():
            return jsonify({'ok': False, 'error': 'archivo_perdido'}), 410

        from ..contab_extractor import extract_from_file
        ext = extract_from_file(path, list(cats))
        if ext.get('extraction_failed'):
            # Marcar como intentado pero sin pisar campos
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    UPDATE gasto_documento
                       SET llm_data = %s::jsonb,
                           extraido_por_llm = TRUE,
                           confianza_llm = 0
                     WHERE id=%s
                """, (json.dumps(ext, default=str), doc_id))
            return jsonify({
                'ok': False,
                'error': 'extraction_failed',
                'detalle': ext.get('error', 'unknown'),
                'raw': ext.get('raw'),
            }), 502

        # Mapear categoria_codigo_sugerida → categoria_id
        cat_codigo = (ext.get('categoria_codigo_sugerida') or '').strip().lower()
        cat_id = None
        if cat_codigo:
            cat_id = next((c['id'] for c in cats if c['codigo'] == cat_codigo), None)

        # Parsear fecha si viene
        fecha_doc = None
        try:
            if ext.get('fecha_documento'):
                fecha_doc = datetime.strptime(str(ext['fecha_documento']), '%Y-%m-%d').date()
        except Exception:
            pass

        def _f(v):
            if v is None: return None
            try: return float(v)
            except Exception: return None

        # ── Lógica subtipo + auto-asignación trainer ──
        subtipo = (ext.get('subtipo') or '').strip().lower() or None
        recip_vat = _normalizar_vat(ext.get('recipiente_vat'))
        recip_nombre = (ext.get('recipiente_nombre') or '').strip() or None

        # Cargar centros del manager con su CIF para matching
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_trainer, nombre_centro, cif, razon_social
                  FROM centro_contacto
                 WHERE id_manager=%s AND activo=TRUE
            """, (g.id_manager,))
            centros = cur.fetchall()
        centros_by_vat = {_normalizar_vat(c.get('cif')): c for c in centros if c.get('cif')}

        # Determinar id_trainer auto + flag requiere_autorizacion
        nuevo_trainer = None       # asignación automática propuesta
        requiere_auth = False      # avisar al user si hay mismatch
        warning_motivo = None

        if subtipo == 'ticket':
            # Ticket: gasto general, sin trainer asignado
            nuevo_trainer = None
            warning_motivo = 'ticket_sin_receptor'
        elif subtipo == 'factura' and recip_vat:
            # Factura: buscar trainer cuyo CIF coincida con el receptor
            match = centros_by_vat.get(recip_vat)
            if match:
                nuevo_trainer = match['id_trainer']
            else:
                # No hay match → la factura es para una empresa que no es ningún
                # trainer del manager. Avisar.
                nuevo_trainer = None
                requiere_auth = True
                warning_motivo = 'factura_cif_no_coincide'

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE gasto_documento
                   SET categoria_id     = COALESCE(categoria_id, %s),
                       proveedor        = COALESCE(NULLIF(proveedor,''), %s),
                       proveedor_vat    = COALESCE(NULLIF(proveedor_vat,''), %s),
                       num_factura      = COALESCE(NULLIF(num_factura,''), %s),
                       fecha_documento  = COALESCE(fecha_documento, %s),
                       periodo          = COALESCE(NULLIF(periodo,''), %s),
                       importe_base     = COALESCE(importe_base, %s),
                       importe_iva      = COALESCE(importe_iva, %s),
                       importe_total    = COALESCE(importe_total, %s),
                       iva_pct          = COALESCE(iva_pct, %s),
                       concepto         = COALESCE(NULLIF(concepto,''), %s),
                       subtipo          = COALESCE(subtipo, %s),
                       recipiente_nombre = COALESCE(NULLIF(recipiente_nombre,''), %s),
                       recipiente_vat   = COALESCE(NULLIF(recipiente_vat,''), %s),
                       id_trainer       = CASE WHEN id_trainer IS NULL THEN %s ELSE id_trainer END,
                       requiere_autorizacion = %s,
                       extraido_por_llm = TRUE,
                       confianza_llm    = %s,
                       llm_data         = %s::jsonb
                 WHERE id=%s AND id_manager=%s
                RETURNING *
            """, (
                cat_id,
                ext.get('proveedor'),
                ext.get('proveedor_vat'),
                ext.get('num_factura'),
                fecha_doc,
                ext.get('periodo'),
                _f(ext.get('importe_base')),
                _f(ext.get('importe_iva')),
                _f(ext.get('importe_total')),
                _f(ext.get('iva_pct')),
                ext.get('concepto'),
                subtipo,
                recip_nombre,
                recip_vat,
                nuevo_trainer,
                requiere_auth,
                float(ext.get('confidence') or 0),
                json.dumps(ext, default=str),
                doc_id, g.id_manager,
            ))
            row = cur.fetchone()

        # Construir warning humano
        warning = None
        if subtipo == 'ticket':
            warning = {
                'tipo': 'ticket_sin_receptor',
                'mensaje': 'Ticket sin receptor identificado. Se asigna a "Gastos generales" (sin trainer).',
                'severity': 'info',
            }
        elif subtipo == 'factura' and requiere_auth:
            warning = {
                'tipo': 'factura_cif_no_coincide',
                'mensaje': (f'Factura emitida a "{recip_nombre or "—"}" '
                            f'(CIF {recip_vat or "—"}). Ningún centro del manager '
                            f'tiene ese CIF. Necesita doble autorización para validar.'),
                'severity': 'warning',
                'recipiente_vat': recip_vat,
                'recipiente_nombre': recip_nombre,
                'centros_disponibles': [{'id_trainer': c['id_trainer'],
                                          'nombre_centro': c['nombre_centro'],
                                          'cif': c.get('cif')}
                                         for c in centros],
            }

        return jsonify({
            'ok': True,
            'documento': row,
            'extraction': {
                'confidence': ext.get('confidence'),
                'notes': ext.get('notes'),
                'tipo_documento': ext.get('tipo_documento'),
                'subtipo': subtipo,
                'categoria_codigo_sugerida': cat_codigo,
                'categoria_id_resuelta': cat_id,
                'recipiente_vat': recip_vat,
                'recipiente_nombre': recip_nombre,
                'trainer_auto_asignado': nuevo_trainer,
            },
            'warning': warning,
        })
    except Exception as e:
        log.exception('escanear_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>/validar', methods=['POST'])
@auth_required
def validar_documento(doc_id):
    """Marca como validado. Fase 2: crea account.move en Odoo.

    Si requiere_autorizacion=True, exige body {doble_auth: true} para
    proceder. Devuelve 409 si no llega.
    """
    try:
        d = request.get_json(silent=True) or {}
        doble_auth = bool(d.get('doble_auth'))

        # Comprobar requiere_autorizacion
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT requiere_autorizacion, autorizado_doble, estado
                  FROM gasto_documento
                 WHERE id=%s AND id_manager=%s
            """, (doc_id, g.id_manager))
            cur_row = cur.fetchone()
        if not cur_row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if cur_row['estado'] != 'borrador':
            return jsonify({'ok': False, 'error': 'no_borrador'}), 409
        if cur_row['requiere_autorizacion'] and not (cur_row['autorizado_doble'] or doble_auth):
            return jsonify({
                'ok': False,
                'error': 'requiere_doble_autorizacion',
                'detalle': 'Este documento tiene un CIF receptor que no coincide con ningún centro. '
                           'Confirma la doble autorización para validar.',
            }), 409

        actor = getattr(g, 'created_by', None) or 'manager'
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE gasto_documento
                   SET estado='validado',
                       validado_at = NOW(),
                       validado_by = %s,
                       autorizado_doble = (autorizado_doble OR %s),
                       autorizado_doble_by = CASE WHEN %s THEN %s ELSE autorizado_doble_by END
                 WHERE id=%s AND id_manager=%s AND estado='borrador'
                RETURNING *
            """, (actor, doble_auth, doble_auth, actor, doc_id, g.id_manager))
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'no_borrador_o_no_encontrado'}), 404

        # ── Fase 2: crear account.move en Odoo (defensivo: si falla, validado pero
        # se anota el error en notas y `odoo_move_id` queda NULL para reintentar) ──
        odoo_result = None
        if row.get('subtipo') in ('factura', 'ticket') or row.get('importe_total'):
            # Cargar la categoría para el `cuenta_contable_odoo`
            doc_for_odoo = dict(row)
            if row.get('categoria_id'):
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("""
                        SELECT cuenta_contable_odoo, iva_default
                          FROM gasto_categoria
                         WHERE id=%s AND id_manager=%s
                    """, (row['categoria_id'], g.id_manager))
                    cat = cur.fetchone()
                    if cat:
                        doc_for_odoo['cuenta_contable_odoo'] = cat['cuenta_contable_odoo']

            try:
                from ..odoo_gastos import crear_factura_proveedor
                # Postear automáticamente si confianza LLM ≥ 0.9 y NO requería doble auth.
                # Si el user puso doble_auth, lo dejamos draft para que revise en Odoo.
                conf = float(row.get('confianza_llm') or 0)
                auto_post = (conf >= 0.9 and not row.get('requiere_autorizacion'))
                odoo_result = crear_factura_proveedor(doc_for_odoo, post=auto_post)
                if odoo_result.get('ok'):
                    with get_conn() as conn, conn.cursor() as cur:
                        cur.execute("""
                            UPDATE gasto_documento
                               SET odoo_move_id = %s,
                                   odoo_move_state = %s,
                                   odoo_partner_id = %s
                             WHERE id=%s
                            RETURNING *
                        """, (odoo_result['move_id'], odoo_result['state'],
                              odoo_result['partner_id'], doc_id))
                        row = cur.fetchone()
                else:
                    # Anotar el error pero dejar el doc validado
                    with get_conn() as conn, conn.cursor() as cur:
                        cur.execute("""
                            UPDATE gasto_documento
                               SET notas = COALESCE(notas, '') || E'\n[Odoo] ' || %s
                             WHERE id=%s
                            RETURNING *
                        """, (odoo_result.get('error', 'unknown'), doc_id))
                        row = cur.fetchone()
            except Exception as e:
                log.exception('crear_factura_proveedor')
                odoo_result = {'ok': False, 'error': str(e)[:500]}

        return jsonify({
            'ok': True,
            'documento': row,
            'odoo': odoo_result or {'ok': False, 'error': 'skipped: tipo no soportado'},
        })
    except Exception as e:
        log.exception('validar_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>/a-borrador', methods=['POST'])
@auth_required
def desvalidar_documento(doc_id):
    """Revierte un documento validado a estado 'borrador'.

    Si el documento ya tenía asiento creado en Odoo (`odoo_move_id`), intenta
    cancelarlo o devolverlo a draft. Si no es posible (ya conciliado, etc.),
    se devuelve un warning pero el doc SÍ pasa a borrador para que el user
    pueda editarlo. El asiento Odoo huérfano se anota en `notas`.

    body opcional: {motivo: 'texto'}
    """
    try:
        d = request.get_json(silent=True) or {}
        motivo = (d.get('motivo') or '').strip()

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM gasto_documento
                 WHERE id_manager=%s AND id=%s
            """, (g.id_manager, doc_id))
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if row['estado'] != 'validado':
            return jsonify({'ok': False, 'error': 'no_validado',
                            'detalle': f'estado actual: {row["estado"]}'}), 400

        odoo_warning = None
        odoo_action  = None
        if row.get('odoo_move_id'):
            try:
                from ..odoo_cuotas import get_cuotas
                oc = get_cuotas()
                # Intentar action_button_draft (devuelve a borrador en Odoo)
                # antes que cancel (más reversible).
                try:
                    oc._call('account.move', 'button_draft', [row['odoo_move_id']])
                    odoo_action = 'draft'
                except Exception as e1:
                    log.warning(f'button_draft falló move={row["odoo_move_id"]}: {e1}')
                    try:
                        oc._call('account.move', 'button_cancel', [row['odoo_move_id']])
                        odoo_action = 'cancelled'
                    except Exception as e2:
                        odoo_warning = (f'No se pudo modificar el asiento Odoo '
                                        f'(move {row["odoo_move_id"]}): {str(e2)[:200]}. '
                                        f'Revisa manualmente desde Odoo.')
                        log.warning(f'button_cancel también falló: {e2}')
            except Exception as e:
                odoo_warning = f'Error conectando con Odoo: {str(e)[:200]}'
                log.warning(f'odoo connect falló: {e}')

        # Actualizar BD: pasar a borrador, opcionalmente limpiar odoo_move_id
        nota_extra = (f'\n[a-borrador {datetime.now().isoformat()}] '
                      + (motivo or 'sin motivo')
                      + (f' · Odoo: {odoo_action}' if odoo_action else '')
                      + (f' · {odoo_warning}' if odoo_warning else ''))
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE gasto_documento
                   SET estado='borrador',
                       validado_at=NULL,
                       validado_by=NULL,
                       notas=COALESCE(notas, '') || %s,
                       odoo_move_state = CASE WHEN %s = 'draft' THEN 'draft'
                                              WHEN %s = 'cancelled' THEN 'cancel'
                                              ELSE odoo_move_state END
                 WHERE id_manager=%s AND id=%s
                RETURNING *
            """, (nota_extra, odoo_action, odoo_action, g.id_manager, doc_id))
            row = cur.fetchone()

        return jsonify({
            'ok': True,
            'documento': row,
            'odoo_action': odoo_action,
            'warning': odoo_warning,
        })
    except Exception as e:
        log.exception('desvalidar_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>/asiento', methods=['GET'])
@auth_required
def asiento_documento(doc_id):
    """Devuelve el asiento contable de un documento.

    Si el documento ya está validado y tiene `odoo_move_id`, lee las
    `account.move.line` reales de Odoo (asiento definitivo).
    Si está en borrador, calcula el asiento PROPUESTO a partir de:
      - cuenta_contable_odoo de su categoría (cuenta de gasto)
      - iva_pct (para la cuenta de IVA soportado, normalmente 472)
      - cuenta de proveedor (normalmente 4100/410 del Plan Contable)
    """
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT d.*, c.cuenta_contable_odoo, c.iva_default, c.nombre AS categoria_nombre
                  FROM gasto_documento d
             LEFT JOIN gasto_categoria c ON c.id = d.categoria_id
                 WHERE d.id_manager=%s AND d.id=%s
            """, (g.id_manager, doc_id))
            doc = cur.fetchone()
        if not doc:
            return jsonify({'ok': False, 'error': 'not_found'}), 404

        # ── Asiento DEFINITIVO desde Odoo ──────────────────────────────────
        if doc.get('odoo_move_id'):
            try:
                from ..odoo_cuotas import get_cuotas
                oc = get_cuotas()
                move = oc._call('account.move', 'read', [doc['odoo_move_id']],
                    ['id', 'name', 'ref', 'state', 'date', 'invoice_date',
                     'amount_untaxed', 'amount_tax', 'amount_total', 'line_ids'])
                if not move:
                    return jsonify({'ok': False, 'error': 'move_no_encontrado_en_odoo'}), 404
                m = move[0]
                lines = []
                if m.get('line_ids'):
                    line_rows = oc._call('account.move.line', 'read', m['line_ids'],
                        ['name', 'account_id', 'debit', 'credit', 'balance',
                         'tax_ids', 'partner_id'])
                    for ln in line_rows:
                        lines.append({
                            'cuenta':   (ln.get('account_id') or [None,''])[1] if ln.get('account_id') else '',
                            'concepto': ln.get('name') or '',
                            'debe':     round(float(ln.get('debit')  or 0), 2),
                            'haber':    round(float(ln.get('credit') or 0), 2),
                            'partner':  (ln.get('partner_id') or [None,''])[1] if ln.get('partner_id') else '',
                        })
                return jsonify({
                    'ok': True,
                    'tipo': 'definitivo',
                    'move_id':    m['id'],
                    'move_name':  m.get('name') or '',
                    'state':      m.get('state'),
                    'fecha':      m.get('invoice_date') or m.get('date'),
                    'lineas':     lines,
                    'totales': {
                        'base':  round(float(m.get('amount_untaxed') or 0), 2),
                        'iva':   round(float(m.get('amount_tax')     or 0), 2),
                        'total': round(float(m.get('amount_total')   or 0), 2),
                    },
                })
            except Exception as e:
                log.exception('asiento odoo')
                return jsonify({'ok': False, 'error': f'odoo: {e}'}), 500

        # ── Asiento PROPUESTO (todavía no validado) ─────────────────────────
        base  = float(doc.get('importe_base')  or 0)
        iva   = float(doc.get('importe_iva')   or 0)
        total = float(doc.get('importe_total') or 0)
        subtipo = (doc.get('subtipo') or '').lower()
        llm_data = doc.get('llm_data') or {}
        if isinstance(llm_data, str):
            try:
                import json as _json; llm_data = _json.loads(llm_data)
            except Exception: llm_data = {}

        # ── CASO ESPECIAL: NÓMINA ───────────────────────────────────────────
        # Detección por subtipo, categoría o nombre del archivo (a veces el
        # LLM marca subtipo='otro' aunque sea una nómina; en ese caso al
        # menos la categoría o el filename suele tener "nómina"/"NOMINA").
        nombre_cat  = (doc.get('categoria_nombre') or '').lower()
        nombre_file = (doc.get('filename_original') or '').lower()
        es_nomina = (
            subtipo == 'nomina'
            or 'nomina' in nombre_cat or 'nómina' in nombre_cat
            or 'nomina' in nombre_file or 'nómina' in nombre_file
            or bool(llm_data.get('importe_bruto') or llm_data.get('liquido_a_pagar')
                    or llm_data.get('irpf_retenido'))
        )

        # Las nóminas NO son facturas con IVA. El asiento PGC español es:
        #   (D) 640 Sueldos y salarios                BRUTO empleado
        #   (D) 642 Seguridad Social a cargo empresa  SS empresa
        #     (H) 4751 H.P. acreedora retenciones (IRPF)   retenciones IRPF
        #     (H) 476  Organismos SS acreedores            SS total (empresa+trab)
        #     (H) 465  Remuneraciones pendientes pago      LÍQUIDO a empleados
        #
        # Cuadre: 640 + 642 = 4751 + 476 + 465
        # Si el LLM no extrajo todos los componentes intentamos derivarlos
        # con porcentajes típicos. El usuario puede ajustar antes de validar.
        if es_nomina:
            # Si el LLM extrajo un desglose por trabajador, lo usamos. Cada
            # trabajador puede tener:
            #   nombre, bruto (=total devengo), base_contingencias_comunes,
            #   ss_trabajador, ss_empresa, base_accidente, irpf, liquido.
            trabajadores = llm_data.get('trabajadores') or llm_data.get('empleados_detalle') or []
            if isinstance(trabajadores, dict): trabajadores = [trabajadores]
            trabajadores = [t for t in trabajadores if isinstance(t, dict)]

            avisos = []
            lineas = []
            mes_label = (doc.get('periodo') or doc.get('concepto') or 'Nómina').replace('"','')

            if trabajadores:
                # ── Caso con desglose por trabajador ────────────────────────
                sum_bruto = sum_ss_emp = sum_ss_trab = sum_acc = sum_irpf = sum_liq = 0.0
                for t in trabajadores:
                    bruto_t  = float(t.get('bruto') or t.get('total_devengo') or 0)
                    base_cc  = float(t.get('base_contingencias_comunes') or 0)
                    ss_trab_t= float(t.get('ss_trabajador') or 0)
                    ss_emp_t = float(t.get('ss_empresa') or 0)
                    base_acc = float(t.get('base_accidente') or 0)
                    irpf_t   = float(t.get('irpf') or t.get('irpf_retenido') or 0)
                    liq_t    = float(t.get('liquido') or t.get('liquido_a_pagar') or 0)
                    nombre_t = (t.get('nombre') or t.get('trabajador') or '').strip() or 'Trabajador'

                    # Validación clave: total devengo == base contingencias comunes
                    if bruto_t > 0 and base_cc > 0 and abs(bruto_t - base_cc) > 0.05:
                        avisos.append(
                            f'{nombre_t}: total devengo ({bruto_t:.2f} €) ≠ base contingencias comunes ({base_cc:.2f} €). '
                            f'Diferencia {bruto_t - base_cc:+.2f} € — revisa la nómina.')

                    sum_bruto   += bruto_t
                    sum_ss_emp  += ss_emp_t
                    sum_ss_trab += ss_trab_t
                    sum_acc     += base_acc
                    sum_irpf    += irpf_t
                    sum_liq     += liq_t

                # ── 640: bruto total ───────────────────────────────────────
                lineas.append({
                    'cuenta':   '640',
                    'concepto': f'Sueldos y salarios · {mes_label} ({len(trabajadores)} trabajador{"es" if len(trabajadores)!=1 else ""})',
                    'debe':     round(sum_bruto, 2), 'haber': 0.0, 'partner': '',
                })
                # ── 642: SS a cargo empresa (aportación empresa, que ya
                # incluye contingencias comunes empresa + AT + desempleo + FOGASA + FP).
                # NOTA: base_accidente NO es un importe adicional, es la base
                # sobre la que se calcula el % AT (ya incluido en ss_empresa).
                # La "deducción contingencias comunes" del trabajador tampoco
                # va aquí — está implícita en el bruto del 640 y se reconoce
                # en la 476 (acreedora).
                total_642 = round(sum_ss_emp, 2)
                if total_642 > 0:
                    lineas.append({
                        'cuenta':   '642',
                        'concepto': f'Seguridad Social a cargo empresa (cont. comunes + AT + desempleo + FOGASA + FP)',
                        'debe':     total_642, 'haber': 0.0, 'partner': '',
                    })
                # ── 4751: IRPF total retenido ──────────────────────────────
                if sum_irpf > 0:
                    lineas.append({
                        'cuenta':   '4751',
                        'concepto': 'H.P. acreedora por retenciones IRPF',
                        'debe':     0.0, 'haber': round(sum_irpf, 2), 'partner': '',
                    })
                # ── 476: SS acreedora (empresa + trabajador) ───────────────
                if sum_ss_emp + sum_ss_trab > 0:
                    lineas.append({
                        'cuenta':   '476',
                        'concepto': 'Organismos S.S. acreedores',
                        'debe':     0.0, 'haber': round(sum_ss_emp + sum_ss_trab, 2), 'partner': '',
                    })
                # ── 465 una por TRABAJADOR ─────────────────────────────────
                for t in trabajadores:
                    nombre_t = (t.get('nombre') or t.get('trabajador') or '').strip() or 'Trabajador'
                    liq_t    = float(t.get('liquido') or t.get('liquido_a_pagar') or 0)
                    if liq_t <= 0: continue
                    lineas.append({
                        'cuenta':   '465',
                        'concepto': f'Remuneraciones pdtes. · {nombre_t}',
                        'debe':     0.0, 'haber': round(liq_t, 2), 'partner': nombre_t,
                    })

                # Validación final: el asiento cuadra
                suma_debe  = round(sum(l['debe']  for l in lineas), 2)
                suma_haber = round(sum(l['haber'] for l in lineas), 2)
                if abs(suma_debe - suma_haber) > 0.05:
                    avisos.append(f'El asiento NO cuadra: debe {suma_debe:.2f} € ≠ haber {suma_haber:.2f} €. Revisa los importes manualmente.')

                return jsonify({
                    'ok': True,
                    'tipo': 'propuesto',
                    'asiento_tipo': 'nomina',
                    'state': doc.get('estado'),
                    'fecha': str(doc.get('fecha_documento')) if doc.get('fecha_documento') else None,
                    'n_trabajadores': len(trabajadores),
                    'avisos': avisos,
                    'lineas': lineas,
                    'totales': {
                        'bruto':         round(sum_bruto, 2),
                        'ss_empresa':    round(sum_ss_emp, 2),
                        'ss_trabajador': round(sum_ss_trab, 2),
                        'base_accidente':round(sum_acc, 2),
                        'ss_total':      round(sum_ss_emp + sum_ss_trab, 2),
                        'irpf':          round(sum_irpf, 2),
                        'liquido':       round(sum_liq, 2),
                        'base':          round(sum_bruto + sum_ss_emp + sum_acc, 2),
                        'iva':           0.0,
                        'total':         suma_debe,
                    },
                })

            # ── Fallback: sin desglose por trabajador (LLM solo extrajo totales)
            bruto       = float(llm_data.get('importe_bruto') or llm_data.get('total_devengo') or 0)
            base_cc     = float(llm_data.get('base_contingencias_comunes') or 0)
            irpf        = float(llm_data.get('irpf_retenido') or llm_data.get('irpf') or 0)
            ss_emp      = float(llm_data.get('ss_empresa') or 0)
            ss_trab     = float(llm_data.get('ss_trabajador') or 0)
            base_acc    = float(llm_data.get('base_accidente') or 0)
            liquido     = float(llm_data.get('liquido_a_pagar') or llm_data.get('liquido') or 0)

            # Si solo tenemos `total` (típico cuando el LLM lo confunde con líquido),
            # asumimos que es el LÍQUIDO y reconstruimos hacia atrás con porcentajes
            # estándar España 2026: SS trab 6.45%, SS empresa 31%, IRPF 15% medio.
            if liquido == 0 and total > 0:
                liquido = total
            if bruto == 0 and liquido > 0:
                bruto = round(liquido / (1 - 0.0645 - 0.15), 2)
            if ss_trab == 0 and bruto > 0:
                ss_trab = round(bruto * 0.0645, 2)
            if irpf == 0 and bruto > 0 and liquido > 0:
                irpf = round(bruto - liquido - ss_trab, 2)
                if irpf < 0: irpf = 0
            if ss_emp == 0 and bruto > 0:
                ss_emp = round(bruto * 0.31, 2)
            if liquido == 0 and bruto > 0:
                liquido = round(bruto - ss_trab - irpf, 2)

            # Validación: total devengo == base contingencias comunes
            if bruto > 0 and base_cc > 0 and abs(bruto - base_cc) > 0.05:
                avisos.append(
                    f'Discordancia: total devengo {bruto:.2f} € ≠ base contingencias comunes {base_cc:.2f} €. '
                    f'Diferencia {bruto - base_cc:+.2f} € — revísalo en la nómina.')

            empleados = llm_data.get('empleados') or llm_data.get('n_empleados') or ''
            # 642 = aportación empresa total (ya incluye cont. comunes + AT + desempleo + FOGASA + FP)
            total_642 = round(ss_emp, 2)

            lineas.append({
                'cuenta':   '640',
                'concepto': f'Sueldos y salarios · {mes_label}' + (f' ({empleados} empleados)' if empleados else ''),
                'debe':     round(bruto, 2), 'haber': 0.0, 'partner': '',
            })
            if total_642 > 0:
                lineas.append({
                    'cuenta':   '642',
                    'concepto': 'Seguridad Social a cargo empresa',
                    'debe':     total_642, 'haber': 0.0, 'partner': '',
                })
            if irpf > 0:
                lineas.append({
                    'cuenta':   '4751',
                    'concepto': 'H.P. acreedora por retenciones IRPF',
                    'debe':     0.0, 'haber': round(irpf, 2), 'partner': '',
                })
            if ss_emp + ss_trab > 0:
                lineas.append({
                    'cuenta':   '476',
                    'concepto': 'Organismos S.S. acreedores',
                    'debe':     0.0, 'haber': round(ss_emp + ss_trab, 2), 'partner': '',
                })
            if liquido > 0:
                lineas.append({
                    'cuenta':   '465',
                    'concepto': 'Remuneraciones pendientes de pago (líquido)',
                    'debe':     0.0, 'haber': round(liquido, 2), 'partner': '',
                })

            if not llm_data.get('importe_bruto') and not llm_data.get('total_devengo'):
                avisos.append('Bruto estimado a partir del líquido. Verifica con la nómina antes de validar.')
            if not llm_data.get('irpf_retenido') and not llm_data.get('irpf'):
                avisos.append('IRPF estimado por diferencia. Si la nómina trae el importe exacto, ajústalo.')
            if not llm_data.get('ss_empresa'):
                avisos.append('SS empresa estimada al 31% — varía según convenio/sector. Verifica.')
            if not llm_data.get('trabajadores'):
                avisos.append('El LLM no extrajo el desglose por trabajador. Cuando haya varios, debería haber una línea 465 por cada uno con su líquido.')

            suma_debe  = round(sum(l['debe']  for l in lineas), 2)
            suma_haber = round(sum(l['haber'] for l in lineas), 2)
            if abs(suma_debe - suma_haber) > 0.05:
                avisos.append(f'El asiento NO cuadra (debe {suma_debe:.2f} € ≠ haber {suma_haber:.2f} €). Revisa los importes manualmente.')

            return jsonify({
                'ok': True,
                'tipo': 'propuesto',
                'asiento_tipo': 'nomina',
                'state': doc.get('estado'),
                'fecha': str(doc.get('fecha_documento')) if doc.get('fecha_documento') else None,
                'avisos': avisos,
                'lineas': lineas,
                'totales': {
                    'bruto':         round(bruto, 2),
                    'ss_empresa':    round(ss_emp, 2),
                    'ss_trabajador': round(ss_trab, 2),
                    'base_accidente':round(base_acc, 2),
                    'ss_total':      round(ss_emp + ss_trab, 2),
                    'irpf':          round(irpf, 2),
                    'liquido':       round(liquido, 2),
                    'base':          round(bruto + total_642, 2),
                    'iva':           0.0,
                    'total':         suma_debe,
                },
            })

        # ── CASO ESTÁNDAR: factura / ticket / otro ──────────────────────────
        # Si solo tenemos total y no se hizo split de IVA, derivamos del iva_pct
        if total > 0 and base == 0 and iva == 0:
            pct = float(doc.get('iva_pct') or 0)
            if pct > 0:
                base = round(total / (1 + pct/100), 2)
                iva  = round(total - base, 2)
            else:
                base = total

        cuenta_gasto = doc.get('cuenta_contable_odoo') or '6—Sin categoría'
        cuenta_iva   = '472' if iva > 0 else None      # IVA soportado (España PGC)
        cuenta_prov  = '410'
        proveedor    = doc.get('proveedor') or 'Proveedor'
        concepto     = (doc.get('concepto') or doc.get('proveedor')
                        or doc.get('categoria_nombre') or 'Gasto')

        # Asiento típico de factura recibida:
        #   (D) 6XX  Gasto                    base
        #   (D) 472  H.P. IVA soportado       iva
        #     (H) 410  Proveedor                       total
        lineas = []
        lineas.append({
            'cuenta':   cuenta_gasto,
            'concepto': concepto,
            'debe':     round(base, 2),
            'haber':    0.0,
            'partner':  '',
        })
        if iva > 0 and cuenta_iva:
            lineas.append({
                'cuenta':   cuenta_iva,
                'concepto': f'H.P. IVA soportado {doc.get("iva_pct") or ""}%',
                'debe':     round(iva, 2),
                'haber':    0.0,
                'partner':  '',
            })
        lineas.append({
            'cuenta':   cuenta_prov,
            'concepto': proveedor,
            'debe':     0.0,
            'haber':    round(total, 2),
            'partner':  proveedor,
        })

        return jsonify({
            'ok': True,
            'tipo': 'propuesto',
            'asiento_tipo': 'factura',
            'state': doc.get('estado'),
            'fecha': str(doc.get('fecha_documento')) if doc.get('fecha_documento') else None,
            'avisos': (
                []
                + (['Sin categoría asignada → cuenta de gasto sin resolver'] if not doc.get('categoria_id') else [])
                + (['Sin IVA detectado'] if iva == 0 and total > 0 else [])
                + (['Sin proveedor — se creará uno nuevo en Odoo al validar'] if not doc.get('proveedor') else [])
            ),
            'lineas': lineas,
            'totales': {
                'base':  round(base, 2),
                'iva':   round(iva, 2),
                'total': round(total, 2),
            },
        })
    except Exception as e:
        log.exception('asiento_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>/rechazar', methods=['POST'])
@auth_required
def rechazar_documento(doc_id):
    try:
        d = request.get_json() or {}
        motivo = (d.get('motivo') or '').strip()
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE gasto_documento
                   SET estado='rechazado',
                       motivo_rechazo = %s,
                       validado_at = NOW(),
                       validado_by = %s
                 WHERE id=%s AND id_manager=%s
                RETURNING *
            """, (motivo or None, getattr(g, 'created_by', None) or 'manager',
                  doc_id, g.id_manager))
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        return jsonify({'ok': True, 'documento': row})
    except Exception as e:
        log.exception('rechazar_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Listados ───────────────────────────────────────────────────────────────

@bp.route('/listados/totales', methods=['GET'])
@auth_required
def listado_totales():
    """Totales agregados de gasto_documento.

    Query: desde, hasta, estado (default 'validado'), group_by=mes|categoria|
           proveedor|trainer|tipo.
    Devuelve filas {grupo, importe_base, importe_iva, importe_total, n_docs}.
    """
    try:
        gb = (request.args.get('group_by') or 'mes').lower()
        col = {
            'mes':       "to_char(d.fecha_documento, 'YYYY-MM')",
            'categoria': 'COALESCE(c.nombre, \'(sin categoría)\')',
            'proveedor': 'COALESCE(NULLIF(d.proveedor, \'\'), \'(sin proveedor)\')',
            'trainer':   "COALESCE(d.id_trainer, '(gastos generales)')",
            'tipo':      'COALESCE(c.tipo, \'(sin tipo)\')',
        }.get(gb)
        if not col:
            return jsonify({'ok': False, 'error': 'group_by_invalido'}), 400

        wheres = ['d.id_manager = %s']
        params = [g.id_manager]
        if g.id_trainer:
            wheres.append('d.id_trainer = %s'); params.append(g.id_trainer)
        estado = request.args.get('estado', 'validado')
        if estado:
            wheres.append('d.estado = %s'); params.append(estado)
        if request.args.get('desde'):
            wheres.append('d.fecha_documento >= %s'); params.append(request.args['desde'])
        if request.args.get('hasta'):
            wheres.append('d.fecha_documento <= %s'); params.append(request.args['hasta'])

        sql = f"""
            SELECT {col} AS grupo,
                   COALESCE(SUM(d.importe_base), 0)::numeric(14,2)  AS importe_base,
                   COALESCE(SUM(d.importe_iva), 0)::numeric(14,2)   AS importe_iva,
                   COALESCE(SUM(d.importe_total), 0)::numeric(14,2) AS importe_total,
                   COUNT(*) AS n_docs
              FROM gasto_documento d
              LEFT JOIN gasto_categoria c ON c.id = d.categoria_id
             WHERE {' AND '.join(wheres)}
             GROUP BY {col}
             ORDER BY 1
        """
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return jsonify({'ok': True, 'group_by': gb, 'filas': rows})
    except Exception as e:
        log.exception('listado_totales')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/listados/faltantes', methods=['GET'])
@auth_required
def listado_faltantes():
    """Detecta categorías con periodicidad cuyo período tiene 0 documentos.

    Query params:
      meses=6                ventana hacia atrás
      tipo_deteccion=detectado|estimado|all (default all)
      incluir_ignorados=0|1  (default 0 → oculta los archivados por el manager)

    Cada faltante se marca como:
      'detectado' = la categoría YA tiene historial (≥1 doc en algún
                     período pasado). Si falta este mes, es real.
      'estimado'  = la categoría NUNCA tuvo doc. Quizá no aplique a
                     este negocio; es solo una sugerencia.
    """
    try:
        from datetime import date
        meses_atras = int(request.args.get('meses', 6))
        tipo_det = (request.args.get('tipo_deteccion') or 'all').lower()
        incluir_ignorados = request.args.get('incluir_ignorados') in ('1','true','yes')
        hoy = date.today()

        # Construir lista de períodos
        periodos_mensual = []
        for m in range(meses_atras):
            y, mm = hoy.year, hoy.month - m
            while mm <= 0:
                mm += 12; y -= 1
            periodos_mensual.append(f'{y}-{mm:02d}')

        periodos_trim = []
        for q in range(min(4, meses_atras // 3 + 1)):
            mes = hoy.month - q * 3
            y = hoy.year
            while mes <= 0:
                mes += 12; y -= 1
            tri = (mes - 1) // 3 + 1
            tag = f'{y}-T{tri}'
            if tag not in periodos_trim:
                periodos_trim.append(tag)

        periodos_anual = [str(hoy.year), str(hoy.year - 1)]

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, codigo, nombre, tipo, periodicidad, color
                  FROM gasto_categoria
                 WHERE id_manager=%s AND activa=TRUE AND periodicidad IS NOT NULL
                 ORDER BY orden, nombre
            """, (g.id_manager,))
            cats = cur.fetchall()
            cur.execute("""
                SELECT categoria_id, periodo
                  FROM gasto_documento
                 WHERE id_manager=%s AND categoria_id IS NOT NULL
                   AND periodo IS NOT NULL
                   AND estado IN ('validado','borrador')
            """, (g.id_manager,))
            docs = cur.fetchall()
            cur.execute("""
                SELECT categoria_id, periodo, ignored_at, ignored_by, motivo
                  FROM gasto_faltante_ignorado
                 WHERE id_manager=%s
            """, (g.id_manager,))
            ignorados = cur.fetchall()

        existentes = {(d['categoria_id'], d['periodo']) for d in docs}
        # Para "detectado": qué categorías YA tienen al menos un doc histórico
        cat_con_historial = {d['categoria_id'] for d in docs}
        ign_set = {(i['categoria_id'], i['periodo']) for i in ignorados}
        ign_meta = {(i['categoria_id'], i['periodo']): i for i in ignorados}

        out = []
        for c in cats:
            if c['periodicidad'] == 'mensual':
                periodos_check = periodos_mensual
            elif c['periodicidad'] == 'trimestral':
                periodos_check = periodos_trim
            elif c['periodicidad'] == 'anual':
                periodos_check = periodos_anual
            else:
                continue
            es_detectado = c['id'] in cat_con_historial
            for p in periodos_check:
                if (c['id'], p) in existentes:
                    continue
                ignorado = (c['id'], p) in ign_set
                if ignorado and not incluir_ignorados:
                    continue
                tipo = 'detectado' if es_detectado else 'estimado'
                if tipo_det != 'all' and tipo_det != tipo:
                    continue
                ig = ign_meta.get((c['id'], p)) if ignorado else None
                out.append({
                    'categoria_id': c['id'],
                    'codigo': c['codigo'],
                    'nombre': c['nombre'],
                    'tipo': c['tipo'],
                    'color': c['color'],
                    'periodicidad': c['periodicidad'],
                    'periodo_faltante': p,
                    'tipo_deteccion': tipo,
                    'ignorado': ignorado,
                    'ignored_at': ig['ignored_at'].isoformat() if ig and ig.get('ignored_at') else None,
                    'ignored_motivo': ig.get('motivo') if ig else None,
                })
        # Ordenar: detectados primero, luego por periodo desc, luego por nombre
        out.sort(key=lambda x: (
            0 if x['tipo_deteccion'] == 'detectado' else 1,
            -ord(x['periodo_faltante'][0]),  # placeholder
        ))
        # Mejor orden: detectados primero, periodo desc
        out.sort(key=lambda x: (
            0 if x['tipo_deteccion'] == 'detectado' else 1,
            x['periodo_faltante'],
        ), reverse=False)
        return jsonify({
            'ok': True,
            'faltantes': out,
            'stats': {
                'detectados': sum(1 for x in out if x['tipo_deteccion'] == 'detectado'),
                'estimados':  sum(1 for x in out if x['tipo_deteccion'] == 'estimado'),
                'ignorados':  sum(1 for x in out if x['ignorado']),
            },
        })
    except Exception as e:
        log.exception('listado_faltantes')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/listados/faltantes/ignorar', methods=['POST'])
@auth_required
def faltante_ignorar():
    """Archiva un faltante para que no aparezca en el listado.
    Body: { categoria_id, periodo_faltante, motivo? }
    """
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        cat_id = int(d.get('categoria_id') or 0)
        periodo = (d.get('periodo_faltante') or '').strip()
        if not cat_id or not periodo:
            return jsonify({'ok': False, 'error': 'categoria_id_y_periodo_requeridos'}), 400
        actor = getattr(g, 'created_by', None) or 'manager'
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO gasto_faltante_ignorado
                  (id_manager, categoria_id, periodo, ignored_by, motivo)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (id_manager, categoria_id, periodo) DO UPDATE
                  SET motivo = EXCLUDED.motivo, ignored_at = NOW(),
                      ignored_by = EXCLUDED.ignored_by
                RETURNING *
            """, (g.id_manager, cat_id, periodo, actor, d.get('motivo')))
            row = cur.fetchone()
        return jsonify({'ok': True, 'row': row})
    except Exception as e:
        log.exception('faltante_ignorar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/listados/faltantes/ignorar/<int:cat_id>/<periodo>', methods=['DELETE'])
@auth_required
def faltante_restaurar(cat_id, periodo):
    """Quita el archivado: el faltante volverá a aparecer."""
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                DELETE FROM gasto_faltante_ignorado
                 WHERE id_manager=%s AND categoria_id=%s AND periodo=%s
            """, (g.id_manager, cat_id, periodo))
            n = cur.rowcount
        return jsonify({'ok': True, 'removed': n})
    except Exception as e:
        log.exception('faltante_restaurar')
        return jsonify({'ok': False, 'error': str(e)}), 500


def _resultados_un_rango(desde, hasta, modo_ingresos='reales',
                          incluir_no_contabilizados=False):
    """Calcula {ingresos, gastos} para un rango. Helper interno.

    modo_ingresos:
      'reales'      → recibos cobrados (estado='pagado') por fecha_pago.
                      Es el dinero que realmente entró en caja.
      'facturados'  → facturas emitidas (account.move out_invoice posteadas)
                      por fecha de factura, hayan cobrado o no.

    incluir_no_contabilizados:
      Si True, suma también los ingresos bancarios sin cuadrar
      (banco_movimiento.estado='sin_cuadrar' AND importe>0) en el rango.
      Son cobros que entraron en banco pero aún NO tienen un recibo o
      factura asociado en BD/Odoo — sirve para tener la foto real de
      cash flow aunque la contabilidad esté atrasada.
    """
    gastos = 0.0
    with get_conn() as conn, conn.cursor() as cur:
        wheres = ["d.id_manager=%s", "d.estado='validado'",
                  "d.fecha_documento >= %s", "d.fecha_documento <= %s"]
        params = [g.id_manager, desde, hasta]
        if g.id_trainer:
            wheres.append('d.id_trainer=%s'); params.append(g.id_trainer)
        # Gasto = BASE sin IVA. Si la base es 0 (no se hizo split de IVA)
        # caemos al total para no perder el dato.
        cur.execute(f"""
            SELECT COALESCE(SUM(
                     CASE WHEN COALESCE(d.importe_base, 0) > 0 THEN d.importe_base
                          ELSE d.importe_total END
                   ), 0)::numeric(14,2) AS gastos
              FROM gasto_documento d
             WHERE {' AND '.join(wheres)}
        """, params)
        gastos = float(cur.fetchone()['gastos'])

    ingresos = 0.0
    if modo_ingresos == 'facturados':
        # Modo facturado: facturas Odoo posteadas en el rango (cobradas o no)
        try:
            from ..odoo_cuotas import get_cuotas
            from .. import config as cfg
            oc = get_cuotas()
            inv_ids = oc._call('account.move', 'search', [
                ('move_type','=','out_invoice'),
                ('state','=','posted'),
                ('invoice_date','>=', desde),
                ('invoice_date','<=', hasta),
                ('company_id','=', cfg.ODOO_COMPANY),
            ])
            if inv_ids:
                invs = oc._call('account.move','read', inv_ids, ['amount_untaxed_signed'])
                ingresos = sum(float(i.get('amount_untaxed_signed') or 0) for i in invs)
        except Exception as e:
            log.warning(f'_resultados_un_rango odoo: {e}')
    else:
        # Modo reales (default): recibos cobrados en BD propia
        with get_conn() as conn, conn.cursor() as cur:
            wheres = ["id_manager=%s", "estado='pagado'",
                      "fecha_pago::date >= %s", "fecha_pago::date <= %s"]
            params = [str(g.id_manager), desde, hasta]
            if g.id_trainer:
                wheres.append('(id_trainer=%s OR id_trainer IS NULL)')
                params.append(str(g.id_trainer))
            cur.execute(f"""
                SELECT COALESCE(SUM(importe_base), 0)::numeric(14,2) AS ingresos
                  FROM recibo
                 WHERE {' AND '.join(wheres)}
            """, params)
            ingresos = float(cur.fetchone()['ingresos'])

    # Ingresos NO contabilizados: movimientos bancarios sin cuadrar (positivos)
    extra_ncl = 0.0
    if incluir_no_contabilizados:
        with get_conn() as conn, conn.cursor() as cur:
            wheres = ["id_manager=%s", "estado='sin_cuadrar'",
                      "importe > 0",
                      "fecha >= %s", "fecha <= %s"]
            params = [str(g.id_manager), desde, hasta]
            if g.id_trainer:
                wheres.append('(id_trainer=%s OR id_trainer IS NULL)')
                params.append(str(g.id_trainer))
            cur.execute(f"""
                SELECT COALESCE(SUM(importe), 0)::numeric(14,2) AS ingresos_extra
                  FROM banco_movimiento
                 WHERE {' AND '.join(wheres)}
            """, params)
            extra_ncl = float(cur.fetchone()['ingresos_extra'])
        ingresos += extra_ncl

    return round(ingresos, 2), round(gastos, 2), round(extra_ncl, 2)


def _resultados_por_periodos(periodos, modo_ingresos='reales',
                              incluir_no_contabilizados=False):
    """Para cada período devuelve una fila con ingresos/gastos/beneficio."""
    filas = []
    total_ing = total_gas = total_ncl = 0.0
    for p in periodos:
        try:
            desde, hasta = _periodo_a_rango(p)
        except ValueError as e:
            return jsonify({'ok': False, 'error': str(e)}), 400
        ing, gas, ncl = _resultados_un_rango(desde, hasta, modo_ingresos,
                                              incluir_no_contabilizados)
        total_ing += ing; total_gas += gas; total_ncl += ncl
        filas.append({
            'periodo': p,
            'desde': desde, 'hasta': hasta,
            'ingresos': ing, 'gastos': gas,
            'no_contabilizado': ncl,    # subset de ingresos que viene de banco sin cuadrar
            'beneficio': round(ing - gas, 2),
        })
    return jsonify({
        'ok': True,
        'modo': 'periodos',
        'modo_ingresos': modo_ingresos,
        'incluir_no_contabilizados': incluir_no_contabilizados,
        'filas': filas,
        'total': {
            'ingresos': round(total_ing, 2),
            'gastos': round(total_gas, 2),
            'no_contabilizado': round(total_ncl, 2),
            'beneficio': round(total_ing - total_gas, 2),
        },
    })


def _periodo_a_rango(periodo: str):
    """Convierte 'YYYY-MM' / 'YYYY-Tn' / 'YYYY' a (desde, hasta) ISO."""
    from datetime import date
    p = periodo.strip()
    if len(p) == 4 and p.isdigit():
        return f'{p}-01-01', f'{p}-12-31'
    if 'T' in p:
        y, t = p.split('-T')
        y = int(y); t = int(t)
        m_ini = (t-1)*3 + 1
        m_fin = t*3
        last_day = 31 if m_fin in (1,3,5,7,8,10,12) else 30 if m_fin != 2 else (29 if y%4==0 else 28)
        return f'{y}-{m_ini:02d}-01', f'{y}-{m_fin:02d}-{last_day:02d}'
    if len(p) == 7 and p[4] == '-':
        y, m = p.split('-')
        y = int(y); m = int(m)
        last_day = 31 if m in (1,3,5,7,8,10,12) else 30 if m != 2 else (29 if y%4==0 else 28)
        return f'{y}-{m:02d}-01', f'{y}-{m:02d}-{last_day:02d}'
    raise ValueError(f'periodo invalido: {p}')


@bp.route('/listados/resultados/disponibles', methods=['GET'])
@auth_required
def listado_resultados_disponibles():
    """Devuelve qué meses/trimestres/años tienen al menos 1 movimiento
    (gasto Round o ingreso Odoo) en los últimos 5 años.
    """
    try:
        from datetime import date
        hoy = date.today()
        ini = f'{hoy.year - 5}-01-01'
        # Meses con gastos
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT to_char(fecha_documento, 'YYYY-MM') AS mes
                  FROM gasto_documento
                 WHERE id_manager=%s AND estado='validado'
                   AND fecha_documento >= %s
            """, (g.id_manager, ini))
            meses_gasto = {r['mes'] for r in cur.fetchall() if r['mes']}
        # Meses con ingresos (Odoo)
        meses_ing = set()
        try:
            from ..odoo_cuotas import get_cuotas
            from .. import config as cfg
            oc = get_cuotas()
            inv_ids = oc._call('account.move', 'search', [
                ('move_type','=','out_invoice'),
                ('state','=','posted'),
                ('payment_state','in',['paid','in_payment']),
                ('invoice_date','>=', ini),
                ('company_id','=', cfg.ODOO_COMPANY),
            ])
            if inv_ids:
                invs = oc._call('account.move','read', inv_ids, ['invoice_date'])
                for i in invs:
                    if i.get('invoice_date'):
                        meses_ing.add(str(i['invoice_date'])[:7])
        except Exception as e:
            log.warning(f'disponibles odoo: {e}')

        meses = sorted(meses_gasto | meses_ing, reverse=True)
        # Derivar trimestres y años
        trimestres = set()
        anios = set()
        for m in meses:
            y, mm = m.split('-')
            anios.add(y)
            t = (int(mm) - 1) // 3 + 1
            trimestres.add(f'{y}-T{t}')
        return jsonify({
            'ok': True,
            'meses': meses,
            'trimestres': sorted(trimestres, reverse=True),
            'anios': sorted(anios, reverse=True),
        })
    except Exception as e:
        log.exception('listado_resultados_disponibles')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/listados/resultados', methods=['GET'])
@auth_required
def listado_resultados():
    """Cuenta de resultados (P&L) por período.

    Modos:
      A) Rango: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (compat versión anterior)
      B) Períodos: ?periodos=2024-01,2024-02,2024-T1,2024
         (cada elemento se computa por separado y se devuelve una fila;
          la fila 'total' agrega todos)
    """
    try:
        from datetime import date
        periodos_q = request.args.get('periodos', '').strip()
        # 'reales' (default) = recibos cobrados | 'facturados' = facturas Odoo
        modo_ingresos = (request.args.get('ingresos') or 'reales').strip().lower()
        if modo_ingresos not in ('reales', 'facturados'):
            modo_ingresos = 'reales'
        incluir_ncl = request.args.get('incluir_no_contabilizados') in ('1', 'true', 'yes')

        if periodos_q:
            periodos = [p.strip() for p in periodos_q.split(',') if p.strip()]
            return _resultados_por_periodos(periodos, modo_ingresos, incluir_ncl)

        # Modo rango (legacy)
        desde = request.args.get('desde')
        hasta = request.args.get('hasta')
        if not desde or not hasta:
            hoy = date.today()
            desde = desde or f'{hoy.year}-01-01'
            hasta = hasta or hoy.isoformat()

        # Gastos por mes (Round)
        gastos_mes = {}
        with get_conn() as conn, conn.cursor() as cur:
            wheres = ['d.id_manager=%s', "d.estado='validado'"]
            params = [g.id_manager]
            if g.id_trainer:
                wheres.append('d.id_trainer=%s'); params.append(g.id_trainer)
            wheres.append('d.fecha_documento >= %s'); params.append(desde)
            wheres.append('d.fecha_documento <= %s'); params.append(hasta)
            # Gasto = BASE sin IVA. Si la base es 0 caemos al total para no
            # perder el dato (docs antiguos sin split).
            cur.execute(f"""
                SELECT to_char(d.fecha_documento, 'YYYY-MM') AS mes,
                       COALESCE(SUM(
                         CASE WHEN COALESCE(d.importe_base, 0) > 0 THEN d.importe_base
                              ELSE d.importe_total END
                       ), 0)::numeric(14,2) AS gastos
                  FROM gasto_documento d
                 WHERE {' AND '.join(wheres)}
                 GROUP BY 1
            """, params)
            for r in cur.fetchall():
                gastos_mes[r['mes']] = float(r['gastos'])

        # Ingresos por mes: según modo_ingresos
        ingresos_mes = {}
        if modo_ingresos == 'facturados':
            # Modo facturado: facturas Odoo posteadas (cobradas o no)
            try:
                from ..odoo_cuotas import get_cuotas
                from .. import config as cfg
                oc = get_cuotas()
                inv_ids = oc._call('account.move', 'search', [
                    ('move_type','=','out_invoice'),
                    ('state','=','posted'),
                    ('invoice_date','>=', desde),
                    ('invoice_date','<=', hasta),
                    ('company_id','=', cfg.ODOO_COMPANY),
                ])
                if inv_ids:
                    invs = oc._call('account.move', 'read', inv_ids,
                                    ['invoice_date','amount_untaxed_signed','amount_total_signed'])
                    for i in invs:
                        if not i.get('invoice_date'): continue
                        mes = str(i['invoice_date'])[:7]
                        ingresos_mes[mes] = ingresos_mes.get(mes, 0) + float(i.get('amount_untaxed_signed') or 0)
            except Exception as e:
                log.warning(f'P&L Odoo ingresos: {e}')
        else:
            # Modo reales (default): recibos cobrados en BD propia
            with get_conn() as conn, conn.cursor() as cur:
                wheres = ["id_manager=%s", "estado='pagado'",
                          "fecha_pago::date >= %s", "fecha_pago::date <= %s"]
                params = [str(g.id_manager), desde, hasta]
                if g.id_trainer:
                    wheres.append('(id_trainer=%s OR id_trainer IS NULL)')
                    params.append(str(g.id_trainer))
                cur.execute(f"""
                    SELECT to_char(fecha_pago, 'YYYY-MM') AS mes,
                           COALESCE(SUM(importe_base), 0)::numeric(14,2) AS ingresos
                      FROM recibo
                     WHERE {' AND '.join(wheres)}
                     GROUP BY 1
                """, params)
                for r in cur.fetchall():
                    if r['mes']:
                        ingresos_mes[r['mes']] = float(r['ingresos'])

        # Combinar
        meses = sorted(set(list(gastos_mes.keys()) + list(ingresos_mes.keys())))
        filas = []
        total_ing = total_gas = 0.0
        for m in meses:
            ing = ingresos_mes.get(m, 0)
            gas = gastos_mes.get(m, 0)
            total_ing += ing; total_gas += gas
            filas.append({
                'mes': m,
                'ingresos': round(ing, 2),
                'gastos': round(gas, 2),
                'beneficio': round(ing - gas, 2),
            })
        return jsonify({
            'ok': True,
            'desde': desde, 'hasta': hasta,
            'filas': filas,
            'total': {
                'ingresos': round(total_ing, 2),
                'gastos': round(total_gas, 2),
                'beneficio': round(total_ing - total_gas, 2),
            },
        })
    except Exception as e:
        log.exception('listado_resultados')
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Banco: importar extracto + matching ───────────────────────────────────

@bp.route('/banco/importar', methods=['POST'])
@auth_required
def banco_importar():
    """Sube un extracto bancario (CSV / XLSX) y crea filas en banco_movimiento.

    Form fields:
      file (multipart) — el archivo
      banco (string) — nombre del banco (opcional, descriptivo)
      cuenta_iban (string) — opcional
      id_trainer (string) — opcional, si el extracto pertenece a un trainer
    """
    err = _manager_only()
    if err: return err
    try:
        f = request.files.get('file')
        if not f or not f.filename:
            return jsonify({'ok': False, 'error': 'file_required'}), 400
        ext = Path(f.filename).suffix.lower()
        if ext not in ('.csv', '.txt', '.xlsx'):
            return jsonify({'ok': False, 'error': f'extension_no_soportada:{ext}',
                            'detalle': 'Soportados: .csv, .xlsx'}), 400

        # Guardar el extracto como gasto_documento (categoría extracto_banco)
        # para tener trazabilidad del origen y poder ver el archivo después.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id FROM gasto_categoria
                 WHERE id_manager=%s AND codigo='extracto_banco' LIMIT 1
            """, (g.id_manager,))
            cat_row = cur.fetchone()
        cat_id_extracto = cat_row['id'] if cat_row else None

        path = _storage_path(g.id_manager, request.form.get('id_trainer'),
                             None, 'extracto_banco', f.filename)
        f.save(str(path))
        size = path.stat().st_size

        # Parsear el extracto
        from ..banco_parser import parse_extracto, attach_dedupe_hashes
        result = parse_extracto(path)
        if not result.get('ok'):
            try: path.unlink()
            except Exception: pass
            return jsonify({
                'ok': False, 'error': result.get('error', 'parse_failed'),
                'detalle': result.get('detalle'),
                'columnas_detectadas': result.get('columnas_detectadas'),
            }), 422

        rows = attach_dedupe_hashes(result['rows'])
        log.info(f'banco_importar: {len(rows)} líneas parseadas de {f.filename}')

        # Crear gasto_documento del extracto (1 fila por archivo)
        h = _hash_file(path)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO gasto_documento (
                    id_manager, id_trainer, categoria_id,
                    proveedor, num_factura, fecha_documento,
                    filename_original, storage_path, mime_type, "tamaño_bytes", hash_sha256,
                    estado, subtipo, concepto, created_by
                ) VALUES (
                    %s,%s,%s, %s,%s,%s, %s,%s,%s,%s,%s, 'borrador','otro', %s, 'manager'
                )
                ON CONFLICT DO NOTHING
                RETURNING id
            """, (g.id_manager, request.form.get('id_trainer'), cat_id_extracto,
                  request.form.get('banco') or 'Extracto bancario',
                  f.filename[:80],
                  rows[0]['fecha'] if rows else None,
                  f.filename, str(path), f.mimetype or 'application/octet-stream', size, h,
                  f'Extracto bancario: {len(rows)} movimientos'))
            r = cur.fetchone()
            doc_origen_id = r['id'] if r else None

        # Insertar líneas en banco_movimiento (dedupe por hash)
        inserted = 0; duplicated = 0
        with get_conn() as conn, conn.cursor() as cur:
            for r in rows:
                try:
                    cur.execute("""
                        INSERT INTO banco_movimiento (
                            id_manager, id_trainer, documento_origen_id,
                            banco, cuenta_iban, fecha, fecha_valor, concepto,
                            importe, saldo, ref_externa, estado, hash_dedupe
                        ) VALUES (
                            %s,%s,%s, %s,%s,%s,%s,%s, %s,%s,%s, 'sin_cuadrar', %s
                        )
                        ON CONFLICT (id_manager, hash_dedupe) DO NOTHING
                    """, (
                        g.id_manager, request.form.get('id_trainer'), doc_origen_id,
                        request.form.get('banco') or None,
                        request.form.get('cuenta_iban') or None,
                        r['fecha'], r.get('fecha_valor'), r['concepto'],
                        r['importe'], r.get('saldo'), r.get('ref_externa'),
                        r['hash_dedupe'],
                    ))
                    if cur.rowcount > 0: inserted += 1
                    else: duplicated += 1
                except Exception as e:
                    log.warning(f'banco_movimiento insert fallo: {e}')
        return jsonify({
            'ok': True,
            'archivo': f.filename,
            'parseadas': len(rows),
            'insertadas': inserted,
            'duplicadas': duplicated,
            'documento_origen_id': doc_origen_id,
            'columnas_detectadas': result.get('columnas_detectadas'),
        })
    except Exception as e:
        log.exception('banco_importar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/banco/movimientos', methods=['GET'])
@auth_required
def banco_movimientos():
    """Lista movimientos bancarios con filtros."""
    try:
        wheres = ['m.id_manager=%s']
        params = [g.id_manager]
        if g.id_trainer:
            wheres.append('m.id_trainer=%s'); params.append(g.id_trainer)
        if request.args.get('estado'):
            wheres.append('m.estado=%s'); params.append(request.args['estado'])
        if request.args.get('desde'):
            wheres.append('m.fecha >= %s'); params.append(request.args['desde'])
        if request.args.get('hasta'):
            wheres.append('m.fecha <= %s'); params.append(request.args['hasta'])
        if request.args.get('q'):
            wheres.append('m.concepto ILIKE %s')
            params.append(f"%{request.args['q']}%")
        sql = f"""
            SELECT m.id, m.fecha, m.fecha_valor, m.concepto, m.importe, m.saldo,
                   m.banco, m.cuenta_iban, m.estado, m.factura_relacionada_id,
                   m.ref_externa, m.created_at,
                   d.proveedor AS factura_proveedor, d.num_factura AS factura_num,
                   d.importe_total AS factura_importe
              FROM banco_movimiento m
              LEFT JOIN gasto_documento d ON d.id = m.factura_relacionada_id
             WHERE {' AND '.join(wheres)}
             ORDER BY m.fecha DESC, m.id DESC
             LIMIT 1000
        """
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return jsonify({'ok': True, 'movimientos': rows})
    except Exception as e:
        log.exception('banco_movimientos')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/banco/movimientos/<int:mov_id>', methods=['PATCH'])
@auth_required
def banco_movimiento_link(mov_id):
    """Vincula un movimiento a una factura, lo desvincula o cambia estado.

    Body: { factura_id?, estado? }  — null en factura_id desvincula.
    """
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json() or {}
        factura_id = d.get('factura_id')
        estado = d.get('estado')
        sets, vals = [], []
        if 'factura_id' in d:
            sets.append('factura_relacionada_id=%s'); vals.append(factura_id)
            # Si se asigna factura, marcar cuadrado; si se quita, sin_cuadrar
            sets.append('estado=%s'); vals.append('cuadrado' if factura_id else 'sin_cuadrar')
        if estado and estado in ('sin_cuadrar','cuadrado','manual','ignorado'):
            sets.append('estado=%s'); vals.append(estado)
        if not sets:
            return jsonify({'ok': False, 'error': 'no_fields'}), 400
        vals.extend([mov_id, g.id_manager])
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(f"""
                UPDATE banco_movimiento SET {', '.join(sets)}
                 WHERE id=%s AND id_manager=%s
                RETURNING *
            """, vals)
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        return jsonify({'ok': True, 'movimiento': row})
    except Exception as e:
        log.exception('banco_movimiento_link')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/banco/matching', methods=['POST'])
@auth_required
def banco_matching():
    """Ejecuta matching 1:1 entre movimientos sin cuadrar y facturas validadas.

    Body opcional: { auto_apply: bool } — si True, los matches con score≥80
    se aplican directamente (estado=cuadrado + factura_relacionada_id).
    """
    err = _manager_only()
    if err: return err
    try:
        d = request.get_json(silent=True) or {}
        auto_apply = bool(d.get('auto_apply', False))

        with get_conn() as conn, conn.cursor() as cur:
            # Movimientos sin cuadrar (signo negativo = gasto típicamente)
            cur.execute("""
                SELECT id, fecha, concepto, importe, ref_externa
                  FROM banco_movimiento
                 WHERE id_manager=%s AND estado='sin_cuadrar'
                 ORDER BY fecha DESC LIMIT 500
            """, (g.id_manager,))
            movs = [dict(r) for r in cur.fetchall()]
            # Facturas validadas (no extractos) sin movimiento ya vinculado
            cur.execute("""
                SELECT d.id, d.fecha_documento, d.proveedor, d.num_factura, d.importe_total
                  FROM gasto_documento d
                  LEFT JOIN gasto_categoria c ON c.id = d.categoria_id
                 WHERE d.id_manager=%s AND d.estado='validado'
                   AND COALESCE(c.tipo, 'gasto') <> 'banco'
                   AND NOT EXISTS (
                     SELECT 1 FROM banco_movimiento bm
                      WHERE bm.id_manager=d.id_manager AND bm.factura_relacionada_id=d.id
                   )
                 ORDER BY d.fecha_documento DESC LIMIT 1000
            """, (g.id_manager,))
            facs = [dict(r) for r in cur.fetchall()]

        from ..banco_matcher import proponer_matches, THRESHOLD_AUTO_MATCH
        matches = proponer_matches(movs, facs)

        applied = 0
        if auto_apply and matches:
            with get_conn() as conn, conn.cursor() as cur:
                for m in matches:
                    if m['accion'] != 'auto': continue
                    cur.execute("""
                        UPDATE banco_movimiento
                           SET factura_relacionada_id=%s, estado='cuadrado'
                         WHERE id=%s AND id_manager=%s AND estado='sin_cuadrar'
                    """, (m['factura_id'], m['movimiento_id'], g.id_manager))
                    if cur.rowcount > 0: applied += 1
        return jsonify({
            'ok': True,
            'movimientos_sin_cuadrar': len(movs),
            'facturas_disponibles': len(facs),
            'matches_propuestos': len(matches),
            'auto_aplicados': applied,
            'umbral_auto': THRESHOLD_AUTO_MATCH,
            'matches': matches,
        })
    except Exception as e:
        log.exception('banco_matching')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/documentos/<int:doc_id>', methods=['DELETE'])
@auth_required
def delete_documento(doc_id):
    err = _manager_only()
    if err: return err
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT storage_path, odoo_move_id FROM gasto_documento
                 WHERE id=%s AND id_manager=%s
            """, (doc_id, g.id_manager))
            row = cur.fetchone()
        if not row:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if row.get('odoo_move_id'):
            return jsonify({'ok': False, 'error': 'tiene_apunte_odoo',
                            'detalle': 'Anula primero el apunte en Odoo o usa rechazar'}), 409
        # Borrar archivo + fila
        try:
            p = Path(row['storage_path'])
            if p.exists(): p.unlink()
        except Exception:
            pass
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM gasto_documento WHERE id=%s AND id_manager=%s",
                        (doc_id, g.id_manager))
        return jsonify({'ok': True, 'deleted': True})
    except Exception as e:
        log.exception('delete_documento')
        return jsonify({'ok': False, 'error': str(e)}), 500
