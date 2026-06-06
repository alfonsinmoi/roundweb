"""POS — gestión de productos, categorías y subida de media (Fase 1).

Catálogo de productos/servicios vendibles desde el TPV (terminal de caja).
Categorías: sembrado global (plantilla) + override per-manager (mismo patrón
que `convenio` / `pausa_motivo`).

Productos: per-trainer (cada CENTRO físico tiene su propio catálogo).
El TPV solo mostrará los `active=true` y `archived_at IS NULL` del
trainer en el que está logueado el operador.

Política scope (mayo 2026, override explícito): los productos SÍ son
trainer-scoped porque cada centro maneja stock, surtido y precios
independientes. El código UNIQUE se aplica por (manager, trainer, codigo)
— el mismo `CAMISETA-M` puede existir en dos centros sin colisionar.
Manager bare ve productos de todos sus trainers (con columna "Centro" en
la UI) y puede filtrar con `?id_trainer=X`.

Endpoints:
  ── Categorías ─────────────────────────────────────────────────────────
  GET    /api/pos/categorias              listado (plantilla + del manager)
  POST   /api/pos/categorias              crea categoría per-manager
  PATCH  /api/pos/categorias/<id>         edita (solo per-manager, no plantilla)
  DELETE /api/pos/categorias/<id>         archiva (active=false)

  ── Productos ──────────────────────────────────────────────────────────
  GET    /api/pos/productos               listado (?active=1, ?cat=ID, ?q=texto)
  GET    /api/pos/productos/<id>          ficha
  POST   /api/pos/productos               crea
  PATCH  /api/pos/productos/<id>          edita
  POST   /api/pos/productos/<id>/archivar archiva (active=false + archived_at)
  POST   /api/pos/productos/<id>/restaurar deshace archivar

  ── Stock ──────────────────────────────────────────────────────────────
  POST   /api/pos/productos/<id>/stock/ajuste  body {cantidad, motivo}
  GET    /api/pos/productos/<id>/stock/historial  movimientos del producto
"""
import logging
import datetime as dt
import os, uuid, mimetypes
from flask import Blueprint, request, jsonify, g
from werkzeug.utils import secure_filename

from ..auth import auth_required, require_permission   # noqa: F401  (require_permission usado abajo)
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('pos_productos', __name__)
log = logging.getLogger(__name__)


TIPOS_VALIDOS = {'producto', 'servicio'}


# ═══════════════════════════════════════════════════════════════════════
#                            CATEGORÍAS
# ═══════════════════════════════════════════════════════════════════════

@bp.route('/categorias', methods=['GET'])
@auth_required
@require_permission('configuracion.pos.productos_ver')
def list_categorias():
    """Lista categorías: plantilla global (id_manager IS NULL) + las del
    manager. Activas por defecto; pasar ?incluir_inactivas=1 para verlas todas.
    """
    incluir_inactivas = request.args.get('incluir_inactivas') == '1'
    where = "(id_manager IS NULL OR id_manager = %s)"
    vals = [str(g.id_manager)]
    if not incluir_inactivas:
        where += " AND active = TRUE"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT id, id_manager, nombre, icono, color, orden, active,
                   id_manager IS NULL AS es_plantilla,
                   created_at, updated_at
              FROM pos_categoria
             WHERE {where}
             ORDER BY orden, nombre
        """, vals)
        return jsonify({'ok': True, 'categorias': cur.fetchall()})


@bp.route('/categorias', methods=['POST'])
@auth_required
@require_permission('configuracion.pos.categorias_editar')
def create_categoria():
    d = request.get_json() or {}
    nombre = (d.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_required'}), 400
    actor = actor_from_request()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO pos_categoria
              (id_manager, nombre, icono, color, orden, active)
            VALUES (%s, %s, %s, %s, %s, TRUE)
            ON CONFLICT (COALESCE(id_manager, ''), nombre) DO UPDATE
              SET icono = EXCLUDED.icono,
                  color = EXCLUDED.color,
                  orden = EXCLUDED.orden,
                  active = TRUE
            RETURNING *
        """, (str(g.id_manager), nombre,
              d.get('icono') or '📦',
              d.get('color') or '#10b981',
              int(d.get('orden') or 50)))
        row = cur.fetchone()
    log_action(actor, entidad='pos_categoria', entidad_id=row['id'],
               accion='create', resumen=f'Categoría POS: {nombre}')
    return jsonify({'ok': True, 'categoria': row}), 201


