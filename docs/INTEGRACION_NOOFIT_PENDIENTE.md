# Integración pendiente NoofitPro ↔ Round

> Lista exhaustiva de funcionalidades que **Round** mantiene en una BD propia
> (PostgreSQL en VPS, tablas detalladas en cada sección) porque NoofitPro
> hoy no las expone, no las persiste o las descarta silenciosamente.
>
> Conforme NoofitPro vaya publicando los servicios equivalentes, Round
> migrará/sincronizará y dejará de mantener la copia local. Cada sección
> indica el **gap exacto** y la **API mínima** que Round necesita para hacer
> el switch.

---

## 0. QR de vinculación cliente ↔ mynoofit ✅ RESUELTO (junio 2026)

**Estado:** ACTIVADO. Spec en `docs/QR_TRAINER_CLIENTE.md`.

**Formatos confirmados por NoofitPro:**
- **QR de la ficha** (`QrFichaCliente`, `ClientProfile.jsx`): payload sin
  cifrar. `TRAINERLINK;<idCliente>` si `cedeDatos=true` (defecto), o
  `cedeDatosFalse:<idCliente>:<dni>:<idTrainer>` si `cedeDatos=false`.
  Helper: `payloadQrVincular()` en `src/utils/qrCifrado.js`.
- **QR del centro/trainer** (`QrCentroButton`): payload cifrado AES-256-CBC
  con PBKDF2-HMAC-SHA1 (1000 iter., 48 bytes), salida base64.
  Texto plano: `TRAINER;<idTrainer>;<managerId>;<nombreCompleto>`.
  Helper: `cifrarQrTrainer()` en `src/utils/qrCifrado.js` (Web Crypto API).

**TODO menor:**
- El flag `Trainer.cedeDatos` no lo expone NoofitPro hoy: la web asume
  `cedeDatos=true` (caso defecto). Cuando llegue por API, pasarlo a
  `payloadQrVincular({cedeDatos})` en `QrFichaCliente`.

---

## 1. Categorías de cliente (Gympass / Trabajador / Invitado / …)

**Estado actual:** Round las mantiene en sus tablas `categoria` (catálogo
por manager) y `cliente_categoria` (asignación 1:1 cliente↔categoría).

**Por qué local:** NoofitPro solo distingue `enabled` (activo/inactivo).
No tiene un concepto de "tipo de cliente" más allá del email/alias.

**Modelo:**
- Una categoría define: `nombre`, `puede_reservar` (si pueden reservar
  clases), `tiene_cuota` (si llevan cuota), `activa` (si está vigente),
  `color` (UI).
- Un cliente puede tener 0 o 1 categoría asignada. Sin asignación =
  "Pagador con cuota" implícito.
- Si la categoría está inactiva o `puede_reservar=false`, los clientes
  asignados no pueden reservar clases.

**Lo que necesitamos de NoofitPro:**
1. CRUD de categorías por `manager_id`: GET/POST/PUT/DELETE `/categorias`
2. Endpoint para asignar/leer categoría por cliente: PUT `/clientes/{id}/categoria` y GET equivalente
3. Validación en reservas: el endpoint de reserva debería rechazar si el
   cliente tiene una categoría con `puede_reservar=false`.
4. Filtro: GET `/clientes?categoria=<id>` para listar clientes por categoría.

**Mapping previsto:** la tabla local `categoria` ya tiene columna
`noofit_alias` (text nullable) para mapear nuestras categorías con las que
NoofitPro publique.

---

## 2. Histórico de inactivación / reactivación + fechas clave

**Estado actual:** Round mantiene la tabla `cliente_estado_log` con un
cron diario (`round_cliente_log.timer`) que detecta transiciones
`activo↔archivado` desde `getClienteSimple`.

**Por qué local:** NoofitPro solo expone el estado actual (`enabled`,
`motivoArchivado`) pero no:
- **Fecha de primera alta** (creación original del cliente)
- **Fecha de la última inactivación**
- **Fecha de reactivación** (cuándo pasó de archivado a activo)
- **Histórico** completo de cambios de estado
- **Motivo** de cada inactivación (solo guarda el último)

**Lo que necesitamos:**
1. Campo `fechaCreacion` o `createdAt` en el objeto cliente que devuelve
   `getClienteSimple` / `getClientePlusv2`. Hoy NO viene.
