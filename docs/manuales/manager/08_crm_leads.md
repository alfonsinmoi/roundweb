# Manual Manager · 8 de 38 · CRM · Leads (kanban)

## Cómo llegar

Menú → **CRM ▾ → Leads**.

> 📷 **Captura: `08_crm_kanban.png`** — vista kanban completa con sus
> columnas (Nuevo, Contactado, Clase de prueba, Alta, Perdido).

## Qué es

Embudo visual de captación de nuevos clientes. Cada **lead** es una
persona interesada que aún no es cliente. Cada lead pasa por etapas:

```
Nuevo → Contactado → Clase de prueba → Alta (cliente real)
                           ↓
                       Perdido (con motivo)
```

Las etapas vienen de **Odoo CRM** y son configurables.

## Anatomía de una tarjeta de lead

Cada tarjeta muestra:

- **Nombre + apellidos**
- **Score** (punto de color: verde / ámbar / rojo según probabilidad)
- **Trainer asignado**
- **Próxima acción** (si configurada)
- **Días en etapa** actual
- **Slot de prueba** reservado (si tiene)
- Botones rápidos: Llamar, Email, WhatsApp

## Cómo trabajar el embudo

1. **Nuevos leads** entran automáticamente cuando alguien rellena el
   formulario de prueba gratuita en `roundtrainingcenter.com`.
2. Arrastra la tarjeta de columna en columna a medida que el lead avanza.
3. Click en una tarjeta → abre el detalle del lead.
4. Si pasa a **"Alta"** → enlazar con cliente Odoo (ver doc 9).

## Filtros

Toolbar arriba:

- **Trainer** — solo los leads de ese trainer
- **Score** — solo verde / ámbar / rojo
- **Funnel** — botón que abre la vista analítica del embudo

## Drag & drop

Si una etapa de destino es **"Perdido"**, al soltar te pide motivo.

## Stats agregadas

Botón **"Ver embudo"** arriba — abre modal con:

- Conversión etapa por etapa
- Tiempo medio en cada etapa
- Score medio

## Tips

- Las etapas las define Odoo. Si necesitas crear/borrar etapas, ve a
  Odoo CRM.
- Si arrastras a "Perdido" sin querer, no lo deshace — pero puedes
  arrastrar de vuelta a la etapa anterior.
- Los leads con prueba reservada tienen un badge especial.
