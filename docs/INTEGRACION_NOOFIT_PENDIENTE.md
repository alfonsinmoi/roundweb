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

## Resumen ejecutivo (para hablar con NoofitPro)

**Cambios "urgentes" (afectan funcionalidad existente):**
1. Persistir `gympassId` en `clientePlusv2` POST.
2. Devolver `fechaCreacion` en `getClienteSimple`.
3. Aclarar/eliminar el bloqueo `_MAK` que impide editar clientes sandbox.

**Cambios "evolutivos" (Round los mantiene local mientras tanto):**
4. Categorías de cliente con `puede_reservar` y `tiene_cuota`.
5. Histórico de inactivaciones con motivo y timeline.
6. Plantillas de email configurables (o garantía de `toSend=False`
   permanente).
7. Endpoint de "reserva prueba" que no cree todavía un cliente real.
8. Metadata "centro" por trainer (slug, dirección, mapa).

**No urgentes / no necesarios (Round los gestiona y no necesita
NoofitPro):**
- Pasarela de pago (PayComet por trainer).
- Redes sociales (Meta Graph).
- CRM (Odoo).
- Cobros / cuotas con Odoo (a menos que NoofitPro decida competir con
  el módulo de facturación).
