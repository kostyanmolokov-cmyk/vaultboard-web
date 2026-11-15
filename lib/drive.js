// Облако Vaultboard на Google Диске пользователя.
// Файлы лежат в скрытой папке приложения (appDataFolder), доступ к остальному Диску не запрашивается.
// Всё шифруется в браузере до отправки: содержимое кусками AES-256-GCM, имя/папка/тип — тоже (в поле description).
import { FIREBASE } from './config.js?v=1794729007';
import { b64, randomBytes } from './crypto.js?v=1794729007';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK = 4 * 1024 * 1024;            // кусок открытого текста
const SEND = 8 * 1024 * 1024;             // размер одной порции загрузки (кратно 256 КБ)
const MAGIC = [0x56, 0x42, 0x46, 0x31];   // "VBF1"
const HEAD = 8;                            // MAGIC + размер куска (uint32)
export const MAX_FILE = 1024 * 1024 * 1024; // 1 ГБ на файл

const isWeb = () => !globalThis.chrome?.runtime?.id;
const err = (code, message) => Object.assign(new Error(message || code), { code });

// ───────── токен Google с доступом к папке приложения ─────────
let tok = null; // { t, exp }
const loadTok = () => { if (tok?.exp > Date.now() + 60000) return; try { const s = JSON.parse(sessionStorage.getItem('vb.drive') || 'null'); tok = s?.exp > Date.now() + 60000 ? s : null; } catch { tok = null; } };
const keepTok = (t, sec = 3500) => { tok = { t, exp: Date.now() + sec * 1000 }; try { sessionStorage.setItem('vb.drive', JSON.stringify(tok)); } catch { /* ок */ } return t; };

export function hasToken() { loadTok(); return !!(tok && tok.exp > Date.now() + 60000); }

/** interactive=true только из обработчика клика: откроется окно Google. */
export async function driveToken(interactive = false) {
  if (hasToken()) return tok.t;
  if (!isWeb()) {
    const t = await new Promise((res, rej) => chrome.identity.getAuthToken({ interactive, scopes: ['openid', 'email', 'profile', DRIVE_SCOPE] }, (r) => {
      const e = chrome.runtime.lastError;
      if (e || !r) return rej(err('DRIVE_AUTH', e?.message || 'Нет доступа к Google Диску'));
      res(typeof r === 'string' ? r : r.token);
    }));
    return keepTok(t, 3000);
  }
  if (!interactive) throw err('DRIVE_AUTH', 'Нужно подключить Google Диск');
  const fbs = globalThis.firebase;
  if (!fbs?.auth) throw err('DRIVE_AUTH', 'Вход Google ещё загружается, нажмите ещё раз');
  if (!fbs.apps.length) fbs.initializeApp({ apiKey: FIREBASE.apiKey, authDomain: FIREBASE.authDomain, projectId: FIREBASE.projectId });
  const auth = fbs.auth();
  const p = new fbs.auth.GoogleAuthProvider(); p.addScope(DRIVE_SCOPE);
  let r;
  try { r = await auth.signInWithPopup(p); }
  catch (e) { throw err('DRIVE_AUTH', e.code === 'auth/popup-blocked' ? 'Браузер заблокировал окно Google. Разрешите всплывающие окна.' : e.code === 'auth/popup-closed-by-user' ? 'Окно Google закрыто' : e.message); }
  const t = r.credential?.accessToken;
  if (!t) throw err('DRIVE_AUTH', 'Google не выдал доступ к Диску');
  return keepTok(t);
}
export function forgetToken() {
  const t = tok?.t; tok = null; try { sessionStorage.removeItem('vb.drive'); } catch { /* ок */ }
  if (t && !isWeb()) chrome.identity.removeCachedAuthToken({ token: t }, () => {});
}

async function call(url, opts = {}, retry = true) {
  const t = await driveToken(false);
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (r.status === 401 && retry) { forgetToken(); if (isWeb()) throw err('DRIVE_AUTH', 'Доступ к Диску истёк, подключите снова'); return call(url, opts, false); }
  if (!r.ok && !opts.raw) {
    let m = ''; try { const j = await r.json(); m = j?.error?.message || ''; } catch { /* нет тела */ }
    if (r.status === 403 && /has not been used|is disabled/i.test(m)) throw err('DRIVE_OFF', 'В проекте Google не включён Google Drive API');
    if (r.status === 403 && /storageQuota|quota/i.test(m)) throw err('DRIVE_FULL', 'На Google Диске закончилось место');
    throw err('DRIVE_HTTP', m || `Google Диск ответил ошибкой ${r.status}`);
  }
  return r;
}

// ───────── шифрование ─────────
const u32 = (n) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n); return a; };
const aad = (i, last) => { const a = new Uint8Array(5); new DataView(a.buffer).setUint32(0, i); a[4] = last ? 1 : 0; return a; };
export const encSize = (n) => HEAD + n + Math.max(1, Math.ceil(n / CHUNK)) * 28;

async function sealMeta(key, meta) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(meta))));
  return 'vb1:' + b64.to(iv) + ':' + b64.to(ct);
}
async function openMeta(key, s) {
  const [v, iv, ct] = String(s || '').split(':');
  if (v !== 'vb1') return null;
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.from(iv) }, key, b64.from(ct)))); }
  catch { return null; }
}