2. Endpoint de histórico: GET `/clientes/{id}/historial` con timeline
   `[{fecha, estado_nuevo, estado_anterior, motivo, actor_id}]`
3. Cuando un cliente pase de archivado→activo (reactivación), preservar
   la fechaCreacion original (NoofitPro no debería sobrescribirla con la
   fecha de la reactivación).
4. Endpoint de "última inactivación": GET `/clientes/{id}/fechas` con
   `{fecha_primera_alta, fecha_alta_actual, fecha_inactivo}`.

**Renombrado UI Round:** la palabra "archivado" ya no aparece en la web;
se usa "inactivo" / "reactivar". Pero internamente NoofitPro sigue
hablando de "archivado" / `motivoArchivado`. Sin urgencia, pero útil
homogeneizar a futuro.

---

## 3. Gympass ID (ya existente, NoofitPro lo descarta)

**Estado actual:** tabla `cliente_gympass` (columnas
`cliente_idnoofit`, `gympass_id`, `notas`, `id_manager`).

**Por qué local:** documentado en `cliente_gympass.py`:
> "NoofitPro acepta el campo `gympassId` en sus POST pero **NO lo
> persiste** (silenciosamente lo descarta)."

**Lo que necesitamos:** persistir el campo `gympassId` cuando lo enviamos
en `clientePlusv2`. Devolverlo también en `getClienteSimple`.

> Una vez resuelto, esta tabla local se puede dar de baja y todo se mueve
> a la nueva categoría "Gympass" (sección 1).

---

## 4. Sandbox `_MAK` impide editar clientes

**Estado actual:** documentado en `CLAUDE.md`:
> "No ejecutar `crear_alta_cliente` en producción si el cliente NoofitPro
> tiene email con `_MAK` (es marker de sandbox y NoofitPro no lo deja
> editar)."

**Síntoma:** cuando intentamos hacer POST `clientePlusv2` con un email
modificado para un cliente que aún tiene `_MAK` en NoofitPro, la petición
parece OK pero los datos no se actualizan.

**Lo que necesitamos:**
- Saber qué hace exactamente el marker `_MAK` y cuándo se aplica.
- Permitir editar libremente (o documentar formalmente la restricción).
- Idealmente exponer un flag en el objeto cliente: `is_sandbox: bool`
  para que la UI lo muestre.

---

## 5. Email automático "Wiemspro" — `toSend`

**Estado actual:** todos los POST de clientes se mandan con `toSend=False`
para que NoofitPro **no** envíe su email de bienvenida hardcoded
(asunto/cuerpo Wiemspro). Round envía el suyo propio (Resend/SMTP per
trainer) con la marca de su gimnasio.

**Por qué local:** el email automático está hardcoded en NoofitPro,
firmado como Wiemspro, no se puede personalizar.

**Lo que necesitamos:**
- Plantillas configurables por manager/trainer en NoofitPro, o
- Mantener `toSend=False` indefinido (la solución actual ya es válida si
  garantizan que ese flag seguirá respetado).

---

## 6. Reservas de slot de prueba (lead → clase)

**Estado actual:** Round mantiene tabla `slot_reserva` con:
- `token` único para acceso público (`/reserva/<token>`)
- `estado` ('pendiente', 'creando', 'confirmada', 'cancelada')
- `motivo_cancelacion`, `cancelado_at`, `recordatorio_at`
- vínculo a `lead_asignacion` (Odoo) y al `cliente_id` NoofitPro

**Por qué local:**
- NoofitPro no tiene "lead". El cliente nace ya como cliente real con
  `enabled=True` desde la primera reserva.
- El cliente puede cambiar de fecha o anular antes de venir, sin
  ensuciar NoofitPro con bajas/reactivaciones.

**Lo que necesitamos:**
- Estado intermedio "lead/prueba" en NoofitPro distinto de cliente real, o
- Un endpoint específico de "reservar prueba" sin convertir todavía en
  cliente: POST `/leads-prueba {dni, email, slot_id}` → token público.
- Confirmación / cancelación / recordatorio T-24h gestionados por
  NoofitPro.

---

## 7. CRM (leads, embudo, scoring)

