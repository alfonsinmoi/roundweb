"""Helpers para gestión de analytic accounts per-trainer (Fase 4).

Conceptos:

  - `manager_config.odoo_analytic_default_id`: analytic "GENERAL" donde
    van por defecto todos los movimientos del manager. Se crea en el
    paso 7 del provisioner.

  - `trainer_odoo_config`: por cada trainer del manager, indica si
    `heredar_contabilidad` (default true → usa el default del manager) o
    si tiene `analytic_account_id` propio (porque `heredar=false`).

  - Función pública `resolve_analytic(id_manager, id_trainer)` que devuelve
    el `account.analytic.account.id` a usar en cualquier movimiento.
    Devuelve `None` si el manager NO tiene contabilidad desplegada todavía
    (se ignora analytic en ese caso).

  - Función pública `set_trainer_independent(id_manager, id_trainer,
    nombre_trainer)` que pasa a un trainer de "heredar" a "no heredar":
    crea su analytic propio en Odoo + UPDATE trainer_odoo_config.
"""
import logging

from .db import get_conn

log = logging.getLogger(__name__)


def _manager_row(id_manager):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT odoo_company_id, odoo_analytic_plan_id, odoo_analytic_default_id
              FROM manager_config WHERE id_manager = %s
        """, (str(id_manager),))
        return cur.fetchone()


def _trainer_row(id_manager, id_trainer):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT heredar_contabilidad, analytic_account_id
              FROM trainer_odoo_config
             WHERE id_manager = %s AND id_trainer = %s
        """, (str(id_manager), str(id_trainer)))
        return cur.fetchone()


def resolve_analytic(id_manager, id_trainer=None):
    """Devuelve el `account.analytic.account.id` a usar para movimientos
    de `(id_manager, id_trainer)`.

    Lógica:
      - Si el manager no tiene Odoo desplegado o no tiene default analytic
        configurado → None (los movimientos no llevan analytic).
      - Si `id_trainer` es None → usa el default del manager.
      - Si hay fila trainer_odoo_config con `heredar=false` y
        `analytic_account_id` → ese analytic propio.
      - En otros casos → default del manager.
    """
    mgr = _manager_row(id_manager)
    if not mgr or not mgr.get('odoo_analytic_default_id'):
        return None
    default_id = mgr['odoo_analytic_default_id']
    if not id_trainer:
        return default_id
    t = _trainer_row(id_manager, id_trainer)
    if not t:
        return default_id
    if t.get('heredar_contabilidad') is False and t.get('analytic_account_id'):
        return t['analytic_account_id']
    return default_id


def analytic_distribution_for(id_manager, id_trainer=None):
    """Devuelve el dict listo para meter en account.move.line
    (`analytic_distribution`): {<analytic_id>: 100.0} o None.

    Usar así en code que crea facturas/payments:
        line_vals['analytic_distribution'] = analytic_distribution_for(
            id_manager, id_trainer)
    """
    aid = resolve_analytic(id_manager, id_trainer)
    if not aid:
        return None
    return {str(aid): 100.0}


def ensure_trainer_inherit_row(id_manager, id_trainer):
    """Crea (si no existe) la fila trainer_odoo_config para este trainer
    en modo "heredar contabilidad" (el default). Idempotente.

    Se llama al sincronizar/dar de alta trainers — así siempre hay row
    para poder editarla luego.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO trainer_odoo_config
                (id_manager, id_trainer, heredar_contabilidad, analytic_account_id)
            VALUES (%s, %s, TRUE, NULL)
            ON CONFLICT (id_manager, id_trainer) DO NOTHING
        """, (str(id_manager), str(id_trainer)))


def set_trainer_independent(id_manager, id_trainer, nombre_trainer):
    """Convierte un trainer a contabilidad independiente: le crea su
    propio `account.analytic.account` en Odoo (mismo plan, misma company,
    código TRN-<id>) y guarda el id en trainer_odoo_config con
    heredar=false.

    Idempotente: si ya tiene analytic_account_id, no crea otro.

    Lanza RuntimeError si el manager no tiene Odoo desplegado.
    """
    mgr = _manager_row(id_manager)
    if not mgr or not mgr.get('odoo_company_id'):
        raise RuntimeError('Manager sin Odoo desplegado')
    if not mgr.get('odoo_analytic_plan_id'):
        raise RuntimeError('Manager sin analytic plan; provisioner Fase 4 '
                           'aún no ejecutado para este manager')

    # ¿Ya tiene analytic propio?
    t = _trainer_row(id_manager, id_trainer)
    if t and t.get('analytic_account_id'):
        analytic_id = t['analytic_account_id']
    else:
        from .odoo_cuotas import get_cuotas
        oc = get_cuotas(id_manager=id_manager)
        analytic_id = oc._call('account.analytic.account', 'create', {
            'name': f'Trainer {nombre_trainer}'[:80],
            'plan_id': mgr['odoo_analytic_plan_id'],
            'company_id': mgr['odoo_company_id'],
            'code': f'TRN-{id_trainer}',
        })
        log.info(f'analytic creado para trainer {id_trainer}: id={analytic_id}')

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO trainer_odoo_config
                (id_manager, id_trainer, heredar_contabilidad, analytic_account_id)
            VALUES (%s, %s, FALSE, %s)
            ON CONFLICT (id_manager, id_trainer) DO UPDATE SET
                heredar_contabilidad = FALSE,
                analytic_account_id  = EXCLUDED.analytic_account_id,
                updated_at = NOW()
        """, (str(id_manager), str(id_trainer), analytic_id))
    return analytic_id


def set_trainer_inherit(id_manager, id_trainer):
    """Marca al trainer como "heredar contabilidad" (los movimientos van
    al default del manager). NO borra el analytic propio en Odoo (puede
    tener histórico de movimientos asociados); solo marca la fila local.

    Si más adelante vuelves a "no heredar", se reusa el analytic anterior."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO trainer_odoo_config
                (id_manager, id_trainer, heredar_contabilidad)
            VALUES (%s, %s, TRUE)
            ON CONFLICT (id_manager, id_trainer) DO UPDATE SET
                heredar_contabilidad = TRUE,
                updated_at = NOW()
        """, (str(id_manager), str(id_trainer)))


def list_trainer_configs(id_manager):
    """Devuelve la config analytic de todos los trainers del manager,
    cruzado con sus credenciales NoofitPro (si las hay) para tener el
    email/nombre del trainer."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT
                tnc.id_trainer,
                tnc.noofit_email,
                COALESCE(toc.heredar_contabilidad, TRUE) AS heredar_contabilidad,
                toc.analytic_account_id,
                toc.notas,
                toc.created_at,
                toc.updated_at
              FROM trainer_noofit_creds tnc
              LEFT JOIN trainer_odoo_config toc
                     ON toc.id_manager = tnc.id_manager
                    AND toc.id_trainer = tnc.id_trainer
             WHERE tnc.id_manager = %s AND tnc.activo = TRUE
             ORDER BY tnc.id_trainer
        """, (str(id_manager),))
        rows = cur.fetchall() or []
    return [dict(r) for r in rows]
