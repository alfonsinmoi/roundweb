"""Renombra plantillas con descripciones del patrón Y fusiona duplicados.
Las plantillas con la misma estructura de bloques se unifican (1 plantilla
asignada a varios trabajadores/días)."""
import psycopg
conn = psycopg.connect(host='/var/run/postgresql', dbname='round_config', user='odoo')
cur = conn.cursor()
MGR = '17675'

cur.execute("""
    SELECT p.id, p.nombre,
           COALESCE(array_agg(b.hora_inicio::TEXT || '-' || b.hora_fin::TEXT || ':' || pt.codigo
                              ORDER BY b.hora_inicio) FILTER (WHERE b.id IS NOT NULL), '{}') AS bloques
      FROM turno_plantilla p
      LEFT JOIN turno_plantilla_bloque b ON b.turno_plantilla_id = p.id
      LEFT JOIN puesto_trabajo pt ON pt.id = b.puesto_id
     WHERE p.id_manager = %s
     GROUP BY p.id, p.nombre
     ORDER BY p.id
""", (MGR,))
filas = cur.fetchall()

def describir(bloques):
    if not bloques: return None
    parsed = []
    for b in bloques:
        rng, code = b.rsplit(':', 1)
        hi, hf = rng.split('-')
        parsed.append((hi[:5], hf[:5], code))
    if not parsed: return None
    def t2m(s): return int(s[:2]) * 60 + int(s[3:])
    tramos = [[parsed[0]]]
    for p in parsed[1:]:
        if t2m(p[0]) - t2m(tramos[-1][-1][1]) < 30:
            tramos[-1].append(p)
        else:
            tramos.append([p])
    partes, total_min = [], 0
    for tr in tramos:
        ini = tr[0][0]; fin = tr[-1][1]
        codes = []
        for _, _, c in tr:
            if c not in codes: codes.append(c)
        def hc(s): return s[:2] if s[3:] == '00' else s
        partes.append(f'{hc(ini)}-{hc(fin)} {"/".join(codes)}')
        for hi, hf, _ in tr:
            total_min += t2m(hf) - t2m(hi)
    h = total_min / 60
    h_str = f'{h:.1f}'.rstrip('0').rstrip('.') + 'h'
    return ' · '.join(partes) + f' ({h_str})'

# huella exacta (mismo conjunto de bloques) → primera plantilla con ese fingerprint
huella_to_first = {}
nuevos = {}
merges = []  # (de_id, a_id)
for pid, nombre_old, bloques in filas:
    bl = tuple(sorted(bloques or []))
    if bl in huella_to_first:
        merges.append((pid, huella_to_first[bl]))
    else:
        huella_to_first[bl] = pid
        nuevos[pid] = describir(list(bloques) if bloques else []) or nombre_old

# Aplicar merges: reasignar turno_asignacion + borrar duplicada
for src, dst in merges:
    cur.execute("UPDATE turno_asignacion SET turno_plantilla_id=%s WHERE turno_plantilla_id=%s",
                (dst, src))
    cur.execute("DELETE FROM turno_plantilla WHERE id=%s", (src,))
    print(f'  Fusionada plantilla {src} → {dst}')

# Renombrar las que quedan, evitando colisiones con UPDATE temporal
# (renombro a un nombre temporal y luego al final)
for pid, nombre in nuevos.items():
    cur.execute("UPDATE turno_plantilla SET nombre=%s WHERE id=%s",
                (f'__tmp__{pid}', pid))
for pid, nombre in nuevos.items():
    cur.execute("UPDATE turno_plantilla SET nombre=%s, updated_at=NOW() WHERE id=%s",
                (nombre, pid))
    print(f'  {pid}: {nombre}')

conn.commit()
print('OK')

# Mostrar resumen final
cur.execute("""
    SELECT p.id, p.nombre,
           COUNT(DISTINCT a.trabajador_id) AS n_trab,
           COUNT(a.id) AS n_asign
      FROM turno_plantilla p
      LEFT JOIN turno_asignacion a ON a.turno_plantilla_id = p.id
     WHERE p.id_manager = %s
     GROUP BY p.id, p.nombre
     ORDER BY p.nombre
""", (MGR,))
print('\n=== Resultado final ===')
for r in cur.fetchall():
    print(f'  {r["nombre"]:<45} ({r["n_trab"]} trab, {r["n_asign"]} asign)')