@bp.route('/categorias/<int:cid>', methods=['PATCH'])
@auth_required
@require_permission('configuracion.pos.categorias_editar')
def update_categoria(cid):
    """Solo se editan categorías per-manager. Las plantilla (id_manager NULL)
    son inmutables — si el operador las quiere modificar, debe crear una
    suya con el mismo nombre."""
    d = request.get_json() or {}
    sets, vals = [], []
    for f in ('nombre', 'icono', 'color', 'orden', 'active'):
        if f in d:
            sets.append(f'{f} = %s')
            vals.append(d[f])
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    vals.extend([cid, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE pos_categoria SET {', '.join(sets)}
             WHERE id = %s AND id_manager = %s
            RETURNING *
        """, vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False,
                        'error': 'not_found_or_plantilla',
                        'detalle': 'Las categorías plantilla globales no son editables.'}), 404
    log_action(actor_from_request(), entidad='pos_categoria',
               entidad_id=cid, accion='update', cambios=d)
    return jsonify({'ok': True, 'categoria': row})


@bp.route('/categorias/<int:cid>', methods=['DELETE'])
@auth_required
@require_permission('configuracion.pos.categorias_editar')
def archive_categoria(cid):
    """Archiva una categoría per-manager (active=false). No borra para no
    romper FK de productos existentes."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE pos_categoria SET active = FALSE
                        WHERE id = %s AND id_manager = %s
                       RETURNING id""",
                    (cid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='pos_categoria',
               entidad_id=cid, accion='archive')
    return jsonify({'ok': True})


# ═══════════════════════════════════════════════════════════════════════
#                            PRODUCTOS
# ═══════════════════════════════════════════════════════════════════════

def _cuenta_default(tipo):
    """Cuenta contable PGC por defecto según tipo."""
    return '700' if tipo == 'producto' else '705'


def _row_to_dict(r):
    """Adapta tipos de psycopg → JSON-friendly."""
    if not r: return None
    out = dict(r)
    for k in ('created_at', 'updated_at', 'archived_at'):
        if out.get(k) and hasattr(out[k], 'isoformat'):
            out[k] = out[k].isoformat()
    for k in ('precio_venta', 'iva_pct', 'coste', 'stock_actual', 'stock_minimo'):
        if out.get(k) is not None:
            out[k] = float(out[k])
    return out


@bp.route('/productos', methods=['GET'])
@auth_required
@require_permission('configuracion.pos.productos_ver')
def list_productos():
    """Lista productos del manager. Filtros:
       ?active=0|1     (default 1 = activos)
       ?archivados=1   → solo archivados
       ?cat=ID         → categoría concreta
       ?tipo=producto|servicio
       ?q=texto        → busca en código/nombre/descripción
       ?id_trainer=X   → override explícito del trainer (manager bare puede
                         filtrar a un centro concreto)

    Política trainer (mayo 2026): productos son per-trainer (cada centro su
    catálogo). Si el usuario está impersonando un trainer, filtramos a su
    centro. Si es manager bare, devuelve TODOS los productos del manager
    (puede filtrar con `?id_trainer=X` si quiere uno solo).
    """
    qs = request.args
    where = ['p.id_manager = %s']
    vals = [str(g.id_manager)]
    target_trainer = (qs.get('id_trainer') or '').strip() or g.id_trainer
    if target_trainer:
        where.append('p.id_trainer = %s')
        vals.append(str(target_trainer))
    activos_only = qs.get('archivados') != '1' and qs.get('active', '1') == '1'
    if qs.get('archivados') == '1':
        where.append('p.archived_at IS NOT NULL')
    elif activos_only:
        where.append('p.active = TRUE AND p.archived_at IS NULL')
    if qs.get('cat'):
        where.append('p.categoria_id = %s')
        vals.append(int(qs['cat']))
    if qs.get('tipo') in TIPOS_VALIDOS:
        where.append('p.tipo = %s')
        vals.append(qs['tipo'])
    if qs.get('q'):
        where.append('(p.codigo ILIKE %s OR p.nombre ILIKE %s OR p.descripcion ILIKE %s)')
        q = f'%{qs["q"]}%'
        vals.extend([q, q, q])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT p.*, c.nombre AS categoria_nombre, c.icono AS categoria_icono,
                   c.color AS categoria_color
              FROM pos_producto p
              LEFT JOIN pos_categoria c ON c.id = p.categoria_id
             WHERE {' AND '.join(where)}
             ORDER BY p.nombre
        """, vals)
        return jsonify({'ok': True,
                        'productos': [_row_to_dict(r) for r in cur.fetchall()]})


@bp.route('/productos/<int:pid>', methods=['GET'])
@auth_required
@require_permission('configuracion.pos.productos_ver')
def get_producto(pid):
    with get_conn() as conn, conn.cursor() as cur:
        # Mismo cuidado con prefijo `p.` por el JOIN (ver `list_productos`).
        cur.execute("""
            SELECT p.*, c.nombre AS categoria_nombre,
                   c.icono AS categoria_icono, c.color AS categoria_color
              FROM pos_producto p
              LEFT JOIN pos_categoria c ON c.id = p.categoria_id
             WHERE p.id = %s AND p.id_manager = %s
        """, (pid, str(g.id_manager)))
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    return jsonify({'ok': True, 'producto': _row_to_dict(row)})


@bp.route('/productos', methods=['POST'])
@auth_required
@require_permission('configuracion.pos.productos_editar')
def create_producto():
    d = request.get_json() or {}
    codigo = (d.get('codigo') or '').strip().upper()
    nombre = (d.get('nombre') or '').strip()
    tipo = (d.get('tipo') or 'producto').strip().lower()
    if not codigo:
        return jsonify({'ok': False, 'error': 'codigo_required'}), 400
    if not nombre:
        return jsonify({'ok': False, 'error': 'nombre_required'}), 400
    if tipo not in TIPOS_VALIDOS:
        return jsonify({'ok': False, 'error': f'tipo_invalido (acepta: {sorted(TIPOS_VALIDOS)})'}), 400
    precio = float(d.get('precio_venta') or 0)
    if precio < 0:
        return jsonify({'ok': False, 'error': 'precio_invalido'}), 400
    iva = float(d.get('iva_pct') or 21.0)
    if iva < 0 or iva > 30:
        return jsonify({'ok': False, 'error': 'iva_invalido'}), 400
    cuenta = (d.get('cuenta_contable') or '').strip() or _cuenta_default(tipo)
    inventariable = bool(d.get('inventariable'))
    # Trainer obligatorio: del body (manager puede crear catálogos de centros
    # concretos sin impersonar) o del impersonado.
    target_trainer = (d.get('id_trainer') or '').strip() or g.id_trainer
    if not target_trainer:
        return jsonify({'ok': False, 'error': 'id_trainer_required',
                        'detalle': ('Los productos son per-trainer. Indica '
                                    '`id_trainer` en el body o impersona un '
                                    'centro antes de crear.')}), 400
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'tpv'
    stock_inicial = float(d.get('stock_actual') or 0) if inventariable else 0
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO pos_producto
                  (id_manager, id_trainer, codigo, nombre, descripcion,
                   categoria_id, tipo,
                   precio_venta, iva_pct, coste, cuenta_contable,
                   inventariable, stock_actual, stock_minimo,
                   imagen_url, video_url, notas)
                VALUES (%s, %s, %s, %s, %s,
                        %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s)
                RETURNING id
            """, (
                str(g.id_manager), str(target_trainer),
                codigo, nombre, d.get('descripcion'),
                d.get('categoria_id'), tipo,
                precio, iva, d.get('coste'), cuenta,
                inventariable, stock_inicial,
                float(d.get('stock_minimo') or 0) if inventariable else 0,
                d.get('imagen_url'), d.get('video_url'),
                d.get('notas'),
            ))
            pid = cur.fetchone()['id']
            # Sprint 5 #1 — registrar el stock sembrado como movimiento
            # 'alta_inicial' para que el histórico cuadre (stock_actual
            # = Σ(movimientos.cantidad) siempre).
            if inventariable and stock_inicial > 0:
                cur.execute("""
                    INSERT INTO pos_stock_movimiento
                      (id_manager, id_trainer, producto_id, tipo, cantidad,
                       stock_antes, stock_despues, motivo, created_by)
                    VALUES (%s, %s, %s, 'alta_inicial', %s, 0, %s,
                            'Apertura del producto', %s)
                """, (str(g.id_manager), str(target_trainer), pid,
                      stock_inicial, stock_inicial, actor_label))
    except Exception as e:
        # Conflicto código único o similar
        msg = str(e)
        if 'uq_pos_producto_codigo' in msg or 'duplicate key' in msg:
            return jsonify({'ok': False, 'error': 'codigo_duplicado'}), 409
        log.exception('create_producto')
        return jsonify({'ok': False, 'error': str(e)}), 500
    log_action(actor, entidad='pos_producto', entidad_id=pid,
               accion='create',
               resumen=f'Producto creado: {codigo} {nombre} ({precio:.2f}€)')
    return jsonify({'ok': True, 'id': pid}), 201


@bp.route('/productos/<int:pid>', methods=['PATCH'])
@auth_required
@require_permission('configuracion.pos.productos_editar')
def update_producto(pid):
    d = request.get_json() or {}
    allowed = ['codigo', 'nombre', 'descripcion', 'categoria_id', 'tipo',
               'precio_venta', 'iva_pct', 'coste', 'cuenta_contable',
               'inventariable', 'stock_minimo', 'imagen_url', 'video_url',
               'notas', 'active', 'id_trainer']
    sets, vals = [], []
    for f in allowed:
        if f in d:
            v = d[f]
            if f == 'codigo' and v:
                v = v.strip().upper()
            elif f == 'tipo' and v not in TIPOS_VALIDOS:
                return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
            sets.append(f'{f} = %s')
            vals.append(v)
    if not sets:
        return jsonify({'ok': False, 'error': 'no_fields'}), 400
    vals.extend([pid, str(g.id_manager)])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE pos_producto SET {', '.join(sets)}
             WHERE id = %s AND id_manager = %s
            RETURNING id
        """, vals)
        row = cur.fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    log_action(actor_from_request(), entidad='pos_producto',
               entidad_id=pid, accion='update', cambios=d)
    return jsonify({'ok': True})


