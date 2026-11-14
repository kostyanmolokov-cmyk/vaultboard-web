// Firebase без SDK: вход через Google (Auth REST) и Firestore REST.
// Данные в Firestore лежат только в зашифрованном виде.
import { FIREBASE } from './config.js?v=1794651620';

const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const DB = `projects/${FIREBASE.projectId}/databases/(default)`;
const FS = `https://firestore.googleapis.com/v1/${DB}/documents`;
const L = new Proxy({}, { get: (_, k) => chrome.storage.local[k].bind(chrome.storage.local) });

const err = (code, message) => Object.assign(new Error(message || code), { code });

// ───────── Вход через Google ─────────
function googleAccessToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (t) => {
      const e = chrome.runtime.lastError;
      if (e || !t) return reject(err('GOOGLE_AUTH', e?.message || 'Не удалось получить токен Google'));
      resolve(typeof t === 'string' ? t : t.token);
    });
  });
}

async function saveAuth(j) {
  const prev = (await L.get('auth')).auth || {};
  const auth = {
    uid: j.localId || j.user_id || prev.uid,
    email: j.email || prev.email || '',
    refreshToken: j.refreshToken || j.refresh_token || prev.refreshToken,
    idToken: j.idToken || j.id_token,
    exp: Date.now() + (Number(j.expiresIn || j.expires_in) || 3600) * 1000,
  };
  await L.set({ auth });
  return auth;
}

const isWeb = () => !globalThis.chrome?.runtime?.id;
const FB_V = '10.14.1';
const loadScript = (src) => new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.onload = res;
  s.onerror = () => rej(err('GOOGLE_AUTH', 'Не удалось загрузить вход Google (проверьте интернет)'));
  document.head.append(s);
});
// Веб-версия: скрипты Firebase подгружаем заранее, чтобы окно входа открывалось сразу по клику
export function warmup() {
  if (!isWeb() || globalThis.firebase?.auth || warmup.p) return warmup.p;
  warmup.p = loadScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-app-compat.js`)
    .then(() => loadScript(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-auth-compat.js`)).catch(() => { warmup.p = null; });
  return warmup.p;
}
async function webGoogleUser() {
  await warmup();
  const fbs = globalThis.firebase;
  if (!fbs?.auth) throw err('GOOGLE_AUTH', 'Вход Google не загрузился, обновите страницу');
  if (!fbs.apps.length) fbs.initializeApp({ apiKey: FIREBASE.apiKey, authDomain: FIREBASE.authDomain, projectId: FIREBASE.projectId });
  const auth = fbs.auth();
  await auth.setPersistence(fbs.auth.Auth.Persistence.NONE);
  try { return (await auth.signInWithPopup(new fbs.auth.GoogleAuthProvider())).user; }
  catch (e) { throw err('GOOGLE_AUTH', e.code === 'auth/unauthorized-domain' ? 'Этот адрес сайта не разрешён в Firebase' : (e.code === 'auth/popup-blocked' ? 'Браузер заблокировал окно входа Google. Разрешите всплывающие окна.' : e.message)); }
}

