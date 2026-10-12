// Donnie Horoscope in the browser: the modern look of the Android app. Calculations and the
// chart drawing come from the app's own engine compiled to JavaScript (donnie.js); charts are
// kept in this browser (localStorage) and can be opened from and saved to files.
'use strict';
const APP_VERSION = 23;
const D = window['astro_dos:web'].com.astrodos.zodiac.web.Donnie;   // the engine (donnie.js, a UMD module)

// ------------------------------------------------------------ storage (this browser only)
const store = {
  get(k, d) { try { const v = localStorage.getItem('donnie.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('donnie.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
const S = {
  charts: store.get('charts', {}),          // "NAME.HOR" -> .HOR text
  hor: store.get('current', ''),            // the chart shown
  koch: store.get('koch', false),
  night: store.get('theme', 'night') !== 'day',
  page: 'charts', highlight: -1, highlight2: -1, query: '',
  editor: null, preview: null,
};
function saveCharts() {
  if (!store.set('charts', S.charts)) toast('The browser did not let the charts be saved here. Save them as a .zip file.');
}
function saveState() { store.set('current', S.hor); store.set('koch', S.koch); store.set('theme', S.night ? 'night' : 'day'); }
if (S.hor && !D.birth(S.hor)) S.hor = '';

// ------------------------------------------------------------ small DOM helpers
const $ = (s) => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}
const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, onclick, type: 'button' }, label);
const note = (t) => h('p', { class: 'note' }, t);
const title3 = (t) => h('h3', {}, t);
let C = D.colors(S.night);

/** A planet ('p'), sign ('s') or aspect ('a') symbol, drawn by the engine. */
function glyph(kind, i, size, color) {
  const dpr = window.devicePixelRatio || 1;
  const c = h('canvas', { class: 'g', width: Math.round(size * dpr), height: Math.round(size * dpr) });
  c.style.width = c.style.height = size + 'px';
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  D.glyph(g, kind, i, size, color);
  return c;
}
const ink = () => D.inkColor(S.night);

function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.style.display = 'none'; }, ms);
}

/** A modal dialog; resolves with the chosen button's value (null when dismissed). */
function dialog(titleText, body, buttons) {
  return new Promise((resolve) => {
    const box = h('div', { class: 'box', role: 'dialog' }, h('h4', {}, titleText));
    if (typeof body === 'string') box.append(h('p', { style: 'margin:0;white-space:pre-line' }, body)); else if (body) box.append(body);
    const bar = h('div', { class: 'btns' });
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', key); resolve(v); };
    for (const b of buttons) bar.append(btn(b.label, () => done(b.value), b.primary ? 'primary' : ''));
    box.append(bar);
    const wrap = h('div', { class: 'dlg', onclick: (e) => { if (e.target === wrap) done(null); } }, box);
    const key = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', key);
    document.body.append(wrap);
    (box.querySelector('input') || bar.querySelector('.primary') || bar.lastChild).focus();
  });
}
const confirmBox = (msg, yes) => dialog(msg, null, [{ label: 'Cancel', value: false }, { label: yes, value: true, primary: true }]);

function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------ theme
function applyTheme() {
  C = D.colors(S.night);
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries({ bg: C.bg, surface: C.surface, surface2: C.surface2, ink: C.ink, sub: C.sub, line: C.line,
    accent: C.accent, 'on-accent': C.onAccent, hard: C.hard })) r.setProperty('--' + k, v);
  document.querySelector('meta[name=theme-color]').content = S.night ? '#0B1026' : '#F4F2EC';
  document.body.style.colorScheme = S.night ? 'dark' : 'light';
}

