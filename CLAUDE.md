# CLAUDE.md — instrucciones del proyecto Round

> Este archivo lo lee Claude Code automáticamente al abrir el proyecto.
> Aquí está todo lo que Claude necesita saber para trabajar productivamente
> sin tener que descubrirlo en cada conversación.

## Visión general

**Round Training Center** es una plataforma de gestión de gimnasios construida
sobre el SaaS NoofitPro (`pro.wiemspro.com`). Este repo contiene:

- **Frontend** React/Vite servido en `https://noofit.wiemspro.com`.
- **Backend `round_config_api`** — Flask + Gunicorn en VPS (puerto 8095)
  que orquesta NoofitPro + Odoo + PostgreSQL + Resend + PayComet + Meta.
- **Módulo Odoo `round_facturacion`** — extiende Odoo 17 Community con
  cuotas/descuentos/suscripciones/recibos SEPA.
- **Documentación** en `docs/`.

Más detalle arquitectónico en `docs/Arquitectura_round_noofit.docx` (con
infografía) y `docs/FLUJO_DUAL_PC.md`.

## ⛔ REGLA INQUEBRANTABLE — NoofitPro es la fuente de trainers y managers

**Para acceder/registrarse en la web hay que tener credenciales en NoofitPro
(usuario + contraseña). NoofitPro es la ÚNICA fuente de verdad de la jerarquía
trainer ↔ manager. En la web NO se crean ni se modifican datos del trainer ni
de su manager.**

- El alta/identidad de un trainer o manager **solo** existe si existe en
  NoofitPro. La web los **lee** (loginEasy + jerarquía), nunca los inventa.
- **Prohibido** crear `manager_config` (u otra entidad de manager/trainer)
  para un id que sea en realidad un trainer de un manager Round ya existente.
  Se reconduce a su manager padre, **no** se le crea un manager propio.
  Doble blindaje en `round-bootstrap`:
    1. **Registro local**: `auth.parent_manager_si_es_trainer` /
       `_remap_trainer_as_manager` — si el id ya consta como trainer de otro
       manager en `trainer_noofit_creds`, se reconduce a ese padre.
    2. **Jerarquía NoofitPro** (trainer desconocido localmente):
       `noofit_client.hermanos_trainer_ids` (`getTrainersByManager`) devuelve
       el grupo de centros "hermanos" del cliente NoofitPro; si alguno ya es
       manager Round (`manager_config`), el que entra es trainer de ese grupo
       → se reconduce, nunca se crea fantasma.
  ✅ **CORRECCIÓN (jun 2026, verificado contra NoofitPro): `X-TRAINER_MANAGER`
  SÍ distingue manager de trainer.** En `loginEasy`, la cabecera devuelve el
  string **`"true"` = MANAGER** y **`"false"` = TRAINER**. Verificado cuenta a
  cuenta del grupo ROUND:
    - `roundgestion@noofit.com` (17677) → **`true`** = MANAGER del grupo.
    - `roundmalagacentro` (17675), `roundanoreta` (17674), 17676 → **`false`** = trainers.
  Olvidar la palabra "distribuidor": el modelo es **solo manager(`true`) /
  trainer(`false`)**. El flag es un BOOLEANO, NO un id (no usarlo como managerId).
  El grupo lo da `getTrainersByManager` (hermanos); dentro del grupo, el manager
  es el miembro con flag `true`. (La regla vieja "no distingue / false para todos"
  era ERRÓNEA: solo se habían probado las cuentas trainer, nunca el manager.)
  Interpretación robusta: `esManager = str(flag).lower() in ('true','1')`.
- **Manager del grupo ROUND = `17677` (roundgestion). Trainers = `17674`
  (Añoreta), `17675` (Málaga), `17676`.** La identidad de sesión se resuelve por
  el flag: manager(`true`) → ve todos los centros del grupo; trainer(`false`) →
  scopeado a su propio centro.
- **Solo una cuenta MANAGER (`true`) puede dar de alta un tenant nuevo**
  (`manager_config`). Un `false` desconocido se reconduce a su manager (o se
  rechaza), NUNCA crea tenant. Esto cierra el agujero por el que CUALQUIER cuenta
  NoofitPro del mundo creaba un tenant Round solo con loguearse (incidente
  fantasma 16702: `martincerverahugo@gmail.com`, trainer de OTRO manager ajeno,
  creó un tenant Round con 49 clientes ajenos al loguearse con sus creds NF).
- **REGLA al crear un `usuario_web`: el email NO puede existir ya en NoofitPro.**
  Antes de crear el usuario_web hay que CONSULTAR NoofitPro; si el email está
  ocupado (es una cuenta NoofitPro), se RECHAZA y se pide otro email. Motivo: si
  un usuario_web comparte email con una cuenta NoofitPro real (aunque sea de otro
  manager ajeno), esa persona puede entrar a Round con sus creds NF y crear un
  tenant fantasma (caso Hugo 16702). El usuario_web es cuenta NATIVA de Round; su
  email debe ser exclusivo de Round.
- La web no edita nombre, email, jerarquía ni credenciales NoofitPro del
  trainer/manager. Si algo está mal, se corrige **en NoofitPro**, no en la BD
  local ni en la UI.
- **Credenciales NoofitPro = solo cache, y solo si NoofitPro las valida.**
  `trainer_noofit_creds.noofit_password` / `manager_config.noofit_password` son
  una COPIA cacheada (la web la necesita para que los syncs/crons se
  reautentiquen contra NoofitPro). Regla al incorporar/loguear un manager o
  trainer: **`round-bootstrap` solo persiste/actualiza esa contraseña si
  NoofitPro la VALIDA** (`noofit_client.credenciales_validas` → loginEasy 200).
  Si NoofitPro la rechaza o está caído, **NUNCA** se pisa la copia buena que ya
  hubiera (UPSERT con `COALESCE(EXCLUDED.noofit_password, …)`). Así un valor
  stale/erróneo no corrompe las creds ni tumba el sync de un centro. La
  contraseña NoofitPro la gestiona NoofitPro; la web solo cachea lo que NF acepta.
