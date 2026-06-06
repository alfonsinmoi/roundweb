# Guía paso a paso — Formularios web → Leads en el embudo

Cómo crear un formulario, incrustarlo en la web del centro y trabajar los
leads que entran, hasta convertirlos en clientes. Pensado para el manager y
recepción.

> Resumen del recorrido: **creas el formulario → lo pegas en tu web → el visitante
> lo rellena → entra como lead "Nuevo" en tu embudo (CRM) → lo vas moviendo de
> etapa (con emails automáticos) → cuando se apunta, lo das de alta como cliente.**

---

## Parte 1 — Crear el formulario (en la web de Round)

1. Entra en la web (`https://noofit.wiemspro.com`) con tu usuario.
2. Ve a **Configuración → Formularios**.
3. Pulsa **Nuevo formulario** y rellena:
   - **Nombre**: para identificarlo internamente (p. ej. "Captación Home" o
     "Prueba gratis Añoreta"). El visitante no lo ve.
   - **Tipo**:
     - **Lead** → formulario de captación normal. Cada envío crea un **lead**
       en tu CRM.
     - **Prueba gratuita** → además de crear el lead, **reserva una clase de
       prueba** en un hueco libre del centro. Pide **DNI** (obligatorio) y deja
       elegir día/hora entre los slots disponibles.
   - **Campos**: marca los datos que quieres pedir (nombre, email, teléfono…).
     Mantén el formulario corto: cuantos menos campos, más gente lo completa.
4. **Guarda**.

> ⚠️ Los datos del lead se crean para **tu centro**: no se mezclan con los de
> otros centros del grupo.

---

## Parte 2 — Incrustar el formulario en tu web

Al guardar, la pantalla te muestra el **código para incrustar** (un `<iframe>`)
con un botón **Copiar**. Tiene esta forma:

```html
<iframe src="https://noofit.wiemspro.com/f/XXXXXXXX"
        width="100%" height="720" frameborder="0"
        style="border:0;max-width:480px"></iframe>
```

(`XXXXXXXX` es el identificador único de tu formulario.)

**Para pegarlo:**
- **WordPress**: edita la página, añade un bloque **"HTML personalizado"**
  (o "Embed/HTML") y pega ahí el código. Publica.
- **Otra web**: pega el `<iframe>` donde quieras que aparezca el formulario.

**Comprobar antes de publicar**: en la lista de formularios tienes un botón de
**Previsualizar** que abre la página pública `https://noofit.wiemspro.com/f/XXXXXXXX`.
Ábrelo y haz una prueba.

> 💡 Si el formulario se ve cortado (muchos campos), aumenta el alto en el
> código: cambia `height="720"` por `height="900"`, por ejemplo.
>
> ⚠️ Si **borras** el formulario en Configuración, el `<iframe>` deja de
> funcionar en tu web. No lo borres mientras esté publicado.

---

## Parte 3 — Qué pasa cuando alguien rellena el formulario

1. El visitante rellena y envía. **No necesita registrarse en nada.**
2. Se crea automáticamente un **lead** en tu CRM, en la etapa **"Nuevo"**.
3. Te llega un **email de aviso** ("Nuevo lead web — Nombre (tu centro)") para
   que sepas que hay alguien esperando.
4. **Si el formulario era de "Prueba gratuita"**, además:
   - Se le **reserva la plaza** en el día/hora que eligió.
   - El lead recibe un **email con un botón para confirmar** su reserva.
   - Si confirma, su reserva pasa a "confirmada"; **24 h antes** se le envía un
     **recordatorio** automático.

---

## Parte 4 — Trabajar el lead en el embudo (CRM)

Ve a **CRM** (embudo). Verás un tablero tipo *kanban* con columnas = etapas:

```
   Nuevo  →  Contactado  →  Visita  →  Prueba  →  Alta
                                              ( + Perdido )
```

**Cómo mover un lead:** arrástralo de una columna a otra. Cada vez que lo mueves
a una etapa, se dispara **un email automático al lead** correspondiente a esa
etapa (contactado / visita / prueba / alta).

Significado de cada etapa:
- **Nuevo** — acaba de entrar por el formulario; aún no lo has contactado.
- **Contactado** — ya has hablado con él (llamada/WhatsApp/email).
- **Visita** — viene a conocer el centro.
- **Prueba** — hace la clase de prueba.
- **Alta** — se apunta (se convierte en cliente).
- **Perdido** — no sigue. Al moverlo aquí, la web te pide el **motivo** (para
  analítica de por qué se pierden leads).

**Ayudas en el tablero:**
- **Color del lead (score)**: verde / ámbar / rojo indica la calidad/probabilidad
  del lead, calculada automáticamente. Prioriza los verdes.
- Puedes **filtrar** por color y por centro.
- Al abrir un lead ves su ficha: datos, origen, historial de etapas y notas.

---

## Parte 5 — Convertir el lead en cliente (Alta)

Cuando el lead se apunta:
1. Desde su ficha (o desde la de cliente), pulsa el botón **ERP / Alta** para
   darlo de alta como cliente: se crea/asigna su cuota, recibo y forma de pago.
2. El lead se **mueve solo a la etapa "Alta"** en el embudo.
3. A partir de ahí ya es un **cliente** y aparece en **Clientes** (activo).

---

## Resumen del flujo completo

```
Formulario en tu web
      │  (visitante lo rellena)
      ▼
Lead "Nuevo" en el CRM  ──►  email de aviso a recepción
      │                      (+ si es prueba: reserva slot + email al lead)
      ▼
Contactado ─► Visita ─► Prueba     (cada paso = email automático al lead)
      │
      ▼
   Alta  ──►  botón ERP  ──►  Cliente (cuota + recibo)
```

---

## Preguntas frecuentes

- **¿Puedo tener varios formularios?** Sí, tantos como quieras (uno por
  landing/campaña). Cada uno tiene su propio `<iframe>`.
- **¿Funciona en cualquier web?** Sí: la página `/f/<id>` es pública y se puede
  incrustar en cualquier sitio (WordPress, web propia, etc.).
- **¿Los leads de mi centro los ve otro centro?** No. Cada lead queda asignado a
  tu centro.
- **¿Dónde cambio los emails automáticos?** En **Configuración → Plantillas de
  email** (eventos `lead_creado`, `etapa_contactado`, `etapa_visita`,
  `etapa_prueba`, `etapa_alta`, recordatorios de prueba…).
- **¿Y si quiero cambiar los campos del formulario?** Edítalo en
  **Configuración → Formularios**; el mismo `<iframe>` ya publicado recoge los
  cambios (no hace falta volver a pegarlo).