@bp.route('/productos/<int:pid>/archivar', methods=['POST'])
@auth_required
@require_permission('configuracion.pos.productos_archivar')
def archivar_producto(pid):
    """Archiva: active=false + archived_at=now. NO se borra para preservar
    histórico de ventas anteriores."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE pos_producto
               SET active = FALSE, archived_at = NOW()
             WHERE id = %s AND id_manager = %s AND archived_at IS NULL
            RETURNING id
        """, (pid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found_or_archivado'}), 404
    log_action(actor_from_request(), entidad='pos_producto',
               entidad_id=pid, accion='archive')
    return jsonify({'ok': True})


@bp.route('/productos/<int:pid>/restaurar', methods=['POST'])
@auth_required
@require_permission('configuracion.pos.productos_archivar')
def restaurar_producto(pid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE pos_producto
               SET active = TRUE, archived_at = NULL
             WHERE id = %s AND id_manager = %s AND archived_at IS NOT NULL
            RETURNING id
        """, (pid, str(g.id_manager)))
        if not cur.fetchone():
            return jsonify({'ok': False, 'error': 'not_found_or_no_archivado'}), 404
    log_action(actor_from_request(), entidad='pos_producto',
               entidad_id=pid, accion='restore')
    return jsonify({'ok': True})


# ═══════════════════════════════════════════════════════════════════════
#                              STOCK
# ═══════════════════════════════════════════════════════════════════════

@bp.route('/productos/<int:pid>/stock/ajuste', methods=['POST'])
@auth_required
@require_permission('configuracion.pos.stock_ajuste')
def ajuste_stock(pid):
    """Ajuste manual de stock (entrada por reposición / baja / corrección).
    body: {cantidad: float (positiva entrada, negativa salida), motivo: str,
           tipo?: 'reposicion'|'ajuste'|'baja' (default 'ajuste')}
    """
    d = request.get_json() or {}
    cantidad = d.get('cantidad')
    if cantidad is None:
        return jsonify({'ok': False, 'error': 'cantidad_required'}), 400
    try:
        cantidad = float(cantidad)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'cantidad_invalida'}), 400
    if cantidad == 0:
        return jsonify({'ok': False, 'error': 'cantidad_cero'}), 400
    tipo = (d.get('tipo') or 'ajuste').strip().lower()
    if tipo not in ('reposicion', 'ajuste', 'baja'):
        return jsonify({'ok': False, 'error': 'tipo_invalido'}), 400
    motivo = (d.get('motivo') or '').strip() or None
    actor = actor_from_request()
    actor_label = actor.get('label') or actor.get('email') or 'pos'

    with get_conn() as conn, conn.cursor() as cur:
        # Lock + lee stock actual (también trainer para propagar al movimiento)
        cur.execute("""SELECT stock_actual, inventariable, id_trainer
                         FROM pos_producto
                        WHERE id = %s AND id_manager = %s FOR UPDATE""",
                    (pid, str(g.id_manager)))
        p = cur.fetchone()
        if not p:
            return jsonify({'ok': False, 'error': 'not_found'}), 404
        if not p['inventariable']:
            return jsonify({'ok': False, 'error': 'producto_no_inventariable'}), 400
        antes = float(p['stock_actual'] or 0)
        despues = antes + cantidad
        cur.execute("""UPDATE pos_producto
                          SET stock_actual = %s
                        WHERE id = %s""",
                    (despues, pid))
        cur.execute("""
            INSERT INTO pos_stock_movimiento
              (id_manager, id_trainer, producto_id, tipo, cantidad,
               stock_antes, stock_despues, motivo, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (str(g.id_manager), p['id_trainer'], pid, tipo, cantidad,
              antes, despues, motivo, actor_label))
        mov_id = cur.fetchone()['id']

    log_action(actor, entidad='pos_producto', entidad_id=pid,
               accion='stock_ajuste',
               resumen=f'Stock {antes:+g} → {despues:+g} ({tipo}: {motivo or "—"})')
    return jsonify({'ok': True, 'movimiento_id': mov_id,
                    'stock_antes': antes, 'stock_despues': despues})


@bp.route('/productos/<int:pid>/stock/historial', methods=['GET'])
@auth_required
@require_permission('configuracion.pos.productos_ver')
def historial_stock(pid):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, tipo, cantidad, stock_antes, stock_despues,
                   venta_id, motivo, created_by, created_at
              FROM pos_stock_movimiento
             WHERE producto_id = %s AND id_manager = %s
             ORDER BY created_at DESC
             LIMIT 200
        """, (pid, str(g.id_manager)))
        return jsonify({'ok': True, 'movimientos': cur.fetchall()})


# ═══════════════════════════════════════════════════════════════════════
#                         UPLOAD MEDIA (imágenes/vídeos)
# ═══════════════════════════════════════════════════════════════════════
# Almacenamiento físico: /var/www/round/uploads/pos/<manager>/<uuid>.<ext>
# nginx sirve este path bajo https://noofit.wiemspro.com/uploads/pos/...
# (location ^~ /uploads/ → alias /var/www/round/uploads/).
# El cliente recibe la URL pública y la guarda en pos_producto.imagen_url
# / video_url igual que si fuera externa.

UPLOAD_ROOT = '/var/www/round/uploads/pos'
PUBLIC_URL_BASE = '/uploads/pos'        # path-relative — el frontend lo expande
MAX_IMAGE_BYTES = 10 * 1024 * 1024      # 10 MB
MAX_VIDEO_BYTES = 80 * 1024 * 1024      # 80 MB (nginx cap = 100M)
IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'}
VIDEO_EXTS = {'.mp4', '.webm', '.mov', '.m4v'}


@bp.route('/upload-media', methods=['POST'])
@auth_required
@require_permission('configuracion.pos.productos_editar')
def upload_media():
    """Sube imagen o vídeo del producto al servidor y devuelve la URL pública.

    multipart/form-data:
      file: el archivo (REQUERIDO)
      kind: 'image' | 'video' (opcional — se infiere por extensión)

    Respuesta: {ok, url, kind, size, filename}
    """
    if 'file' not in request.files:
        return jsonify({'ok': False, 'error': 'file_required'}), 400
    f = request.files['file']
    if not f or not f.filename:
        return jsonify({'ok': False, 'error': 'file_empty'}), 400

    orig = secure_filename(f.filename)
    ext = os.path.splitext(orig)[1].lower()
    if not ext:
        return jsonify({'ok': False, 'error': 'ext_required'}), 400

    kind = (request.form.get('kind') or '').strip().lower()
    if not kind:
        if ext in IMAGE_EXTS: kind = 'image'
        elif ext in VIDEO_EXTS: kind = 'video'
        else:
            return jsonify({'ok': False, 'error': 'ext_invalido',
                            'detalle': f'Extensiones permitidas: '
                                       f'imágenes {sorted(IMAGE_EXTS)}, '
                                       f'vídeos {sorted(VIDEO_EXTS)}'}), 400
    if kind == 'image' and ext not in IMAGE_EXTS:
        return jsonify({'ok': False, 'error': 'ext_image_invalida'}), 400
    if kind == 'video' and ext not in VIDEO_EXTS:
        return jsonify({'ok': False, 'error': 'ext_video_invalida'}), 400

    # Tamaño — leemos el stream una vez para medir, luego rewind.
    f.stream.seek(0, os.SEEK_END)
    size = f.stream.tell()
    f.stream.seek(0)
    cap = MAX_VIDEO_BYTES if kind == 'video' else MAX_IMAGE_BYTES
    if size > cap:
        return jsonify({'ok': False, 'error': 'tamano_excedido',
                        'detalle': f'Máximo {cap // (1024*1024)} MB '
                                   f'para {kind}.'}), 413

    # Guardar bajo subdir per-manager. auth_required ya garantiza que
    # g.id_manager es \d{1,16} — sin esa validación lo siguiente sería
    # vulnerable a path traversal. Aun así, validación defensiva por si
    # algún flujo futuro construye g.id_manager por otra vía.
    subdir = str(g.id_manager)
    if not subdir.isdigit():
        return jsonify({'ok': False, 'error': 'invalid_manager_id'}), 400
    upload_root_real = os.path.realpath(UPLOAD_ROOT)
    target_dir = os.path.join(UPLOAD_ROOT, subdir)
    # Anti path-traversal: tras resolver realpath, target_dir debe seguir
    # bajo upload_root_real. Bloquea '..' incrustados, symlinks que apunten
    # fuera y rutas absolutas dentro del subdir.
    target_dir_real = os.path.realpath(target_dir)
    if not (target_dir_real == upload_root_real or
            target_dir_real.startswith(upload_root_real + os.sep)):
        return jsonify({'ok': False, 'error': 'path_escape_detected'}), 400
    try:
        os.makedirs(target_dir, exist_ok=True)
    except Exception as e:
        log.exception('mkdir uploads')
        return jsonify({'ok': False, 'error': 'storage_unavailable',
                        'detalle': str(e)}), 500

    new_name = f'{uuid.uuid4().hex}{ext}'
    target_path = os.path.join(target_dir, new_name)
    try:
        f.save(target_path)
        os.chmod(target_path, 0o644)
    except Exception as e:
        log.exception('save upload')
        return jsonify({'ok': False, 'error': 'save_failed',
                        'detalle': str(e)}), 500

    public_url = f'{PUBLIC_URL_BASE}/{subdir}/{new_name}'
    log_action(actor_from_request(), entidad='pos_upload',
               accion='upload',
               resumen=f'{kind} {orig} → {public_url} ({size} bytes)')
    return jsonify({'ok': True, 'url': public_url,
                    'kind': kind, 'size': size,
                    'filename': orig})


@bp.route('/upload-media', methods=['DELETE'])
@auth_required
@require_permission('configuracion.pos.productos_editar')
def delete_media():
    """Elimina un archivo subido. Body: {url: '/uploads/pos/.../...'}
    Solo borra archivos bajo /uploads/pos/<este-manager>/ — el path se
    valida estrictamente para evitar path traversal.
    """
    d = request.get_json() or {}
    url = (d.get('url') or '').strip()
    prefix = f'{PUBLIC_URL_BASE}/{g.id_manager}/'
    if not url.startswith(prefix):
        return jsonify({'ok': False, 'error': 'url_invalida'}), 400
    fname = url[len(prefix):]
    # bloquea path traversal
    if '/' in fname or '..' in fname or fname.startswith('.'):
        return jsonify({'ok': False, 'error': 'fname_invalido'}), 400
    target = os.path.join(UPLOAD_ROOT, str(g.id_manager), fname)
    if not os.path.isfile(target):
        return jsonify({'ok': False, 'error': 'no_existe'}), 404
    try:
        os.remove(target)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500
    return jsonify({'ok': True})
