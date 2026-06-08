# HANDOFF — Modelo de facturación Round en Odoo (round_facturacion)

> Brief autocontenido para trabajar el modelo de facturación en el addon
> `round_facturacion` (Odoo 17 Community, BD `round_facturacion`) sin contexto
> previo. Creado 2026-06-08.

## 0. Contexto e invariantes (NO romper)
- Odoo **17 Community**, BD `round_facturacion`, company **3** = "BEST TRAINING RINCON DE LA VICTORIA SL" (entidad jurídica del manager operativo Round, id_manager 17675).
- **Regla arquitectónica**: 1 **BD Odoo por manager** (al activar contabilidad/cuotas/crm). Dentro de la BD: **company por entidad jurídica**; trainers de la misma entidad se separan por **analítica + 430XXX + serie**. Company **1 ("legacy USA - NO USAR") prohibida**.
- **Cliente = tercero (`res.partner`)**, NUNCA cuenta. El partner lleva `id_noofit` (campo Char, **UNIQUE** parcial ya creado) = enlace unívoco web↔Odoo.
- Cada `account.move` lleva la **analítica del trainer** (`analytic_distribution`).

## 1. Cuentas 430XXX por trainer
- Crear `account.account` por trainer: código **`430` + nº centro a 3 dígitos con padding** (`430001`, `430002`, …, hasta `430999`). Misma longitud siempre (Odoo ordena por string).
- Tipo: cuenta a cobrar (receivable), reconcile=True, dentro de la company del manager.
- En cada **cliente (partner) de ese trainer**: `property_account_receivable_id = 430XXX de su trainer`. Así todos sus clientes ruedan bajo esa cuenta y el **Mayor de Terceros** los desglosa por partner.
- El mapeo **trainer → sufijo XXX** lo define el **manager** en Round (Configuración→Facturación); Odoo solo necesita crear la cuenta y asignarla al partner.

## 2. Series / numeración
- El manager define un mapeo **trainer → serie**. **Varias trainers pueden compartir serie** (= **una sola `ir.sequence`**, contador continuo); se distinguen por la analítica.
- Hoy hay **una `ir.sequence` por company** (`account.move.invoice.{company_id}`). Hay que pasar a **una `ir.sequence` por serie** y que la factura use la secuencia de la serie del trainer del cliente.
- Serie aparte **"cliente final"** (para b.1), también compartible.

## 3. IVA
- Por **trainer** se crean **tipos de IVA** (entidad de config en Round); a cada tipo se asignan **una o varias cuotas**. Por defecto el **general (21%)**.
- En Odoo: cada línea de factura usa el **impuesto** correspondiente al tipo de IVA de la cuota. En la **factura agregada (opción b)** las líneas se **parten por tipo de IVA**.
- Hoy `round.cuota.catalogo` **no tiene campo IVA** (factura usa 21% fijo) → habrá que tomar el IVA del tipo/producto. (El campo de config vive en Round; Odoo recibe el % por línea.)

## 4. Dos sistemas de facturación (REEMPLAZAN `modo_facturacion`)
Config **por empresa (entidad jurídica)**, igual para todos sus trainers, **solo modificable por el manager**:
- `sistema_facturacion ∈ {inmediata, fin_de_mes}`
- `destino_factura ∈ {por_cliente (a), agregada_430xxx (b)}`

**Inmediata**: cada **cobro / devolución / recobro** → factura al instante (según a/b). El **recobro SÍ genera su propia factura** aquí.
**Fin de mes**: relación seleccionable de cobros del mes (con forma de cobro/recobro) + devoluciones de meses anteriores llegadas este mes → facturar lo seleccionado (según a/b). El recobro aparece en la relación pero NO genera factura propia (va en el agregado).

### Opción a — factura por cliente
- `account.move` out_invoice por cliente, partner = cliente, su receivable = 430XXX del trainer, líneas por cuota con su IVA y analítica del trainer, numerada con la **serie del trainer**.

### Opción b — factura agregada por trainer
- **1 `account.move`/mes/trainer** contra su **430XXX** (partner genérico tipo "Clientes <Trainer>"), líneas agrupadas por tipo de IVA, analítica del trainer.
- **Adjuntar al asiento un PDF** con la **relación de clientes + su cobro** (cliente, NIF, cuota, importe, forma de cobro, fecha). (Existe helper `_attach_pdf` idempotente en el TPV reutilizable.)
- **b.1 (cliente pide su factura)**: emitir factura propia al cliente con **serie "cliente final"**; el **mes siguiente**, en el agregado 430XXX, una **línea NEGATIVA** "Menos facturas cliente final mes anterior" = Σ de esas facturas (**reducción de base, SIN rectificativa**). Registrar las facturas cliente-final por mes para calcular la reducción.

## 5. Recobro (control de eficacia)
- Estado/tipo propio (un segundo cobro de un recibo devuelto). Métrica: **Σ recobrado / Σ devuelto** por mes/trimestre.
- Ya existe la tabla Round `movimiento_financiero` (cobro/devolución + trainer + ref + importe + fecha) → base de la relación y de la eficacia; añadiríamos tipo `recobro` y la forma de cobro.

## 6. Mayor por cliente
- Community base no trae Partner Ledger. Opciones: instalar **OCA `account_financial_report`** (para el contable en Odoo) y/o exponer el **extracto por cliente en la web Round** leyendo `account.move.line` por partner dentro de su 430XXX (lo preferido para los operadores).

## 7. Lo que YA está hecho del lado Round/backend (interfaz para Odoo)
- `res.partner.id_noofit` UNIQUE (B2); trainer del cliente vía `cliente_cache.id_trainer` + helper `_id_trainer_de_idnoofit()`.
- `resolve_company(manager, trainer)` (rechaza legacy) + `_require_company`.
- Cuota lookup estricto por (codigo, id_trainer); índices únicos B5/B7 persistidos en `init()` del addon.
- `movimiento_financiero`, `sepa_remesa`, `emision_mes` (tablas creadas), `recibo.sync_*` + cron de reintento idempotente de cobros.
- Emisión actual: `recibo` (BD) → `account.payment` a cuenta → factura (hoy trimestral). Habrá que reorientar la facturación a los 2 sistemas nuevos.

## 8. Decisiones abiertas (menores, cerrar al implantar)
- Opción a: factura **posteada** o draft por defecto.
- Serie "cliente final": **única por empresa** o por trainer.
- Tipos de IVA: por trainer (confirmado) — Odoo recibe el % por línea.
- Cierre anual: arrastre 430XXX automático vs manual en Odoo.

## 9. Trabajo concreto del lado Odoo (resumen accionable)
1. Crear `account.account` 430XXX por trainer + asignar `property_account_receivable_id` a sus partners.
2. `ir.sequence` por serie (no por company) + serie "cliente final".
3. Impuestos por línea según tipo de IVA de la cuota; agregado parte por IVA.
4. Lógica de creación de `account.move`: inmediata vs fin de mes × por_cliente vs agregada_430XXX, con analítica del trainer.
5. Adjuntar PDF de la relación en la factura agregada.
6. b.1: serie cliente final + línea negativa de reducción de base el mes siguiente.
7. (Opcional) instalar OCA `account_financial_report`.
