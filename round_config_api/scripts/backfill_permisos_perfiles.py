"""Backfill de matrices de permisos en perfiles existentes.

Para cada manager con perfiles ya creados con permisos = '{}' (porque se
sembraron antes de tener DEFAULT_PERMISOS), aplica la matriz default que
toca según el nombre del perfil (Trainer / Recepción / Solo lectura).

NO sobreescribe perfiles que ya tienen matriz no-vacía — eso significa
que el manager los editó y respetamos su versión.

Idempotente: se puede correr N veces.

Uso (en VPS):
  set -a && . /opt/round_config_api/.env && set +a
  /opt/round_config_api/venv/bin/python /opt/round_config_api/scripts/backfill_permisos_perfiles.py
"""
import json
import sys

sys.path.insert(0, '/opt/round_config_api')
from app.db import get_conn, DEFAULT_PERMISOS  # noqa: E402


def main():
    actualizados = 0
    saltados = 0
    sin_default = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, id_manager, nombre, permisos, is_admin
              FROM perfil
             ORDER BY id_manager, id
        """)
        rows = cur.fetchall()

    for r in rows:
        # Saltar admin: is_admin=true ignora la matriz.
        if r['is_admin']:
            saltados += 1
            print(f"  · perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → admin, skip")
            continue

        existing = r['permisos'] or {}
        # Si ya tiene matriz no vacía → respetar (editada manualmente).
        if existing and any(
            isinstance(v, dict) and v or (v is True or v is False)
            for v in existing.values()
        ):
            saltados += 1
            print(f"  · perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → ya tiene matriz, skip")
            continue

        default = DEFAULT_PERMISOS.get(r['nombre'])
        if not default:
            sin_default += 1
            print(f"  ! perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → sin default conocido")
            continue

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE perfil
                   SET permisos = %s::jsonb, updated_at = NOW()
                 WHERE id = %s
            """, (json.dumps(default), r['id']))
        actualizados += 1
        n_keys = sum(_count_leaves(default).values())
        print(f"  ✓ perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → matriz aplicada ({n_keys} permisos)")

    print(f"\nTotal: actualizados={actualizados}  saltados={saltados}  sin_default={sin_default}")
    return 0


def _count_leaves(d, acc=None):
    """Cuenta cuántas hojas True hay en una matriz anidada (informativo)."""
    if acc is None:
        acc = {'true': 0}
    if isinstance(d, dict):
        for v in d.values():
            _count_leaves(v, acc)
    elif d is True:
        acc['true'] += 1
    return acc


if __name__ == '__main__':
    sys.exit(main())
