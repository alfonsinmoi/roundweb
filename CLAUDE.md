# CLAUDE.md — instrucciones del proyecto Round

> Este archivo lo lee Claude Code automáticamente al abrir el proyecto.
> Aquí está todo lo que Claude necesita saber para trabajar productivamente
> sin tener que descubrirlo en cada conversación.

## Visión general

**Round Training Center** es una plataforma de gestión de gimnasios construida
sobre el SaaS NoofitPro (`pro.wiemspro.com`). Este repo contiene:

- **Frontend** React/Vite servido en `https://round.wiemspro.com` y
  `https://round.noofit.com` (ambos sirven el mismo bundle).
- **Backend `round_config_api`** — Flask + Gunicorn en VPS (puerto 8095)
  que orquesta NoofitPro + Odoo + PostgreSQL + Resend + PayComet + Meta.
- **Módulo Odoo `round_facturacion`** — extiende Odoo 17 Community con
  cuotas/descuentos/suscripciones/recibos SEPA.
- **Documentación** en `docs/`.

Más detalle arquitectónico en `docs/Arquitectura_round_noofit.docx` (con
infografía) y `docs/FLUJO_DUAL_PC.md`.

## Infraestructura

| Recurso | Dirección |
|---|---|
| VPS (Ubuntu 24.04) | `212.227.40.122` (alias SSH: `round-vps`) |
| Frontend (servido) | `/var/www/round/` |
| Backend Flask | `/opt/round_config_api/` |
| Odoo addon custom | `/opt/odoo17/custom-addons/round_facturacion/` |
| Postgres BD propia | `round_config` |
| Postgres Odoo | `round_facturacion` |
| Servicio backend | `systemctl … round_config_api` |
| Servicio Odoo | `systemctl … odoo17` |
| Crones systemd | `round_slots_cleanup`, `round_reminders`, `round_cliente_log`, `round_social_publish` |
| Nginx config | `/etc/nginx/sites-enabled/round.wiemspro.com` |

## Setup en un PC nuevo

```bash
# 1. Prerequisitos
# - Git, Node.js LTS, Claude Code (npm install -g @anthropic-ai/claude-code)

# 2. Configurar git
git config --global user.name "Tu nombre"
git config --global user.email "calcalde@wiemspro.com"

# 3. Clonar repos
mkdir -p ~/Documents && cd ~/Documents
git clone https://github.com/alfonsinmoi/roundweb.git
git clone https://github.com/calcaldecampusport-maker/odoo-deploy.git
git clone https://github.com/calcaldecampusport-maker/claude-projects.git

# 4. Copiar la clave SSH del VPS
# Recibe ~/.ssh/odoo_carajfam por canal seguro (USB / Bitwarden) y:
chmod 600 ~/.ssh/odoo_carajfam

# 5. Alias SSH (~/.ssh/config)
cat >> ~/.ssh/config <<'EOF'

Host round-vps
  HostName 212.227.40.122
  User root
  IdentityFile ~/.ssh/odoo_carajfam
  IdentitiesOnly yes
  ServerAliveInterval 60
  ServerAliveCountMax 3
EOF

# 6. Probar SSH al VPS
ssh round-vps "hostname"     # debe imprimir: ubuntu

# 7. Instalar dependencias del frontend
cd ~/Documents/roundweb
npm install
```

## Flujo de trabajo dual-PC

**Regla 1 — al empezar:** `git pull` antes de tocar nada.
**Regla 2 — al acabar:** `git push` antes de cerrar.
**Regla 3 — el VPS no es fuente de verdad:** GitHub sí. Sincroniza siempre
vía GitHub, NO por scp PC↔PC.

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite, lazy-loading por ruta |
| Backend | Python 3.12 + Flask + Gunicorn |
| BD propia | PostgreSQL 16 (`round_config`) |
| Odoo | 17 Community (`round_facturacion`) |
| Email | Resend / Postmark / SMTP / Gmail (configurable per centro) |
| Pasarela pago | PayComet (configurable per trainer) |
| Redes sociales | Meta Graph API v21.0 (Instagram + Facebook) |
| Auth NoofitPro | JWT con MD5 password (loginEasy) |
| WordPress | roundtrainingcenter.com (Ninja Forms + WPCode snippets) |

