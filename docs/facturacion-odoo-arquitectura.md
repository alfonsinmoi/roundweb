# Sistema de facturación Round — Documento de arquitectura

> Versión 1.0 · Mayo 2026
> Estado: **borrador para validación** antes de implementación.
> Basado en sesión de descubrimiento de 19 preguntas/respuestas.

---

## 0. Resumen ejecutivo

Sistema de facturación construido sobre **Odoo Community 17** alojado en el VPS de Round (`212.227.40.122`), integrado con **NoofitPro / mynoofit** vía un **MCP** (Master Control Program) que orquesta la sincronización en ambos sentidos.

**Reparto de responsabilidades:**

- **NoofitPro** — fuente de verdad: clientes, cuotas asignadas, descuentos, IBAN, control de accesos a clases.
- **Odoo** — ejecutor financiero: emite recibos, gestiona SEPA, devoluciones, tarjeta tokenizada, contabilidad.
- **MCP** — orquestador: traduce eventos entre los dos sistemas y mantiene la coherencia.

**Volumen objetivo**: <300 clientes en el POC, escalable a >3000 por gimnasio.

**Esfuerzo estimado**:
- Documento (este) → 1-2 días.
- POC (Odoo + cliente real + recibo SEPA exportado) → 1-2 semanas.
- MVP funcional (alta + emisión + cobranza SEPA + 1 pasarela sandbox) → 4-8 semanas.
- Producción robusta → +3-6 meses.

**Sin plazo objetivo fijo**, el proyecto avanza sin presión temporal.

---

## 1. Arquitectura general

```
┌────────────────────────────────────────────────────────┐
│                    NoofitPro / mynoofit                │
│                                                        │
│   FUENTE DE VERDAD del cliente comercial:              │
│   - Datos personales, DNI, IBAN                        │
│   - Cuota asignada (catálogo en NoofitPro)             │
│   - Descuentos activos (catálogo en NoofitPro)         │
│   - Modificaciones de recibo con vigencia              │
│   - Control de accesos a clases (límites de reserva)   │
│                                                        │
│   ──── webhook (síncrono, token+HMAC) ────────┐        │
│                                                │        │
│   ◄─── push a cliente vía servicio noofit ────┤        │
└──────────────────┬─────────────────────────────┴────────┘
                   │
                   ▼ Eventos (cliente.alta, cuota.cambio, …)
┌──────────────────────────────────────────────────────┐
│                       MCP                            │
│   - Orquestador entre NoofitPro y Odoo               │
│   - Recibe webhooks de NoofitPro                     │
│   - Llama a Odoo via XML-RPC                         │
│   - Polling de Odoo (cada 30 min) para detectar      │
│     cobros confirmados, devoluciones, impagos        │
│   - Cron diario nocturno de reconciliación           │
│                                                      │
│   Reside en: 217.154.17.133 (servidor MCP existente) │
│   o nuevo subdominio en este VPS                     │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼ XML-RPC / REST API
┌──────────────────────────────────────────────────────┐
│              Odoo Community 17                       │
│              en VPS Round (puerto 8069)              │
│                                                      │
│   EJECUTOR FINANCIERO:                               │
│   - res.partner (cliente, cruzado por DNI)           │
│   - account.analytic.account (trainer/centro)        │
│   - subscription.subscription (cuota cliente)        │
│   - account.move (recibos / facturas)                │
│   - account.payment (cobros)                         │
│   - account.bank.statement (extractos)               │
│   - sale.payment.gateway (Redsys / Paycomet por TPV) │
│                                                      │
│   - PostgreSQL local                                 │
│   - Backups cifrados nocturnos                       │
└──────────────────────────────────────────────────────┘
```

**Direcciones de flujo:**

```
1. NoofitPro → Odoo (REACTIVO, webhook síncrono):
   alta cliente, cambio cuota, descuento, modificación, baja, etc.

2. Odoo → NoofitPro (POLLING, cada 30 min - 1 h):
   cobro confirmado, devolución SEPA, impago, suspender, reactivar

3. RECONCILIACIÓN (cron diario, 04:00):
   - Comparar clientes activos NoofitPro vs Partners Odoo (cruce DNI)
   - Detectar deriva: clientes en uno no en otro
   - Detectar suscripciones huérfanas, mandatos vencidos, recibos sin notificar
   - Alertar al MCP log + email administrador
```

