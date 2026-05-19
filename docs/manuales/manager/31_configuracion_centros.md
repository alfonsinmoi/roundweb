# Manual Manager · 31 de 38 · Configuración — Centros / Trainers

## Cómo llegar

Configuración → tab **🏢 Centros / Trainers**.

> 📷 **Captura: `31_centros_listado.png`** — tabla de centros.

## Qué muestra

Lista de los **centros (trainers)** que dependen de este manager.

| Columna | Contenido |
|---|---|
| Logo | Imagen del centro |
| Nombre | Razón social |
| Slug | Identificador URL (`malagacentro`, `anoreta`…) |
| CIF | NIF de facturación |
| Email contacto | Para CRM y notificaciones |
| Teléfono | Contacto |
| Estado | Activo / Pausado |

## Editar un centro

Click en una fila → modal con campos editables:

- **Datos fiscales**: razón social, CIF, dirección, código postal,
  ciudad, provincia
- **Contacto público**: email, teléfono, web, instagram
- **Slug** (no se puede cambiar una vez creado, rompe URLs)
- **Logo** (subir imagen)
- **Color corporativo** (hex)
- **Trainer NoofitPro** (id) — vínculo con la sala NoofitPro

> 📷 **Captura: `31_centro_editar.png`** — modal de edición abierto.

## Crear nuevo centro

Botón **"➕ Nuevo centro"** → asistente:

1. Datos básicos (nombre, slug, CIF)
2. Trainer NoofitPro existente o nuevo
3. Cuentas Odoo asociadas
4. Permisos del trainer (acceso a qué tabs)

## Tips

- El **slug** se usa en URLs públicas (`/prueba-gratuita?centro=slug`)
  y NO se puede cambiar.
- El **CIF receptor** debe coincidir con el de las facturas que
  recibes para que la doble auth no salte.
- Pausar un centro lo oculta de los selectores pero conserva su
  histórico.
