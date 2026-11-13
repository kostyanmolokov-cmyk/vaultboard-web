// Хранилище в браузере: зашифрованный конверт в storage.local, ключ сессии в storage.session (только в памяти).
import { importKey, exportKey, encryptJson, decryptJson } from './crypto.js?v=1794607068';
import { normalizeData } from './model.js?v=1794607068';

// chrome берём лениво (удобно для тестов)
const area = (name) => new Proxy({}, { get: (_, k) => chrome.storage[name][k].bind(chrome.storage[name]) });
const L = area('local');
const S = area('session');

export async function loadEnvelope() { return (await L.get('envelope')).envelope || null; }
export async function saveEnvelope(env) { await L.set({ envelope: env }); }
export async function wipeAll() { await L.clear(); await S.clear(); }

export async function getSessionKey() {
  const { key } = await S.get('key');
  return key ? importKey(key) : null;
}
export async function setSessionKey(key) { await S.set({ key: await exportKey(key) }); }
export async function clearSessionKey() { await S.remove('key'); }

export async function readData(key, env) {
  return normalizeData(await decryptJson(key, env));
}

export async function writeData(key, env, data) {
  const { iv, ct } = await encryptJson(key, data);
  const next = { ...env, iv, ct, updatedAt: Date.now() };
  await saveEnvelope(next);
  return next;
}

const DEFAULT_PREFS = { autolockMin: 15, clipClearSec: 30, theme: 'auto', favicons: true };
export async function getPrefs() { return { ...DEFAULT_PREFS, ...((await L.get('prefs')).prefs || {}) }; }
export async function setPrefs(p) { await L.set({ prefs: { ...(await getPrefs()), ...p } }); }

export async function getUi() { return (await L.get('ui')).ui || {}; }
export async function setUi(p) { await L.set({ ui: { ...(await getUi()), ...p } }); }

export async function getSyncState() {
  return { enabled: false, email: '', uid: '', cursor: null, pushed: {}, lastSync: 0, lastError: '', ...((await L.get('sync')).sync || {}) };
}
export async function setSyncState(p) { await L.set({ sync: { ...(await getSyncState()), ...p } }); }
