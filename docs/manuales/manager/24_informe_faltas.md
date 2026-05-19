# Manual Manager · 24 de 38 · Informe — Faltas

## Cómo llegar

Informe Asistencia → **Faltas**.

> 📷 **Captura: `24_faltas_listado.png`** — tabla con clientes que
> llevan días sin venir.

## Qué muestra

Tabla con clientes activos ordenados por **días desde la última
asistencia**:

| Columna | Contenido |
|---|---|
| Cliente | Foto + nombre |
| Trainer | Centro |
| Última asistencia | Fecha |
| Días sin venir | Número (semáforo color) |
| Cuota | Tipo |
| Total clases mes | Cuántas ha hecho este mes |
| Acción | 📩 Enviar notificación / ☎ Marcar como contactado |

## Semáforo

- 🟢 ≤ 7 días — normal
- 🟡 8–14 días — pendiente atención
- 🔴 > 14 días — riesgo de baja

## Filtros

- **Trainer**
- **Cuota**
- **Días mínimos** — solo mostrar quien lleve > N días sin venir
- **Solo activos** (default)

## Acciones

- **📩 Enviar notificación** — abre modal de notificación push
  prefilteado a este cliente con plantilla "te echamos de menos"
- **☎ Marcar como contactado** — apunta en el historial del cliente
  que lo has llamado (no envía nada)

## Tips

- Buen punto de control diario: revisar la lista de 🔴 antes de cerrar
  el día.
- Combínalo con la pestaña **Análisis patrones**: si un cluster
  completo está faltando, hay un problema de horario o monitor.
