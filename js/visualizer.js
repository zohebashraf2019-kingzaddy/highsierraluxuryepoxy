import { GarageEngine, hexToLin } from './garage-engine.js';

/* ----------------------------------------------------------- design data */
export const COLORS = {
  domino:   { name: 'Domino Gray',    swatch: ['#6c6f72', '#ecebe7', '#141414'], base: '#6c6f72', chips: ['#141414', '#e6e5e1', '#8b8d90', '#3a3b3d', '#6c6e71'], metA: '#25272a', metB: '#b8bcc1', vein: '#f2f2f0' },
  graphite: { name: 'Graphite Black', swatch: ['#1a1b1d', '#5d5f63', '#cfcfcc'], base: '#1a1b1d', chips: ['#0d0d0e', '#2c2d30', '#5d5f63', '#2c2d30', '#cfcfcc'], metA: '#09090a', metB: '#5f6266', vein: '#f3ead6' },
  desert:   { name: 'Desert Sand',    swatch: ['#b39c7c', '#6b4e35', '#ece2cf'], base: '#b39c7c', chips: ['#c9b08a', '#6b4e35', '#ece2cf', '#a08463', '#1a1714'], metA: '#6a5539', metB: '#e6d3ae', vein: '#fff6e3' },
  arctic:   { name: 'Arctic White',   swatch: ['#e4e5e3', '#c8c9ca', '#8e9093'], base: '#e4e5e3', chips: ['#f4f4f2', '#c8c9ca', '#8e9093', '#f4f4f2', '#2a2a2b'], metA: '#9fa4aa', metB: '#fdfdfc', vein: '#7f858c' },
  slate:    { name: 'Slate Blue',     swatch: ['#4b5f77', '#3b63a6', '#eef0f2'], base: '#4b5f77', chips: ['#3b63a6', '#9aa3ad', '#eef0f2', '#1e2c47', '#5b7fb8'], metA: '#18263b', metB: '#8eaacd', vein: '#e9f0fa' },
  copper:   { name: 'Copper Stone',   swatch: ['#6f4128', '#b8693a', '#cda57b'], base: '#6f4128', chips: ['#b8693a', '#4a2c1b', '#cda57b', '#141110', '#8a4a26'], metA: '#0d0907', metB: '#a5582b', vein: '#f0822f' },
};
export const CHIP_LIB = {
  black: ['Black', '#141414'], charcoal: ['Charcoal', '#3a3b3d'], gray: ['Gray', '#8b8d90'], white: ['White', '#ecebe7'],
  cream: ['Cream', '#ece2cf'], tan: ['Tan', '#c9b08a'], brown: ['Brown', '#6b4e35'], copper: ['Copper', '#b8693a'],
  blue: ['Blue', '#3b63a6'], navy: ['Navy', '#1e2c47'], red: ['Red', '#a3262a'], gold: ['Gold', '#c9a24a'],
};
export const FINISHES = {
  matte: { name: 'Matte', id: 0, note: 'Low-sheen, no glare' },
  satin: { name: 'Satin', id: 1, note: 'Soft, blurred sheen' },
  gloss: { name: 'High Gloss', id: 2, note: 'Mirror polyaspartic topcoat' },
  metallic: { name: 'Metallic Epoxy', id: 3, note: 'Pearlescent swirl, high gloss' },
  marble: { name: 'Marble Metallic', id: 4, note: 'Veined stone look, high gloss' },
};
export const FLAKES = {
  none: { name: 'No Flakes', cover: 0, gap: 0 },
  light: { name: 'Light Flakes', cover: 0.24, gap: 0.2 },
  medium: { name: 'Medium Flakes', cover: 0.56, gap: 0.13 },
  full: { name: 'Full Broadcast', cover: 1, gap: 0.045 },
  custom: { name: 'Custom Blend', cover: 1, gap: 0.045 },
};
export const VEHICLES = { sports: 'Luxury Sports Car', truck: 'Full-Size Pickup', suv: 'Family SUV', empty: 'Empty Garage' };
const VIEWS = {
  full: { name: 'Full Garage', pos: [2.75, 1.85, 3.38], target: [-0.25, 0.1, -0.95], fov: 60 },
  close: { name: 'Floor Close-Up', pos: [1.45, 0.4, 1.95], target: [0.85, 0.0, 0.95], fov: 42 },
  showroom: { name: 'Showroom', pos: [1.25, 1.05, 3.2], target: [-1.45, 0.55, -0.25], fov: 46, car: true },
  empty: { name: 'Empty Garage', pos: [0.0, 2.2, 3.42], target: [0.0, 0.0, -1.1], fov: 64, empty: true },
  top: { name: 'Top-Down', pos: [0.55, 2.88, 0.72], target: [0.55, 0.0, 0.7], fov: 74 },
};
export const DEFAULT = { color: 'domino', finish: 'gloss', flakes: 'full', custom: ['black', 'white', 'gray', 'gold'], density: 100, vehicle: 'sports', showCar: true, view: 'full' };