---

## 2. Decisiones cerradas

| # | Bloque | Decisión |
|---|---|---|
| 1 | Push mynoofit | Servicio noofit existente con HTML |
| 2 | Banco SEPA | Banco Santander |
| 3 | Pasarela tarjeta | Redsys + Paycomet (sandbox + simulación inicial) |
| 4 | Volumen POC | <300 clientes, escalable a 3000+ |
| 5 | Migración | Big bang vía Excel/ORP con asistencia de Claude |
| 6 | Plazo | Sin presión temporal |
| 7 | Equipo | Asistente IA monta, gestor controla Odoo |
| 8 | Edición Odoo | Community 17 (gratis, suficiente para arrancar) |
| 9 | Hosting Odoo | VPS Round (puerto 8069), aprovecha 7,7 GB RAM, 6 cores, 215 GB disco |
| 10 | Modelo empresa | 1 SL = 1 BD Odoo. Multi-empresa **preparada** para futuras SL |
| 11 | Trainers | Cuenta analítica por trainer dentro de la SL (mismo CIF) |
| 12 | Pasarela por trainer | Mismo CIF, distintos comercios (TPV virtual) Redsys/Paycomet |
| 13 | Multi-tenant a nivel plataforma | 1 instancia Odoo por SL cliente nuestra |
| 14 | Catálogo cuotas | NoofitPro = fuente de verdad |
| 15 | Catálogo descuentos | NoofitPro = catálogo predefinido |
| 16 | Mapeo cuota↔actividad | Tabla 1:N en NoofitPro |
| 17 | Control límites reservas | NoofitPro (Odoo solo factura) |
| 18 | Modificaciones recibos | Vigencia desde/hasta en NoofitPro, secuencia aplicada al recibo |
| 19 | Mandato SEPA | Click + log (timestamp + IP + UA) en mynoofit, sin eIDAS por ahora |
| 20 | Forma de pago domiciliada | Tarjeta tokenizada **o** SEPA — elección del cliente |
| 21 | Enlace de pago | Caja, efectivo, reintentos tras devolución, cargos extra |
| 22 | Flujo POC | SEPA prioritario, tarjeta tokenizada **simulada** hasta credenciales reales |
| 23 | Revisión impagados | Mensual en NoofitPro antes de emitir nueva remesa |
| 24 | Webhook NoofitPro→Odoo | Reactivo, autenticación token + HMAC-SHA256 |
| 25 | Watchdog Odoo→NoofitPro | Polling (opción A); webhook reactivo (C) **guardado para fase futura** |

---

## 3. Modelo de datos en Odoo

### 3.1 Modelos estándar reutilizados

| Modelo | Uso |
|---|---|
| `res.partner` | Cliente final (campo `vat` = DNI, `id_noofit` extendido) |
| `res.company` | Empresa = una por SL |
| `account.analytic.account` | **Una por trainer/centro** dentro de la SL |
| `product.template` | Cada cuota del catálogo NoofitPro espejada como producto |
| `subscription.subscription` (módulo Odoo) | Suscripción del cliente con su cuota |
| `account.move` | Recibos / facturas |
| `account.payment` | Cobros confirmados |
| `account.bank.statement.line` | Conciliación bancaria |
| `mandate.mandate` (módulo `account_banking_mandate`) | Mandato SEPA del cliente |

### 3.2 Modelos custom (módulo `round_facturacion`)

