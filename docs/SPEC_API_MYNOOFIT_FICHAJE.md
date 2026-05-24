# Spec API — Fichaje de trabajadores desde mynoofit

> Documento dirigido al equipo de mynoofit (MAUI). Última revisión: 2026-05-24.
>
> Estado del backend: **desplegado en producción** (`https://noofit.wiemspro.com`),
> Fase 1 (fichaje + pausas + QR + correcciones). Las funcionalidades de turnos,
> vacaciones, bolsa de horas y push notifications llegarán en Fase 2.

## 0. Resumen para impacientes

1. El usuario se loguea en mynoofit como hace ahora.
2. Si tu app detecta que el cliente pertenece a la categoría "Trabajador" en
   NoofitPro **y** el manager tiene activo el módulo control horario,
   **enseña la pestaña de fichaje**.
3. Para empezar a fichar, llama una vez a `POST /api/horario/auth/login` con
   email y password del usuario. Te devolvemos un JWT propio de Round (no el de
   NoofitPro) — guárdalo en almacenamiento seguro y reenvíalo en el header
   `Authorization: Bearer <jwt>` en todas las llamadas siguientes. Validez: 7 días.
4. Botón principal de la pantalla → `POST /api/horario/fichaje` con un body
   pequeño. El backend decide tipo de evento permitido a partir del estado
   actual (consulta `GET /api/horario/estado`).
5. Si hay QR escaneado, mándalo en el campo `qr_token` (string crudo del QR).
   Si no, lo dejas vacío y el fichaje queda como "sin verificación".

Host: `https://noofit.wiemspro.com`. Todos los paths empiezan por `/api/horario`.


## 1. Auth: login del trabajador

### `POST /api/horario/auth/login`

Headers: ninguno especial (es público).

Body (JSON):
```json
{
  "email": "trabajador@example.com",
  "password": "su-password-noofit",
  "id_manager": "17675"
}
```

`id_manager` es **opcional**. Sólo hace falta si el mismo email aparece en
varios managers (raro, pero posible). Si llega vacío y hay ambigüedad, el
backend responde `409 manager_ambiguo` con la lista de managers candidatos
para que la app vuelva a llamar especificando.

Respuestas:

| Status | Body                                                                                       | Cuándo            |
|-------:|--------------------------------------------------------------------------------------------|-------------------|
| 200    | `{ok:true, token, trabajador:{id,id_manager,cliente_idnoofit,nombre_completo}}`             | OK                |
| 400    | `{ok:false, error:"email_y_password_requeridos"}`                                          | Falta campo       |
| 401    | `{ok:false, error:"credenciales_invalidas"}`                                               | NoofitPro 401     |
| 401    | `{ok:false, error:"noofit_http_500"}` o `noofit_unreachable`                                | Fallo NoofitPro   |
| 403    | `{ok:false, error:"no_eres_trabajador"}`                                                   | Cliente NF sin trabajador asociado |
| 403    | `{ok:false, error:"trabajador_baja"}` / `trabajador_pendiente_alta`                        | Estado no activo  |
| 403    | `{ok:false, error:"feature_not_enabled"}`                                                  | Manager no tiene suscripción |
| 404    | `{ok:false, error:"cliente_no_encontrado"}`                                                | No está en NoofitPro cache |
| 409    | `{ok:false, error:"manager_ambiguo", managers:["17675","17677"]}`                          | Ver arriba        |

