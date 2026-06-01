# SPEC API mynoofit — Notificaciones (lectura/recepción)

Este documento describe **el único endpoint** que el equipo de mynoofit (app
MAUI) debe consumir para marcar una notificación como leída en el sistema
Round. Análogo al spec de fichaje (`SPEC_API_MYNOOFIT_FICHAJE.md`).

**Versión**: 1.0 — mayo 2026
**Estado**: backend listo y desplegado; pendiente integración en la app.

---

## Contexto

Round envía notificaciones push a los clientes vía OneSignal. Cada
notificación queda registrada en BD en la tabla `notif_destinatario` con
un flag `leida = FALSE`.

Cuando el cliente abre la notificación dentro de mynoofit, la app debe
llamar al endpoint de abajo para que el manager pueda ver en su panel
quién la ha leído y cuándo. Sin esta llamada, la notificación queda
marcada como "no leída" indefinidamente y el panel del gimnasio no puede
medir alcance real.

---

## Endpoint

### `PUT /api/notif/<envio_id>/leida`

**Base URL producción**: `https://noofit.wiemspro.com`

#### Headers

| Header | Valor | Obligatorio |
|---|---|---|
| `X-Round-Token` | El token compartido de servicio que la app ya usa para los otros endpoints públicos de Round (slots, leads). | ✓ |
| `Content-Type` | `application/json` | ✓ si se manda body |

#### Path parameters

| Parámetro | Tipo | Descripción |
|---|---|---|
| `envio_id` | `integer` | Id del envío de notificación. Viene en el payload del push OneSignal en la clave `notif_envio_id`. |

#### Body (JSON) — alternativa A

```json
{
  "cliente": "1818757"
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `cliente` | `string` (id_noofit) | Id de NoofitPro del cliente que está leyendo la notificación. La app ya lo conoce porque está logueada como ese cliente. |

#### Query string — alternativa B (equivalente)

```
PUT /api/notif/15/leida?cliente=1818757&token=<X-Round-Token>
```

(útil para pruebas rápidas con curl; en producción usar headers).

#### Respuesta

**200 OK** (éxito):
```json
{
  "ok": true,
  "id": 42,
  "envio_id": 15,
  "cliente_idnoofit": "1818757",
  "leida": true,
  "fecha_lectura": "2026-05-26T15:42:31.123456+02:00"
}
```

**401 Unauthorized**: token inválido o ausente.
```json
{ "ok": false, "error": "invalid_token" }
```

**400 Bad Request**: falta `cliente`.
```json
{ "ok": false, "error": "cliente_required" }
```

**404 Not Found**: el destinatario (envio_id + cliente) no existe. El
cliente no recibió esa notificación o el `envio_id` es incorrecto.
```json
{ "ok": false, "error": "destinatario_not_found" }
```

---

## Comportamiento del backend

- **Idempotente**: si la notificación ya estaba marcada como leída, el endpoint
  devuelve `200 OK` con los datos actuales. No vuelve a actualizar la fecha
  (`fecha_lectura` queda con el valor de la primera lectura).
- **Audit**: se registra automáticamente en `usuario_web_audit` (evento
  `notif_marcada_leida`).
- **Sin sesión Round**: el endpoint es público (no requiere JWT
  usuario_web ni X-Round-Manager-Id). La identificación es por
  `cliente_idnoofit` + `X-Round-Token`.

---

## Flujo recomendado en la app mynoofit

```
1. La app recibe el push OneSignal.
2. El payload trae extras incluyendo `notif_envio_id`.
3. El usuario abre la notificación (tap).
4. La app navega a su pantalla de notificaciones internas (NotificacionesScreen).
5. Al RENDERIZAR el detalle de una notificación con notif_envio_id, la app
   llama PUT /api/notif/<envio_id>/leida con el cliente_idnoofit actual.
6. Resultado: el manager ve en su panel Round el conteo de leídas.
```

**Importante**: la llamada debe hacerse cuando el usuario realmente ABRE
la notificación (entra a la pantalla de detalle), no al recibir el push
(eso falsearía las métricas).

---

## Cuerpo HTML opcional

Las notificaciones pueden traer un campo `cuerpo_html` adicional al
texto plano. Si está poblado, la app debe abrirlo en una **WebView a pantalla
completa** al pulsar la notificación.

Si `cuerpo_html` está vacío o ausente, la app muestra solo el `cuerpo`
en formato de texto plano.

El backend ya acepta y devuelve el campo `cuerpo_html` en el listado
`/api/notif?cliente_idnoofit=<id>`. La app puede consultarlo:

```
GET /api/notif?cliente_idnoofit=1818757
Headers: X-Round-Token, X-Round-Manager-Id
→ { ok: true, notificaciones: [{ envio_id, titulo, cuerpo, cuerpo_html, url, fecha_envio, leida, fecha_lectura }] }
```

---

## Test rápido

```bash
# Marcar la notificación 15 como leída por el cliente 1818757
curl -X PUT \
  -H "X-Round-Token: <TOKEN_DE_SERVICIO>" \
  -H "Content-Type: application/json" \
  -d '{"cliente": "1818757"}' \
  https://noofit.wiemspro.com/api/notif/15/leida

# Esperado: {"ok": true, "leida": true, "fecha_lectura": "..."}
```

---

## Contacto

Dudas técnicas sobre integración: `c.alcalde@wiemspro.com`.
