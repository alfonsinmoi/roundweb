# Manual Manager · 4 de 38 · Listado de clientes

## Cómo llegar

Menú lateral → **Clientes**.

> 📷 **Captura: `04_clientes_listado.png`** — listado completo con filtros
> visibles arriba.

## Qué ves

Tabla con todos los clientes que gestionas, con columnas:

| Columna | Contenido |
|---|---|
| Cliente | Foto + nombre + apellidos |
| Categoría | Badge de categoría (Gympass, Trabajador, Invitado…) o vacío |
| Email | Email del cliente |
| Estado | Activo / Inactivo (con fecha de inactivación si aplica) |
| Teléfono | — |
| DNI | — |
| ERP | (si está activado) botón para alta en Odoo |

## Filtros disponibles

En la barra de herramientas:

1. **Buscador** — por nombre, email, alias, gympass id
2. **Estado**: Activos / Inactivos / Todos
3. **Categoría**: dropdown con todas las categorías + "Sin categoría
   (pagador con cuota)"
4. **Solo Gympass** (compatibilidad legacy)

> 📷 **Captura: `04_clientes_filtros.png`** — toolbar con todos los filtros.

## Acciones por fila

- **Click en la fila** → abre el perfil del cliente
- **Click en la foto** → preview ampliado de la imagen (10×10 cm)
- **Botón ERP** (si está activado) — abre modal para crear alta Odoo

## Paginación

15 clientes por página. Navegación con botones ▶ ◀ y selección directa
de página.

## Stats

Arriba muestra:

- Total clientes filtrados
- Cuántos no tienen foto (en ámbar si > 0)

## Tips

- Por defecto solo se ven **Activos**. Cambia a Todos si buscas a uno
  archivado.
- La búsqueda es instantánea (no hace falta pulsar Enter).
- Si tienes muchos clientes, usa primero el filtro de categoría para
  reducir la lista antes de buscar.
