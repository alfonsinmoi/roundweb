# Notificaciones Round → mynoofit · Guía para el desarrollador

> Documento técnico para el equipo de desarrollo de la app móvil **mynoofit**.
> Explica cómo se reciben las notificaciones que envía Round, qué metadata
> incluyen, y cómo gestionarlas en la app (agrupado por secciones, iconos,
> deep links, marcar como leído).

## 1 · Visión general

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  Round (manager) — noofit.wiemspro.com                   │
│  Manager crea notificación / cron diario / hooks PayComet+SEPA          │
│  ──────────────►  ENVÍA via OneSignal REST API ────────────────────────►│
└──────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                              OneSignal (App ID mynoofit)
                                         │
                                         ▼  push platform (FCM/APNs)
┌──────────────────────────────────────────────────────────────────────────┐
│   App mynoofit                                                           │
│   1. SDK recibe push → muestra banner del SO                             │
│   2. User abre la notificación                                           │
│   3. App parsea payload.data → enruta a pantalla correspondiente         │
│   4. App llama PUT /api/notif/<id>/leida para marcar como leída         │
└──────────────────────────────────────────────────────────────────────────┘
```

Round nunca habla con la app directamente. Toda la comunicación pasa por
OneSignal. La única llamada que la app hace a Round es marcar leídas.

---

## 2 · Identificación del usuario en OneSignal

**Crítico para que las notificaciones lleguen al cliente correcto.**

Cuando el usuario hace login en mynoofit con sus credenciales NoofitPro,
la app debe llamar a `OneSignal.login()` con el id NoofitPro del cliente:

### Android (Kotlin)

```kotlin
// Después de un login exitoso
OneSignal.login(idClienteNoofit.toString())  // p.ej. "1817155"

// Y al hacer logout
OneSignal.logout()
```

### iOS (Swift)

```swift
// Después de un login exitoso
OneSignal.login(idClienteNoofit.description)

