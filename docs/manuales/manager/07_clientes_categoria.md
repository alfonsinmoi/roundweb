# Manual Manager · 7 de 38 · Categorías de cliente

Las **categorías** te permiten clasificar clientes por tipo (Gympass,
Trabajador, Invitado…) y aplicar reglas distintas según su categoría.

## Categorías por defecto

Round siembra automáticamente 3 categorías la primera vez:

| Categoría | Reservar clases | Tiene cuota | Color |
|---|---|---|---|
| **Gympass** | ✅ | ❌ | morado |
| **Trabajador** | ✅ | ❌ | cian |
| **Invitado** | ✅ | ❌ | ámbar |

Sin categoría asignada = "Pagador con cuota" (cliente normal).

## Asignar categoría a un cliente

1. Abrir perfil del cliente.
2. En el tab **Datos personales**, card **"Categoría y fechas"**.
3. Selector dropdown **"Categoría"** → elegir.

> 📷 **Captura: `07_perfil_categoria.png`** — la card de categoría con
> el dropdown abierto.

Cambio inmediato. Si la categoría tiene `puede_reservar=false` o está
inactiva, sale aviso ámbar bajo el selector.

## Filtrar clientes por categoría

En el listado de clientes, dropdown **"Categoría"** en la toolbar.

## Crear / editar categorías

Ver doc 32 · "Configuración → Categorías de cliente".

## Tips

- **Sin categoría** = cliente con cuota normal. No hace falta poner
  "Pagador" explícito.
- Si una categoría se marca **inactiva**, los clientes asignados pierden
  acceso a reservar (configurable).
- Las categorías son **per manager** — cada manager tiene las suyas.
