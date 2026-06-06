/* Genera Planificacion_Round_Malagacentro.docx — v2 */
const fs = require('fs')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageBreak,
} = require('docx')

const FONT = 'Arial'
const ACCENT = '10B981'
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({ text, font: FONT, size: opts.size || 22, bold: opts.bold, italics: opts.italics, color: opts.color })],
  })
}
function R(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: opts.size || 22, bold: opts.bold, italics: opts.italics, color: opts.color })
}
function H1(text) { return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 180 }, children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: '0F172A' })] }) }
function H2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 140 }, children: [new TextRun({ text, font: FONT, size: 26, bold: true, color: '1E293B' })] }) }
function H3(text) { return new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 }, children: [new TextRun({ text, font: FONT, size: 22, bold: true, color: '334155' })] }) }
function bullet(text) {
  return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, font: FONT, size: 22 })] })
}
function bulletR(runs) { return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 40, after: 40 }, children: runs }) }

function cell(content, opts = {}) {
  const children = (Array.isArray(content) ? content : [content]).map(c =>
    typeof c === 'string'
      ? new Paragraph({ alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text: c, font: FONT, size: opts.size || 20, bold: opts.bold, color: opts.color })] })
      : c)
  return new TableCell({
    borders: cellBorders, width: { size: opts.width || 1000, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children,
  })
}

function buildTable({ widths, header, rows }) {
  const totalWidth = widths.reduce((a, b) => a + b, 0)
  const rs = [
    new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { width: widths[i], bold: true, fill: ACCENT, color: 'FFFFFF', center: true })) }),
    ...rows.map(r => new TableRow({
      children: r.map((c, i) => {
        const opts = typeof c === 'object' && c !== null && !Array.isArray(c) && c.text !== undefined
          ? { width: widths[i], ...c, text: undefined } : { width: widths[i] }
        const text = typeof c === 'object' && c !== null && !Array.isArray(c) && c.text !== undefined ? c.text : c
        return cell(text, opts)
      }),
    })),
  ]
  return new Table({ width: { size: totalWidth, type: WidthType.DXA }, columnWidths: widths, rows: rs })
}

const children = []