```python
# round_facturacion/models/round_cuota_catalogo.py
class RoundCuotaCatalogo(models.Model):
    """Espejo del catálogo de cuotas que vive en NoofitPro.
    Sincronizado al alta de cuota o al primer cliente que la use."""
    _name = 'round.cuota.catalogo'

    codigo = fields.Char(required=True, index=True)       # 'RT 1D', 'I MYGYM', ...
    descripcion = fields.Char()
    precio_mensual = fields.Float()
    precio_trimestral = fields.Float()
    precio_semestral = fields.Float()
    precio_anual = fields.Float()
    matricula = fields.Float(default=0.0)
    actividades_descripcion = fields.Char()                # Texto libre de NoofitPro
    company_id = fields.Many2one('res.company')
    activo = fields.Boolean(default=True)


# round_facturacion/models/round_descuento_catalogo.py
class RoundDescuentoCatalogo(models.Model):
    """Espejo del catálogo de descuentos de NoofitPro."""
    _name = 'round.descuento.catalogo'

    codigo = fields.Char(required=True, index=True)        # 'DESC_FAMILIA', 'DESC_EMPLEADO', ...
    descripcion = fields.Char()
    tipo = fields.Selection([
        ('porcentaje', 'Porcentaje'),
        ('importe', 'Importe fijo'),
    ])
    valor = fields.Float()
    company_id = fields.Many2one('res.company')


# round_facturacion/models/round_modificacion_recibo.py
class RoundModificacionRecibo(models.Model):
    """Modificación de precio con vigencia desde/hasta. Se aplica a los recibos
    cuyo periodo_inicio cae dentro del rango."""
    _name = 'round.modificacion.recibo'

    suscripcion_id = fields.Many2one('subscription.subscription', required=True)
    fecha_desde = fields.Date(required=True)
    fecha_hasta = fields.Date()                            # null = indefinido
    tipo = fields.Selection([
        ('descuento', 'Descuento'),
        ('cargo_extra', 'Cargo extra'),
        ('precio_alternativo', 'Precio alternativo'),
    ])
    valor = fields.Float()
    razon = fields.Char()
    autorizado_por = fields.Many2one('res.users')


# round_facturacion/models/round_log_webhook.py
class RoundLogWebhook(models.Model):
    """Log de cada webhook recibido para trazabilidad y reintentos."""
    _name = 'round.log.webhook'

    direccion = fields.Selection([
        ('entrada', 'NoofitPro → Odoo'),
        ('salida',  'Odoo → NoofitPro'),
    ])
    evento = fields.Char()                                  # 'cliente.alta', etc.
    payload = fields.Text()
    estado = fields.Selection([
        ('pendiente', 'Pendiente'),
        ('procesado', 'Procesado'),
        ('error',     'Error'),
    ])
    error_msg = fields.Text()
    create_date = fields.Datetime()
    procesado_at = fields.Datetime()
```

### 3.3 Extensiones a modelos estándar

```python
# Extensión de res.partner
class ResPartner(models.Model):
    _inherit = 'res.partner'

    id_noofit = fields.Char(index=True)                     # ID estable de NoofitPro
    trainer_analytic_id = fields.Many2one(
        'account.analytic.account',
        string='Trainer / centro'
    )                                                        # Etiqueta analítica del trainer
    estado_facturacion = fields.Selection([
        ('activo',     'Activo'),
        ('suspendido', 'Suspendido por impago'),
        ('baja',       'Baja'),
    ], default='activo')
    fecha_baja = fields.Date()


# Extensión de subscription.subscription
class Subscription(models.Model):
    _inherit = 'subscription.subscription'

    cuota_codigo = fields.Char(index=True)                  # Código del catálogo NoofitPro
    forma_pago = fields.Selection([
        ('sepa',           'SEPA'),
        ('tarjeta_token',  'Tarjeta tokenizada'),
        ('enlace_pago',    'Enlace de pago'),
    ], required=True)
    mandato_id = fields.Many2one('account.banking.mandate')
    token_tarjeta = fields.Char()                            # Solo si tarjeta_token
    pasarela_id = fields.Many2one('round.pasarela.config')
    descuentos_activos_ids = fields.Many2many(
        'round.descuento.catalogo'
    )


# Configuración de pasarela por trainer/centro
class RoundPasarelaConfig(models.Model):
    _name = 'round.pasarela.config'

    nombre = fields.Char(required=True)
    analytic_id = fields.Many2one(
        'account.analytic.account',
        required=True
    )                                                        # Vinculado a trainer/centro
    proveedor = fields.Selection([
        ('redsys',    'Redsys'),
        ('paycomet',  'Paycomet'),
    ])
    fuc = fields.Char()                                      # FUC en Redsys
    terminal = fields.Char()
    secret_key = fields.Char()                               # Cifrado
    sandbox = fields.Boolean(default=True)
```

---

## 4. Catálogo de eventos del MCP

### 4.1 NoofitPro → MCP → Odoo (webhook síncrono)

