"""Inspecciona clientes Wellhub/Gympass en ambos sistemas."""
import json, re

nf = json.load(open('noofit_clientes_dump.json'))['clientes']
gp = json.load(open('gestplus_dump_2026-05-02.json'))
all_gp = gp['altas'] + gp['bajas_recientes_12m']
catalogo = gp.get('cursos_catalogo') or []

patron = re.compile(r'wellhub|gympass|wellpass', re.I)

# NoofitPro
nf_gym = []
for c in nf:
    fields = ' '.join(str(c.get(k) or '') for k in ('alias','name','nombre','surname','apellidos','email'))
    if patron.search(fields):
        nf_gym.append(c)

print(f'NF con Wellhub/Gympass: {len(nf_gym)}')
for c in nf_gym[:30]:
    nombre = (c.get('nombre') or c.get('name') or '')
    apellidos = (c.get('apellidos') or c.get('surname') or '')
    alias = (c.get('alias') or '')[:35]
    email = c.get('email') or ''
    print(f'  id={c.get("id"):>8d} alias="{alias:<35s}" {nombre} {apellidos} | {email[:30]} enabled={c.get("enabled")}')

# GestPlus por nombre/email
gp_gym = []
for c in all_gp:
    fields = ' '.join(str(c.get(k) or '') for k in ('nombre','apellidos','email','notas'))
    if patron.search(fields):
        gp_gym.append(c)
print(f'\nGP con Wellhub/Gympass por texto: {len(gp_gym)}')
for c in gp_gym[:30]:
    print(f'  {c.get("codigo")} {c.get("nombre"):>20s} {c.get("apellidos")} {c.get("email") or ""}')

# Cursos / cuotas
gym_cur = []
for c in catalogo:
    fields = ' '.join(str(c.get(k) or '') for k in ('nomcur','descrip','codcur'))
    if patron.search(fields):
        gym_cur.append(c)
print(f'\nCursos GP con Wellhub/Gympass: {len(gym_cur)}')
for c in gym_cur:
    print(f'  {c.get("codcur"):<10s} {c.get("nomcur"):<30s} | {c.get("descrip")}')

# Si hay cursos Gympass, buscar clientes que tengan recibos con esos codcur
if gym_cur:
    codcurs = {c.get('codcur') for c in gym_cur}
    print(f'\nBuscando recibos 2026 con codcur Gympass {codcurs}:')
    cli_codigos = set()
    for c in all_gp:
        for r in (c.get('_recibos') or []):
            if r.get('codcur') in codcurs:
                cli_codigos.add(c.get('codigo'))
                break
    print(f'  {len(cli_codigos)} clientes GP con recibos Gympass 2026')
    if cli_codigos:
        for c in all_gp[:10]:
            if c.get('codigo') in cli_codigos:
                print(f'  {c.get("codigo")} {c.get("nombre")} {c.get("apellidos")} estado={c.get("estado")}')
