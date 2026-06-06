# Despliegue de Odoo per-manager (Fases 1-6)

Guía operativa de la funcionalidad "Desplegar Contabilidad" que permite a
cada manager Round con suscripción wcommerce tipo **S** activar su propio
módulo de contabilidad, remesas y CRM en Odoo.

> **Para el manager actual `roundgestion@noofit.com` (id 17675)**: ya tiene
> Odoo desplegado de antes (company_id=3) y las 3 flags granulares (CRM,
> Cuotas, Contabilidad) en `true`. NO hay que hacer nada — su flujo es
> idéntico al de siempre.

---

## ⛔ REGLA ARQUITECTÓNICA — una BASE DE DATOS Odoo por manager

**Cuando un manager activa una empresa Odoo (al contratar contabilidad, cuotas
o CRM) se crea una BASE DE DATOS Odoo NUEVA y dedicada para ese manager — NO
una `res.company` dentro de la base de datos `round_facturacion`.**

- **Aislamiento por BD = aislamiento total**: dos managers nunca comparten base
  de datos, así que es imposible que uno vea/escriba datos de otro. Es el
  blindaje multi-tenant definitivo (superior al multi-company por filas).
- `manager_config.odoo_url` (y/o un `odoo_db` por manager) identifica la
  instancia/BD del manager; la conexión XML-RPC se hace contra ESA BD.
- **Dentro de la BD del manager**, los trainers se separan así:
  - trainer SIN entidad jurídica propia → **analítica** (`trainer_analytic_id`)
    dentro de la company del manager.
  - trainer CON entidad jurídica distinta (CIF propio) → **`res.company`
    propia dentro de la BD del manager** (`trainer_empresa.odoo_company_id`).

  Frontera de **BD = manager**; dentro, frontera de **company = entidad
  jurídica** (manager o trainer-entidad).
