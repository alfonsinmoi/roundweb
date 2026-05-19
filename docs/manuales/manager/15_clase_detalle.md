# Manual Manager · 15 de 38 · Detalle de una clase

## Cómo llegar

Listado de clases → **click en una celda**.

> 📷 **Captura: `15_clase_detalle.png`** — modal/drawer con datos de la
> clase + lista de inscritos.

## Qué muestra

### Datos generales

- Nombre actividad
- Fecha + hora
- Monitor
- Sala
- Plazas (X de Y ocupadas)

### Inscritos

Lista de clientes apuntados con:

- Foto + nombre
- Estado: confirmado / asistió / faltó / cancelado
- Botones: marcar asistencia, eliminar de la clase

## Acciones

- **Cambiar monitor**
- **Cambiar hora** (con aviso a los inscritos via notificación push)
- **Cancelar clase** (envía notif a todos los inscritos)
- **Inscribir cliente nuevo** — buscador
- **Marcar asistencia** post-clase

## Notificaciones automáticas

Si haces cambios:

- Cambio de hora → push tipo `cambio_hora` a inscritos
- Cambio de monitor → push tipo `cambio_monitor`
- Cancelación → push tipo `clase_cancelada`

(Configurable en Configuración → Notificaciones — doc 33).

## Tips

- Asegúrate de marcar asistencia DESPUÉS de la clase para que el sistema
  pueda hacer análisis de uso correctos.
- Las cancelaciones disparan emails y push automáticos — úsalas con
  cuidado.