**Estado actual:** Round usa **Odoo CRM** (XML-RPC) con stages, lost
reasons, etc. Tabla espejo local `lead_asignacion` con `qualification`,
`score`, `stage_history`, `lost_reason`.

**Por qué local:** NoofitPro no tiene módulo CRM.

**Lo que necesitamos a futuro (opcional):**
- Una API de leads en NoofitPro para no depender de Odoo.
- Si se mantiene Odoo, idealmente NoofitPro expondría un webhook al
  reactivar/inactivar un cliente para que CRM se sincronice automático.

---

## 8. Cuotas / Descuentos / Modificaciones (catálogo manager + asignaciones)

**Estado actual:** Round mantiene 4 tablas locales:
- `cuota` (plantillas manager + por trainer)
- `descuento` + `descuento_asignacion`
- `modificacion` + `modificacion_cobro`
- `cuota_cliente` (cuál cuota tiene cada cliente)

Sincronizado bidireccional con Odoo (`round_subscription`,
`round_recibo`, `round_pago`).

**Por qué local:** NoofitPro no expone el módulo de cuotas/cobros con
suficiente granularidad para nuestro caso (descuentos puntuales con
fechas, modificaciones por recibo, periodicidades trimestral/semestral,
SEPA/PayComet, IRPF, etc.).

**Lo que necesitamos a futuro:** decidir si NoofitPro evolucionará
hacia un módulo de cobros completo o si Odoo sigue siendo el ERP de
facturación. Hoy estamos cómodos con Odoo, pero NoofitPro debería
**leer** las cuotas que Round le dice que tiene cada cliente para
mostrarlas en `mynoofit` (la app del cliente final).

---

## 9. Email transaccional (Resend / Postmark / SMTP / Gmail)

**Estado actual:** tablas `email_proveedor` (config por manager o per
trainer) + `email_template` (plantillas con variables `{{var}}` por
evento: `slot_reservado_lead`, `slot_confirmado_lead`,
`slot_recordatorio_lead`, `factura_enviada`, etc.).

**Por qué local:** NoofitPro solo manda su email Wiemspro (sección 5).

**Lo que necesitamos:** ver sección 5. Si NoofitPro publica plantillas
configurables, esto se puede consolidar.

---

## 10. PayComet (pasarela de pago)

**Estado actual:** tabla `pasarela_credenciales` con credenciales
PayComet por trainer.

**Por qué local:** cada centro Round usa su propia cuenta PayComet
(account_id, terminal_id, jet_id). NoofitPro no gestiona pasarelas.

**Lo que necesitamos:** ningún cambio, pero si NoofitPro publica un
endpoint para "cobrar X € al cliente Y", podríamos delegarle el cobro y
no tener que mantener PayComet en Round.

---

## 11. Centros / contactos por trainer

**Estado actual:** tabla `centro_contacto` (un trainer = un centro,
columnas `slug`, `email`, `telefono`, `direccion`, `mapa`).

**Por qué local:** NoofitPro maneja `idTrainer` pero no expone metadata
"información de contacto del centro" para ponerla en formularios web,
emails, etc.

**Lo que necesitamos:** GET `/trainers/{id}/centro` que devuelva esa
metadata. O un campo `metadata` libre por trainer en NoofitPro que
podamos popular nosotros.

---

## 12. Redes sociales (Meta Graph API)

**Estado actual:** tablas `social_cuenta` (token Meta + page_id +
instagram_business_id por trainer) y `social_post` (agenda de
publicaciones programadas), cron `round_social_publish.timer` cada 5 min.

**Por qué local:** Meta Graph es API externa, NoofitPro no tiene nada
parecido.

**Lo que necesitamos:** ningún cambio. Es ortogonal a NoofitPro.

---

## 13. Otros campos del cliente que NoofitPro no devuelve / no persiste

Lista de inspección al objeto que devuelve `getClienteSimple` /
`clientePlusv2`:

| Campo | NoofitPro lo expone | NoofitPro lo persiste en POST |
|---|---|---|
| `id`, `name`, `surname`, `alias` | ✓ | ✓ |
| `email`, `cellPhone` | ✓ | ✓ |
| `dni` | ✓ | ✓ |
| `birthdate` / `age` | ✓ (a veces age=0 — usamos calcEdad como fallback) | ✓ |
| `address`, `town`, `postal_code` | ✓ | ✓ |
| `enabled`, `motivoArchivado` | ✓ | ✓ |
| `gympassId` | ✓ devuelto si lo guardó alguna vez | ✗ **descarta silenciosamente** |
| **`fechaCreacion` / `createdAt`** | ✗ **NO devuelto** | n/a |
| **`fechaUltimaInactivacion`** | ✗ NO | ✗ NO |
| **`categoria`** (gympass/trabajador/invitado) | ✗ NO | ✗ NO |
| `idEspejo` | ✓ | ✓ |
| `editionDate` | ✓ | gestionado por NoofitPro |
| `numTrainings`, `vo2max`, `hrReposo`, etc. | ✓ | ✓ |

**Pedidos prioritarios:**
1. `fechaCreacion` en `getClienteSimple` (sección 2)
2. Persistir `gympassId` en POST (sección 3)
3. Categorías (sección 1)
4. Histórico de inactivaciones (sección 2)

---

## 14. Comportamientos confirmados a documentar

Pequeñas cosas que ya funcionan pero conviene que NoofitPro confirme por
escrito que no van a cambiar:

- `toSend=False` evita el email de bienvenida hardcoded (sección 5).
- `enabled=False` + `motivoArchivado="texto"` en POST = inactivar cliente.
- `enabled=True` + `motivoArchivado=null` en POST = reactivar cliente.
- `getClienteSimple` no requiere idCentro/idTrainer en headers (devuelve
  todos los del manager).
- JWT caduca a ~1h, refrescable con `loginEasy {email, appVersion,
  password=md5}`.

---

## 16. **✅ RESUELTO (06/05/2026) — APNs config OneSignal de mynoofit (iOS)**

**Estado actualizado:** push de prueba `6de449c8-...` enviado a iPhone15
(subscription `353c98e4-...`) → **llegó al device** con app cerrada.
APNs config está OK. La cadena Round → OneSignal → APNs → iPhone funciona.

Causa probable de los fallos previos: app abierta en foreground (iOS
silencia push por defecto) o lag transitorio de APNs.

### (Original — referencia histórica)

**Síntoma:** OneSignal acepta los envíos (`successful: 1` en `platform_delivery_stats.ios`)
pero los pushes **nunca llegan al iPhone** del usuario, aunque:
- El device está suscrito y `enabled: true`, `notification_types: 31`
- iOS Settings → mynoofit → Notificaciones todo activado, sonidos, banners
- App cerrada (foreground silencing descartado)
- Sin Modo concentración / No molestar

**Pruebas reproducidas (06/05/2026):**
- iPhone15,4 iOS 26.3.1, subscription `353c98e4-ced6-47b1-8565-64c2ec572d7f`
- 2 pushes enviados: ambos `successful: 1`, `received: 0`

**Causa probable** (en orden de probabilidad):

1. **Certificado APNs caducado o sandbox/production mismatch.**
   En OneSignal Dashboard de la app `mynoofit` → `Settings → Apple iOS → APNs Authentication`:
   - Si usan **APNs Auth Key (.p8)**: confirmar Team ID + Key ID coinciden con la app build.
   - Si usan **certificado .p12**: caduca cada año. Si está caducado, APNs acepta los
     pushes silenciosamente y los descarta.
2. **Bundle ID mismatch**: el bundle ID de la app firmada debe coincidir
   exactamente con el registrado en el certificado APNs.
3. **App firmada con production pero certificado APNs es de sandbox**
   (o al revés). Producción típica.

**Acción requerida en NoofitPro:**

> Acceder al panel OneSignal de la app `mynoofit` (App ID
> `15462ceb-3d30-492d-9789-215a63c91818`), ir a **Settings → Apple iOS** y
> verificar/regenerar la APNs Auth Key (recomendamos `.p8` que no caduca).
> Confirmar que el Bundle ID y Team ID coinciden con la build de mynoofit
> que tienen los usuarios.

> Test rápido: desde el panel OneSignal hay un botón **"Send Test
> Notification"** en `Audience → Subscriptions → tu device → Send Test`.
> Si ese tampoco llega, es 100% APNs config. Si ese sí llega pero los
> nuestros no, es config Round (avisar a alfonsinmoi).