- Origen del incidente que motivó esta regla: un login directo de trainer
  (Añoreta 17674) creó por error un `manager_config` fantasma y siloó sus
  datos. La regla y los guards lo impiden a futuro.

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
| Nginx config | `/etc/nginx/sites-enabled/noofit.wiemspro.com` |

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

- Frontend: `curl -s -o /dev/null -w "%{http_code}\n" https://noofit.wiemspro.com/`
  debe responder `200`.
- Backend: `curl -s "https://noofit.wiemspro.com/api/crm/slots-disponibles?centro=malagacentro"`
  debe devolver JSON con `ok:true`.
- Logs: `ssh round-vps "journalctl -u round_config_api -n 30 --no-pager"`.

## Auditoría / logging obligatorio de endpoints (regla)

**REGLA: todo endpoint NUEVO que MUTE datos (POST/PATCH/PUT/DELETE) DEBE
registrar su uso en `accion_log`** — quién lo hizo, qué cambió, cuándo y
desde qué IP. No es opcional: forma parte de "endpoint terminado".

- Helpers en `app/audit_log.py`:
  - `actor_from_request()` → detecta el actor (usuario_web por JWT, o
    manager por `X-Round-Manager-Id`; resuelve email/nombre de la persona).
  - `log_action(actor, entidad, accion, *, entidad_id=None, resumen=None, cambios=None)`
    → inserta en `accion_log`. Es **fail-silent** (nunca rompe la petición).
  - `diff_dict(before, after)` → `{campo: {before, after}}` solo de lo que cambia.
- Patrón (en la rama de ÉXITO, justo antes del `return`; NO en los returns
  de validación/error):

  ```python
  from ..audit_log import log_action, actor_from_request, diff_dict
  ...
  log_action(actor_from_request(), entidad='cuota', accion='update',
             entidad_id=cuota_id, resumen='Editada cuota',
             cambios=diff_dict(antes, despues))
  ```

- `accion`: verbo corto (`create`/`update`/`delete`/`asignar`/`cobrar`/…).
  `entidad`: nombre estable del recurso. `entidad_id`: id afectado (u omitir).
- **NUNCA** meter secretos en `cambios` (passwords, tokens PayComet/Meta,
  api keys SMTP): registrar solo el NOMBRE del campo modificado
  (p.ej. `cambios={'campos_modificados': ['api_token']}`).
- **Login**: ya se registra en `routes/auth_usuario.py` (usuario_web) y
  `routes/auth_bootstrap.py` (manager/trainer NoofitPro, solo login real /
  impersonación, no en recargas). Cualquier nuevo flujo de auth lo replica.
- Tabla destino: `accion_log` (cols `ts, id_manager, id_trainer, actor_kind,
  actor_id, actor_email, actor_label, entidad, entidad_id, accion, resumen,
  cambios, ip, user_agent`).

## Servicios y crones del VPS

