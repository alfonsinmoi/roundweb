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
| 9 | Alta de cliente — `account.move` sin fila `recibo` BD | 2026-06-09 | 🟡 |
| 10 | Devoluciones SEPA — rendimiento (OneSignal en 2º plano) | 2026-06-09 | ✅ |
| 11 | Auth & bootstrap multi-tenant (H1/H2) | 2026-06-09 | 🟠 |

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

## 9. Alta de cliente — `account.move` sin fila `recibo` BD — 2026-06-09 🟡
**Hallazgo (no implementado):** `crear_recibo_alta` (`odoo_alta.py`) crea la factura de
alta DIRECTAMENTE como `account.move` y **NO inserta fila en `recibo`**. Si el pago no es
inmediato (aplazar/enlace) → move posteado e impagado sin recibo BD ("huérfano").

**REGLA deseada (pendiente):** el alta debe **crear también la fila `recibo`** enlazada
(`account_move_id`, estado según pago) para correspondencia 1:1 en ambos sentidos.
Mitigado operativamente por la auditoría 8 (cobro de move puro). 4 altas huérfanas detectadas.

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