// ------------------------------------------------------------ the chart (4:3), with zoom
const chart = { canvas: $('#chart'), zoom: 1, ox: 0, oy: 0, w: 0, h: 0, planets: [] };
function drawChart() {
  const cv = chart.canvas, dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width !== chart.w || r.height !== chart.h) {
    chart.w = r.width; chart.h = r.height; chart.zoom = 1; chart.ox = chart.oy = 0;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(dpr * chart.zoom, 0, 0, dpr * chart.zoom, dpr * chart.ox, dpr * chart.oy);
  const hor = S.editor ? (S.preview || '') : S.hor;
  try {
    chart.planets = D.draw(g, hor, S.koch, S.night, chart.w, chart.h, S.editor ? -1 : S.highlight, S.editor ? -1 : S.highlight2);
  } catch (e) { chart.planets = []; }
  const zoomed = chart.zoom > 1.01;
  cv.classList.toggle('zoomed', zoomed);
  // a short hint when a chart first appears and when the zoom changes; it fades so it never hides the chart
  const hint = !hor ? '' : zoomed ? 'Drag to move · double-tap for the whole chart' : 'Double-tap the chart to zoom in';
  const el = $('#zoomhint');
  if (hint && (zoomed !== drawChart.zoomed || hor !== drawChart.hor)) {
    el.textContent = hint; el.classList.add('on');
    clearTimeout(drawChart.t); drawChart.t = setTimeout(() => el.classList.remove('on'), 2500);
  } else if (!hint) el.classList.remove('on');
  drawChart.zoomed = zoomed; drawChart.hor = hor;
}
function clampZoom() {
  chart.zoom = Math.min(4, Math.max(1, chart.zoom));
  chart.ox = Math.min(0, Math.max(chart.w - chart.w * chart.zoom, chart.ox));
  chart.oy = Math.min(0, Math.max(chart.h - chart.h * chart.zoom, chart.oy));
}
/** Zoom to [z], keeping the chart point under (fx, fy) in place. */
function zoomAt(z, fx, fy) {
  const px = (fx - chart.ox) / chart.zoom, py = (fy - chart.oy) / chart.zoom;
  chart.zoom = Math.min(4, Math.max(1, z));
  chart.ox = fx - px * chart.zoom; chart.oy = fy - py * chart.zoom;
  clampZoom(); drawChart();
}
(() => {
  const cv = chart.canvas, pts = new Map();
  let moved = false, lastTap = 0, pinch = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', (e) => {
    const p = pos(e); pts.set(e.pointerId, p); moved = false;
    if (chart.zoom > 1.01 || pts.size > 1) { cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: chart.zoom }; }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const q = pos(e), dx = q.x - p.x, dy = q.y - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    pts.set(e.pointerId, q);
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoomAt(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1 && moved && chart.zoom > 1.01) {
      chart.ox += dx; chart.oy += dy; clampZoom(); drawChart();
    }
  });
  const end = (e) => {
    const p = pts.get(e.pointerId); pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) cv.classList.remove('drag');
    if (!p || moved || pts.size || e.type === 'pointercancel') return;
    const now = Date.now();
    if (now - lastTap < 320) {                       // double-tap: 200 %, or back to the whole chart
      lastTap = 0;
      if (chart.zoom > 1.01) { chart.zoom = 1; chart.ox = chart.oy = 0; drawChart(); } else zoomAt(2, p.x, p.y);
      return;
    }
    lastTap = now;
    setTimeout(() => { if (lastTap === now) tapChart(p.x, p.y); }, 320);
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    if (chart.zoom <= 1.01 && !e.ctrlKey) return;    // let the page scroll
    e.preventDefault();
    const p = pos(e); zoomAt(chart.zoom * Math.exp(-e.deltaY * 0.002), p.x, p.y);
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => e.preventDefault());
})();
function tapChart(x, y) {
  if (!S.hor || S.editor) return;
  const cx = (x - chart.ox) / chart.zoom, cy = (y - chart.oy) / chart.zoom;
  let best = -1, bd = (Math.min(chart.w, chart.h) / 2 * 0.97 * 0.09) ** 2;
  for (let i = 0; i < chart.planets.length / 2; i++) {
    const d = (chart.planets[2 * i] - cx) ** 2 + (chart.planets[2 * i + 1] - cy) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) highlight(best); else if (S.highlight >= 0) highlight(-1);
}
function highlight(i, other = -1) {
  const same = i === S.highlight && other === S.highlight2;
  S.highlight = same ? -1 : i;
  S.highlight2 = same || i < 0 ? -1 : other;
  drawChart(); updateTitle();
  if (S.page === 'planets' || S.page === 'aspects') show(S.page, true);
}

// ------------------------------------------------------------ frame: title, actions, navigation
const PAGES = [['charts', '☰', 'Charts'], ['planets', '♃', 'Planets'], ['houses', '⌂', 'Houses'], ['aspects', '△', 'Aspects'], ['more', '⋯', 'More']];
function buildNav() {
  const n = $('#nav'); n.innerHTML = '';
  for (const [k, icon, label] of PAGES) n.append(h('button', { 'data-p': k, onclick: () => show(k), type: 'button' }, h('b', { class: 'sym' }, icon), label));
}
let data = null;
function setChart(hor, keepPage) {
  S.hor = hor; S.highlight = S.highlight2 = -1;
  data = hor ? D.data(hor, S.koch) : null;
  saveState(); drawChart();
  if (!keepPage) show(hor ? 'planets' : 'charts');
}
function updateTitle() {
  const t = $('#title');
  if (S.editor) return;
  if (S.highlight >= 0 && S.highlight2 >= 0 && data) {
    const i = Math.max(S.highlight, S.highlight2), j = Math.min(S.highlight, S.highlight2);
    t.textContent = `${D.planetNames[j]} ${D.aspectName(data.grid[i][j]).toLowerCase()} ${D.planetNames[i]}`;
  } else if (S.highlight >= 0 && data) {
    const p = data.planets[S.highlight];
    t.textContent = `${D.planetNames[S.highlight]} ${p.pos} ${D.signShort[p.sign]} · H${p.house}`;
  } else if (S.page === 'charts' || !data) t.textContent = 'Donnie Horoscope';
  else t.textContent = PAGES.find(p => p[0] === S.page)[2] + (S.page === 'houses' ? '  ·  ' + (S.koch ? 'Koch' : 'Placidus') : '');
}
function show(p, keepScroll) {
  const main = $('#page'), top = main.scrollTop;
  if (!data && (p === 'planets' || p === 'houses' || p === 'aspects')) p = 'charts';
  S.page = p; S.editor = null; S.preview = null;
  document.body.classList.remove('editing');
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.p === p);
  const a = $('#actions'); a.innerHTML = '';
  if (data && p !== 'charts') a.append(btn('Edit', () => edit(S.hor), 'small'), btn('PDF', pdf, 'small'));
  updateTitle();
  main.innerHTML = '';
  ({ charts: chartsPage, planets: planetsPage, houses: housesPage, aspects: aspectsPage, more: morePage })[p](main);
  main.scrollTop = keepScroll ? top : 0;
  drawChart();
}