---

## 15. **✅ RESUELTO (06/05/2026) — OneSignal.login() en mynoofit**

**Estado actualizado:** verificado con device Android real (player
`52fdffad-...`, external_id `1811337`, tags `idTrainer=17675`,
`email=jesus1@rabox.org`). NoofitPro **sí implementa**
`OneSignal.login(idCliente)` y además popula tags útiles
(`idTrainer`, `email`, `platform`).

Solo queda confirmar que también funciona en iOS (el device iPhone15 que
testeamos antes tenía external_id vacío — puede ser que las builds iOS
publicadas todavía no tengan el código, o que el user no haya hecho login
todavía con esa app).

### (Original — mantener como referencia histórica)



**Estado actual:** Round tiene la integración OneSignal completa (App ID, REST
API Key, modal de envío con audiencias, plantillas auto del cron impagos /
PayComet callback / devolución SEPA). Pero **0 pushes a clientes individuales
funcionan** porque NoofitPro **no llama a `OneSignal.login(idCliente)`** en
la app mynoofit.

**Síntoma:** cualquier `enviar_notificacion(audience={tipo:'cliente', ref:X})`
devuelve error `All included players are not subscribed`.

**Causa raíz:** en el dashboard OneSignal de la app `mynoofit` los user
records tienen el campo **External ID vacío**. OneSignal no puede mapear
nuestro `cliente_idnoofit` a ningún dispositivo suscrito.

**Solución (1 línea de código en app mynoofit, donde haga login el user):**

```kotlin
// Android
OneSignal.login(idCliente.toString())     // p.ej. "1779325"
```
```swift
// iOS
OneSignal.login(idCliente.toString())
```
```js
// React Native / Cordova
OneSignal.login(idCliente.toString())
```

Y también `OneSignal.logout()` cuando el user cierra sesión.

**Impacto sin esto:**
- ❌ Round no puede notificar impagos automáticos a clientes
- ❌ Round no puede notificar "pago confirmado" tras callback PayComet
- ❌ Round no puede notificar enlaces de pago
- ❌ Round no puede notificar devoluciones SEPA
- ❌ Round no puede mandar notif manual "un cliente concreto"
- ✅ Solo funciona `broadcast` a todos los suscriptores

**Workaround temporal en producción:** ninguno limpio. Las notif siguen
persistiéndose en BD como `fallida` para auditoría, pero no llegan al móvil.

---

## 17. Webhook NoofitPro → Round (sync de cliente EN TIEMPO REAL)

**Estado actual (junio 2026):** la sincronización NoofitPro → Round es por
**polling**: el cron `round_clientes_sync` (cada hora) + un sync en background
al abrir *Clientes* releen `getClientesByManager`/`getClienteSimple` y vuelcan
`enabled`, `name`, `email`, etc. a `cliente_cache`. Verificado que la relación
**activo/archivado (NP) ↔ activo/inactivo (web)** está consistente (0
discrepancias de `enabled` en 676 clientes), **pero NO es en tiempo real**: si
en NoofitPro se archiva/activa un cliente, la web puede tardar **hasta ~1 h** en
reflejarlo.

> El sentido inverso (Round → NoofitPro) **ya existe**: al programar una baja o
> una inactividad temporal, Round llama a `archivar_cliente`/`reactivar_cliente`
> (`enabled=false/true` + `motivoArchivado`) contra NoofitPro. Lo que falta es el
> **push de NoofitPro hacia Round** para no depender del cron.

**Lo que necesitamos que NoofitPro desarrolle:** un **webhook saliente** que
NoofitPro dispare **cada vez que cambie el estado o los datos de un cliente**,
llamando a un endpoint que Round expondrá. Así la web se actualiza al instante
y el cron horario queda solo como *backstop* de reconciliación.

### Endpoint que Round expondrá (lo implementamos nosotros)

```
POST https://noofit.wiemspro.com/api/webhooks/noofit/cliente
Content-Type: application/json
X-Noofit-Signature: <HMAC-SHA256(body, SECRET) en hex>     # firma del cuerpo
```

