// Chart packs: .zip files of .HOR records, read and written in the browser.
// Reading follows the app's ChartZip: only *.HOR entries, taken by file name alone, with the
// same limits against oversized entries and zip bombs.
'use strict';
const ChartZip = (() => {
  const MAX_ENTRY = 16 * 1024, MAX_ENTRIES = 5000, MAX_TOTAL = 8 * 1024 * 1024;
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  const bytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

  /** 8.3 DOS name: up to 8 letters/digits/_/- in upper case, plus ".HOR". */
  function dosName(raw) {
    let base = raw.split('/').pop().split('\\').pop().toUpperCase().replace(/\.HOR$/, '');
    base = base.replace(/[ČĆ]/g, 'C').replace(/Š/g, 'S').replace(/Ž/g, 'Z').replace(/Đ/g, 'D').replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
    return (base || 'CHART') + '.HOR';
  }
  /** A name not in [taken]: NAME.HOR, NAME1.HOR ... (still 8.3). */
  function freeName(name, taken) {
    if (!taken.has(name)) return name;
    const base = name.replace(/\.HOR$/, '');
    for (let n = 1; n < 10000; n++) { const s = String(n); const c = base.slice(0, 8 - s.length) + s + '.HOR'; if (!taken.has(c)) return c; }
    return name;
  }
  /** A usable birth record: a parseable date and time (as ChartZip.valid). */
  function valid(text) {
    if (!text || text.indexOf('\0') >= 0) return false;
    const l = text.split(/\r?\n/);
    const d = (l[2] || '').match(/\d+/g) || [], t = (l[3] || '').match(/\d+/g) || [];
    if (d.length < 3 || +d[0] < 1 || +d[0] > 12 || +d[1] < 1 || +d[1] > 31 || !t.length || +t[0] > 23) return false;
    return D.birth(text) != null;
  }

  async function inflate(data) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([data]).stream().pipeThrough(ds)).body.getReader();
    const parts = []; let n = 0;
    for (;;) {
      const { done, value } = await out.read();
      if (done) break;
      parts.push(value); n += value.length;
      if (n > MAX_ENTRY) { out.cancel(); return null; }
    }
    const u = new Uint8Array(n); let o = 0; for (const p of parts) { u.set(p, o); o += p.length; }
    return u;
  }

  /** Reads a zip: { charts: [[name, horText]], skipped: [notes] }. */
  async function read(buf) {
    const charts = [], skipped = [];
    const u = new Uint8Array(buf), v = new DataView(buf);
    try {
      let e = -1;
      for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
      if (e < 0) throw new Error('no zip directory');
      const count = v.getUint16(e + 10, true);
      let p = v.getUint32(e + 16, true), total = 0;
      for (let k = 0; k < count; k++) {
        if (k >= MAX_ENTRIES) { skipped.push(`more than ${MAX_ENTRIES} entries: rest ignored`); break; }
        if (v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged directory');
        const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
        const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
        const local = v.getUint32(p + 42, true);
        const path = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nlen));
        p += 46 + nlen + xlen + clen;
        if (path.endsWith('/') || !path.toUpperCase().endsWith('.HOR')) continue;
        const shown = path.split('/').pop();
        if (path.includes('..') || path.startsWith('/') || path.includes('\\')) skipped.push(`${shown}: unsafe path, taken by its name only`);
        if (usize > MAX_ENTRY) { skipped.push(`${shown}: too large for a chart`); continue; }
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const raw = u.subarray(start, start + csize);
        const data = method === 0 ? raw : method === 8 ? await inflate(raw) : undefined;
        if (data === undefined) { skipped.push(`${shown}: unsupported compression`); continue; }
        if (data === null || data.length > MAX_ENTRY) { skipped.push(`${shown}: too large for a chart`); continue; }
        total += data.length;
        if (total > MAX_TOTAL) { skipped.push('archive too large: rest ignored'); break; }
        const text = latin1(data);
        if (!valid(text)) { skipped.push(`${shown}: not a readable chart`); continue; }
        charts.push([dosName(shown), text]);
      }
    } catch (err) {
      skipped.push(`damaged archive (${err.message}): stopped there`);
    }
    return { charts, skipped };
  }

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u) => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  /** A zip (stored, no compression: charts are tiny) of [[name, horText]] as a Blob. */
  function write(charts) {
    const parts = [], dir = []; let off = 0;
    for (const [name, text] of charts) {
      const nb = new TextEncoder().encode(name), data = bytes(text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 10, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
      parts.push(h, nb, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 10, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      dir.push(c, nb);
      off += 30 + nb.length + data.length;
    }
    const size = dir.reduce((s, x) => s + x.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, charts.length, true); e.setUint16(10, charts.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...dir, e], { type: 'application/zip' });
  }

  return { read, write, valid, dosName, freeName, latin1, bytes };
})();