## Convenciones

### Commits

Formato: `tipo(scope): mensaje corto`

Tipos: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`.

Cuando lo genere Claude Code, **siempre incluir** al final:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

### Branches

- `main` → versión actualizada y desplegada en VPS.
- `feat/...` → ramas de trabajo (las viejas POC quedan: `feat/mcp-receiver`,
  `feat/poller-watchdog`, `feat/config-tab`).

### Despliegues

**Frontend** (cualquier cambio en `src/`):

```bash
cd ~/Documents/roundweb     # o roundwebnoofit
rm -rf dist
npm run build
scp -r dist/. round-vps:/var/www/round/
```

**Backend** (cambios en `round_config_api/`):

```bash
scp round_config_api/app/<archivo>.py round-vps:/opt/round_config_api/app/<archivo>.py
ssh round-vps "systemctl restart round_config_api && sleep 2 && systemctl is-active round_config_api"
```

**Odoo addon** (cambios en `odoo_modules/`):

```bash
scp odoo_modules/round_facturacion/models/<archivo>.py \
    round-vps:/opt/odoo17/custom-addons/round_facturacion/models/<archivo>.py
ssh round-vps "systemctl stop odoo17 && \
  sudo -u odoo /opt/odoo17/venv/bin/python /opt/odoo17/odoo/odoo-bin \
    -c /etc/odoo17.conf -d round_facturacion -u round_facturacion \
    --stop-after-init --no-http && \
  systemctl start odoo17"
```

### Verificación tras cada deploy

- Frontend: `curl -s -o /dev/null -w "%{http_code}\n" https://round.wiemspro.com/`
  debe responder `200`.
- Backend: `curl -s "https://round.wiemspro.com/api/crm/slots-disponibles?centro=malagacentro"`
  debe devolver JSON con `ok:true`.
- Logs: `ssh round-vps "journalctl -u round_config_api -n 30 --no-pager"`.

## Servicios y crones del VPS

| Servicio | Frecuencia | Función |
|---|---|---|
| `round_config_api.service` | siempre activo | API Flask |
| `round_slots_cleanup.timer` | cada 5 min | libera slots prueba expirados |
| `round_reminders.timer` | cada 30 min | recordatorios prueba 24h antes |
| `round_cliente_log.timer` | diario 03:30 | log cambios estado cliente |
| `round_social_publish.timer` | cada 5 min | publica posts Meta programados |

## Tablas BD principales (round_config)

- `cuota`, `descuento`, `modificacion` — catálogos del manager
- `cuota_cliente`, `descuento_asignacion`, `modificacion_cobro` — asignaciones
- `centro_contacto` — un centro por trainer (slug, email, teléfono)
- `lead_asignacion` — leads CRM (con stage_history, score, qualification, lost_reason)
- `slot_reserva` — reservas prueba gratuita con token + expiry
- `email_proveedor` — config Resend/Postmark/SMTP/Gmail (manager + per trainer)
- `email_template` — plantillas con variables `{{var}}` por evento
- `pasarela_credenciales` — PayComet por trainer
- `cliente_estado_log` — track diario activo↔archivado
- `social_cuenta`, `social_post` — agenda Meta Instagram + Facebook
- `cliente_gympass` — extensión local para gympassId

## Credenciales y secretos (NO subir a git)

- `~/.ssh/odoo_carajfam` — clave SSH al VPS
- `/opt/round_config_api/.env` en VPS — DB, Resend, NoofitPro, ROUND_DEFAULT_MANAGER
- Login NoofitPro: `roundgestion@noofit.com` / `1234abcd` (manager_id real `7673`)
- Login Round web: el mismo email que NoofitPro
- IDs reales:
  - Manager NoofitPro: **7673**
  - Trainer ROUND MÁLAGA CENTRO: **17675**
  - Trainer ROUND AÑORETA: **17674**
  - id_manager interno (Round Config): **17677** (no es el de NoofitPro)

## Endpoints públicos del backend (round.wiemspro.com)

