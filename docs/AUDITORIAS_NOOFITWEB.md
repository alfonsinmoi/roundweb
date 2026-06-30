# Registro de Auditorías — noofitweb

> Nota de nomenclatura: la **plataforma** se llama **noofitweb**. "**Round**" es
> solo el **manager de pruebas** (tenant `17675` con el que empezamos). Los
> identificadores de código (`X-Round-Token`, `round_config`, `round-bootstrap`,
> `round.subscription`, etc.) conservan el prefijo `round` histórico — no se
> renombran.

> **Documento vivo.** Cada auditoría que hagamos se añade aquí: se marca en el
> índice con su **fecha** y **estado**, y su sección incluye las **REGLAS
> (invariantes)** que deben respetarse — escritas para una **lectura posterior
> de Claude** (resumen accionable, no narrativo).
>
> **Cómo usarlo (Claude, futuras sesiones):** antes de tocar un área, lee su
> sección + las REGLAS. Si una auditoría nueva cambia una regla, **actualiza la
> regla aquí** además de hacer el cambio. Detalle ampliado de auth en
> `docs/AUDITORIA_AUTH_BOOTSTRAP.md`.
>
> Convención de estado: ✅ cerrada · 🟠 parcial (quedan pasos) · 🔎 solo análisis
> (sin cambios) · 🟡 hallazgo abierto (no implementado).

## Índice

| # | Auditoría | Fecha | Estado |
|---|---|---|---|
| 1 | Multi-tenant: usuario_web, perfiles y permisos (P1–P5) | may 2026 | ✅ |
| 2 | POS/TPV — Auditorías #1–10 (Sprint 0) | may 2026 | ✅ |
| 3 | POS/TPV — Sprints 1–6 (contable/SII, gates, pulido) | may 2026 | ✅ |
| 4 | Recibos mensuales — Sprints 7–8 | jun 2026 | ✅ |
| 5 | Blindajes financieros B1–B12 (correspondencia férrea noofitweb↔Odoo) | jun 2026 | ✅ |
| 6 | Facturación nueva — activación fin_de_mes (gated) | 2026-06-09 | ✅ |
| 7 | Notas — integridad de envío/recepción + same-trainer | 2026-06-09 | ✅ |
| 8 | Recibos — cobro de facturados (dedup BD/Odoo) + cobro de move puro | 2026-06-09 | ✅ |
| 9 | Alta de cliente — A1 aplazar, A2/A3 keystone recibo BD, A4 enlace_pago, A6 | 2026-06-10 | 🟠 |
| 10 | Devoluciones SEPA — rendimiento (OneSignal en 2º plano) | 2026-06-09 | ✅ |
| 11 | Auth & bootstrap multi-tenant (H1/H2) | 2026-06-09 | 🟠 |
| 12 | Multi-tenant Odoo — barrido de instancias default `get_cuotas()`/`get_alta()` | 2026-06-10 | ✅ |
| 13 | Endpoints públicos (slots/crm/forms/portal) — PII, rate-limit, XSS | 2026-06-10 | 🟠 |
| 14 | Barrido manager-only — `perfil=None` (trainer NoofitPro) vs `require_permission` | 2026-06-10 | ✅ |
| 15 | Provisioner Odoo (`odoo_provisioner.py`) — rollback, idempotencia, veto legacy | 2026-06-10 | 🟠 |
| 16 | SEPA / remesas / devoluciones — pain.008, matcher, gating | 2026-06-10 | ✅ |
| 17 | Entradas puntuales — carrera de cobro (cobrar_evento / emitir-mes) | 2026-06-10 | ✅ |
| 18 | Incidente nginx caído por blip de DNS en upstream (disponibilidad) | 2026-06-11 | ✅ |
| 19 | Modificar recibo (no cobrado) — desincronía con factura Odoo posteada | 2026-06-12 | ✅ |
| 20 | Trimestral legacy — convivencia con dedup + gating de facturar | 2026-06-15 | ✅ |
| 21 | Notificaciones / Meta (redes) / Email — robustez de envío + TTL `publicando` | 2026-06-15 | ✅ |
| 22 | Preemisión cruza trainers — scope por `g.id_trainer` en emisión mensual (preemisión/emitir/SEPA/validar) | 2026-06-20 | ✅ |
| 23 | Facturación solo de cuotas PAGADAS (no facturar impagados/devueltos) | 2026-06-25 | ✅ |
| 24 | Emisión por COBERTURA (fecha_hasta), no por ciclo desde fecha_inicio | 2026-06-25 | ✅ |
| 25 | Modificar recibo NO cobrado = solo cuota BD (editable aunque tenga factura Odoo legacy) | 2026-06-28 | ✅ |
| 26 | Validador de preemisión no respetaba baja temporal (mostraba en pausa como "a emitir") | 2026-06-28 | ✅ |
| 27 | Descuento familiar duplicado se aplicaba 2× — un solo descuento familiar por actividad | 2026-06-28 | 🟠 |
| 28 | Scope de descuentos por trainer en emisión (AUTO solo propio trainer; MANUAL no cruza) | 2026-06-28 | ✅ |

---

## REGLAS TRANSVERSALES (siempre vigentes)

- **NoofitPro es la fuente de verdad** de manager/trainer y del vínculo
  cliente↔trainer. La web LEE, nunca inventa identidad/jerarquía.
- **Manager = login NoofitPro con `X-TRAINER_MANAGER="true"`; trainer = `"false"`.**
  Lo manda el frontend (relé del login) y lo re-valida el backend.
- **Datos de cliente/cuotas NUNCA cruzan de manager.** Datos del manager se
  comparten entre SUS trainers.
- **Visibilidad por el `id_trainer` del registro** (trainer en el momento), no
  por el vínculo actual del cliente.
- **Todo endpoint que MUTA datos** llama a `log_action()` en la rama de éxito.
- **Tablas nuevas creadas como postgres → `OWNER TO odoo`** (el user de la app es `odoo`).
- **Commit/push solo cuando el usuario lo pide.** Despliegue: frontend `npm build`+`scp dist`; backend `scp`+`py_compile`+`cp`+`systemctl restart`.
- **`company 1` ("BEST TRAINING legacy USA") prohibida** (`ODOO_LEGACY_COMPANY_IDS`).
- **1 BD Odoo por manager** (frontera BD=manager); dentro, **company por CIF**
  (entidad jurídica); trainers se separan por **analítica + 430XXX + serie**.

---

## 1. Multi-tenant: usuario_web, perfiles y permisos (P1–P5) — may 2026 ✅
**Revisado:** `auth.py`, `perfiles.py`, `usuarios_web.py`, `config/permissions.js`, gating de pestañas.

**REGLAS**
- `@require_permission('a.b.c')` = comprueba la hoja exacta. `@require_seccion('a.b')`
  = pasa si CUALQUIER hoja bajo la sección es `true` (espejo de `canAccessSection`).
- `perfil=None` (manager NoofitPro) → pasa todo (control total). `is_admin` → pasa todo.
- usuario_web: filtrado por permiso; si su perfil no tiene nada bajo el subárbol del
  tab, el tab se oculta.
- `usuario_web` es cuenta NATIVA de noofitweb; **su email NO puede existir en NoofitPro**
  (si existe, se rechaza — evita tenant fantasma al loguear con creds NF).
- usuario_web multi-centro: pertenencia en pivote `usuario_web_trainer`; al crear hay
  que asignar centro (si no, "corporativo" sin centro → no aparece en listados por centro).

## 2. POS/TPV — Auditorías #1–10 (Sprint 0) — may 2026 ✅
**Revisado:** `pos_*.py`, `odoo_pos_sync.py`.

**REGLAS**
- **Idempotencia por `ref`**: venta `T-AAAA-NNNNN`; refund `REV T-...`; draft mensual
  `TPV-AAAA-MM-<partner>`. `search`-before-create filtra `state!='cancel'`.
- **Lock optimista** `sync_status='syncing'` + **TTL 5 min** (worker muerto libera).
- **Validación post-acción**: tras `action_post`+reconcile, re-leer `state='posted'` y
  `amount_residual=0`; si no → `sync_status='error'` (NUNCA 'synced' silencioso).
- **Nunca cachear None** de tax/account (cache solo en hits positivos).
- **Secuencia `numero` TPV**: `pg_advisory_xact_lock` + `UNIQUE(manager,trainer,numero)`.
- Path traversal: validar `X-Round-Manager-Id` regex `\d{1,16}` + realpath en uploads.

## 3. POS/TPV — Sprints 1–6 — may 2026 ✅
**REGLAS**
- **Anular venta**: `out_refund` con `reversed_entry_id` + payment outbound + reconcile;
  validar residual tras reconcile (no fiarse).
- **Proveedores**: `in_invoice`/`in_refund` quedan **DRAFT** (validación humana); rectificativa
  `in_refund` con `reversed_entry_id` para SII (no `button_cancel`).
- **Tax `price_include=True`** para ventas TPV; `purchase` SIN price_include para proveedores.
- usuario_web atado a centro **NO** puede ver datos de otro trainer pasando `?id_trainer=` (C3).
- `_attach_pdf` idempotente (search `ir.attachment`). Validador NIF/CIF/NIE espejo front/back.

## 4. Recibos mensuales — Sprints 7–8 — jun 2026 ✅
**REGLAS**
- **Cobro por importe COBRADO** (no total). Si difiere → **incidencia admin** +
  observación obligatoria.
- **Anti-doble-cobro**: `SELECT … FOR UPDATE` + guarda explícita.
- Estados editables full: `borrador_remesa|pendiente|impagado|devuelto`.
  `pagado|facturado`: importes inmovilizados (solo notas/descr.). Ver auditoría 8 para la
  excepción admin de forma de pago.
- Gating server-side masivo `@require_permission` + `useCan` en pantallas.

## 5. Blindajes financieros B1–B12 — jun 2026 ✅
**Revisado:** `odoo_cuotas.py`, `odoo_alta.py`, `odoo_sync.py`, `odoo_payments.py`, addon.

**REGLAS**
- **B1** `resolve_company(manager,trainer)` (lee `trainer_empresa.odoo_company_id` →
  `manager_config.odoo_company_id`); rechaza legacy; **sin fallback silencioso**.
