# Manual Manager · 21 de 38 · Contabilidad — Faltantes

## Cómo llegar

Contabilidad → tab **🔍 Faltantes**.

> 📷 **Captura: `21_faltantes_listado.png`** — tabla de gastos esperados
> que aún no se han subido.

## Qué muestra

Lista de **gastos previsibles** que el sistema esperaba este mes y NO ha
encontrado entre los documentos validados.

| Columna | Contenido |
|---|---|
| Categoría | Luz / Agua / Alquiler / Nómina… |
| Proveedor habitual | Iberdrola, Endesa… (si lo hay) |
| Importe estimado | Media de los últimos meses |
| Última vez | Fecha del último documento de este patrón |
| Tipo | **Detectado** (con historial) / **Estimado** (heurística) |
| Acciones | 📎 Subir ahora · 🗄 Archivar |

## Filtros

- **Tipo**:
  - **Todos**
  - **Detectados** — el sistema vio este gasto en meses anteriores y
    espera repetición
  - **Estimados** — no hay historial firme; sale de patrones genéricos
    (alquiler, suministros, nómina mensual)
- **Mes** — qué mes estamos cerrando
- **Categoría**

## Tipo: Detectado vs Estimado

- **Detectado**: hay ≥ 2 documentos previos del mismo proveedor +
  categoría con cadencia mensual / trimestral. El importe estimado es
  la media de las últimas 3 ocurrencias.
- **Estimado**: no hay historial concreto, pero el manager tiene ese
  centro y el sistema "espera" por defecto luz, agua, alquiler, nómina.

## Acciones

- **📎 Subir ahora** — abre el modal de subida (doc 18) prefilteado con
  la categoría y proveedor sugeridos
- **🗄 Archivar** — descarta este faltante para el mes en curso (no
  vuelve a aparecer hasta el mes siguiente). Útil si ya sabes que ese
  gasto no va a llegar (p.ej. el local cerrado en agosto, sin luz)

## Tips

- Marca como archivado los faltantes que sabes que NO van a llegar
  (vacaciones, contrato cancelado…) para que el dashboard del mes salga
  limpio.
- Si un faltante "detectado" se repite mes a mes y nunca aparece, mira
  si cambió el proveedor (p.ej. cambio de comercializadora eléctrica).
- Los **estimados** son orientativos; sirven para no olvidarte de subir
  la nómina o el alquiler.