```
# CRM público (formulario web)
POST /api/crm/lead              → lead clásico (sin slot)
POST /api/crm/lead-prueba       → lead + reserva slot prueba (DNI obligatorio)
GET  /api/crm/slots-disponibles?centro=<slug>
GET  /reserva/<token>           → confirmar/cambiar reserva (HTML público)

# Autenticados (X-Round-Token + X-Round-Manager-Id)
GET    /api/crm/leads           → kanban
PATCH  /api/crm/leads/<id>      → mover etapa, lost_reason
GET    /api/crm/funnel          → analítica embudo
GET    /api/clientes/estado-log
POST   /api/clientes/<id>/sync-odoo
POST   /api/cuotas/recibo/<id>/enviar  → enviar factura PDF
POST   /api/cuotas/alta-cliente
GET/PUT /api/config/centros|email|email-templates|pasarelas
GET/PUT /api/social/cuentas|posts
```

## Cosas que NO hay que hacer

- ❌ Editar archivos directamente en el VPS sin pasar por git (perdería los
  cambios en el siguiente deploy desde otro PC).
- ❌ Subir `node_modules/`, `dist/`, `.env`, claves o backups al repo.
- ❌ Hacer `git push --force` a `main` desde un PC sin coordinar con el otro.
- ❌ Ejecutar `crear_alta_cliente` en producción si el cliente NoofitPro
  tiene email con `_MAK` (es marker de sandbox y NoofitPro no lo deja editar).
- ❌ Llamar a Meta Graph API sin tener el App Review aprobado y un Page
  Access Token de larga duración (60 días) configurado.

## Cosas que sí hay que hacer

- ✅ `git pull` antes de empezar a trabajar en cualquier PC.
- ✅ `git push` antes de cerrar / cambiar de PC.
- ✅ Backup BD antes de cambios estructurales:
  `ssh round-vps "sudo -u postgres pg_dump round_config > /root/backup_$(date +%F).sql"`
- ✅ Verificar `systemctl is-active round_config_api` tras cada deploy backend.
- ✅ Validar email RFC con la regex en `odoo_cuotas.enviar_factura_email`
  antes de enviar (rechaza emails con `_MAK` y otros inválidos).
- ✅ Documentar nuevas tablas/endpoints en este CLAUDE.md.

## Arquitectura del flujo lead → cliente → cobro

```
Lead form WP /prueba-gratuita
   ↓ POST /api/crm/lead-prueba (con DNI + slot_id)
Backend valida DNI/NIE/Pasaporte
   ↓ INSERT slot_reserva estado='creando' (respuesta inmediata <500ms)
Background thread:
   ↓ Buscar cliente NoofitPro existente (cache 5 min)
   ↓ Si no existe → crear con toSend=False (sin email Wiemspro)
   ↓ Reservar plaza en sala
   ↓ Crear lead en Odoo CRM stage="Nuevo"
   ↓ UPDATE slot_reserva estado='pendiente' + cliente_id + odoo_lead_id
   ↓ trigger_email('slot_reservado_lead') → email con CTA Confirmar
   ↓
Lead clica confirmar → estado='confirmada'
   ↓ trigger_email('slot_confirmado_lead')
   ↓
24h antes → cron round_reminders dispara slot_recordatorio_lead
   ↓
Tras la prueba, el trainer da de alta al cliente:
   ↓ Botón "ERP" en perfil cliente → ERPModal
   ↓ POST /api/cuotas/alta-cliente
   ↓ Odoo: upsert_partner + crear_subscription (anti-duplicado) + recibo + pago
   ↓ Auto-mover lead Odoo a etapa "Alta"
   ↓ Si recaptación: tag CRM "Recaptación" + reactivar NoofitPro (enabled=true)
```

## Referencias rápidas

- Manual operativo (manager + trainers): `docs/Manual_CRM_Round.docx`
- Arquitectura técnica + infografía: `docs/Arquitectura_round_noofit.docx`
- Flujo dual-PC + setup nuevo PC: `docs/FLUJO_DUAL_PC.md`
- Mantener este CLAUDE.md actualizado cuando cambien tablas, servicios o
  flujos críticos.
