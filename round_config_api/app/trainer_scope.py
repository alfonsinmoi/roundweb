"""Helpers de aislamiento por trainer (mayo 2026).

Contexto: un manager puede tener varios trainers. Cuando un usuario_web está
logueado y su JWT trae el claim `trn`, `g.id_trainer` queda fijado al trainer
"impersonado" — toda query/listado debe limitarse a ese trainer para evitar
fugas cross-trainer dentro del mismo manager.

Tres tipos de restricción:

1. Tablas con columna `id_trainer` propia (recibo, cliente_nota, social_post,
   centro_contacto, etc.). Usar `apply_trainer_filter_direct()`.

2. Tablas con `cliente_idnoofit` pero SIN columna trainer (forma_pago_cliente,
   descuento_asignacion, cliente_atendido_banner, etc.). El trainer del
   cliente vive en `cliente_cache.id_trainer`. Usar `apply_trainer_filter_via_cache()`.

3. Resultados de Odoo (account.move, round.subscription) cuyo `partner_id`
   se cruza con `cliente_cache.id_noofit` (`= cliente_cache.id`). Usar
   `clientes_id_noofit_del_trainer()` para obtener el conjunto y post-filtrar
   en memoria, o pasar el conjunto al dominio Odoo.

Todas las funciones miran `g.id_manager` y `g.id_trainer` (flask.g) puestos
por `@auth_required`. Si `g.id_trainer` es falsy (manager bare, sin
impersonación), no se añade filtro adicional — el manager ve todo.
"""
from flask import g
from .db import get_conn


def apply_trainer_filter_direct(where_clauses, vals, trainer_col='id_trainer',
                                include_nulls=True):
    """Añade filtro `AND <trainer_col> = %s [OR <trainer_col> IS NULL]` cuando
    g.id_trainer está fijado. Útil para tablas que tienen su propia columna
    `id_trainer` (recibo, cliente_nota, social_post, etc.).

    include_nulls=True (default) acepta filas con `id_trainer IS NULL` —
    son típicamente catálogos manager-wide visibles para todos los trainers.
    """
    tid = getattr(g, 'id_trainer', None)
    if not tid:
        return where_clauses, vals
    if include_nulls:
        where_clauses.append(f'({trainer_col} = %s OR {trainer_col} IS NULL)')
    else:
        where_clauses.append(f'{trainer_col} = %s')
    vals.append(str(tid))
    return where_clauses, vals


def apply_trainer_filter_via_cache(where_clauses, vals, cliente_col='cliente_idnoofit'):
    """Restringe a registros cuyo cliente pertenece al trainer impersonado,
    consultando `cliente_cache`. Útil para tablas que solo tienen
    `cliente_idnoofit` pero no `id_trainer`.
    """
    tid = getattr(g, 'id_trainer', None)
    if not tid:
        return where_clauses, vals
    where_clauses.append(
        f'{cliente_col} IN ('
        f'  SELECT id::text FROM cliente_cache '
        f'   WHERE id_manager = %s AND id_trainer = %s'
        f')'
    )
    vals.extend([str(g.id_manager), str(tid)])
    return where_clauses, vals


def clientes_id_noofit_del_trainer(id_manager=None, id_trainer=None):
    """Devuelve un set de strings con los id_noofit (= cliente_cache.id) que
    pertenecen al trainer impersonado. Usado para post-filtrar resultados
    de Odoo (account.move.partner_idnoofit, round.subscription.partner...)
    en memoria.

    Si no hay trainer impersonado, devuelve None — el llamador interpreta
    None como "sin filtro adicional".
    """
    id_manager = id_manager or getattr(g, 'id_manager', None)
    id_trainer = id_trainer or getattr(g, 'id_trainer', None)
    if not id_trainer:
        return None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id FROM cliente_cache
             WHERE id_manager = %s AND id_trainer = %s
        """, (str(id_manager), str(id_trainer)))
        return {str(r['id']) for r in cur.fetchall()}


def trainer_bloquea(row_id_trainer):
    """Para endpoints de DETALLE/MUTACIÓN por id: devuelve True si hay un
    `g.id_trainer` fijado (usuario_web atado a un centro) y NO coincide con el
    `id_trainer` de la fila → el endpoint debe responder 404/403 en vez de
    exponer/mutar el recurso de otro trainer.

    Si no hay trainer fijado (manager bare) → False (no bloquea).
    `row_id_trainer` NULL en la fila → se bloquea para un trainer concreto
    (un recurso sin trainer no pertenece a un centro específico); cámbialo a
    medida si algún recurso NULL debe ser visible para todos.
    """
    tid = getattr(g, 'id_trainer', None)
    if not tid:
        return False
    return str(row_id_trainer or '') != str(tid)


def clientes_id_noofit_del_manager(id_manager=None):
    """Set de id_noofit (= cliente_cache.id) que pertenecen a ESTE manager.

    Sirve para aislar resultados de Odoo cuando varios managers comparten la
    MISMA company Odoo (p.ej. 17674 Añoreta y 17675 Málaga comparten company 3):
    el `company_id` que inyecta OdooCuotas no los separa, así que filtramos por
    los clientes del manager para que un manager no vea recibos de otro.

    Devuelve None (= no filtrar) si no hay manager o si el manager no tiene
    clientes en cache — así una cache vacía/sin sincronizar no oculta todo.
    """
    id_manager = id_manager or getattr(g, 'id_manager', None)
    if not id_manager:
        return None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM cliente_cache WHERE id_manager = %s",
                    (str(id_manager),))
        ids = {str(r['id']) for r in cur.fetchall()}
    return ids or None


def cliente_pertenece_a_trainer(cliente_idnoofit):
    """Devuelve True si el cliente_idnoofit dado pertenece al trainer
    impersonado (o si no hay trainer impersonado → siempre True).

    Útil para endpoints de DETALLE por cliente (`GET /api/X/cliente/<id>`):
    devolver 404 si el cliente no es del trainer en vez de exponer datos.
    """
    tid = getattr(g, 'id_trainer', None)
    if not tid:
        return True
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM cliente_cache
             WHERE id_manager = %s AND id_trainer = %s AND id = %s
             LIMIT 1
        """, (str(g.id_manager), str(tid), int(cliente_idnoofit) if str(cliente_idnoofit).isdigit() else 0))
        return cur.fetchone() is not None