- **Seguridad:** secreto compartido por entorno. NoofitPro firma el cuerpo con
  `HMAC-SHA256` usando el secreto; Round valida la firma antes de procesar
  (rechaza 401 si no cuadra). Alternativa mínima aceptable: cabecera
  `X-Noofit-Token: <secreto>` fijo. **Sin firma/token válido → 401.**
- **Respuesta:** `200 {ok:true}` si procesado; Round responde rápido (<500 ms) y
  procesa el upsert. NoofitPro debe **reintentar** (p.ej. 3 intentos con backoff)
  si recibe 5xx o timeout.

### Eventos mínimos

| `event` | Cuándo lo dispara NoofitPro |
|---|---|
| `cliente.archivado` | se pone `enabled=false` (manual o por proceso) |
| `cliente.activado` | se pone `enabled=true` (reactivación) |
| `cliente.creado` | alta de un cliente nuevo |
| `cliente.actualizado` | cambio de nombre/email/teléfono/dni/categoría… |
| `cliente.borrado` *(si existe)* | eliminación real |

### Payload (cuerpo del POST)

```json
{
  "event": "cliente.archivado",
  "timestamp": "2026-06-05T09:14:33+02:00",
  "idManager": 7673,
  "idTrainer": 17675,
  "cliente": {
    "id": 1817691,
    "enabled": false,
    "motivoArchivado": "baja voluntaria",
    "name": "Cristobal",
    "surname": "Garcia Bandera",
    "email": "...",
    "cellPhone": "...",
    "dni": "...",
    "editionDate": "2026-06-05T09:14:33+02:00"
  }
}
```

- **Imprescindible** que venga **`idTrainer`** (y a poder ser `idManager`): Round
  es multi-tenant y necesita saber a qué centro pertenece el cliente para no
  mezclar datos entre trainers. Sin `idTrainer`, Round tendría que resolverlo por
  jerarquía (más frágil).
- Basta con que el objeto `cliente` traiga **al menos `id` + `enabled` +
  `motivoArchivado`**; el resto de campos son bienvenidos para mantener la cache
  completa sin un `getClienteSimple` extra.

### Comportamiento de Round al recibirlo

1. Valida firma/token → 401 si inválida.
2. **UPSERT** en `cliente_cache` por `(id_manager, id)` con el `enabled` y los
   campos recibidos (idempotente — repetir el mismo evento no rompe nada).
3. Registra la transición en `cliente_estado_log` (activo↔inactivo) con fecha y
   motivo.
4. Emite evento interno para refrescar la UI abierta (sin recargar).

### Qué sustituye / convive

- El **webhook da tiempo real**; el cron `round_clientes_sync` pasa a ser un
  **reconciliador** (p.ej. cada 6-12 h) para capturar eventos perdidos (webhook
  caído, reintentos agotados). No se elimina, baja de frecuencia.
- Cierra el último hueco de la regla "estado siempre coherente NP ↔ web":
  hoy coherente con lag de cron; con el webhook, coherente al instante.

> **Relación con la sección 7 (CRM):** este mismo webhook de
> archivar/reactivar permite además sincronizar el CRM Odoo automáticamente
> (mover lead a "baja"/"reactivado") — resuelve el "webhook al
> reactivar/inactivar un cliente" que pedíamos allí.

---

## 18. [INTERNO Round/Odoo — NO es gap NoofitPro] Modelo de facturación: asiento por recibo vs trimestral

> Seguimiento del trabajo de facturación Odoo (junio 2026). No depende de
> NoofitPro; se guarda aquí para retomarlo. **Regla objetivo del dueño:**
> *"cada recibo que se cree (manual o emisión) debe crear el asiento en Odoo;
> la facturación será según el modelo elegido."*

### El "modelo elegido" YA existe como config (pero la emisión no lo respeta)

Campo `manager_config.modo_facturacion` VARCHAR(20) DEFAULT `'recibo_trimestre'`
(UI: **Configuración → Forma de facturar**, `FormaFacturarTab.jsx`;
endpoints `routes/modo_facturacion.py`; checklist `chk_modo_facturacion`). 3 valores:

| valor | Opción UI | Comportamiento previsto |
|---|---|---|
| `recibo_trimestre` *(default)* | 1 · Recibos mensuales + facturación trimestral | recibo BD mensual; **asiento al cierre trimestral** |
| `factura_draft` | 2 · Facturas borrador mensuales + posteo trimestral | account.move **borrador** mensual; postear trimestral |
| `factura_directa` | 3 · Facturación directa mensual | **factura posteada por recibo, al momento** (= la regla del dueño) |

### Qué hace HOY cada pieza (verificado)

- **Emisión mensual** `routes/preemision_v2.generar` → crea filas en `recibo`
  (origen `cron_emision`) **SIN asiento Odoo**. **No mira `modo_facturacion`**
  (siempre se comporta como `recibo_trimestre`).
- `routes/emision_v2.emitir` → crea `account.payment` de los pagados (cobro),
  **no la factura**.
- **Alta de cliente** `odoo_alta.crear_alta_cliente` → SÍ crea factura+pago al
  momento (por eso los 2 únicos asientos de junio Málaga eran de altas).
- **Cierre trimestral** `routes/facturacion_trimestre.facturar` → crea el
  `account.move` (agregado por cliente). **Ya corregido hoy** (ver abajo).
- **Recibo MANUAL** `routes/recibos.py` (INSERT recibo) → **no crea asiento**.

➡️ **Conclusión:** la Opción 3 (`factura_directa`, asiento por recibo al
momento) **NO está implementada**; las Opciones 1/2 dependen del cierre
trimestral. La regla del dueño exige que la creación de recibo (manual +
emisión) cree el asiento según `modo_facturacion`.

### Ya CORREGIDO/HECHO hoy (junio 2026)

- **Identidad manager/trainer por `X-TRAINER_MANAGER`** + anti-fantasma
  (commit `40118d6`). Manager ROUND = 17677; trainers 17674/17675/17676.
- **Devoluciones SEPA acotadas al manager** (`_call_scoped`, `get_cuotas(g.id_manager)`)
  + notif devolución multimanager (commits `2db6cd8`, `32b303e`).