| # | Evento | Payload mínimo | Acción Odoo |
|---|---|---|---|
| 1 | `cliente.alta` | datos personales, DNI, IBAN, cuota, descuentos, periodicidad, mandato | crea `res.partner` + `subscription.subscription` + `mandate` + recibo inicial |
| 2 | `cliente.modificado` | id_noofit, campos cambiados | actualiza `res.partner` |
| 3 | `cliente.iban_actualizado` | id_noofit, nuevo IBAN, log mandato | revoca mandato anterior, crea uno nuevo |
| 4 | `cliente.baja` | id_noofit | cierra todas las suscripciones, marca partner `estado=baja` |
| 5 | `cuota.asignada` | id_noofit, código cuota, periodicidad, descuentos | crea suscripción adicional |
| 6 | `cuota.cambio` | id_noofit, código antiguo, código nuevo | cierra suscripción antigua, abre nueva |
| 7 | `cuota.baja` | id_noofit, código cuota | cierra suscripción específica |
| 8 | `modificacion.creada` | id_noofit, suscripción, fecha desde/hasta, tipo, valor, razón | crea `round.modificacion.recibo` |
| 9 | `modificacion.eliminada` | id_modificacion | elimina/revoca |
| 10 | `descuento.activado` | id_noofit, código descuento, fecha desde | añade a `descuentos_activos_ids` |
| 11 | `descuento.desactivado` | id_noofit, código descuento, fecha hasta | retira |

### 4.2 Odoo → MCP → NoofitPro (polling, A)

| # | Evento | Disparo en Odoo | Acción en NoofitPro |
|---|---|---|---|
| 12 | `recibo.cobrado_tarjeta` | webhook Redsys/Paycomet recibido y conciliado | push HTML "tu pago de XX € se ha registrado" + estado al día |
| 13 | `recibo.cobrado_sepa` | extracto bancario importado, recibo conciliado | idem (después del polling, cliente avisa "se registrará en próximas horas") |
| 14 | `recibo.impagado` | recibo `account.move` lleva N días sin conciliar tras emisión | marca cliente como pendiente revisión en NoofitPro |
| 15 | `recibo.devolucion_sepa` | extracto banco con código R-transaction (AC04, MD01, MS03…) | marca recibo como devuelto + push "tu cuota fue devuelta, regulariza" |
| 16 | `cliente.suspender` | gestor lo decide en NoofitPro tras revisión mensual de impagados | bloquea reservas en NoofitPro (esto es bidireccional: gestor decide en Noofit y Odoo cierra la suscripción) |
| 17 | `cliente.reactivar` | pago regularizado | desbloquea reservas |

> **Nota**: 16 y 17 son técnicamente decisiones del gestor en NoofitPro que se reflejan en Odoo (no al revés). El polling de Odoo solo informa a NoofitPro de cobros y devoluciones; las decisiones de bloqueo/desbloqueo las toma siempre el gestor humano en NoofitPro.

### 4.3 Contrato del webhook (NoofitPro → MCP)

```
POST https://mcp.round.wiemspro.com/eventos/{evento}
Headers:
  Content-Type: application/json
  X-Webhook-Token: <secreto compartido>
  X-Webhook-Signature: sha256=<HMAC-SHA256(body, secreto)>
  X-Webhook-Id: <UUID único>
  X-Webhook-Timestamp: <ISO8601>

Body (ejemplo cliente.alta):
{
  "evento": "cliente.alta",
  "timestamp": "2026-05-01T11:30:00Z",
  "manager":  "Roundgestion@noofit.com",
  "trainer":  "roundmalagacentro@noofit.com",
  "cliente": {
    "id_noofit":      1811337,
    "dni":            "12345678A",
    "nombre":         "Juan",
    "apellidos":      "García López",
    "email":          "juan@email.com",
    "movil":          "612345678",
    "fecha_alta":     "2026-05-01"
  },
  "cuota": {
    "codigo":         "RT 1D",
    "descripcion":    "RT 1 Día/semana",
    "periodicidad":   "mensual",
    "importe_base":   10.00,
    "matricula":      0
  },
  "descuentos": [
    { "codigo": "DESC_FAMILIA", "valor": 10, "tipo": "porcentaje" }
  ],
  "modificaciones": [],
  "forma_pago": {
    "tipo":           "sepa",
    "iban":           "ES1234567890123456789012",
    "mandato": {
      "fecha_firma":  "2026-05-01T11:29:55Z",
      "ip":           "85.55.X.X",
      "user_agent":   "mynoofit-android/4.2.1"
    }
  }
}

Respuesta 200:
{
  "ok": true,
  "id_evento_odoo": "abc123"
}

Respuesta 4xx/5xx:
{
  "ok": false,
  "error": "...",
  "retry_after_seconds": 60      // sugerencia para NoofitPro
}
```

