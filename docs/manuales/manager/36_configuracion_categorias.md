# Manual Manager · 36 de 38 · Configuración — Categorías de Cliente

## Cómo llegar

Configuración → tab **🏷 Categorías cliente**.

> 📷 **Captura: `36_categorias_listado.png`** — lista de categorías.

## Qué muestra

Etiquetas que sirven para **agrupar clientes** transversalmente
(adicional a las cuotas):

| Columna | Contenido |
|---|---|
| Nombre | "VIP", "Familia X", "Estudiante", "Empresa…" |
| Color | Hex para badge visual |
| Visible en perfil | Sí / No |
| Filtro CRM | Sí / No |
| Nº clientes | Cuántos la tienen |

## Acciones

- **Crear categoría** — nombre + color
- **Renombrar / cambiar color**
- **Borrar** — solo si no tiene clientes; si tiene, primero
  reasignarlos
- **Asignar a clientes** desde la ficha del cliente (no aquí)

## Diferencia con etiquetas Odoo

- Las **categorías de cliente** son del manager (tu CRM).
- Odoo tiene sus propias **tags** internas (`res.partner.category`).
- El sistema mantiene un mapping para que no se dupliquen al hacer
  alta de cliente.

## Tips

- Útil para hacer **campañas segmentadas** sin tener que filtrar por
  cuota: "Notificación a todos los VIP".
- Si activas "Filtro CRM", la categoría aparece como filtro en el
  kanban de leads y clientes actuales.
- No abuses; 6–8 categorías bien definidas son más útiles que 30.
