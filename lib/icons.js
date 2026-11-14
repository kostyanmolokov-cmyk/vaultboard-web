// Поиск значка сайта. Пробуем несколько источников по очереди и берём лучший по размеру;
// адрес найденного значка сохраняется в записи (поле icon) и синхронизируется между устройствами.
const TIMEOUT_MS = 6000;

function probe(url) { // ширина картинки или 0, если не загрузилась
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    const t = setTimeout(() => { img.src = ''; resolve(0); }, TIMEOUT_MS);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth || 0); };
    img.onerror = () => { clearTimeout(t); resolve(0); };
    img.src = url;
  });
}

/** Источники в порядке предпочтения. min: минимальная ширина, при которой значок считается настоящим. */
export function iconSources(host) {
  const bare = host.replace(/^www\./, '');
  return [
    { u: `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent('https://' + host)}&size=128`, min: 32 }, // у Google 16 px = заглушка
    { u: `https://${host}/apple-touch-icon.png`, min: 57 },
    { u: `https://${host}/favicon.ico`, min: 32 },
    { u: `https://icons.duckduckgo.com/ip3/${bare}.ico`, min: 32, not: 48 }, // 48 px у DuckDuckGo = заглушка
    // запасные: маленькие, но настоящие значки
    { u: `https://${host}/favicon.ico`, min: 16 },
    { u: `https://icons.duckduckgo.com/ip3/${bare}.ico`, min: 16, not: 48 },
  ];
}

export function pickIcon(sources, widths) {
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k], w = widths[k];
    if (w >= s.min && w !== s.not) return { url: s.u, w };
  }
  return null;
}

const cache = new Map(); // host → Promise<{url,w}|null>
let running = 0; const waiting = [];
const MAX_PARALLEL = 3;
function slot() { return new Promise((r) => { if (running < MAX_PARALLEL) { running++; r(); } else waiting.push(r); }); }
function release() { const n = waiting.shift(); if (n) n(); else running--; }

export function findIcon(host) {
  if (!host) return Promise.resolve(null);
  if (cache.has(host)) return cache.get(host);
  const p = (async () => {
    await slot();
    try {
      const uniq = iconSources(host), seen = new Map();
      const widths = await Promise.all(uniq.map((s) => { // одинаковые адреса проверяем один раз
        if (!seen.has(s.u)) seen.set(s.u, probe(s.u));
        return seen.get(s.u);
      }));
      return pickIcon(uniq, widths);
    } finally { release(); }
  })();
  cache.set(host, p);
  return p;
}
export function resetIconCache() { cache.clear(); }
