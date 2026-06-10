# Chat de MODIFICACIONES BÁSICAS de la web — briefing

> **Para Claude (sesión nueva):** lee este archivo + `CLAUDE.md` antes de tocar
> nada. Este chat es el de **modificaciones básicas de la web**. En **paralelo**
> hay **otro chat dedicado a AUDITORÍA** (auth, recibos, facturación, alta de
> cliente, POS, sync Odoo, blindajes financieros). Para no pisaros, respeta el
> reparto de abajo.

---

## 1. Reparto de trabajo entre los dos chats

| | **Este chat (modificaciones básicas)** | **Chat de auditoría (el otro)** |
|---|---|---|
| Hace | UI/UX frontend, textos, estilos, copys, pequeños features, fixes visuales, formularios, filtros, listados, navegación, badges, mejoras de usabilidad | Seguridad/integridad: auth & bootstrap, recibos, facturación, alta de cliente, POS/TPV, sincronización Odoo, SEPA, blindajes financieros (B1–B12) |
| Ámbito típico | `src/` (React) y endpoints **no financieros** | backend financiero + reglas multi-tenant |
| Documento que mantiene | (ninguno fijo) | `docs/AUDITORIAS_NOOFITWEB.md` |

**Regla de oro del reparto:** si una modificación "básica" **toca un área bajo
auditoría** (ver §4) → NO la cambies aquí: anótala y déjala para el chat de
auditoría (o coordina con el usuario). Mejor un cambio menos que un conflicto en
el flujo de cobro.

---

## 2. Reglas INQUEBRANTABLES (resumen — detalle en `CLAUDE.md`)

- **NoofitPro es la fuente de verdad** de la jerarquía trainer↔manager. La web
  **lee**, nunca inventa ni edita identidad/credenciales/jerarquía.
- **Manager** = login NoofitPro con `X-TRAINER_MANAGER="true"`; **trainer** =
  `"false"`. El tenant (`id_manager`) lo resuelve el backend, no el frontend.
- **Datos de cliente/cuotas NUNCA cruzan de manager.** Los datos del manager se
  comparten entre SUS trainers. Comunicaciones (notas) **same-trainer** (el
  manager sí puede a todos sus trainers).
- **"Round" es solo el manager de pruebas** (tenant `17675`). La **plataforma se
  llama noofitweb**. Los identificadores de código con prefijo `round`
  (`X-Round-Token`, `round_config`, `round-bootstrap`…) **NO se renombran**.
- **Nunca** subir `node_modules/`, `dist/`, `.env`, claves ni backups a git.

---

## 3. Setup, despliegue y verificación (lo que necesitas a diario)

**Repo:** `~/Documents/roundwebnoofit` (frontend React/Vite + carpeta
`round_config_api/` con el backend Flask).
**VPS:** alias SSH `round-vps` (212.227.40.122). Frontend servido en
`/var/www/round/`; backend en `/opt/round_config_api/`.

### Frontend (lo más habitual aquí)
```bash
cd ~/Documents/roundwebnoofit
rm -rf dist
npm run build
scp -r dist/. round-vps:/var/www/round/
# Verificar:
curl -s -o /dev/null -w "%{http_code}\n" https://noofit.wiemspro.com/   # → 200
```

### Backend (si una mod básica toca un endpoint NO financiero)
```bash
# Despliega con verificación de sintaxis ANTES de pisar producción:
scp round_config_api/app/<archivo>.py round-vps:/tmp/<archivo>_new.py
ssh round-vps "python3 -m py_compile /tmp/<archivo>_new.py && echo OK \
  && cp /tmp/<archivo>_new.py /opt/round_config_api/app/<archivo>.py \
  && systemctl restart round_config_api && sleep 3 && systemctl is-active round_config_api"
```

- **Todo endpoint nuevo que MUTE datos** (POST/PATCH/PUT/DELETE) DEBE llamar a
  `log_action()` en su rama de éxito (ver `app/audit_log.py`). No es opcional.
- Tras deploy backend: `systemctl is-active round_config_api` debe dar `active`.

---

## 4. Áreas "CALIENTES" — bajo auditoría, NO tocar aquí sin coordinar

Estos ficheros/flujos los está revisando el chat de auditoría. Evita editarlos
en paralelo (riesgo de conflicto + de romper integridad financiera):

