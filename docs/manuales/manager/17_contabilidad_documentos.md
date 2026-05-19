# Manual Manager · 17 de 38 · Contabilidad — Documentos

## Cómo llegar

Menú → **Económico ▾ → Contabilidad** → tab **📄 Documentos** (default).

> 📷 **Captura: `17_contab_documentos.png`** — tabla de documentos con
> stats arriba.

## Qué muestra

Tabla con **gastos / facturas de proveedor / nóminas / extractos / impuestos**:

| Columna | Contenido |
|---|---|
| Fecha | Fecha del documento |
| Proveedor / núm | Razón social + nº factura |
| Categoría | Luz / Agua / Nómina / IVA… |
| Período | YYYY-MM o T1..T4 |
| Total | Importe total con IVA |
| Estado | Borrador / Validado / Rechazado |
| Acciones | Ver archivo · Validar · Rechazar · Borrar |

## Stats arriba

- Total documentos en el rango
- Borrador / Validados / Rechazados
- Importe total

## Filtros

- **Desde / Hasta** — rango de fechas (default: del 1 enero al hoy)
- **Estado**
- **Categoría**
- **Buscar** — proveedor, nº factura, concepto
- **Filtrar por períodos** (collapsable) — grid 5 años × 12 meses ó
  4 trimestres con multi-select

## Acciones por documento

- **👁 Ver archivo** — abre el PDF / imagen original en pestaña nueva
- **✓ Validar** — abre confirm: *"¿Definitivo? Esto creará un asiento
  contable en Odoo"* — al aceptar, marca validado y crea `account.move`
- **✗ Rechazar** — pide motivo opcional, marca rechazado
- **🗑 Borrar** — solo si NO está validado en Odoo

## Subir documento nuevo

Botón **"📎 Subir documento"** arriba a la derecha → ver doc 18.

## Tips

- Los documentos validados crean **borrador** en Odoo (`account.move`
  como `draft`). Si confianza LLM ≥ 0.9 y NO necesitó doble auth, se
  postean automáticamente.
- **Filtrar por períodos** es útil para comparar trimestres entre años.