- **B2** 1 `id_noofit` = 1 `res.partner` GLOBAL (único). El cliente es **TERCERO**, NUNCA una cuenta.
- **B3** `upsert_partner` por `id_noofit` (email guarded vía `_email_real`; sin matching por DNI).
- **B4** `crear_subscription` anti-dup `(partner,cuota,activa)`; coherencia `cuota.company==comp`.
- **B6** `cuota + id_trainer` = identidad. **NO auto-crear cuota** (solo en importación → error).
- **B9** **Cobro robusto**: `account.payment` idempotente por `ref=COBRO-RECIBO-<id>`;
  `sync_status` en `recibo`; **cron de reintento** (`cron_odoo_sync_retry`); validar `posted`.
- **B12** SEPA: anti re-remesa (`sepa_remesa_id`), idempotencia de remesa; **devolución
  idempotente por referencia de banco** (`movimiento_financiero UNIQUE(manager,tipo,recibo,ref)`).
- **430XXX por trainer** (`430`+nº 3 dígitos, hasta 999). Serie/`ir.sequence` por serie.

## 6. Facturación nueva — activación fin_de_mes (gated) — 2026-06-09 ✅
**REGLAS**
- 2 sistemas: `inmediata` / `fin_de_mes`. **SIEMPRE partner por cliente.**
- **GATED**: `facturacion_config.activo=false` → motor INERTE (no toca el flujo actual).
- **Activar exige `fecha_corte` + validador de completitud** (empresa Odoo, serie
  provisionada, 430XXX por trainer con cuotas). Factura **solo desde el corte** (opción A);
  nada anterior se re-factura.
- IVA por cuota (default 21% si no hay tipo). Endpoints **solo manager**
  (`@require_manager` + `configuracion.modo_facturacion.{ver,editar}`).

## 7. Notas — integridad envío/recepción + same-trainer — 2026-06-09 ✅
**REGLAS**
- **Comunicación same-trainer**: un emisor scopeado a un trainer (`g.id_trainer`) solo
  comunica con usuarios/trabajadores/clientes de SU trainer. **Manager: sin límite**
  (elige trainer(s) + usuario(s)). Validado en las 3 ramas de `/enviar`.
- `GET /api/notas/destinatarios`: usuarios agrupados por trainer, **scopeado** por el backend.
- **Acuse de lectura interno**: solo el **destinatario** marca su lectura (`leida_at`);
  el manager mirando = noop. Se muestra al emisor.
- **Banner** incluye `estado='recordatorio'` con `recordatorio_hasta<=now` (si no, las notas
  pospuestas/programadas se perdían del banner).

## 8. Recibos — cobro de facturados + cobro de move puro — 2026-06-09 ✅
**REGLAS**
- Un recibo BD **facturado** (`account_move_id`) sigue siendo **PAGABLE** desde la ficha:
  la lista incluye la fila BD (con `id_bd`) y **deduplica** quitando el `account.move` Odoo
  equivalente (la fila BD gana). Cardinalidad `recibo↔move` = **1:1** (verificado).
- `account.move` **puro** (sin fila BD: alta/trimestral/migrado) → cobrable con
  `POST /api/recibos/odoo-move/<move_id>/cobrar` (crea payment + reconcile, idempotente
  `ref=COBRO-MOVE-<id>`; valida `out_invoice`, `posted`, residual>0; scope manager+trainer).
- **Excepción admin a "pagado inmovilizado"**: un **admin** (usuario_web `is_admin` o manager)
  puede corregir **SOLO `metodo_pago`** en `pagado/facturado`, con **motivo obligatorio**.
  No toca importes ni el pago/journal de Odoo (corrige el dato en noofitweb). Traza en notas +
  log_action + incidencia. usuario_web no-admin → bloqueado.

## 9. Alta de cliente — flujo, idempotencia, aplazar (A1) y recibo BD — 2026-06-09 🟠
**Revisado:** `crear_alta_cliente`, `crear_subscription`, `crear_recibo_alta`,
`procesar_pago_alta` (`odoo_alta.py`); endpoint `alta_cliente` (`cuotas_clientes.py:462`).
Flujo: partner → cuota (B6, no auto-crea) → subscription (B4 anti-dup) → `account.move`
de alta → `procesar_pago_alta` (efectivo/tpv | enlace_pago | aplazar) → cierra lead CRM →
reactiva NF si recaptación. **Sin transacción** entre los 7 pasos.

**A1 — aplazar = doble cobro (CORREGIDO 2026-06-09 ✅).** `procesar_pago_alta` con
`forma_pago_alta='aplazar'` hacía `action_post` de la factura de alta (deuda posteada)
**Y** creaba un `round.modificacion.recibo` `cargo_extra` para el mes siguiente → el alta
se cobraría DOS veces. Verificado en datos reales: **0 ocurrencias** (latente, nadie lo
había disparado), pero **expuesto en la UI** (ERPModal / AltaClienteModal).
- **REGLA (vigente):** `aplazar` = el cargo del alta se DIFIERE al próximo recibo **solo**
  vía `cargo_extra`. La factura de alta **NO se postea**; tras crear el `cargo_extra` se
  **cancela** (`button_cancel`) — es draft (sin numerar, sin SII) → seguro, con rastro en
  `narration`. Si el cancel falla, el move queda DRAFT (no es deuda hasta postearse) → sigue
  sin doble cobro. Sin suscripción (no se puede diferir) → se postea como **deuda ÚNICA**
  sin `cargo_extra` (respaldo). Detección de regresión: `round_modificacion_recibo` con
  `razon LIKE 'Alta aplazada%'` cuyo move referenciado esté `state='posted'`.

**A2 + A3 — keystone: alta crea recibo BD idempotente (CORREGIDO 2026-06-10 ✅).**
Antes `crear_recibo_alta` creaba la factura como `account.move` y **NO** insertaba fila en
`recibo` → si el pago no era inmediato quedaba un move posteado/impagado sin recibo BD
("huérfano"), origen del bug "trimestral/no se puede cobrar" (auditoría 8). Y sin
idempotencia de petición, un doble submit duplicaba factura/pago de alta (la suscripción ya
estaba protegida por B4). Resuelto:
- **A2 (idempotencia Odoo):** `crear_recibo_alta` marca el move con `ref='ALTA-SUB-<sub_id>'`
  y hace **search-before-create** (reusa el move no cancelado de esa sub). Con B4 → alta
  idempotente.
- **A3 (recibo BD):** tras `procesar_pago_alta`, `OdooAlta._crear_recibo_bd_alta` inserta la
  fila `recibo` enlazada (`account_move_id`, `account_move_ref`), `id_trainer` = trainer REAL
  del cliente. **Idempotente** por `(id_manager, origen='alta_cliente', origen_ref=sub_id)`
  (UNIQUE `uq_recibo_import_origenref`). `estado`: `pagado`+`fecha_pago` si se cobró;
  `emitido` (posteado, cobrable) si pendiente. Si el move fue **cancelado** (alta aplazada,
  A1) → NO crea recibo (el cargo va a la emisión). **Best-effort:** si el insert BD falla, NO
  rompe el alta (el move ya existe en Odoo); se loguea y se backfillea.
- **Backfill** `scripts/backfill_recibos_alta.py` (DRY-RUN / `CONFIRM=1`): crea recibos BD
  para moves de alta huérfanos (`narration LIKE 'Alta cliente%'`, posteados, sin recibo).
  Aplicado a las **5 altas huérfanas** (Valeria, Carmen, Priya, Beatriz = `emitido`;
  mar morillas = `pagado`). Idempotente (re-run = 0). Mismo esquema que el keystone.
- **REGLA (vigente):** toda alta con pago NO diferido deja **recibo BD ↔ account.move 1:1**.
  Detección de regresión: moves `out_invoice` con `narration LIKE 'Alta cliente%'`,
  `state='posted'`, cuyo `id` no esté en `recibo.account_move_id`.

**A6 — `log_action` con `entidad_id` NULL (CORREGIDO 2026-06-10 ✅).** El endpoint
`alta_cliente` leía `id_noofit`/`idNoofit` pero el payload trae `idnoofit` (minúsculas) →
`entidad_id` siempre NULL. Ahora lee `idnoofit` primero.

**A4 — `enlace_pago` + callback PayComet (CORREGIDO 2026-06-10 ✅).** El callback
`POST /api/cuotas/paycomet-callback` (público, lo invoca PayComet) registraba el pago con el
wizard `payment.register` **sin idempotencia** y **sin actualizar el recibo BD**, y aceptaba
cualquier `Order` = nº de factura (**secuencial, adivinable**) sin verificar nada. Resuelto:
- **A4.1 (idempotencia):** si la factura ya está `paid`/`in_payment` → NO crea otro payment
  (localiza el existente por `reconciled_invoice_ids` y lo enlaza). Si no, cobra con
  `crear_account_payment_move` (idempotente por `ref=COBRO-MOVE-<id>`, postea + reconcilia +
  valida residual). Un webhook reintentado ya no duplica el cobro.
- **A4.2 (anti-desync):** `_sync_recibo_bd_pago_paycomet` actualiza la fila `recibo` enlazada
  (alta enlace_pago, keystone) → `estado='pagado'` + `fecha_pago` + `account_payment_id` +
  `link_pago_pagado_at`. Idempotente. Evita el desync (Odoo pagado ↔ BD `emitido`) y el
  **re-cobro accidental** desde la ficha (con `account_payment_id` puesto, `marcar_pagado` lo
  bloquea por C2).
- **A4.3 (hardening seguridad):** el callback **rechaza** (`403 sin_enlace_paycomet`) si la
  factura no tiene un enlace PayComet emitido (marcador `[PayComet]` en narration **o** recibo
  BD con `link_pago_url`). Cierra el agujero de marcar pagada cualquier factura por su nº
  adivinable. **VERIFICADO**: POST con `INV/2026/00005` (sin link) → 403, sin mutación.
- **PENDIENTE (no bloqueante):** verificación de **FIRMA PayComet** del webhook (requiere el
  secret en `.env`; PayComet aún en modo **stub**, no producción). El callback además solo
  scopea a `ODOO_COMPANY` (company 3) — limitación multi-tenant del endpoint público.

**Hallazgos abiertos:**
- **A5** — los 7 pasos no son transaccionales (fallo a medias deja estado parcial). El
  keystone es best-effort (no rollback de Odoo), por diseño.
- **A7 (latente, no confirmado)** — el recibo de alta (periodo M, `origen='alta_cliente'`)
  NO entra en el índice anti-dup de emisión (`uq_recibo_emision_periodo`, solo
  `cron_emision`/`emision_v2`) → en teoría la emisión del mes M podría facturar otra vez.
  **Spot-check (5 altas):** ningún cliente tiene recibo de alta y `cron_emision` del MISMO
  periodo (la emisión arranca el mes siguiente). Queda como observación, no bug activo.

