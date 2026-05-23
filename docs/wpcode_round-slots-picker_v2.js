(function() {
  const API_BASE = 'https://noofit.wiemspro.com';
  const PREFIX_LABELS = {
    'RT': 'Round Funcional',
    'CI': 'Ciclo Experience',
  };
  function prefixOf(nombre) {
    return ((nombre || '').trim().substring(0, 2)).toUpperCase();
  }

  function findSlotIdField() {
    const named = document.querySelector('input[name="id_sala"]');
    if (named) return named;
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
      '<div id="round-actividad-wrap" style="display:none; margin-bottom:10px">' +
        '<label for="round-actividad" style="display:block; font-size:13px; font-weight:600; margin-bottom:4px; color:#fff">Actividad de tu interés</label>' +
        '<select id="round-actividad" style="width:100%; padding:10px 12px; font-size:14px; border:1px solid #ccc; border-radius:8px; box-sizing:border-box; background:#fff; color:#000">' +
          '<option value="">— Todas las actividades —</option>' +
        '</select>' +
      '</div>' +
      '<div id="round-slots-loading" style="color:#bbb; font-size:13px">Selecciona un centro arriba y aparecerán los huecos disponibles…</div>' +
      '<div id="round-slots-list" style="display:none"></div>' +
      '<p id="round-slots-warning" style="display:none; background:#fef3c7; padding:8px; border-radius:6px; font-size:12px; margin-top:8px; color:#000">' +
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
    ensureContainer(centroSelect);
    const slotsBox = document.getElementById('round-slots-list');
    const loadingMsg = document.getElementById('round-slots-loading');
    const warningBox = document.getElementById('round-slots-warning');
    const actividadWrap = document.getElementById('round-actividad-wrap');
    const actividadSelect = document.getElementById('round-actividad');

    let slotsCache = null;

    centroSelect.addEventListener('change', loadSlots);
    actividadSelect.addEventListener('change', function() {
      if (slotsCache) renderSlots(filterByActividad(slotsCache, actividadSelect.value));
    });
    if (centroSelect.value && centroSelect.value !== 'elige-tu-centro') loadSlots();
    return true;

    async function loadSlots() {
      const raw = (centroSelect.value || '').toLowerCase().trim();
      if (!raw || raw === 'elige-tu-centro') return;
      const slug = raw.includes('@') ? raw.split('@')[0] : raw;
      slotsBox.style.display = 'none';
      actividadWrap.style.display = 'none';
      loadingMsg.textContent = 'Cargando huecos disponibles…';
      loadingMsg.style.display = 'block';
      try {
        const r = await fetch(API_BASE + '/api/crm/slots-disponibles?centro=' + encodeURIComponent(slug) + '&max=50');
        const data = await r.json();
        if (!data.ok || !data.por_dia) throw new Error(data.error || 'no_slots');
        slotsCache = data.por_dia;
        populateActividades(slotsCache);
        renderSlots(filterByActividad(slotsCache, actividadSelect.value));
      } catch (e) {
        loadingMsg.textContent = 'No hay huecos disponibles ahora mismo. Intenta de nuevo en un rato.';
      }
    }

    function populateActividades(porDia) {
      const counts = {};
      for (const dia of porDia) {
        for (const s of dia.slots) {
          const p = prefixOf(s.nombre);
          if (!p) continue;
          counts[p] = (counts[p] || 0) + 1;
        }
      }
      const prev = actividadSelect.value;
      const prefijos = Object.keys(counts);
      prefijos.sort(function(a,b){
        const la = PREFIX_LABELS[a] || a;
        const lb = PREFIX_LABELS[b] || b;
        return la.localeCompare(lb, 'es');
      });
      actividadSelect.innerHTML = '<option value="">— Todas las actividades —</option>';
      for (const p of prefijos) {
        const opt = document.createElement('option');
        opt.value = p;
        const label = PREFIX_LABELS[p] || p;
        opt.textContent = label + ' (' + counts[p] + ' clases)';
        actividadSelect.appendChild(opt);
      }
      if (prev && counts[prev]) actividadSelect.value = prev;
      else actividadSelect.value = '';
      actividadWrap.style.display = prefijos.length > 0 ? 'block' : 'none';
    }

    function filterByActividad(porDia, prefix) {
      if (!prefix) return porDia;
      const target = String(prefix).toUpperCase();
      const out = [];
      for (const dia of porDia) {
        const filtered = dia.slots.filter(function(s) { return prefixOf(s.nombre) === target; });
        if (filtered.length > 0) {
          out.push({ fecha: dia.fecha, slots: filtered });
        }
      }
      return out;
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
        loadingMsg.textContent = 'No hay huecos disponibles para esta actividad. Prueba con otra opción.';
        loadingMsg.style.display = 'block';
        slotsBox.style.display = 'none';
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
