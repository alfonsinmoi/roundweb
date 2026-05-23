const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TabStopType, TabStopPosition,
} = require('docx');

const ARIAL = 'Arial';
const COLOR_GREEN = '1A9A7A';
const COLOR_DARK = '0E0F13';
const COLOR_GRAY = '5C6066';
const COLOR_LINE = 'CCCCCC';

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: COLOR_LINE };
const ALL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 },
  children: [new TextRun({ text: t, bold: true, size: 28, color: COLOR_GREEN, font: ARIAL })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 80 },
  children: [new TextRun({ text: t, bold: true, size: 22, color: COLOR_DARK, font: ARIAL })] });
const P = (...ch) => new Paragraph({ spacing: { after: 80, line: 280 },
  children: typeof ch[0] === 'string' ? [new TextRun({ text: ch[0], size: 18, font: ARIAL })] : ch });
const T = (t, o = {}) => new TextRun({ text: t, size: 18, font: ARIAL, ...o });
const B = (t) => T(t, { bold: true });
const BULLET = (t, lvl = 0) => new Paragraph({
  numbering: { reference: 'bullets', level: lvl }, spacing: { after: 40, line: 260 },
  children: typeof t === 'string' ? [new TextRun({ text: t, size: 17, font: ARIAL })] : t,
});
const cellHeader = (t) => new TableCell({ borders: ALL_BORDERS,
  width: { size: 2200, type: WidthType.DXA },
  shading: { fill: 'E8F5F1', type: ShadingType.CLEAR },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 16, color: COLOR_DARK, font: ARIAL })] })] });
const cellBody = (t) => new TableCell({ borders: ALL_BORDERS,
  width: { size: 7160, type: WidthType.DXA },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text: t, size: 16, font: ARIAL })] })] });