// Y al hacer logout
OneSignal.logout()
```

### React Native / Cordova / Flutter

```js
OneSignal.login(idClienteNoofit.toString())
OneSignal.logout()
```

### Por qué es necesario

Round identifica a los clientes por su id NoofitPro (`getClienteSimple`
devuelve un campo `id` numérico). Cuando enviamos un push a "Carlos
Alcalde id 1817155" decimos a OneSignal:

```json
{ "include_external_user_ids": ["1817155"] }
```

Si la app no llamó a `OneSignal.login("1817155")`, OneSignal no sabe a
qué dispositivo asociar ese id y el push falla con
`'All included players are not subscribed'`.

### Tags adicionales (opcional pero útil)

Si además queremos enviar a segmentos (todos los clientes de un trainer,
todos los Gympass, etc.), pueden setearse tags:

```kotlin
OneSignal.User.addTags(mapOf(
    "idTrainer" to idTrainer.toString(),
    "platform" to "android",
    "centro" to nombreCentro,
))
```

---

## 3 · Estructura del payload que recibe la app

Cuando Round envía una notificación, el payload OneSignal lleva:

```json
{
  "headings": { "en": "...", "es": "Recibo pendiente" },
  "contents": { "en": "...", "es": "Tienes un recibo de 45,00 € pendiente." },
  "url": "https://noofit.wiemspro.com/algo (opcional, deep link)",
  "data": {
    "seccion":   "cobros",
    "tipo":      "impago_efectivo",
    "origen":    "cron_impago",
    "origen_ref":"recibo:1234",
    "envio_id":  87,
    "html":      "<h2>...</h2>... (solo si es noticia con cuerpo HTML)"
  }
}
```

### Campos que la app debe leer del `data`

| Campo | Tipo | Descripción |
|---|---|---|
| `seccion` | string | Una de las 4 secciones (ver §4). Para agrupar/icono. |
| `tipo` | string | Tipo concreto dentro de la sección (ver §5). Para enrutado. |
| `origen` | string | Quién creó la notif. Útil para audit/logs. |
| `origen_ref` | string | Referencia opcional, ej. `"recibo:1234"`, `"invoice:99"`. |
| `envio_id` | int | ID del envío en BD Round. **Necesario** para marcar leída. |
| `html` | string | Cuerpo HTML opcional. Si está, abrir en webview. |

`headings` y `contents` son los textos del banner. iOS y Android los
muestran nativamente sin que la app haga nada.

---

## 4 · Secciones (catálogo fijo)

Round define 4 secciones inmutables. La app debe reconocerlas para
agrupar el inbox de notificaciones por categoría con su icono y color:

| `seccion` | Nombre UI | Icono sugerido | Color | Descripción |
|---|---|---|---|---|
| `cobros` | Cobros | `receipt` (recibo) | `amber` (#F59E0B) | Recibos, devoluciones, enlaces de pago, confirmaciones |
| `clases` | Clases | `calendar` | `blue` (#3B82F6) | Cambios de hora, monitor, cancelaciones |
| `centro` | Centro | `building` | `purple` (#A78BFA) | Cierres, cambios de horario, eventos |
| `noticias` | Noticias | `newspaper` | `green` (#10B981) | Noticias y comunicaciones HTML largas |

**No se añadirán secciones nuevas sin previo aviso.** Si llega una
sección desconocida, la app debe agrupar bajo "Otras" y mostrar un icono
genérico (no fallar).

---

## 5 · Tipos de notificación

Dentro de cada sección, hay tipos concretos. Útil para iconos finos,
priorización, o pantalla destino:

### Sección `cobros`

| `tipo` | Descripción | Auto |
|---|---|---|
| `impago_efectivo` | Recibo efectivo del mes no cobrado el día configurado | Sí, cron diario |
| `devolucion` | Devolución SEPA registrada en Odoo | Sí, webhook |
| `enlace_pago` | Link PayComet generado para pagar | Sí, al alta |
| `pago_alta` | Pago confirmado (callback PayComet OK) | Sí, callback |
| `cobros_otro` | Mensaje libre del manager | Manual |

### Sección `clases`

| `tipo` | Descripción |
|---|---|
| `cambio_hora` | Una clase del cliente cambia de hora |
| `cambio_monitor` | El monitor de una clase cambia |
| `clase_cancelada` | Una clase se cancela |
| `clase_interes` | Información libre relativa a una clase |

### Sección `centro`

| `tipo` | Descripción |
|---|---|
| `cierre` | Cierre / festivo del centro |
| `cambio_horario` | Cambio de horario del centro |
| `evento` | Evento o actividad especial |
| `centro_otro` | Mensaje libre |

### Sección `noticias`

| `tipo` | Descripción |
|---|---|
| `noticia` | Comunicación HTML para webview |

**Manejo de tipos desconocidos:** si llega un `tipo` que no está en este
listado, la app debe usar el icono/comportamiento default de la sección.

---

## 6 · Manejar el click del usuario

Cuando el usuario toca el banner de la notificación, el SDK OneSignal
llama al handler de la app. Comportamiento esperado por sección:

```kotlin
// Pseudocódigo Android (similar en iOS)
when (data["seccion"]) {
    "cobros" -> when (data["tipo"]) {
        "enlace_pago" -> openExternalUrl(data["url"])     // PayComet
        else          -> openCobrosScreen()               // Lista cobros del cliente
    }
    "clases"   -> openClasesScreen(reference = data["origen_ref"])
    "centro"   -> openCentroScreen()
    "noticias" -> openWebView(html = data["html"])        // Cuerpo HTML
    else       -> openInboxScreen()                       // Lista general
}
```

Si la notificación tiene `data.url`, la opción más simple es abrirla con
el navegador in-app o externo. Si tiene `data.html`, abrir un webview
local con ese HTML. Round nunca manda `url` y `html` simultáneamente.

---

## 7 · Marcar como leída (callback hacia Round)

Cuando el usuario abre la notificación, la app debe llamar a Round para
que registremos la lectura. Esto es lo que permite al manager ver
estadísticas de "X de Y leídas".

### Endpoint

```
PUT https://noofit.wiemspro.com/api/notif/<envio_id>/leida?cliente=<idClienteNoofit>
Header: X-Round-Token: <token de servicio>
```

### Parámetros

- `envio_id` (path) — el `data.envio_id` que vino en el payload
- `cliente` (query) — el id NoofitPro del cliente que está abriendo la notif
- `X-Round-Token` (header) — token de servicio compartido (lo damos
  aparte; **no es** el JWT de NoofitPro)

### Respuesta

```json
{
  "ok": true,
  "destinatario_id": 42,
  "leida": true,
  "fecha_lectura": "2026-05-06T17:28:15+00:00"
}
```

### Ejemplo Android

```kotlin
val envioId = data["envio_id"]?.toString() ?: return
val clienteId = currentUserId  // el mismo que pasaste a OneSignal.login()