// ------------------------------------------------------------ pages
function fold(s) {
  return s.toLowerCase().replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/\p{M}+/gu, '');
}
function entries() {
  return Object.keys(S.charts).sort().map(file => {
    const b = D.birth(S.charts[file]);
    const key = fold([b && b.name, b && b.place, b && b.date, b && b.time, b && b.time.replace('.', ':'), b && b.lon, b && b.lat, file].filter(Boolean).join(' '));
    return { file, b, key };
  });
}
function shownEntries(all) {
  const q = fold(S.query.trim());
  return q ? all.filter(e => q.split(' ').filter(Boolean).every(w => e.key.includes(w))) : all;
}

function chartsPage(b) {
  b.append(h('div', { class: 'row2' }, btn('+  New chart', () => edit(null), 'primary'), btn('Chart for now', chartForNow)));
  if (data) b.append(h('div', { class: 'row2' }, btn('Edit current', () => edit(S.hor)), btn('PDF of this chart', pdf)));
  const all = entries();
  const title = title3(''), list = h('div');
  const fill = () => {
    list.innerHTML = '';
    const shown = shownEntries(all);
    title.textContent = S.query.trim() ? `Saved charts (${shown.length} of ${all.length})` : `Saved charts (${all.length})`;
    if (!all.length) list.append(note('No saved charts yet. Save one from the birth data form, or open .HOR files or a chart pack (.zip) below.'));
    else if (!shown.length) list.append(note(`No chart matches "${S.query.trim()}".`));
    for (const e of shown) list.append(chartRow(e));
  };
  if (all.length) {
    const input = h('input', { type: 'search', placeholder: 'Search name, place, date …', value: S.query, autocomplete: 'off',
      oninput: () => { S.query = input.value; fill(); } });
    b.append(h('div', { class: 'search' }, input));
  }
  b.append(title, list);
  fill();
  b.append(h('div', { class: 'row2' }, btn('Open .HOR or .zip files…', () => $('#file').click()), btn('Save charts as .zip…', exportZip)));
  b.append(note('Your charts are kept in this browser only, on this device: nothing is sent anywhere. ' +
    'Clearing the browser\'s site data deletes them, so keep a .zip of your charts as a backup. ' +
    'The .HOR files and chart packs are the same as in the Android app and the 1992 program.'));
}
function chartRow(e) {
  const b = e.b;
  const r = h('div', { class: 'list-row', onclick: () => { if (b) setChart(S.charts[e.file]); } },
    h('div', { class: 'grow' }, h('div', { class: 't' }, (b && b.name.trim()) || e.file.replace(/\.HOR$/, '')),
      h('div', { class: 's' }, [b && b.date, b && b.time.replace('.', ':'), b && b.place.trim(), e.file].filter(Boolean).join('  ·  '))),
    h('button', { class: 'icon-btn', title: 'Download ' + e.file, 'aria-label': 'Download ' + e.file, type: 'button',
      onclick: (ev) => { ev.stopPropagation(); download(new Blob([ChartZip.bytes(S.charts[e.file])], { type: 'application/octet-stream' }), e.file); } }, '⤓'),
    h('button', { class: 'icon-btn', title: 'Delete ' + e.file, 'aria-label': 'Delete ' + e.file, type: 'button',
      onclick: async (ev) => {
        ev.stopPropagation();
        if (await confirmBox(`Delete ${e.file}?`, 'Delete')) { delete S.charts[e.file]; saveCharts(); show('charts', true); }
      } }, '✕'));
  return r;
}

