# SPEC API mynoofit — Notificaciones del cliente

> Endpoints que la app **mynoofit (MAUI)** debe consumir para login, bandeja e
> histórico de notificaciones del cliente. Análogo a `SPEC_API_MYNOOFIT_FICHAJE.md`.
>
> **Responde a `MYNOOFIT_NOTIFICACIONES_PENDIENTE.md`**: los ítems **#1
> (histórico tras reinstalación)** y **#2 (token por cliente)** **NO requieren
> desarrollo nuevo en el backend — ya existen** (portal de cliente). La app solo
> tiene que migrar a estos endpoints y **eliminar el `BootstrapToken`**.

**Versión**: 2.0 — 2026-06-05 (sustituye a la 1.0, que usaba el token de
servicio compartido). El endpoint legacy `PUT /api/notif/<envio_id>/leida`
(token compartido) queda **deprecado** → usar `POST /api/cliente/notificaciones/{dest_id}/leer`.

> ⚠️ **Base URL: `https://noofit.wiemspro.com`** (NO `round.wiemspro.com`).

---

## 0. Regla de aislamiento (garantizada por el backend)

**Cada manager/trainer se comunica EXCLUSIVAMENTE con SUS clientes.** El JWT del
cliente scopea toda lectura a su `cliente_idnoofit` + `id_manager`; el envío
desde la web está validado server-side y el broadcast se acota por tag
`idTrainer`. **La app no tiene que hacer nada para esto** — solo autenticar con
el JWT de cliente (§1).

---

## 1. Login del cliente → JWT por cliente   [resuelve #2]

Sustituye al `BootstrapToken` global. Credenciales = las **mismas de NoofitPro**
que usa mynoofit.

```
POST /api/cliente/login                 (público, sin token)
Content-Type: application/json
Body: { "email": "...", "password": "...", "id_manager": "<opcional>" }

200 OK:
{
  "ok": true,
  "token": "<JWT kind=cliente · 7 días>",
  "cliente": {
    "cliente_idnoofit": "1817691",
    "id_manager": "17675",
    "nombre": "...", "apellidos": "...", "nombre_completo": "...",
    "email": "...",
    "id_trainer_actual": "17675"
  }
}

401 → credenciales NoofitPro inválidas
404 → cliente_no_encontrado
409 → manager_ambiguo  (el email existe en varios managers; reintentar
                        con "id_manager": "<uno de los managers devueltos>")
```

**Trabajo en la app:**
1. Llamar a `POST /api/cliente/login` en el login y guardar `token` en
   `SecureStorage` (clave `round_token`).
2. Mandar `Authorization: Bearer <round_token>` en TODAS las llamadas a la web.
3. **Borrar `BootstrapToken`** (`RoundNotifService.cs`). Si no hay `round_token`
   → **no** llamar al backend (solo push local); log explícito. Sin fallback
   hardcoded.
4. (Opcional) Ante `401`: relogin → nuevo `round_token`.

---

## 2. Bandeja / histórico del cliente   [resuelve #1]

Todos con `Authorization: Bearer <round_token>`. Scopeados al propio cliente.

### 2.1 Listar
```
GET /api/cliente/notificaciones?solo_no_leidas=0

200 OK:
{
  "ok": true,
  "no_leidas": 3,
  "notificaciones": [{
    "id": 123,                 // dest_id → úsalo para marcar leída
    "envio_id": 456,
    "seccion": "cobros|clases|centro|noticias",
    "tipo": "...",
    "titulo": "...",
    "cuerpo": "...",
    "cuerpo_html": "<p>...</p>",   // = "html" del doc original
    "url": "https://...",          // = "url" del doc original
    "leida": false,
    "fecha_lectura": null,         // ISO-8601 o null
    "fecha": "2026-06-05T09:14:33+00:00"   // fecha de envío (ISO-8601)
  }]
}
```
- Devuelve las **últimas 100 activas**, DESC. Oculta las desaparecidas
  (`fecha_desaparicion` pasada).

### 2.2 Marcar leídas
```
POST /api/cliente/notificaciones/{dest_id}/leer        → { ok, fecha_lectura }
POST /api/cliente/notificaciones/marcar-todas-leidas   → { ok, marcadas: N }
```

### 2.3 Badge
```
GET /api/cliente/buzon-resumen
→ { ok, notificaciones_no_leidas, notas_no_leidas, total_no_leidas }
```

### Sync tras reinstalación (lo que pedía #1)
1. Tras login (ya hay `round_token`): `GET /api/cliente/notificaciones`.
2. Upsert en SQLite por `envio_id` (saltar los existentes); `fecha` →
   `fecha_recibida`, `fecha_lectura` → estado leído.
3. Refrescar `RoundInboxBadgeBus` con `no_leidas` (o `buzon-resumen`).
4. Repetir en pull-to-refresh.

> **Limitación a confirmar:** las **últimas 100 activas**, sin ventana por fechas
> ni paginación (`desde`/`hasta`/`has_more`) ni desaparecidas. Suele bastar para
> el sync de reinstalación. **Si necesitáis paginación/ventana, avisad y lo
> añadimos** (pequeña adición).

### Routing/deep-link (#3, ya hecho en la app)
El objeto trae `url` y `cuerpo_html`: si hay `cuerpo_html`, abrir WebView; si hay
`url`, navegar; si no, cae a la pestaña de `seccion` en `RoundInboxView`.

---

## 3. Peticiones a NP (lado app / OneSignal)

1. **(Opcional, recomendado)** En `OneSignal.login(idCliente)`, además de
   `idTrainer` (ya lo pobláis), añadir el tag **`idManager`**. Permite acotar el
   broadcast de un manager con **un solo filtro** en vez de un OR de sus
   `idTrainer`. Hoy funcionamos con el OR — no es bloqueante.
2. **(Decisión)** Los **broadcast** hoy **no generan filas por destinatario**, así
   que **no entran en el histórico in-app** (§2.1) — solo llegan como push. Si
   queréis que también aparezcan en la bandeja, avisad y persistimos
   destinatarios en el backend.

---

## 4. Estado de los ítems de `MYNOOFIT_NOTIFICACIONES_PENDIENTE.md`

| # | Item | Estado |
|---|------|--------|
| 1 | Histórico tras reinstalación | ✅ **Backend ya listo** → `GET /api/cliente/notificaciones` (§2). App: implementar sync. |
| 2 | Token por cliente (quitar `BootstrapToken`) | ✅ **Backend ya listo** → `POST /api/cliente/login` (§1). App: migrar + borrar hardcoded. |
| 3 | Routing genérico `url`/`html` | ✅ Hecho (app). |
| 4 | Pantallas dedicadas Cobros/Centro | No aplica. |
| 5 | Sub-icono por tipo | ✅ Hecho (app). Campo `tipo`. |

---

## 5. Endpoint legacy (deprecado)

`PUT /api/notif/<envio_id>/leida` con `X-Round-Token` compartido + `{cliente}`
en body **sigue funcionando** pero queda **deprecado** por el riesgo del token
global (#2). Migrar a `POST /api/cliente/notificaciones/{dest_id}/leer` con el
JWT de cliente.

---

## 6. Roadmap

- **Backend web:** nada bloqueante (#1 y #2 en producción). Opcional: paginación
  del histórico (§2) y persistir broadcast (§3.2) si la app lo pide.
- **App release X+1:** borrar `BootstrapToken`; login → `round_token`; sync de
  histórico en login + pull-to-refresh; badge con `buzon-resumen`.
- **App OneSignal:** añadir tag `idManager` (§3.1).

---

## Contacto

Dudas de integración: `c.alcalde@wiemspro.com`.
