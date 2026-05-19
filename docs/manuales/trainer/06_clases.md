# Manual Trainer · 6 de 12 · Mis Clases

## Cómo llegar

Menú → **📅 Clases**.

> 📷 **Captura: `06_clases_trainer_calendario.png`** — calendario
> semanal de tu sala.

## Qué ves

Calendario / agenda con las **clases de tu centro únicamente**.

### Vista calendario

- Eje X: días (L–D)
- Eje Y: franjas horarias
- Cada bloque = una clase con su nombre + monitor + ocupación

### Vista lista

Tabla con todas las clases del rango:

| Columna | Contenido |
|---|---|
| Fecha + hora | |
| Clase | Nombre |
| Monitor | Quién imparte |
| Capacidad | Plazas |
| Reservas | Apuntados |
| Asistencias | Marcados como presentes |
| Acciones | Detalle · Marcar asistencia · Cancelar |

## Acciones por clase

- **👁 Ver detalle** — lista de apuntados (doc 7 del manual del manager
  pero filtrado a tu centro)
- **✓ Marcar asistencia** — si la clase ya pasó
- **✗ Cancelar clase** — con notificación push automática a los
  apuntados

## Filtros

- **Rango fechas**
- **Clase** concreta
- **Monitor** (si tienes varios)

## Lo que NO puedes hacer

- Crear clases nuevas (lo hace el Manager o desde NoofitPro Admin)
- Cambiar capacidades

## Tips

- Cancelar una clase **dispara push** automático tipo
  `clase_cancelada` a todos los apuntados.
- 1h antes de cada clase se envía recordatorio `clase_recordatorio`
  por cron automático.
- Marca asistencia **al final de cada sesión**; los informes tiran de
  eso.
