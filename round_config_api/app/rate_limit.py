"""Rate-limiting COMPARTIDO entre workers (auditoría #13, P-2).

El limitador anterior era un dict en memoria POR WORKER de gunicorn (4
workers → el tope efectivo se multiplicaba ×4) y se vaciaba en cada
reinicio. Este usa un contador de ventana fija en Postgres: el límite es
real con N workers y sobrevive reinicios.

Uso:
    from ..rate_limit import client_ip, rate_limit_ok
    if not rate_limit_ok('lead_publico', client_ip(), max_hits=8):
        return jsonify({'ok': False, 'error': 'rate_limited'}), 429

Diseño:
- Ventana FIJA (bucket = inicio de ventana truncado): simple y suficiente
  para frenar spam/abuso de endpoints públicos. No pretende precisión de
  sliding-window.
- FAIL-OPEN: si la BD falla, se deja pasar (un endpoint de captación de
  leads no debe caerse por el limitador).
- Limpieza oportunista: ~1 de cada 50 llamadas borra buckets viejos.
- La tabla se crea lazy (CREATE TABLE IF NOT EXISTS) por el propio user
  de la app (`odoo`) → owner correcto (regla transversal).
"""
import logging
import random
import time

from flask import request

from .db import get_conn

log = logging.getLogger(__name__)

_table_ready = False


def client_ip():
    """IP real del cliente detrás de nginx (X-Real-IP > XFF > remote_addr)."""
    return (request.headers.get('X-Real-IP')
            or request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
            or request.remote_addr or 'unknown')[:64]


def _ensure_table(cur):
    global _table_ready
    if _table_ready:
        return
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rate_limit_hit (
          scope   VARCHAR(64)  NOT NULL,
          clave   VARCHAR(64)  NOT NULL,
          ventana TIMESTAMPTZ  NOT NULL,
          hits    INT          NOT NULL DEFAULT 1,
          PRIMARY KEY (scope, clave, ventana)
        )
    """)
    _table_ready = True


def rate_limit_ok(scope: str, clave: str, max_hits: int,
                  window_seconds: int = 300) -> bool:
    """True si esta petición entra dentro del límite; False → responder 429.

    Compartido entre workers (contador en BD). Fail-open ante errores.
    """
    try:
        bucket = int(time.time() // window_seconds) * window_seconds
        with get_conn() as conn, conn.cursor() as cur:
            _ensure_table(cur)
            cur.execute("""
                INSERT INTO rate_limit_hit (scope, clave, ventana, hits)
                VALUES (%s, %s, to_timestamp(%s), 1)
                ON CONFLICT (scope, clave, ventana)
                DO UPDATE SET hits = rate_limit_hit.hits + 1
                RETURNING hits
            """, (scope, str(clave), bucket))
            hits = cur.fetchone()['hits']
            # Limpieza oportunista de buckets viejos (>2 ventanas)
            if random.random() < 0.02:
                cur.execute("DELETE FROM rate_limit_hit WHERE ventana < to_timestamp(%s)",
                            (bucket - 2 * window_seconds,))
        if hits > max_hits:
            log.warning(f'rate_limit: {scope} {clave} → {hits}/{max_hits} en {window_seconds}s')
            return False
        return True
    except Exception as e:
        log.warning(f'rate_limit fail-open ({scope}): {e}')
        return True