export async function signInWithGoogle(interactive = true) {
  if (isWeb()) {
    if (!interactive) throw err('GOOGLE_AUTH', 'Нужен повторный вход через Google');
    const u = await webGoogleUser();
    return saveAuth({ localId: u.uid, email: u.email, refreshToken: u.refreshToken, idToken: await u.getIdToken(), expiresIn: 3600 });
  }
  const gt = await googleAccessToken(interactive);
  const r = await fetch(`${AUTH_URL}/accounts:signInWithIdp?key=${FIREBASE.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `access_token=${encodeURIComponent(gt)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
      returnIdpCredential: true,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    // токен мог протухнуть в кэше Chrome
    if (r.status === 400 || r.status === 401) await new Promise((res) => chrome.identity.removeCachedAuthToken({ token: gt }, res));
    throw err('FIREBASE_AUTH', j?.error?.message || `HTTP ${r.status}`);
  }
  return saveAuth(j);
}

export async function getAuth() { return (await L.get('auth')).auth || null; }

async function refresh(auth) {
  const r = await fetch(`${TOKEN_URL}?key=${FIREBASE.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
  });
  const j = await r.json();
  if (!r.ok) throw err('REFRESH_FAILED', j?.error?.message || `HTTP ${r.status}`);
  return saveAuth(j);
}

export async function getIdToken(force = false) {
  let auth = await getAuth();
  if (!auth) throw err('NOT_SIGNED_IN', 'Не выполнен вход через Google');
  if (!force && auth.idToken && auth.exp > Date.now() + 60000) return auth;
  try { auth = await refresh(auth); }
  catch (e) { auth = await signInWithGoogle(false); } // тихий повторный вход
  return auth;
}

export async function signOutGoogle() {
  if (isWeb()) { await L.remove('auth'); return; }
  try {
    const t = await googleAccessToken(false);
    await new Promise((res) => chrome.identity.removeCachedAuthToken({ token: t }, res));
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {});
  } catch { /* нет токена — ок */ }
  await L.remove('auth');
}

// ───────── Firestore REST ─────────
async function api(url, opts = {}, retry = true) {
  const auth = await getIdToken();
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + auth.idToken, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401 && retry) { await getIdToken(true); return api(url, opts, false); }
  if (r.status === 404 && opts.allow404) return null;
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* не json */ }
  if (!r.ok) throw err(`HTTP_${r.status}`, j?.error?.message || j?.[0]?.error?.message || `Firestore HTTP ${r.status}`);
  return j;
}

const str = (v) => ({ stringValue: String(v) });
const int = (v) => ({ integerValue: String(Math.trunc(v)) });
const val = (f) => f && (f.stringValue ?? f.integerValue ?? f.timestampValue ?? null);

export async function getMeta(uid) {
  const d = await api(`${FS}/users/${uid}/meta/vault`, { allow404: true });
  if (!d) return null;
  const f = d.fields || {};
  return { salt: val(f.salt), iter: Number(val(f.iter)), check: val(f.check), rk: val(f.rk) || '', gk: val(f.gk) || '' };
}

const metaFields = ({ salt, iter, check, rk = '', gk = '' }) => ({ salt: str(salt), iter: int(iter), check: str(check), rk: str(rk), gk: str(gk) });

export async function createMeta(uid, m) {
  return api(`${FS}/users/${uid}/meta?documentId=vault`, {
    method: 'POST',
    body: JSON.stringify({ fields: metaFields(m) }),
  });
}

export async function putMeta(uid, m) {
  await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes: [{ update: { name: `${DB}/documents/users/${uid}/meta/vault`, fields: metaFields(m) } }] }),
  });
}

// Забрать изменения с серверного времени `since` (RFC3339) или всё, если null
export async function pullRecords(uid, since) {
  const out = [];
  let cursor = since;
  for (let guard = 0; guard < 200; guard++) {
    const structuredQuery = {
      from: [{ collectionId: 'records' }],
      orderBy: [{ field: { fieldPath: 's' }, direction: 'ASCENDING' }],
      limit: 300,
    };
    if (cursor) structuredQuery.where = { fieldFilter: { field: { fieldPath: 's' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: cursor } } };
    const rows = await api(`${FS}/users/${uid}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
    const docs = (rows || []).filter((x) => x.document).map((x) => x.document);
    for (const d of docs) {
      const f = d.fields || {};
      out.push({ id: d.name.split('/').pop(), c: val(f.c), u: Number(val(f.u)), s: val(f.s) });
    }
    if (docs.length < 300) break;
    const last = val(docs[docs.length - 1].fields.s);
    if (last === cursor) break;
    cursor = last;
  }
  return out;
}

// writes: [{id, c, u}] — серверное время `s` ставит сам Firestore
export async function pushRecords(uid, writes) {
  for (let i = 0; i < writes.length; i += 200) {
    const chunk = writes.slice(i, i + 200).map((w) => ({
      update: { name: `${DB}/documents/users/${uid}/records/${w.id}`, fields: { c: str(w.c), u: int(w.u) } },
      updateTransforms: [{ fieldPath: 's', setToServerValue: 'REQUEST_TIME' }],
    }));
    await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: chunk }) });
  }
}