function planetsPage(b) {
  data.planets.forEach((p, i) => {
    const r = h('div', { class: 'list-row' + (i === S.highlight ? ' sel' : ''), onclick: () => highlight(i) },
      glyph('p', i, 44, ink()),
      h('div', { class: 'grow' }, h('div', { class: 't' }, D.planetNames[i] + (p.flag === 'R' ? '  R' : p.flag === 'D' ? '  stationary' : '')),
        h('div', { class: 's' }, `House ${p.house}  ·  decl. ${p.decl}`)),
      h('div', { class: 'v' }, p.pos), glyph('s', p.sign, 36, D.signColor(S.night, p.sign)));
    b.append(r);
  });
  b.append(note('Tap a planet here or in the chart to show only its aspects. Double-tap the chart to zoom in.'));
}

function seg(labels, sel, pick) {
  const s = h('div', { class: 'seg', role: 'radiogroup' });
  const set = (k) => [...s.children].forEach((c, i) => { c.classList.toggle('on', i === k); c.setAttribute('aria-checked', i === k); });
  labels.forEach((l, i) => s.append(h('button', { type: 'button', role: 'radio', onclick: () => { set(i); pick(i); } }, l)));
  set(sel); s.select = set;
  return s;
}

function housesPage(b) {
  b.append(h('div', { class: 'full' }, seg(['Placidus', 'Koch'], S.koch ? 1 : 0, (k) => {
    S.koch = k === 1; setChart(S.hor, true); show('houses', true);
  })));
  const names = { 0: 'Ascendant', 3: 'Imum Coeli', 6: 'Descendant', 9: 'Midheaven' };
  data.houses.forEach((c, k) => b.append(h('div', { class: 'list-row', style: 'cursor:default' },
    h('div', { class: 'num' }, String(k + 1)),
    h('div', { class: 'grow' }, h('div', { class: 't' }, D.signNames[c.sign]), names[k] ? h('div', { class: 's' }, names[k]) : null),
    h('div', { class: 'v' }, c.pos), glyph('s', c.sign, 36, D.signColor(S.night, c.sign)))));
}

function aspectGrid() {
  const cv = h('canvas', { id: 'grid' });
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1, w = cv.getBoundingClientRect().width, n = data.planets.length;
    const cell = w / (n + 1), hgt = cell * n;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); cv.style.height = hgt + 'px';
    const g = cv.getContext('2d');
    const at = (x, y, f) => { g.setTransform(dpr, 0, 0, dpr, dpr * x, dpr * y); f(); };
    for (let i = 0; i < n; i++) {
      at(0, i * cell, () => D.glyph(g, 'p', i, cell, ink()));
      for (let j = 0; j < i; j++) {
        const x = (j + 1) * cell, y = i * cell;
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.strokeStyle = C.line; g.lineWidth = 0.7; g.strokeRect(x, y, cell, cell);
        const code = data.grid[i][j];
        if (code >= 3 && code <= 8) at(x, y, () => D.glyph(g, 'a', code, cell, D.aspectColor(S.night, code)));
      }
      at((i + 1) * cell + cell * 0.1, i * cell + cell * 0.1, () => D.glyph(g, 'p', i, cell * 0.8, D.subColor(S.night)));
    }
  });
  return cv;
}
function aspectsPage(b) {
  b.append(aspectGrid());
  b.append(title3('Aspects in this chart'));
  b.append(note('Tap an aspect to show only its line in the chart. Aspects are counted in whole degrees, as in the original.'));
  for (const a of data.aspects) {
    b.append(h('div', { class: 'list-row' + (a.a === S.highlight && a.b === S.highlight2 ? ' sel' : ''), onclick: () => highlight(a.a, a.b) },
      glyph('p', a.a, 36, ink()), glyph('a', a.code, 36, D.aspectColor(S.night, a.code)), glyph('p', a.b, 36, ink()),
      h('div', { class: 'grow' }, h('div', { style: 'font-size:15px' }, a.text), h('div', { class: 's' }, 'orb ' + a.orb))));
  }
  b.append(title3('The planetary aspects'));
  for (const a of D.aspectTexts()) {
    b.append(h('div', { class: 'card' },
      h('div', { style: 'display:flex;align-items:center;gap:8px;font-weight:700' }, glyph('a', a.code, 32, D.aspectColor(S.night, a.code)),
        `${a.name}  ·  ${a.angle}°  ·  ${a.mode}`),
      h('div', { style: 'color:var(--accent);font-weight:700;padding-top:4px' }, a.keyword), h('p', {}, a.text)));
  }
}