export function describe(s) {
  const parts = [COLORS[s.color].name, FINISHES[s.finish].name];
  if (s.finish !== 'metallic' && s.finish !== 'marble') {
    parts.push(s.flakes === 'custom' ? `Custom Flake (${s.custom.map((c) => CHIP_LIB[c][0]).join('/')}, ${s.density}%)` : FLAKES[s.flakes].name);
  }
  return parts.join(' · ');
}
export function encode(s) {
  return [s.color, s.finish, s.flakes, s.custom.join('-'), s.density, s.vehicle].join('.');
}
export function decode(str) {
  const [color, finish, flakes, custom, density, vehicle] = String(str || '').split('.');
  const s = { ...DEFAULT };
  if (COLORS[color]) s.color = color;
  if (FINISHES[finish]) s.finish = finish;
  if (FLAKES[flakes]) s.flakes = flakes;
  const cs = (custom || '').split('-').filter((c) => CHIP_LIB[c]);
  if (cs.length) s.custom = cs.slice(0, 5);
  const d = parseInt(density, 10); if (d >= 10 && d <= 100) s.density = d;
  if (VEHICLES[vehicle]) s.vehicle = vehicle;
  return s;
}

function floorParams(s) {
  const C = COLORS[s.color];
  let chips = s.flakes === 'custom' ? s.custom.map((c) => CHIP_LIB[c][1]) : C.chips;
  chips = Array.from({ length: 5 }, (_, i) => hexToLin(chips[i % chips.length]));
  let { cover, gap } = FLAKES[s.flakes];
  if (s.flakes === 'custom') { const d = s.density / 100; cover = d; gap = 0.045 + (1 - d) * 0.18; }
  const metallic = s.finish === 'metallic' || s.finish === 'marble';
  if (metallic) cover = 0;
  const avg = [0, 1, 2].map((k) => chips.reduce((a, c) => a + c[k], 0) / 5);
  const coverEff = Math.min(0.95, cover * (1 - gap * 2.4));
  const base = hexToLin(C.base);
  const env = metallic ? hexToLin(C.metA).map((v, k) => (v + hexToLin(C.metB)[k]) * 0.3)
    : base.map((v, k) => (v + (avg[k] - v) * coverEff) * 0.55);
  return { base, chips, chipAvg: avg, cover, gap, coverEff, scale: 82, finish: FINISHES[s.finish].id,
    metA: hexToLin(C.metA), metB: hexToLin(C.metB), vein: hexToLin(C.vein), env };
}

/* --------------------------------------------------------------- the UI */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STORE = 'hs-epoxy-designs';
const readSaved = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
const writeSaved = (l) => { try { localStorage.setItem(STORE, JSON.stringify(l)); } catch { /* private mode */ } };