| Servicio | Frecuencia | Función |
|---|---|---|
| `round_config_api.service` | siempre activo | API Flask |
| `round_slots_cleanup.timer` | cada 5 min | libera slots prueba expirados |
| `round_reminders.timer` | cada 30 min | recordatorios prueba 24h antes |
| `round_cliente_log.timer` | diario 03:30 | log cambios estado cliente |
| `round_social_publish.timer` | cada 5 min | publica posts Meta programados |
| `round_entradas_puntuales.timer` | cada 5 min | detecta reservas confirmadas → entradas puntuales |
| `round_estado_fisico_sync.timer` | diario 03:45 | sync tests estado físico NoofitPro → cache local |
| `round_ejercicios_sync.timer` | diario 04:15 | sync ejercicios realizados (getTrainingsUser) → `ejercicio_realizado` |
| `round_descuentos_auto.timer` | diario 03:15 | recalcula descuentos AUTO (familiares + varias_cuotas) → `descuento_asignacion` con `origen='auto_*'`. También se dispara JUSTO ANTES de preemitir (`preemision_validar`) y emitir (`preemision_v2.generar`). El cron NO aplica scope #28 por trainer (solo marca quién cumple); el scope lo aplica la emisión. |
| `round_reconciliacion_recibos.timer` | diario 05:00 | reconcilia recibo BD ↔ Odoo (pago inexistente/cancelado, factura no posteada, devolución no propagada) → 1 incidencia RESUMEN por manager si diverge (auditoría #31). |
| `round_competiciones_sync.timer` | diario 04:45 | barre `getSalasByManagerByRange` (salas `competicion=true`) → `sala.users[]` → `competicion_realizada`. Alimenta el informe `/informe-competiciones` y el historial por cliente. (Round no usa la modalidad aún → 0 datos.) |

## Tablas BD principales (round_config)

- `manager_config` — catálogo de managers + sus credenciales NoofitPro
  (multi-tenant: los crons iteran sobre las filas activas)
- `cuota`, `descuento`, `modificacion` — catálogos del manager
  (cuota: cols `tipo_cuota` ['recurrente'|'entrada_puntual'] + `precio_entrada`)
- `cuota_cliente`, `descuento_asignacion`, `modificacion_cobro` — asignaciones
  (descuento_asignacion: cols `trabajador_id` + `relacion` para tipo
  `familiar_trabajador`)
- `entrada_puntual_alta` — registro local de clientes en cuotas de entrada
  puntual (modo `por_entrada`|`por_mes`, forma_pago, precio_entrada). Fuente de
  verdad para la detección (desacopla de Odoo round.subscription).
- `entrada_puntual_evento` — cada reserva confirmada detectada = una entrada a
  cobrar (por_entrada, recepción) o facturar al cierre de mes (por_mes).
  Estados: pendiente|cobrado|facturado|anulado. UNIQUE cliente+sala+fecha.
- `centro_contacto` — un centro por trainer (slug, email, teléfono)
- `lead_asignacion` — leads CRM (con stage_history, score, qualification, lost_reason)
- `slot_reserva` — reservas prueba gratuita con token + expiry
- `email_proveedor` — config Resend/Postmark/SMTP/Gmail (manager + per trainer)
- `email_template` — plantillas con variables `{{var}}` por evento
- `pasarela_credenciales` — PayComet por trainer
- `cliente_estado_log` — track diario activo↔inactivo
- `cliente_baja_programada` — baja PERMANENTE en una fecha (cron la ejecuta).
- `cliente_inactivo_temporal` — **inactividad TEMPORAL** (pausa con `fecha_inicio`,
  `fecha_fin`, `motivo` [baja_medica|lesion|vacaciones|cambio_trabajo_domicilio|
  otros], estado programada|en_curso|finalizada|cancelada). El cron
  `round_baja_programada` archiva en NoofitPro al llegar `fecha_inicio` y
  reactiva al pasar `fecha_fin` (restaura `enabled_anterior`). Durante la
  ventana: no reserva/asiste (enabled=false NF) y no se emite cuota (guard en
  `preemision_v2`, regla "no cobrar ningún mes que la pausa toque"). Al crear,
  anula recibos BD no pagados de los meses cubiertos (account_move_id IS NULL).
  Endpoints `/api/clientes/<id>/inactivo-temporal` (POST/DELETE/GET) +
  `/api/clientes/inactivo-temporal` (GET lista). Mutuamente excluyente con
  baja programada. Filtro de listado "Temporal inactivo".
- `social_cuenta`, `social_post` — agenda Meta Instagram + Facebook
- `cliente_gympass` — extensión local para gympassId
- `ejercicio_realizado` + `ejercicio_sync_cliente` — cache local de los
  ejercicios ejecutados por cliente (NoofitPro `getTrainingsUser`, lista hija
  `informe`: nombre, reps, duración…). Sync INCREMENTAL por cliente vía header
  `initialId` (= max id de sesión vista). Alimenta el informe "Ejercicios"
  (`/informe-ejercicios`): ranking de consumo con filtros/desglose por sexo
  (gender M/H=hombre, F=mujer), franja edad (birthdate), día semana y franja
  horaria. Demografía cruzada con `cliente_cache.raw_data`, no duplicada.
  Endpoints: `GET /api/informes/ejercicios[/estado]` + `POST .../sync`.
- `categoria` + `cliente_categoria` — categorías de cliente per manager
  (Gympass / Trabajador / Invitado / …) con flags `puede_reservar`,
  `tiene_cuota`, `activa`
- `manager_config` (cols Fase 6) — `odoo_crm_enabled`,
  `odoo_cuotas_enabled`, `odoo_contabilidad_enabled` (booleanos
  granulares), `sistemas_cobro` (JSONB lista). Sustituyen al monolítico
  `odoo_enabled` (que se conserva para compat retro).
- `manager_config` (cols Fase 7) — `control_horario_enabled`,
  `control_horario_activated_at`, `control_horario_qr_secret` (HS256
  para firmar QR rotativos del módulo de control horario).
- `convenio` — catálogo de convenios (globales sembrados + per-manager).
- `trainer_empresa` — datos jurídicos por trainer (CIF, razón social,
  convenio, overrides de horas/vacaciones/asuntos propios). El trainer es
  la entidad empleadora a efectos del registro horario.
- `trabajador` — espejo local de clientes NoofitPro categoría Trabajador
  con datos laborales (NIF, jornada, trainer empleador, fecha alta/baja).
- `trabajador_trainer` — pivote N:M para trabajadores que rotan entre
  trainers del mismo manager.
- `pausa_motivo` — catálogo motivos pausa (globales + override per-manager).
- `fichaje_evento` — **append-only**, hash-chain SHA-256, retención 4 años
  por normativa. Cada evento lleva `prev_hash` + `hash` del payload.
- `correccion_solicitud` — solicitudes del trabajador resueltas por admin.

## Credenciales y secretos (NO subir a git)

- `~/.ssh/odoo_carajfam` — clave SSH al VPS
- `/opt/round_config_api/.env` en VPS — DB, Resend, NoofitPro, ROUND_DEFAULT_MANAGER
- Login NoofitPro: `roundgestion@noofit.com` / `1234abcd` (manager_id real `7673`)
- Login Round web: el mismo email que NoofitPro
- IDs reales (Round, manager por defecto):
  - **id_manager (Round Config)**: `17675` — coincide con el id NoofitPro
    devuelto al hacer login con `roundgestion@noofit.com`. Es la clave que
    el frontend manda en `X-Round-Manager-Id` y la que usa el cron al
    iterar `manager_config`.
  - Manager parent NoofitPro: **7673** (el "global gym manager" interno
    de NoofitPro; no se usa directamente desde Round).
  - Trainer ROUND MÁLAGA CENTRO: **17675**
  - Trainer ROUND AÑORETA: **17674** (es un TRAINER del manager 17675, NO un
    manager propio. NoofitPro devuelve `X-TRAINER_MANAGER=false` al loguearlo).
  - id_manager interno (Round Config): **17677** (no es el de NoofitPro)

  > **Login directo de trainer + remap (jun 2026).** Cuando un trainer entra
  > con sus PROPIAS credenciales NoofitPro, loginEasy devuelve
  > `X-TRAINER_MANAGER=false` y el frontend cae a usar el id propio como
  > `id_manager`. Para no crear un "manager fantasma" (le pasó a Añoreta:
  > acabó con `manager_config` 17674 y sus datos siloados), hay dos defensas
  > en backend:
  >   - `auth.parent_manager_si_es_trainer(id)` + `_remap_trainer_as_manager()`
  >     en `auth_required`: si el `id_manager` recibido NO tiene `manager_config`
  >     pero SÍ es `id_trainer` de otro manager en `trainer_noofit_creds`, la
  >     petición se reconduce a `id_manager=<padre>` + `id_trainer=<id>`.
  >   - `round-bootstrap`: si el que entra ya es trainer de otro manager, NO
  >     crea `manager_config`; solo refresca sus creds bajo el manager padre.
  > Requisito: cada trainer debe estar registrado en `trainer_noofit_creds`
  > como `(id_manager_padre, id_trainer)`. Cada movimiento Odoo lleva además la
  > analítica del trainer para diferenciarlos dentro de la company compartida.

## Política de scope (mayo 2026)

**Las reglas se guardan manager-wide POR DEFECTO**. Solo si la petición
explicita `scope='trainer'` (o pasa `id_trainer` en el body) se restringe
a un trainer concreto. El simple hecho de estar impersonando un trainer
al crear NO debe limitar la regla a ese trainer.

Aplica a catálogos: `cuota`, `descuento`, `modificacion` (esta es
per-cliente, así que sigue con trainer-scope obligatorio), `categoria`
(manager-wide por diseño), `convenio`, `pausa_motivo`.

Excepciones explícitamente per-trainer: `centro_contacto`, `pasarela_credenciales`,
`email_proveedor` (cada uno con su sufijo `trainer-id` cuando aplica),
`trainer_empresa`.

## Endpoints públicos del backend (noofit.wiemspro.com)

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
POST   /api/cuotas/alta-cliente   (alta.importe_cero_justificado + alta.justificacion → recibo 0€ justificado)

# Entradas puntuales (drop-in / pago por visita)
GET/POST/DELETE /api/entradas-puntuales/altas      → registro local de altas
GET    /api/entradas-puntuales/pendientes          → banner cobro recepción (por_entrada)
GET    /api/entradas-puntuales/eventos             → listado (filtros estado|modo|mes|cliente)
POST   /api/entradas-puntuales/eventos/<id>/cobrar → cobro recepción (genera recibo suelto)
POST   /api/entradas-puntuales/eventos/<id>/anular
POST   /api/entradas-puntuales/emitir-mes          → factura agregada mes (por_mes)
POST   /api/entradas-puntuales/detectar            → dispara detección a demanda

GET/PUT /api/config/centros|email|email-templates|pasarelas
GET/PUT /api/social/cuentas|posts

# Form builder embebible (lead capture, junio 2026)
# Tabla lead_form (per manager): public_id, tipo(lead|prueba), campos JSONB,
# config JSONB. El manager crea forms en Configuración → Formularios y los
# incrusta vía <iframe src=".../f/<public_id>">. Submit reutiliza
# _procesar_lead (crm.py, multi-tenant) o crear_reserva_core (slots.py).
POST   /api/crm/form/<public_id>        → submit público (lead o reserva prueba)
GET    /api/crm/form/<public_id>        → definición del form (público)
GET    /api/crm/form/<public_id>/slots  → slots de prueba (tipo='prueba')
GET/POST/PATCH/DELETE /api/config/formularios[/<id>]  → CRUD (perm configuracion.formularios.*)
# Página pública React: /f/<public_id> (PublicForm.jsx, sin auth, framable).
# Webhook Tally legacy (deshabilitado, requería Tally Pro): /api/crm/lead/tally?k=<token>

# Despliegue Odoo per-manager (multimanager)
POST   /api/auth/round-bootstrap        → auto-registro manager+trainer tras login NF
GET    /api/manager/odoo-status         → estado granular (3 flags + sistemas_cobro)
POST   /api/manager/wc-check            → consulta tipo S en wcommerce
PATCH  /api/manager/wcommerce-cliente   → set id wcommerce manual
POST   /api/manager/provision/<modulo>  → activar módulo (crm|cuotas|contabilidad), idempotente
POST   /api/manager/solicitud-despliegue → legacy: activar los 3 a la vez
GET    /api/manager/trainers-contabilidad
PATCH  /api/manager/trainers-contabilidad/<id_trainer>

# Control horario laboral (Fase 7)
# Trabajador (JWT propio kind='trabajador')
POST   /api/horario/auth/login          → loginEasy NF + emite JWT propio (7 días)
GET    /api/horario/me
POST   /api/horario/fichaje             → ENTRADA/SALIDA/PAUSA_INI/PAUSA_FIN (+qr_token opcional)
GET    /api/horario/estado              → fuera|dentro|en_pausa
GET    /api/horario/mi-jornada/hoy
POST   /api/horario/correccion          → solicitud → admin aprueba/rechaza
# Admin (X-Round-Token + @require_feature('control_horario'))
POST   /api/horario/activar | /desactivar
GET    /api/horario/convenios
GET/PUT /api/horario/trainer-empresa[/<trainer>]
GET/POST/PATCH/DELETE /api/horario/pausa-motivos[/<id>]
GET    /api/horario/trabajadores[/pendientes|/<id>]
POST   /api/horario/trabajadores        → alta laboral
PATCH  /api/horario/trabajadores/<id>
POST   /api/horario/trabajadores/<id>/{baja,reactivar,trainers}
GET    /api/horario/qr-actual/<trainer> → token JWT del QR (exp 10 min)
GET    /api/horario/eventos             → listado con filtros
GET    /api/horario/correcciones
POST   /api/horario/correcciones/<id>/{aprobar,rechazar}
POST   /api/horario/eventos/correccion  → corrección directa admin
GET    /api/horario/verify-chain/<trabajador_id>
```

## Activación granular Odoo (Fase 6, mayo 2026)

A partir de Fase 6 cada módulo Odoo se activa por separado desde
**Configuración → Suscripciones** (pestaña principal). El antiguo wizard
"Desplegar contabilidad" queda como legacy.

### ⛔ REGLA ARQUITECTÓNICA — una BASE DE DATOS Odoo por manager (no una company)

**Cuando un manager activa una "empresa Odoo" (al contratar contabilidad,
cuotas o CRM) se crea una BASE DE DATOS Odoo NUEVA y dedicada para ese manager
— NO una `res.company` dentro de la base de datos `round_facturacion`.**

- Aislamiento por BD = aislamiento total: un manager nunca puede ver/escribir
  datos de otro porque ni siquiera comparten base de datos. Es el blindaje
  multi-tenant definitivo (mejor que multi-company por filas).
- `manager_config.odoo_url` (y/o un `odoo_db` por manager) identifica la
  instancia/BD del manager. La conexión XML-RPC se hace contra ESA BD.
- **Dentro de la BD del manager**, los trainers se separan así:
  - trainer SIN entidad jurídica propia → analítica (`trainer_analytic_id`)
    dentro de la company del manager.
  - trainer CON entidad jurídica distinta (CIF propio) → `res.company`
    PROPIA **dentro de la BD del manager** (`trainer_empresa.odoo_company_id`).
  Es decir: la frontera de **BD = manager**; dentro, la frontera de
  **company = entidad jurídica** (manager o trainer-entidad).
- `resolve_company(manager, trainer)` (B1) resuelve la company DENTRO de la BD
  del manager; la resolución de la **BD/URL** se hace por `odoo_url`/`odoo_db`
  del manager (ya soportado en `OdooCuotas._ensure_identity`).
- **Estado actual (jun 2026)**: solo opera el manager Round (17675) en la BD
  histórica `round_facturacion`, company 3. Los próximos managers que activen
  módulos estrenarán BD propia. El provisioner debe crear la BD (no solo la
  company) y registrar `odoo_url`/`odoo_db` en `manager_config`.
- La company `1` ("BEST TRAINING legacy USA - NO USAR") es legacy/prohibida
  (lista negra `ODOO_LEGACY_COMPANY_IDS`, guard B1).

### ⛔ REGLA DE PROVISIÓN — orden de alta y empresa por CIF

**Cuando un manager NUEVO active contabilidad / cuotas / crm, el provisioner
debe seguir EXACTAMENTE este orden, sin equivocaciones:**

1. **Crear la BD Odoo del manager + su empresa (`res.company`)** siguiendo la
   estructura de facturación Round (plan PYMES, cuentas **430XXX por trainer**
   —`430`+nº centro a 3 dígitos, padding fijo, hasta 999—, `ir.sequence` por
   serie, tipos de IVA, journals, analítica). El cliente es **tercero
   (`res.partner`) con `id_noofit` único**, NUNCA una cuenta.
2. **Al crear/incorporar los trainers, la empresa se decide por el CIF:**
   - Trainer con el **MISMO CIF** que una empresa ya existente del manager →
     **comparte esa `res.company`** (se separa por **analítica + su 430XXX +
     su serie** dentro de ella).
   - Trainer con **CIF DISTINTO** → se le **crea una `res.company` propia**
     (dentro de la MISMA BD del manager) siguiendo esta misma estructura.

   Es decir: **frontera de BD = manager; frontera de company = CIF (entidad
   jurídica)**. El CIF vive en `trainer_empresa.cif`; la company resultante en
   `trainer_empresa.odoo_company_id`. `resolve_company(manager, trainer)`
   devuelve esa company (la propia del trainer-entidad o, si comparte CIF, la
   del manager).
3. La **config de facturación** (sistema inmediata/fin_de_mes, destino
   cliente/430XXX, tipos de IVA, series) es **igual para todos los trainers
   que comparten company** y **solo la modifica el manager**.

(Detalle del modelo de facturación: `docs/DESPLIEGUE_ODOO.md` y el brief de
implantación. Las modificaciones del lado Odoo se hacen en su propio chat.)

- **3 columnas booleanas en manager_config**:
  `odoo_crm_enabled`, `odoo_cuotas_enabled`, `odoo_contabilidad_enabled`
  + `sistemas_cobro` JSONB (lista, valores válidos: `sepa`,
  `tpv_virtual`, `link_pago`, `efectivo`, `transferencia_manual`,
  `tokenizacion_tarjeta`).
- **Provisioner modular** en `app/odoo_provisioner.py`:
  `provision_crm()`, `provision_cuotas()`, `provision_contabilidad()`.
  Cada uno IDEMPOTENTE — se puede llamar N veces sin duplicar. Comparten
  helpers `ensure_company`, `ensure_chart`, `ensure_journals`,
  `ensure_bank`, `ensure_sequence`, `ensure_adminround`,
  `ensure_analytic`, `save_sistemas_cobro`.
- **Decorador granular**: `@require_feature('crm'|'cuotas'|'contabilidad')`
  (en `app/odoo_guard.py`). Endpoints de cada módulo ya decorados.
  Devuelve `403 feature_not_enabled` si la flag está a `false`.
- **Frontend**: tab `SuscripcionesTab.jsx` con 3 cards + 3 wizards
  (`WizardActivarCRM/Cuotas/Contabilidad.jsx`).
- **Manager por defecto (Round 17675)**: exento del check `tipo_pago_wc=S`
  (siempre puede reactivar/reconfigurar). Sus 3 flags se backfillearon en
  la migración A1.
- Detalle completo en `docs/DESPLIEGUE_ODOO.md` (sección "Fase 6").

## Control horario laboral (Fase 7, mayo 2026)

Módulo de fichaje de trabajadores. Cumple `art. 34.9 ET` (RD-Ley 8/2019) y
está preparado para la reforma del RD digital en trámite.

- **Activación por manager** (suscripción): `manager_config.control_horario_enabled`.
  Endpoint `POST /api/horario/activar` flipea el flag y genera el
  `control_horario_qr_secret` lazy.
- **Decorador**: `@require_feature('control_horario')` (en
  `odoo_guard.py`, reutilizado a pesar del nombre).
- **Empleador = siempre el trainer**. Cuando manager y trainer coinciden
  legalmente, simplemente son la misma persona/empresa.
- **Trabajador** = cliente NoofitPro con categoría `Trabajador` + alta
  laboral confirmada (NIF, jornada, trainer empleador obligatorios para
  estado `activo`). Híbrido: NoofitPro propone, admin confirma.
- **Pivote `trabajador_trainer`**: un trabajador puede fichar en varios
  trainers del mismo manager. La entidad empleadora sigue siendo única.
- **`fichaje_evento` append-only + hash-chain SHA-256** (cada fila guarda
  `prev_hash` + `hash` del payload canónico). Inserciones serializadas con
  `SELECT … FOR UPDATE`. Verificación: `GET /api/horario/verify-chain/<id>`.
- **QR rotativo HS256** firmado con `control_horario_qr_secret`, exp 10 min.
  Cuando hay clase activa NoofitPro sirve también el QR de la clase
  (validación contra NoofitPro pendiente Fase 1.5).
- **Auth del trabajador**: `POST /api/horario/auth/login` con email+password
  NoofitPro → backend hace loginEasy → emite JWT propio (`kind='trabajador'`,
  exp 7 días). El JWT propio es lo que mynoofit/web reenvían en
  `Authorization: Bearer …`.
- **Correcciones**: trabajador solicita (`/correccion`, queda pendiente) o
  admin inserta directa (`/eventos/correccion`). Al aprobar se crea evento
  `CORRECCION_INSERT` o `CORRECCION_ANULAR` con `corrige_evento_id` apuntando
  al original (que NUNCA se borra/edita).
- **Frontend**: `src/pages/ControlHorario/` con 5 tabs (Trabajadores,
  Fichajes, QR, Correcciones, Configuración). Helpers API en
  `src/utils/horarioApi.js`. Entrada lateral oculta si feature=false; si
  el manager navega a mano a `/control-horario`, ve onboarding con botón
  "Activar módulo".
- **nginx**: necesita `location ^~ /api/horario/` proxy al backend (sin él
  POST → 405). Añadido el 2026-05-24.
- Spec mynoofit: `docs/SPEC_API_MYNOOFIT_FICHAJE.md` (para equipo MAUI).
- Detalle completo: `docs/CONTROL_HORARIO.md`.

## Subsistema POS / TPV (Fases 1-10 + 3 sprints fix, mayo 2026)

Punto de venta táctil del centro: vender productos/servicios, descuentos,
cuadre diario, dashboard, facturas proveedor. Sincroniza con Odoo
(account.move + account.payment + reconcile) y respeta SII.

### Activación
- Requiere `manager_config.odoo_cuotas_enabled=TRUE` para metodo
  `recibo_mensual` y para que cualquier venta cree move en Odoo. Sin Odoo
  se pueden hacer ventas locales que quedan en `sync_status='skipped'`.
- Catálogo (productos/categorías/descuentos) funciona sin Odoo.

### Tablas BD (round_config)
- `pos_categoria` — plantilla global (id_manager NULL) + per-manager.
- `pos_producto` — per-trainer (cada centro su catálogo). Cuenta 700/705
  por defecto. Inventariables tienen `stock_actual` auto-actualizado.
- `pos_descuento` — porcentaje/importe sobre producto/general per-trainer.
- `pos_stock_movimiento` — append-only. Tipos `reposicion|ajuste|baja|
  venta|anulacion|merma` con `id_trainer` propagado.
- `pos_venta` — cabecera con `numero='T-AAAA-NNNNN'` UNIQUE (manager,
  trainer, numero), `sync_status`, `odoo_move_id`, `odoo_payment_id`,
  `odoo_refund_move_id`, `recibo_id` (para applied_to_recibo).
- `pos_venta_linea` — snapshot inmutable (cuenta_contable, tipo).
- `pos_cierre_caja` — 1 cierre/trainer/día (UNIQUE), totales por método
  + diferencia entre contado vs esperado.
- `pos_factura_proveedor` — compras: NIF/CIF/NIE validado mod-23, in_invoice
  o in_refund (total<0), PDF attachable, DRAFT en Odoo (regla carajfam).

### Endpoints `/api/pos/` (35 endpoints, todos con `@require_permission`)
| Ruta | Permiso fino |
|---|---|
| GET/POST/PATCH/DELETE `/categorias[/<id>]` | `configuracion.pos.categorias_editar` (write) / `productos_ver` (read) |
| GET/POST/PATCH `/productos[/<id>]` + `/archivar` + `/restaurar` | `configuracion.pos.productos_*` |
| POST GET `/productos/<id>/stock/[ajuste|historial]` | `configuracion.pos.stock_ajuste` / `productos_ver` |
| POST/DELETE `/upload-media` (PDF/imagen/video) | `configuracion.pos.productos_editar` |
| GET/POST/PATCH/DELETE `/descuentos[/<id>]` | `configuracion.pos.descuentos_editar` (write) |
| POST `/ventas` (cobrar) | `tpv.ventas.cobrar` |
| GET `/ventas[/<id>]` | `tpv.ventas.ver` |
| POST `/ventas/<id>/anular` | `tpv.ventas.anular` |
| POST `/ventas/<id>/sync-odoo` + `/force-reset-sync` | `tpv.ventas.sync_odoo` |
| GET `/dashboard` | `tpv.dashboard.ver` |
| GET/POST `/caja/[resumen|cerrar|cierres|cierre/<id>]` | `tpv.caja.{ver,cerrar}` |
| GET/POST/PATCH `/proveedores[/<id>]` + `/anular` + `/sync` | `tpv.proveedores.{ver,crear,anular}` |

### Sincronización Odoo (`app/odoo_pos_sync.py`, `app/odoo_proveedores_sync.py`)
Reglas operativas:
- **Idempotency por `ref=`**: venta → `T-AAAA-NNNNN`; refund venta →
  `REV T-AAAA-NNNNN`; refund applied_to_recibo → `REV-APLIC T-...`;
  draft mensual → `TPV-AAAA-MM-<partner_id>`; factura proveedor →
  `PROV-<id>-<numero_factura[:20]>`; rectificativa proveedor →
  `REV-PROV-<id>`. Cualquier search-before-create filtra `state!='cancel'`.
- **Lock optimista BD** con `sync_status='syncing'|'reverting'` + TTL 5min
  (Audit #7, Sprint 1 #3) — un worker muerto libera el lock automático.
- **Validación post-acción**: tras `action_post`+reconcile, releemos
  `state='posted'` y `amount_residual=0`; si no, `sync_status='error'`
  con detalle (NO 'synced' silencioso). Audit #5.
- **price_include=True tax para ventas TPV** (auto-clonado del PYMES sin
  price_include) → descuadres 0.01€ resueltos. `purchase` tax SIN
  price_include para facturas proveedor.
- **Drafts only para proveedores**: `in_invoice`/`in_refund` quedan en
  state='draft' esperando validación humana del admin (regla carajfam).
- **Cuentas PGC**: 600/602/607/621-629 (proveedores), 700/705 (ventas),
  708 (descuentos sobre ventas), 4xx (IVA), 5xx (caja/banco).
- **Partner**: ventas TPV usan `id_noofit` (cliente NoofitPro) o
  "Consumidor final TPV" anónimo per-company; proveedores usan `vat`
  cross-company con `supplier_rank=1`.
- **Anulación**: ventas synced → `out_refund` con `reversed_entry_id` +
  payment outbound + reconcile (Sprint 1 #3); ventas
  applied_to_recibo → eliminar líneas del draft mensual, o si ya posteado
  fallback `_refund_aplicacion_posteada` (Sprint 1 #2); facturas
  proveedor → rectificativa `in_refund` con `reversed_entry_id` DRAFT
  para SII (Sprint 1 #1).

### Frontend
- `/tpv` — terminal de venta (grid productos + carrito + cobrar +
  cuadre + historial con anular)
- `/tpv/dashboard` — KPIs, gráficas, top productos/clientes
- `/tpv/proveedores` — listado + alta factura proveedor + PDF upload
- Configuración → Terminal de Caja — catálogo productos / categorías /
  descuentos (3 sub-tabs)
- Ficha cliente → pestaña "Compras TPV" — historial de compras del cliente
- Sidebar TPV es un grupo con children (Vender / Dashboard / Proveedores)

### Hallazgos resueltos por Sprint
- **Sprint 1 (contable/SII)**: lock + residual validation en revert venta;
  payment+reconcile en refund applied_to_recibo posteado; rectificativa
  in_refund con reversed_entry_id en anular factura proveedor (vs
  button_cancel anterior que rompía SII).
- **Sprint 2 (gates frontend)**: `useCan` en 4 páginas (TerminalCajaTab,
  DashboardTPV, TabComprasTPV, HistorialModal); UI anular venta TPV;
  `centroSel` se hidrata si `identity` llega tarde; `PagoModal` ya no
  cierra silencioso ante validación fallida.
- **Sprint 3 (polish)**: IVA descuento mixto (split proporcional por
  tramo IVA del carrito); descuentos fantasma se purgan al vaciar
  carrito o quitar el producto vinculado; `_attach_pdf` idempotente
  (search ir.attachment); `validarNifCifNie` frontend espejo del backend.

### Auditorías 1-10 (Sprint 0, ya resueltas)
1. Anular `applied_to_recibo` removía líneas del draft (Fase 6.5).
2. Path traversal `X-Round-Manager-Id` → validación regex `\d{1,16}`
   en `auth.py` + realpath check en upload.
3. Descuento type override → no admite producto_id si tipo=descuento.
4. `/tpv` ungated + recibo_mensual sin Odoo → backend valida
   `odoo_cuotas_enabled`, PagoModal deshabilita el botón.
5. `sync_status='synced'` aunque action_post/reconcile fallen → ahora
   marca 'error' con detalle.
6. Orphan payment (move sin payment) → flujo cae a creación normal y
   reusa move existente.
7. Lock `'syncing'` sin TTL → `sync_attempted_at < NOW()-5min` libera +
   endpoint admin `force-reset-sync`.
8/10. Cache negativo de tax/account permanente → NUNCA cachear None;
   si copy() falla, propaga excepción.
9. Race en `_siguiente_numero` → `pg_advisory_xact_lock` +
   UNIQUE (manager,trainer,numero).

## Cosas que NO hay que hacer

- ❌ Editar archivos directamente en el VPS sin pasar por git (perdería los
  cambios en el siguiente deploy desde otro PC).
- ❌ Subir `node_modules/`, `dist/`, `.env`, claves o backups al repo.
- ❌ Hacer `git push --force` a `main` desde un PC sin coordinar con el otro.
- ❌ Ejecutar `crear_alta_cliente` en producción si el cliente NoofitPro
  tiene email con `_MAK` (es marker de sandbox y NoofitPro no lo deja editar).
- ❌ Llamar a Meta Graph API sin tener el App Review aprobado y un Page
  Access Token de larga duración (60 días) configurado.

## Drill de restore (semestral)

Cada 6 meses (mínimo) ejecutar un drill de restore POS para verificar
que el backup sigue siendo recoverable end-to-end:

1. Elegir una `pos_venta` real reciente (e.g. ayer).
2. Backup actual: `pg_dump round_config -t pos_venta -t pos_venta_linea -t pos_stock_movimiento --data-only > /tmp/pre_drill.sql`.
3. Borrar la venta + sus líneas + sus movimientos (`DELETE FROM ... WHERE id=X`).
4. Restaurar siguiendo **ESCENARIO 5** de `docs/RECOVERY.md`.
5. Resync Odoo siguiendo **ESCENARIO 6**.
6. Verificar coherencia: cuadrar `stock_actual` vs `Σ movimientos`,
   `pos_venta.total` vs `account.move.amount_total`.
7. Registrar fecha y resultado en una nota interna.

Si algo falla → arreglar el procedimiento ANTES de la próxima desgracia.

## Cosas que sí hay que hacer

- ✅ `git pull` antes de empezar a trabajar en cualquier PC.
- ✅ `git push` antes de cerrar / cambiar de PC.
- ✅ Backup BD antes de cambios estructurales:
  `ssh round-vps "sudo -u postgres pg_dump round_config > /root/backup_$(date +%F).sql"`
- ✅ Verificar `systemctl is-active round_config_api` tras cada deploy backend.
- ✅ Validar email RFC con la regex en `odoo_cuotas.enviar_factura_email`
  antes de enviar (rechaza emails con `_MAK` y otros inválidos).
- ✅ Documentar nuevas tablas/endpoints en este CLAUDE.md.
- ✅ Todo endpoint nuevo que mute datos DEBE llamar a `log_action()` en su
  rama de éxito (ver "Auditoría / logging obligatorio de endpoints").

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

- **Registro de auditorías + REGLAS/invariantes** (LEER antes de tocar áreas
  sensibles: auth, recibos, facturación, POS, notas): `docs/AUDITORIAS_NOOFITWEB.md`
  — documento vivo con índice fechado y las reglas extraídas de cada auditoría
  (nota: la plataforma es **noofitweb**; "Round" = el manager de pruebas 17675)
  (cómo se detecta un manager, idempotencias, dedup BD/Odoo, same-trainer, etc.).
  Detalle de auth en `docs/AUDITORIA_AUTH_BOOTSTRAP.md`.
- **Modelo manager / trainer / usuario_web** (reglas inmutables de scope y
  privilegios): `docs/MANAGER_TRAINER.md` — **LEER antes de añadir tabla o
  endpoint nuevo**. Reglas clave: NoofitPro decide la jerarquía, manager
  habilita módulos para sus trainers, datos cliente/cuotas nunca cruzan
  manager, datos manager se comparten entre sus trainers.
- **Importar clientes desde otros softwares** (GestPlus, Excel, sistema
  legacy): `docs/IMPORTAR_CLIENTES.md` — **LEER antes de tocar import
  masivo**. Documenta 10 pitfalls reales (NoofitPro devuelve id incorrecto,
  emails con acentos, IBAN sin formato, partners Odoo duplicados…) y la
  receta paso a paso. Plantilla en `docs/imports/template_import_clientes.py`.
- Manual operativo (manager + trainers): `docs/Manual_CRM_Round.docx`
- Arquitectura técnica + infografía: `docs/Arquitectura_round_noofit.docx`
- Flujo dual-PC + setup nuevo PC: `docs/FLUJO_DUAL_PC.md`
- Integración pendiente con NoofitPro (cosas que mantenemos local
  hasta que NoofitPro las publique): `docs/INTEGRACION_NOOFIT_PENDIENTE.md`
- PayComet (sandbox + decisión de cobros vía Odoo, no vía suscripciones
  PayComet): `docs/PAYCOMET.md`
- **Despliegue Odoo per-manager** (Fases 1-5, mayo 2026):
  `docs/DESPLIEGUE_ODOO.md` — managers con suscripción wcommerce
  tipo S pueden activar su propio Odoo (contabilidad + remesas + CRM)
  desde Configuración → Contabilidad. 100% automático en ~15-30s vía
  provisioner: crea res.company, aplica plan PYMES, journals, IBAN,
  secuencias, analytic per-trainer. Manager actual (17675) exento.
- **Control horario laboral** (Fase 7, mayo 2026):
  `docs/CONTROL_HORARIO.md` + `docs/SPEC_API_MYNOOFIT_FICHAJE.md`.
  Fichaje de trabajadores conforme al art. 34.9 ET con hash-chain SHA-256,
  QR rotativo HS256 cada 10 min, correcciones con flujo de aprobación,
  retención 4 años. Activación por manager vía `POST /api/horario/activar`.
- Mantener este CLAUDE.md actualizado cuando cambien tablas, servicios o
  flujos críticos.