Ejemplo OK (200):
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIs…",
  "trabajador": {
    "id": 42,
    "id_manager": "17675",
    "cliente_idnoofit": "8127",
    "nombre_completo": "Ana García López"
  }
}
```

### Renovación del token

El JWT propio dura **7 días**. No hay endpoint de refresh en Fase 1: cuando
caduca, la app vuelve a llamar a `/auth/login`. Guarda las credenciales en
storage seguro de MAUI (SecureStorage) si quieres "recordar usuario".


## 2. Datos del trabajador logueado

### `GET /api/horario/me`

Headers: `Authorization: Bearer <jwt>`

Respuesta 200:
```json
{
  "ok": true,
  "trabajador": {
    "id": 42,
    "id_manager": "17675",
    "cliente_idnoofit": "8127",
    "id_trainer_empleador": "17675",
    "nombre_completo": "Ana García López"
  }
}
```

Útil para pintar nombre en la cabecera y validar que el token sigue vivo.


## 3. Estado actual

### `GET /api/horario/estado`

Headers: `Authorization: Bearer <jwt>`

Respuesta 200:
```json
{
  "ok": true,
  "estado": "dentro",
  "ultimo_evento": {
    "id": 9123,
    "tipo": "ENTRADA",
    "ts_evento": "2026-05-24T07:58:13.412Z",
    "id_trainer": "17675"
  },
  "pausa_motivo_id": null
}
```

`estado` ∈ `"fuera" | "dentro" | "en_pausa"`. Mapea así los botones:

| Estado    | Botones a mostrar                  |
|-----------|------------------------------------|
| `fuera`   | **Entrada**                        |
| `dentro`  | **Iniciar pausa**, **Salida**      |
| `en_pausa`| **Finalizar pausa**, **Salida**    |

Si `pausa_motivo_id` viene, es el id del motivo de la pausa abierta (úsalo
si quieres mostrar "Estás en pausa: Comida" — para resolver el texto del
motivo verás `GET /api/horario/pausa-motivos` en la sección 6).

Llama a este endpoint al entrar a la pantalla de fichaje y tras cada
fichaje exitoso para reconstruir la UI.


## 4. Fichaje

### `POST /api/horario/fichaje`

Headers: `Authorization: Bearer <jwt>`, `Content-Type: application/json`

Body (todos los campos opcionales salvo `tipo`):
```json
{
  "tipo": "ENTRADA",
  "qr_token": "eyJhbGci…",          // si el usuario escaneó un QR
  "pausa_motivo_id": 12,             // sólo en PAUSA_INI
  "lat": 36.7213,                     // opcional, evidencia
  "lng": -4.4214,
  "geo_accuracy_m": 12,
  "origen": "mynoofit",               // por defecto. Otros: "web"
  "app_version": "1.2.3"
}
```

`tipo` debe ser uno de: `ENTRADA`, `SALIDA`, `PAUSA_INI`, `PAUSA_FIN`.

**`qr_token`**: el contenido **crudo** del código QR que el usuario escaneó.
El backend admite dos orígenes:
- **QR del menú del centro** (firmado por nosotros, HS256). Se valida en local
  y el fichaje queda como verificado-en-centro.
- **QR de clase activa de NoofitPro** (se valida contra NoofitPro). _Pendiente
  de integración Fase 1.5; hasta entonces este path responde como no
  verificado pero sigue aceptando el fichaje._

Si **no** hay token, el evento queda registrado pero con
`verificacion_ubicacion: "NO"` (el admin lo verá como "sin verificación").

**`pausa_motivo_id`** es obligatorio para `PAUSA_INI`. Lista los motivos
disponibles con `GET /api/horario/pausa-motivos` (sección 6). Para
`PAUSA_FIN` el backend hereda automáticamente el motivo del `PAUSA_INI`
abierto, así que puedes omitirlo.

**Geolocalización**: completamente opcional. Si la mandas, se guarda como
evidencia adicional pero NO se usa para validar (AEPD-friendly). Pide el
permiso al usuario antes con un texto claro: "Round guardará tu ubicación
como evidencia opcional del fichaje. Puedes denegarlo y seguir fichando."

Respuestas:

| Status | Body                                                                       | Cuándo |
|-------:|----------------------------------------------------------------------------|--------|
| 200    | `{ok:true, evento:{id,tipo,ts_evento,id_trainer,verificacion_ubicacion,hash}}` | OK     |
| 400    | `{ok:false, error:"tipo_invalido", permitidos:[...]}`                       | Tipo no válido |
| 400    | `{ok:false, error:"pausa_motivo_requerido"}`                                | PAUSA_INI sin motivo |
| 401    | `{ok:false, error:"missing_token"}` / `invalid_token`                       | JWT mal/expirado |
| 403    | `{ok:false, error:"trabajador_baja"}` / `feature_not_enabled`               | Cuenta deshabilitada |
| 409    | `{ok:false, error:"transicion_invalida", estado_actual, tipo_solicitado}`   | Ej. PAUSA_FIN sin PAUSA_INI |

Ejemplo OK:
```json
{
  "ok": true,
  "evento": {
    "id": 9124,
    "tipo": "ENTRADA",
    "ts_evento": "2026-05-24T08:01:02.001+00:00",
    "id_trainer": "17675",
    "verificacion_ubicacion": "QR",
    "hash": "a4b9c7…"
  }
}
```

### Sobre el 409 `transicion_invalida`

El backend rechaza secuencias imposibles (ej. dos ENTRADA seguidas, o
PAUSA_FIN sin PAUSA_INI). Muestra al usuario:
> "Tu último fichaje fue {tipo} el {ts}. No puedes hacer {tipo_solicitado}
> ahora. Si crees que es un error, pide una corrección al administrador."

Y enlaza al endpoint de corrección (sección 5).


## 5. Solicitar corrección

### `POST /api/horario/correccion`

Headers: `Authorization: Bearer <jwt>`

Body:
```json
{
  "tipo_propuesto": "SALIDA",
  "ts_propuesto": "2026-05-23T18:00:00+02:00",
  "pausa_motivo_id": null,
  "corrige_evento_id": 9100,
  "motivo": "Me olvidé fichar la salida ayer"
}
```

`tipo_propuesto` ∈ `ENTRADA | SALIDA | PAUSA_INI | PAUSA_FIN | ANULAR`. Usa
`ANULAR` cuando el trabajador necesita anular un evento mal hecho (ej.
una ENTRADA duplicada).

`corrige_evento_id` es opcional. Si corrige un evento concreto (anular o
sustituir), pásalo. Si añade uno nuevo que faltaba, déjalo `null`.

`motivo` es obligatorio (mínimo 1 char). Pídeselo al usuario en un textarea.

Respuesta 200:
```json
{
  "ok": true,
  "solicitud": {
    "id": 71,
    "estado": "pendiente",
    "created_at": "2026-05-24T08:10:00+00:00"
  }
}
```

La solicitud queda **pendiente** hasta que el administrador la apruebe o
rechace desde la web. El trabajador no tiene endpoint para listar sus
propias solicitudes en Fase 1 (planificado para Fase 2 + push notifications).


## 6. Catálogo de motivos de pausa

### `GET /api/horario/pausa-motivos`

> **Nota:** este endpoint requiere `X-Round-Token` (token de admin) en la
> versión actual del backend. Para mynoofit hace falta exponer una variante
> autenticada con JWT de trabajador. **TODO Fase 1.1.**
>
> Mientras tanto, embebe en mynoofit la lista por defecto (sembrada en
> backend para todos los managers):
>
> | codigo            | etiqueta                              | computa_jornada |
> |-------------------|---------------------------------------|-----------------|
> | comida            | Comida                                | false           |
> | descanso_corto    | Descanso corto / café                 | true            |
> | descanso_obligat  | Descanso obligatorio (art. 34.4 ET)   | true            |
> | medico            | Asuntos médicos                       | false           |
> | personal          | Asuntos personales                    | false           |
> | otros             | Otros                                 | false           |
>
> Cuando el endpoint público esté disponible, sustituye el hardcode por
> la llamada.


## 7. Errores comunes y manejo

| Error backend                | Qué mostrar al usuario                                   | Acción de la app |
|------------------------------|----------------------------------------------------------|------------------|
| `missing_token` / `invalid_token` | "Tu sesión ha caducado. Vuelve a entrar."           | Borrar token y enviar a /auth/login |
| `feature_not_enabled`        | "Tu centro no tiene activado el control horario."        | Ocultar la pestaña de fichaje |
| `trabajador_baja`            | "Tu cuenta está dada de baja. Contacta con tu manager."  | Bloquear UI |
| `transicion_invalida`        | "No puedes {tipo} ahora. Tu último estado fue {estado_actual}." | Refrescar `/estado` y rehacer botones |
| `noofit_unreachable`         | "No podemos contactar con NoofitPro. Reintenta."         | Botón "Reintentar" |
| 5xx                          | "Error temporal. Reintentaremos automáticamente."       | Reintento exponencial (max 3) |


## 8. Pantallas mínimas en mynoofit

1. **Login del trabajador** (si todavía no lo está). Reutiliza el flujo de
   loginEasy de mynoofit estándar; tras el OK, llama a nuestro
   `/api/horario/auth/login` con las mismas credenciales para obtener el JWT
   de Round.
2. **Pantalla principal** con:
   - Cabecera: nombre del trabajador, centro actual (`id_trainer` del último
     evento) y hora actual.
   - Estado grande: "FUERA" / "DENTRO" / "EN PAUSA" con color (gris / verde /
     ámbar).
   - Botón principal según estado (ver sección 3).
   - Botón secundario "Escanear QR del centro" → abre cámara → al leer un
     QR, autorrelena `qr_token` y al fichar lo envía.
   - Pie: "Mi jornada de hoy" — opcional en Fase 1; pide al backend con
     `GET /api/horario/mi-jornada/hoy` (mismo header, devuelve eventos del
     día + totales).
3. **Modal "Solicitar corrección"** con campos tipo, fecha/hora, motivo,
   botón enviar.


## 9. Push notifications

> **Fuera de Fase 1.** El backend tiene placeholders pero no envía pushes
> todavía. Cuando estén, los eventos que dispararán push son:
>
> - Trabajador olvidó fichar (5 min después del horario teórico).
> - Solicitud de corrección aprobada / rechazada por el admin.
> - Su jornada va a expirar (10 min antes de la salida según turno).
>
> Documento aparte cuando llegue.


## 10. Endpoint base + autenticación de servicio

Para mynoofit:
- **Host**: `https://noofit.wiemspro.com`
- **Base path**: `/api/horario`
- **Auth**: header `Authorization: Bearer <jwt-round-horario>` para los
  endpoints del trabajador. Sólo `/auth/login` es público.

Para los endpoints de admin (los que ve la web NoofitPro), la autenticación
es `X-Round-Token` + `X-Round-Manager-Id`, NO se usa desde mynoofit.


## 11. Roadmap inmediato (Fase 1.x)

| # | Pendiente backend                                              | Bloquea a mynoofit |
|---|-----------------------------------------------------------------|--------------------|
| 1 | Endpoint público `/pausa-motivos` con JWT trabajador            | Listar motivos sin hardcode |
| 2 | Validar QR de clase contra NoofitPro                            | QR verificado en clase |
| 3 | Push notifications (5 min sin fichar, correcciones resueltas)   | Avisos automáticos |
| 4 | Endpoint para listar solicitudes propias del trabajador         | UI "mis correcciones" |

Si necesitas algo más para arrancar el desarrollo en MAUI, abre issue o
escribe a calcalde@wiemspro.com.
