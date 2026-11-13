// Работа с адресами: нормализация, домены, сравнение сайтов.
const SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

export function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return 'https://' + s;
}

export function parseUrl(input) {
  try { return new URL(normalizeUrl(input)); } catch { return null; }
}

export function hostOf(input) {
  const u = parseUrl(input);
  return u ? u.hostname.toLowerCase() : '';
}

// Базовый домен (example.com, example.co.uk)
export function baseDomain(host) {
  host = String(host || '').toLowerCase();
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host; // IP
  const p = host.split('.');
  if (p.length <= 2) return host;
  const last = p[p.length - 1];
  const second = p[p.length - 2];
  if (last.length === 2 && SLD.has(second)) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

export function sameSite(hostA, hostB) {
  if (!hostA || !hostB) return false;
  return baseDomain(hostA) === baseDomain(hostB);
}

// Шаблон разрешения для optional_host_permissions: любой поддомен базового домена
export function permissionPattern(input) {
  const u = parseUrl(input);
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const base = baseDomain(u.hostname.toLowerCase());
  if (/^[\d.]+$/.test(base) || base.includes(':') || base === 'localhost') return `${u.protocol}//${u.hostname}/*`;
  return `*://*.${base}/*`;
}