## 10. Devoluciones SEPA — rendimiento — 2026-06-09 ✅
**REGLAS**
- `POST /api/cuotas/devoluciones` procesa la devolución (anular pago Odoo + marcar BD)
  **síncrono y comprometido** ANTES de responder; las **notificaciones OneSignal se
  disparan en un hilo de fondo** (fuera del request). Solo notifica lo realmente
  procesado (ni `ya_devuelto` ni `ya_procesada`).
- Cuello de botella conocido = `anular_pagos_de_move` (cancel/reconcile en Odoo) síncrono,
  recibo a recibo. Endpoint **idempotente/reanudable** (re-subir el fichero salta lo hecho).

## 11. Auth & bootstrap multi-tenant (H1/H2) — 2026-06-09 🟠
**Detalle completo:** `docs/AUDITORIA_AUTH_BOOTSTRAP.md`.

**REGLAS — cómo se identifica un manager (CLAVE para lectura futura)**
- **En el login:** NoofitPro `loginEasy` → `X-TRAINER_MANAGER` (`true`=manager / `false`=trainer).
  `round-bootstrap` **re-valida la contraseña** contra NoofitPro y resuelve el **TENANT**
  (`id_manager`) desde `trainer_noofit_creds` (no del body). Anti-fantasma: solo un manager
  dueño crea `manager_config`; trainer desconocido → reconducido a su grupo o rechazado (16702).
- **En cada petición:** `X-Round-Token` (compartido) + `X-Round-Manager-Id`.
  - **usuario_web** (Bearer JWT `kind='usuario_web'`): `g.id_manager` desde **BD**; `g.id_trainer`
    del claim `trn`. `g.perfil` = matriz de permisos.
  - **manager NoofitPro**: `g.perfil=None` (control total).
- **H1 paso 1 (hecho):** la sesión de manager lleva **JWT firmado `kind='manager'`** (lo emite
  `round-bootstrap` tras validar NF). Si llega, `g.id_manager` sale del **JWT** (la cabecera
  `X-Round-Manager-Id` se ignora); el **trainer** sale del header (selector del manager dentro
  de su tenant). `auth_required` y `usuario_web_required` (vía `@either_auth`) lo aceptan.
- **H1 paso 2 (MONITOR, no bloquea):** `auth_required` loguea `H1-monitor manager-header-only`
  cuando un manager va sin JWT. **No rechazar** mientras haya sesiones activas sin JWT (un
  bloqueo las expulsaría). Flip a `401` cuando el tráfico cabecera-sola baje a ~0 (sesiones
  re-logueadas), respetando lista blanca de descargas `?token=`.
- **`require_manager`** (auth.py): rechaza si `g.id_trainer` (sesión scopeada a trainer) → para
  endpoints solo-manager (facturación). Necesario porque `perfil=None` salta `require_permission`.
- JWT: `HS256` fijado (`algorithms=[...]`), `exp` validado, `bcrypt` rounds=12, `JWT_SECRET` 64.
  Separación por `kind` (usuario_web/manager/trabajador/cliente). `X-Round-Manager-Id` regex `\d{1,16}`.
- **H2 (retirado):** el rol viene de NoofitPro; matiz menor: `credenciales_validas` descarta el
  flag que ya recibe — podría usarlo en vez del body. Prioridad baja.

## 12. Multi-tenant Odoo — barrido de instancias default `get_cuotas()`/`get_alta()` — 2026-06-10 ✅

**Origen:** incidente real — el alta estuvo CAÍDA en producción desde el 6-jun porque
`alta_cliente` usaba `get_alta()` (instancia default, `_id_manager=None`) y el guard B1
(`_require_company`) abortaba con "Sin empresa Odoo para manager=None". El fix puntual
(`get_alta(g.id_manager)`, commit `2e9815c`) destapó el patrón: **~26 call-sites más** usaban
la instancia default.

**Semántica (CLAVE para lectura futura):**
- `get_cuotas()` / `get_alta()` **sin manager** → instancia default → **company 3 de Round**
  (`cfg.ODOO_COMPANY` del .env) y URL default. Para CUALQUIER otro manager eso es
  **lectura/escritura cross-tenant** contra los datos de Round (peor que abortar).
- `get_cuotas(id_manager)` → company desde `manager_config.odoo_company_id` (B1; trainer-entidad
  vía `trainer_empresa`) + `odoo_url` propio. Manager sin provisionar → company **None** →
  `_call_scoped` no devuelve datos de otros y `_require_company` aborta escrituras. Correcto.
- **NO era teórico:** ya hay 4 managers en `manager_config` y **17679 tiene company 15
  provisionada** → sus sesiones operaban contra la company 3 de Round (bug ACTIVO).

**REGLA (vigente, inviolable):** en código que sirve peticiones o crons multi-tenant, **NUNCA**
usar `get_cuotas()`/`get_alta()` a secas ni `cfg.ODOO_COMPANY` en domains/values. Ligar SIEMPRE
la instancia al tenant: `g.id_manager` (rutas auth), `p['id_manager']` (payload del hilo bg de
reservas), `r['id_manager']` (fila `slot_reserva`), `doc['id_manager']` (fila `gasto_documento`),
parámetro `id_manager` (crons que iteran managers). La company en domains/values = `oc.company_id`.
**Única excepción legítima:** `odoo_provisioner.py` (8 sitios) — corre ANTES de que el manager
tenga company y pasa `company_id` explícito en cada llamada (conexión cruda).

**Corregido (2026-06-10, desplegado y verificado):** `cuotas_clientes.py` (9 rutas: listados
recibos, preemisión, emitir, enviar factura, descargar SEPA + 2 hardcodes company en
paycomet_callback), `crm.py` (6: `_procesar_lead` público —company del manager destino, sin
fallback a Round—, lead manual, update_lead, stages, kanban, funnel + fallback Tally
`or cfg.ODOO_COMPANY` eliminado), `slots.py` (2: hilo bg de reserva —lead en la company del
manager— y anular reserva), `contabilidad.py` (5 + 3 filtros company en ingresos Odoo),
`clientes_log.py` (sync-odoo partner), `cron_notif_impago.py`, `odoo_gastos.py`
(`crear_factura_proveedor` → manager del documento). Smoke tests Round OK (leads, stages,
recibos, funnel — company 3, comportamiento idéntico; `manager_config` de 17675: company 3,
sin odoo_url → cero regresión).

**Side-fix:** 12 tablas de `round_config` tenían `tableowner=postgres` → el init de schema
llevaba DÍAS abortando a medias ("must be owner of table…", 52 veces desde el 9-jun) y las
migraciones automáticas posteriores al primer fallo no corrían. `ALTER TABLE … OWNER TO odoo`
a todas → arranque limpio. (Refuerza la regla transversal "tablas nuevas → OWNER TO odoo".)

**IDOR by-id cross-tenant (CORREGIDO 2026-06-10 ✅):** `update_borrador`/`delete_borrador`/
`enviar_factura_email`/`anular_pagos_de_move`/`descargar_sepa` operaban por
`invoice_id`/`attachment_id` SIN verificar tenant → un manager logueado podía tocar
borradores/facturas/adjuntos de otro pasando ids. Resuelto con el guard
**`OdooCuotas._require_record_company(record_id, model)`** al inicio de los 5 métodos:
- El registro debe pertenecer a una company del **conjunto del tenant**
  (`_companies_del_manager()` = company del manager + las de sus trainers con CIF propio en
  `trainer_empresa`) — la frontera es el manager, no una sola company.
- Sin company en la instancia (manager sin provisionar) → rechazo (`sin_empresa_odoo`).
- Si Odoo deniega el read por sus record rules (p.ej. adjunto de company legacy) → se
  normaliza a `ValueError('registro_no_accesible')` (400 limpio, no Fault/500).
- Lanza `ValueError` ANTES de tocar nada → los endpoints devuelven 400.
**VERIFICADO con test real cross-tenant:** Round (17675) accede a su move 1945 ✓; el manager
17679 (company 15) → `registro_de_otra_empresa` ✓; 17677 (sin company) → `sin_empresa_odoo` ✓;
adjunto SEPA legacy de company 1 → rechazado ✓. Endpoints de Round sin regresión.

**Derivado pendiente (follow-up):**
- `paycomet_callback` (público, sin `g.id_manager`) sigue cayendo a la instancia default
  (company 3) — limitación ya anotada en la auditoría 9/A4 (multi-tenant del callback pendiente
  de la verificación de firma).

## 13. Endpoints públicos (slots/crm/forms/portal) — 2026-06-10 🟠
**Revisado (solo lectura):** `slots.py`, `crm.py`, `lead_forms.py`, `cliente_portal.py`.
Enumeradas las rutas sin auth + trazada validación, tokens, rate-limit y scoping.

**P-1 — `GET /api/crm/leads-en-sala/<id_sala>` PÚBLICO filtraba PII + token (CORREGIDO 2026-06-10 ✅).**
Sin `@auth_required` ni el permiso `crm.reservas_prueba.ver_leads_en_sala` (que EXISTÍA en el
catálogo pero no se aplicaba). Devolvía por `id_sala` (entero enumerable): nombre, apellidos,
**email, teléfono, DNI** + el **`token` de reserva** (que permite confirmar/cancelar/cambiar la
reserva vía `/reserva/<token>/...`). **Confirmado en prod**: `curl` sin token → 200. Resuelto:
- Backend (`slots.py`): `@auth_required` + `@require_permission('crm.reservas_prueba.ver_leads_en_sala')`;
  scope por `g.id_manager` (no el manager del `.env`) + filtro por `g.id_trainer` si la sesión es
  de trainer; quitado `'OPTIONS'` (era interno, no cross-origin). **Verificado**: sin token → 401,
  con token+manager → 200.
- Frontend: `Clases.jsx` y `ClaseDetalle.jsx` llamaban con `fetch()` **crudo sin cabeceras** →
  migrados a `leadsEnSala(identity, salaId)` (configApi, vía `_requestRoot` → cabeceras auth).
  `.catch(()=>({leads:[]}))` degrada sin romper si no hay permiso. Build + deploy OK.
- **REGLA:** un endpoint que devuelve PII/tokens **NUNCA** es público; si el frontend lo llama con
  `fetch()` crudo, gatearlo exige migrar esas llamadas a `configApi`/`_requestRoot` (cabeceras).

