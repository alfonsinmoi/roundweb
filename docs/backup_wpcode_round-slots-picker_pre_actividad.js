// Backup del WPCode snippet id=12650 "round-slots-picker" antes de añadir
// el selector de actividad. Tomado el 2026-05-10 desde wp-admin de
// roundtrainingcenter.com.
//
// Para restaurar: copiar todo el contenido entre las marcas BEGIN/END
// y pegarlo en el editor del snippet en WPCode (sin las líneas de comentario
// del backup, sólo el cuerpo IIFE).

// ============== BEGIN ORIGINAL ==============
(function() {
  const API_BASE = 'https://noofit.wiemspro.com';

  function findSlotIdField() {
    // Prefer a real "id_sala" name if it exists
    const named = document.querySelector('input[name="id_sala"]');
    if (named) return named;
    // Fall back: find a hidden input that is NOT recaptcha/honeypot
    const hidden = Array.from(document.querySelectorAll('form input[type="hidden"]'));
    return hidden.find(i => {
      const n = (i.name || '').toLowerCase();
      const id = (i.id || '').toLowerCase();
      return n && !n.includes('captcha') && !n.includes('hp') && !n.includes('recaptcha') && id !== 'nf-field-61';
    }) || null;
  }

  function ensureContainer(centroSelect) {
    let box = document.getElementById('round-slots');
    if (box) return box;
    const wrap = centroSelect.closest('.nf-field-wrap, .nf-field, .field-wrap') || centroSelect.parentElement;
    box = document.createElement('div');
    box.id = 'round-slots';
    box.style.cssText = 'margin:16px 0;';
    box.innerHTML =
      '<p style="margin-bottom:8px; font-size:14px; font-weight:600">Elige día y hora de tu prueba:</p>' +
      '<div id="round-slots-loading" style="color:#666; font-size:13px">Selecciona un centro arriba y aparecerán los huecos disponibles…</div>' +
      '<div id="round-slots-list" style="display:none"></div>' +
      '<p id="round-slots-warning" style="display:none; background:#fef3c7; padding:8px; border-radius:6px; font-size:12px; margin-top:8px">' +
      '⏰ Tras enviar el formulario, recibirás un email para <b>confirmar la plaza en 1 hora</b>. Si no confirmas, el sistema la libera automáticamente.' +
      '</p>';
    if (wrap.parentElement) wrap.parentElement.insertBefore(box, wrap.nextSibling);
    else wrap.appendChild(box);
    return box;
  }

  function bootSlots() {
    const centroSelect = document.querySelector('.nf-field-wrap.listselect select, select[name^="nf-field-40"], select[name*="centro"]');
    if (!centroSelect) return false;
    const slotIdField = findSlotIdField();
    const box = ensureContainer(centroSelect);
    const slotsBox = document.getElementById('round-slots-list');
    const loadingMsg = document.getElementById('round-slots-loading');
    const warningBox = document.getElementById('round-slots-warning');

    centroSelect.addEventListener('change', loadSlots);
    if (centroSelect.value && centroSelect.value !== 'elige-tu-centro') loadSlots();
    return true;

    async function loadSlots() {
      const raw = (centroSelect.value || '').toLowerCase().trim();
      if (!raw || raw === 'elige-tu-centro') return;
      const slug = raw.includes('@') ? raw.split('@')[0] : raw;
      slotsBox.style.display = 'none';
      loadingMsg.textContent = 'Cargando huecos disponibles…';
      loadingMsg.style.display = 'block';
      try {
        const r = await fetch(API_BASE + '/api/crm/slots-disponibles?centro=' + encodeURIComponent(slug));
        const data = await r.json();
        if (!data.ok || !data.por_dia) throw new Error(data.error || 'no_slots');
        renderSlots(data.por_dia);
      } catch (e) {
        loadingMsg.textContent = 'No hay huecos disponibles ahora mismo. Intenta de nuevo en un rato.';
      }
    }

    function renderSlots(porDia) {
      slotsBox.innerHTML = '';
      let total = 0;
      for (const dia of porDia) {
        const h = document.createElement('div');
        h.style.cssText = 'margin:10px 0 4px; font-weight:700; color:#2DD4A8; font-size:12px; text-transform:uppercase';
        h.textContent = (dia.slots[0].dia_nombre || '') + ' ' + dia.fecha;
        slotsBox.appendChild(h);
        for (const s of dia.slots) {
          const lab = document.createElement('label');
          lab.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 12px; margin:4px 0; border:1px solid #ddd; border-radius:8px; cursor:pointer; background:#fff';
          const radio = document.createElement('input');
          radio.type = 'radio'; radio.name = 'round_slot'; radio.value = s.id_sala;
          radio.style.marginRight = '10px';
          const info = document.createElement('div');
          info.style.flex = '1';
          info.innerHTML = '<b style="display:block">' + s.hora + ' — ' + s.nombre + '</b>' +
            '<span style="font-size:12px; color:#666">' + s.libres + ' de ' + s.aforo + ' plazas libres</span>';
          const badge = document.createElement('span');
          badge.style.cssText = 'font-size:11px; padding:3px 8px; border-radius:99px; color:#fff; background:' + nivelColor(s.nivel);
          badge.textContent = nivelLabel(s.nivel);
          lab.appendChild(radio); lab.appendChild(info); lab.appendChild(badge);
          radio.addEventListener('change', function(e) {
            if (slotIdField) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(slotIdField, e.target.value);
              slotIdField.dispatchEvent(new Event('input', { bubbles: true }));
              slotIdField.dispatchEvent(new Event('change', { bubbles: true }));
            }
            warningBox.style.display = 'block';
            slotsBox.querySelectorAll('label').forEach(function(l) { l.style.borderColor = '#ddd'; });
            lab.style.borderColor = '#2DD4A8';
          });
          slotsBox.appendChild(lab);
          total++;
        }
      }
      loadingMsg.style.display = 'none';
      slotsBox.style.display = 'block';
      if (total === 0) {
        loadingMsg.textContent = 'No hay huecos disponibles ahora mismo.';
        loadingMsg.style.display = 'block';
      }
    }

    function nivelColor(n) { return ({tranquila:'#2DD4A8', normal:'#5B9CF6', concurrida:'#FBBF24', casi_llena:'#F87171'})[n] || '#999'; }
    function nivelLabel(n) { return ({tranquila:'Tranquila', normal:'Normal', concurrida:'Concurrida', casi_llena:'Casi llena'})[n] || n; }
  }

  function tryBoot() {
    if (window.location.pathname.indexOf('/prueba-gratuita') === -1) return;
    if (bootSlots()) return;
    setTimeout(tryBoot, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryBoot);
  } else {
    tryBoot();
  }
})();
// ============== END ORIGINAL ==============
