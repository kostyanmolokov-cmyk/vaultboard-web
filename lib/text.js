// Чистка названий: HTML-сущности (&nbsp; и т.п.) и технические разделители закладок.
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', ensp: ' ', emsp: ' ', thinsp: ' ' };
export function decodeEntities(s) {
  let t = String(s ?? '');
  for (let k = 0; k < 2 && t.includes('&'); k++) {
    t = t.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (m, d, x, n) => {
      if (n) return NAMED[n.toLowerCase()] ?? m;
      const c = d ? +d : parseInt(x, 16);
      try { return String.fromCodePoint(c); } catch { return m; }
    });
  }
  return t;
}
export function cleanTitle(s) {
  return decodeEntities(s)
    .replace(/[   ]/g, ' ')
    .replace(/\s*(?:\/#\/|\|#\|)\s*/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