**P-2 — rate-limit compartido (CORREGIDO 2026-06-10 ✅).** El limitador era un dict **en
memoria POR WORKER** (4 gunicorn → tope ×4) que se vaciaba al reiniciar, y solo cubría `/lead`
y el form-builder. Resuelto con **`app/rate_limit.py`**: contador de **ventana fija en Postgres**
(tabla `rate_limit_hit`, owner `odoo`, creación lazy, limpieza oportunista, **fail-open** si la
BD falla — la captación de leads no se cae por el limitador). Aplicado a:
- `POST /api/crm/lead` (8/5min) y `POST /api/crm/form/<id>` (10/5min) — sustituye in-memory.
- `POST /api/crm/lead-prueba` (**NUEVO**, 5/5min) — antes SIN límite: un bot podía **agotar
  todas las plazas de prueba** (cada submit reserva un slot 1h).
- `POST /api/cliente/login` (**NUEVO**, 10/5min) — anti credential-stuffing (delega en NoofitPro).
**VERIFICADO en prod**: 7 POSTs seguidos a `lead-prueba` → 5×400 (validación) + **2×429**; el
contador es global entre workers (antes habrían pasado ~20). `slots-disponibles` y resto OK.

**XSS — hipótesis DESCARTADA en el kanban (verificado 2026-06-10).** No hay
`dangerouslySetInnerHTML` en el CRM (React escapa por defecto) → el HTML inyectado en la
`description` del lead NO se ejecuta en el panel. Único sink en todo el frontend:
`PortalCliente/BuzonTab.jsx` pinta `cuerpo_html` de noticias — pero ese HTML lo redacta **solo
staff autenticado** (notif_sender), no un atacante público. Riesgo bajo; hardening opcional:
sanitizar `cuerpo_html` (DOMPurify) si algún día interpola variables de origen cliente.

**Hallazgo abierto:**
- **P-3 (bajo, residual #12) — `lead_forms._manager_company` cae a `cfg.ODOO_COMPANY`** (company
  3 de Round) para un manager sin provisionar → un lead del form-builder de otro manager se
  crearía en la company de Round. Mismo patrón cross-tenant que la auditoría #12.

**✅ Verificado sólido (sin cambios):** token de reserva `secrets.token_urlsafe(32)` (256 bits)
+ expira 1h; **portal cliente sin IDOR** (todos los `@cliente_required` filtran por
`cliente_idnoofit`+`id_manager` del JWT; login delega en NoofitPro, sin password local que forzar);
forms con honeypot + consentimiento RGPD + validación de requeridos; `public_id` ~72 bits.

## 14. Barrido manager-only — `perfil=None` vs `require_permission` — 2026-06-10 ✅

**El agujero (recordatorio, ver auditoría 11):** una sesión NoofitPro tiene `g.perfil=None` y
`require_permission` con perfil None = **control total**. Un **TRAINER** que entra con sus
propias credenciales NoofitPro (remapeado: `id_manager=padre`, `id_trainer=él`, `perfil=None`)
pasaba por tanto TODOS los endpoints "manager-only" que solo llevaban `require_permission`.

**Escalada confirmada y cerrada:** el peor camino era `POST /api/config/usuarios-web` — un
trainer podía **crear un usuario_web admin** con permisos plenos (o editar perfiles) y obtener
control total del tenant. También podía activar/desactivar módulos y provisionar Odoo.

**Fix (2026-06-10, desplegado):** `@require_manager` añadido a **17 mutaciones** en 5 ficheros
(recordar semántica: bloquea solo `perfil=None` + `g.id_trainer`; usuario_web lo decide su
perfil — no rompe admins usuario_web):
- `usuarios_web.py` (5): crear, editar, reset-password, resend-verification, borrar.
- `perfiles.py` (3): crear, editar, borrar.
- `manager_odoo.py` (6): wc-check, wcommerce-cliente, provision/<modulo>,
  solicitud-despliegue POST, trainers-contabilidad PATCH, admin/reintentar.
- `horario.py` (2): activar / desactivar módulo control horario.
- `modo_facturacion.py` (1): PUT modo.

**VERIFICADO en prod:** sesión trainer (17674) → `403 manager_only` en crear usuario_web /
crear perfil / provision; manager (sin trainer) pasa el gate (400 de validación con body vacío)
y los GET (listados) siguen abiertos a sesiones scopeadas.

**REGLAS (para lectura futura):**
- **Todo endpoint que MUTA configuración de nivel tenant** (usuarios web, perfiles, activación
  de módulos, provisión Odoo, modo de facturación, menú de trainers) lleva `@require_manager`
  ADEMÁS de `@require_permission`. Los GET de esas áreas pueden quedar abiertos (gating fino
  por perfil) salvo que filtren secretos.
- **Efecto colateral aceptado:** el manager con un CENTRO SELECCIONADO en la UI (manda
  `X-Round-Trainer-Id`) también recibe 403 en estas mutaciones → deseleccionar el centro para
  administrar (mismo comportamiento ya aceptado en facturación).
- Quedan con `require_permission` solo (per-trainer BY DESIGN, política de scope mayo 2026):
  `centro_contacto`, `pasarela_credenciales`, `email_proveedor`, `trainer_empresa`, catálogos
  (cuota/descuento/categoría/convenio/pausa_motivo) y operativa diaria.

## 15. Provisioner Odoo (`odoo_provisioner.py`) — 2026-06-10 🟠
**Revisado:** los 8 `ensure_*`, los 3 orquestadores (`provision_crm/cuotas/contabilidad`), el
wrapper retro `OdooProvisioner.run()`, `rollback()` y los 2 callers en `manager_odoo.py`.
**Estado real verificado:** company 3 = Round (17675, operativa); company 15 = "Pruebas Noofit
SL" (17679, CRM activo); companies 5–14 = `ZZZ_TEST*_DELETE_ME` archivadas (restos de pruebas
del provisioner); 1 y 2 = legacy/`active=false`.

**ARQUITECTURA (anotar):** el provisioner crea **`res.company` dentro de la BD compartida
`round_facturacion`**, NO una BD por manager. La regla documentada "1 BD Odoo por manager"
**aún NO está implementada** — hoy es multi-company en una sola BD. Aceptable en pruebas; antes
de escalar a managers reales con datos sensibles hay que decidir si se migra a DB-per-manager
(es la frontera de aislamiento fuerte). **Pendiente de decisión de arquitectura.**

**Hallazgos CORREGIDOS (2026-06-10 ✅):**
- **D-1 — rollback archivaba companies REUSADAS.** `rollback()` archivaba la company del
  `partial` SIN comprobar si se había creado en esa ejecución (el guard solo vivía en el
  docstring). Una re-provisión de un manager ya operativo (p.ej. Round/company 3) que fallara a
  mitad → **archivaba su company viva = contabilidad destruida**. Fix: los orquestadores marcan
  `partial['company_creada']` (comparando el puntero ANTES de `ensure_company`); `rollback()`
  solo archiva si `company_creada` es True.
- **D-2 — tras archivar, el puntero quedaba sucio.** `manager_config.odoo_company_id` seguía
  apuntando a la company archivada → el reintento la "reusaba" (muerta). Fix: `rollback(...,
  id_manager)` limpia `odoo_company_id` + analítica para que el reintento cree una nueva.
- **D-3 — `ensure_company` reusaba sin validar.** La rama de reuso devolvía
  `odoo_company_id` a ciegas. Fix: rechaza si es **legacy** (`ODOO_LEGACY_COMPANY_IDS`) o
  **archivada** (`active=false`) → no se provisiona sobre una company muerta/prohibida.
- **D-4 — `ensure_journals` se tragaba errores.** Un journal que fallara se anotaba pero el paso
  seguía `ok=True` → provisión a medias en silencio (sin journal SEPA = no se puede cobrar).
  Fix: si algún journal falla, el paso aborta con `ProvisionerError`.
- **D-5 — `ensure_analytic` no era idempotente por code.** Si el puntero se perdía pero la
  analítica `GEN-<company>` ya existía, creaba un duplicado. Fix: search-before-create por code.

**REGLAS (lectura futura):**
- `rollback()` SOLO toca lo creado en esa ejecución (`company_creada`). NUNCA archivar una
  company reusada/operativa. Tras archivar, limpiar punteros de `manager_config`.
- `ensure_company` (reuso) valida: no legacy + `active=true`. `ensure_*` idempotentes por
  clave natural (code/company). Los journals son CRÍTICOS → su fallo aborta, no se ignora.
- **430XXX**: rango forzado `1..999` (`cuenta_430_code`), UNIQUE `(id_manager,id_trainer)` en
  `facturacion_trainer`. La asignación de sufijo la hace facturación (auditoría 6/B), no el
  provisioner; **sin colisión** verificada.

**Pendiente (no bloqueante):**
- **Limpieza**: borrar/archivar definitivamente las companies `ZZZ_TEST*` (5–14) en Odoo.
- **Arquitectura DB-per-manager** (decisión, ver arriba).
- `ensure_chart` vía `subprocess odoo-bin shell` con `env.cr.commit()`: si el provisioner
  corre concurrente para 2 managers podría haber contención; hoy es secuencial (no problema).

