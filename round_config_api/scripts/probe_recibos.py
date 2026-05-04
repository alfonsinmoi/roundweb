"""Probar getRecibosByInstalacion con varios params."""
import requests, sys, json
sys.path.insert(0, '/opt/round_config_api/scripts')
from gestplus_extract import login

s = requests.Session()
login(s)
s.get('https://gestplus.okmas.net/GestPlus/openRecibosCentral.action', timeout=15)

for desde, hasta in [
    ('01/01/2026', '30/12/2026'),
    ('01/01/2026', '02/05/2026'),
    ('01/01/2026', '01/05/2026'),
    ('01-01-2026', '02-05-2026'),
    ('2026-01-01', '2026-05-02'),
]:
    r = s.get('https://gestplus.okmas.net/GestPlus/getRecibosByInstalacion.action',
              params={'instalacion':'B','fechaDesde':desde,'fechaHasta':hasta},
              timeout=60)
    ct = r.headers.get('Content-Type','')
    print(f'{desde} → {hasta}: status={r.status_code} ct={ct} len={len(r.text)}')
    if 'json' in ct:
        try:
            j = r.json()
            recs = j.get('listaRecibos') or []
            print(f'  recibos: {len(recs)} err: {j.get("error")}')
            if recs:
                print('  sample keys:', sorted(recs[0].keys()))
                print('  sample[0]:', json.dumps(recs[0], default=str)[:700])
                break
        except Exception as e:
            print('  ERR json:', e, r.text[:200])
