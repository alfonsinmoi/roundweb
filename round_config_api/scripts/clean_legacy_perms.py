"""Limpieza de claves de permisos obsoletas en perfiles existentes.

Cuando se cambia el árbol PERMISSIONS (frontend) y se eliminan nodos,
los perfiles en BD pueden quedar con keys huérfanas que ya no significan
nada (ningún componente las consulta). Este script las elimina del JSONB.

Mantiene idempotencia: si ya no hay claves obsoletas, no hace nada.

Listado de paths a borrar (formato 'rama.subrama.hoja'):
"""
import json
import sys

sys.path.insert(0, '/opt/round_config_api')
from app.db import get_conn  # noqa: E402

# Keys obsoletas a borrar. Cada entrada es una secuencia de claves anidadas.
LEGACY_PATHS = [
    # Informe de Asistencia: nombres antiguos que no se correspondían con
    # las pestañas reales (VALID_TABS de InformeAsistencia.jsx).
    ('informe_asistencia', 'tendencias'),
    ('informe_asistencia', 'comparativa'),
    ('informe_asistencia', 'ranking_clases'),
    ('informe_asistencia', 'ocupacion_sala'),
    ('informe_asistencia', 'analisis_patrones'),  # ahora se llama `patrones`
]


def remove_path(obj, path: tuple[str, ...]) -> bool:
    """Borra obj[path[0]][path[1]]... si existe. Devuelve True si borró algo.
    No toca el padre si queda vacío (las keys padre se respetan)."""
    cur = obj
    for k in path[:-1]:
        if not isinstance(cur, dict) or k not in cur:
            return False
        cur = cur[k]
    if isinstance(cur, dict) and path[-1] in cur:
        del cur[path[-1]]
        return True
    return False


def main():
    actualizados = 0
    sin_cambios = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, id_manager, nombre, permisos FROM perfil ORDER BY id_manager, id")
        rows = cur.fetchall()

    for r in rows:
        permisos = r['permisos'] or {}
        original = json.dumps(permisos, sort_keys=True)
        removed = []
        for path in LEGACY_PATHS:
            if remove_path(permisos, path):
                removed.append('.'.join(path))
        if not removed:
            sin_cambios += 1
            continue
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE perfil SET permisos = %s::jsonb, updated_at = NOW()
                 WHERE id = %s
            """, (json.dumps(permisos), r['id']))
        actualizados += 1
        print(f"  ✓ perfil {r['id']:>4} {r['nombre']:<14} (mgr={r['id_manager']}) → -{len(removed)} legacy: {', '.join(removed)}")

    print(f"\nTotal: actualizados={actualizados}  sin_cambios={sin_cambios}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