---

## 5. Flujos clave

### 5.1 Alta de cliente nuevo

```
[Cliente abre mynoofit, escanea QR de su trainer]
       ↓
[mynoofit muestra formulario: DNI, IBAN, cuota, descuentos, periodicidad]
       ↓
[Cliente acepta el cobro → click + log guardado en NoofitPro]
       ↓
[NoofitPro guarda cliente con estado "pendiente alta facturación"]
       ↓
[NoofitPro POST /mcp/eventos/cliente.alta con todo el payload]
       ↓
[MCP valida HMAC, persiste log, llama Odoo via XML-RPC:]
       ├─ buscar/crear res.partner por DNI
       ├─ asignar trainer_analytic_id según el `trainer` del payload
       ├─ buscar/crear round.cuota.catalogo si no existe
       ├─ crear subscription.subscription
       ├─ crear mandate.mandate (si SEPA) con log de firma
       ├─ generar primer recibo (account.move) con fecha actual
       └─ si forma_pago = 'enlace_pago': generar URL Redsys/Paycomet
       ↓
[MCP devuelve 200 a NoofitPro con id_evento]
       ↓
[NoofitPro marca cliente como "alta facturación OK"]
       ↓
[NoofitPro envía push HTML al cliente: "Bienvenido, tu primer recibo de XX € se cargará el día Y"]
```

### 5.2 Emisión mensual SEPA

```
[Día 25 de cada mes - cron Odoo a las 06:00]
       ↓
[Odoo recorre suscripciones activas con forma_pago = sepa]
  Para cada una:
    ├─ calcular precio del recibo:
    │   importe_base
    │   - aplicar descuentos activos del cliente
    │   - aplicar modificaciones de recibo activas (vigencia incluye este periodo)
    │   - sumar cargos extra puntuales
    └─ crear account.move con líneas
       ↓
[Generar fichero SEPA pain.008 con todos los recibos del mes]
       ↓
[Subir manualmente o vía API banco Santander]
       ↓
[Días siguientes: banco procesa, devuelve fichero R-transactions]
       ↓
[Odoo importa extracto y concilia recibos]
       ↓
[MCP polling cada hora detecta cambios de estado]
       ├─ recibos cobrados → push OK al cliente
       └─ devoluciones → push de regularización + cola "para revisión"
```

### 5.3 Cobro recurrente con tarjeta tokenizada

```
[Día 1 de cada mes - cron Odoo]
       ↓
[Odoo recorre suscripciones con forma_pago = tarjeta_token]
  Para cada una:
    ├─ recuperar token guardado
    ├─ POST a Redsys/Paycomet con token + importe
    └─ recibir respuesta:
       ├─ OK    → marcar recibo cobrado
       ├─ KO    → marcar pendiente, programar reintento o conversión a enlace
       └─ token expirado → marcar pendiente, push al cliente "renueva tarjeta"
       ↓
[MCP polling detecta cambios y notifica NoofitPro]
```

### 5.4 Devolución SEPA

```
[Banco notifica devolución (extracto diario)]
       ↓
[Odoo importa extracto, marca account.move como devuelto, código R]
       ↓
[MCP polling detecta y notifica NoofitPro]
       ↓
[NoofitPro marca cliente como "pendiente revisión"]
       ↓
[NoofitPro envía push: "tu pago de mayo fue devuelto, regulariza desde mynoofit"]
       ↓
[Antes de la siguiente emisión mensual:]
  Gestor revisa lista en NoofitPro y decide cliente por cliente:
    ├─ reenviar SEPA (incluir en próxima remesa)
    ├─ cambiar a enlace de pago / tarjeta
    ├─ baja del cliente
    └─ negociar plazo
       ↓
[NoofitPro dispara webhooks correspondientes a Odoo]
```

### 5.5 Sincronización diaria

