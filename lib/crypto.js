// Шифрование хранилища: PBKDF2-SHA256 -> AES-256-GCM. Работает и в браузере, и в Node (webcrypto).
const enc = new TextEncoder();
const dec = new TextDecoder();

export const DEFAULT_ITER = 600000;

export const b64 = {
  to(bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  },
  from(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(password, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64.from(saltB64), iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportKey(key) {
  return b64.to(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export async function importKey(rawB64) {
  return crypto.subtle.importKey('raw', b64.from(rawB64), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function encryptJson(key, obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64.to(iv), ct: b64.to(new Uint8Array(ct)) };
}

export async function decryptJson(key, { iv, ct }) {
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.from(iv) }, key, b64.from(ct));
  return JSON.parse(dec.decode(buf));
}

// Упаковка в одну строку "iv.ct" для облачных документов
export async function seal(key, obj) {
  const { iv, ct } = await encryptJson(key, obj);
  return iv + '.' + ct;
}
export async function open(key, packed) {
  const [iv, ct] = packed.split('.');
  return decryptJson(key, { iv, ct });
}

// ───────── ключ восстановления ─────────
// 20 случайных байт = 32 символа base32, показываем группами по 4. Он оборачивает ключ хранилища.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newRecoveryKey() {
  let bits = 0, v = 0, out = '';
  for (const x of randomBytes(20)) {
    v = (v << 8) | x; bits += 8;
    while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; }
    v &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g).join('-');
}
export const normRecoveryKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
async function recoveryAesKey(rk) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normRecoveryKey(rk)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('vaultboard-recovery-v1'), iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function wrapKey(key, rk) { return seal(await recoveryAesKey(rk), { k: await exportKey(key) }); }
export async function unwrapKey(packed, rk) { const o = await open(await recoveryAesKey(rk), packed); return importKey(o.k); }
