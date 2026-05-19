# Manual Manager · 10 de 38 · CRM · Reservas de prueba gratuita

## Cómo llegan

Cuando un lead se reserva una clase de prueba desde el formulario
público de `roundtrainingcenter.com`, se crea:

1. Un **lead** en CRM (etapa "Clase de prueba")
2. Una **reserva de slot** con token único
3. Un **email automático** al lead con el enlace `/reserva/<token>` para
   que pueda **confirmar / cambiar / anular**

## Dónde verlas

- En el kanban CRM, las tarjetas en etapa "Clase de prueba" tienen un
  badge con la fecha+hora del slot.
- En el detalle del lead, sección **"Reserva de prueba"**.
- Endpoint público `/reserva/<token>` — sin login, lo abre el cliente.

> 📷 **Captura: `10_reserva_publica.png`** — la pantalla pública que ve
> el cliente al abrir el link `/reserva/<token>`.

## Qué puede hacer el cliente desde el link público

- **Confirmar** — la reserva queda confirmada
- **Cambiar fecha/hora** — elegir otro slot disponible
- **Anular** con motivo (textarea opcional)

## Avisos automáticos al cliente

| Evento | Email |
|---|---|
| Lead crea reserva | `slot_reservado_lead` |
| Confirma | `slot_confirmado_lead` |
| 24h antes de la clase | `slot_recordatorio_lead` (cron) |
| Cancelación | `slot_cancelacion` |

Las plantillas se editan en Configuración → Plantillas email (doc 37).

## Avisos al trainer

Si el lead anula desde el link público, el sistema:

1. Marca la reserva como `cancelada`
2. Mueve el lead Odoo a etapa "Perdido"
3. Manda email al trainer con el motivo

## Tips

- Los slots se liberan **automáticamente** si la reserva pasa de la
  fecha sin confirmarse (cron `round_slots_cleanup` cada 5 min).
- Un cliente solo puede tener 1 reserva activa simultánea.