- `app/auth.py`, `app/auth_usuario.py`, `app/routes/auth_bootstrap.py` (auth/bootstrap, H1)
- `app/odoo_alta.py`, `app/routes/cuotas_clientes.py` (alta de cliente — A1–A6 en curso)
- `app/routes/facturacion_emision.py`, `app/facturacion_engine.py`,
  `app/routes/facturacion_config.py` (facturación fin_de_mes, gated)
- `app/routes/recibos.py`, `app/odoo_payments.py`, `app/odoo_cuotas.py` (recibos/cobros)
- `app/routes/notas.py` (same-trainer)
- POS/TPV: `app/routes/pos_*.py`, `app/odoo_pos_sync.py`, `app/odoo_proveedores_sync.py`
- Provisioner Odoo: `app/odoo_provisioner.py`, `app/odoo_guard.py`

**Frontend asociado a esas áreas** (cuidado, pero los retoques visuales menores
suelen ser seguros — coordina si dudas): `ERPModal.jsx`, `AltaClienteModal.jsx`,
`components/recibos/*`, `pages/Configuracion/FormaFacturarTab.jsx`, `pages/TPV/*`.

✅ **Zona despejada para este chat:** páginas y componentes de presentación,
CRM/leads visual, dashboards (lectura), Configuración no-financiera, formularios
públicos (`PublicForm.jsx`), textos/estilos/i18n, navegación/sidebar, badges,
filtros y orden de listados.

---

## 5. Git — coordinación entre los DOS chats (importante)

Ambos chats empujan al **mismo** GitHub (`alfonsinmoi/roundweb`). Para no
chocar:

1. **`git pull` SIEMPRE antes de empezar** y antes de cada `git push`.
2. **Trabaja en rama** para las mods básicas: `feat/web-mods` (o similar). Así el
   chat de auditoría puede seguir en `main`/su rama sin colisionar.
   ```bash
   git pull
   git checkout -b feat/web-mods   # si no existe; si existe: git checkout feat/web-mods && git pull
   ```
3. **Commits** formato `tipo(scope): mensaje` (`feat`/`fix`/`chore`/`docs`/`style`/
   `refactor`). Si lo genera Claude, añade al final:
   `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
4. **No `git push --force` a `main`.** Commit/push **solo cuando el usuario lo
   pida**.
5. Si dos chats tocaran el mismo archivo: gana lo que esté en GitHub; resolver
   conflicto a mano y avisar al usuario.

> Si los dos chats comparten el **mismo working directory**, no corráis builds/
> deploys simultáneos: turnaos. Lo ideal es que este chat use su rama y, si hace
> falta, un clon o worktree aparte.

---

## 6. Punteros (lee según necesites)

- `CLAUDE.md` — instrucciones maestras del proyecto (infra, tablas, endpoints,
  convenciones, qué NO hacer). **Fuente principal.**
- `docs/AUDITORIAS_NOOFITWEB.md` — registro de auditorías + REGLAS/invariantes.
  **Este chat lo LEE para no romper reglas, pero NO lo edita** (lo mantiene el
  chat de auditoría).
- `docs/MANAGER_TRAINER.md` — modelo manager/trainer/usuario_web y scope.
- `docs/FLUJO_DUAL_PC.md` — flujo dual-PC (mismo espíritu que dual-chat).

---

## 7. Cómo dejar handoff de vuelta

Al cerrar una tanda de mods básicas, deja constancia para el otro chat / el
usuario:
- Qué archivos tocaste (y si alguno roza una zona caliente, dilo explícitamente).
- Si desplegaste (frontend/backend) y el resultado de la verificación (`200` /
  `active`).
- Si dejaste algo a medias o detectaste un problema que pertenece a auditoría →
  anótalo aquí o pídele al usuario que lo lleve al chat de auditoría.

---

### Estado de la auditoría al crear este doc (2026-06-09)
Para que sepas qué hay en vuelo en el otro chat (no exhaustivo):
- **Alta de cliente**: A1 (aplazar = doble cobro) **corregido y desplegado**.
  Abiertos: A2 (idempotencia), A3 (alta sin recibo BD — *keystone*), A4
  (enlace_pago), A5 (transacción), A6 (log_action `entidad_id` NULL).
- **Auth/bootstrap (H1)**: JWT de manager desplegado (paso 1); enforcement en
  modo monitor (paso 2, sin bloquear).
- Cerradas recientemente: notas same-trainer, cobro de recibos facturados +
  move puro, facturación fin_de_mes (gated, inerte), devoluciones SEPA (OneSignal
  en 2º plano).
