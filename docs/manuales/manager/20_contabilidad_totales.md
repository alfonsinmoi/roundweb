# Manual Manager · 20 de 38 · Contabilidad — Totales

## Cómo llegar

Contabilidad → tab **📊 Totales**.

> 📷 **Captura: `20_totales.png`** — tabla pivot.

## Qué muestra

Pivot table de los gastos validados, agregando por la dimensión que elijas.

## Filtros

- **Agrupar por**:
  - **Mes** — totales mensuales
  - **Categoría** — luz, agua, alquiler, nóminas…
  - **Proveedor** — Iberdrola, Endesa, Bricomart…
  - **Trainer** — qué centro genera más gasto
  - **Tipo** — gasto / nómina / banco / impuesto / otro
- **Estado**: Validados (default) / Todos / Borrador
- **Desde / Hasta** — rango fechas

## Tabla resultante

| Grupo | Base | IVA | Total | Docs |
|---|---|---|---|---|
| 2026-04 | 100,00 € | 21,00 € | 121,00 € | 2 |
| 2026-05 | 50,00 € | 10,50 € | 60,50 € | 1 |
| **TOTAL** | … | … | **…** | … |

Fila TOTAL al final con la suma de todos.

## Tips

- Útil para comparar el gasto en luz mes a mes (agrupar por categoría +
  filtrar por el mes que quieras).
- Para ver "qué proveedor me cuesta más", agrupar por proveedor.
- Si solo quieres ver lo validado oficialmente, deja filtro "Validados".
- Si quieres incluir los borradores que has escaneado pero no has
  confirmado, cambia a "Todos".
