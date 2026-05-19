# Manual Manager · 37 de 38 · Configuración — Catálogos

## Cómo llegar

Configuración → tab **📚 Catálogos**.

> 📷 **Captura: `37_catalogos_listado.png`** — sub-tabs de catálogos.

## Sub-tabs

### Motivos de baja

Lista de motivos cuando se da de baja un cliente:

- Mudanza
- Económico
- Lesión
- No le convence
- Cambio gimnasio
- Otro

### Razones lead perdido (CRM)

Lista de razones cuando un lead pasa a etapa "Perdido":

- Precio
- Horario no compatible
- Distancia
- Ya tiene gym
- No respondió
- Otro

### Tipos de modificación

(Cargos extra puntuales — ya configurados en doc 32)

### Categorías contabilidad

Lista de categorías de gasto:

- Luz
- Agua
- Alquiler
- Nómina
- Seguros sociales
- IRPF
- IVA
- Suministros
- Servicios profesionales
- Mantenimiento
- Marketing
- Otros

Cada categoría tiene asociada una **cuenta contable Odoo** (código
PGC español: 628, 640, 621…).

> 📷 **Captura: `37_catalogos_cuentas.png`** — mapping categoría →
> cuenta Odoo.

## Acciones

- **Crear / editar / borrar** entradas de cualquier catálogo
- **Marcar como activo / inactivo**
- **Reordenar** (drag & drop) — el orden afecta a cómo aparecen en
  los selectores

## Tips

- No borres motivos que ya estén asociados a clientes/leads;
  desactívalos.
- El **mapping con cuentas Odoo** es lo que permite generar los
  asientos `account.move` correctamente. Si añades una categoría
  nueva, asígnale cuenta antes de validar el primer documento.
