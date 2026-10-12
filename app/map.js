// Offline world map for the birthplace, as in the Android app (MapPicker.kt, Atlas.kt):
// country outlines and about 8,400 places with their IANA time zones; the zone and summer
// time for the birth date come from the browser's own time zone database.
'use strict';
const Atlas = (() => {
  let loading = null;
  const atlas = { cities: [], folded: [], land: null, bounds: [] };

  /** Lower case without accents: "Ružica Đurić" is found by "ruzica" or "duric". */
  function fold(s) {
    return s.toLowerCase().replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae')
      .normalize('NFD').replace(/\p{M}+/gu, '');
  }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch('atlas/cities.tsv').then(r => r.text()),
      fetch('atlas/countries.bin').then(r => r.arrayBuffer()),
    ]).then(([tsv, bin]) => {
      for (const l of tsv.split('\n')) {
        const f = l.split('\t');
        if (f.length < 6) continue;
        atlas.cities.push({ name: f[0], country: f[1], lat: +f[2], lon: +f[3], tz: f[4], pop: +f[5] || 0,
          label: f[1] ? `${f[0]}, ${f[1]}` : f[0] });
      }
      atlas.folded = atlas.cities.map(c => fold(c.name));
      const v = new DataView(bin); let p = 0;
      const n = v.getInt32(p); p += 4;
      const land = new Path2D();
      for (let k = 0; k < n; k++) {
        const m = v.getInt32(p); p += 4;
        let b = [1e9, 1e9, -1e9, -1e9];
        for (let i = 0; i < m; i++) {
          const lon = v.getInt16(p) / 100, lat = v.getInt16(p + 2) / 100; p += 4;
          if (i === 0) land.moveTo(lon, -lat); else land.lineTo(lon, -lat);
          b = [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)];
        }
        land.closePath();
        atlas.bounds.push(b);
      }
      atlas.land = land;
      return atlas;
    });
    return loading;
  }

  function search(q, max = 40) {
    const f = fold(q.trim());
    if (!f) return [];
    const starts = [], contains = [];
    for (let i = 0; i < atlas.folded.length; i++) {
      const n = atlas.folded[i];
      if (n.startsWith(f)) starts.push(atlas.cities[i]); else if (contains.length < max && n.includes(f)) contains.push(atlas.cities[i]);
      if (starts.length >= max) break;
    }
    return starts.concat(contains).slice(0, max);
  }

  function nearest(lat, lon) {
    let best = atlas.cities[0], bd = Infinity;
    const k = Math.cos(lat * Math.PI / 180);
    for (const c of atlas.cities) {
      let dl = Math.abs(c.lon - lon); if (dl > 180) dl = 360 - dl;
      const d = (c.lat - lat) ** 2 + (dl * k) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // ---- time zones through Intl (the browser's IANA database, with history)
  const fmts = {};
  /** Offset of [tz] from UT in minutes at the instant [ms]. */
  function offsetAt(tz, ms) {
    const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
    const y = +p.year; const local = Date.UTC(y, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    const fix = new Date(local); if (y < 100) fix.setUTCFullYear(y);
    return Math.round((fix.getTime() - Math.floor(ms / 1000) * 1000) / 60000);
  }
  function parseDate(s) {
    const g = s.match(/\d+/g) || [];
    if (g.length === 1 && g[0].length === 8) return [+g[0].slice(0, 2), +g[0].slice(2, 4), +g[0].slice(4)];
    if (g.length < 3) return null;
    return [+g[0], +g[1], g[2].length <= 2 ? +g[2] + 1900 : +g[2]];
  }
  function parseTime(s) {
    const g = s.match(/\d+/g) || [];
    if (!g.length) return null;
    if (g.length === 1 && g[0].length <= 2) return [+g[0], 0];
    if (g.length === 1) return [+g[0].slice(0, -2), +g[0].slice(-2)];
    return [+g[0], +g[1]];
  }
  const hm = (min) => (min < 0 ? '−' : '+') + Math.floor(Math.abs(min) / 60) + ':' + String(Math.abs(min) % 60).padStart(2, '0');

  /** Zone of [tz] at local date "MM/DD/YYYY" and time "HH.MM": whole standard hours, summer hours, and a text. */
  function zone(tz, date, time) {
    const now = new Date();
    const [m, d, y] = parseDate(date) || [now.getMonth() + 1, now.getDate(), now.getFullYear()];
    const [h, mi] = parseTime(time) || [12, 0];
    const wall = Date.UTC(y, m - 1, d, h, mi);
    let utc = wall - offsetAt(tz, wall) * 60000;
    utc = wall - offsetAt(tz, utc) * 60000;
    const total = offsetAt(tz, utc);
    const std = Math.min(offsetAt(tz, Date.UTC(y, 0, 1, 12)), offsetAt(tz, Date.UTC(y, 6, 1, 12)));
    const dstMin = Math.max(0, total - std);
    const hours = Math.round(std / 60);
    return {
      hours, dst: Math.min(2, Math.round(dstMin / 60)), exact: std % 60 === 0, minutesOff: std - hours * 60,
      text: `UT${hm(std)}` + (dstMin ? `, summer time ${hm(dstMin)}` : '') + `  (${tz})`,
    };
  }
  const dm = (v, pos, neg) => { const m = Math.round(Math.abs(v) * 60); return `${Math.floor(m / 60)}°${String(m % 60).padStart(2, '0')}' ${v < 0 ? neg : pos}`; };
  const dmHor = (v, w) => { const m = Math.round(Math.abs(v) * 60); return String(Math.floor(m / 60)).padStart(w, '0') + ':' + String(m % 60).padStart(2, '0'); };

  return { load, search, nearest, zone, dm, dmHor, atlas, parseDate, parseTime };
})();

/**
 * The map overlay. [colors] from Donnie.colors(); [done] gets
 * { place, lat, lon, lonText, latText, lonDir, latDir, tzText, tzDir, dst, zone }.
 */
function openMap(colors, date, time, done) {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `
    <div class="top"><input type="search" placeholder="Search a city" autocomplete="off" enterkeyhint="search">
      <button class="btn small" data-cancel>Cancel</button></div>
    <div class="mid"><canvas></canvas><div class="results" hidden></div></div>
    <div class="bottom"><div class="info">Loading the map…</div><button class="btn primary" disabled>Use this place</button></div>`;
  document.body.appendChild(el);
  const input = el.querySelector('input'), canvas = el.querySelector('canvas'), results = el.querySelector('.results');
  const info = el.querySelector('.info'), use = el.querySelector('.btn.primary');
  const g = canvas.getContext('2d');
  let W = 0, H = 0, cLat = 20, cLon = 10, scale = 0, sel = null, selCity = null;
  const minScale = () => W / 360;
  const close = () => { window.removeEventListener('resize', resize); el.remove(); };
  el.querySelector('[data-cancel]').onclick = close;

  function clamp() {
    scale = Math.min(Math.max(scale, minScale()), minScale() * 400);
    cLon = ((cLon + 540) % 360 + 360) % 360 - 180; cLat = Math.max(-85, Math.min(85, cLat));
  }
  const sx = (lon) => W / 2 + (lon - cLon) * scale;
  const wx = (lon) => { let d = lon - cLon; d -= 360 * Math.round(d / 360); return W / 2 + d * scale; };
  const sy = (lat) => H / 2 + (cLat - lat) * scale;

  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!scale || scale < minScale()) scale = minScale();
    draw();
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, a = Atlas.atlas;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = colors.bg; g.fillRect(0, 0, W, H);
    if (!a.land) return;
    g.strokeStyle = colors.line; g.globalAlpha = 0.25; g.lineWidth = 1;
    const step = scale > minScale() * 3 ? 15 : 30;
    g.beginPath();
    for (let lo = -540; lo <= 540; lo += step) { g.moveTo(sx(lo), sy(85)); g.lineTo(sx(lo), sy(-85)); }
    for (let la = -75; la <= 75; la += step) { g.moveTo(sx(-540), sy(la)); g.lineTo(sx(540), sy(la)); }
    g.stroke(); g.globalAlpha = 1;
    for (const shift of [-360, 0, 360]) {
      g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 + (shift - cLon) * scale), dpr * (H / 2 + cLat * scale));   // the outlines are stored with y = -latitude
      g.fillStyle = colors.landFill; g.fill(a.land);
      g.strokeStyle = colors.line; g.lineWidth = 0.8 / scale; g.stroke(a.land);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const zoom = scale / minScale();
    const limit = Math.min(a.cities.length, Math.floor(40 * zoom * zoom));
    const labels = zoom >= 3 ? limit / 6 : 0;
    let drawn = 0;
    g.font = '12px system-ui, sans-serif'; g.textBaseline = 'alphabetic';
    for (let i = 0; i < limit; i++) {
      const c = a.cities[i], x = wx(c.lon), y = sy(c.lat);
      if (x < 0 || y < 0 || x > W || y > H) continue;
      g.fillStyle = colors.sub; g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill();
      if (i < labels && drawn < 60) { g.fillStyle = colors.ink; g.fillText(c.name, x + 4, y - 3); drawn++; }
    }
    if (sel) {
      const x = wx(sel.lon), y = sy(sel.lat);
      g.fillStyle = colors.hard; g.globalAlpha = 0.35; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
      g.globalAlpha = 1; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill();
    }
  }

  function zoneCity() { return selCity || Atlas.nearest(sel.lat, sel.lon); }
  function update() {
    const zc = zoneCity(), z = Atlas.zone(zc.tz, date, time);
    let s = `${selCity ? selCity.label : 'Point near ' + zc.label}\n${Atlas.dm(sel.lat, 'N', 'S')}   ${Atlas.dm(sel.lon, 'E', 'W')}\n${z.text}`;
    if (!z.exact) s += `\nThe .HOR format stores whole hours: UT${z.hours < 0 ? '−' : '+'}${Math.abs(z.hours)} is set. ` +
      `${z.minutesOff > 0 ? 'Add' : 'Subtract'} ${Math.abs(z.minutesOff)} minutes to the birth time to compensate.`;
    info.textContent = s; use.disabled = false; draw();
  }
  function choose(c, zoomIn) {
    selCity = c; sel = { lat: c.lat, lon: c.lon };
    results.hidden = true; input.blur();
    if (zoomIn) { cLat = c.lat; cLon = c.lon; scale = Math.max(scale, minScale() * 12); clamp(); }
    update();
  }
  use.onclick = () => {
    if (!sel) return;
    const z = Atlas.zone(zoneCity().tz, date, time);
    close();
    done({ place: selCity ? selCity.name : null, lat: sel.lat, lon: sel.lon,
      lonText: Atlas.dmHor(sel.lon, 3), latText: Atlas.dmHor(sel.lat, 2), lonDir: sel.lon < 0 ? 2 : 1, latDir: sel.lat < 0 ? 2 : 1,
      tzText: String(Math.abs(z.hours)), tzDir: z.hours < 0 ? 2 : 1, dst: z.dst + 1, zone: z });
  };

  input.oninput = () => {
    const q = input.value; results.hidden = !q.trim(); results.innerHTML = '';
    const found = Atlas.search(q);
    if (q.trim() && !found.length) results.innerHTML = '<p class="note">No place found. Try another spelling, or tap the map.</p>';
    for (const c of found) {
      const r = document.createElement('div'); r.className = 'list-row';
      const z = Atlas.zone(c.tz, date, time).text.split('  (')[0];
      r.innerHTML = `<div class="grow"><div class="t" style="font-weight:400"></div><div class="s"></div></div>`;
      r.querySelector('.t').textContent = c.label;
      r.querySelector('.s').textContent = `${Atlas.dm(c.lat, 'N', 'S')}  ${Atlas.dm(c.lon, 'E', 'W')}  ·  ${z}`;
      r.onclick = () => choose(c, true);
      results.appendChild(r);
    }
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') { const c = Atlas.search(input.value, 1)[0]; if (c) choose(c, true); } };

  // gestures: drag to move, pinch or wheel to zoom, double-tap to zoom in, tap to pick
  const pts = new Map(); let moved = false, lastTap = 0, pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = false;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    p.x = e.offsetX; p.y = e.offsetY;
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1 && moved) { cLon -= dx / scale; cLat += dy / scale; clamp(); draw(); }
  });
  const up = (e) => {
    const p = pts.get(e.pointerId); pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!p || moved || pts.size) return;
    const now = Date.now();
    if (now - lastTap < 300) { lastTap = 0; zoomAt(scale * 2.5, p.x, p.y, true); return; }
    lastTap = now;
    const x = p.x, y = p.y;
    setTimeout(() => { if (lastTap === now) tap(x, y); }, 300);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(scale * Math.exp(-e.deltaY * 0.002), e.offsetX, e.offsetY); }, { passive: false });
  function zoomAt(s, fx, fy, center) {
    const lon = cLon + (fx - W / 2) / scale, lat = cLat - (fy - H / 2) / scale;
    scale = s; clamp();
    if (center) { cLon = lon; cLat = lat; } else { cLon = lon - (fx - W / 2) / scale; cLat = lat + (fy - H / 2) / scale; }
    clamp(); draw();
  }
  function tap(x, y) {
    input.blur();
    const lat = cLat - (y - H / 2) / scale, lon = ((cLon + (x - W / 2) / scale + 540) % 360 + 360) % 360 - 180;
    if (lat < -90 || lat > 90 || !Atlas.atlas.land) return;
    const zoom = scale / minScale(), limit = Math.min(Atlas.atlas.cities.length, Math.floor(40 * zoom * zoom));
    let best = null, bd = 24;
    for (let i = 0; i < limit; i++) {
      const c = Atlas.atlas.cities[i], d = Math.hypot(wx(c.lon) - x, sy(c.lat) - y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) choose(best, false); else { selCity = null; sel = { lat, lon }; update(); }
  }

  window.addEventListener('resize', resize);
  resize();
  Atlas.load().then(() => {
    info.textContent = 'Search a city, or tap the map. Pinch or scroll to zoom, drag to move.';
    draw(); input.focus({ preventScroll: true });
  }).catch(() => { info.textContent = 'The map could not be loaded. Type the coordinates in the form instead.'; });
}
