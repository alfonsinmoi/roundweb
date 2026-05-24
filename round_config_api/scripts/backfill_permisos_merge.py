"""Backfill incremental de permisos: añade keys faltantes del default
a la matriz existente del perfil, sin tocar keys ya presentes.

Útil cuando se amplía DEFAULT_PERMISOS (nuevos nodos en el árbol) y
hay que propagar los nuevos perms .ver a perfiles existentes que ya
tienen customización (ej: Trainer del manager 17675 editado a mano).

A diferencia de `backfill_permisos_perfiles.py` (que solo escribe si el
perfil está vacío), este hace un merge profundo recursivo: en cada nivel,
si una clave del default NO existe en el perfil, se añade. Si SÍ existe,
se respeta lo que haya.

Uso:
  sudo -u odoo bash -lc 'set -a && . /opt/round_config_api/.env && set +a && \
    /opt/round_config_api/venv/bin/python \
    /opt/round_config_api/scripts/backfill_permisos_merge.py'
"""
import json
import sys

sys.path.insert(0, '/opt/round_config_api')
from app.db import get_conn, DEFAULT_PERMISOS  # noqa: E402


def deep_merge_missing(target: dict, source: dict) -> tuple[dict, list[str]]:
    """Merge recursivo: añade a `target` las keys de `source` que no existen.
    No sobrescribe valores existentes (ni siquiera si difieren).
    Devuelve (merged, added_paths) con los paths nuevos añadidos.
    """
    added = []
    out = dict(target) if isinstance(target, dict) else {}
    for k, v in source.items():
        if k not in out:
            out[k] = v
            added.append(k)
        elif isinstance(v, dict) and isinstance(out[k], dict):
            sub, sub_added = deep_merge_missing(out[k], v)
            out[k] = sub
            added.extend(f'{k}.{p}' for p in sub_added)
    return out, added


def main():
    actualizados = 0
    sin_cambios = 0
    saltados = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, id_manager, nombre, permisos, is_admin
                         FROM perfil ORDER BY id_manager, id""")
        rows = cur.fetchall()

    for r in rows:
        # Admin no necesita matriz (is_admin → todo true).
        if r['is_admin']:
            saltados += 1
            print(f"  · perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → admin, skip")
            continue
        default = DEFAULT_PERMISOS.get(r['nombre'])
        if not default:
            saltados += 1
            print(f"  · perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → sin default conocido")
            continue
        existing = r['permisos'] or {}
        merged, added = deep_merge_missing(existing, default)
        if not added:
            sin_cambios += 1
            print(f"  · perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → ya completo, skip")
            continue
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE perfil
                   SET permisos = %s::jsonb, updated_at = NOW()
                 WHERE id = %s
            """, (json.dumps(merged), r['id']))
        actualizados += 1
        n = len(added)
        sample = ', '.join(added[:4]) + (', …' if n > 4 else '')
        print(f"  ✓ perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → +{n} perms: {sample}")

    print(f"\nTotal: actualizados={actualizados}  sin_cambios={sin_cambios}  saltados={saltados}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