function morePage(b) {
  if (data) {
    const bt = D.birth(S.hor);
    b.append(title3('Overview'));
    const o = h('div', { class: 'card' });
    const kv = (k, v) => o.append(h('div', { class: 'kv' }, h('span', {}, k), h('span', {}, v)));
    kv('Name', bt.name); if (bt.place.trim()) kv('Birthplace', bt.place);
    kv('Long., Lat.', data.lonLat); if (bt.elevation.trim()) kv('Elevation', bt.elevation);
    kv('Date, time', data.dateTime); kv('Time zone, DST', data.zone);
    kv('GMT', data.gmt); kv('Day (GMT)', data.day); kv('Sidereal time', data.lst); kv('GMT sid. time 0h', data.gmst0);
    kv('Moon phase', data.moon);
    b.append(o);
    b.append(title3('Planetary weights'));
    const stat = (name, n, color) => h('div', {}, h('b', { style: color ? 'color:' + color : '' }, String(n)), h('small', {}, name));
    b.append(h('div', { class: 'card' },
      h('div', { class: 'stats' }, ...[0, 1, 2, 3].map(k => stat(D.elementNames[k], data.elements[k], C.elements[k]))),
      h('div', { class: 'stats' }, ...[0, 1, 2].map(k => stat(D.modeNames[k], data.modes[k])))));
    b.append(title3('Sensitive points'));
    b.append(h('div', { class: 'card' }, ...data.points.map(p => h('div', { style: 'display:flex;align-items:center;gap:6px;padding:2px 0' },
      h('span', { style: 'flex:1' }, p.name), h('span', {}, p.pos), glyph('s', p.sign, 32, D.signColor(S.night, p.sign)),
      h('span', { style: 'width:96px;color:var(--sub);font-size:14px' }, D.signNames[p.sign])))));
    b.append(title3('PDF'));
    b.append(h('div', { class: 'full' }, btn('PDF of this chart', pdf, 'primary')));
    b.append(note('Opens the A4 page of this chart: choose "Save as PDF" or a printer in the print window.'));
  }
  b.append(title3('The Chaldean Lords'));
  for (const l of D.lords()) b.append(h('div', { class: 'card' }, h('div', { style: 'color:var(--accent);font-weight:700' }, l.head),
    h('p', { style: 'white-space:pre-line' }, l.text)));
  b.append(title3('Look'));
  b.append(h('div', { class: 'full' }, seg(['Night', 'Day'], S.night ? 0 : 1, (k) => { S.night = k === 0; saveState(); applyTheme(); show('more', true); })));
  b.append(note('The Classic DOS look, the original 1992 screens, is in the Android app.'));
  b.append(title3('Your charts in this browser'));
  const n = Object.keys(S.charts).length;
  b.append(h('div', { class: 'card' }, h('div', {}, `${n} saved chart${n === 1 ? '' : 's'}, kept only in this browser on this device.`),
    h('div', { class: 'row2', style: 'padding:10px 0 0' }, btn('Save all as .zip', () => exportZip(true)), btn('Open files…', () => $('#file').click()))));
  b.append(title3('Android app and manual'));
  b.append(h('div', { class: 'card' }, h('div', { style: 'font-weight:700' }, `Donnie Horoscope web version ${APP_VERSION}`),
    h('p', { style: 'color:var(--sub)' }, 'The Android app, the illustrated manual and chart packs are on the download page.'),
    h('div', { class: 'full', style: 'margin:10px 0 0' }, h('a', { class: 'btn primary', href: '../', style: 'text-decoration:none' }, 'Open download page'))));
  b.append(title3('Donnie'));
  b.append(h('div', { class: 'card' }, h('div', {}, 'This app carries the name of Donnie, the family\'s much-loved dog. Here he is.'),
    h('img', { class: 'photo', src: 'img/donnie.jpg', alt: 'Donnie, a white long-haired dog, on the lap of a smiling woman', loading: 'lazy' })));
  b.append(note('Calculations: ZodiacSigns V1.66 (12/03/92), reproduced exactly. Map: Natural Earth (public domain). ' +
    'Symbols: Noto Sans Symbols (SIL Open Font License).'));
}