- `resolve_company(manager, trainer)` (guard B1, `odoo_cuotas.py`) resuelve la
  company DENTRO de la BD del manager; la resolución de la **BD/URL** se hace
  por `odoo_url`/`odoo_db` del manager (ya soportado en
  `OdooCuotas._ensure_identity`). La company `1` legacy ("BEST TRAINING legacy
  USA - NO USAR") está en la lista negra `ODOO_LEGACY_COMPANY_IDS` y se rechaza.
- **Estado actual (jun 2026)**: solo opera Round (17675) en la BD histórica
  `round_facturacion` (company 3). Los **próximos** managers que activen módulos
  estrenarán BD propia. ⚠️ **Pendiente en el provisioner** (`odoo_provisioner.py`,
  hoy hace `ensure_company` dentro de `round_facturacion`): al entrar el primer
  manager nuevo debe **crear la BD** (no solo la company) y registrar
  `odoo_url`/`odoo_db` en `manager_config`.

---

## Fase 6 — Activación granular por módulo (mayo 2026)

A partir de Fase 6 el despliegue **deja de ser monolítico**. En lugar de
un único wizard que activa CRM + Cuotas + Contabilidad a la vez, cada
módulo puede activarse de forma independiente desde la nueva pestaña
**Configuración → Suscripciones**.

### Por qué se cambió

- **Cuotas** y **Contabilidad** son ortogonales: un gimnasio puede querer
  solo emitir recibos sin gestionar gastos (o al revés). Forzarlos
  conjuntos era una limitación artificial.
- **CRM** no requiere plan contable ni IBAN. Mantenerlo bajo el mismo
  wizard pesado entorpecía a los managers que solo quieren el pipeline
  de leads.
- La activación granular permite **upselling progresivo**: un manager
  arranca con CRM, prueba el sistema, y luego añade Cuotas y/o
  Contabilidad cuando esté listo.

### Modelo de datos

`manager_config` ahora tiene **3 columnas booleanas + sistemas_cobro
JSONB** además del histórico `odoo_enabled`:

| Columna | Significado |
|---|---|
| `odoo_enabled` | Existe `res.company`. Compatibilidad retro. |
| `odoo_crm_enabled` | Pipeline CRM + funnel + leads disponibles. |
| `odoo_cuotas_enabled` | Catálogos, recibos, SEPA, TPV, sistemas_cobro. |
| `odoo_contabilidad_enabled` | Gastos, OCR, asientos, conciliación. |
| `sistemas_cobro` | JSONB: `["sepa","tpv_virtual","link_pago","efectivo","transferencia_manual","tokenizacion_tarjeta"]` |

Backfill: cualquier manager con `odoo_enabled=true` en la migración
recibió las 3 flags granulares en `true` automáticamente (Round 17675
incluido).

### Provisioner modular

`app/odoo_provisioner.py` ahora expone **3 funciones idempotentes**:

```python
provision_crm(id_manager, datos, steps=None) -> dict
provision_cuotas(id_manager, datos, steps=None) -> dict
provision_contabilidad(id_manager, datos, steps=None) -> dict
```

Cada una compone helpers idempotentes:

| Helper | Reutilizable | Comportamiento |
|---|---|---|
| `ensure_company` | sí | Reutiliza `odoo_company_id` de manager_config si existe. |
| `ensure_adminround` | sí | No añade si ya está en `company_ids`. |
| `ensure_analytic` | sí | No re-crea si `odoo_analytic_default_id` ya está. |
| `ensure_chart` | sí | Comprueba `account.account` count > 100 antes de aplicar. |
| `ensure_journals` | sí | Busca por `(company_id, code)` antes de crear. |
| `ensure_bank` | sí | Busca por IBAN antes de crear. |
| `ensure_sequence` | sí | Busca por `code='account.move.invoice.<id>'`. |
| `save_sistemas_cobro` | sí | Filtra por whitelist y guarda JSONB. |

La clase `OdooProvisioner` legacy se mantiene (compatible retro con el
endpoint `/api/manager/solicitud-despliegue`): internamente delega en los
3 sub-provisioners en cascada.

### Decorador `require_feature(name)`

`app/odoo_guard.py` expone `@require_feature('crm'|'cuotas'|'contabilidad')`
que devuelve `403 feature_not_enabled` con `feature` y `motivo` específico
si la columna correspondiente está a `false`. Endpoints decorados:

- `crm.py`: `/leads`, `/leads/<id>`, `/stages`, `/lost-reasons`, `/funnel`
  → `@require_feature('crm')`
- `cuotas_clientes.py`, `subscriptions.py`, `facturacion_trimestre.py`
  → `@require_feature('cuotas')`
- `contabilidad.py` (30 endpoints) → `@require_feature('contabilidad')`

El decorador legacy `@require_odoo` se mantiene para compat retro pero ya
no se usa en nuevos endpoints.

### Endpoint nuevo

```
POST /api/manager/provision/<modulo>      # modulo ∈ {crm, cuotas, contabilidad}
Auth: X-Round-Token + X-Round-Manager-Id
Body: payload del módulo correspondiente (puede ser {} si la company ya existe)
```

Reglas de elegibilidad (las 3 actúan como OR de exenciones):
- Manager por defecto (Round 17675) → siempre permitido
- Módulo ya activado → permitido (idempotencia)
- Resto: requiere `tipo_pago_wc='S'` en wcommerce

Errores posibles:
- `404 manager_not_found`
- `400 modulo_invalido` (whitelist)
- `400 missing_fields` (razon_social/cif solo si la company no existe)
- `403 not_eligible` (tipo_pago_wc != 'S')
- `502 provisioner_failed` (con `step` y `log`)

### Frontend (Fase 6)

| Archivo | Función |
|---|---|
| `src/pages/Configuracion/SuscripcionesTab.jsx` | Tab principal con 3 sub-tabs CRM / Cuotas / Contabilidad. Incluye cabecera de comprobación wcommerce + card por módulo. |
| `src/components/WizardActivarCRM.jsx` | Wizard 1-2 pasos. Solo confirma (o pide razon_social+cif si la company no existe). |
| `src/components/WizardActivarCuotas.jsx` | Wizard 5-6 pasos: fiscal → plan → IBAN → numeración → sistemas_cobro → revisar. |
| `src/components/WizardActivarContabilidad.jsx` | Wizard 2-3 pasos: fiscal → plan → revisar. |

La pestaña antigua **Configuración → Contabilidad** sigue existiendo pero
ahora se gatea con `featureFlag='contabilidad'` → solo aparece si el
módulo está activado, y solo contiene la **config per-trainer + categorías
de gasto + visibilidad de listados** (sin el banner de activación, que
vive en Suscripciones).

### Sistemas de cobro (canónicos)

Lista cerrada en `app/odoo_provisioner.py:SISTEMAS_COBRO_VALIDOS`:

```
sepa, tpv_virtual, link_pago, efectivo,
transferencia_manual, tokenizacion_tarjeta
```

El frontend (`WizardActivarCuotas.jsx`) ofrece checkboxes con descripción
para cada uno. Se guardan como array JSONB en `manager_config.sistemas_cobro`.

### Flujo UX nuevo

```
Manager entra a Configuración → Suscripciones
        │
        ▼
   ┌──────────────────────┐
   │ Comprobar wcommerce  │ (saltado si es default manager
   │  → tipo_pago_wc=S ?  │  o si ya tiene algún módulo activo)
   └──────────┬───────────┘
              │ OK
              ▼
   ┌──────────────────────────────────────────┐
   │  3 cards: CRM · Cuotas · Contabilidad    │
   │  Cada una con badge "Activado" o botón   │
   │  "Activar <Módulo>"                       │
   └──────────────────────────────────────────┘
              │
              ▼ (manager pulsa Activar Cuotas)
   ┌──────────────────────────────────────────┐
   │ Wizard 5-6 pasos (sessionStorage borr.)  │
   │   fiscal → plan → IBAN → numer →         │
   │   sistemas_cobro → revisar               │
   └──────────────┬───────────────────────────┘
                  │ submit
                  ▼
   POST /api/manager/provision/cuotas
                  │
                  ▼
   Provisioner síncrono (~15s) — todos los
   ensure_* son idempotentes
                  │
                  ▼
   manager_config.odoo_cuotas_enabled=true
   manager_config.sistemas_cobro=[...]
                  │
                  ▼
   Frontend: refresh useOdooStatus + emit
   round.odoo-status-changed →
   sidebar muestra "Cuotas mensuales"
   Configuración muestra tabs "Cuotas /
   Descuentos / Modificaciones / …"
```

### Verificación rápida

```bash
TK=$(ssh round-vps "grep '^CONFIG_API_TOKEN=' /opt/round_config_api/.env | cut -d= -f2")

# Status (debería mostrar las 3 flags + sistemas_cobro)
curl -s -H "X-Round-Token: $TK" -H "X-Round-Manager-Id: 17675" \
     https://noofit.wiemspro.com/api/manager/odoo-status | jq .

# Activar idempotente (no rompe si ya está activo)
curl -s -X POST -H "X-Round-Token: $TK" -H "X-Round-Manager-Id: 17675" \
     -H "Content-Type: application/json" \
     -d '{"sistemas_cobro":["sepa","tpv_virtual","link_pago"]}' \
     https://noofit.wiemspro.com/api/manager/provision/cuotas | jq .

# Gate funcionando: manager sin la flag → 403
curl -s -H "X-Round-Token: $TK" -H "X-Round-Manager-Id: 17679" \
     https://noofit.wiemspro.com/api/subscriptions/cuotas-catalogo | jq .
# → {"error":"feature_not_enabled","feature":"cuotas",…}
```

---

## Fases 1-5 (legacy — "Despliegue total")

La sección que sigue describe el flujo monolítico original. Sigue
disponible vía `POST /api/manager/solicitud-despliegue` y el wizard
`WizardDespliegueOdoo.jsx`, pero **a partir de Fase 6 el flujo
recomendado es Suscripciones**. Documentación retenida como referencia.

---

## Visión general del flujo

```
Manager pulsa "Desplegar contabilidad" (UI)
        │
        ▼
   ┌────────────────┐
   │ wcommerce      │  ← consulta on-demand
   │  tipoPago=S ?  │
   └───────┬────────┘
           │
   ┌───────┴────────┐
   │     SÍ         │
   ▼                ▼ NO → mensaje "Contacta con Wiemspro"
Wizard 5 pasos
        │
        ▼
  ┌────────────────────────────┐
  │ Provisioner SÍNCRONO (~15s)│
  │  1. res.company            │
  │  2. plan PYMES (635 cnts)  │
  │  3. journals               │
  │  4. cuenta bancaria        │
  │  5. ir.sequence facturas   │
  │  6. añadir adminround      │
  │  7. analytic plan + default│
  └─────────────┬──────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼ FALLO
   manager_config       motivo_rechazo → email al admin Wiemspro
   odoo_enabled=true
        │
        ▼
   Background sync de partners
   (cliente_cache → res.partner)
        │
        ▼
   Email "Contabilidad activa" al manager
```

Tiempo total: **15-30 segundos** desde que el manager pulsa Enviar.

---

## Componentes implicados

### Backend (`round_config_api/`)

| Archivo | Función |
|---|---|
| `app/wcommerce_check.py` | Cliente mínimo a wcommerce.wiemspro.com — consulta `tipoPago` por código. |
| `app/odoo_provisioner.py` | Clase `OdooProvisioner` con los 7 pasos + `sync_partners_from_cache` + `rollback`. |
| `app/odoo_analytics.py` | Helpers `resolve_analytic`, `set_trainer_independent`, etc. |
| `app/routes/manager_odoo.py` | Todos los endpoints `/api/manager/*` y `/api/manager/admin/*`. |

### Frontend (`src/`)

| Archivo | Función |
|---|---|
| `components/ContabilidadActivacion.jsx` | Tarjeta superior de Config→Contabilidad. Estados: no elegible / elegible / activo / con error. |
| `components/WizardDespliegueOdoo.jsx` | Modal multi-paso (fiscal → plan → bancos → numeración → revisar). |
| `components/TrainersContabilidad.jsx` | Sub-sección con toggle "heredar / propia" per trainer. |
| `hooks/useOdooStatus.js` | Cache sessionStorage del status del manager + features. |
| `config/routes.js` | `featureFlag` en CRM, Cuotas, Contabilidad para ocultar tabs si no hay Odoo. |

### Base de datos (`round_config`)

| Tabla | Uso |
|---|---|
| `manager_config` (cols nuevas) | `odoo_enabled`, `odoo_company_id`, `odoo_url`, `odoo_activated_at`, `wcommerce_cliente_id`, `tipo_pago_wc`, `odoo_analytic_plan_id`, `odoo_analytic_default_id`. |
| `odoo_solicitud_despliegue` | Historial de solicitudes con estado y tracking del sync de partners. |
| `trainer_odoo_config` | Per trainer: `heredar_contabilidad` + `analytic_account_id` (si tiene propio). |

---

## Configuración necesaria en `.env` del backend

```bash
# Acceso a wcommerce.wiemspro.com (compartido con GestionNoofit)
WCOMMERCE_BASE=https://wcommerce.wiemspro.com/Wcommerce_2020
WCOMMERCE_EMAIL=...
WCOMMERCE_PASSWORD=...
WCOMMERCE_APP_VERSION=1.0
WCOMMERCE_APP_ID=1

# (Opcional) Email del admin Wiemspro para notificaciones de fallos
ROUND_ADMIN_EMAIL=calcalde@wiemspro.com

# (Opcional) Clave secreta para los endpoints /api/manager/admin/*
# Si NO está configurada, esos endpoints devuelven 503 (modo "seguro
# por defecto"). Cuando se configura, hay que pasarla en cada request
# como header X-Round-Admin-Key.
ROUND_ADMIN_KEY=<openssl rand -hex 32>
```

Tras editar el `.env`:

```bash
ssh round-vps "systemctl restart round_config_api"
```

---

## Flujo paso a paso del manager (UI)

### 1. Entrar a Configuración → Contabilidad

Si el manager NO tiene Odoo desplegado y no es el manager por defecto, ve:

- **Tarjeta azul "Desplegar Contabilidad, Remesas y CRM"**
- Input para introducir `wcommerce_cliente_id` (su código en wcommerce)
- Botón "Comprobar y desplegar"

### 2. Pulsar "Comprobar y desplegar"

Round llama a `POST /api/manager/wc-check` que internamente:

- Lee `tipoPago` del cliente en wcommerce (cache de sesión 25 min)
- Guarda el resultado en `manager_config.tipo_pago_wc`

Respuestas posibles:

- **tipoPago = "S"** → banner verde "Suscripción válida" + botón "Continuar al wizard"
- **tipoPago = "C/B/T/…"** → banner ámbar "Contacta con Wiemspro para cambiar a tipo S"
- **wcommerce caído / cliente no encontrado** → banner rojo con mensaje específico

### 3. Wizard de 5 pasos

| Paso | Datos |
|---|---|
| 1 — Fiscal | Razón social*, CIF*, dirección, CP, población, provincia, país, teléfono, email facturación |
| 2 — Plan contable | PYMES (recomendado) / Completo / Asociaciones |
| 3 — Bancos | IBAN principal + nombre del banco |
| 4 — Numeración | Prefijo facturas (ej. `F-2026-`) + último número emitido |
| 5 — Revisar | Resumen + botón "Desplegar contabilidad" |

El borrador del wizard se persiste en `sessionStorage` por si el usuario cierra el navegador.

### 4. Pulsar "Desplegar contabilidad"

Spinner ~15-30 segundos mientras el provisioner trabaja. **Bloqueante**: el manager espera en la pantalla hasta que termina.

- **Éxito** → toast verde "¡Contabilidad activada!", se cierra el wizard, aparece el badge verde "Contabilidad activa · Odoo company #N", y el menú lateral muestra **CRM, Cuotas mensuales, Contabilidad**.
- **Fallo** → toast rojo con el motivo y el paso que falló. La solicitud queda en `pendiente` con el error en `motivo_rechazo`.

### 5. Sync inicial de partners (background)

Tras el despliegue, Round arranca un thread daemon que:

- Lee `cliente_cache` filtrado por el manager
- Para cada cliente activo: `upsert_partner` en Odoo (idempotente)
- Va actualizando `odoo_solicitud_despliegue.partners_synced`

En la tarjeta verde aparece una barra de progreso: *"Importando clientes a Odoo: 27/302 (9%)"* que se refresca cada 3s. Cuando termina, el texto pasa a *"302 de 302 clientes importados"*.

Si el manager cierra la pestaña, el sync sigue en el servidor.

---

## Multi-trainer (Fase 4)

Por defecto **todos los trainers del manager heredan la contabilidad**: sus movimientos contables van al analytic *"GENERAL <razón social>"* (creado en el paso 7 del provisioner).

Si el manager quiere separar la contabilidad de un trainer (ej. para informes diferenciados):

### Desde la UI

En Config→Contabilidad, debajo del badge verde, hay sección **"Contabilidad por trainer"** con la lista de trainers. Cada uno tiene un checkbox "Propia":

- **Desmarcado** (default): el trainer hereda. Sus líneas contables van al analytic GENERAL del manager.
- **Marcado**: Round crea un `account.analytic.account` propio para ese trainer (code `TRN-<id>`). Sus líneas a partir de ese momento llevan ese analytic.

El cambio es reversible — si vuelves a desmarcar, el trainer hereda otra vez, pero su analytic anterior se conserva por si vuelves a marcarlo.

### Por API (curl)

```bash
# Listar trainers y su config
curl -H "X-Round-Token: ..." -H "X-Round-Manager-Id: <id>" \
     https://noofit.wiemspro.com/api/manager/trainers-contabilidad

# Cambiar uno a contabilidad propia
curl -X PATCH -H "X-Round-Token: ..." -H "X-Round-Manager-Id: <id>" \
     -H "Content-Type: application/json" \
     -d '{"heredar_contabilidad": false, "nombre_trainer": "Centro Málaga"}' \
     https://noofit.wiemspro.com/api/manager/trainers-contabilidad/<id_trainer>
```

---

## Operativa del admin Wiemspro

### Escenario A — Todo va bien

El admin **no tiene que hacer nada**. El manager pulsa "Desplegar", todo se hace automáticamente, y el manager recibe un email de confirmación.

### Escenario B — El provisioner falla

Cuando un paso del provisioner falla:

1. La solicitud queda en `estado='pendiente'` con `motivo_rechazo` rellenado.
2. Round intenta **rollback** automático: archiva la company creada (la renombra con prefijo `ZZZ_ROLLBACK_`) y quita `adminround` de ella.
3. Si `ROUND_ADMIN_EMAIL` está configurado, llega un email con el motivo del fallo + datos de la solicitud + información del rollback.
4. El manager ve en su UI un banner rojo *"El despliegue falló a medio camino: <motivo>"* con el número de solicitud.

### Acciones del admin

Tras recibir el email, el admin puede usar los endpoints `/admin/*` (requieren `ROUND_ADMIN_KEY` en el `.env` y `X-Round-Admin-Key` en cada request):

```bash
ADMIN_KEY=$(ssh round-vps "grep '^ROUND_ADMIN_KEY=' /opt/round_config_api/.env | cut -d= -f2-")

# Listar solicitudes pendientes con error
curl -H "X-Round-Token: <token>" -H "X-Round-Manager-Id: 17675" \
     -H "X-Round-Admin-Key: $ADMIN_KEY" \
     https://noofit.wiemspro.com/api/manager/admin/solicitudes-despliegue

# Listar TODAS (sin filtrar)
curl -H "..." \
     "https://noofit.wiemspro.com/api/manager/admin/solicitudes-despliegue?estado=completada"

# Ver detalle completo de una solicitud (con log del provisioner)
curl -H "..." \
     https://noofit.wiemspro.com/api/manager/admin/solicitudes-despliegue/<id>

# Corregir datos en BD (psql directo) si hace falta:
ssh round-vps 'sudo -u postgres psql round_config -c \
  "UPDATE odoo_solicitud_despliegue SET cif='\''ESA12345674'\'' WHERE id=<id>;"'

# Reintentar el provisioner
curl -X POST -H "..." \
     https://noofit.wiemspro.com/api/manager/admin/solicitudes-despliegue/<id>/reintentar
```

### Escenario C — El manager se quedó colgado

Si por algún motivo el thread daemon de sync de partners murió a mitad (worker reiniciado, etc.), la solicitud queda en `completada` pero con `partners_sync_started_at` rellenado y `partners_sync_finished_at = null`. El frontend mostrará la barra de progreso anormalmente sin avanzar.

Solución: llamar manualmente al sync de partners desde shell:

```bash
ssh round-vps "cd /opt/round_config_api && set -a && . ./.env && set +a && \
  sudo -E -u odoo /opt/round_config_api/venv/bin/python -c \"
from app import create_app
from app.odoo_provisioner import sync_partners_from_cache
app = create_app()
with app.app_context():
    print(sync_partners_from_cache('<id_manager>', solicitud_id=<sol_id>))
\""
```

---

## Consideraciones técnicas importantes

### Por qué shell de Odoo en el paso 2

El método `account.chart.template.try_loading()` que aplica el plan PYMES (635 cuentas) **no es accesible vía XML-RPC** ni siquiera con `adminround`. Está protegido. Pero **sí es accesible desde un proceso interno** (`odoo-bin shell`), que corre con permisos de superuser.

Por eso el paso 2 usa `subprocess.run(['/opt/odoo17/venv/bin/python', '/opt/odoo17/odoo/odoo-bin', 'shell', '-d', cfg.ODOO_DB, '-c', '/etc/odoo17.conf', '--no-http'])` y le pasa el script Python por stdin.

Tarda 5-10 segundos (es lo que más tiempo se lleva del provisioner).

### Por qué adminround sigue siendo el usuario único de Odoo

Hoy hay UN solo usuario admin de Odoo (`adminround`, uid=2). El provisioner lo añade a la nueva company (`company_ids: [(4, new_id)]`) para que pueda operar desde la UI de Odoo en todas las companies del sistema. Si en el futuro hubiera muchos managers S, esto se podría refinar creando un usuario por manager.

### Idempotencia

Casi todos los pasos del provisioner son idempotentes:

- `upsert_partner` busca por `id_noofit` antes de crear → no duplica.
- `_step_3_create_journals` busca por `(company_id, code)` antes de crear.
- `set_trainer_independent` reusa el analytic si ya existe.
- `sync_partners_from_cache` puede llamarse N veces sin problema.

Los únicos NO idempotentes son `_step_1_create_company` (crearía duplicados si se llama 2 veces) y `_step_5_create_sequence`. Por eso el endpoint normal de provisioning rechaza si ya hay una solicitud activa, y el endpoint admin de reintentar sólo opera si la anterior dejó la company a medias (rollback).

### Aislamiento entre managers

En Fase 0 se auditó que todas las llamadas XML-RPC que tocan `account.move`, `res.partner`, `round.subscription`, etc., pasan por `_call_scoped()` que auto-inyecta `('company_id','=',self.company_id)` en el dominio. Esto garantiza que un manager nunca ve datos de otro.

Verificación de regresión tras cualquier cambio en `odoo_*.py`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
     -H "X-Round-Token: <token>" -H "X-Round-Manager-Id: 17675" \
     https://noofit.wiemspro.com/api/crm/leads   # debe ser 200
```

---

## Estado del despliegue Round actual

| Manager | id | Estado | Notas |
|---|---|---|---|
| Round (default) | 17675 | `odoo_enabled=true`, `odoo_company_id=3`, las 3 flags granulares en `true`, `sistemas_cobro=["sepa","tpv_virtual","link_pago"]` | Manager histórico. Las 3 flags se rellenaron por backfill en la migración A1 de Fase 6 + el provisioner idempotente añadió en mayo 2026 los journals que faltaban (BNSEPA, TPV, LINK), la `ir.sequence` y el analytic. |

Si en el futuro Round quiere también analytic por trainer (1 sólo trainer hoy, pero pensando a escala), se puede ejecutar un one-shot:

```python
# Desde shell de Odoo:
from app.odoo_provisioner import OdooProvisioner
prov = OdooProvisioner('17675', {'razon_social': 'BEST TRAINING RDV SL'})
prov._step_7_analytic_setup(3)
```

---

## Tablas y archivos de prueba dejados

Durante el desarrollo se crearon companies de prueba `ZZZ_TEST*_DELETE_ME` (ids 5-14). Todas están archivadas (`active=false`) en Odoo. **No molestan operativamente** pero ocupan espacio en BD. Si quieres borrarlas físicamente, requiere DELETE manual en PostgreSQL del Odoo (no se puede vía ORM por FK constraints del plan contable). Pasos sugeridos:

```bash
ssh round-vps 'sudo -u postgres psql round_facturacion -c "
SELECT id, name FROM res_company WHERE name LIKE '\''ZZZ_TEST%'\'';"'
```

Y luego un DBA decide qué borrar en cascade.
