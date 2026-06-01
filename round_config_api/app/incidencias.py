"""Helper para registrar incidencias internas dirigidas al admin del manager.

Las incidencias van a una tabla local `incidencia_admin` y son consumidas
por la UI (bandeja en Configuración / dashboard) — NO se envían por
email ni se notifican al cliente.

Uso típico:
  from .incidencias import crear_incidencia_admin
  crear_incidencia_admin(
      id_manager=g.id_manager,
      id_trainer=g.id_trainer,           # opcional
      tipo='pago_diferencia',
      entidad='recibo', entidad_id=rid,
      titulo=f'Pago parcial recibo #{rid}',
      mensaje=f'Cobrado {cobrado:.2f}€ de {total:.2f}€ esperados. Observación: {obs}',
      severidad='warning',
      meta={'esperado': total, 'cobrado': cobrado, 'diff': diff},
      created_by=actor_label,
  )
"""
import json
import logging
from .db import get_conn

log = logging.getLogger(__name__)


def crear_incidencia_admin(*, id_manager, tipo, titulo,
                           id_trainer=None, entidad=None, entidad_id=None,
                           severidad='info', mensaje=None,
                           meta=None, created_by=None):
    """Inserta una fila en `incidencia_admin`. Tolerante a errores: si la
    BD falla, loguea y retorna None para no propagar al endpoint que la
    invocó. (Lo importante es el dato principal, no la incidencia.)
    """
    # Sprint 7 #M10 — validar severidad ANTES del INSERT para que un valor
    # nuevo (ej. 'critical') no caiga al except y se pierda silenciosamente.
    if severidad not in ('info', 'warning', 'error'):
        log.error(f'crear_incidencia_admin severidad inválida: {severidad!r}')
        return None
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO incidencia_admin
                  (id_manager, id_trainer, tipo, entidad, entidad_id,
                   severidad, titulo, mensaje, meta, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (str(id_manager),
                  # Sprint 7 #M3 — `is not None` en lugar de truthy check
                  # para no colapsar id_trainer=0/'' a NULL accidentalmente.
                  str(id_trainer) if id_trainer is not None and id_trainer != '' else None,
                  tipo, entidad,
                  int(entidad_id) if entidad_id is not None else None,
                  severidad, titulo, mensaje,
                  # Sprint 7 #M1 — `default=str` evita TypeError silencioso
                  # cuando meta contiene datetime/Decimal (típico en Python).
                  json.dumps(meta, default=str) if meta is not None else None,
                  created_by))
            inc_id = cur.fetchone()['id']
        log.info(f'incidencia_admin creada id={inc_id} tipo={tipo} '
                 f'entidad={entidad}:{entidad_id} sev={severidad}')
        return inc_id
    except Exception as e:
        log.exception(f'crear_incidencia_admin tipo={tipo}: {e}')
        return None
