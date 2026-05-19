# Manual Manager · 22 de 38 · Contabilidad — Cuenta de Resultados

## Cómo llegar

Contabilidad → tab **📈 Cuenta de Resultados**.

> 📷 **Captura: `22_resultados_grid.png`** — vista comparativa por
> períodos seleccionados.

## Qué muestra

P&L (Profit & Loss) **comparativo** entre los períodos que selecciones.
Ingresos – gastos = resultado bruto del período.

| Concepto | Período 1 | Período 2 | … | Total |
|---|---|---|---|---|
| **Ingresos** | | | | |
| Cuotas | 4.500 | 4.700 | … | 9.200 |
| **Gastos** | | | | |
| Luz | -180 | -210 | … | -390 |
| Agua | -45 | -50 | … | -95 |
| Nóminas | -2.800 | -2.800 | … | -5.600 |
| Alquiler | -1.200 | -1.200 | … | -2.400 |
| **Resultado** | **275** | **440** | … | **715** |

## Filtros

- **Filtrar por períodos** (collapsable) — grid **5 últimos años × 12
  meses ó 4 trimestres**, multi-select
  - Modo **Mes** — columna por mes
  - Modo **Trimestre** — columna por T1/T2/T3/T4
- **Trainer** — filtrar por centro concreto
- **Solo validados** (default) / Incluir borradores

> 📷 **Captura: `22_resultados_filtros.png`** — grid de selección de
> períodos abierto.

## Cómo se calculan los ingresos

Suma de los **recibos pagados** de cuotas (`account.move out_invoice`
en estado `posted` con `payment_state in (paid, in_payment)`) cuyo
período coincide con el seleccionado.

## Cómo se calculan los gastos

Suma de los **documentos validados** (gastos / nóminas / impuestos)
agrupados por categoría, en el período seleccionado.

## Tips

- Para ver "junio comparado entre 2024, 2025 y 2026", selecciona los
  tres junios en el grid.
- El **modo trimestre** es útil para presentaciones a socios / asesor.
- Si una columna sale en rojo (resultado negativo), revisa la columna
  de gastos para ver qué categoría se disparó.
- Los importes se exportan a CSV con el botón ⬇ arriba a la derecha.