OkHttpClient().newCall(
    Request.Builder()
        .url("https://noofit.wiemspro.com/api/notif/$envioId/leida?cliente=$clienteId")
        .put("".toRequestBody(null))
        .addHeader("X-Round-Token", BuildConfig.ROUND_TOKEN)
        .build()
).enqueue(callback)
```

Idempotente: si ya estaba marcada como leída, devuelve la fecha existente
sin error. Llamarla varias veces no rompe nada.

---

## 8 · Vista de bandeja en la app (sugerencia UX)

Si quieres construir un inbox de notificaciones en mynoofit:

1. **Almacenar las recibidas localmente** (SQLite/Realm) con todos los
   campos del `data` + el body del push.
2. **Agrupar por sección** con tabs o secciones colapsables. Iconos según
   la tabla del §4.
3. **Marcar leída local** + llamar al endpoint de Round (§7) cuando el
   user toca cada notificación.
4. **Filtrar por tipo** dentro de cada sección con chips (opcional).
5. **Limpiar las "expiradas"**: el campo `fecha_desaparicion` indica
   cuándo Round considera que la notif debe dejar de mostrarse en la
   bandeja. La app la oculta o borra después de esa fecha.

Round **no expone** un endpoint para que la app lea el histórico — cada
push trae su info y la app es la fuente de verdad de la bandeja del
cliente. Lo que sí podemos exponer si os hace falta:

```
GET /api/notif/cliente/<idClienteNoofit>?solo_no_leidas=1&limit=50
```

(devuelve las notif que Round mandó al cliente). Pedidlo si lo
necesitáis para sincronizar tras un install nuevo.

---

## 9 · Datos sensibles · seguridad

- **`X-Round-Token`** que la app usa para `/leida`: lo damos por canal
  seguro. Es el mismo para todos los clientes (es un token de "servicio
  cliente"); no es un JWT por usuario. Si os preocupa exponerlo en la
  app, podemos crear un token por cliente usando el JWT de NoofitPro como
  identidad.
- Round nunca envía datos personales en el payload del push más allá del
  importe / nombre de la clase / título. **No mandamos** nº de tarjeta,
  IBAN, contraseñas ni similar.

---

## 10 · Diagnóstico rápido

### El push no llega

1. Verificar que la app llamó a `OneSignal.login(idCliente)` y que el
   user record en OneSignal Dashboard tiene `external_id` poblado con el
   id NoofitPro.
2. Verificar permisos del SO (`UIApplication.shared.isRegisteredForRemoteNotifications`
   en iOS / `NotificationManagerCompat.from(ctx).areNotificationsEnabled()`
   en Android).
3. En OneSignal Dashboard → `Audience → Subscriptions → buscar el device`
   → ver `enabled: true` y `notification_types > 0`.
4. Si todo lo anterior está OK pero el push sigue sin llegar **en iOS**:
   revisar APNs Auth Key (.p8) en `Settings → Apple iOS`. En Android
   revisar Firebase Server Key.

### `data` no llega o llega vacío

OneSignal solo entrega `data` (`additionalData` en algunos SDKs) si la
app está en background o killed. En foreground, configurar el callback
`OSNotificationWillShowInForegroundHandler` para mostrarla manualmente.

### Marcar leída devuelve 401

`X-Round-Token` mal o ausente. Pedir el token actualizado al equipo de
Round.

### Marcar leída devuelve 400

Falta el query param `?cliente=<id>`. Es obligatorio porque varios
clientes pueden compartir el mismo `envio_id` (envíos masivos).

---

## 11 · Resumen mínimo de implementación

Para que mynoofit funcione bien con las notificaciones de Round, hay que
hacer **3 cosas** en la app:

1. **`OneSignal.login(idCliente)`** después del login NoofitPro y
   **`OneSignal.logout()`** al cerrar sesión.
2. **Leer `notification.additionalData`** cuando llega un push:
   `seccion`, `tipo`, `envio_id`, opcionalmente `url` o `html`.
3. **Llamar a `PUT /api/notif/<envio_id>/leida?cliente=<id>`** cuando el
   user toque la notificación, con header `X-Round-Token`.

Con eso, la bandeja queda viva, el manager ve estadísticas de lectura, y
cada cliente recibe solo lo que va dirigido a él.

---

## Contacto

Cualquier duda: equipo de Round (`calcalde@wiemspro.com` o el chat).
Adjuntar logs OneSignal (`OneSignal.setLogLevel(VERBOSE)` en debug)
cuando reportéis fallos de entrega.
