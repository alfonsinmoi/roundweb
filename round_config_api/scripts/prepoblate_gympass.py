"""Pre-puebla la tabla cliente_gympass con los 21 clientes detectados por alias."""
import sys, json, re
sys.path.insert(0, '/opt/round_config_api')
from app.db import get_conn

# id_manager del Round Málaga Centro (lo deduzco del primer cliente del dump
# previo). Si no, hay que pasarlo por argumento.
ID_MANAGER = sys.argv[1] if len(sys.argv) > 1 else '17675'  # Round Málaga Centro
PATRON = re.compile(r'wellhub|gympass|wellpass', re.I)

with open('noofit_clientes_dump.json', 'r', encoding='utf-8') as f:
    nf = json.load(f)['clientes']

candidatos = []
for c in nf:
    alias = c.get('alias') or ''
    if PATRON.search(alias):
        candidatos.append({
            'id': c['id'],
            'alias': alias,
            'nombre': f"{c.get('nombre') or c.get('name','')} {c.get('apellidos') or c.get('surname','')}".strip(),
        })

print(f'Candidatos: {len(candidatos)}')
with get_conn() as conn, conn.cursor() as cur:
    inserted = 0
    for c in candidatos:
        cur.execute("""
            INSERT INTO cliente_gympass (id_manager, id_trainer, cliente_idnoofit, gympass_id, notas)
            VALUES (%s, NULL, %s, %s, %s)
            ON CONFLICT (id_manager, cliente_idnoofit) DO UPDATE
            SET gympass_id = EXCLUDED.gympass_id
        """, (ID_MANAGER, str(c['id']), 'gympass', f"Auto-detectado del alias: {c['alias']}"))
        inserted += 1
        print(f"  ✅ id={c['id']} {c['nombre'][:30]:<30s} alias='{c['alias']}'")
    print(f'\nTotal: {inserted}')
