# Control horario laboral — Fase 1

> Módulo de fichaje de trabajadores en Round. Fase 1 desplegada en producción
> el 2026-05-24. Compatible con `art. 34.9 del Estatuto de los Trabajadores`
> (RD-Ley 8/2019) y preparado para la reforma del RD digital en trámite.

## Visión general

Permite a los managers/trainers gestionar el registro horario de sus
trabajadores. Cumple cinco requisitos legales:

1. **Diario e individualizado** (un evento por trabajador, hora exacta).
2. **Inmutable**: cadena de hashes SHA-256 detecta manipulaciones.
3. **Accesible** al trabajador, representantes y ITSS.
4. **Retención 4 años**: los datos se conservan aunque se cierre la baja.
5. **Sin biometría**: cumple guía AEPD 2023.

El acceso al módulo lo controla el flag `manager_config.control_horario_enabled`.
Se activa por suscripción (en Fase 1 con un botón en la propia web; en Fase 2
llegará por GET desde NoofitPro cuando exista la pasarela de suscripciones).


## Modelo conceptual

```
                ┌───────────────┐
                │  manager (NF) │
                └───────┬───────┘
              tiene N   │
                ┌───────▼───────┐
                │  trainer (NF) │  ← entidad jurídica empleadora
                │ + trainer_    │
                │   empresa     │  CIF, razón social, convenio
                └───────┬───────┘
              emplea N  │
                ┌───────▼────────┐
                │   trabajador   │   NIF, jornada, convenio heredado
                └───────┬────────┘
        ficha en M:N    │
                ┌───────▼──────────┐
                │ trabajador_      │   (varios trainers del mismo manager)
                │   trainer        │
                └───────┬──────────┘
                        │
                ┌───────▼─────────┐
                │ fichaje_evento  │   append-only, hash-chain
                └─────────────────┘
                        │
                ┌───────▼──────────────────┐
                │  correccion_solicitud    │   (flujo trabajador→admin)
                └──────────────────────────┘
```

Decisiones clave:
- **El trainer siempre es el empleador**. Cuando manager y trainer son la
  misma persona/empresa, simplemente coinciden.
- **Un trabajador puede prestar servicios en varios trainers del mismo
  manager**, pero su entidad empleadora es única (`id_trainer_empleador`).
- **Origen "híbrido"** de los trabajadores: NoofitPro propone (cliente con
  categoría `Trabajador`), el admin confirma con los datos laborales (NIF,
  jornada, trainer empleador, fecha alta).


## Tablas (en BD `round_config`)

| Tabla                  | Función                                                              |
|------------------------|----------------------------------------------------------------------|
| `convenio`             | Catálogo global de convenios + manager-specific.                     |
| `trainer_empresa`      | 1:1 con trainer. Razón social, CIF, convenio, overrides.             |
| `trabajador`           | Datos laborales. Estado: `pendiente_alta`/`activo`/`baja`.           |
| `trabajador_trainer`   | Pivote N:M para trabajadores que rotan entre trainers del manager.   |
| `pausa_motivo`         | Catálogo de motivos (globales + manager).                            |
| `fichaje_evento`       | **Append-only**, hash-chain SHA-256, 4 años retención.               |
| `correccion_solicitud` | Solicitudes del trabajador, aprobadas/rechazadas por admin.          |

Y 3 columnas nuevas en `manager_config`:
- `control_horario_enabled BOOLEAN`
- `control_horario_activated_at TIMESTAMPTZ`
- `control_horario_qr_secret TEXT` — HS256 secret para firmar QRs (rotable).

Detalle en `round_config_api/app/db/__init__.py` (búsqueda
`CONTROL HORARIO LABORAL`).


## Hash-chain (integridad)

Cada inserción en `fichaje_evento` calcula:

```
hash = SHA-256( prev_hash || canonical_json(payload) )
```

donde:
- `prev_hash` es el `hash` del último evento del mismo trabajador, recuperado
  con `SELECT ... FOR UPDATE` para serializar inserciones concurrentes.
- `canonical_json` ordena keys, sin espacios, ensure_ascii=false. Si cambias
  los campos del payload, invalidas todas las cadenas existentes — sólo
  hacerlo entre fases versionadas.

