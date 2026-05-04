/**
 * Genera una guía Word para managers explicando el sistema de alta de
 * cliente y cobro de cuotas en Round.
 */
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak,
  ExternalHyperlink, TableOfContents,
} = require('docx')

const C = {
  green: '2DD4A8',
  greenDark: '0F8F6F',
  blue: '5B9CF6',
  amber: 'FBBF24',
  red: 'F87171',
  violet: 'A78BFA',
  bgLight: 'F3F4F6',
  bgInfo: 'EFF6FF',
  bgWarn: 'FEF3C7',
  bgOk: 'D1FADF',
  bgErr: 'FEE2E2',
  border: 'CCCCCC',
  text2: '4B5563',
  text3: '9CA3AF',
}

const border = { style: BorderStyle.SINGLE, size: 4, color: C.border }
const borders = { top: border, bottom: border, left: border, right: border }
const cellMargin = { top: 80, bottom: 80, left: 120, right: 120 }

const FONT = 'Calibri'

// Helpers
const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 100 },
  ...opts,
  children: Array.isArray(text)
    ? text
    : [new TextRun({ text, font: FONT, size: 22, ...(opts.run || {}) })],
})
const h1 = text => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 360, after: 200 },
  children: [new TextRun({ text, font: FONT, size: 36, bold: true, color: '111827' })],
})
const h2 = text => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 140 },
  children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: '111827' })],
})
const h3 = text => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 200, after: 100 },
  children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: '111827' })],
})
const bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 80 },
  children: [new TextRun({ text, font: FONT, size: 22 })],
})
const num = (text, level = 0) => new Paragraph({
  numbering: { reference: 'pasos', level },
  spacing: { after: 100 },
  children: [new TextRun({ text, font: FONT, size: 22 })],
})

const callout = (label, text, fill, color) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [9360],
  rows: [new TableRow({ children: [
    new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      borders: { ...borders, left: { style: BorderStyle.SINGLE, size: 18, color } },
      shading: { fill, type: ShadingType.CLEAR },
      margins: cellMargin,
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: label, font: FONT, size: 22, bold: true, color })],
        }),
        new Paragraph({
          children: [new TextRun({ text, font: FONT, size: 22 })],
        }),
      ],
    }),
  ]})],
})
const note = text => callout('💡 Nota', text, C.bgInfo, '1E40AF')
const warn = text => callout('⚠ Atención', text, C.bgWarn, '92400E')
const tip = text => callout('✅ Recomendación', text, C.bgOk, '047857')

const placeholder = (descripcion) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [9360],
  rows: [new TableRow({ children: [
    new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      borders: {
        top:    { style: BorderStyle.DASHED, size: 6, color: C.text3 },
        bottom: { style: BorderStyle.DASHED, size: 6, color: C.text3 },
        left:   { style: BorderStyle.DASHED, size: 6, color: C.text3 },
        right:  { style: BorderStyle.DASHED, size: 6, color: C.text3 },
      },
      margins: { top: 200, bottom: 200, left: 200, right: 200 },
      shading: { fill: C.bgLight, type: ShadingType.CLEAR },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '📷 [Insertar captura aquí]',
                                   font: FONT, size: 22, bold: true, color: C.text3 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: descripcion, font: FONT, size: 20,
                                   italics: true, color: C.text2 })],
        }),
      ],
    }),
  ]})],
})

// Tabla 2 columnas
const tableTwo = (rows, headers) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3120, 6240],
  rows: [
    new TableRow({
      tableHeader: true,
      children: headers.map((h, i) => new TableCell({
        width: { size: i === 0 ? 3120 : 6240, type: WidthType.DXA },
        borders, margins: cellMargin,
        shading: { fill: C.green, type: ShadingType.CLEAR },
        children: [new Paragraph({
          children: [new TextRun({ text: h, font: FONT, size: 22, bold: true, color: 'FFFFFF' })],
        })],
      })),
    }),
    ...rows.map(r => new TableRow({ children: r.map((c, i) => new TableCell({
      width: { size: i === 0 ? 3120 : 6240, type: WidthType.DXA },
      borders, margins: cellMargin,
      children: [new Paragraph({
        children: [new TextRun({ text: c, font: FONT, size: 22, ...(i === 0 ? { bold: true } : {}) })],
      })],
    })) })),
  ],
})

