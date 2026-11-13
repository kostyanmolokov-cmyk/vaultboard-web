// Подмена chrome.* для веб-версии: хранилище в браузере, автоблокировка на странице.
(() => {
  if (globalThis.chrome?.runtime?.id) return;
  const listeners = [];
  const fire = (ch, area) => listeners.forEach((f) => { try { f(ch, area); } catch (e) { console.error(e); } });
  const area = (store, prefix, name) => {
    const read = () => { try { return JSON.parse(store.getItem(prefix) || '{}'); } catch { return {}; } };
    const write = (o) => store.setItem(prefix, JSON.stringify(o));
    return {
      async get(keys) { const o = read(); if (keys == null) return o; const arr = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys); const r = {}; for (const k of arr) if (k in o) r[k] = o[k]; return r; },
      async set(obj) { const o = read(); Object.assign(o, JSON.parse(JSON.stringify(obj))); write(o); },
      async remove(k) { const o = read(); for (const x of [].concat(k)) delete o[x]; write(o); if (name === 'session') for (const x of [].concat(k)) fire({ [x]: { oldValue: 1, newValue: undefined } }, 'session'); },
      async clear() { store.removeItem(prefix); },
    };
  };
  const local = area(localStorage, 'vaultboard.local', 'local');
  const session = area(sessionStorage, 'vaultboard.session', 'session');
  // изменения из другой вкладки
  addEventListener('storage', (e) => {
    if (e.key !== 'vaultboard.local') return;
    let a = {}, b = {}; try { a = JSON.parse(e.oldValue || '{}'); b = JSON.parse(e.newValue || '{}'); } catch {}
    const ch = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) ch[k] = { oldValue: a[k], newValue: b[k] };
    if (Object.keys(ch).length) fire(ch, 'local');
  });
  let lockTimer = 0;
  const touch = async () => {
    clearTimeout(lockTimer);
    const { prefs } = await local.get('prefs'); const min = prefs?.autolockMin ?? 15;
    if (min > 0) lockTimer = setTimeout(() => session.remove('key'), min * 60 * 1000);
  };
  // В вебе нет фонового процесса: синхронизацию запускаем прямо на странице и сообщаем интерфейсу об изменениях.
  let syncTimer = 0;
  const runSync = async () => {
    const keys = ['envelope', 'sync'];
    const before = await local.get(keys);
    let result, error;
    try { result = await (await import('./lib/sync.js')).syncNow(); } catch (e) { error = e; }
    const after = await local.get(keys);
    const ch = {};
    for (const k of keys) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) ch[k] = { oldValue: before[k], newValue: after[k] };
    if (Object.keys(ch).length) fire(ch, 'local');
    if (error) throw error;
    return result;
  };
  setInterval(() => runSync().catch(() => {}), 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) runSync().catch(() => {}); });
  const handle = async (msg) => {
    switch (msg?.cmd) {
      case 'touch': await touch(); return { ok: true };
      case 'lock': clearTimeout(lockTimer); return { ok: true };
      case 'syncSoon': clearTimeout(syncTimer); syncTimer = setTimeout(() => runSync().catch(() => {}), 2500); return { ok: true };
      case 'syncNow': try { return { ok: true, result: await runSync() }; } catch (e) { return { ok: false, error: e.message, code: e.code }; }
      default: return { ok: false };
    }
  };
  globalThis.chrome = {
    storage: { local, session, onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: { getURL: (p) => new URL(String(p).replace(/^\//, ''), location.href).href, sendMessage: handle },
    tabs: { create: ({ url }) => { window.open(url, '_blank', 'noopener'); } },
    permissions: { request: async () => true },
  };
})();