// ── SVG de la infografía ────────────────────────────────────────────────
const SVG_WIDTH = 1400, SVG_HEIGHT = 900;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" font-family="Arial,sans-serif">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#F4F6F8"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0E0F13" flood-opacity="0.12"/>
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#5C6066"/>
    </marker>
    <marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#1A9A7A"/>
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>

  <!-- Etiquetas de capa -->
  <text x="40" y="120" font-size="14" font-weight="700" fill="#1A9A7A" letter-spacing="2">CANALES</text>
  <text x="40" y="320" font-size="14" font-weight="700" fill="#1A9A7A" letter-spacing="2">ORQUESTACIÓN</text>
  <text x="40" y="540" font-size="14" font-weight="700" fill="#1A9A7A" letter-spacing="2">DATOS · BACKENDS</text>
  <text x="40" y="780" font-size="14" font-weight="700" fill="#1A9A7A" letter-spacing="2">SALIDAS</text>
  <line x1="160" y1="100" x2="1380" y2="100" stroke="#E5E7EB" stroke-width="1"/>
  <line x1="160" y1="300" x2="1380" y2="300" stroke="#E5E7EB" stroke-width="1"/>
  <line x1="160" y1="520" x2="1380" y2="520" stroke="#E5E7EB" stroke-width="1"/>
  <line x1="160" y1="760" x2="1380" y2="760" stroke="#E5E7EB" stroke-width="1"/>

  <!-- CAPA 1 — CANALES -->
  <g filter="url(#shadow)">
    <rect x="200" y="60" width="190" height="100" rx="14" fill="#FFFFFF" stroke="#21759B" stroke-width="2.5"/>
    <text x="295" y="92" text-anchor="middle" font-size="14" font-weight="700" fill="#21759B">WordPress</text>
    <text x="295" y="112" text-anchor="middle" font-size="11" fill="#5C6066">roundtrainingcenter.com</text>
    <text x="295" y="130" text-anchor="middle" font-size="10" fill="#5C6066">Ninja Forms id=5</text>
    <text x="295" y="146" text-anchor="middle" font-size="10" fill="#5C6066">DNI · slot picker</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="430" y="60" width="170" height="100" rx="14" fill="#FFFFFF" stroke="#E1306C" stroke-width="2.5"/>
    <text x="515" y="92" text-anchor="middle" font-size="14" font-weight="700" fill="#E1306C">Instagram</text>
    <text x="515" y="112" text-anchor="middle" font-size="11" fill="#5C6066">Lead Ads</text>
    <text x="515" y="130" text-anchor="middle" font-size="10" fill="#5C6066">webhook Meta</text>
    <text x="515" y="146" text-anchor="middle" font-size="10" fill="#9CA3AF" font-style="italic">(roadmap)</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="640" y="60" width="220" height="100" rx="14" fill="#FFFFFF" stroke="#1A9A7A" stroke-width="2.5"/>
    <text x="750" y="92" text-anchor="middle" font-size="14" font-weight="700" fill="#1A9A7A">Round Dashboard</text>
    <text x="750" y="112" text-anchor="middle" font-size="11" fill="#5C6066">round.noofit.com</text>
    <text x="750" y="130" text-anchor="middle" font-size="10" fill="#5C6066">React · SPA · Lazy</text>
    <text x="750" y="146" text-anchor="middle" font-size="10" fill="#5C6066">manager + trainers</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="900" y="60" width="170" height="100" rx="14" fill="#FFFFFF" stroke="#5B9CF6" stroke-width="2.5"/>
    <text x="985" y="92" text-anchor="middle" font-size="14" font-weight="700" fill="#5B9CF6">App Cliente</text>
    <text x="985" y="112" text-anchor="middle" font-size="11" fill="#5C6066">NoofitPro mobile</text>
    <text x="985" y="130" text-anchor="middle" font-size="10" fill="#5C6066">reservas · sensores</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="1110" y="60" width="170" height="100" rx="14" fill="#FFFFFF" stroke="#A78BFA" stroke-width="2.5"/>
    <text x="1195" y="92" text-anchor="middle" font-size="14" font-weight="700" fill="#A78BFA">App Trainer</text>
    <text x="1195" y="112" text-anchor="middle" font-size="11" fill="#5C6066">NoofitPro Pro</text>
    <text x="1195" y="130" text-anchor="middle" font-size="10" fill="#5C6066">entrenamientos</text>
  </g>

  <!-- CAPA 2 — ORQUESTACIÓN -->
  <g filter="url(#shadow)">
    <rect x="220" y="270" width="780" height="140" rx="16" fill="#0E0F13" stroke="#1A9A7A" stroke-width="3"/>
    <text x="610" y="306" text-anchor="middle" font-size="16" font-weight="700" fill="#FFFFFF">Round Config API  ·  Flask + Gunicorn (Python 3.12)</text>
    <text x="610" y="328" text-anchor="middle" font-size="12" fill="#9CA3AF">VPS dedicado · nginx 443 → 127.0.0.1:8095</text>
    <rect x="240" y="346" width="115" height="48" rx="8" fill="#1F2937" stroke="#1A9A7A"/>
    <text x="297" y="367" text-anchor="middle" font-size="11" font-weight="700" fill="#2DD4A8">CRM Leads</text>
    <text x="297" y="382" text-anchor="middle" font-size="9" fill="#9CA3AF">scoring · funnel</text>
    <rect x="365" y="346" width="115" height="48" rx="8" fill="#1F2937" stroke="#1A9A7A"/>
    <text x="422" y="367" text-anchor="middle" font-size="11" font-weight="700" fill="#2DD4A8">Slot Reservas</text>
    <text x="422" y="382" text-anchor="middle" font-size="9" fill="#9CA3AF">afluencia 4w+12w</text>
    <rect x="490" y="346" width="115" height="48" rx="8" fill="#1F2937" stroke="#1A9A7A"/>
    <text x="547" y="367" text-anchor="middle" font-size="11" font-weight="700" fill="#2DD4A8">Email Engine</text>
    <text x="547" y="382" text-anchor="middle" font-size="9" fill="#9CA3AF">templates · trigger</text>
    <rect x="615" y="346" width="115" height="48" rx="8" fill="#1F2937" stroke="#1A9A7A"/>
    <text x="672" y="367" text-anchor="middle" font-size="11" font-weight="700" fill="#2DD4A8">Catálogos</text>
    <text x="672" y="382" text-anchor="middle" font-size="9" fill="#9CA3AF">cuotas · descuentos</text>
    <rect x="740" y="346" width="115" height="48" rx="8" fill="#1F2937" stroke="#1A9A7A"/>
    <text x="797" y="367" text-anchor="middle" font-size="11" font-weight="700" fill="#2DD4A8">Cobros</text>
    <text x="797" y="382" text-anchor="middle" font-size="9" fill="#9CA3AF">SEPA · webhooks</text>
    <rect x="865" y="346" width="115" height="48" rx="8" fill="#1F2937" stroke="#1A9A7A"/>
    <text x="922" y="367" text-anchor="middle" font-size="11" font-weight="700" fill="#2DD4A8">Auth</text>
    <text x="922" y="382" text-anchor="middle" font-size="9" fill="#9CA3AF">tokens · CORS</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="1030" y="270" width="250" height="140" rx="16" fill="#FFFFFF" stroke="#FBBF24" stroke-width="2.5"/>
    <text x="1155" y="302" text-anchor="middle" font-size="14" font-weight="700" fill="#B45309">Cron · systemd</text>
    <text x="1155" y="324" text-anchor="middle" font-size="11" fill="#5C6066">Tareas programadas</text>
    <text x="1155" y="350" text-anchor="middle" font-size="10" fill="#5C6066">• Liberar slots expirados (5 min)</text>
    <text x="1155" y="370" text-anchor="middle" font-size="10" fill="#5C6066">• Sincronización Odoo (24 h)</text>
    <text x="1155" y="390" text-anchor="middle" font-size="10" fill="#5C6066">• Recordatorios prueba (roadmap)</text>
  </g>

  <!-- CAPA 3 — DATOS -->
  <g filter="url(#shadow)">
    <rect x="120" y="490" width="240" height="160" rx="14" fill="#FFFFFF" stroke="#336791" stroke-width="2.5"/>
    <text x="240" y="520" text-anchor="middle" font-size="14" font-weight="700" fill="#336791">PostgreSQL 16</text>
    <text x="240" y="540" text-anchor="middle" font-size="11" fill="#5C6066">round_config (local)</text>
    <line x1="140" y1="552" x2="340" y2="552" stroke="#E5E7EB"/>
    <text x="240" y="572" text-anchor="middle" font-size="10" fill="#5C6066">14 tablas · multi-tenant</text>
    <text x="240" y="589" text-anchor="middle" font-size="9" fill="#5C6066">cuota · descuento · modificacion</text>
    <text x="240" y="603" text-anchor="middle" font-size="9" fill="#5C6066">centro_contacto · lead_asignacion</text>
    <text x="240" y="617" text-anchor="middle" font-size="9" fill="#5C6066">slot_reserva · email_template</text>
    <text x="240" y="631" text-anchor="middle" font-size="9" fill="#5C6066">pasarela_credenciales · email_proveedor</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="390" y="490" width="240" height="160" rx="14" fill="#FFFFFF" stroke="#5B9CF6" stroke-width="2.5"/>
    <text x="510" y="520" text-anchor="middle" font-size="14" font-weight="700" fill="#5B9CF6">NoofitPro SaaS</text>
    <text x="510" y="540" text-anchor="middle" font-size="11" fill="#5C6066">pro.wiemspro.com</text>
    <line x1="410" y1="552" x2="610" y2="552" stroke="#E5E7EB"/>
    <text x="510" y="572" text-anchor="middle" font-size="10" fill="#5C6066">REST · JWT (TTL 60min)</text>
    <text x="510" y="589" text-anchor="middle" font-size="9" fill="#5C6066">clientes · clases (salas)</text>
    <text x="510" y="603" text-anchor="middle" font-size="9" fill="#5C6066">asistencia · sensores</text>
    <text x="510" y="617" text-anchor="middle" font-size="9" fill="#5C6066">entrenamientos · ejercicios</text>
    <text x="510" y="635" text-anchor="middle" font-size="9" fill="#9CA3AF" font-style="italic">(proveedor 3º · Wiemspro)</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="660" y="490" width="240" height="160" rx="14" fill="#FFFFFF" stroke="#714B67" stroke-width="2.5"/>
    <text x="780" y="520" text-anchor="middle" font-size="14" font-weight="700" fill="#714B67">Odoo 17</text>
    <text x="780" y="540" text-anchor="middle" font-size="11" fill="#5C6066">round_facturacion</text>
    <line x1="680" y1="552" x2="880" y2="552" stroke="#E5E7EB"/>
    <text x="780" y="572" text-anchor="middle" font-size="10" fill="#5C6066">XML-RPC</text>
    <text x="780" y="589" text-anchor="middle" font-size="9" fill="#5C6066">crm.lead · crm.stage</text>
    <text x="780" y="603" text-anchor="middle" font-size="9" fill="#5C6066">account.* (facturas)</text>
    <text x="780" y="617" text-anchor="middle" font-size="9" fill="#5C6066">round.cuota.catalogo</text>
    <text x="780" y="631" text-anchor="middle" font-size="9" fill="#5C6066">SEPA exportable</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="930" y="490" width="200" height="160" rx="14" fill="#FFFFFF" stroke="#F87171" stroke-width="2.5"/>
    <text x="1030" y="520" text-anchor="middle" font-size="14" font-weight="700" fill="#F87171">Resend</text>
    <text x="1030" y="540" text-anchor="middle" font-size="11" fill="#5C6066">api.resend.com</text>
    <line x1="950" y1="552" x2="1110" y2="552" stroke="#E5E7EB"/>
    <text x="1030" y="572" text-anchor="middle" font-size="10" fill="#5C6066">Email transaccional</text>
    <text x="1030" y="589" text-anchor="middle" font-size="9" fill="#5C6066">9 plantillas · {{vars}}</text>
    <text x="1030" y="603" text-anchor="middle" font-size="9" fill="#5C6066">3000 emails/mes free</text>
    <text x="1030" y="619" text-anchor="middle" font-size="9" fill="#9CA3AF">alt: Postmark · SMTP</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="1160" y="490" width="180" height="160" rx="14" fill="#FFFFFF" stroke="#FB923C" stroke-width="2.5"/>
    <text x="1250" y="520" text-anchor="middle" font-size="14" font-weight="700" fill="#FB923C">PayComet</text>
    <text x="1250" y="540" text-anchor="middle" font-size="11" fill="#5C6066">rest.paycomet.com</text>
    <line x1="1180" y1="552" x2="1320" y2="552" stroke="#E5E7EB"/>
    <text x="1250" y="572" text-anchor="middle" font-size="10" fill="#5C6066">Pasarela tarjeta</text>
    <text x="1250" y="589" text-anchor="middle" font-size="9" fill="#5C6066">credenciales · trainer</text>
    <text x="1250" y="603" text-anchor="middle" font-size="9" fill="#5C6066">sandbox / prod</text>
    <text x="1250" y="619" text-anchor="middle" font-size="9" fill="#5C6066">webhook · notif</text>
  </g>

  <!-- CAPA 4 — SALIDAS -->
  <g filter="url(#shadow)">
    <rect x="180" y="725" width="170" height="65" rx="10" fill="#E8F5F1" stroke="#1A9A7A" stroke-width="1.5"/>
    <text x="265" y="752" text-anchor="middle" font-size="12" font-weight="700" fill="#0E0F13">Lead → Cliente</text>
    <text x="265" y="770" text-anchor="middle" font-size="10" fill="#5C6066">cliente NoofitPro</text>
    <text x="265" y="784" text-anchor="middle" font-size="9" fill="#5C6066">alta sin duplicado</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="380" y="725" width="170" height="65" rx="10" fill="#E8F5F1" stroke="#1A9A7A" stroke-width="1.5"/>
    <text x="465" y="752" text-anchor="middle" font-size="12" font-weight="700" fill="#0E0F13">Plaza prueba</text>
    <text x="465" y="770" text-anchor="middle" font-size="10" fill="#5C6066">slot reservado · 1h</text>
    <text x="465" y="784" text-anchor="middle" font-size="9" fill="#5C6066">token · email confirm</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="580" y="725" width="170" height="65" rx="10" fill="#E8F5F1" stroke="#1A9A7A" stroke-width="1.5"/>
    <text x="665" y="752" text-anchor="middle" font-size="12" font-weight="700" fill="#0E0F13">Email automático</text>
    <text x="665" y="770" text-anchor="middle" font-size="10" fill="#5C6066">por evento CRM</text>
    <text x="665" y="784" text-anchor="middle" font-size="9" fill="#5C6066">9 plantillas activas</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="780" y="725" width="170" height="65" rx="10" fill="#E8F5F1" stroke="#1A9A7A" stroke-width="1.5"/>
    <text x="865" y="752" text-anchor="middle" font-size="12" font-weight="700" fill="#0E0F13">Recibo SEPA</text>
    <text x="865" y="770" text-anchor="middle" font-size="10" fill="#5C6066">XML para banco</text>
    <text x="865" y="784" text-anchor="middle" font-size="9" fill="#5C6066">domiciliación masiva</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="980" y="725" width="170" height="65" rx="10" fill="#E8F5F1" stroke="#1A9A7A" stroke-width="1.5"/>
    <text x="1065" y="752" text-anchor="middle" font-size="12" font-weight="700" fill="#0E0F13">Cobro tarjeta</text>
    <text x="1065" y="770" text-anchor="middle" font-size="10" fill="#5C6066">PayComet 3DS</text>
    <text x="1065" y="784" text-anchor="middle" font-size="9" fill="#5C6066">matrícula · 1ª cuota</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="1180" y="725" width="170" height="65" rx="10" fill="#E8F5F1" stroke="#1A9A7A" stroke-width="1.5"/>
    <text x="1265" y="752" text-anchor="middle" font-size="12" font-weight="700" fill="#0E0F13">Analítica</text>
    <text x="1265" y="770" text-anchor="middle" font-size="10" fill="#5C6066">embudo · scoring</text>
    <text x="1265" y="784" text-anchor="middle" font-size="9" fill="#5C6066">KPIs por trainer</text>
  </g>

  <!-- Flechas -->
  <line x1="295" y1="160" x2="320" y2="270" stroke="#1A9A7A" stroke-width="2" marker-end="url(#arrowGreen)"/>
  <line x1="515" y1="160" x2="450" y2="270" stroke="#1A9A7A" stroke-width="2" stroke-dasharray="4,3" marker-end="url(#arrowGreen)"/>
  <line x1="750" y1="160" x2="600" y2="270" stroke="#1A9A7A" stroke-width="2" marker-end="url(#arrowGreen)"/>
  <line x1="985" y1="160" x2="700" y2="270" stroke="#5C6066" stroke-width="1.5" stroke-dasharray="3,3"/>
  <line x1="1195" y1="160" x2="1155" y2="270" stroke="#5C6066" stroke-width="1.5"/>
  <line x1="320" y1="410" x2="240" y2="490" stroke="#5C6066" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="450" y1="410" x2="510" y2="490" stroke="#5C6066" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="700" y1="410" x2="780" y2="490" stroke="#5C6066" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="547" y1="410" x2="1030" y2="490" stroke="#5C6066" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="800" y1="410" x2="1250" y2="490" stroke="#5C6066" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="1155" y1="410" x2="240" y2="500" stroke="#FBBF24" stroke-width="1.5" stroke-dasharray="4,2"/>
  <line x1="1155" y1="410" x2="510" y2="500" stroke="#FBBF24" stroke-width="1.5" stroke-dasharray="4,2"/>
  <line x1="240" y1="650" x2="265" y2="725" stroke="#1A9A7A" stroke-width="2" marker-end="url(#arrowGreen)"/>
  <line x1="510" y1="650" x2="465" y2="725" stroke="#1A9A7A" stroke-width="2" marker-end="url(#arrowGreen)"/>
  <line x1="1030" y1="650" x2="665" y2="725" stroke="#1A9A7A" stroke-width="2" marker-end="url(#arrowGreen)"/>
  <line x1="780" y1="650" x2="865" y2="725" stroke="#1A9A7A" stroke-width="2" marker-end="url(#arrowGreen)"/>
  <line x1="1250" y1="650" x2="1065" y2="725" stroke="#1A9A7A" stroke-width="2" marker-end="url(#arrowGreen)"/>
  <line x1="240" y1="650" x2="1265" y2="725" stroke="#1A9A7A" stroke-width="1" stroke-dasharray="2,3"/>

  <text x="380" y="245" font-size="10" fill="#5C6066" font-style="italic">POST /api/crm/lead-prueba</text>
  <text x="850" y="245" font-size="10" fill="#5C6066" font-style="italic">REST + auth tokens</text>

  <g transform="translate(60, 830)">
    <text x="0" y="0" font-size="11" font-weight="700" fill="#0E0F13">LEYENDA</text>
    <line x1="80" y1="-4" x2="120" y2="-4" stroke="#1A9A7A" stroke-width="2"/>
    <text x="128" y="0" font-size="10" fill="#5C6066">flujo principal</text>
    <line x1="220" y1="-4" x2="260" y2="-4" stroke="#1A9A7A" stroke-width="2" stroke-dasharray="4,3"/>
    <text x="268" y="0" font-size="10" fill="#5C6066">en hoja de ruta</text>
    <line x1="360" y1="-4" x2="400" y2="-4" stroke="#FBBF24" stroke-width="2" stroke-dasharray="4,2"/>
    <text x="408" y="0" font-size="10" fill="#5C6066">cron programado</text>
    <line x1="510" y1="-4" x2="550" y2="-4" stroke="#5C6066" stroke-width="1.5" stroke-dasharray="3,3"/>
    <text x="558" y="0" font-size="10" fill="#5C6066">flujo opcional</text>
    <text x="700" y="0" font-size="10" fill="#5C6066">·  Verde = ecosistema Round  ·  Colores = identidad de cada proveedor</text>
  </g>
