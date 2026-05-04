const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak, TabStopType, TabStopPosition,
} = require('docx');

const ARIAL = 'Arial';
const COLOR_GREEN = '1A9A7A';
const COLOR_DARK = '0E0F13';
const COLOR_GRAY = '5C6066';
const COLOR_LINE = 'CCCCCC';
const COLOR_AMBER = 'B45309';
const COLOR_BLUE = '1E40AF';

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE };
const ALL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const NO_BORDERS = { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                     bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                     left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                     right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } };

// Helpers
const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 280, after: 120 },
  pageBreakBefore: false,
  children: [new TextRun({ text, bold: true, size: 30, color: COLOR_GREEN, font: ARIAL })],
});
const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 220, after: 80 },
  children: [new TextRun({ text, bold: true, size: 24, color: COLOR_DARK, font: ARIAL })],
});
const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 180, after: 60 },
  children: [new TextRun({ text, bold: true, size: 20, color: COLOR_GREEN, font: ARIAL })],
});
const P = (...children) => new Paragraph({
  spacing: { after: 80, line: 280 },
  children: typeof children[0] === 'string'
    ? [new TextRun({ text: children[0], size: 18, font: ARIAL })]
    : children,
});
const T = (text, opts = {}) => new TextRun({ text, size: 18, font: ARIAL, ...opts });
const B = (text) => T(text, { bold: true });
const C = (text) => T(text, { font: 'JetBrains Mono', size: 17 }); // monospace

const BULLET = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 60, line: 260 },
  children: typeof text === 'string'
    ? [new TextRun({ text, size: 18, font: ARIAL })]
    : text,
});
const NUM = (text, level = 0) => new Paragraph({
  numbering: { reference: 'pasos', level },
  spacing: { after: 60, line: 260 },
  children: typeof text === 'string'
    ? [new TextRun({ text, size: 18, font: ARIAL })]
    : text,
});

// Caja de pantallazo (verde tenue)
const SHOT = (label) => new Paragraph({
  spacing: { before: 80, after: 100 },
  border: {
    top: { style: BorderStyle.SINGLE, size: 6, color: COLOR_GREEN },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_GREEN },
    left: { style: BorderStyle.SINGLE, size: 6, color: COLOR_GREEN },
    right: { style: BorderStyle.SINGLE, size: 6, color: COLOR_GREEN },
  },
  shading: { fill: 'E8F5F1', type: ShadingType.CLEAR },
  children: [new TextRun({
    text: '📷  PANTALLAZO: ' + label,
    bold: true, size: 18, color: COLOR_GREEN, font: ARIAL,
  })],
});

// Caja info (azul) y warning (ámbar)
const INFO = (text) => new Paragraph({
  spacing: { before: 80, after: 80 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: COLOR_BLUE },
            top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
  shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
  children: [new TextRun({ text: 'ℹ  ' + text, size: 17, color: COLOR_BLUE, font: ARIAL })],
});
const WARN = (text) => new Paragraph({
  spacing: { before: 80, after: 80 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: COLOR_AMBER },
            top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
  shading: { fill: 'FEF3C7', type: ShadingType.CLEAR },
  children: [new TextRun({ text: '⚠  ' + text, size: 17, color: COLOR_AMBER, font: ARIAL })],
});

const cellHeader = (text, width) => new TableCell({
  borders: ALL_BORDERS,
  width: { size: width, type: WidthType.DXA },
  shading: { fill: 'E8F5F1', type: ShadingType.CLEAR },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({
    children: [new TextRun({ text, bold: true, size: 16, color: COLOR_DARK, font: ARIAL })],
  })],
});
const cellBody = (text, width) => new TableCell({
  borders: ALL_BORDERS,
  width: { size: width, type: WidthType.DXA },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({
    children: [new TextRun({ text, size: 16, font: ARIAL })],
  })],
});

