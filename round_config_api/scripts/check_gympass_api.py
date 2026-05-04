"""Verifica si el API devuelve gympassId tras la actualización."""
import requests, hashlib, urllib3
urllib3.disable_warnings()

body = {'email':'roundmalagacentro@noofit.com', 'appVersion':'1.8.39',
        'password': hashlib.md5(b'1234abcd').hexdigest().upper()}
r = requests.post('https://pro.wiemspro.com/wiemspro/account/loginEasy',
                  json=body, verify=False, timeout=30)
t = r.headers.get('X-CustomToken')
m = r.headers.get('X-TRAINER_MANAGER', '')
h = {'X-CustomToken': t, 'X-TRAINER_MANAGER': m, 'locale': 'es',
     'appVersion': '1.8.39', 'appId': '1'}
r = requests.get('https://pro.wiemspro.com/wiemspro/api/dispositivos/getClienteSimple',
                 headers=h, verify=False, timeout=60)
clientes = r.json().get('clientes', [])
con_gym = [c for c in clientes if c.get('gympassId')]
print(f'Total clientes API: {len(clientes)}')
print(f'Con gympassId: {len(con_gym)}')
for c in con_gym[:8]:
    print(f"  id={c.get('id')} gympassId={c.get('gympassId')!r} alias={c.get('alias')}")
# Buscar también por alias para ver si los 21 están pero sin gympassId
import re
patron = re.compile(r'wellhub|gympass', re.I)
con_alias = [c for c in clientes if patron.search(c.get('alias') or '')]
print(f'\nCon alias Wellhub/Gympass: {len(con_alias)}')
for c in con_alias[:5]:
    print(f"  id={c.get('id')} alias={c.get('alias')!r} gympassId={c.get('gympassId')!r}")
