# Manual Manager · 12 de 38 · CRM · Enviar notificación a clientes

## Abrir el modal

CRM → Clientes actuales → **+ Nueva notificación** (arriba) o el `+` de
una columna concreta para empezar pre-seleccionada.

> 📷 **Captura: `12_modal_nueva_notif.png`** — modal abierto con todos
> los campos visibles.

## Pasos

### 1. Sección + tipo

- **Sección**: Cobros / Clases / Centro / Noticias (fija)
- **Tipo**: el catálogo cambia según la sección. Algunos están marcados
  `· auto` (los dispara el sistema automáticamente)

### 2. Audiencia

Dos modos:

**Un cliente / varios clientes** (multi-select):
- Buscador por nombre, email o id NoofitPro
- Click en cliente → lo añade a la lista (chip verde arriba)
- Click otra vez → lo quita
- Botón "Limpiar" para vaciar
- Toggle "Incluir inactivos" si quieres notificar a archivados

**Todos (broadcast)**:
- Va a TODOS los suscriptores de mynoofit, no solo los tuyos

### 3. Título y cuerpo

- **Título** (obligatorio) — el que se ve en el banner del push
- **Cuerpo** — texto del push
- **Cuerpo HTML** (solo en sección Noticias) — para webview enriquecido

### 4. Fecha de publicación

- **Enviar inmediatamente** (default activado) — sale al pulsar Enviar
- Si lo desmarcas, programa para la fecha+hora del datetime picker
  (default ahora + 30 min)

### 5. Otros campos opcionales

- **URL deep link** — enlace al que ir cuando el cliente toque el push
- **Fecha desaparición** — la app oculta la notif después

### 6. Enviar

Botón **"Enviar"** abajo a la derecha. Si todo OK, sale toast de éxito y
la notif aparece en su columna de la pantalla.

## Patrón "Notificar desde otra vista"

Desde otras pantallas (perfil cliente, cluster en Análisis patrones),
verás botones **"Notificar"** que abren este modal con la audiencia
ya pre-seleccionada (cliente concreto, o lista de un cluster, etc.).

## Tips

- Si seleccionas varios clientes, se manda **una sola notificación** que
  llega a todos pero se persiste como N filas en la BD para tracking
  individual de leídas (ver desglose con click en el contador).
- Al cancelar un envío programado, queda en estado "cancelada" — no se
  borra, queda en histórico.