// ------------------------------------------------------------ birth data form
function edit(hor) {
  const base = hor ? D.birth(hor) : { name: '', place: '', date: '', time: '', lonDir: 1, lon: '', latDir: 1, lat: '', elevation: '', tzDir: 1, tz: '1', dst: 1 };
  const previous = S.hor;
  S.editor = { dir: { tzDir: base.tzDir, dst: base.dst, lonDir: base.lonDir, latDir: base.latDir } };
  S.preview = hor || null;
  document.body.classList.add('editing');
  const ed = S.editor, dir = ed.dir;
  const main = $('#page'); main.innerHTML = ''; main.scrollTop = 0;
  $('#title').textContent = hor ? 'Birth data' : 'New chart';
  const a = $('#actions'); a.innerHTML = '';
  const field = (value, attrs) => h('input', Object.assign({ value: value || '', autocomplete: 'off', oninput: preview }, attrs));
  const name = field(base.name, { autocapitalize: 'words', enterkeyhint: 'next' });
  const place = field(base.place, { autocapitalize: 'words', enterkeyhint: 'next' });
  const num = { inputmode: 'decimal', enterkeyhint: 'next' };
  const date = field(base.date, Object.assign({ placeholder: 'MM/DD/YYYY' }, num));
  const time = field(base.time, Object.assign({ placeholder: 'HH.MM' }, num));
  const tz = field(base.tz, { inputmode: 'numeric', placeholder: 'hours', enterkeyhint: 'next' });
  const lon = field(base.lon, Object.assign({ placeholder: 'DDD.MM' }, num));
  const lat = field(base.lat, Object.assign({ placeholder: 'DD.MM' }, num));
  const elev = field(base.elevation, { inputmode: 'numeric', placeholder: 'metres (optional)', enterkeyhint: 'done' });
  const err = h('div', { class: 'err', 'aria-live': 'polite' });
  const segTz = seg(['East +', 'West −'], dir.tzDir - 1, (k) => { dir.tzDir = k + 1; preview(); });
  const segDst = seg(['None', '+1 hour', '+2 hours'], dir.dst - 1, (k) => { dir.dst = k + 1; preview(); });
  const segLon = seg(['East', 'West'], dir.lonDir - 1, (k) => { dir.lonDir = k + 1; preview(); });
  const segLat = seg(['North', 'South'], dir.latDir - 1, (k) => { dir.latDir = k + 1; preview(); });
  const fields = [name, place, date, time, tz, lon, lat, elev];
  const snapshot = () => fields.map(f => f.value).join('|') + `|${dir.tzDir}|${dir.dst}|${dir.lonDir}|${dir.latDir}`;
  const initial = snapshot();

  function result(showErr) {
    const r = D.check(name.value, place.value, date.value, time.value, lon.value, lat.value, elev.value, tz.value,
      dir.tzDir, dir.dst, dir.lonDir, dir.latDir);
    if (showErr) {
      err.textContent = r.error || '';
      if (r.error) [date, time, lon, lat, tz][[0, 1, 2, 3, 4].indexOf(r.field)] && [date, time, lon, lat, tz][r.field].focus();
    }
    return r.hor || null;
  }
  function preview() {
    const hr = result(false);
    if (hr) { err.textContent = ''; S.preview = hr; drawChart(); }
  }
  async function cancel() {
    if (snapshot() !== initial && !(await confirmBox('Discard the changes to this chart?', 'Discard'))) return;
    S.hor = previous; show(previous ? 'planets' : 'charts');
  }
  ed.cancel = cancel;
  function done() { const hr = result(true); if (hr) setChart(hr); }
  async function save() {
    const hr = result(true); if (!hr) return;
    const input = h('input', { value: D.fileName(name.value), autocapitalize: 'characters', style: 'text-transform:uppercase' });
    const box = h('div', {}, h('p', { style: 'margin:0 0 8px;color:var(--sub)' }, 'File name (up to 8 letters or digits), as in the 1992 program:'), input);
    setTimeout(() => input.select(), 50);
    const ok = await dialog('Save chart', box, [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }]);
    if (!ok) return;
    const file = ChartZip.dosName(input.value || name.value);
    if (S.charts[file] && S.charts[file] !== hr && !(await confirmBox(`${file} exists. Replace it?`, 'Replace'))) return;
    S.charts[file] = hr; saveCharts(); toast(`Saved as ${file}`);
  }
  function setNow() {
    const now = new Date(), p2 = (n) => String(n).padStart(2, '0');
    date.value = `${p2(now.getMonth() + 1)}/${p2(now.getDate())}/${now.getFullYear()}`;
    time.value = `${p2(now.getHours())}.${p2(now.getMinutes())}`;
    const z = localZone(now);
    tz.value = String(Math.abs(z.hours)); dir.tzDir = z.hours < 0 ? 2 : 1; dir.dst = z.dst + 1;
    segTz.select(dir.tzDir - 1); segDst.select(dir.dst - 1);
    preview();
  }
  function openMapHere() {
    openMap(C, date.value, time.value, (p) => {
      if (p.place) place.value = p.place;
      lon.value = p.lonText; lat.value = p.latText; tz.value = p.tzText;
      dir.lonDir = p.lonDir; dir.latDir = p.latDir; dir.tzDir = p.tzDir; dir.dst = p.dst;
      segTz.select(dir.tzDir - 1); segDst.select(dir.dst - 1); segLon.select(dir.lonDir - 1); segLat.select(dir.latDir - 1);
      preview();
      if (!p.zone.exact) err.textContent = `Half-hour zone: ${p.zone.minutesOff > 0 ? 'add' : 'subtract'} ${Math.abs(p.zone.minutesOff)} ` +
        'minutes to the birth time (.HOR stores whole hours).';
    });
  }
  /** The browser's own date or time picker for a field. */
  function picker(type, target) {
    const parse = type === 'date' ? Atlas.parseDate(target.value) : Atlas.parseTime(target.value);
    const p2 = (n) => String(n).padStart(2, '0');
    const v = parse ? (type === 'date' ? `${String(parse[2]).padStart(4, '0')}-${p2(parse[0])}-${p2(parse[1])}` : `${p2(parse[0])}:${p2(parse[1])}`) : '';
    const inp = h('input', { type, value: v, style: 'position:fixed;left:50%;top:50%;opacity:0;width:1px;height:1px', tabindex: -1 });
    document.body.append(inp);
    inp.addEventListener('change', () => {
      if (!inp.value) return;
      if (type === 'date') { const [y, m, d] = inp.value.split('-'); target.value = `${m}/${d}/${y}`; }
      else target.value = inp.value.replace(':', '.');
      preview();
    });
    inp.addEventListener('blur', () => setTimeout(() => inp.remove(), 500));
    try { inp.showPicker(); } catch (e) { inp.focus(); inp.click(); }
  }
  const pair = (input, extra) => h('div', { class: 'pair' }, input, extra);
  a.append(btn('Cancel', cancel, 'small'));
  const form = h('div', { class: 'form' },
    h('label', {}, 'Name'), name,
    h('label', {}, 'Birthplace'), pair(place, btn('Map', openMapHere)),
    h('label', {}, 'Date (month / day / year)'), pair(date, btn('Calendar', () => picker('date', date))),
    h('label', {}, 'Local time (hours . minutes)'), pair(time, btn('Clock', () => picker('time', time))),
    h('label', {}, 'Time zone (hours from Greenwich)'), pair(tz, segTz),
    h('label', {}, 'Daylight saving time'), segDst,
    h('label', {}, 'Longitude (degrees . minutes)'), pair(lon, segLon),
    h('label', {}, 'Latitude (degrees . minutes)'), pair(lat, segLat),
    h('label', {}, 'Elevation'), elev,
    err,
    h('div', { class: 'row2', style: 'padding:8px 0 0' }, btn('Now', setNow), btn('Save chart', save)),
    h('div', { class: 'full', style: 'margin:8px 0 0' }, btn('Show chart', done, 'primary')));
  fields.forEach((f, i) => f.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (i === fields.length - 1) done(); else fields[i + 1].focus();
  }));
  main.append(form);
  drawChart();
  if (!hor) name.focus({ preventScroll: true });
}