// Portada
children.push(
  new Paragraph({ spacing: { before: 600, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Round Málaga Centro', font: FONT, size: 28, color: '64748B' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Planificación de Personal', font: FONT, size: 48, bold: true, color: '0F172A' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 },
    children: [new TextRun({ text: 'Cómo se transformó tu Excel "HORARIOS ROUND.xlsx"', font: FONT, size: 24, italics: true, color: '475569' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'en los datos del módulo Control horario', font: FONT, size: 24, italics: true, color: '475569' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 },
    children: [new TextRun({ text: 'Versión 2 · Mayo 2026', font: FONT, size: 22, color: '64748B' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 },
    children: [new TextRun({ text: 'Incluye pico simultáneo, compatibilidades, plantillas reutilizables, replicación y vista mensual.',
                             font: FONT, size: 20, italics: true, color: '94A3B8' })] }),
  new Paragraph({ children: [new PageBreak()] }),
)

// 1
children.push(H1('1.  Resumen ejecutivo'))
children.push(P('Tu Excel era una parrilla por trabajador y franja de 15 minutos, donde cada celda llevaba un código (MG, RT, R4W). El sistema lo necesita estructurado en piezas separadas. Este documento explica la conversión, qué obtienes a cambio y todas las pestañas disponibles.'))

children.push(H2('Equivalencia Excel ↔ Sistema'))
children.push(buildTable({
  widths: [3000, 3500, 3000],
  header: ['Tu Excel decía…', 'En el sistema se guarda como…', 'Pestaña donde verlo'],
  rows: [
    ['Códigos MG, RT, R4W en las celdas', '4 puestos (MG, RT, R4W, AC)', 'Planificación → Puestos y demanda'],
    ['Cuántos monitores cubrían cada franja', 'Demanda por puesto, día y franja', 'Planificación → Puestos y demanda'],
    ['Trabajadores (Fran, Marcelo, Hugo)', 'Trabajadores con NIF + jornada', 'Trabajadores'],
    ['Lo que sabe hacer cada uno', 'Capacidades del trabajador', 'Trabajadores → Capacidades'],
    ['Horas trabajadas por día/trabajador', 'Horario teórico semanal', 'Trabajadores → Horario'],
    ['(No estaba) Turnos reutilizables', 'Plantillas de turno con nombre descriptivo', 'Planificación → Plantillas'],
    ['Asignación semanal por persona y día', 'Calendario semanal con buffer + bulk save', 'Planificación → Calendario semanal'],
    ['(No estaba) Vista mes entero', 'Tabla trabajador × días del mes', 'Planificación → Vista mensual'],
    ['(No estaba) Horas por trabajador', 'Calendario por trabajador con expand', 'Planificación → Calendario trabajador'],
    ['(No estaba) Mapa de cobertura', 'KPIs verde/rojo/ámbar + horas por puesto', 'Planificación → Cobertura'],
    ['(No estaba) Análisis equilibrio', 'Mañana/tarde, partidos, % jornada', 'Planificación → Equilibrio'],
  ],
}))

// 2
children.push(H1('2.  Las piezas creadas'))
children.push(H2('2.1  Temporada (1)'))
children.push(P('Una sola temporada "Permanente". Para horarios estacionales basta con crear otra y el sistema aplica la apertura/demanda según la fecha.'))

children.push(H2('2.2  Horario de apertura (11 bloques)'))
children.push(buildTable({
  widths: [2000, 7500], header: ['Día', 'Bloques de apertura'],
  rows: [
    ['Lunes',     '08:00–13:00   y   15:00–22:00'],
    ['Martes',    '08:00–13:00   y   14:00–20:00'],
    ['Miércoles', '08:00–13:00   y   15:00–22:00'],
    ['Jueves',    '08:00–13:00   y   14:00–20:00'],
    ['Viernes',   '08:00–15:00   y   17:00–20:00'],
    ['Sábado',    '09:00–13:00'],
    ['Domingo',   'Cerrado'],
  ],
}))

children.push(H2('2.3  Puestos de trabajo (4) y compatibilidades'))
children.push(buildTable({
  widths: [1200, 2300, 6000], header: ['Código', 'Nombre', 'Qué significa'],
  rows: [
    ['MG',  'MyGym',              'Vigilancia de gimnasio cuando no hay clase.'],
    ['RT',  'Round Training',     'Clases dirigidas Round entre semana.'],
    ['R4W', 'Round For Weekend',  'Clases del fin de semana (viernes tarde + sábado mañana).'],
    ['AC',  'Atención al cliente','Mostrador para socios. 1 hora al día.'],
  ],
}))
children.push(H3('Compatibilidad MG ⇄ AC'))
children.push(P('Un mismo trabajador puede vigilar MyGym y atender el mostrador a la vez. El sistema lo respeta al calcular cobertura — basta asignar 1 persona a MG en esa franja, cuenta también como AC cubierto.'))
children.push(P('Importante: las compatibilidades solo llenan déficit. Si tienes 2 personas en MG y 1 demanda de AC, NO genera exceso de AC.', { italics: true, color: '475569' }))

children.push(H2('2.4  Demanda (58 franjas)'))
children.push(P('He recorrido celda a celda tu Excel y, donde había código, sumé 1 trabajador para ese puesto en esa franja.'))
children.push(buildTable({
  widths: [1500, 1500, 2000, 1500, 3000],
  header: ['Día', 'Puesto', 'Franja', 'Necesito', 'De dónde viene'],
  rows: [
    ['Lunes', 'RT',  '15:00 – 21:45', '1 persona',  'Marcelo + Fran (relevo)'],
    ['Lunes', 'MG',  '11:30 – 12:00', '2 personas', 'Coincidían Marcelo y Hugo'],
    ['Martes','RT',  '14:15 – 15:00', '1 persona',  'Fran'],
    ['Sábado','R4W', '09:00 – 13:00', '1 persona',  'Marcelo'],
    ['L–S',   'AC',  '11:00 – 12:00', '1 persona',  'Añadido como ejemplo'],
  ],
}))
children.push(P('Total: 58 franjas (52 derivadas del Excel + 6 de AC).', { italics: true, color: '64748B' }))

children.push(new Paragraph({ children: [new PageBreak()] }))

// 3 Validación
children.push(H1('3.  Validación: las cuentas cuadran con tu Excel'))
children.push(buildTable({
  widths: [2200, 1500, 1500, 4000],
  header: ['Trabajador', 'Excel (h)', 'Sistema (h)', 'Detalle por día'],
  rows: [
    ['Francisco Gil', '24,50', { text: '24,50 ✓', bold: true, color: '10B981' }, 'L 3h · M 1,5h · X 7h · J 7,25h · V 5,75h'],
    ['Marcelo Vona',  '30,00', { text: '30,00 ✓', bold: true, color: '10B981' }, 'L 8,5h · M 8,5h · X 6h · V 3h · S 4h'],
    ['Hugo Martín',   '14,00', { text: '14,00 ✓', bold: true, color: '10B981' }, 'L 1,5h · M 4,5h · J 8h'],
    ['TOTAL', { text: '68,50', bold: true }, { text: '68,50 ✓', bold: true, color: '10B981' }, 'Coincide con el "TOTAL SEMANA" del Excel.'],
  ],
}))

// 4 Plantillas
children.push(new Paragraph({ children: [new PageBreak()] }))
children.push(H1('4.  Plantillas de turno (12 reutilizables)'))
children.push(P('Las plantillas son turnos reutilizables. Se nombran por su PATRÓN horario (no por el monitor), de forma que dos trabajadores con el mismo turno comparten plantilla.'))
children.push(buildTable({
  widths: [4500, 5000],
  header: ['Plantilla', 'Quién la usa'],
  rows: [
    ['08-11:30 MG/RT · 17:30-22 RT/MG (8h)',  'Hugo (J): mañana + tarde'],
    ['08-12 MG/RT · 14-18:30 MG/RT (8.5h)',   'Marcelo (M)'],
    ['08-12 MG/RT · 14:30-19 MG/RT (8.5h)',   'Marcelo (L)'],
    ['08-13 MG/R4W · 14:15-15 R4W (5.8h)',    'Fran (V)'],
    ['08-13 MG/RT · 15-17 RT (7h)',           'Fran (X)'],
    ['09-13 MG · 14:15-17:30 RT (7.2h)',      'Fran (J)'],
    ['09-13 R4W/MG (4h)',                     'Marcelo (S)'],
    ['11:30-13 MG (1.5h)',                    { text: 'Compartida: Fran (M) y Hugo (L)', italics: true, color: '10B981' }],
    ['16-22 MG/RT (6h)',                      'Marcelo (X)'],
    ['17-20 MG/R4W (3h)',                     'Marcelo (V)'],
    ['17:30-22 RT/MG (4.5h)',                 'Hugo (M)'],
    ['19-22 RT/MG (3h)',                      'Fran (L)'],
  ],
}))

// 5 Asignaciones semana
children.push(H1('5.  Asignaciones de la semana en curso'))
children.push(P('Semana del 25 al 31 de mayo de 2026:'))
children.push(buildTable({
  widths: [1500, 1300, 1300, 1300, 1300, 1300, 1300, 500],
  header: ['Trabajador', 'L 25', 'M 26', 'X 27', 'J 28', 'V 29', 'S 30', 'D'],
  rows: [
    ['Fran',     '19-22',      '11:30-13', '08-13·15-17', '09-13·14:15-17:30', '08-13·14:15-15', '—', '—'],
    ['Marcelo',  '08-12·14:30-19', '08-12·14-18:30', '16-22', '—', '17-20', '09-13', '—'],
    ['Hugo',     '11:30-13',   '17:30-22', '—', '08-11:30·17:30-22', '—', '—', '—'],
  ],
}))

// 6 Las 8 pestañas
children.push(new Paragraph({ children: [new PageBreak()] }))
children.push(H1('6.  Las 8 pestañas de Planificación'))

children.push(H2('6.1  Temporadas y apertura'))
children.push(P('CRUD de temporadas + editor de horario apertura con tabla franjas × 7 días (checkbox por día).'))

children.push(H2('6.2  Puestos y demanda'))
children.push(P('CRUD de puestos con color, matriz de compatibilidades, y editor de demanda como tabla franjas × 7 días con número de personas requeridas. Muestra personas-hora por día.'))

children.push(H2('6.3  Plantillas de turno'))
children.push(P('Lista de plantillas con sus bloques internos editables. Las plantillas con bloques idénticos se fusionan automáticamente para ser reutilizables (ver "11:30-13 MG" compartida por Fran y Hugo).'))

children.push(H2('6.4  Calendario semanal'))
children.push(P('Grid trabajador × 7 días con selector de plantilla en cada celda. Cambios en buffer (badge "● N sin guardar"), se aplican todos al pulsar Guardar.'))
children.push(H3('Botones de replicación (arriba)'))
children.push(buildTable({
  widths: [2500, 7000],
  header: ['Botón', 'Qué hace'],
  rows: [
    ['📋 Copiar anterior', 'Trae las asignaciones de la semana anterior (1 click).'],
    ['🔁 Replicar…',       'Modal: replica esta semana en las próximas N semanas. Útil para "este patrón durante 2 meses".'],
    ['🔀 Patrón…',         'Modal: defines 2–6 semanas plantilla (A, B, C…) y N ciclos. Alterna A,B,A,B… durante N×len(plantillas) semanas. Ideal para turnos rotatorios.'],
  ],
}))

children.push(H2('6.5  Vista mensual'))
children.push(P('Tabla read-only con filas = trabajadores y columnas = todos los días del mes. Cada celda muestra una píldora con la plantilla asignada (color heredado). Para editar se vuelve al Calendario semanal.'))

children.push(H2('6.6  Calendario trabajador'))
children.push(P('Tabla con 1 fila por trabajador y columnas Lun–Dom + Total semanal + Jornada (real / contrato con color rojo/verde/ámbar). Click en el ▾ despliega detalle día a día con:'))
children.push(bullet('Cards por día con horas totales del día'))
children.push(bullet('Chips por actividad (puesto) con sus bloques horarios exactos'))
children.push(bullet('Total semanal por actividad arriba'))

children.push(H2('6.7  Cobertura'))
children.push(P('Compara demanda vs asignaciones reales usando PICO SIMULTÁNEO (no recuento de trabajadores con solapamiento).'))
children.push(H3('Por qué pico simultáneo'))
children.push(P('Si Marcelo cubre RT 14:30-19:00 y Fran cubre RT 19:00-22:00, son relevo — solo hay 1 persona en cada instante, no 2. Antes el sistema contaba 2 trabajadores distintos y marcaba exceso falso. Ahora calcula concurrencia real con sweep-line.'))
children.push(buildTable({
  widths: [1500, 8000], header: ['Color', 'Significado'],
  rows: [
    ['🟩 Verde', 'OK: pico simultáneo = requerido'],
    ['🟥 Rojo',  'Crítico: pico simultáneo < requerido (déficit)'],
    ['🟨 Ámbar', 'Sobre-cobertura: pico simultáneo > requerido. Las compatibilidades NO generan ámbar — solo llenan déficit.'],
  ],
}))

children.push(H2('6.8  Equilibrio'))
children.push(P('Análisis comparativo entre trabajadores. KPIs promedio del equipo + 2 tablas:'))
children.push(H3('Tabla 1 — Carga semanal'))
children.push(buildTable({
  widths: [2200, 7300],
  header: ['Columna', 'Qué mide'],
  rows: [
    ['Total',          'Horas totales planificadas en la semana'],
    ['% Jornada',      'Horas ÷ jornada contractual. Rojo <85%, verde 85-105%, ámbar >105%'],
    ['Mañana / Tarde', 'Barra de distribución entre <14:00 y ≥14:00'],
    ['Finde',          'Horas en sábado + domingo'],
    ['Turnos',         'Número de bloques de trabajo en la semana'],
    ['Días partidos',  'Días con ≥2 bloques separados por hueco ≥1 hora (rojo si >0)'],
  ],
}))
children.push(H3('Tabla 2 — Distribución por actividad'))
children.push(P('Matriz trabajador × puesto en horas/semana. Sirve para ver sobrecarga en un puesto o rotación equilibrada.'))

// 7 Config empresa
children.push(new Paragraph({ children: [new PageBreak()] }))
children.push(H1('7.  Configuración de empresa (manager + trainers)'))
children.push(P('En Control horario → Configuración → "Datos de empresa por trainer / centro" rellenas los datos jurídicos. Cambios recientes:'))
children.push(bulletR([R('👑 '), R('Manager primero ', { bold: true }), R('en la lista (icono corona dorada).')]))
children.push(bulletR([R('✅ Badge '), R('"Configurado"', { bold: true }), R(' en verde si tiene razón social o CIF. ⚪ '), R('"Sin datos"', { bold: true }), R(' en gris si está vacío.')]))
children.push(bulletR([R('📋 Botón '), R('"Copiar a otros trainers…"', { bold: true }), R(' visible solo en la ficha del manager. Abre modal con multi-selección.')]))
children.push(bulletR([R('Modal: '), R('"Seleccionar todos"', { bold: true }), R(' + lista checkbox. Trainers con datos previos muestran '), R('"⚠ se sobrescribe"', { color: 'F59E0B' }), R('.')]))

// 8 Workflow
children.push(H1('8.  Cómo replicar futuras semanas'))
children.push(P('Una vez tienes la configuración base (apertura + puestos + demanda + plantillas + capacidades), cada semana solo requiere:'))
children.push(bulletR([R('1. Planificación → Calendario semanal')]))
children.push(bulletR([R('2. Avanzar a la semana deseada con '), R('▶', { bold: true })]))
children.push(bulletR([R('3. '), R('📋 Copiar anterior', { bold: true }), R(' (1 click) o '), R('🔁 Replicar', { bold: true }), R(' (varias semanas a la vez)')]))
children.push(bulletR([R('4. Ajustar lo que cambie (vacaciones, días libres) tocando celdas individuales')]))
children.push(bulletR([R('5. '), R('Guardar', { bold: true })]))
children.push(bulletR([R('6. '), R('Cobertura', { bold: true }), R(' → verificar verde. Rojos = añadir gente. Ámbar = quizá sobra.')]))
children.push(bulletR([R('7. '), R('Equilibrio', { bold: true }), R(' → asegurar que nadie esté al 130% de jornada ni con 5 días partidos seguidos')]))

children.push(H2('Patrón rotativo A/B'))
children.push(P('Si tu plantilla cambia cada N semanas:'))
children.push(bulletR([R('1. Asigna manualmente la '), R('semana A', { bold: true }), R(' y la '), R('semana B', { bold: true })]))
children.push(bulletR([R('2. Botón '), R('🔀 Patrón…', { bold: true }), R(': Semana A = lunes A, Semana B = lunes B, "Empezar el lunes" = primer ciclo, Ciclos = N → N×2 semanas pobladas.')]))

// 9 Changelog
children.push(new Paragraph({ children: [new PageBreak()] }))
children.push(H1('9.  Cambios desde la versión 1'))
children.push(buildTable({
  widths: [3500, 6000],
  header: ['Qué cambió', 'Detalle'],
  rows: [
    ['Fix cobertura — pico simultáneo',         'Antes contaba 2 personas con solapamiento como exceso. Ahora calcula concurrencia real con sweep-line. Relevo Marcelo→Fran = 1 persona.'],
    ['Fix compatibilidades MG⇄AC',              'Antes generaban exceso falso de AC. Ahora solo llenan déficit, nunca generan exceso.'],
    ['Plantillas renombradas',                   'De "Marcelo L (8.5h)" a "08-12 MG/RT · 14:30-19 MG/RT (8.5h)". Describen el patrón, no el monitor.'],
    ['Plantillas duplicadas fusionadas',         '"11:30-13 MG (1.5h)" la comparten Fran (M) y Hugo (L). Reutilizable de verdad.'],
    ['Nueva pestaña — Calendario trabajador',    'Vista expandible: total por día/semana, drill-down con bloques exactos por puesto.'],
    ['Nueva pestaña — Vista mensual',            'Tabla read-only trabajador × días del mes con píldora por día.'],
    ['Nueva pestaña — Equilibrio',               'KPIs promedio + carga semanal (mañana/tarde, turnos, partidos, % jornada) + matriz por puesto.'],
    ['Botones de replicación',                    '"Copiar anterior" (1 click), "Replicar N semanas", "Patrón rotativo A/B" en Calendario semanal.'],
    ['Config empresa rediseñada',                 'Lista con manager primero + indicador Configurado/Sin datos + copia masiva con multi-select.'],
  ],
}))
children.push(P('Datos en BD: 1 temporada, 11 bloques apertura, 4 puestos, 1 par compatible (MG⇄AC), 58 franjas demanda, 12 plantillas reutilizables, 19 bloques horario teórico exactos, 13 asignaciones semana 25-may. Cobertura: 58/58 OK, 0 críticas, 0 sobrecobertura.',
  { italics: true, color: '64748B' }))

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: FONT },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: FONT },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{ reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
                 style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    children,
  }],
})

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('docs/Planificacion_Round_Malagacentro.docx', buf)
  console.log('OK', buf.length, 'bytes')
})