// ───────── список, переименование, удаление ─────────
export async function listFiles(key) {
  const out = []; let page = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,description,size,createdTime,modifiedTime)', q: "name contains 'vbf-'" });
    if (page) q.set('pageToken', page);
    const j = await (await call(`${API}/files?${q}`)).json();
    for (const f of j.files || []) {
      const m = await openMeta(key, f.description);
      out.push({ id: f.id, bytes: Number(f.size) || 0, created: f.createdTime, ...(m || { name: '(не удалось расшифровать)', broken: true }) });
    }
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
export async function updateMeta(key, f, patch) {
  const meta = { name: f.name, folder: f.folder || '', type: f.type || '', size: f.size, added: f.added, ...patch };
  await call(`${API}/files/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: await sealMeta(key, meta) }) });
  return { ...f, ...meta };
}
export async function deleteFile(id) { await call(`${API}/files/${id}`, { method: 'DELETE', raw: true }); }

// ───────── загрузка: шифруем кусками и отправляем порциями, память не растёт с размером файла ─────────
export async function uploadFile(key, file, folder, onProgress = () => {}, signal) {
  if (file.size > MAX_FILE) throw err('TOO_BIG', 'Файл больше 1 ГБ');
  const total = encSize(file.size);
  const meta = { name: file.name, folder: folder || '', type: file.type || '', size: file.size, added: Date.now() };
  const init = await call(`${UP}/files?uploadType=resumable&fields=id`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(total) },
    body: JSON.stringify({ name: 'vbf-' + b64.to(randomBytes(9)).replace(/[+/=]/g, 'x') + '.bin', parents: ['appDataFolder'], mimeType: 'application/octet-stream', description: await sealMeta(key, meta) }),
  });
  const session = init.headers.get('Location');
  if (!session) throw err('DRIVE_HTTP', 'Google Диск не начал загрузку');
  let buf = new Uint8Array(0), sent = 0, result = null;
  const push = (part) => { const n = new Uint8Array(buf.length + part.length); n.set(buf); n.set(part, buf.length); buf = n; };
  const flush = async (final) => {
    while (buf.length >= SEND || (final && buf.length)) {
      const len = final && buf.length < SEND ? buf.length : SEND;
      const body = buf.slice(0, len);
      for (let attempt = 0; ; attempt++) {
        const t = await driveToken(false);
        let r;
        try { r = await fetch(session, { method: 'PUT', signal, headers: { Authorization: 'Bearer ' + t, 'Content-Range': `bytes ${sent}-${sent + len - 1}/${total}` }, body }); }
        catch (e) { if (signal?.aborted) throw err('ABORT', 'Загрузка отменена'); if (attempt < 3) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; } throw err('NET', 'Пропал интернет во время загрузки'); }
        if (r.status === 308 || r.ok) { if (r.ok) result = await r.json(); break; }
        if (r.status >= 500 && attempt < 3) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
        throw err('DRIVE_HTTP', `Загрузка прервана (ошибка ${r.status})`);
      }
      sent += len; buf = buf.slice(len);
      onProgress(sent / total);
    }
  };
  const head = new Uint8Array(HEAD); head.set(MAGIC); head.set(u32(CHUNK), 4); push(head);
  const n = Math.max(1, Math.ceil(file.size / CHUNK));
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw err('ABORT', 'Загрузка отменена');
    const plain = new Uint8Array(await file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK)).arrayBuffer());
    const iv = randomBytes(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(i, i === n - 1) }, key, plain));
    push(iv); push(ct);
    await flush(false);
  }
  await flush(true);
  if (!result?.id) throw err('DRIVE_HTTP', 'Google Диск не подтвердил загрузку');
  return { id: result.id, bytes: total, ...meta };
}

// ───────── скачивание: читаем поток и расшифровываем кусок за куском ─────────
export async function downloadFile(key, f, onProgress = () => {}, signal) {
  const r = await call(`${API}/files/${f.id}?alt=media`, { signal });
  const total = Number(r.headers.get('Content-Length')) || f.bytes || 0;
  const reader = r.body.getReader();
  let buf = new Uint8Array(0), got = 0, chunk = 0, i = 0, done = false;
  const parts = [];
  const take = (n) => { const a = buf.slice(0, n); buf = buf.slice(n); return a; };
  while (!done || buf.length) {
    if (!done) {
      const { value, done: d } = await reader.read();
      if (d) done = true;
      else { const n = new Uint8Array(buf.length + value.length); n.set(buf); n.set(value, buf.length); buf = n; got += value.length; onProgress(total ? got / total : 0); }
    }
    if (!chunk) {
      if (buf.length < HEAD) { if (done) throw err('BROKEN', 'Файл повреждён'); continue; }
      const h = take(HEAD);
      if (!MAGIC.every((b, k) => h[k] === b)) throw err('BROKEN', 'Это не файл облака Vaultboard');
      chunk = new DataView(h.buffer).getUint32(4);
    }
    const full = 12 + chunk + 16;
    // кусок расшифровываем, только когда ясно, последний он или нет (за ним есть ещё данные либо поток закончился)
    while (buf.length > full || (done && buf.length > 0)) {
      const last = done && buf.length <= full;
      const len = last ? buf.length : full;
      if (len < 28) throw err('BROKEN', 'Файл повреждён');
      const part = take(len);
      try { parts.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: part.slice(0, 12), additionalData: aad(i, last) }, key, part.slice(12)))); }
      catch { throw err('BROKEN', 'Не удалось расшифровать файл (другой ключ или файл повреждён)'); }
      i++;
      if (last) break;
    }
  }
  return new Blob(parts, { type: f.type || 'application/octet-stream' });
}