```
[Cron MCP 04:00]
       ↓
[GET /api/dispositivos/getClienteSimple → todos los clientes activos NoofitPro]
       ↓
[Listar todos los res.partner activos en Odoo con id_noofit]
       ↓
[Comparar por DNI:]
  ├─ Clientes en NoofitPro y NO en Odoo → log alerta + crear partner stub
  ├─ Partners en Odoo con DNI no en NoofitPro → log alerta (¿cliente borrado en Noofit?)
  ├─ Datos divergentes (email, teléfono cambió en Noofit) → actualizar Odoo
  └─ Estado divergente (Noofit dice "baja", Odoo dice "activo") → log alerta
       ↓
[Email diario al admin con resumen: N nuevos, N actualizados, N alertas]
```

---

## 6. Plantillas push (HTML)

Aprovechando el servicio noofit que admite HTML, las plantillas tienen estilos sutiles. Variables interpoladas en `{{ }}`.

### 6.1 Eventos y plantillas propuestas (a revisar contigo)

| Evento | Asunto | Cuerpo |
|---|---|---|
| `alta.bienvenida` | "Bienvenido a {{centro}}" | "Hola {{nombre}}, ya estás dado de alta. Tu primera cuota de {{importe}}€ se cargará el {{fecha_emision}}." |
| `recibo.emitido` | "Recibo {{mes}} {{año}}" | "Tu recibo de {{importe}}€ se cargará en tu {{forma_pago}} el {{fecha_cargo}}." |
| `recibo.cobrado` | "Pago registrado" | "Hemos registrado tu pago de {{importe}}€ del {{mes}}. Gracias." |
| `recibo.enlace_pago` | "Tu cuota está lista para pagar" | "Pulsa para pagar {{importe}}€: {{link}}. Caduca en {{caducidad}}." |
| `recibo.devolucion` | "Tu pago ha sido devuelto" | "Tu cuota de {{mes}} ({{importe}}€) ha sido devuelta. Para regularizar, pulsa {{link}}. Si tienes dudas contacta con tu centro." |
| `recibo.recordatorio` | "Recordatorio de pago" | "Tu recibo de {{mes}} sigue pendiente. {{link}}" |
| `cliente.suspendido` | "Acceso suspendido" | "Tu acceso ha sido suspendido por impago. Para regularizar contacta con {{centro_telefono}}." |
| `cliente.reactivado` | "Acceso reactivado" | "Tu acceso ha sido reactivado. ¡Bienvenido de vuelta!" |

### 6.2 Variables comunes

```
{{nombre}}             — primer nombre del cliente
{{centro}}             — nombre del trainer/centro asignado
{{centro_telefono}}    — teléfono del centro
{{importe}}            — importe formateado "49,90 €"
{{mes}}                — mes textual "mayo"
{{año}}                — año
{{fecha_emision}}      — dd/mm/yyyy
{{fecha_cargo}}        — dd/mm/yyyy
{{forma_pago}}         — texto "tarjeta" / "SEPA" / "enlace de pago"
{{link}}               — URL al enlace de pago
{{caducidad}}          — fecha hasta la que el link es válido
```

---

## 7. Plan de migración inicial

### 7.1 Datos a migrar

| Datos | Origen | Volumen | Formato |
|---|---|---|---|
| Clientes activos | NoofitPro / ORP actual | ~300 | Excel + API |
| Cuotas asignadas | NoofitPro | ~300 (1:1 con cliente o más) | Excel |
| Mandatos SEPA vivos | ORP actual | >50% de los clientes (~150) | Excel/PDF |
| Descuentos activos | NoofitPro | parcial | Excel |
| Modificaciones vigentes | NoofitPro | parcial | Excel |
| Tokens de tarjeta | n/a | 0 (no se migran) | — |

### 7.2 Proceso

1. **Extracción**: con asistencia de Claude, conectar a la BD del ORP actual o exportar Excel.
2. **Limpieza**: validar que todos los DNIs son únicos y bien formados.
3. **Mapeo**: cuotas del ORP → códigos del catálogo NoofitPro.
4. **Carga 1**: catálogos (`round.cuota.catalogo`, `round.descuento.catalogo`) — sin clientes.
5. **Carga 2**: clientes (`res.partner`) con DNI, datos básicos, trainer asignado.
6. **Carga 3**: suscripciones + mandatos SEPA por cada cliente.
7. **Carga 4**: descuentos activos y modificaciones vigentes.
8. **Verificación**: cron de reconciliación inicial — debe dar 0 alertas.
9. **Switch**: dejar de emitir desde el ORP antiguo, primer ciclo en Odoo en sandbox.
10. **Producción**: switch de credenciales sandbox → producción Redsys/Paycomet.

