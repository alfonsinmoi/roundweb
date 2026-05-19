# Manual Manager · 5 de 38 · Perfil del cliente

## Cómo llegar

Listado de clientes → click en una fila.

> 📷 **Captura: `05_perfil_header.png`** — cabecera del perfil con
> avatar, badges, KPIs y acciones.

## Qué ves

### Cabecera

- Avatar grande + nombre + apellido + alias (entre comillas)
- Email + teléfono
- Badges de estado (Activo / Inactivo / No activo)
- KPIs: Edad · Talla · Peso · FC reposo · VO₂max · nº Sesiones
- Objetivo declarado

### Acciones del cliente

- **Mostrar QR** — para vincular al cliente con `mynoofit`
- **Inactivar / Reactivar** — con motivo opcional
- **Desvincular** (acción peligrosa, irreversible)

### Pestañas

| Pestaña | Contenido |
|---|---|
| **Datos personales** | Edición de campos personales con doble auth |
| **Clases realizadas** | Historial completo de asistencias |
| **Análisis uso** | Patrón de uso del cliente |
| **Cuotas** | Recibos pagados / pendientes + envío de factura |
| **Notificaciones** | Notificaciones que ha recibido + botón "Notificar" |
| **Datos ERP** | (si configurado) datos para alta Odoo |

> 📷 **Captura: `05_perfil_tabs.png`** — barra de pestañas + contenido del
> tab "Datos personales" desplegado.

## Card "Categoría y fechas"

Visible en el tab Datos personales, muestra:

- **Categoría asignada** (selector editable: Gympass, Trabajador, Invitado…)
- **Fecha primera alta** — primera vez que vimos al cliente como activo
- **Fecha alta actual** — última reactivación
- **Fecha inactivo** — si está actualmente inactivo

## Card "Estado"

Información técnica: ID Espejo, Username, Email verificado, Habilitado,
Activo, Virtual Coach, fechas técnicas.

## Tips

- **Editar datos personales** requiere contraseña ERP (`Cambiamos!2026`).
- **Inactivar** un cliente NO lo borra — sigue en BD y se puede reactivar.
- Las fechas reflejan el histórico real desde que el cliente está en Round.
