const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const W = 1600, H = 1000;

const COLOR = {
  green: '#1A9A7A', greenLight: '#E8F5F1',
  amber: '#B45309', amberLight: '#FEF3C7',
  red:   '#B91C1C', redLight: '#FEE2E2',
  blue:  '#1E40AF', blueLight: '#DBEAFE',
  dark:  '#0E0F13', gray: '#5C6066', line: '#CCCCCC',
  bg:    '#F4F6F8',
};

// Helper para crear cajitas con estado: ok / partial / pending / deferred
function step(x, y, w, h, label, sub, status, num) {
  const fillByStatus = {
    ok:       { stroke: COLOR.green, fill: COLOR.greenLight, label: '✓' },
    partial:  { stroke: COLOR.amber, fill: COLOR.amberLight, label: '~' },
    pending:  { stroke: COLOR.red,   fill: COLOR.redLight,   label: '○' },
    deferred: { stroke: COLOR.blue,  fill: COLOR.blueLight,  label: '⏸' },
  };
  const s = fillByStatus[status] || fillByStatus.pending;
  return `
  <g filter="url(#shadow)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${s.fill}" stroke="${s.stroke}" stroke-width="2"/>
    ${num ? `<circle cx="${x+18}" cy="${y+18}" r="13" fill="${s.stroke}"/>
            <text x="${x+18}" y="${y+22}" text-anchor="middle" font-size="12" font-weight="700" fill="#FFF">${num}</text>` : ''}
    <text x="${x+w/2}" y="${y+(num?38:24)}" text-anchor="middle" font-size="13" font-weight="700" fill="${COLOR.dark}">${label}</text>
    ${sub ? `<text x="${x+w/2}" y="${y+(num?56:42)}" text-anchor="middle" font-size="11" fill="${COLOR.gray}">${sub}</text>` : ''}
    <text x="${x+w-18}" y="${y+22}" text-anchor="middle" font-size="14" font-weight="700" fill="${s.stroke}">${s.label}</text>
  </g>`;
}

