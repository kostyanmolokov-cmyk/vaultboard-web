// Синхронизация: каждая запись (пространство / группа / элемент) — отдельный зашифрованный документ в Firestore.
// Побеждает запись с большим updatedAt. Новые изменения из облака берутся по серверному времени `s`.
import { seal, open, deriveKey, exportKey, importKey, wrapKey, unwrapKey, newRecoveryKey, randomBytes, b64, DEFAULT_ITER } from './crypto.js?v=1794606061';
import * as fb from './firebase.js?v=1794606061';
import * as st from './store.js?v=1794606061';
import { allRecords, recordKey, applyRemoteRecord, normalizeData } from './model.js?v=1794606061';

const CHECK = { ok: 1 };
const err = (code, message) => Object.assign(new Error(message || code), { code });
const ms = (s) => (s ? Date.parse(s) : 0);

// Что лежит в облачных метаданных: соль, проверка пароля и данные для восстановления.
// rk — ключ хранилища, обёрнутый ключом восстановления (безопасно). gk — ключ хранилища для сброса через Google
// (кладётся только если это не отключено в настройках синхронизации).
async function metaPayload(key, env, state) {
  return { salt: env.salt, iter: env.iter, check: await seal(key, CHECK), rk: env.rk || '', gk: state.googleRecovery === false ? '' : await exportKey(key) };
}

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
    if (!meta) await fb.createMeta(uid, await metaPayload(key, env, state));
    else if (meta.salt !== env.salt) throw err('SALT_MISMATCH', 'В облаке другое хранилище (другой мастер-пароль)');
    else if ((meta.rk || '') !== (env.rk || '') || !!meta.gk !== (state.googleRecovery !== false)) await fb.putMeta(uid, await metaPayload(key, env, state));

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
  await fb.putMeta(auth.uid, await metaPayload(key, env, await st.getSyncState()));
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
  const { data, pushed, cursor } = await dataFromCloud(key, auth.uid);
  const env = await st.writeData(key, { v: 1, kdf: 'PBKDF2-SHA256', iter: meta.iter, salt: meta.salt, rk: meta.rk || '' }, data);
  await st.setSessionKey(key);
  await st.setSyncState({ enabled: true, uid: auth.uid, email: auth.email, cursor, pushed, lastSync: Date.now(), lastError: '' });
  return { key, env, data };
}

async function dataFromCloud(key, uid) {
  const pulledRaw = await fb.pullRecords(uid, null);
  const pulled = await decodeAll(key, pulledRaw);
  const data = normalizeData({});
  const pushed = {};
  let cursor = null;
  for (const p of pulledRaw) if (p.s && ms(p.s) >= ms(cursor)) cursor = p.s;
  for (const p of pulled) { applyRemoteRecord(data, p.kind, p.rec); pushed[p.docId] = p.u; }
  return { data, pushed, cursor };
}

// ───────── восстановление доступа ─────────
export async function setGoogleRecovery(on) {
  await st.setSyncState({ googleRecovery: !!on });
  return syncNow();
}

// Создать (или заменить) ключ восстановления для открытого хранилища. Возвращает ключ для показа пользователю.
export async function createRecoveryKey() {
  const key = await st.getSessionKey();
  const rk = newRecoveryKey();
  const env = { ...(await st.loadEnvelope()), rk: await wrapKey(key, rk) };
  await st.saveEnvelope(env);
  if ((await st.getSyncState()).enabled) await syncNow().catch(() => {});
  return { rk, env };
}

// Способ 1: войти через Google и достать ключ хранилища из облачных метаданных
export async function recoverWithGoogle() {
  const auth = await fb.signInWithGoogle(true);
  const meta = await fb.getMeta(auth.uid);
  if (!meta) throw err('NO_CLOUD_VAULT', 'В облаке для этого аккаунта нет хранилища');
  if (!meta.gk) throw err('NO_GOOGLE_RECOVERY', 'Для этого хранилища сброс через Google не включён. Используйте ключ восстановления.');
  const key = await importKey(meta.gk);
  try { await open(key, meta.check); } catch { throw err('NO_GOOGLE_RECOVERY', 'Данные восстановления в облаке устарели. Используйте ключ восстановления.'); }
  return { key, meta, auth };
}

// Способ 2: ключ восстановления. Берём обёрнутый ключ с этого устройства, а если его нет — из облака (после входа Google).
export async function recoverWithKey(rkText) {
  const env = await st.loadEnvelope();
  let packed = env?.rk || '', auth = null, meta = null;
  if (!packed) {
    auth = await fb.signInWithGoogle(true);
    meta = await fb.getMeta(auth.uid);
    packed = meta?.rk || '';
    if (!packed) throw err('NO_RECOVERY_KEY', 'Для этого хранилища ключ восстановления не создавался');
  }
  let key;
  try { key = await unwrapKey(packed, rkText); } catch { throw err('WRONG_RECOVERY_KEY', 'Неверный ключ восстановления'); }
  return { key, meta, auth };
}

// Данные для сброса: сначала локальные, иначе из облака
export async function dataForKey(key, auth) {
  const env = await st.loadEnvelope();
  if (env) { try { return await st.readData(key, env); } catch { /* локальная копия от другого ключа */ } }
  const a = auth || await fb.signInWithGoogle(true);
  return (await dataFromCloud(key, a.uid)).data;
}

// Задать новый мастер-пароль. Облако (если есть вход Google) перезаписывается новым ключом.
export async function resetPassword(data, newPassword, auth) {
  const salt = b64.to(randomBytes(16));
  const key = await deriveKey(newPassword, salt, DEFAULT_ITER);
  const rk = newRecoveryKey();
  const env = await st.writeData(key, { v: 1, kdf: 'PBKDF2-SHA256', iter: DEFAULT_ITER, salt, rk: await wrapKey(key, rk) }, data);
  await st.setSessionKey(key);
  if (auth) {
    await st.setSyncState({ enabled: true, uid: auth.uid, email: auth.email, cursor: null, pushed: {}, lastError: '' });
    await overwriteCloud().catch(() => {});
  }
  return { key, env, rk };
}