Campos que entran en el hash:
- `id_manager`, `trabajador_id`, `id_trainer`, `tipo`, `ts_evento` (ISO-UTC)
- `pausa_motivo_id`, `origen`
- `verificacion_ubicacion`, `qr_origen`, `qr_token_jti`, `qr_clase_id`
- `corrige_evento_id`, `correccion_solicitud_id`, `correccion_motivo`
- `autor_rol`, `autor_usuario_id`, `autor_cliente_idnoofit`

Verificación bajo demanda: `GET /api/horario/verify-chain/<trabajador_id>`.
Devuelve `{ok, total_eventos, primer_evento_inconsistente}`.

> **Roadmap Fase 1.x**: cron mensual que ejecute verify-chain para todos los
> trabajadores activos y alerte si rompe. Hoy se ejecuta sólo bajo petición.


## QR rotativo

Cuando NO hay clase activa en el centro, el manager/trainer muestra un QR
generado on-demand desde la sesión web. El QR es un JWT HS256 con:

```json
{
  "iss": "round-horario",
  "sub": "<id_trainer>",
  "mgr": "<id_manager>",
  "iat": …,
  "exp": iat + 10 min,
  "jti": "<random 12 bytes>"
}
```

Firmado con `manager_config.control_horario_qr_secret` (auto-generado al
activar el módulo, rotable). El frontend autorefresca cada 10 min.

Cuando SÍ hay clase activa, sirve también el QR que NoofitPro ya muestra
para que los alumnos hagan check-in — los trabajadores pueden escanear
cualquiera de los dos. La validación contra NoofitPro de esos tokens está
**pendiente de Fase 1.5** (a esperar que NoofitPro publique el endpoint).

Cuando el trabajador ficha SIN QR (clic "estoy fuera del centro"), el evento
queda con `verificacion_ubicacion = NO`. El admin lo ve marcado en la lista
para revisar si procede.


## Política de correcciones

Dos vías, ambas auditadas:

1. **Trabajador solicita**: `POST /api/horario/correccion` con tipo, ts y
   motivo libre obligatorio. Queda `pendiente` hasta resolución.
2. **Admin directa**: el manager/trainer puede insertar la corrección sin
   pasar por solicitud (caso típico: error que detecta él mismo).

Al aprobar/insertar, se crea un evento nuevo `CORRECCION_INSERT` (o
`CORRECCION_ANULAR`) en `fichaje_evento` con `corrige_evento_id` apuntando al
evento original. **Nunca se borra ni edita el original** — la cadena de
hashes se mantiene íntegra.

El admin que aprueba/rechaza queda registrado en `correccion_solicitud`
(`resuelto_por_usuario_id`, `comentario_resolucion`).


## Endpoints del backend

Detalle de cada uno: [SPEC_API_MYNOOFIT_FICHAJE.md](SPEC_API_MYNOOFIT_FICHAJE.md)
(spec orientada al equipo MAUI) + código en
`round_config_api/app/routes/horario.py` y `horario_fichaje.py`.

Resumen:

### Trabajador (JWT propio `kind='trabajador'`)
- `POST /api/horario/auth/login` (público) — loginEasy NoofitPro + emite JWT propio
- `GET  /api/horario/me`
- `POST /api/horario/fichaje`
- `GET  /api/horario/estado`
- `GET  /api/horario/mi-jornada/hoy`
- `POST /api/horario/correccion`

### Admin (`X-Round-Token` + `@require_feature('control_horario')`)
- `POST /api/horario/activar` / `desactivar`
- `GET  /api/horario/convenios`
- `GET/PUT /api/horario/trainer-empresa/<trainer>`
- `GET/POST/PATCH/DELETE /api/horario/pausa-motivos[/<id>]`
- `GET /api/horario/trabajadores`, `/pendientes`, `POST /trabajadores`, …
- `GET /api/horario/qr-actual/<trainer>` — token JWT del QR, exp 10 min
- `GET /api/horario/eventos` — listado con filtros
- `GET /api/horario/correcciones?estado=…`
- `POST /api/horario/correcciones/<id>/aprobar|rechazar`
- `POST /api/horario/eventos/correccion` — corrección directa admin
- `GET /api/horario/verify-chain/<trabajador_id>`