- **`facturacion_trimestre` arreglado** (commit `c1ef2ea`): factura **todos**
  los recibos sin asiento (`pagado`+`impagado`+`devuelto`, no solo pagados);
  **analítica por trainer** del cliente (antes hardcodeada a "Round Málaga
  Centro"); **company del manager** (antes env fijo =3); idempotente por
  `account_move_id`. Frontend muestra impagados + columna Estado.
- **Backfill datos**: 201 asientos `RB-<recibo_id>` de **junio Málaga**
  creados en Odoo (cuenta 700000, IVA 21% tax 171, diario venta, pago para
  pagados). Operación de datos, sin commit. Idempotente; el cierre trimestral
  los salta (ya tienen `account_move_id`).
- Purga del **tenant fantasma 16702** (cuenta NoofitPro ajena de Hugo) +
  archivado de partners huérfanos.

### PENDIENTE (retomar) — implementar la regla "recibo → asiento según modelo"

1. **Helper único** `emitir_recibo_a_odoo(recibo)` idempotente
   (`ref='RB-<recibo_id>'`, salta si ya tiene `account_move_id`): crea el
   `account.move`, lo postea, concilia pago si `estado='pagado'`, fija
   `account_move_id`/`account_move_ref`. Analítica por trainer + company del
   manager (reutilizar `_resolve_analytic_for_partner`, `o.company_id`). Receta
   verificada = la del backfill de junio Málaga.
2. **Enganchar el helper** según `modo_facturacion`:
   - `factura_directa` → al crear recibo **manual** (`recibos.py`) y al
     **emitir** (`preemision_v2`/`emision_v2`): crear factura **posteada** al
     momento.
   - `factura_draft` → crear `account.move` **borrador** mensual; postear en el
     cierre trimestral.
   - `recibo_trimestre` → comportamiento actual (asiento al cierre trimestral).
3. **Fail-soft**: si Odoo está caído, el recibo se crea igual y queda
   pendiente de asiento; un cron de reconciliación reintenta (no romper la
   creación del recibo). Marcar los pendientes para reintento.
4. **Cron de respaldo**: barrer recibos sin `account_move_id` cuyo manager sea
   `factura_directa`/`factura_draft` y crear el asiento que falte (igual que el
   backfill de junio, pero recurrente).
5. **Coherencia**: junio Málaga ya está por-recibo (`factura_directa` de facto);
   abril/mayo seguirían el modelo trimestral. Decidir desde qué periodo aplica
   el modelo nuevo por manager.
6. **Riesgos**: no duplicar (idempotencia por `ref`/`account_move_id`); respetar
   aislamiento (analítica/company por trainer/manager); SII no activo hoy en
   company 3 (verificado), revisar si se activa.

> Relacionado: el **webhook NP→Round (sección 17)** es independiente; aquí es
> facturación interna Round↔Odoo.

---

## 19. Clases/salas NO separadas por centro (trainer)

**Estado (verificado jun 2026):** `getSalasByManagerByRange` /
`getSalasByManager` devuelven **TODAS las clases del grupo bajo
`idTrainer=17675`** (el manager), **aunque consultes con las credenciales de
otro trainer** (probado con `roundanoreta@noofit.com` → mismas 187 clases, todas
`idTrainer=17675`, `idCreador=17675`). Ningún campo del objeto sala distingue el
centro: `idTecnico` (26/27) / `nameTrainer` ("Trainer "/"NooFit") solo separan
**tipo de actividad** (RT vs Ciclo), no el trainer/centro.

**Síntoma:** un trainer (p.ej. Añoreta) ve las clases de Málaga; no se pueden
aislar por centro porque en NoofitPro no están separadas.

**Lo que necesitamos de NoofitPro:**
1. Que cada sala/clase lleve el **`idTrainer` del centro real** al que pertenece
   (Añoreta=17674, Málaga=17675, …), no siempre el del manager.
2. (o) Que `getSalasByManagerByRange` con el token de un trainer devuelva **solo
   las clases de ese trainer**.

**Impacto en la web:** el filtro por `idTrainer` ya existe (proxy
`/api/trainer-data/salas` filtra por el trainer del usuario_web). En cuanto
NoofitPro etiquete las clases por centro, **el aislamiento funciona solo, sin
cambios en la web**. Hasta entonces, un trainer ve 0 (si se filtra) o todas (si
no) — ninguna correcta.

> Mientras tanto, en la web: alinear la ruta de login NoofitPro directo para que
> filtre por el `trainerId` de la sesión (hoy solo filtra el proxy de
> usuario_web); pero no resuelve el problema de fondo (datos no separados).

---

## Resumen ejecutivo (para hablar con NoofitPro)

**Cambios "urgentes" (afectan funcionalidad existente):**
1. **🔴 BLOQUEANTE — APNs config OneSignal de mynoofit (sección 16)**.
   Sin esto NINGÚN push llega a iPhones, ni siquiera con device suscrito y
   permisos correctos. Probable certificado caducado o sandbox/production
   mismatch.
2. **🔴 BLOQUEANTE — Implementar `OneSignal.login(idCliente)` en mynoofit**
   (sección 15 — sin esto el sistema de notificaciones de Round no llega al
   cliente final aunque el push técnicamente funcione).
3. Persistir `gympassId` en `clientePlusv2` POST.
4. Devolver `fechaCreacion` en `getClienteSimple`.
5. Aclarar/eliminar el bloqueo `_MAK` que impide editar clientes sandbox.

**Cambios "evolutivos" (Round los mantiene local mientras tanto):**
4. Categorías de cliente con `puede_reservar` y `tiene_cuota`.
5. Histórico de inactivaciones con motivo y timeline.
6. Plantillas de email configurables (o garantía de `toSend=False`
   permanente).
7. Endpoint de "reserva prueba" que no cree todavía un cliente real.
8. Metadata "centro" por trainer (slug, dirección, mapa).
9. **Webhook NoofitPro → Round (sección 17)**: push en tiempo real al
   archivar/activar/crear/editar un cliente, contra
   `POST /api/webhooks/noofit/cliente` (firmado HMAC). Hoy la web se entera por
   cron horario; el webhook lo haría instantáneo y de paso sincronizaría el CRM.

**No urgentes / no necesarios (Round los gestiona y no necesita
NoofitPro):**
- Pasarela de pago (PayComet por trainer).
- Redes sociales (Meta Graph).
- CRM (Odoo).
- Cobros / cuotas con Odoo (a menos que NoofitPro decida competir con
  el módulo de facturación).
