// Синхронизация: каждая запись (пространство / группа / элемент) — отдельный зашифрованный документ в Firestore.
// Побеждает запись с большим updatedAt. Новые изменения из облака берутся по серверному времени `s`.
import { seal, open, deriveKey } from './crypto.js';
import * as fb from './firebase.js';
import * as st from './store.js';
import { allRecords, recordKey, applyRemoteRecord, normalizeData } from './model.js';

const CHECK = { ok: 1 };
const err = (code, message) => Object.assign(new Error(message || code), { code });
const ms = (s) => (s ? Date.parse(s) : 0);

let running = null;
export function syncNow() {
  if (running) return running;
  running = runSync().finally(() => { running = null; });
  return running;
}

async function decodeAll(key, pulled) {
  const out = [];
  for (const p of pulled) {
    try {
      const { k, r } = await open(key, p.c);
      out.push({ docId: p.id, kind: k, rec: r, u: p.u, s: p.s });
    } catch { /* запись от другого мастер-пароля — пропускаем */ }
  }
  return out;
}

async function runSync() {
  const state = await st.getSyncState();
  if (!state.enabled) return { skipped: 'disabled' };
  const key = await st.getSessionKey();
  if (!key) return { skipped: 'locked' };
  try {
    const auth = await fb.getIdToken();
    const uid = auth.uid;
    let env = await st.loadEnvelope();
    const meta = await fb.getMeta(uid);
    if (!meta) await fb.createMeta(uid, { salt: env.salt, iter: env.iter, check: await seal(key, CHECK) });
    else if (meta.salt !== env.salt) throw err('SALT_MISMATCH', 'В облаке другое хранилище (другой мастер-пароль)');

    const pulledRaw = await fb.pullRecords(uid, state.cursor);
    const pulled = await decodeAll(key, pulledRaw);
    const pushed = { ...state.pushed };
    let cursor = state.cursor;
    for (const p of pulledRaw) if (p.s && ms(p.s) >= ms(cursor)) cursor = p.s;
    for (const p of pulled) pushed[p.docId] = p.u;

    let data;
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      env = await st.loadEnvelope();
      data = await st.readData(key, env);
      let changed = false;
      for (const p of pulled) if (applyRemoteRecord(data, p.kind, p.rec)) changed = true;
      if (changed) {
        const cur = await st.loadEnvelope();
        if (cur.iv !== env.iv) continue; // пока синхронизировались, данные изменились — повтор
        await st.writeData(key, env, data);
      }
      done = true;
    }
    if (!done) throw err('BUSY', 'Данные часто меняются, повторю позже');

    const writes = [];
    for (const { kind, rec } of allRecords(data)) {
      const id = recordKey(kind, rec.id);
      if ((rec.updatedAt || 0) > (pushed[id] || 0)) writes.push({ id, u: rec.updatedAt, c: await seal(key, { k: kind, r: rec }) });
    }
    if (writes.length) await fb.pushRecords(uid, writes);
    for (const w of writes) pushed[w.id] = w.u;

    await st.setSyncState({ cursor, pushed, uid, email: auth.email, lastSync: Date.now(), lastError: '' });
    return { ok: true, pulled: pulled.length, pushed: writes.length };
  } catch (e) {
    await st.setSyncState({ lastError: e.code ? `${e.code}: ${e.message}` : e.message });
    throw e;
  }
}

// Подключить синхронизацию к уже созданному локальному хранилищу
export async function enableSync() {
  const auth = await fb.signInWithGoogle(true);
  await st.setSyncState({ enabled: true, uid: auth.uid, email: auth.email, lastError: '' });
  return syncNow();
}

export async function disableSync() {
  await st.setSyncState({ enabled: false, cursor: null, pushed: {}, lastError: '' });
  await fb.signOutGoogle();
}

// Перезаписать облачный ключ-метаданные текущим хранилищем (если в облаке был чужой мастер-пароль)
export async function overwriteCloud() {
  const key = await st.getSessionKey();
  const env = await st.loadEnvelope();
  const auth = await fb.getIdToken();
  await fb.putMeta(auth.uid, { salt: env.salt, iter: env.iter, check: await seal(key, CHECK) });
  await st.setSyncState({ cursor: null, pushed: {}, lastError: '' });
  return syncNow();
}

// Новое устройство: войти через Google, ввести мастер-пароль и подтянуть всё из облака
export async function cloudHasVault() {
  const auth = await fb.signInWithGoogle(true);
  const meta = await fb.getMeta(auth.uid);
  return { exists: !!meta, email: auth.email };
}

export async function restoreFromCloud(password) {
  const auth = await fb.getIdToken();
  const meta = await fb.getMeta(auth.uid);
  if (!meta) throw err('NO_CLOUD_VAULT', 'В облаке ещё нет хранилища');
  const key = await deriveKey(password, meta.salt, meta.iter);
  try { await open(key, meta.check); } catch { throw err('WRONG_PASSWORD', 'Неверный мастер-пароль'); }
  const pulledRaw = await fb.pullRecords(auth.uid, null);
  const pulled = await decodeAll(key, pulledRaw);
  const data = normalizeData({});
  const pushed = {};
  let cursor = null;
  for (const p of pulledRaw) if (p.s && ms(p.s) >= ms(cursor)) cursor = p.s;
  for (const p of pulled) { applyRemoteRecord(data, p.kind, p.rec); pushed[p.docId] = p.u; }
  const env = await st.writeData(key, { v: 1, kdf: 'PBKDF2-SHA256', iter: meta.iter, salt: meta.salt }, data);
  await st.setSessionKey(key);
  await st.setSyncState({ enabled: true, uid: auth.uid, email: auth.email, cursor, pushed, lastSync: Date.now(), lastError: '' });
  return { key, env, data };
}
