# Manual Manager · 11 de 38 · CRM · Clientes actuales (notificaciones)

Pantalla para gestionar **notificaciones push** que envías a tus clientes
existentes via app `mynoofit`.

## Cómo llegar

Menú → **CRM ▾ → Clientes actuales**.

> 📷 **Captura: `11_notificaciones_kanban.png`** — vista CRM-style con
> 4 columnas (Cobros, Clases, Centro, Noticias).

## Qué ves

Estilo kanban con **4 columnas** (secciones):

| Sección | Para qué |
|---|---|
| 🧾 Cobros | Recibos, devoluciones, enlaces de pago, confirmaciones |
| 📅 Clases | Cambios de hora, monitor, cancelaciones |
| 🏢 Centro | Cierres, cambios de horario, eventos |
| 📰 Noticias | Comunicaciones HTML (webview) |

Cada tarjeta es una notificación enviada con su título, cuerpo, contadores
de destinatarios + leídos, y estado (enviada / pendiente / fallida).

## Filtros

Toolbar arriba:

- **Desde / Hasta** — rango de fechas (default últimos 30 días)
- **Estado** — Pendiente / Enviada / Fallida / Cancelada / Todos

Por columna (en cada cabecera de sección):

- Filtro **Tipo** dentro de la sección

## Stats arriba

- Enviadas
- Pendientes
- Fallidas
- Destinatarios totales
- Leídas (con %)

## Acciones por tarjeta

- **Click en el contador "X destinatarios · Y leídas"** (si > 1) → abre
  modal con la lista detallada de cada cliente: leída sí/no, fecha lectura
- **Cancelar** — solo si estado=pendiente

## Crear nueva notificación

Botón **"+ Nueva notificación"** arriba a la derecha → ver doc 12.

## Tips

- Las notificaciones **automáticas** (impagos, devoluciones, pago
  confirmado) salen sin que tú hagas nada — ver doc 33 para configurar.
- Si un envío sale con `estado=fallida` y mensaje "el cliente no se ha
  vinculado…", es porque NoofitPro aún no implementa `OneSignal.login()`
  en iOS (Android sí funciona).