## 30. Auditoría descuentos auto: cron, scope #28 al asignar, Málaga huérfano — 2026-06-30 ✅
**Revisado:** `cron_descuentos_auto.py`, catálogo `descuento`, `descuento_asignacion`,
timer `round_descuentos_auto`, rutas de emisión/preemisión. Auditoría completa pedida por el
propietario (aplican bien, cron corre, se ejecuta antes de emitir/preemitir, sin duplicados,
periodicidad #29).

**Lo que ESTABA bien (verificado):**
- `round_descuentos_auto.timer` enabled+active (diario 03:15, última ejecución OK).
- `recalcular_descuentos_auto` se dispara **antes de PRE-emitir** (`preemision_validar`:197) y
  **antes de EMITIR** (`preemision_v2.generar`:120). `emision_v2` no recomputa (importe fijado en
  `generar`). Motor #29 (periodicidad) operativo.
- Aplicación Añoreta correcta; dedup #27 + scope #28 funcionando; 0 filas duplicadas exactas.

**Bug 1 (🔴 resuelto) — clientes de MÁLAGA sin descuento familiar/varias.** El catálogo tenía el
concepto como **manager-wide** (#9 familiar, #6 varias, `scope=plantilla_manager`, id_trainer NULL)
y como **Añoreta** (#12/#14). Existían además filas **propias de Málaga** (#30 familiar, #28 varias,
`scope=trainer` 17675) pero **VACÍAS** (combo_secundarias `[]`, sin cuota_requerida). Como el scope
#28 (AUTO = solo trainer propio estricto, NO manager-wide) excluye los NULL, **12 clientes de Málaga
quedaban sin descuento** (verificado: RT 2 dias 60→60; I MYGYM 40→40, vs Añoreta 52,5 / 10).
**Acción A (datos):** poblar #30 (← combo de #9: RT 2 dias 7,5€ importe) y #28 (← #6: req RT 2 dias
+ I MYGYM combinado 10€); **desactivar** los manager-wide #6/#9 (redundantes, aplicaban a nadie);
cancelar sus 121 asignaciones huérfanas. Backup `/root/backup_descuentos_2026-06-30.sql`.
Verificado tras la acción: Málaga **y** Añoreta → familiar 60→52,5, varias I MYGYM 40→10.
Esto resuelve también el **catálogo duplicado** (cada concepto queda 1×trainer: Málaga #28/#30,
Añoreta #12/#14).

**Bug 2 (🟠 resuelto en código) — el cron asignaba SIN scope #28.** `recalcular_descuentos_auto`
marcaba en `descuento_asignacion` a cualquier cliente que "cumpliera", sin filtrar por trainer →
la ficha del cliente mostraba descuentos cross-trainer que la emisión luego no cobraba (display ≠
emisión; 15+ clientes con 2 asignaciones familiares). **Acción C (código):** helpers
`_cargar_trainer_por_cliente` + `_cumple_scope_trainer` (mirror de `_solo_trainer_propio`); ambos
bucles (varias + familiares) saltan al cliente cuyo trainer no coincide con el del descuento
(manager-wide/NULL no asigna a nadie, salvo cliente sin trainer → no se filtra, igual que la
emisión). Tras re-ejecutar: asignaciones **diagonales** (#12/#14→17674, #28/#30→17675), 0 sobre
descuentos inactivos.

**Pendiente (no bloqueante):**
- (#29 datos) rellenar valores POR PERIODICIDAD donde el valor único legacy sea incorrecto — sobre
  todo `varias` con cuotas que tengan trimestral/anual (el precio único se aplicaría a todas las
  periodicidades). RT 2 dias familiar es importe fijo 7,5€ (consistente); I MYGYM Málaga es
  mensual-only (sin riesgo). Editor por periodicidad ya disponible.
- (D, opcional) purgar asignaciones `manual` legacy inertes sobre descuentos familiares
  (la lógica familiar reevalúa desde catálogo y las ignora).

**REGLA:** el catálogo de un concepto de descuento AUTO debe existir **una vez por trainer**
(no manager-wide + trainer a la vez), porque el scope #28 excluye el manager-wide. El cron asigna
con el mismo scope que aplica la emisión.

## 29. Descuentos familiares / varias cuotas POR PERIODICIDAD — 2026-06-30 ✅
**Revisado:** `descuentos_apply.py` (aplicar_descuentos_familiares / varias_cuotas_auto /
calcular_precio_con_descuentos), `preemision_v2.generar`, `preemision_validar` (2 puntos),
`DescuentosTab.jsx` (editor familiares / familiar_trabajador / varias_cuotas).

**Petición (propietario):** "en los descuentos familiares y varias cuotas, que el precio que se le
resta a cada cuota venga el mensual, trimestral y anual para indicar cómo quedaría cada uno. Al
emitir que busque la periodicidad para saber qué descuento aplicar." Confirmado: **4 periodicidades**
(mensual / trimestral / semestral / anual); **Familiares = descuento por periodicidad**,
**Varias = precio final por periodicidad**.

**Antes:** cada entrada de `combo_secundarias` guardaba UN único valor (`{cuota_codigo, valor,
unidad}` familiares; `{cuota_codigo, precio}` varias) y se aplicaba igual a cualquier periodicidad.
Un descuento pensado para la cuota mensual se aplicaba mal a la trimestral/semestral/anual.

**Estructura nueva (retrocompatible):**
- familiares / familiar_trabajador: `{cuota_codigo, unidad, valores:{mensual,trimestral,semestral,anual}}`.
- varias_cuotas: `{cuota_codigo, precios:{mensual,trimestral,semestral,anual}}`.
- `valores`/`precios` solo incluyen las periodicidades con valor; las vacías se omiten.

**Backend (✅):**
- Helper `_valor_por_periodicidad(entry, periodicidad, clave_legacy)`: lee `entry['valores'|'precios']
  [periodicidad]` → fallback a `[mensual]` del propio dict → fallback legacy `entry[clave_legacy]`
  (valor único viejo) → `None` si nada. Retrocompat total: descuentos viejos siguen aplicando su
  valor único en todas las periodicidades.
- `aplicar_descuentos_familiares`, `aplicar_descuentos_varias_cuotas_auto` y
  `calcular_precio_con_descuentos` aceptan `periodicidad='mensual'` y resuelven el valor con el helper.
  (En varias, si la periodicidad no tiene precio definido ni fallback → no aplica, `break`.)
- **`familiar_trabajador` (MANUAL) incluido:** la UI comparte rejilla con familiares, así que ahora
  guarda `valores:{}` por entrada (sin `valor`). El bloque `familiar_trabajador` de
  `calcular_precio_con_descuentos` se migró a `_valor_por_periodicidad` — si se hubiera dejado leyendo
  `entry.get('valor')` el descuento habría caído a 0 (regresión). Default `'mensual'` mantiene compat.
- Callers (preemisión real `preemision_v2` + validador `preemision_validar`, 2 puntos) pasan
  `periodicidad = s.get('periodicidad','mensual')` (la del propio sub) a las 3 llamadas de descuento.
  Periodicidades no listadas (p.ej. `bimensual`) caen a mensual.

**Frontend (✅):** editor de descuentos (`DescuentosTab.jsx`) — familiares / familiar_trabajador /
varias dejan de tener un único input y muestran una **tarjeta por actividad** con una **fila por
periodicidad cuya cuota tiene tarifa > 0**: etiqueta · `tarifa Xe` · input (familiares = descuento
%/€ con unidad a nivel de actividad; varias = precio final) · **precio resultante** de esa
periodicidad. Carga normaliza lo viejo (`{valor}`/`{precio}` → fila Mensual). `onSubmit` guarda
`valores:{}` / `precios:{}` limpiando vacías + mantiene mirror legacy (`valor`=mensual, `unidad`,
`cuota_aplicada_codigo`) para consumidores antiguos.

**Verificado:** `_valor_por_periodicidad` — nuevo trim=25→25; mensual=10→10; semestral/anual sin def
→ fallback mensual 10; **estructura nueva sin `valor` legacy NO da 0 falso** (familiar_trab no
regresa); legacy `valor`=7,5 → 7,5 en cualquier periodicidad; entrada vacía → None. Build frontend OK,
backend `active`, frontend `200`.

**REGLA:** el descuento (familiares/varias/familiar_trab) se resuelve por la **periodicidad del sub
que se emite**; si esa periodicidad no está definida, cae a mensual y, en último término, al valor
único legacy. Nunca se aplica un valor de otra periodicidad.

## 28. Scope de descuentos por trainer en la emisión — 2026-06-28 ✅
**Revisado:** `descuentos_apply.py` (get_descuentos_*/aplicar_*), `preemision_v2.generar`,
`preemision_validar` (2 puntos de cálculo de precio).

**Bug (fuga cross-trainer):** ninguna función de aplicación de descuentos filtraba por trainer
(`get_descuentos_familiares_activos`/`varias_cuotas_activos`/`get_descuentos_activos` solo
`WHERE id_manager`). En la emisión de un trainer se aplicaban descuentos manager-wide + del propio
trainer + **de OTROS trainers**. Datos 17675: cada tipo está duplicado (manager-wide + Añoreta);
un cliente de Málaga podía recibir un descuento de Añoreta.

**REGLA (decisión propietario):**
- **AUTO** (familiares, varias_cuotas): aplican **solo los del PROPIO trainer del cliente**
  (`id_trainer == trainer del cliente`); NI manager-wide NI de otro trainer.
- **MANUAL** (asignados a mano, `descuento_asignacion`): aplican los manager-wide y los del propio
  trainer (asignación explícita); **NUNCA los de otro trainer**. (No se rompen las 170 asignaciones
  manager-wide asignadas a mano existentes.)

**Fix (2026-06-28 ✅):** `get_descuentos_activos`/`calcular_precio_con_descuentos` aceptan
`id_trainer_cliente` y filtran MANUAL `(id_trainer IS NULL OR = trainer)`; `aplicar_descuentos_
familiares`/`varias_cuotas_auto` filtran AUTO con `_solo_trainer_propio` (estricto = trainer).
Las funciones `get_*_activos` ahora devuelven `id_trainer`. Callers (preemisión real + validador,
2 puntos) pasan `cache_idnoofit_trainer.get(idnoofit)`. Default None = sin filtro (compat).

**Verificado:** familiar de Añoreta → cliente Añoreta 157,5→150; cliente Málaga 157,5→157,5 (no
aplica). validar julio sin crash.

**Relación con #27:** el blindaje #27 (un solo familiar por actividad) sigue como red de seguridad;
con el scope por trainer, para Añoreta solo entra su #12 (el manager-wide #9 queda excluido).
Pendiente datos: consolidar el catálogo duplicado (#9 vs #12) — decisión del propietario.

## 27. Descuento familiar duplicado se aplicaba dos veces — 2026-06-28 🟠
**Revisado:** `descuentos_apply.aplicar_descuentos_familiares`, catálogo `descuento` tipo='familiares'.

**Bug (sobre-descuento):** `aplicar_descuentos_familiares` recorría TODOS los descuentos
tipo='familiares' del manager que tocaran una cuota y aplicaba **cada uno acumulativamente**. El
manager 17675 tiene el descuento familiar "1 o mas familiares" **duplicado** en el catálogo: #9
(manager-wide, `RT 2 dias`=7,5€) y #12 (trainer Añoreta, `I MYGYM`=6€ + `RT 2 dias`=7,5€). Para
una familia de Añoreta con "RT 2 dias", se aplicaba el 7,5€ **dos veces** (−15€ en vez de −7,5€).
Ej: RAQUEL QUINTANA 157,5→150→**142,5**; NACHO PORTA 60→52,5→**45**. Afectaba a la emisión real.
(Nota: NO era que a RAQUEL no se le hiciera descuento —sí se le hace—; es trimestral y solo se
emite en su ciclo, por eso no aparecía cada mes como NACHO mensual.)

**Fix CÓDIGO (2026-06-28 ✅):** `aplicar_descuentos_familiares` aplica **SOLO UN** descuento
familiar por actividad — el **mejor para el cliente** (menor precio resultante). Verificado:
RAQUEL 157,5→150 (1 descuento), NACHO 60→52,5 (1 descuento).

**Pendiente DATOS (🟠, decisión del propietario):** consolidar el catálogo — hay dos
"1 o mas familiares" (#9 manager-wide / #12 Añoreta). El #12 es el completo (RT 2 dias + I MYGYM);
el #9 es duplicado parcial. Falta decidir cuál desactivar (afecta a 50+67 asignaciones). El
blindaje de código ya evita el doble cobro mientras tanto.

**REGLA:** un descuento familiar por actividad; nunca acumular dos descuentos del mismo tipo
sobre la misma cuota. Evitar duplicar conceptos en el catálogo (mismo "código" dos veces).

## 26. Validador de preemisión no respetaba la baja temporal — 2026-06-28 ✅
**Revisado:** `routes/preemision_validar.py` vs `routes/preemision_v2.py` (guards de pausa).

**Bug (display, no de cobro real):** un cliente con **inactividad temporal** (pausa) cuya ventana
toca el mes aparecía como **coherente "a emitir"** en la validación/Excel. La **emisión real**
(`preemision_v2.generar`) SÍ tiene el guard `inactivos_temporal` y los salta — pero el
**validador** (`preemision_validar`) NO lo tenía, así que la previsualización engañaba (parecía
que se les iba a cobrar). Ejemplo: Ana Belén Molina Aguilar (1821247, Añoreta), pausa
2026-07-01→2026-08-31, salía a emitir en julio. NO se le emitía recibo de verdad (no existe), era
solo el preview.

**REGLA:** **no se cobra ningún mes que toque una baja temporal** (`cliente_inactivo_temporal`
con `estado<>'cancelada'` y ventana que solapa el mes). El validador y la emisión deben aplicar
el MISMO guard (espejo) — cualquier filtro de la emisión real debe replicarse en el validador
para que el Excel no mienta.

**Fix (2026-06-28 ✅):** se añade al validador el guard de `inactivo_temporal` (mismo overlap
`fecha_inicio <= último día Y fecha_fin >= primer día`) → nueva incoherencia informativa
`inactivo_temporal` que saca al cliente de "a emitir". Verificado: julio Añoreta → 33 clientes en
pausa marcados (antes salían a cobrar); Ana Belén ahora `inactivo_temporal`.

## 25. Modificar recibo NO cobrado = solo cuota BD (legacy Odoo no bloquea) — 2026-06-28 ✅
**Revisado:** `routes/recibos.py` (`update_recibo`), `components/recibos/ModificarReciboBtn.jsx`.

**REGLA (propietario):** un recibo **NO cobrado** (`borrador_remesa`/`pendiente`/`emitido`/
`impagado`/`devuelto`) es **editable siempre**; la modificación afecta **solo a la tabla
`recibo`** (la cuota) — `update_recibo` NUNCA toca Odoo. Coherente con #23/#24: un recibo no
pagado NO debe tener factura en Odoo hasta el cobro, así que se edita **aunque arrastre una
factura Odoo *legacy*** del import GestPlus (el cambio no la toca; al cobrarse se facturará con
el importe correcto). Solo `pagado`/`facturado` quedan inmovilizados (importes ya en contabilidad).

**Contexto (corrección de rumbo):** la auditoría #19 bloqueaba con 409 `recibo_con_factura_odoo`
cualquier edición de importe si había `account_move_id`. Tenía sentido cuando se facturaban
impagados; con "solo se factura lo pagado" (#23) los impagados nuevos ya no tienen factura y los
únicos con factura son legacy del import → el bloqueo impedía corregir la cuota. Se elimina el 409
para estados no cobrados; la edición es puramente BD (se descarta el intento #4 de propagar a la
factura posteada vía unpost/repost).

**Verificado:** PATCH de importe sobre recibo impagado con factura legacy → `ok` (antes 409); un
recibo `pagado` sigue bloqueado.

**Pendiente (legacy):** los recibos no cobrados con factura Odoo legacy del import siguen con esa
factura posteada (al cobrarse, `marcar_pagado` reconcilia contra ella). Limpieza de esas facturas
"impagadas posteadas" pendiente de decisión (rectificativa) — ya flagueado.

## 24. Emisión por COBERTURA (fecha_hasta), no por ciclo de fecha_inicio — 2026-06-25 ✅
**Revisado:** `preemision_v2._toca_emitir` + `generar` (`ya_cubiertos_post_mes`),
`preemision_validar._toca_emitir_local` + chequeo de cobertura.

**Bug (under-billing real):** la decisión de "¿toca cobrar este mes?" usaba el ciclo
`n % step == 0` contado desde **`fecha_inicio`**. Para los clientes migrados de GestPlus
`fecha_inicio` es el **día del import masivo** (todos `2026-06-02`), no su alta real, así que
el ciclo arrancaba mal y **saltaba meses que sí tocaban**. Ejemplo verificado: MONTSE JIMENA
OLMEDO (1821203), trimestral, último recibo cubre hasta **30/06/2026** → en julio toca cobrar,
pero `n=(jul−jun)=1`, `1%3≠0` → "no toca" → no se emitía. 82 clientes de Añoreta afectados en
julio (~7.300€/trimestre que se dejaban de cobrar). La emisión REAL (`preemision_v2`) usaba la
misma lógica errónea, no solo el validador.

**REGLA (invariante, modelo correcto):** el disparador de cobro es el **fin de cobertura
(`fecha_hasta`) del último recibo**, NO el ciclo desde `fecha_inicio`. Se emite el mes M a un
cliente si **no tiene cobertura que llegue a M** (`MAX(fecha_hasta) < primer día de M`). La
**periodicidad** solo determina el **precio** y **cuánto cubre** cada recibo (`_calc_fecha_hasta`
= emisión + N meses − 1 día), no qué mes se cobra.

**Fix (2026-06-25 ✅):**
- `_toca_emitir` / `_toca_emitir_local`: se elimina el gate `n % step`; queda solo "ha empezado"
  (`target_mes >= fecha_inicio_mes`).
- Chequeo de cobertura (`ya_cubiertos_post_mes`): boundary de `fecha_hasta > último día` a
  **`fecha_hasta >= primer día del mes`** (un recibo que cubre hasta 30/06 cubre TODO junio →
  no re-emitir junio; pero ya NO cubre julio → en julio toca).
- **Sin doble cobro**: los cubiertos se siguen saltando (`ya_cubierto_post_mes`) y el dedup por
  `periodo` (`ya_existen`) impide repetir el mismo mes.
- **Gating por impago (confirmado correcto):** si el cliente tiene un recibo no cobrado
  (`emitido`/`impagado`) cuya cobertura tapa el mes, NO se le emite el siguiente — se gestiona
  como impago. Override manual del gestor: poner ese recibo a **0€** → un recibo `importe_total=0`
  **NO cuenta como cobertura**, así que la emisión se reactiva. Funciona en recibos BD; los
  legacy con factura Odoo posteada no se pueden poner a 0 (importe bloqueado, #19) → son impagos
  a gestionar.

**Verificado (validar 2026-07):** `sub_no_toca_este_mes` pasa de 82 → **0** en Añoreta; de esos
82, 48 quedan como `ya_cubierto_post_mes` (cobertura sí llega a julio) y 34 pasan a coherentes
(cobertura vencida 30/06 → se cobran). MONTSE confirmada como cobrable en julio.

**DEPENDENCIA de datos (vigilar):** el modelo confía en que `fecha_hasta` esté bien puesta. Un
recibo trimestral/anual con `fecha_hasta` NULL o stale haría que el cliente parezca "sin
cobertura" y se le cobre cada mes. El validador/Excel (revisión previa) es la red de seguridad
antes de emitir. (Mensual = `fecha_hasta` NULL por diseño → se cobra cada mes, dedup por periodo.)

## 23. Facturación solo de cuotas PAGADAS — 2026-06-25 ✅
**Revisado:** `routes/facturacion_trimestre.py` (`facturar`), `routes/recibos.py`
(`update_recibo`), `components/recibos/ModificarReciboBtn.jsx`.

**REGLA (invariante, decisión propietario):** una cuota **IMPAGADA no genera factura
fiscal**. La `account.move` (factura) se crea **solo cuando se formaliza el pago** — así no
hay facturas fiscales de cuotas no cobradas y la modificación de un impagado es simple (solo
la cuota BD, sin candado Odoo).

- `facturacion_trimestre.facturar`: el filtro pasó de `estado IN ('pagado','impagado',
  'devuelto')` a **`estado = 'pagado'`** (guard duro: aunque el frontend mande ids de
  impagados/devueltos, se ignoran). Un impagado cobrado más tarde entra como `pagado` en la
  siguiente pasada trimestral y se factura entonces.
- **Consecuencia:** un impagado nuevo nunca tiene `account_move_id` → es cuota BD simple →
  `editableFull` en "Modificar recibo" sin restricción. **No** se mutan facturas posteadas
  desde la web.

**Contexto / corrección de rumbo:** una iteración previa (#4 de un lote de bugs) había
desbloqueado la edición de importes de facturas **posteadas** propagando el cambio a Odoo
(`button_draft → editar → action_post`). Al adoptar esta regla, esa propagación arriesgada
(impacto SII) quedó **innecesaria y se revirtió**: editar importes de un recibo YA facturado
sigue bloqueado (409 `recibo_con_factura_odoo`); para cambiarlo → anular + recrear.

**Legacy:** los recibos impagados ya facturados por el **import GestPlus** (`INV/2026/*`,
`origen='gestplus_2026'`) se dejan como están (decisión propietario); su importe no es
editable desde la web.

## 22. Preemisión cruza trainers — fuga cross-trainer en emisión mensual — 2026-06-20 ✅
**Revisado:** `routes/preemision_v2.py` (generar/listar/borrar), `routes/emision_v2.py`
(emitir), `routes/sepa.py` (generar_sepa), `routes/preemision_validar.py` (validar/excel).

**Síntoma (reportado):** al hacer una preemisión operando como **Round Málaga (trainer
17675)** también aparecían/emitían clientes de **Round Añoreta (trainer 17674)**.

**Causa raíz:** TODO el flujo de emisión mensual (v2) era **manager-wide**: `generar` barre
`round.subscription` de la company entera, y `listar`/`validar`/`emitir`/`sepa` filtraban solo
por `id_manager`. La cabecera `X-Round-Trainer-Id` que manda el frontend al impersonar/loguear
trainer se **ignoraba a propósito** (nota mayo-2026 en `sepa.py`: "impersonación = visibilidad,
no regla de proceso"). El "B8b" previo solo añadió la **columna** `id_trainer` al recibo para
poder **agrupar** la remesa por acreedor — **nunca** fue un filtro. Git lo confirma: jamás existió
un `WHERE id_trainer` en la generación.

**Verificación del bug (read-only, `validar` 2026-06):** manager-wide → 38 clientes "tocan
emitir", **todos de Añoreta (17674)**; operando como Málaga (17675) → esos 38 se colaban. Las
únicas subs activas que tocaban en junio eran de Añoreta → por eso Málaga las arrastraba.

**Decisión del propietario (jun 2026, ANULA la nota manager-wide de mayo para el caso
impersonado):** operar COMO un trainer concreto **aísla TODO el flujo de emisión** a sus
clientes. El manager **sin impersonar** (`g.id_trainer` None) sigue **manager-wide**.

**Fix (2026-06-20 ✅):** scope por `g.id_trainer` (cuando está set) en las 4 rutas:
- `preemision_v2.generar`: salta clientes cuyo trainer real (`cliente_cache.id_trainer`) ≠
  `g.id_trainer` (nuevo `skipped_otro_trainer`); también acota la definitivización de borradores
  manuales.
- `preemision_v2.listar` / `borrar_recibo`: `AND id_trainer=%s` (un trainer no ve ni borra
  recibos de otro).
- `emision_v2.emitir`: solo cobra los recibos del trainer.
- `sepa.generar_sepa`: `target_trainer = ?id_trainer= explícito **o** g.id_trainer` → la remesa
  se restringe a ese acreedor (encaja con el caso multi-acreedor ya soportado por
  `_recibos_sepa_mes`).
- `preemision_validar`: post-filtra `coherentes` + `incoherencias` por el trainer real del
  cliente ANTES de calcular el `resumen` (los totales por trainer cuadran).

**Verificado tras deploy:** `listar` 2026-06 → manager 198 / Málaga(17675) 198 / Añoreta(17674)
0. `validar` 2026-06 → manager 38 (todos 17674) / Málaga 0 / Añoreta 38. Sin regresión del
manager: el frontend pone `trainerId=null` cuando NO se impersona (`getRoundIdentity`), así que
el manager directo no manda la cabecera → manager-wide intacto.

**REGLA:** en el flujo de emisión mensual (preemisión/emitir/SEPA/validar), `g.id_trainer` (set
por impersonación o login de trainer) **restringe el PROCESO a ese trainer**; sin él
(`g.id_trainer` None) es manager-wide. El `id_trainer` del recibo es el **trainer real del
cliente** (snapshot de `cliente_cache`), no el emisor. NOTA datos: los recibos de Añoreta de
junio venían de un import `gestplus_2026`, no del botón de preemisión.

## 21. Notificaciones / Meta (redes) / Email — robustez de envío — 2026-06-15 ✅
**Revisado:** `cron_social_publish.py`, `meta_client.py`, `email_sender.py`
(`_enviar_smtp`/`_enviar_postmark`/`_enviar_resend`), `social_cuenta`/`social_post`.

**Contexto:** Meta está **inactivo** (0 `social_cuenta`, 0 token, 0 `social_post` en prod —
falta App Review + Page Access Token de 60d, ver CLAUDE.md). El email transaccional (Resend/
Postmark/SMTP) **sí** está vivo.

**Verificado sólido / no-bug:**
- **N-1 (carrera del scheduler) — descartado.** `publicar_pendientes()` usa **claim atómico**:
  `UPDATE social_post SET estado='publicando' WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
  RETURNING id`. Dos timers concurrentes no publican el mismo post dos veces (el patrón "reclamar
  estado ANTES de la llamada externa" de auditorías #17/#4). `attempts<3` corta el bucle; al
  fallar, `_marcar_fallido` lo vuelve a 'pendiente' (o 'fallido' al 3º).
- **N-2 (token Meta caducado) — manejado.** Antes de publicar comprueba
  `expires_at < now()` → `_marcar_fallido('access_token caducado · renueva la cuenta Meta')`.
  No hay publicación silenciosa con token muerto. (Limitación conocida, NO bug: **no hay refresco
  proactivo** del token de 60d ni aviso anticipado — cuando Meta entre en producción habrá que
  renovarlo a mano antes de expirar. Anotado como pendiente menor.)
- **N-3 (inyección de cabeceras email) — mitigado.** `_enviar_smtp` construye con
  `email.message.EmailMessage` (`msg['Subject']`, `msg['To']` → la stdlib escapa CR/LF, no hay
  concatenación de cabeceras a mano); `_enviar_postmark`/`_enviar_resend` usan **API JSON HTTP**
  (sin parseo de cabeceras); y el `To` se valida como email RFC antes de enviar
  (rechaza `_MAK`/inválidos). Sin vector de header-injection.

**Hallazgo CORREGIDO (2026-06-15 ✅):**
- **N-4 `'publicando'` atascado sin TTL (clase del lock POS #7).** El claim marca
  `estado='publicando'` y luego publica; si el **worker crashea** entre el claim y el resultado,
  el post quedaba en `'publicando'` **para siempre** (la query solo recogía `'pendiente'`) → no se
  reintentaba nunca. Fix: el `SELECT` del claim también reclama
  `(estado='publicando' AND updated_at < NOW() - INTERVAL '15 minutes')`, con `attempts<3` como
  corte. Un post atascado por crash se re-reclama a los 15 min. (Latente: Meta inactivo, pero se
  blinda antes de producción.)

**REGLA:** todo cron que marque un estado intermedio de "en proceso" (`publicando`/`syncing`/…)
antes de una llamada externa lenta debe poder **reclamar ese estado tras un TTL** (worker muerto
no debe dejar la fila bloqueada). Cuando Meta entre en producción: renovar el Page Access Token
(60d) **antes** de `expires_at` (no hay refresco automático).

## 20. Trimestral legacy — convivencia con dedup + gating — 2026-06-15 ✅
**Revisado:** `routes/facturacion_trimestre.py` (`preview`, `preview_excel`, `facturar`),
interacción con el dedup BD/Odoo (auditoría #8) y con `marcar_pagado`.

**Funcionamiento:** `facturar` agrupa **N recibos → 1 `account.move`** por cliente (N líneas,
1 por recibo); marca los N recibos con el mismo `account_move_id` (estado `pagado`→`facturado`;
`impagado`/`devuelto` conservan estado pero con asiento) y reconcilia los pagos previos contra
la factura (C3 netting).

**Hipótesis del plan (sobre-conciliación) — DESCARTADA.** Se temía: dedup quita el 1 move y
muestra N filas BD pagables → N pagos contra 1 move. Verificado que **no** se materializa:
`marcar_pagado` crea el payment por el **importe del recibo** (su share, no el total del move) y
reconcilia **aditivamente** contra el move compartido; la suma de shares = total del move →
residual 0 correcto. El guard C2 (`pagado`+`account_payment_id`) evita pagar dos veces el mismo
recibo. La cardinalidad recibo↔move pasa a **N:1** para trimestral, y el dedup la maneja bien
(bd_move_ids = {move}, oculta el move Odoo, muestra las N filas BD). Coherente.

**Hallazgo CORREGIDO (2026-06-15 ✅) — gating ausente.** `preview`, `preview_excel` y sobre todo
`facturar` (crea `account.move` posteados) solo tenían `@auth_required` + `@require_feature` →
**cualquier sesión autenticada podía facturar el trimestre** (postear facturas). Las claves de
permiso existían pero no se aplicaban. Fix: `@require_permission` con
`economico.cuotas_mensuales.facturacion_trimestre_{ver,excel,emitir}` respectivamente.
**Verificado:** manager (perfil None) pasa; usuario_web sin la clave → 403.

**Abierto (bajo, no bloqueante):** `facturar` no tiene advisory lock; la idempotencia viene del
filtro `account_move_id IS NULL` (no re-factura recibos ya facturados), pero dos `facturar`
concurrentes del mismo trimestre podrían duplicar facturas (acción manual trimestral → riesgo
bajo). Si se quiere blindar: `pg_advisory_xact_lock(manager+trim)` al entrar.

## 19. Modificar recibo (no cobrado) — desincronía con factura Odoo — 2026-06-12 ✅
**Pregunta auditada:** ¿el botón "Modificar" de un recibo NO cobrado funciona en todas sus
selecciones y queda Odoo modificado correctamente? **Revisado:** `update_recibo` (PATCH
`/api/recibos/<id>`), `ModificarReciboBtn.jsx`, serializador unificado `_bd_recibo_to_unified`.

**Hallazgo:** `update_recibo` **NUNCA toca Odoo** — solo escribe la fila BD `recibo`. Estados
editables (importes): `borrador_remesa/pendiente/impagado/devuelto`. El problema: `impagado` y
`devuelto` **suelen tener `account_move_id`** (factura Odoo YA posteada; tras emisión→SEPA
devuelta/impagada). Datos reales: **27 impagado + 3 devuelto con move**, los 30 **posteados**
(`state='posted'`). Editar el importe de uno de esos → cambiaba la BD pero **NO la factura Odoo**
(que es inmutable fiscalmente / SII) → **desincronía BD↔factura**; solo se registraba una
incidencia, no se corregía Odoo.

**REGLA / decisión (correcta contablemente):** una factura **posteada** NO se edita en sitio
(habría que emitir rectificativa). Por tanto, si el recibo tiene `account_move_id`, "Modificar"
**no permite tocar importes/contable** — solo notas/descripción; para cambiar importes hay que
**anular + recrear**. (No se "propaga a Odoo" porque propagar a un asiento posteado es
incorrecto.)

**Fix (2026-06-12, desplegado):**
- **Backend** `update_recibo`: si `editable_full` PERO `account_move_id` presente → bloquea los
  campos de importe (`409 recibo_con_factura_odoo`); permite solo base (cliente/cuota/desc/notas).
  Sin move → editable total como antes (cambio local, se refleja al emitir).
- **Frontend** `ModificarReciboBtn`: `editableFull` ahora exige además `!account_move_id` →
  inputs de importe deshabilitados + aviso "ya tiene factura en Odoo #N; anula y recrea".
- **Serializador** `_bd_recibo_to_unified`: expone `account_move_id`/`account_move_ref` para que
  el bloqueo funcione también en el listado unificado de cuotas (no solo en la ficha de cliente).

**VERIFICADO en prod (3 escenarios):** recibo devuelto CON move → editar importe = **409**;
mismo recibo editar solo notas = **ok**; recibo impagado SIN move → editar importe = **ok**.
(Los 2 recibos tocados en las pruebas se restauraron del backup; incidencia de prueba eliminada.)

**Observación anotada (no de este botón):** 5 de los 30 moves están `payment_state='paid'` en
Odoo pero su recibo BD figura `impagado`/`devuelto` → desincronía de ESTADO preexistente
(devolución que anuló el estado BD sin cancelar el payment Odoo, o viceversa). Pendiente de
revisar aparte.

**BUG adicional (CORREGIDO 2026-06-15) — el estado `emitido` NO era modificable.** Reportado:
"al perfil Administrador no le deja modificar NADA del popup". Causa: `emitido` (recibo NO
cobrado, posteado-pendiente; 173 recibos, muchos migrados) **no estaba** en la lista de estados
editables (`borrador_remesa/pendiente/impagado/devuelto`) ni era `pagado/facturado` → caía en
`estado_no_editable` (403) → el backend rechazaba CUALQUIER cambio, **incluidas las notas** → el
admin abría el popup, editaba y al guardar saltaba el error. No era un problema de permisos (el
perfil "Administrador" tiene `is_admin=true` → pasa el gate; el botón sí aparecía). Fix: añadir
`'emitido'` a los estados editables (backend `update_recibo` + frontend `ModificarReciboBtn`).
El guard `tiene_move` (#19) sigue aplicando: `emitido` SIN factura Odoo → editable total;
`emitido` CON factura posteada (111 de 173) → solo notas/descripción (importes bloqueados).
**Verificado:** recibo 2089 (emitido, move 2347) → PATCH notas OK, PATCH importe 409. (Recibo
de prueba restaurado del backup.)
**REGLA:** la lista de estados "no cobrados / editables" es
`borrador_remesa|pendiente|emitido|impagado|devuelto` (debe coincidir EXACTA en backend y
frontend). Terminales no editables: `pagado|facturado` (solo notas + metodo_pago admin),
`cancelado|anulado`.

## 18. Incidente nginx — caída por blip de DNS en upstream — 2026-06-11 ✅
**Qué pasó:** 06:48 CEST nginx se reinició (logrotate/diario); a las 06:49:07 un chequeo de
config falló con `[emerg] host not found in upstream "pro.wiemspro.com" in
.../noofit.wiemspro.com:250` → `nginx -t failed` → systemd dejó el servicio **failed** (sin
reintento) → **web caída hasta restart manual**. Causa: un parpadeo transitorio de DNS en el
VPS justo en el arranque. NO fue por ningún cambio de código.

**Causa raíz:** `proxy_pass https://pro.wiemspro.com/wiemspro/;` (hostname **literal**) → nginx
resuelve el upstream **al arrancar/validar**. Si el DNS parpadea en ese instante, `nginx -t`
falla y el server no levanta. Patrón frágil: cualquier microcorte de DNS en un restart deja la
web caída hasta intervención manual.

**Fix (VPS, 2026-06-11 — NO está en git, es infra; backups en `/root/*.bak_*`):**
1. **Resolución en tiempo de PETICIÓN** (causa raíz) — en el bloque `^~ /wiemspro/` de
   `noofit.wiemspro.com` **y** `round.wiemspro.com` (el legacy tenía la misma mina; `nginx -t`
   valida TODOS los vhosts, así que cualquiera tumbaba el arranque):
   ```
   resolver 127.0.0.53 valid=30s ipv6=off;
   resolver_timeout 5s;
   set $nf_host pro.wiemspro.com;
   proxy_pass https://$nf_host$request_uri;   # variable → resuelve por request
   ```
   `$request_uri` preserva ruta+query (el mapeo `/wiemspro/`→`/wiemspro/` es identidad). Con
   variable, nginx NO resuelve al arrancar → un blip de DNS degrada 1 request a 502, **no tumba
   el server**.
2. **Cinturón systemd** — drop-in `/etc/systemd/system/nginx.service.d/override.conf`:
   `Restart=on-failure`, `RestartSec=5s`, `StartLimitBurst=5`/`IntervalSec=300` (reintenta solo,
   sin bucle infinito). Antes era `Restart=no`.

**Verificado:** `nginx -t` OK; `systemctl restart nginx` (el escenario exacto que falló) →
arranque limpio sin `emerg`; web 200; proxy `/wiemspro` 200.

**REGLA (lectura futura / recovery):** ningún `proxy_pass` a un hostname **externo** debe usar el
literal — siempre `resolver` + variable (`set $x host; proxy_pass …$x…`). Si se reconstruye el
VPS o se reescriben los vhosts, **reaplicar** este patrón + el drop-in systemd. (Pendiente real
ya conocido: retirar `round.wiemspro.com`, que sigue activo — al hacerlo desaparece su copia.)

## 17. Entradas puntuales — carrera de cobro — 2026-06-10 ✅
**Revisado:** `cron_entradas_puntuales.py` (detección), endpoints `entradas_puntuales.py`
(altas, cobrar, anular, emitir-mes, detectar), UNIQUE `entrada_evento_unico`.

**Verificado sólido:**
- **Detección (cron + /detectar)**: `INSERT … ON CONFLICT (id_manager,cliente_idnoofit,sala_id,
  fecha_clase) DO NOTHING` → la carrera cron↔timer↔/detectar **no duplica eventos**. La
  deduplicación entre creds manager+trainers (cada login NF ve lo suyo) la hace un dict en
  memoria + la UNIQUE. Sólido.
- Gating: todos los endpoints mutadores llevan `@require_permission('entradas_puntuales.*')`.

**Hallazgos CORREGIDOS (2026-06-10 ✅) — doble cobro por carrera:**
- **E-1 `cobrar_evento`**: leía `estado='pendiente'`, llamaba a Odoo (lento) y marcaba 'cobrado'
  en OTRA conexión, **sin lock**. Dos POST concurrentes (doble clic recepción / 2 terminales)
  → ambos pasaban el check → **2 recibos sueltos = doble cobro**. Fix: **CLAIM atómico** — un
  único `UPDATE … SET estado='cobrado' WHERE estado='pendiente' RETURNING …` decide el ganador
  ANTES de crear el recibo; el perdedor recibe 409. Si Odoo falla, se revierte el claim
  (`estado='pendiente'` guard `recibo_odoo_id IS NULL`) para reintentar.
- **E-2 `emitir-mes`**: mismo patrón en batch (leía grupos pendiente → recibo → marcaba
  facturado). Fix: por grupo, **CLAIM atómico** (`UPDATE … 'facturado' WHERE 'pendiente' …
  RETURNING`) y el **importe se calcula sobre lo reclamado**, no sobre el recuento previo → una
  ejecución concurrente reclama 0 y se salta (no doble-factura). Revert del grupo si Odoo falla.

**REGLA:** todo cobro/emisión que cree un recibo en Odoo desde un estado BD debe **reclamar el
estado atómicamente ANTES** de la llamada a Odoo (no "leer→Odoo→marcar"), y **revertir** si la
creación falla. Mismo principio que recibos `marcar_pagado` (Sprint 7 C2) y POS.

## 16. SEPA / remesas / devoluciones — 2026-06-10 ✅
**Revisado:** `emitir_remesa` + `_registrar_pagos_auto` (`odoo_cuotas.py`), `banco_matcher.py`,
`banco_parser.py`, `iban_validator.py`, endpoint `/devoluciones` + `_recibo_para_devolucion` +
`_cliente_idnoofit_por_dni` (`cuotas_clientes.py`). Datos: `account_payment_order` #5 = 7 líneas
189,75€ (la vía SEPA SÍ se usa).

**REGLA / alcance (lectura futura):**
- **El `pain.008` lo genera ODOO** (`account.payment.order` → `draft2open` → `open2generated`,
  módulo SEPA OCA), NO nuestro código. Por tanto **FRST vs RCUR** (lo deriva el `sdd.mandate`
  por uso), **validación IBAN** (`res.partner.bank` valida el checksum al crear) y el redondeo/
  escape del XML son responsabilidad de Odoo → las hipótesis del plan quedan **mitigadas por
  delegación** a un módulo maduro. Nuestra parte: montar bien las líneas (mandate_id +
  partner_bank por invoice) y el ciclo de devolución.
- **El matcher de devoluciones NO es por importe global** (esa era la hipótesis temida): casa por
  `(id_manager, cliente_idnoofit|DNI, periodo)`. `banco_matcher.py` es OTRA cosa (concilia banco
  ↔ GASTOS de proveedor, no devoluciones de cliente).

**Hallazgos CORREGIDOS (2026-06-10 ✅):**
- **S-4 (gating) — `/devoluciones` sin permiso.** El endpoint revierte pagos (anula
  `account.payment`, marca recibos `devuelto`) **manager-wide** y solo tenía `@auth_required` →
  cualquier usuario_web (de cualquier perfil) podía revertir cobros. Fix: `@require_permission(
  'economico.cuotas_mensuales.anular_pago')` (clave destructiva ya existente). Verificado:
  manager NoofitPro pasa; un usuario_web sin la clave → 403.
- **S-2 (matching) — `_cliente_idnoofit_por_dni` adivinaba.** El docstring decía "None si no hay
  match único" pero hacía `LIMIT 1` → con un DNI repetido (2 cuentas NF, dato erróneo) devolvía
  el primero arbitrario → **la devolución se aplicaba a la cuenta equivocada** (anula el pago de
  otro). Fix: `LIMIT 2`; devuelve id SOLO si el match es único, si no None (+ warn). "Mejor no
  casar que casar mal" — el operador lo resuelve a mano por idnoofit.

**Verificado sólido / no-bug:**
- **S-1 (descartado)**: se temía que `emitir_remesa` marcara los SEPA pagados (auto-pago) ANTES
  de construir la `payment.order` leyendo `amount_residual` (→ líneas 0€). La order real tiene
  189,75€ → no manifiesta. El orden es frágil pero empíricamente correcto; **no se toca**.
- **B12 idempotencia de devolución** por `movimiento_financiero UNIQUE(manager,tipo,recibo,ref)`
  + chequeo previo por `referencia` de banco — sólido. (Edge anotado S-3: si NO viene ref de
  banco y el cliente tiene 2 recibos mismo periodo+importe, la ref sintética
  `cliente|periodo|importe` puede colisionar → 2ª devolución legítima se marca "ya_procesada".
  Raro; pedir siempre la `referencia` del banco lo evita.)