// ── Documento ────────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Round Training Center',
  title: 'Manual del CRM Round',
  styles: {
    default: { document: { run: { font: ARIAL, size: 18 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: ARIAL, color: COLOR_GREEN },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: ARIAL, color: COLOR_DARK },
        paragraph: { spacing: { before: 220, after: 80 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 20, bold: true, font: ARIAL, color: COLOR_GREEN },
        paragraph: { spacing: { before: 180, after: 60 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 220 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 220 } } } },
        ] },
      { reference: 'pasos',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 220 } } } },
          { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 220 } } } },
        ] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({ text: 'Round Training Center', bold: true, size: 16, color: COLOR_GREEN, font: ARIAL }),
            new TextRun({ text: '\tManual CRM · Manager y Trainers', size: 14, color: COLOR_GRAY, font: ARIAL }),
          ],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Página ', size: 14, color: COLOR_GRAY, font: ARIAL }),
            new TextRun({ children: [PageNumber.CURRENT], size: 14, color: COLOR_GRAY, font: ARIAL }),
            new TextRun({ text: ' de ', size: 14, color: COLOR_GRAY, font: ARIAL }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: COLOR_GRAY, font: ARIAL }),
          ],
        })],
      }),
    },
    children: [
      // ── Portada ───────────────────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 60 },
        children: [new TextRun({
          text: 'Manual del CRM Round', bold: true, size: 42, color: COLOR_DARK, font: ARIAL,
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({
          text: 'Configuración para manager · Operativa diaria para trainers',
          italics: true, size: 20, color: COLOR_GRAY, font: ARIAL,
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({
          text: 'round.noofit.com  ·  v1.0',
          size: 16, color: COLOR_GRAY, font: ARIAL,
        })],
      }),

      INFO('Este manual tiene dos partes claramente separadas. La PARTE 1 (Configuración) la realiza solo el manager una vez al inicio. La PARTE 2 (Operativa CRM) es la que cada trainer usa todos los días para gestionar sus leads.'),

      // ── Índice (manual) ──────────────────────────────────────────────────
      H2('Contenido'),
      P(B('PARTE 1 — Configuración inicial (manager)')),
      BULLET('1.1  Centros: dar de alta tus centros y el email de cada trainer.'),
      BULLET('1.2  Email transaccional: Resend o Gmail (uno por centro).'),
      BULLET('1.3  Plantillas de email: personalizar los textos que recibe el lead.'),
      BULLET('1.4  Pasarela PayComet: credenciales por trainer (cobros online).'),
      BULLET('1.5  Recaptación de clientes archivados (botón "Reactivar").'),
      BULLET('1.6  Conexión Instagram Lead Ads (en hoja de ruta).'),
      P(B('PARTE 2 — Operativa CRM (trainers)')),
      BULLET('2.1  Entrar al kanban y entender la pantalla.'),
      BULLET('2.2  Cómo se rellena un lead automáticamente desde la web.'),
      BULLET('2.3  Mover un lead de etapa: emails que se disparan solos.'),
      BULLET('2.4  Score y aviso “Sin contactar +24 h”.'),
      BULLET('2.5  Marcar un lead como perdido + motivos.'),
      BULLET('2.6  Embudo y analítica.'),
      BULLET('2.7  Recordatorios automáticos 24 h antes de la prueba.'),
      BULLET('2.8  Reservas de prueba con plaza ya elegida.'),

      new Paragraph({ children: [new PageBreak()] }),

      // ──────────────────────────────────────────────────────────────────────
      // PARTE 1
      // ──────────────────────────────────────────────────────────────────────
      H1('PARTE 1 — Configuración (solo manager)'),
      P(
        T('Toda la configuración vive en '), B('Configuración '),
        T('(menú lateral, icono '), C('⚙'),
        T('). Solo es visible cuando entras como '), B('manager'),
        T(' (no impersonando a un trainer). Tiene sub-pestañas; las relevantes para CRM son: '),
        B('Centros, Email, Plantillas email, Pasarelas.'),
      ),
      SHOT('Configuración — barra de pestañas con las opciones disponibles para el manager'),

      // 1.1 Centros
      H2('1.1  Centros'),
      P(T('Cada '), B('trainer de NoofitPro = un centro Round'), T('. El manager debe registrar aquí los datos de contacto y el email donde recibirá los leads.')),
      H3('Pasos'),
      NUM('Entra a Configuración → pestaña Centros.'),
      NUM('Verás la lista de trainers que NoofitPro tiene asociados a tu manager.'),
      NUM(['Para cada trainer, pulsa ', B('Editar'), T(' y completa:')]),
      BULLET([B('Nombre centro: '), T('cómo lo verá el lead (ej. ROUND MÁLAGA CENTRO).')], 1),
      BULLET([B('Slug: '), T('palabra corta sin espacios para enlaces (ej. '), C('malagacentro'), T('). Debe coincidir con el valor del select de centro en el formulario WordPress.')], 1),
      BULLET([B('Email: '), T('dirección donde el trainer recibirá los avisos de nuevos leads (su buzón real).')], 1),
      BULLET([B('Email CC (opcional): '), T('lista separada por comas para copiar al manager o secretaria.')], 1),
      BULLET([B('Teléfono y ciudad: '), T('aparecen en los emails al lead.')], 1),
      BULLET([B('Activo / Round-robin: '), T('si el lead no especifica centro y está activo, recibirá leads alternados.')], 1),
      NUM([B('Guardar.')]),
      SHOT('Configuración → Centros — formulario de edición de un centro con todos los campos rellenos'),
      WARN('El slug es CRÍTICO: si el formulario WP envía «malagacentro» y el centro está con slug «malaga-centro», el lead no se asignará correctamente y caerá al round-robin.'),

      // 1.2 Email
      H2('1.2  Email transaccional (Resend)'),
      P(T('Para que se envíen los emails automáticos (confirmaciones de prueba, avisos de etapa, recordatorios) necesitas conectar un proveedor. Recomendado: '), B('Resend'), T(' (3.000 emails/mes gratis, mejor entrega).')),
      H3('Crear cuenta Resend (5 min)'),
      NUM('Ve a resend.com y crea una cuenta con el email del manager.'),
      NUM('En Resend → API Keys → Create API Key. Copia la clave (empieza por re_…).'),
      NUM([T('En Resend → Domains → Add Domain → '), C('roundtrainingcenter.com'), T('. Copia los 3 registros DNS y pídeselos al hosting para que los añadan (TXT, MX, DKIM).')]),
      INFO('Mientras el dominio NO esté verificado en Resend, los emails se enviarán desde onboarding@resend.dev y muchos clientes los marcarán como spam. Verificar el dominio es prioritario.'),

      H3('Configurar en Round'),
      NUM('Entra a Configuración → pestaña Email.'),
      NUM([T('Selecciona proveedor '), B('Resend'), T(' (alternativa: Postmark o SMTP propio).')]),
      NUM('Pega la API Key.'),
      NUM([T('From email: '), C('hola@roundtrainingcenter.com'), T(' (cuando el dominio esté verificado).')]),
      NUM('From name: ej. ROUND MÁLAGA.'),
      NUM('Reply-To: el email donde quieres que llegue si el lead responde.'),
      NUM([B('Guardar configuración'), T('.')]),
      NUM([T('Pulsa '), B('Enviar prueba'), T(' con tu email para verificar que llega.')]),
      SHOT('Configuración → Email — selector de proveedor (Resend marcado), campos de credenciales y botón Enviar prueba'),

      // 1.3 Plantillas
      H2('1.3  Plantillas de email'),
      P(T('Cada vez que ocurre un evento del CRM (lead creado, etapa Visita, plaza confirmada…) Round busca una plantilla activa para ese evento y la envía. Puedes editar el texto, cambiar el asunto, o desactivarla.')),
      H3('Eventos disponibles'),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3000, 6360],
        rows: [
          ['lead_creado_lead', 'Cuando se registra un nuevo lead → email al lead "hemos recibido tu solicitud".'],
          ['lead_creado_trainer', 'Cuando se registra un nuevo lead → aviso al trainer del centro asignado.'],
          ['etapa_contactado_lead', 'Cuando el trainer mueve el lead a "Contactado".'],
          ['etapa_visita_lead', 'Cuando se mueve a "Visita" (visita al centro programada).'],
          ['etapa_prueba_lead', 'Cuando se mueve a "Prueba" (sesión de prueba reservada).'],
          ['etapa_alta_lead', 'Cuando se cierra la venta (etapa "Alta") → bienvenida.'],
          ['lead_perdido_lead', 'Cuando se marca el lead como perdido.'],
          ['slot_reservado_lead', 'Cuando rellena la prueba con slot picker → email para confirmar plaza (1 h).'],
          ['slot_confirmado_lead', 'Cuando confirma la plaza desde el email → "te esperamos".'],
          ['slot_recordatorio_lead', 'Automático 24 h antes de la prueba → recordatorio.'],
        ].map(([k, v]) => new TableRow({ children: [cellHeader(k, 3000), cellBody(v, 6360)] })),
      }),
      H3('Variables disponibles en el texto'),
      P(T('Dentro del asunto y del cuerpo HTML puedes usar marcadores como '), C('{{lead_name}}'), T(' o '), C('{{centro_name}}'), T(' que se sustituirán al enviar. Variables principales:')),
      BULLET([C('{{lead_name}}'), T(' '), C('{{lead_email}}'), T(' '), C('{{lead_phone}}'), T(' '), C('{{lead_message}}'), T(' '), C('{{cuota_interes}}')]),
      BULLET([C('{{centro_name}}'), T(' '), C('{{centro_email}}'), T(' '), C('{{centro_ciudad}}'), T(' '), C('{{trainer_phone}}')]),
      BULLET([C('{{slot_nombre}}'), T(' '), C('{{slot_fecha}}'), T(' '), C('{{slot_hora}}'), T(' '), C('{{confirm_url}}'), T(' '), C('{{expira_at}}')]),

      H3('Cómo personalizar'),
      NUM('Entra a Configuración → pestaña Plantillas email.'),
      NUM('Si nunca lo hiciste, pulsa "Cargar plantillas por defecto": rellena los textos base de los 9 eventos.'),
      NUM([T('Pulsa '), B('Editar'), T(' en la plantilla que quieras cambiar.')]),
      NUM([T('Modifica '), B('Asunto'), T(' y '), B('Cuerpo HTML'), T(' libremente. Las variables se renderizan al enviar.')]),
      NUM([T('Pulsa '), B('Enviar prueba'), T(' (con tu email) para ver el resultado real.')]),
      NUM([T('Marca '), B('Activa'), T(' para que se dispare cuando ocurra el evento.')]),
      SHOT('Configuración → Plantillas email — modal de edición con asunto, cuerpo HTML y panel de variables clic-para-copiar'),

      // 1.4 Pasarela
      H2('1.4  Pasarela PayComet'),
      P(T('Si vas a cobrar con tarjeta online (matrículas, primera cuota), configura las credenciales de PayComet por trainer.')),
      NUM('Configuración → pestaña Pasarelas.'),
      NUM([T('Para cada trainer, introduce '), B('API Token'), T(', '), B('Terminal'), T(', URL OK, URL KO, URL notif.')]),
      NUM([T('Marca '), B('Sandbox'), T(' al principio para probar sin cobros reales.')]),
      NUM([T('Cuando funcione, desmarca Sandbox y guarda.')]),
      SHOT('Configuración → Pasarelas — formulario PayComet con credenciales y switch sandbox/producción'),

      // 1.5 Recaptación de clientes archivados
      H2('1.5  Recaptación de clientes archivados'),
      P(T('Cualquier cliente archivado en NoofitPro (badge rojo '),
        B('"Desactivo"'),
        T(' en la lista) se puede reactivar como cliente facturable nuevo en un solo flujo.')),
      H3('Cómo funciona'),
      NUM([T('En '), B('Clientes'), T(' filtra por '), B('"Archivados"'), T('.')]),
      NUM([T('A la derecha de cada cliente verás un botón verde '), B('"Reactivar"'),
           T(' (sustituye al botón ERP normal cuando el cliente está desactivado).')]),
      NUM([T('Al pulsarlo se abre el mismo modal de envío al ERP '),
           T('con los datos editables: cuota, periodicidad, importe, forma de pago.')]),
      NUM([T('Al pulsar '), B('Guardar ERP'), T(', el sistema:'),]),
      BULLET('Crea cliente facturable en Odoo (con DNI, IVA 21%).', 1),
      BULLET('Reutiliza la suscripción si ya existía con la misma cuota; si no, crea una nueva.', 1),
      BULLET('Genera el recibo de alta y registra el pago.', 1),
      BULLET('Reactiva el cliente en NoofitPro automáticamente (badge pasa a verde "Activo").', 1),
      BULLET('Mueve el lead CRM Odoo asociado a la etapa "Alta" y le añade el tag "Recaptación".', 1),
      SHOT('Clientes filtrados por "Archivados" — botón verde "Reactivar" visible junto a cada fila'),
      SHOT('Modal "Reactivar" abierto con datos ERP editables del cliente'),
      INFO('La diferencia con un alta normal es invisible para el trainer: solo cambia internamente que se etiqueta como "Recaptación" para análisis posterior. El embudo CRM mostrará estos clientes como conversiones de re-engagement.'),

      // 1.6 Instagram
      H2('1.6  Instagram Lead Ads (próximamente)'),
      P(T('La integración con anuncios de Lead Ads de Instagram entrará por el mismo flujo del formulario web: cuando alguien rellene un anuncio de Instagram, Round recibirá el aviso, lo asignará al centro correcto y le enviará el email de bienvenida igual que un lead web.')),
      P(T('Estado: en hoja de ruta. Requiere acceso al Meta Business del centro y un webhook firmado. Cuando estemos listos, te pediremos:')),
      BULLET('Acceso a Meta Business → Páginas → Página del centro.'),
      BULLET('Token de larga duración del Meta Business (lo generamos juntos).'),
      BULLET('Confirmar qué campos del formulario de Instagram quieres mapear (nombre, email, teléfono, objetivo).'),
      INFO('Mientras tanto, el flujo web es 100% funcional. La activación de Instagram añadirá un canal más; no cambia ni la operativa diaria del trainer ni la configuración del manager.'),

      // ──────────────────────────────────────────────────────────────────────
      // PARTE 2
      // ──────────────────────────────────────────────────────────────────────
      new Paragraph({ children: [new PageBreak()] }),
      H1('PARTE 2 — Operativa CRM (trainers)'),
      INFO('Esta parte está pensada para imprimir y dejar en cada centro. Es lo que el trainer necesita en su día a día, sin entrar en configuración.'),

      // 2.1
      H2('2.1  Entrar al kanban'),
      NUM([T('Abre '), C('https://round.noofit.com'), T(' y entra con tu email/contraseña habitual.')]),
      NUM([T('En el menú lateral pulsa '), B('CRM · Leads'), T('.')]),
      NUM([T('Verás un tablero (kanban) con columnas: '), B('Nuevo · Contactado · Visita · Prueba · Alta'), T(' y, plegada a la derecha, '), B('Perdido'), T('.')]),
      SHOT('CRM Leads — vista kanban del trainer con varias tarjetas por columna'),
      P(T('Cada tarjeta es un lead. Muestra: nombre, email/teléfono (clicables), origen (web/Instagram/manual), score (0-100, color), fecha, y chips con sus datos extra (objetivo, presupuesto…).')),

      // 2.2
      H2('2.2  Cómo se rellenan los leads'),
      P(T('No tienes que crear leads a mano: entran solos por dos vías:')),
      BULLET([B('Formulario web'), T(' (roundtrainingcenter.com/prueba-gratuita): el lead elige tu centro y un día/hora de prueba. Llega a tu kanban en segundos.')]),
      BULLET([B('Instagram Lead Ads'), T(' (cuando esté activo): los anuncios de Instagram crean leads igual que el formulario web.')]),
      P(T('Cuando llega un lead nuevo:')),
      NUM([T('Tú recibes un '), B('email'), T(' con todos sus datos.')]),
      NUM([T('El '), B('lead recibe otro email'), T(' diciendo que has sido asignado y que le contactarás en 24 h.')]),
      NUM('La tarjeta aparece en la columna "Nuevo" del kanban.'),
      WARN('Tienes 24 h para moverlo a "Contactado". Pasado ese tiempo, su tarjeta se marca con un borde rojo y un icono ⚠ "Sin contactar +24 h" para que veas a la primera quién tienes pendiente.'),

      // 2.3
      H2('2.3  Mover un lead de etapa'),
      P(T('Arrastra la tarjeta de una columna a otra. Cada movimiento dispara automáticamente el email correspondiente al lead:')),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2000, 4000, 3360],
        rows: [
          [
            cellHeader('Etapa', 2000),
            cellHeader('Cuándo moverlo aquí', 4000),
            cellHeader('Email automático que recibe el lead', 3360),
          ],
          [
            cellBody('Nuevo', 2000),
            cellBody('Estado inicial. Lo gestiona el sistema, no tienes que hacer nada.', 4000),
            cellBody('"Hemos recibido tu solicitud" (al crearse).', 3360),
          ],
          [
            cellBody('Contactado', 2000),
            cellBody('Tras tu primer contacto efectivo (llamada, WhatsApp, email respondido).', 4000),
            cellBody('"Hemos hablado contigo" (resumen de lo acordado).', 3360),
          ],
          [
            cellBody('Visita', 2000),
            cellBody('Cuando concierta visita guiada al centro (sin entrenamiento).', 4000),
            cellBody('"Confirmamos tu visita en {centro}".', 3360),
          ],
          [
            cellBody('Prueba', 2000),
            cellBody('Cuando hace la sesión de prueba real.', 4000),
            cellBody('"Tu sesión de prueba está reservada".', 3360),
          ],
          [
            cellBody('Alta', 2000),
            cellBody('Tras firmar contrato y pagar matrícula. ¡Cliente!', 4000),
            cellBody('"¡Bienvenido a Round!" (datos de la app y panel cliente).', 3360),
          ],
          [
            cellBody('Perdido', 2000),
            cellBody('Cuando ya no va a convertir. Te pedirá motivo (ver 2.5).', 4000),
            cellBody('"Seguimos a tu disposición" (cierre amable).', 3360),
          ],
        ].map(row => new TableRow({ children: row })),
      }),
      SHOT('CRM Leads — arrastrando una tarjeta de Nuevo a Contactado'),

      // 2.4
      H2('2.4  Score y aviso “Sin contactar +24 h”'),
      P(T('Cada lead lleva un '), B('score 0-100'), T(' calculado por el sistema según los datos que dejó:')),
      BULLET([B('Verde (≥70): '), T('lead muy cualificado — datos completos, objetivo claro, etapa avanzada. Priorízalo.')]),
      BULLET([B('Amarillo (40-69): '), T('lead normal — sigue tu rutina habitual.')]),
      BULLET([B('Rojo (<40): '), T('datos incompletos o muy frío. Contáctalo igual, pero sin invertir mucho tiempo.')]),
      P(T('Por defecto las tarjetas en cada columna están '), B('ordenadas por score descendente'), T(': arriba los más prometedores.')),
      P(T('Si un lead lleva más de 24 h en "Nuevo" sin moverse, su tarjeta tendrá '), B('borde rojo'), T(' y el icono ⚠. Ese es el primer aviso de que estás perdiendo oportunidad.')),
      SHOT('CRM Leads — tarjeta con borde rojo y aviso "Sin contactar +24 h"'),

      // 2.5
      H2('2.5  Marcar lead como perdido'),
      P(T('Cuando arrastras un lead a la columna '), B('Perdido'), T(', se abre un modal pidiéndote el motivo (no se puede saltar). Esto es importante: nos permite analizar qué falla y mejorar.')),
      P(T('Motivos disponibles:')),
      BULLET('Demasiado caro · Ubicación inadecuada · No responde / contacto fallido · Horario incompatible · Eligió competencia · No está listo para empezar · Lead duplicado · Spam / fake · Otro.'),
      SHOT('CRM Leads — modal "¿Por qué se pierde este lead?" con dropdown de motivos'),

      // 2.6
      H2('2.6  Embudo y analítica'),
      P(T('En la cabecera del kanban tienes el botón '), B('Ver embudo'), T('. Despliega una tarjeta con tus métricas:')),
      BULLET('Total leads, abiertos, ganados, perdidos.'),
      BULLET('Tasa de conversión global %.'),
      BULLET('Score medio de tus leads.'),
      BULLET('Tiempo medio hasta primer contacto (debería ser <24 h).'),
      BULLET('Distribución por etapa (gráfico de barras).'),
      BULLET('Motivos de pérdida agregados.'),
      BULLET('Tiempo medio entre cada par de etapas (cuánto tarda un lead en pasar de Visita a Prueba, etc.).'),
      SHOT('CRM Leads — tarjeta "Embudo · analítica" desplegada con todas las métricas'),
      P(T('Tu manager ve esta misma información agregada para todos los centros y puede comparar entre trainers.')),

      // 2.7 Recordatorios automáticos
      H2('2.7  Recordatorios automáticos a 24h de la prueba'),
      P(T('El sistema envía '), B('automáticamente'),
        T(' un email recordatorio al lead 24 horas antes de su sesión de prueba (tras haber confirmado plaza). NO tienes que hacer nada — un cron se ejecuta cada 30 min y manda los recordatorios pendientes.')),
      BULLET('Solo se envía si la reserva está en estado "confirmada" (el lead pulsó el botón de confirmar tras el primer email).'),
      BULLET('Solo se envía UNA VEZ por reserva (queda marcado en BD para no duplicar).'),
      BULLET('Si el centro tiene Gmail propio configurado, sale desde ahí; si no, desde el fallback del manager.'),
      INFO('Plantilla del email: editable en Configuración → Plantillas email → "Recordatorio 24h antes de la prueba". Variables disponibles: {{lead_name}}, {{slot_nombre}}, {{slot_fecha}}, {{slot_hora}}, {{centro_name}}.'),

      // 2.8
      H2('2.8  Reservas de prueba con plaza ya elegida'),
      P(T('Cuando un lead rellena el formulario web y elige '), B('día y hora de prueba'), T(' directamente, ocurre todo esto sin que tú hagas nada:')),
      NUM('El sistema crea automáticamente al lead como CLIENTE en NoofitPro con su nombre, email, teléfono y DNI.'),
      NUM('Le apunta a la clase elegida (la verás en NoofitPro como un asistente más).'),
      NUM('Le manda un email pidiendo que confirme la plaza en 1 hora.'),
      NUM('Si confirma → recibe email "te esperamos" y la tarjeta del lead muestra el slot reservado.'),
      NUM('Si no confirma en 1 h → el sistema lo quita automáticamente de la clase, pero el cliente queda en NoofitPro para que tú puedas hacer follow-up.'),
      INFO('Cuando el lead se da de alta como cliente, NO tienes que volver a crearlo: ya existe en NoofitPro y la asistencia a la prueba queda en su histórico desde el primer día.'),
      WARN('Si en NoofitPro ves un cliente con DNI pero sin cuota asignada y con una sola clase reservada → es un lead pendiente de la prueba. NO lo borres: o convierte (asignándole cuota) o se quedará como contacto para campañas posteriores.'),

      // ── Cierre ────────────────────────────────────────────────────────────
      H1('Resolución rápida de problemas'),
      H3('No me llegan emails de leads nuevos'),
      BULLET('Comprueba tu carpeta SPAM las primeras semanas (sobre todo si Resend aún no tiene el dominio verificado).'),
      BULLET('Confirma que en Configuración → Centros tu email es el correcto.'),
      BULLET('Verifica que la pestaña Email del manager está activa y la API Key de Resend válida (botón Enviar prueba).'),

      H3('Un lead se ha asignado al centro equivocado'),
      BULLET('Pasa cuando el slug del centro en Configuración no coincide con el valor que envía el formulario WP. Avisa al manager para que lo revise.'),

      H3('Un lead aparece duplicado'),
      BULLET('No deberían duplicarse: el sistema busca por DNI y email antes de crear cliente NoofitPro. Si ves dos tarjetas iguales, repórtalo: probablemente es un lead anterior que volvió a rellenar el formulario.'),

      H3('Quiero cambiar el texto de un email automático'),
      BULLET('Solo el manager puede hacerlo, en Configuración → Plantillas email. No edites NoofitPro ni el formulario WP directamente.'),

      P(
        new TextRun({ text: '\n', font: ARIAL }),
        new TextRun({ text: 'Manual generado automáticamente · ', size: 14, color: COLOR_GRAY, italics: true, font: ARIAL }),
        new TextRun({ text: new Date().toISOString().slice(0, 10), size: 14, color: COLOR_GRAY, italics: true, font: ARIAL }),
        new TextRun({ text: ' · Round Training Center', size: 14, color: COLOR_GRAY, italics: true, font: ARIAL }),
      ),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, 'Manual_CRM_Round.docx');
  fs.writeFileSync(out, buf);
  console.log('OK ->', out, '(', buf.length, 'bytes )');
});