function actor(x, y, w, h, label, color) {
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4,3" opacity="0.6"/>
  <text x="${x+12}" y="${y+22}" font-size="11" font-weight="700" fill="${color}" letter-spacing="2">${label}</text>`;
}

function arrow(x1, y1, x2, y2, color = COLOR.gray, dashed = false, label = '') {
  const dash = dashed ? 'stroke-dasharray="5,3"' : '';
  return `
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" ${dash} marker-end="url(#arr_${color.replace('#','')})"/>
  ${label ? `<text x="${(x1+x2)/2}" y="${(y1+y2)/2 - 6}" text-anchor="middle" font-size="10" fill="${color}" font-style="italic">${label}</text>` : ''}`;
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Arial,sans-serif">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="${COLOR.bg}"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="${COLOR.dark}" flood-opacity="0.10"/>
    </filter>
    ${['1A9A7A','B45309','B91C1C','1E40AF','5C6066'].map(c => `
      <marker id="arr_${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#${c}"/>
      </marker>`).join('')}
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>

  <!-- Título -->
  <text x="${W/2}" y="40" text-anchor="middle" font-size="22" font-weight="700" fill="${COLOR.dark}">Flujo lead → cliente activo · Captación, alta, cobro y recaptación</text>
  <text x="${W/2}" y="62" text-anchor="middle" font-size="12" fill="${COLOR.gray}" font-style="italic">Estado de implementación · ✓ hecho · ~ parcial · ○ pendiente</text>

  <!-- Actores (carriles) -->
  ${actor(20, 90, 1560, 80, 'LEAD / CLIENTE', COLOR.gray)}
  ${actor(20, 190, 1560, 130, 'NOOFITPRO  ·  WEB TRAINER', COLOR.blue)}
  ${actor(20, 340, 1560, 130, 'ROUND CONFIG API  ·  ORQUESTADOR', COLOR.green)}
  ${actor(20, 490, 1560, 130, 'ODOO 17  ·  ERP / CONTABILIDAD', '#714B67')}
  ${actor(20, 640, 1560, 110, 'PAYCOMET  ·  PASARELA', '#FB923C')}
  ${actor(20, 770, 1560, 110, 'MYNOOFIT  ·  APP CLIENTE', '#A78BFA')}

  <!-- ════════ FLUJO 1 — NUEVO LEAD ════════ -->
  <text x="120" y="84" font-size="13" font-weight="700" fill="${COLOR.green}">FLUJO 1 · NUEVO LEAD</text>

  ${step(50, 100, 200, 60, 'Pide día gratis', 'form WP /prueba-gratuita', 'ok', 1)}
  ${step(280, 100, 200, 60, 'Recibe email + reserva', 'slot_reservado_lead', 'ok', 2)}
  ${step(510, 100, 200, 60, 'Escanea QR del trainer', 'app Mynoofit', 'ok', 3)}

  ${step(280, 200, 220, 60, 'Banner "alta esperando"', 'reutiliza Nuevos Clientes', 'ok', 4)}
  ${step(530, 200, 200, 60, 'Click → tab ERP perfil', 'BannerNuevosClientes', 'ok', 5)}
  ${step(760, 200, 200, 60, 'Envía a ERP (DNI+IVA 21%)', 'crear_alta_cliente', 'ok', 6)}

  ${step(50, 350, 200, 60, 'Lead Odoo creado', 'crm.lead Nuevo', 'ok')}
  ${step(280, 350, 200, 60, 'Cliente NoofitPro creado', 'sin email Wiemspro', 'ok')}
  ${step(760, 350, 200, 60, 'Genera enlace cobro', 'PayComet payment URL', 'deferred', 7)}

  ${step(530, 500, 220, 60, 'res.partner (vat=DNI)', 'upsert_partner — España', 'ok')}
  ${step(760, 500, 200, 60, 'Suscripción + cuota', 'crear_subscription', 'ok')}
  ${step(990, 500, 200, 60, 'Recibo + cobro', 'crear_recibo_alta', 'ok')}
  ${step(1220, 500, 220, 60, 'Cierra lead → "Alta"', 'falta auto-trigger', 'partial')}

  ${step(760, 650, 200, 60, 'Cobra tarjeta', 'PayComet 3DS', 'deferred', 8)}
  ${step(990, 650, 200, 60, 'Webhook → Odoo', 'estado pagado', 'deferred', 9)}
  ${step(1220, 650, 220, 60, 'Sync NoofitPro', 'cuota_cliente pagada', 'partial')}

  ${step(760, 780, 200, 60, 'Recibe enlace pago', 'push + email', 'deferred')}
  ${step(990, 780, 200, 60, 'Tokeniza tarjeta', 'PayComet vault', 'deferred')}

  <!-- Flechas flujo 1 -->
  ${arrow(250, 130, 280, 130, COLOR.green)}
  ${arrow(480, 130, 510, 130, COLOR.green)}
  ${arrow(610, 160, 390, 200, COLOR.blue)}
  ${arrow(500, 230, 530, 230, COLOR.blue)}
  ${arrow(730, 230, 760, 230, COLOR.blue)}
  ${arrow(860, 260, 860, 350, COLOR.green)}
  ${arrow(860, 410, 860, 500, '#714B67', false, 'XML-RPC')}
  ${arrow(750, 530, 760, 530, '#714B67')}
  ${arrow(960, 530, 990, 530, '#714B67')}
  ${arrow(1190, 530, 1220, 530, '#714B67')}
  ${arrow(860, 560, 860, 650, '#FB923C', true, 'create-payment')}
  ${arrow(860, 710, 860, 780, '#A78BFA', true, 'enlace/push')}
  ${arrow(960, 810, 990, 810, '#A78BFA', true)}
  ${arrow(1090, 780, 1090, 710, '#FB923C', true, 'token guardado')}
  ${arrow(960, 680, 990, 680, '#FB923C', true)}
  ${arrow(1190, 680, 1220, 680, '#714B67', false, 'pagado')}
  ${arrow(1090, 650, 1090, 560, '#714B67', true)}

  <!-- ════════ FLUJO 2 — RECAPTACIÓN ════════ -->
  <line x1="0" y1="900" x2="${W}" y2="900" stroke="${COLOR.line}"/>
  <text x="120" y="920" font-size="13" font-weight="700" fill="${COLOR.amber}">FLUJO 2 · RECAPTACIÓN (cliente archivado)</text>

  ${step(50, 935, 220, 50, 'Cliente archivado', 'badge "desactivo" + fecha baja', 'pending', 1)}
  ${step(290, 935, 220, 50, 'Botón "Activar cliente"', 'NoofitPro web', 'pending', 2)}
  ${step(530, 935, 220, 50, 'Modal datos ERP edición', 'guardar obligatorio', 'pending', 3)}
  ${step(770, 935, 220, 50, 'Misma flecha → Odoo', 'crea suscripción nueva', 'pending', 4)}
  ${step(1010, 935, 220, 50, 'Pago + sync', 'paga, NoofitPro reactiva', 'pending', 5)}
  ${step(1250, 935, 220, 50, 'CRM: Recaptación', 'tag etiquetado', 'pending', 6)}

  ${arrow(270, 960, 290, 960, COLOR.amber)}
  ${arrow(510, 960, 530, 960, COLOR.amber)}
  ${arrow(750, 960, 770, 960, COLOR.amber)}
  ${arrow(990, 960, 1010, 960, COLOR.amber)}
  ${arrow(1230, 960, 1250, 960, COLOR.amber)}

  <!-- Leyenda inferior -->
  <g transform="translate(40, 990)">
    <rect x="0" y="-8" width="14" height="10" rx="2" fill="${COLOR.greenLight}" stroke="${COLOR.green}"/>
    <text x="20" y="0" font-size="10" fill="${COLOR.gray}">✓ Hecho</text>
    <rect x="80" y="-8" width="14" height="10" rx="2" fill="${COLOR.amberLight}" stroke="${COLOR.amber}"/>
    <text x="100" y="0" font-size="10" fill="${COLOR.gray}">~ Parcial</text>
    <rect x="170" y="-8" width="14" height="10" rx="2" fill="${COLOR.redLight}" stroke="${COLOR.red}"/>
    <text x="190" y="0" font-size="10" fill="${COLOR.gray}">○ Pendiente</text>
    <rect x="280" y="-8" width="14" height="10" rx="2" fill="${COLOR.blueLight}" stroke="${COLOR.blue}"/>
    <text x="300" y="0" font-size="10" fill="${COLOR.gray}">⏸ Diferido (probar luego)</text>
    <text x="450" y="0" font-size="10" fill="${COLOR.gray}">·  Carriles = sistema/actor responsable</text>
  </g>
</svg>`;

(async () => {
  const png = await sharp(Buffer.from(SVG)).resize({ width: 2200 }).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(__dirname, 'flujo_lead_cobro.png'), png);
  fs.writeFileSync(path.join(__dirname, 'flujo_lead_cobro.svg'), SVG);
  console.log('OK', png.length, 'bytes');
})();