export function initVisualizer() {
  const root = $('#visualizer');
  if (!root) return;
  const stage = $('#vizStage'), canvas = $('#garageCanvas');
  let state = { ...DEFAULT };
  const hash = new URLSearchParams(location.hash.slice(1)).get('design') || new URLSearchParams(location.search).get('design');
  if (hash) state = decode(hash);

  let engine = null;
  try { engine = new GarageEngine(canvas); }
  catch (err) {
    console.warn('[visualizer] falling back to photo preview:', err);
    stage.classList.add('is-fallback');
    $('.viz-fallback', stage).hidden = false;
  }
  if (engine) {
    new ResizeObserver(() => engine.resize()).observe(canvas);
    // keep the static fallback hidden but signal ready for CSS fade-in
    requestAnimationFrame(() => stage.classList.add('is-ready'));
  }

  /* --- build controls --- */
  const colorWrap = $('#vizColors');
  colorWrap.innerHTML = Object.entries(COLORS).map(([id, c]) => `
    <button type="button" class="swatch" data-color="${id}" aria-pressed="false" title="${c.name}">
      <span class="swatch-chip" style="--a:${c.swatch[0]};--b:${c.swatch[1]};--c:${c.swatch[2]}"></span>
      <span class="swatch-name">${c.name}</span>
    </button>`).join('');
  $('#vizFinish').innerHTML = Object.entries(FINISHES).map(([id, f]) =>
    `<button type="button" class="opt" data-finish="${id}" aria-pressed="false"><b>${f.name}</b><small>${f.note}</small></button>`).join('');
  $('#vizFlakes').innerHTML = Object.entries(FLAKES).map(([id, f]) =>
    `<button type="button" class="pill" data-flakes="${id}" aria-pressed="false">${f.name}</button>`).join('');
  $('#vizChips').innerHTML = Object.entries(CHIP_LIB).map(([id, [n, hex]]) =>
    `<button type="button" class="chip" data-chip="${id}" style="--c:${hex}" aria-pressed="false" title="${n}"><span></span>${n}</button>`).join('');
  $('#vizVehicles').innerHTML = Object.entries(VEHICLES).map(([id, n]) =>
    `<button type="button" class="pill" data-vehicle="${id}" aria-pressed="false">${n}</button>`).join('');
  $('#vizViews').innerHTML = Object.entries(VIEWS).map(([id, v]) =>
    `<button type="button" class="view-btn" data-view="${id}" aria-pressed="false">${v.name}</button>`).join('');

  const press = (sel, attr, val) => $$(sel, root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));

  function apply({ fly = false } = {}) {
    press('[data-color]', 'color', state.color);
    press('[data-finish]', 'finish', state.finish);
    press('[data-flakes]', 'flakes', state.flakes);
    press('[data-vehicle]', 'vehicle', state.vehicle);
    press('[data-view]', 'view', state.view);
    $$('[data-chip]', root).forEach((b) => b.setAttribute('aria-pressed', String(state.custom.includes(b.dataset.chip))));
    const metallic = state.finish === 'metallic' || state.finish === 'marble';
    $('#flakeGroup').classList.toggle('is-disabled', metallic);
    $$('[data-flakes]', root).forEach((b) => (b.disabled = metallic));
    $('#flakeNote').hidden = !metallic;
    $('#customFlakes').hidden = state.flakes !== 'custom' || metallic;
    $('#vizDensity').value = state.density; $('#densityOut').textContent = state.density + '%';
    const carVisible = state.showCar && state.vehicle !== 'empty';
    const toggle = $('#vizCarToggle');
    toggle.setAttribute('aria-pressed', String(carVisible));
    toggle.textContent = carVisible ? 'Hide Vehicle' : 'Show Vehicle';
    toggle.disabled = state.vehicle === 'empty';
    $('#vizLabel').textContent = describe(state);
    $('#vizFallbackLabel') && ($('#vizFallbackLabel').textContent = describe(state));
    $('#vizFallbackTint') && ($('#vizFallbackTint').style.background = COLORS[state.color].swatch[0]);
    if (engine) {
      engine.setFloor(floorParams(state));
      engine.setCar(state.vehicle, carVisible);
      if (fly) { const v = VIEWS[state.view]; engine.flyTo(v.pos, v.target, v.fov, fly === 'instant' ? 0 : 1100); }
    }
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    const d = b.dataset;
    if (d.color) state.color = d.color;
    else if (d.finish) state.finish = d.finish;
    else if (d.flakes) state.flakes = d.flakes;
    else if (d.chip) {
      const i = state.custom.indexOf(d.chip);
      if (i >= 0) { if (state.custom.length > 1) state.custom.splice(i, 1); }
      else { state.custom.push(d.chip); if (state.custom.length > 5) state.custom.shift(); }
    } else if (d.vehicle) {
      state.vehicle = d.vehicle; state.showCar = d.vehicle !== 'empty';
      if (d.vehicle === 'empty' && state.view === 'showroom') { state.view = 'empty'; apply({ fly: true }); return; }
    } else if (d.view) {
      state.view = d.view;
      const v = VIEWS[d.view];
      if (v.empty) state.showCar = false;
      if (v.car) { state.showCar = true; if (state.vehicle === 'empty') state.vehicle = 'sports'; }
      apply({ fly: true }); return;
    } else return;
    apply();
  });
  $('#vizDensity').addEventListener('input', (e) => { state.density = +e.target.value; apply(); });
  $('#vizCarToggle').addEventListener('click', () => { state.showCar = !state.showCar; apply(); });

  /* --- camera interaction --- */
  if (engine) {
    const pts = new Map(); let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); stage.classList.add('is-touched'); });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const [px, py] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) engine.orbit(e.clientX - px, e.clientY - py);
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) engine.zoom(pinch / d); pinch = d;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); engine.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    $('#vizZoomIn').addEventListener('click', () => engine.zoom(0.82));
    $('#vizZoomOut').addEventListener('click', () => engine.zoom(1.22));
    $('#vizRecenter').addEventListener('click', () => apply({ fly: true }));
  }

  /* --- before / after --- */
  const cmp = $('#vizCompare'), cmpBtn = $('#vizCompareBtn');
  let split = 0.5;
  const setSplit = (x) => {
    split = Math.max(0.02, Math.min(0.98, x));
    cmp.style.setProperty('--split', split * 100 + '%');
    engine && engine.setSplit(split);
  };
  function setCompare(on) {
    cmp.hidden = !on; cmpBtn.setAttribute('aria-pressed', String(on));
    cmpBtn.textContent = on ? 'Exit Before / After' : 'Before / After';
    if (engine) engine.setSplit(on ? split : -1);
    if (on) setSplit(split);
  }
  cmpBtn.addEventListener('click', () => setCompare(cmp.hidden));
  const handle = $('.cmp-handle', cmp);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const move = (ev) => { const r = stage.getBoundingClientRect(); setSplit((ev.clientX - r.left) / r.width); };
    const stop = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop);
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') setSplit(split - 0.04);
    if (e.key === 'ArrowRight') setSplit(split + 0.04);
  });

  /* --- actions --- */
  const toast = (msg) => {
    const t = $('#vizToast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  };
  const shareUrl = () => `${location.origin}${location.pathname}#design=${encode(state)}`;

  function renderSaved() {
    const list = readSaved(), wrap = $('#vizSaved');
    wrap.hidden = !list.length;
    $('#vizSavedList').innerHTML = list.map((d, i) => `
      <li><button type="button" class="saved-load" data-i="${i}">${d.thumb ? `<img src="${d.thumb}" alt="">` : ''}<span>${describe(decode(d.code))}</span></button>
      <button type="button" class="saved-del" data-i="${i}" aria-label="Remove saved design">×</button></li>`).join('');
  }
  $('#vizSavedList').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const list = readSaved(), i = +b.dataset.i;
    if (b.classList.contains('saved-del')) { list.splice(i, 1); writeSaved(list); renderSaved(); return; }
    state = { ...decode(list[i].code), view: state.view }; apply({ fly: true }); toast('Design loaded');
  });

  function thumb() {
    if (!engine) return '';
    const src = engine.snapshot('image/jpeg', 0.85), img = new Image();
    return new Promise((res) => {
      img.onload = () => {
        const c = document.createElement('canvas'), w = 240; c.width = w; c.height = Math.round((img.height / img.width) * w);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => res(''); img.src = src;
    });
  }

  $('#vizSave').addEventListener('click', async () => {
    const code = encode(state), list = readSaved().filter((d) => d.code !== code);
    list.unshift({ code, thumb: await thumb(), at: Date.now() });
    writeSaved(list.slice(0, 6)); renderSaved();
    history.replaceState(null, '', '#design=' + code);
    try { await navigator.clipboard.writeText(shareUrl()); toast('Design saved · share link copied'); }
    catch { toast('Design saved to this device'); }
  });
  $('#vizReset').addEventListener('click', () => { state = { ...DEFAULT }; setCompare(false); apply({ fly: true }); toast('Design reset'); });
  $('#vizDownload')?.addEventListener('click', () => {
    if (!engine) return;
    const a = document.createElement('a'); a.href = engine.snapshot('image/jpeg', 0.93);
    a.download = `high-sierra-floor-${state.color}-${state.finish}.jpg`; a.click();
  });
  $('#vizFullscreen')?.addEventListener('click', () => {
    const el = $('.viz', root);
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => {});
  });

  $('#vizEstimate').addEventListener('click', async () => {
    const detail = { summary: describe(state), code: encode(state), link: shareUrl(), thumb: await thumb(),
      system: state.finish === 'metallic' || state.finish === 'marble' ? 'Metallic Epoxy' : state.flakes === 'none' ? 'Solid Color Epoxy' : 'Flake System' };
    document.dispatchEvent(new CustomEvent('design:estimate', { detail }));
  });

  renderSaved();
  apply({ fly: 'instant' });
}