## Frontend

Nueva entrada en menú lateral "Control horario" (icono Clock), oculta si
`features.control_horario === false`. Si el usuario navega manualmente a
`/control-horario` con módulo desactivado, ve el onboarding con botón
"Activar módulo".

Cinco tabs:
1. **Trabajadores** — sublista de activos / pendientes alta / bajas + modal
   de alta laboral (NIF, jornada, trainer empleador obligatorios).
2. **Fichajes** — filtros (trabajador, trainer, fechas) + exportador CSV.
3. **QR del centro** — selector trainer + QR autorrefrescante cada 10 min.
4. **Correcciones** — bandeja por estado, aprobar/rechazar inline con motivo.
5. **Configuración** — empresa por trainer (CIF, convenio, overrides) +
   catálogo motivos pausa (global + override manager).

Código en `src/pages/ControlHorario/`. Helpers API en `src/utils/horarioApi.js`.


## nginx

Necesita un `location` específico (sin él, los POST caen al servidor estático
y devuelven `405 Not Allowed`):

```nginx
location ^~ /api/horario/ {
    proxy_pass http://127.0.0.1:8095/api/horario/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

Añadido el 2026-05-24 entre `/api/cuotas/` y `/reserva/`. Backup del archivo
pre-cambio en `/root/nginx_bak/noofit.wiemspro.com.pre_horario`.


## Cumplimiento normativo

| Requisito                                           | Cómo lo cumplimos                                       |
|-----------------------------------------------------|---------------------------------------------------------|
| Registro diario individualizado (art. 34.9 ET)      | `fichaje_evento` por trabajador, con timestamp UTC.    |
| Hora exacta inicio / fin                            | Eventos ENTRADA y SALIDA con `ts_evento` ISO-UTC.       |
| Pausas registradas (doctrina TS + AN)               | Eventos PAUSA_INI / PAUSA_FIN con motivo del catálogo.  |
| Identificación individual                           | FK a `trabajador` (NIF obligatorio para activar).       |
| Conservación 4 años                                 | Soft-baja: `estado='baja'`, eventos NO se borran.       |
| Accesible a trabajador                              | `GET /api/horario/mi-jornada/hoy` + `/estado`.          |
| Accesible a representantes / ITSS                   | Pendiente exportador asesoría (Fase 1.5).               |
| Sistema "objetivo, fiable, accesible" (TJUE C-55/18) | Hash-chain SHA-256 + sello temporal UTC + acceso web.   |
| Reforma RD: log inmutable, sellado automático       | Hash-chain ya cumple; sellado en `creado_at`.           |
| Biometría descartada (AEPD nov-2023)                | No tratada. Ni la app ni el backend la usan.            |
| Acuerdo con representantes (art. 34.9 ET)           | Campo `trainer_empresa.fecha_acuerdo_representantes`.   |

> El "informe a asesoría" anual y el exportador para Inspección quedan en
> Fase 1.5. Hoy se puede exportar manualmente vía CSV desde la tab Fichajes.


## Rollback / desactivar el módulo

Bajar el flag sin perder datos:

```bash
curl -X POST -H "X-Round-Token: $TOKEN" -H "X-Round-Manager-Id: 17675" \
  https://noofit.wiemspro.com/api/horario/desactivar
```

Esto pone `control_horario_enabled=false`. Los datos se conservan (cumplimos
los 4 años). Reactivar es POST a `/activar`.


## Roadmap Fase 1.x → Fase 2

Pendientes ordenados por prioridad:

1. Endpoint público `/api/horario/pausa-motivos` con JWT trabajador (hoy
   sólo accesible al admin).
2. Validación QR de clase contra NoofitPro (`origen=clase`).
3. Push notifications:
   - Avisar al trabajador 5 min después del horario teórico si no ha fichado.
   - Notificar al trabajador resolución de su corrección.
4. Cron mensual `verify_chain` para todos los trabajadores activos.
5. Informe asesoría (CSV/PDF) con horas anuales, extras, ausencias.
6. **Fase 2**: turnos planificados, vacaciones, bolsa de horas, multi-firma
   acuerdo representantes.