const empty = () => new Paragraph({ children: [new TextRun('')] })

// ─── Contenido del documento ──────────────────────────────────────────────

const portada = [
  new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Round', font: FONT, size: 96, bold: true, color: C.greenDark })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 },
    children: [new TextRun({ text: 'Sistema de gestión de clientes y cobros',
                              font: FONT, size: 32, color: C.text2 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 },
    children: [new TextRun({ text: 'Guía del manager · Alta de cliente y cobro de cuotas',
                              font: FONT, size: 28, italics: true, color: C.blue })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1600 },
    children: [new TextRun({ text: `Versión 1.0 · ${new Date().toLocaleDateString('es-ES', { year:'numeric', month:'long' })}`,
                              font: FONT, size: 20, color: C.text3 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'round.wiemspro.com', font: FONT, size: 22, color: C.green })] }),
  new Paragraph({ children: [new PageBreak()] }),
]

const indice = [
  h1('Índice'),
  p('Esta guía cubre el flujo completo desde el momento en que un cliente se interesa por el centro hasta que su primera cuota queda cobrada en el sistema, pasando por la configuración previa que el manager debe haber hecho una sola vez.'),
  empty(),
  bullet('1. Visión general del sistema'),
  bullet('2. Configuración inicial (una sola vez)'),
  bullet('3. Alta de un cliente paso a paso'),
  bullet('4. Tipos de cobro de la primera cuota'),
  bullet('5. Recibos mensuales y emisión de remesas'),
  bullet('6. Devoluciones e impagos'),
  bullet('7. Resumen de roles: manager vs trainer'),
  bullet('8. Solución de problemas frecuentes'),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion1 = [
  h1('1. Visión general del sistema'),
  p('Round es el panel web que utilizas para gestionar tus clientes, sus cuotas y sus cobros. Está conectado a tres sistemas que trabajan en segundo plano:'),
  empty(),
  tableTwo([
    ['NoofitPro (mynoofit)', 'App móvil del cliente. El cliente se registra escaneando un QR del trainer y desde ahí accede a clases, reservas y comunicación.'],
    ['Odoo (round_facturacion)', 'ERP donde quedan registradas las suscripciones, los recibos y los cobros. Genera la remesa SEPA para el banco.'],
    ['Pasarela de pago (PayComet)', 'Procesa los enlaces de pago online del primer recibo y de los pagos puntuales. Cada trainer tiene su propia cuenta PayComet (o comparte con otros).'],
  ], ['Sistema', '¿Qué hace?']),
  empty(),
  note('No tienes que entrar a Odoo ni a PayComet directamente. Todo lo manejas desde la web Round. Esta guía explica qué configurar y qué pulsar.'),
  empty(),
  h2('Flujo en una imagen'),
  placeholder('Diagrama del flujo: Cliente escanea QR → mynoofit alta → Banner en Round → Trainer rellena ERP → Backend crea recibo en Odoo → Cobro (efectivo / TPV / enlace) → Recibo cobrado'),
  empty(),
  p('Resumen del recorrido del cliente:'),
  num('El cliente se da de alta en mynoofit escaneando un QR.'),
  num('La web Round muestra un banner "Nuevo cliente esperando cobro".'),
  num('El trainer rellena la pestaña ERP del cliente con su DNI, cuota, periodicidad y forma de pago.'),
  num('Al pulsar "Enviar a ERP" se crea automáticamente la suscripción y el primer recibo en Odoo.'),
  num('Según la forma de pago elegida, se cobra al instante (caja / TPV) o se genera un enlace para que pague online.'),
  num('A partir del mes siguiente, los recibos recurrentes se generan en bloque desde "Cuotas clientes → Generar remesa mensual".'),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion2 = [
  h1('2. Configuración inicial (una sola vez)'),
  p('Antes de poder dar de alta clientes con cobro, el manager debe configurar tres cosas en el menú Configuración:'),
  empty(),
  bullet('Cuotas — el catálogo de cuotas que tu centro ofrece (importes, periodicidades).'),
  bullet('Descuentos — descuentos reutilizables (familiar, estudiante, promoción…).'),
  bullet('Pasarelas (PayComet) — credenciales de la pasarela de pago para cada trainer que vaya a cobrar online.'),
  empty(),

  h2('2.1. Cuotas'),
  placeholder('Captura de Configuración → Cuotas con la lista de cuotas creadas y el botón "+ Nueva cuota".'),
  p('Cada cuota representa una modalidad de servicio. Por ejemplo:'),
  bullet('"RT 1D" — Round Training, 1 día por semana, 10 €/mes.'),
  bullet('"I MYGYM" — Sala libre mensual, 55 €/mes.'),
  bullet('"PERS 30M" — Personal Training 30 minutos, 110 €/mes.'),
  empty(),
  p('Para cada cuota debes indicar:'),
  bullet('Código corto (único, ej. RT 1D).'),
  bullet('Descripción legible.'),
  bullet('Precios por periodicidad: mensual, trimestral, semestral, anual (los que no apliquen, déjalos a 0).'),
  bullet('Matrícula opcional (importe único de alta).'),
  empty(),
  tip('Si tienes muchas cuotas con precios distintos por trainer, usa la pestaña "Trainer" en cada cuota para crear una variante específica de un trainer sin tocar la plantilla del manager.'),
  empty(),

  h2('2.2. Descuentos'),
  placeholder('Captura de Configuración → Descuentos con la lista y el formulario de creación.'),
  p('Un descuento se asigna a uno o varios clientes. Tipos:'),
  bullet('Porcentaje (ej. -10 %).'),
  bullet('Importe fijo (ej. -5 € sobre la cuota mensual).'),
  empty(),
  p('Cuando un cliente tiene un descuento asignado, se aplica automáticamente al calcular cada recibo mensual.'),
  empty(),

  h2('2.3. Pasarelas (PayComet)'),
  placeholder('Captura de Configuración → Pasarelas (PayComet) con la lista de trainers y el formulario de credenciales.'),
  p('Solo el manager ve esta pestaña (los trainers no tienen acceso a las credenciales). Para cada trainer del centro puedes:'),
  bullet('Pegar el API Token de PayComet (se guarda cifrado y no se muestra al editar; aparece como "abcd…wxyz").'),
  bullet('Indicar el número de Terminal (FUC).'),
  bullet('Activar el modo sandbox para pruebas.'),
  bullet('Marcar la cuenta como Activa o desactivada.'),
  empty(),
  warn('En el panel de PayComet de cada cuenta tienes que poner como URL de notificación: https://round.wiemspro.com/api/cuotas/paycomet-callback. Sin esto, los pagos no se marcan automáticamente como cobrados en Round.'),
  empty(),
  note('Si todavía no tienes credenciales reales de PayComet, Round funciona en modo "stub" para pruebas: genera enlaces simulados que abren una página interna donde puedes pulsar "Pagar" para ver el flujo completo.'),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion3 = [
  h1('3. Alta de un cliente paso a paso'),
  p('Hay dos caminos posibles según si el cliente es nuevo o ya existía en NoofitPro.'),
  empty(),

  h2('3.1. Caso A — Cliente nuevo'),
  p('Es el caso más habitual: alguien que nunca ha usado mynoofit.'),
  num('El trainer abre la web Round → menú "Clientes" → botón "Nuevo cliente". En esa pantalla aparece el QR del trainer.', 0),
  num('El cliente escanea el QR con la app mynoofit y completa su registro (nombre, email, foto…).', 0),
  num('Al terminar, queda automáticamente vinculado a este trainer.', 0),
  num('En segundos aparece en Round un banner verde-azul en lo alto de la pantalla: "Nuevo cliente esperando cobro".', 0),
  empty(),
  placeholder('Captura del QR del trainer en la pantalla "Nuevo cliente".'),
  empty(),
  placeholder('Captura del banner "Nuevo cliente esperando cobro" desplegado mostrando un cliente con botón "Atender".'),
  empty(),

  h2('3.2. Caso B — Cliente ya existente sin alta de cuota'),
  p('A veces un cliente ya está registrado en mynoofit (porque otro centro lo dio de alta, o porque solo quería reservar clases puntuales) y ahora quiere darse de alta como socio. En este caso:'),
  num('El trainer entra al perfil del cliente y pulsa el botón "Mostrar QR" en la barra de acciones.', 0),
  num('Aparece un QR específico del cliente (formato cliente:<id>).', 0),
  num('El cliente escanea ese QR desde mynoofit; se le pide su contraseña y se completan los datos que falten.', 0),
  num('A partir de ese momento aparece el banner "Nuevo cliente esperando cobro" en Round.', 0),
  empty(),
  placeholder('Captura del modal "Mostrar QR" en el perfil del cliente.'),
  empty(),

  h2('3.3. Atender al cliente desde el banner'),
  p('Independientemente del caso A o B, el trainer hace lo mismo:'),
  num('Click en el banner para desplegar la lista.', 0),
  num('Click en el botón verde "Atender" del cliente.', 0),
  num('Se abre el perfil del cliente directamente en la pestaña ERP, lista para rellenar.', 0),
  empty(),

  h2('3.4. Pestaña ERP del cliente'),
  placeholder('Captura del perfil del cliente con la pestaña ERP abierta y los campos visibles.'),
  empty(),
  p('Los campos que el trainer debe rellenar son:'),
  empty(),
  tableTwo([
    ['DNI / NIE', 'Documento de identidad del cliente.'],
    ['Móvil', 'Teléfono de contacto.'],
    ['Dirección, Localidad, Código postal', 'Datos para domicilio fiscal en el recibo.'],
    ['Curso / Tipo de cuota', 'Selector con todas las cuotas configuradas. Aparece su precio mensual entre paréntesis.'],
    ['Periodicidad', 'Mensual, Bimensual, Trimestral, Semestral, Anual.'],
    ['Forma de pago recurrente', 'Cómo cobrarás los recibos a partir del mes siguiente: SEPA (domiciliación bancaria), Tarjeta tokenizada, o Enlace de pago / caja.'],
    ['IBAN', 'Solo si la forma de pago recurrente es SEPA.'],
    ['Forma de la primera cuota', 'Cómo cobrar AHORA el primer recibo: Efectivo, TPV físico, Enlace de pago, o Aplazar al próximo recibo.'],
    ['Importe alta', 'Importe que cobrarás del primer recibo. Puede ser distinto al precio de la cuota (prorrateo, descuento, día parcial…). Step de 0,5 €.'],
    ['Matrícula', 'Importe único opcional de alta (puede ser 0).'],
    ['Fecha de alta', 'Por defecto hoy.'],
    ['Tipo de descuento', 'Si tiene un descuento del catálogo.'],
  ], ['Campo', 'Para qué sirve']),
  empty(),
  warn('Los campos marcados con asterisco rojo son obligatorios. El botón "Enviar a ERP" se deshabilita hasta que estén todos.'),
  empty(),
  num('Cuando todo está relleno, pulsa "Editar campos" para activar el modo edición, rellena, pulsa "Guardar".', 0),
  num('Después pulsa "Enviar a ERP". Verás un toast de confirmación con el número de recibo creado en Odoo.', 0),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion4 = [
  h1('4. Tipos de cobro de la primera cuota'),
  p('Según el valor que elijas en "Forma de la primera cuota", el sistema actúa de forma diferente:'),
  empty(),

  h2('4.1. Efectivo (caja)'),
  p('El cliente paga en metálico al trainer.'),
  bullet('Backend: el recibo se crea como Posted y se registra automáticamente un asiento de pago en el journal de Caja.'),
  bullet('Estado final: Recibo Cobrado.'),
  bullet('No hay enlace ni paso adicional.'),
  empty(),

  h2('4.2. TPV físico'),
  p('El cliente paga con tarjeta usando el datáfono físico del centro.'),
  bullet('Backend: el recibo se crea como Posted y se registra el pago en el journal de TPV.'),
  bullet('Estado final: Recibo Cobrado.'),
  bullet('Acuérdate de pasar la tarjeta por el datáfono — el sistema solo registra el asiento contable, el cobro físico lo haces tú.'),
  empty(),

  h2('4.3. Enlace de pago (PayComet)'),
  p('El cliente paga online con tarjeta, Bizum, etc. Es la opción más cómoda cuando no estás cara a cara con él.'),
  num('Al pulsar "Enviar a ERP", el backend habla con PayComet y genera un enlace único.', 0),
  num('Aparece un cuadro de diálogo con el enlace (que ya se ha copiado al portapapeles automáticamente).', 0),
  num('Pegas el enlace en WhatsApp, email o lo que uses. El cliente lo abre y paga.', 0),
  num('Cuando PayComet confirma el pago, llama a tu backend (callback) y el recibo se marca solo como cobrado en Odoo.', 0),
  empty(),
  placeholder('Captura del diálogo "Enlace de pago generado" tras pulsar Enviar a ERP.'),
  empty(),
  note('Si todavía no tienes la cuenta de PayComet activa, el sistema funciona en modo prueba: el enlace abre una página interna en Round con botones "Pagar" / "Rechazar" para validar el flujo.'),
  empty(),

  h2('4.4. Aplazar al próximo recibo'),
  p('El primer recibo no se cobra ahora; el importe se añade automáticamente al recibo del mes siguiente como cargo extra.'),
  bullet('Backend: el recibo de alta se crea Posted (queda registrado), y se crea una "modificación" tipo "cargo extra" para el mes siguiente con el importe.'),
  bullet('Cuando el manager genere la remesa del mes siguiente, ese cliente recibirá un recibo con su cuota habitual + ese cargo añadido.'),
  bullet('Útil cuando quieres hacer una cortesía al cliente en su primer mes o ya tiene domiciliado el resto.'),
  empty(),
  warn('"Aplazar" no significa "no cobrar". Significa "cobrar en el próximo recibo". El importe sigue contando.'),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion5 = [
  h1('5. Recibos mensuales y emisión de remesas'),
  p('Después del alta, los recibos recurrentes los gestionas en bloque desde el menú "Cuotas clientes".'),
  empty(),

  h2('5.1. Generar borradores'),
  num('Menú lateral → "Cuotas clientes" → pestaña "Generar remesa mensual".', 0),
  num('Selecciona el mes (por defecto el actual).', 0),
  num('Pulsa "Generar borradores". El sistema crea un recibo borrador para cada suscripción activa que toque cobrar este mes.', 0),
  num('Revisa la lista. Para cada borrador puedes editar el importe, vencimiento, notas o eliminarlo (lápiz / papelera). También puedes añadir descuentos puntuales o modificaciones.', 0),
  empty(),
  placeholder('Captura de la pantalla "Generar remesa mensual" con la tabla de borradores.'),
  empty(),

  h2('5.2. Resumen y comparativa'),
  p('Encima de la tabla aparece un cuadro con el importe total a emitir y desglose por cuota, forma de pago y descuentos. Cada métrica incluye los valores del mes anterior y del mismo mes del año pasado para que veas la evolución.'),
  empty(),
  placeholder('Captura del bloque "Resumen de remesa" con las cuatro KPI cards y las sub-tablas.'),
  empty(),

  h2('5.3. Emitir remesa'),
  num('Cuando estés conforme con los borradores, pulsa "Emitir remesa".', 0),
  num('El sistema posta todos los recibos. Para los recibos SEPA y los de tarjeta tokenizada se considera que están cobrados (in_payment / paid).', 0),
  num('Para los SEPA se genera un fichero pain.008 que descargas con el botón "Descargar SEPA" y subes a tu banco.', 0),
  num('Para los recibos de "enlace de pago / caja", quedan como Pendientes y los cobras manualmente o envías link.', 0),
  empty(),
  tip('La remesa SEPA solo se genera al pulsar "Emitir remesa". Es la única acción irreversible aquí — los borradores sí los puedes editar o borrar antes.'),
  empty(),

  h2('5.4. Pestañas adicionales'),
  bullet('Listado — todos los recibos con filtros (mes, estado, tipo, forma de pago, búsqueda).'),
  bullet('Devoluciones — para procesar impagos del banco (ver siguiente sección).'),
  bullet('Evolución — gráficas de evolución mensual por cuota, actividad, sexo, edad y forma de pago.'),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion6 = [
  h1('6. Devoluciones e impagos'),
  p('Cuando el banco devuelve un recibo SEPA, hay que registrarlo en Round para que el recibo vuelva a estar "Pendiente" y puedas iniciar el recobro.'),
  empty(),
  num('Menú lateral → "Cuotas clientes" → pestaña "Devoluciones".', 0),
  num('Hay tres formas de añadir devoluciones:', 0),
  bullet('Subir un fichero CSV o Excel del banco. El sistema detecta automáticamente columnas con nombres como "recibo", "referencia", "EndToEndID" o "motivo".', 1),
  bullet('Buscar por mes y cliente, y marcar uno a uno los recibos devueltos.', 1),
  num('Pulsa "Procesar devoluciones". Para cada recibo, se anula el pago automático y queda como No pagado.', 0),
  num('A partir de ese momento aparece como "Pendiente" en el listado y en el perfil del cliente. Puedes generarle un nuevo enlace de pago.', 0),
  empty(),
  placeholder('Captura de la pestaña "Devoluciones" con los tres bloques (subida fichero, selección por mes/cliente, tabla de filas a procesar).'),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion7 = [
  h1('7. Resumen de roles: manager vs trainer'),
  p('Round funciona con dos niveles de acceso, controlados desde tu cuenta de manager.'),
  empty(),
  tableTwo([
    ['Configurar cuotas, descuentos, modificaciones', '✅ Sí'],
    ['Configurar pasarelas PayComet de los trainers', '✅ Sí (solo manager)'],
    ['Ver clientes de todos los trainers del centro', '✅ Sí'],
    ['Generar y emitir remesa mensual', '✅ Sí'],
    ['Procesar devoluciones', '✅ Sí'],
    ['Ver evolución / dashboard', '✅ Sí'],
    ['Operar como un trainer concreto', '✅ Sí (impersonando)'],
  ], ['Acción', 'Manager']),
  empty(),
  tableTwo([
    ['Dar de alta clientes propios', '✅ Sí'],
    ['Enviar al ERP de sus clientes', '✅ Sí'],
    ['Ver el catálogo de cuotas y descuentos', '✅ Sí (solo lectura de las plantillas; las suyas las puede editar)'],
    ['Ver credenciales PayComet', '❌ No (solo manager)'],
    ['Generar remesa global', '❌ No (solo manager)'],
  ], ['Acción', 'Trainer']),
  empty(),
  note('Cuando el manager pulsa el avatar arriba a la izquierda y elige "Cambiar a trainer", entra en modo impersonado: ve el sistema como ese trainer. Puede volver a su sesión cuando quiera con el botón "Volver al gestor".'),
  new Paragraph({ children: [new PageBreak()] }),
]

const seccion8 = [
  h1('8. Solución de problemas frecuentes'),
  empty(),

  h3('"El botón Enviar a ERP está gris"'),
  p('Hay campos obligatorios sin rellenar (los marcados con *). Pasa el ratón por encima del botón para ver cuáles faltan.'),
  empty(),

  h3('"He recibido un toast «cuota X no encontrada»"'),
  p('La cuota seleccionada no existe en el catálogo del catálogo Odoo. Solución automática: el sistema crea la cuota sobre la marcha usando el importe del alta como precio mensual. Si quieres precios distintos por periodicidad, edita la cuota en Configuración → Cuotas después.'),
  empty(),

  h3('"El cliente pagó pero el recibo sigue como Pendiente"'),
  p('Verifica:'),
  bullet('Que has configurado la URL de notificación en el panel PayComet del trainer: https://round.wiemspro.com/api/cuotas/paycomet-callback.'),
  bullet('Que las credenciales del trainer (api_token + terminal) están en Configuración → Pasarelas y la pasarela está marcada como Activa.'),
  bullet('Que el modo no es Sandbox cuando ya estás en producción.'),
  empty(),

  h3('"No me aparece el banner Nuevo cliente esperando cobro"'),
  p('El sistema marca como "ya vistos" todos los clientes que existen la primera vez que entras al sistema (para no inundarte). A partir de ahí solo muestra los que se den de alta nuevos. Si por error marcaste alguno como "ya atendido" sin enviarlo a ERP, búscalo en la lista de clientes y entra al perfil para enviarlo manualmente.'),
  empty(),

  h3('"Quiero borrar un recibo borrador antes de emitir"'),
  p('En "Generar remesa mensual" pulsa el icono de papelera del borrador. Una vez emitida la remesa, los recibos posted se quedan en el sistema. Si quieres anularlos, marca el cliente como devolución para que vuelva a Pendiente.'),
  empty(),

  h3('"El trainer no ve la pestaña Pasarelas"'),
  p('Es correcto. La pestaña "Pasarelas (PayComet)" solo aparece para el manager y solo cuando NO está impersonando un trainer. Si el manager entra como trainer, esa pestaña desaparece.'),
  empty(),

  h3('"Cómo hago una prueba sin cobrar dinero real"'),
  p('Puedes probar todo el flujo sin gastar dinero:'),
  bullet('Para alta: usa Aplazar o Efectivo (no requieren pasarela).'),
  bullet('Para Enlace de pago: si no hay credenciales PayComet configuradas, el sistema genera un enlace stub que abre una página interna con botones simulados Pagar / Rechazar.'),
  empty(),
  tip('Cuando integres PayComet real, no hace falta cambiar nada en el código. Basta con guardar las credenciales en Configuración → Pasarelas.'),
]

const finale = [
  empty(),
  empty(),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '— Fin de la guía —', font: FONT, size: 20, italics: true, color: C.text3 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 },
    children: [new TextRun({ text: 'Para soporte técnico contacta con el equipo Round.', font: FONT, size: 18, color: C.text3 })] }),
]

// ─── Documento ───────────────────────────────────────────────────────────────

const doc = new Document({
  creator: 'Round',
  title: 'Guía manager — Sistema de alta y cobro',
  description: 'Guía operativa para managers del sistema Round',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: FONT, color: '111827' },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: '111827' },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: FONT, color: '111827' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        ] },
      { reference: 'pasos',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      ...portada,
      ...indice,
      ...seccion1,
      ...seccion2,
      ...seccion3,
      ...seccion4,
      ...seccion5,
      ...seccion6,
      ...seccion7,
      ...seccion8,
      ...finale,
    ],
  }],
})

const out = path.join('C:/Users/pc/Desktop/Claude_trabajo/web noofit/docs', 'Round - Guia del manager - Alta y cobro.docx')

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf)
  console.log('✅ Documento generado:', out)
  console.log('   Tamaño:', (buf.length / 1024).toFixed(1), 'KB')
}).catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