### 7.3 Tiempos estimados

- Extracción + limpieza: 2-3 días
- Carga: 1 día
- Verificación + correcciones: 2-3 días
- **Total**: ~1 semana de trabajo dedicado

---

## 8. Plan de POC (siguiente fase)

### 8.1 Objetivo

Validar la arquitectura con un cliente test, una cuota, una suscripción SEPA y un fichero pain.008 generado correctamente. Sin integración con NoofitPro real (todo manual desde la UI Odoo).

### 8.2 Tareas

```
1. Instalar Odoo Community 17 en VPS Round       (½ día)
   - PostgreSQL local
   - Odoo en puerto 8069
   - Nginx reverse proxy: odoo.round.wiemspro.com
   - Backup nocturno automatizado

2. Activar swap en VPS                            (15 min)
   - Crear /swapfile 4 GB
   - Activar permanente

3. Crear empresa Odoo "Round Málaga"              (1 h)
   - CIF, dirección, banco
   - Configurar plan de cuentas y SEPA Santander

4. Crear cuentas analíticas                        (15 min)
   - "Round Málaga Centro"

5. Instalar módulos Odoo necesarios                (1 h)
   - account_banking_sepa_direct_debit
   - account_banking_mandate
   - subscription_oca
   - report_xlsx
   - web_responsive

6. Desarrollar módulo round_facturacion            (2-3 días)
   - Modelos custom (sección 3.2)
   - Vistas básicas
   - Lógica de aplicación de modificaciones a recibos

7. Crear cliente de test manualmente               (15 min)
   - Partner "Cliente Test"
   - Mandato SEPA con log
   - Suscripción con cuota "RT 1D" mensual

8. Generar fichero SEPA y validar                  (1 h)
   - Export pain.008
   - Verificar formato Santander

9. Documentar hallazgos                            (½ día)
   - Plazos reales
   - Problemas encontrados
```

**Total POC: 1-2 semanas.**

---

## 9. Plan MVP (después del POC)

### 9.1 Objetivo

Sistema funcional integrado con NoofitPro real, primer ciclo mensual en sandbox.

### 9.2 Hitos

```
Hito 1: MCP base operativo                          (1 sem)
  - Endpoint /mcp/eventos/cliente.alta
  - Auth token + HMAC
  - Conexión XML-RPC a Odoo
  - Logs persistidos en round.log.webhook

Hito 2: Eventos NoofitPro → Odoo                   (2 sem)
  - 11 endpoints implementados
  - Tests con payloads de ejemplo
  - Coordinación con equipo Wiemspro para desarrollar
    el envío de webhooks salientes desde su lado

Hito 3: Polling Odoo → NoofitPro                   (1 sem)
  - Cron cada 30 min
  - 6 eventos procesados
  - Llamadas a API NoofitPro para registrar estado
  - Disparar push vía servicio noofit

Hito 4: Migración batch                            (1 sem)
  - Script de carga masiva
  - Verificación
  - 300 clientes en sandbox

Hito 5: Primer ciclo mensual completo              (2 sem)
  - Generación recibos
  - SEPA pain.008 contra sandbox banco
  - Cobros tarjeta tokenizada con stub
  - Conciliación
  - Notificaciones

Hito 6: Pasarela real Redsys/Paycomet              (1 sem)
  - Configuración módulo Odoo
  - Testing en sandbox
  - Switch a producción

Hito 7: Plan B (paso a producción)                 (1 sem)
  - Backups validados
  - Procedimiento rollback
  - Documentación operacional
  - Formación gestor
```

**Total MVP: 9 semanas dedicadas.**

---

## 10. Lo que necesita Wiemspro

Para que esto funcione, el equipo Wiemspro tiene que desarrollar / confirmar:

### 10.1 Webhooks salientes desde NoofitPro

Una llamada `POST` autenticada con token + HMAC a `https://mcp.round.wiemspro.com/eventos/{evento}` cuando ocurra cualquiera de los **11 eventos** listados en sección 4.1.

Payload con campos detallados en el contrato (sección 4.3).

### 10.2 Endpoint para recibir estado de cobranza

