# Manual Trainer · 7 de 12 · Cuotas Mensuales de Mis Clientes

## Cómo llegar

Menú → **Económico ▾ → Cuotas mensuales**.

> 📷 **Captura: `07_cuotas_trainer.png`** — tabla filtrada a mis
> clientes.

## Qué ves

Lista de **recibos del mes** de los clientes de **tu centro únicamente**.

| Columna | Contenido |
|---|---|
| Cliente | Foto + nombre |
| Cuota | Tipo |
| Período | YYYY-MM o T1..T4 |
| Importe | € |
| Forma de pago | SEPA / TPV / link / token |
| Estado | Pagado / Pendiente / Devuelto / En pago |
| Acciones | Reenviar factura PDF · Generar link · Marcar pagado |

## Filtros

- **Mes**
- **Estado**: Todos / Pendientes / Devueltos / Pagados
- **Forma de pago**

## Acciones por fila

- **📩 Enviar factura PDF** al cliente
- **🔗 Generar link PayComet** (notifica push tipo `enlace_pago`)
- **✓ Marcar como pagado manualmente** (con motivo)
- **↩ Anular pago** (devolución)

## Stats

- Total facturado mes (de tu centro)
- Total pagado / pendiente / devuelto

## Lo que NO puedes hacer

- Procesar SEPA masivo (lo hace el Manager con el fichero pain.008)
- Cambiar la cuota base del cliente (lo hace el Manager)

## Tips

- Si un recibo aparece **devuelto**, el cliente ya recibió push
  `cobro_devuelto` automáticamente; tu acción es **llamarlo** y
  generar nuevo link de pago.
- Para clientes nuevos con **forma de pago "enlace_pago"**, el link
  se genera automáticamente al alta. Puedes regenerarlo manualmente
  si caducó.
