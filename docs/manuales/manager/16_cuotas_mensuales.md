# Manual Manager · 16 de 38 · Cuotas mensuales

## Cómo llegar

Menú → **Económico ▾ → Cuotas mensuales**.

> 📷 **Captura: `16_cuotas_listado.png`** — tabla de recibos del mes.

## Qué muestra

Tabla con todos los **recibos** (facturas) del mes seleccionado:

| Columna | Contenido |
|---|---|
| Cliente | Foto + nombre |
| Trainer | Centro asignado |
| Cuota | Tipo (mensual, trimestral, etc.) |
| Período | YYYY-MM o T1..T4 |
| Importe | € |
| Forma de pago | SEPA / efectivo / TPV / link / token |
| Estado | Pagado / Pendiente / Devuelto / En pago |
| Acciones | Enviar factura, marcar pagado, generar link… |

## Filtros

- **Mes** — selector
- **Estado** — Todos / Pagados / Pendientes / Devueltos
- **Trainer**
- **Forma de pago**

## Acciones por fila

- **Enviar factura PDF** al cliente (vía email configurado)
- **Generar link PayComet** (si forma_pago='enlace_pago')
- **Marcar como pagado manualmente** (con motivo)
- **Procesar SEPA** (genera fichero pain.008)
- **Anular pago** (devolución)

## Vistas adicionales

Pestañas arriba:

- **Recibos** (default)
- **SEPA** — generación del fichero bancario para tus cobros domiciliados
- **Devoluciones** — gestión de impagados
- **Evolución** — gráfico mes a mes

## Stats

- Total facturado mes
- Total pagado
- Total pendiente
- Total devuelto

## Tips

- Las **devoluciones** disparan automáticamente notificación push al
  cliente (tipo `devolucion`) si está activado en config.
- El **PDF de factura** se descarga desde Odoo con la plantilla
  configurada.
- Cuando pulsas "Generar link PayComet", el cliente recibe push tipo
  `enlace_pago` con el enlace para pagar online.