/** The browser's time zone now: standard hours and summer hours. */
function localZone(now) {
  const y = now.getFullYear();
  const std = Math.min(-new Date(y, 0, 1).getTimezoneOffset(), -new Date(y, 6, 1).getTimezoneOffset());
  const cur = -now.getTimezoneOffset();
  return { hours: Math.round(std / 60), dst: Math.min(2, Math.max(0, Math.round((cur - std) / 60))) };
}
function chartForNow() {
  const now = new Date(), p2 = (n) => String(n).padStart(2, '0'), z = localZone(now);
  const b = S.hor ? D.birth(S.hor) : null;
  const r = D.check('Now', b ? b.place : '', `${p2(now.getMonth() + 1)}/${p2(now.getDate())}/${now.getFullYear()}`,
    `${p2(now.getHours())}.${p2(now.getMinutes())}`, b ? b.lon : '000:00', b ? b.lat : '00:00', b ? b.elevation : '',
    String(Math.abs(z.hours)), z.hours < 0 ? 2 : 1, z.dst + 1, b ? b.lonDir : 1, b ? b.latDir : 1);
  if (r.hor) setChart(r.hor);
}

// ------------------------------------------------------------ PDF (print the A4 page)
function pdf() {
  if (!S.hor) return;
  const svg = D.reportSvg(S.hor, S.koch, APP_VERSION, document.createElement('canvas').getContext('2d'));
  const b = D.birth(S.hor);
  const font = new URL('fonts/NotoSansSymbols.ttf', location.href).href;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${(b.name.trim() || 'Birth Horoscope').replace(/[<&]/g, '')}</title>
<style>@font-face{font-family:NotoSym;src:url(${font})}@page{size:A4;margin:0}html,body{margin:0;background:#fff}
svg{display:block;width:210mm;height:297mm}</style></head><body>${svg}
<script>document.fonts.ready.then(function(){setTimeout(function(){window.print()},300)})<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { download(new Blob([html], { type: 'text/html' }), (D.fileName(b.name).replace('.HOR', '')) + '.html'); toast('Open the downloaded page and print it as PDF.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ------------------------------------------------------------ files: open .HOR / .zip, save .zip
$('#file').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  const found = [], skipped = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    if (/\.zip$/i.test(f.name) || f.type.includes('zip')) {
      const r = await ChartZip.read(buf); found.push(...r.charts); skipped.push(...r.skipped.map(s => `${f.name}: ${s}`));
    } else {
      const text = ChartZip.latin1(new Uint8Array(buf.slice(0, 16 * 1024 + 1)));
      if (buf.byteLength > 16 * 1024) skipped.push(`${f.name}: too large for a chart`);
      else if (!ChartZip.valid(text)) skipped.push(`${f.name}: not a readable chart`);
      else found.push([ChartZip.dosName(f.name), text]);
    }
  }
  let added = 0, same = 0, replaced = 0, kept = 0, skippedClash = 0, rule = null;
  for (const [name, text] of found) {
    const cur = S.charts[name];
    if (cur === undefined) { S.charts[name] = text; added++; continue; }
    if (cur === text) { same++; continue; }
    let choice = rule;
    if (!choice) {
      const all = h('input', { type: 'checkbox' });
      const body = h('div', {}, h('p', { style: 'margin:0 0 8px' }, `A different chart called ${name} is already saved.`),
        h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--sub)' }, all, 'Do the same for the rest'));
      choice = await dialog(name, body, [{ label: 'Skip', value: 'skip' }, { label: 'Keep both', value: 'both' }, { label: 'Replace', value: 'replace', primary: true }]) || 'skip';
      if (all.checked) rule = choice;
    }
    if (choice === 'replace') { S.charts[name] = text; replaced++; }
    else if (choice === 'both') { S.charts[ChartZip.freeName(name, new Set(Object.keys(S.charts)))] = text; kept++; }
    else skippedClash++;
  }
  saveCharts();
  const parts = [];
  if (added) parts.push(`${added} chart${added === 1 ? '' : 's'} added`);
  if (replaced) parts.push(`${replaced} replaced`);
  if (kept) parts.push(`${kept} kept as copies`);
  if (same) parts.push(`${same} already saved`);
  if (skippedClash) parts.push(`${skippedClash} skipped`);
  if (!parts.length) parts.push('No charts found');
  if (skipped.length) await dialog(parts.join(', '), 'Not opened:\n' + skipped.slice(0, 30).join('\n') + (skipped.length > 30 ? `\n… and ${skipped.length - 30} more` : ''),
    [{ label: 'OK', value: true, primary: true }]);
  else toast(parts.join(', '));
  show('charts');
});

async function exportZip(everything) {
  const all = Object.keys(S.charts).sort();
  if (!all.length) { toast('No charts to save yet'); return; }
  const pre = new Set(everything === true || !S.query.trim() ? all : shownEntries(entries()).map(e => e.file));
  const checks = h('div', { class: 'checks' }, ...all.map(f => h('label', {}, h('input', { type: 'checkbox', value: f, checked: pre.has(f) }), f)));
  const name = h('input', { value: 'Donnie-Horoscopes.zip' });
  const body = h('div', {}, checks, h('label', { style: 'display:block;color:var(--sub);font-size:13px;padding:10px 0 4px' }, 'File name'), name);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.zip', { type: 'application/zip' })] }));
  const buttons = [{ label: 'Cancel', value: null }];
  if (canShare) buttons.push({ label: 'Share', value: 'share' });
  buttons.push({ label: 'Download', value: 'save', primary: true });
  const how = await dialog('Save charts as .zip', body, buttons);
  if (!how) return;
  const chosen = [...checks.querySelectorAll('input:checked')].map(i => i.value);
  if (!chosen.length) { toast('No charts selected'); return; }
  const blob = ChartZip.write(chosen.map(f => [f, S.charts[f]]));
  let file = (name.value.trim() || 'Donnie-Horoscopes.zip').replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.zip$/i.test(file)) file += '.zip';
  if (how === 'share') {
    try { await navigator.share({ files: [new File([blob], file, { type: 'application/zip' })], title: file }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, file);
  toast(`${chosen.length} chart${chosen.length === 1 ? '' : 's'} saved as ${file}`);
}

// ------------------------------------------------------------ start
// back button / Escape: leave the form or the highlight first
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('.dlg, .overlay')) return;
  if (S.editor) S.editor.cancel(); else if (S.highlight >= 0) highlight(-1);
});
// keep the field being typed in visible above the keyboard
document.addEventListener('focusin', (e) => {
  if (e.target.matches('main input')) setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
});
window.addEventListener('resize', () => { chart.w = 0; drawChart(); if (S.page === 'aspects' && !S.editor) show('aspects', true); });
applyTheme();
buildNav();
data = S.hor ? D.data(S.hor, S.koch) : null;
show(data ? 'planets' : 'charts');
document.fonts.load('20px NotoSym').then(() => { if (!S.editor) show(S.page, true); else drawChart(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