Una API que el MCP pueda llamar para informar a NoofitPro de:

```
POST https://api.noofit.com/cobranza/cliente/{id_noofit}/estado
Body:
{
  "estado": "cobrado" | "impagado" | "devuelto" | "suspendido" | "reactivado",
  "recibo_periodo": "2026-05",
  "importe": 49.90,
  "fecha": "2026-05-15",
  "codigo_devolucion": "AC04",       // si aplica
  "mensaje_push": "...",              // template renderizado
  "link_pago": "https://..."          // si aplica
}
```

### 10.3 Servicio de push existente

Confirmación de que el servicio noofit (mencionado por el gestor) puede recibir:

```
POST https://push.noofit.com/cliente/{id_noofit}
Body:
{
  "asunto": "...",
  "cuerpo_html": "...",
  "categoria": "facturacion"
}
```

### 10.4 Acceso a datos para reconciliación diaria

Endpoint paginado para listar clientes activos y detectar deriva:

```
GET https://api.noofit.com/clientes?modificados_desde=2026-05-01&trainer={...}
```

### 10.5 Documento técnico

Solicitar a Wiemspro un documento con:
- URLs de endpoints NoofitPro disponibles
- Formato de webhooks salientes propuesto (que coincida con sección 4.3 o lo más cercano posible)
- Servicio de push: payload exacto, autenticación
- Plazo y coste de desarrollo si requiere trabajo adicional

---

## 11. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Wiemspro no abre webhooks salientes | Media | Alto | Plan B: polling de NoofitPro desde MCP cada 5 min |
| Banco Santander rechaza formato pain.008 generado por Odoo | Baja | Alto | Generar fichero de prueba desde POC, validar con sucursal antes de producción |
| Devolución SEPA con código no documentado | Media | Medio | Catálogo de códigos R y manejo por defecto + log de alerta para casos nuevos |
| Cliente impugna mandato SEPA "click + log" | Baja | Medio | Asumir riesgo en POC; plan de migración a eIDAS si crece volumen |
| Pasarela tarjeta tarda en abrirse | Media | Bajo | Empezar con SEPA solamente en MVP; tarjeta llega en fase posterior |
| Migración inicial con datos sucios | Alta | Alto | Carga por fases con validación, no big bang real |
| VPS sin recursos para Odoo + frontend Round + nginx | Baja | Alto | Activar swap; monitorizar; estar dispuestos a subir RAM si hace falta |
| Multi-empresa Odoo se queda corto al entrar la 2ª SL | Baja | Medio | Levantar instancia Odoo nueva por SL desde el principio |

---

## 12. Pendientes (decisiones no tomadas)

Lista de cosas que aún tienen que decidirse antes o durante implementación:

1. **Subdominio del MCP**: `mcp.round.wiemspro.com` o reusar el MCP existente en `217.154.17.133`.
2. **Subdominio de Odoo**: `odoo.round.wiemspro.com` o `factura.round.wiemspro.com`.
3. **Frecuencia exacta del polling Odoo→NoofitPro**: 15 / 30 / 60 minutos.
4. **Día de emisión mensual**: 1, 25, 28 — depende del flujo del gestor.
5. **Plantillas push**: revisar contenido propuesto (sección 6) con el gestor.
6. **Dashboard del manager**: qué KPIs quiere ver (€ cobrados, % devolución, ingreso por trainer…).
7. **Multi-centro futuro**: si entra otra SL, ¿reusamos VPS o uno nuevo?
8. **Backup**: política de retención (7 días, 30 días, 1 año…).
9. **Acceso del gestor**: usuarios de Odoo y rol (admin, billing, viewer).
10. **Auditoría legal final**: confirmar con asesor que el modelo "click + log" + extracto de logs es defensable ante el banco.

---

## 13. Próximos pasos

1. **El gestor revisa este documento** y aprueba / corrige.
2. Una vez aprobado: **arrancar el POC** (sección 8).
3. En paralelo: **conversación con Wiemspro** sobre lo que necesitan desarrollar (sección 10).
4. Tras POC validado: planificar MVP por hitos (sección 9).

---

> **Este documento es vivo**. Cada decisión nueva o cambio se versiona en este archivo y se commitea al repo.
> Versión actual: **1.0** (Mayo 2026)
> Próxima revisión planificada: tras POC.