</svg>`;

async function build() {
  const pngBuffer = await sharp(Buffer.from(SVG))
    .resize({ width: 2000 }).png({ compressionLevel: 9 }).toBuffer();
  console.log('PNG size:', pngBuffer.length, 'bytes');

  const doc = new Document({
    creator: 'Round Training Center',
    title: 'Arquitectura técnica — round.noofit.com',
    styles: {
      default: { document: { run: { font: ARIAL, size: 18 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: ARIAL, color: COLOR_GREEN },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, font: ARIAL, color: COLOR_DARK },
          paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 1 } },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 220 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 220 } } } },
    ] }] },
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      headers: { default: new Header({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: 'Round Training Center', bold: true, size: 16, color: COLOR_GREEN, font: ARIAL }),
          new TextRun({ text: '\tArquitectura técnica · v1.1', size: 14, color: COLOR_GRAY, font: ARIAL }),
        ] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Página ', size: 14, color: COLOR_GRAY, font: ARIAL }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, color: COLOR_GRAY, font: ARIAL }),
          new TextRun({ text: ' de ', size: 14, color: COLOR_GRAY, font: ARIAL }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: COLOR_GRAY, font: ARIAL }),
        ] })] }) },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 60 },
          children: [new TextRun({ text: 'Plataforma round.noofit.com', bold: true, size: 36, color: COLOR_DARK, font: ARIAL })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: 'Arquitectura técnica, integraciones y algoritmos · Replicable a cualquier manager NoofitPro', italics: true, size: 18, color: COLOR_GRAY, font: ARIAL })] }),

        H1('Mapa visual del ecosistema'),
        P(T('La siguiente infografía muestra los 4 niveles del sistema (canales de entrada → orquestación → backends de datos → salidas) y cómo se conectan. Verde indica componentes propios de Round; cada caja con color distinto representa un proveedor externo.')),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 120 },
          children: [new ImageRun({
            type: 'png',
            data: pngBuffer,
            transformation: { width: 620, height: 398 },
            altText: { title: 'Arquitectura Round', name: 'arquitectura',
                       description: 'Diagrama de capas: canales WordPress, Instagram, Dashboard y apps; orquestación Round Config API y Cron; datos PostgreSQL, NoofitPro, Odoo, Resend, PayComet; salidas cliente, plaza, email, SEPA, cobro y analítica.' },
          })],
        }),

        H1('1. Visión general'),
        P(T('La plataforma '), B('round.noofit.com'),
          T(' es una capa de gestión integral construida sobre el SaaS '), B('NoofitPro'),
          T(' (gimnasios). Extiende la funcionalidad nativa con un CRM completo, facturación automatizada en Odoo, comunicaciones transaccionales, pasarela de pago, scoring de leads, reserva inteligente de pruebas y analítica de embudo. El diseño es '),
          B('multi-tenant por manager: '),
          T('cualquier centro NoofitPro puede adoptar el sistema sin tocar código (configuración por UI).')),

        H1('2. Componentes del ecosistema'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2200, 7160],
          rows: [
            ['Frontend dashboard', 'React 18 + Vite, lazy-loading por ruta. SPA servida en round.noofit.com / noofit.wiemspro.com. Sesión basada en JWT (X-CustomToken) emitido por NoofitPro. Soporta impersonación trainer↔manager.'],
            ['Backend Round Config API', 'Flask + Gunicorn (Python 3.12) en VPS dedicado (212.227.40.122:8095). Capa de orquestación entre NoofitPro, Odoo, PostgreSQL y servicios externos. Auth por tokens internos (X-Round-Token + X-Round-Manager-Id).'],
            ['Base de datos local', 'PostgreSQL 16 (round_config). 14 tablas que extienden el modelo NoofitPro: catálogos de cuotas/descuentos/modificaciones, asignaciones cliente, plantillas email, configuración pasarelas, reservas slot, leads CRM. Schema idempotente con migraciones automáticas al boot.'],
            ['NoofitPro (proveedor)', 'SaaS de gestión de gimnasios (pro.wiemspro.com). Mantiene clientes, clases, asistencia, sensores. Consumo vía REST con MD5 de password en login y JWT con TTL ~60 min.'],
            ['Odoo 17 Community', 'BD round_facturacion. Módulos: account, crm, base. CRM con pipeline configurado (Nuevo → Contactado → Visita → Prueba → Alta · Perdido). Catálogos custom (round.cuota.catalogo, round.descuento.catalogo, round.modificacion.recibo). Generación SEPA para domiciliaciones.'],
            ['WordPress + Ninja Forms', 'roundtrainingcenter.com. Formulario público de prueba gratuita. Snippets PHP y JS gestionados con WPCode. Wordfence allowlist para POST salientes a la API.'],
            ['Email transaccional', 'Pluggable: Resend / Postmark / SMTP propio. Configurable por manager desde UI (credenciales + remitente). Sistema de plantillas con variables {{var}} y disparadores por evento.'],
            ['Pasarela de pago', 'PayComet REST v2, credenciales por trainer (token + terminal + sandbox/producción). Webhook de notificación cableado.'],
            ['GestPlus (legado)', 'Sistema fuente para migración histórica de socios y movimientos. Importación batch.'],
            ['Instagram Lead Ads', 'Webhook Meta (en hoja de ruta). Reusa el pipeline /api/crm/lead.'],
          ].map(([k, v]) => new TableRow({ children: [cellHeader(k), cellBody(v)] })),
        }),

        H1('3. Flujos críticos end-to-end'),
        H2('3.1 Captación de lead → reserva de prueba → alta'),
        BULLET('Lead rellena formulario WP (nombre, email, teléfono, centro, DNI, slot elegido).'),
        BULLET('Backend valida DNI/NIE/Pasaporte (algoritmo letra de control).'),
        BULLET('Anti-duplicado: si DNI o email existen como cliente NoofitPro, se reutiliza; si no, se crea.'),
        BULLET('Cliente apuntado a la sala (clase) elegida con tag pre-confirmación.'),
        BULLET('Lead creado en Odoo CRM stage Nuevo, asignación guardada en round_config.'),
        BULLET('Email transaccional vía Resend con CTA Confirmar / Cambiar día-hora (token único, TTL 1h).'),
        BULLET('Cron systemd cada 5 min libera reservas no confirmadas, manteniendo el cliente NoofitPro para follow-up.'),
        BULLET('Tras la prueba, si hay alta: el cliente ya existe, su asistencia queda en histórico.'),

        H2('3.2 Sincronización catálogos → Odoo → SEPA'),
        BULLET('Manager define cuotas/descuentos/modificaciones en UI Round.'),
        BULLET('Trainers adoptan plantillas o crean variantes.'),
        BULLET('Backend sincroniza catálogos a Odoo (cron diario).'),
        BULLET('Cobros generan recibos en Odoo, se exportan a SEPA XML para banco.'),

        new Paragraph({ children: [new PageBreak()] }),

        H1('4. Algoritmos y heurísticas'),
        H2('4.1 Lead scoring (0-100)'),
        P(T('Cada lead recibe un score que prioriza la atención del trainer. Se calcula on-the-fly al listar leads. '),
          B('Verde ≥70 (alta probabilidad), Amarillo 40-69 (seguimiento normal), Rojo <40 (baja prioridad).')),
        BULLET('Base 30 puntos. Suma: +15 por email Y teléfono. +15 por cuota de interés. +10 por mensaje libre >20 chars.'),
        BULLET('+10 si trae datos de qualification ricos (objetivo, presupuesto). +10 si UTM proviene de campaña pagada (Instagram, Google Ads).'),
        BULLET('+0 a +25 según etapa del pipeline (Nuevo→Alta). +5 si rango de edad óptimo (25-45).'),
        BULLET('Penalización: -15 si lleva >24h en Nuevo sin contactar. -25 si >7 días. Score=0 si lead marcado perdido.'),

        H2('4.2 Selección de slot de prueba (afluencia ponderada)'),
        P(T('Para sugerir al lead los huecos menos concurridos, se calcula la ocupación histórica de cada patrón de clase (mismo nombre + mismo trainer) en dos ventanas:')),
        BULLET('4 semanas (peso 0.6) → reactivo a tendencias recientes.'),
        BULLET('12 semanas (peso 0.4) → estabilidad estructural.'),
        BULLET('Score final = 0.6 × ocupación_4w + 0.4 × ocupación_12w.'),
        BULLET('Filtros: excluye lunes/martes (alta demanda), antelación mínima 24 h, aforo libre ≥1, próximos 14 días.'),
        BULLET('Salida: top 12 slots más vacíos, agrupados por día, etiquetados (tranquila / normal / concurrida / casi llena).'),

        H2('4.3 Análisis de embudo CRM'),
        BULLET('Distribución por etapa, tasa de conversión global, tiempo medio entre etapas, tiempo medio de primer contacto.'),
        BULLET('Motivos de pérdida agregados (precio, ubicación, no responde, horario, competencia, no listo, duplicado, spam).'),
        BULLET('Histórico inmutable de transiciones por lead (stage_history JSONB) para auditoría.'),

        H2('4.4 Round-robin de asignación'),
        P(T('Si el lead no especifica centro, se asigna al trainer activo con menos leads recientes. Garantiza reparto equitativo y evita acumulación en un solo centro.')),

        H1('5. Patrones de diseño'),
        BULLET('Multi-tenant por manager_id, todas las tablas locales lo llevan como discriminador.'),
        BULLET('Catálogo plantilla → adopción trainer (FK plantilla_origen_id), permite herencia con override.'),
        BULLET('Token + expiry para acciones públicas (reserva confirmación, cambio de slot, futuro: reset password).'),
        BULLET('Cache TTL para JWT NoofitPro (50 min, refresh automático en 401).'),
        BULLET('Migraciones idempotentes con CREATE TABLE IF NOT EXISTS y bloques DO $$ para ALTER COLUMN condicional.'),
        BULLET('Triggers updated_at automáticos en todas las tablas mutables.'),
        BULLET('Soft-state CRM: el lead avanza por etapas; la pérdida se modela como etapa fold (no eliminación).'),
        BULLET('Eventos → plantillas (event-driven email): cualquier transición CRM puede disparar comunicación configurable.'),

        new Paragraph({ children: [new PageBreak()] }),

        H1('6. Seguridad y cumplimiento'),
        BULLET('Auth interna: tokens en headers (X-Round-Token), nunca en URL. Manager-id y trainer-id separados; impersonación auditada.'),
        BULLET('Endpoints públicos protegidos con: rate limit por IP (8 req/5 min), honeypot anti-spam (campo oculto), validación estricta de entrada.'),
        BULLET('Validación DNI/NIE algorítmica con letra de control; pasaporte por regex. Justificado al lead por necesidades del seguro de instalación.'),
        BULLET('Secretos de proveedores (Resend, PayComet, SMTP) cifrados y nunca devueltos al frontend (solo preview tipo "abc…xyz").'),
        BULLET('CORS allowlist explícita: noofit.wiemspro.com, round.noofit.com, roundtrainingcenter.com, www.roundtrainingcenter.com.'),
        BULLET('Logging estructurado en journald, con métricas de envío email, llamadas a NoofitPro y triggers de eventos.'),
        BULLET('Persistencia de stage_history y raw_payload de formularios → trazabilidad GDPR completa.'),

        H1('7. Hoja de ruta inmediata'),
        BULLET('Webhook Instagram Lead Ads (Meta Business) → mismo pipeline /api/crm/lead.'),
        BULLET('Cron de recordatorio 24h antes de la prueba (reduce no-shows).'),
        BULLET('Dashboard manager con KPIs de captación: coste por lead, ROI por canal UTM, conversión por trainer.'),
        BULLET('Verificación dominio Resend para roundtrainingcenter.com (mejora deliverability ~30%).'),
        BULLET('Migración completa de socios desde GestPlus a NoofitPro + Odoo (en curso).'),
        BULLET('Modelo predictivo de abandono: probabilidad de baja del cliente en 30 días (entrenado sobre asistencia + engagement app).'),

        H1('8. Replicabilidad a otros managers'),
        P(T('Toda la configuración —centros, plantillas email, pasarelas, credenciales NoofitPro— vive en BD local segmentada por '),
          B('id_manager'),
          T('. Onboarding de un nuevo manager NoofitPro a la plataforma Round requiere únicamente: (1) crear su tenant en NoofitPro y obtener credenciales, (2) registrar centros desde la UI, (3) configurar proveedor email y pasarela de pago, (4) sembrar plantillas por defecto. '),
          B('No hay código específico de Round; el ecosistema completo se replica para cualquier cadena de gimnasios sobre NoofitPro en menos de un día.')),

        new Paragraph({
          spacing: { before: 200 },
          children: [
            new TextRun({ text: 'Documento generado para comité de expertos · ', size: 14, color: COLOR_GRAY, italics: true, font: ARIAL }),
            new TextRun({ text: new Date().toISOString().slice(0, 10), size: 14, color: COLOR_GRAY, italics: true, font: ARIAL }),
          ],
        }),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const out = path.join(__dirname, 'Arquitectura_round_noofit.docx');
  fs.writeFileSync(out, buf);
  console.log('OK ->', out, '(', buf.length, 'bytes )');
  fs.writeFileSync(path.join(__dirname, 'arquitectura_diagrama.png'), pngBuffer);
}

build().catch(err => { console.error(err); process.exit(1); });
