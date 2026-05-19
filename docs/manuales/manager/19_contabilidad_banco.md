# Manual Manager · 19 de 38 · Contabilidad — Banco

## Cómo llegar

Contabilidad → tab **🏦 Banco**.

> 📷 **Captura: `19_banco_listado.png`** — tabla de movimientos bancarios.

## Qué muestra

Tabla con todos los movimientos bancarios importados:

| Columna | Contenido |
|---|---|
| Fecha | Fecha del movimiento |
| Banco | Nombre del banco (BBVA, Santander…) |
| Concepto | Descripción del cargo/abono |
| Importe | Negativo = gasto / Positivo = ingreso |
| Saldo | Saldo posterior si lo trae |
| Estado | Sin cuadrar / Cuadrado / Ignorado |
| Factura | Factura vinculada (si está cuadrado) |

## Stats

- Sin cuadrar
- Cuadrados
- Ignorados

## Filtros

- **Estado**
- **Banco** (dropdown con los bancos detectados)
- **Buscar** — por concepto

## Importar extracto

Botón **"📎 Importar extracto"** — acepta:

- CSV (con punto y coma o coma; auto-detecta delimitador)
- XLSX (Excel)

El parser detecta columnas automáticamente (Fecha, Concepto, Importe,
Saldo, o pareja Haber+Debe). Tolera importes en formato europeo
(`1.234,56`) y americano (`1,234.56`).

> 📷 **Captura: `19_banco_importar.png`** — diálogo de importación con
> el archivo seleccionado.

Al subir:

- Anti-duplicado por hash SHA256 (re-subir el mismo extracto NO duplica)
- Te dice cuántas líneas insertó / cuántas eran duplicadas

## Cuadrar automático

Botón **"⟲ Cuadrar automático"** ejecuta matching 1:1:

1. Para cada movimiento sin cuadrar, busca la mejor factura validada
   candidata
2. Calcula score multi-criterio: importe (±0.05€) + fecha (proximidad) +
   tokens concepto vs proveedor + ref ↔ num_factura
3. Si score ≥ 80 → autoasigna y marca como `cuadrado`
4. Si 50-80 → "sugerencia" (no aplicada, queda como sin cuadrar)
5. Si < 50 → ignora

## Vincular manualmente

Cada movimiento tiene botones:

- **✗ Ignorar** — marca como `ignorado` (no aparece en sin cuadrar)
- (en versión futura) Vincular a factura concreta desde dropdown

## Tips

- El parser entiende cabeceras típicas españolas: "Fecha valor",
  "Concepto", "Importe", "Saldo después" o pareja "Haber" + "Debe".
- Si tu banco exporta XLS antiguo, conviértelo a XLSX primero.
- Para descuadres complejos (1 cobro = N facturas), está pendiente el
  matching subset-sum (ver INTEGRACION_NOOFIT_PENDIENTE).
