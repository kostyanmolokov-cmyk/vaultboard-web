// Модель данных и слияние (общая для интерфейса и фонового скрипта).
// Три вида записей: space (пространство), group (группа), item (логин / ссылка / заметка).
export const uid = () => crypto.randomUUID();

export const GROUP_COLORS = ['#4f8cff', '#34c38f', '#f1b44c', '#f46a6a', '#a06cf0', '#38bdf8', '#fb923c', '#94a3b8'];

export function emptyData() {
  const now = Date.now();
  const spaces = ['Работа', 'Разработка', 'Дом'].map((name, i) => ({ id: uid(), name, order: i, updatedAt: now }));
  return { v: 1, spaces, groups: [], items: [] };
}

export function normalizeData(d) {
  d = d || {};
  return { v: 1, spaces: d.spaces || [], groups: d.groups || [], items: d.items || [] };
}

export const KINDS = [
  ['space', 'spaces'],
  ['group', 'groups'],
  ['item', 'items'],
];

// Ключ записи в облаке
export const recordKey = (kind, id) => `${kind}_${id}`;

// Список всех записей плоским массивом [{kind, rec}]
export function allRecords(data) {
  const out = [];
  for (const [kind, coll] of KINDS) for (const rec of data[coll]) out.push({ kind, rec });
  return out;
}

const TOMBSTONE_MS = 90 * 24 * 3600 * 1000;

// Слияние: побеждает запись с большим updatedAt. Возвращает новые данные и признаки изменений.
export function mergeData(local, remote, now = Date.now()) {
  local = normalizeData(local);
  remote = normalizeData(remote);
  const out = { v: 1, spaces: [], groups: [], items: [] };
  let changedLocal = false;
  let changedRemote = false;
  for (const [, coll] of KINDS) {
    const lm = new Map(local[coll].map((r) => [r.id, r]));
    const rm = new Map(remote[coll].map((r) => [r.id, r]));
    for (const id of new Set([...lm.keys(), ...rm.keys()])) {
      const l = lm.get(id);
      const r = rm.get(id);
      let pick;
      if (!l) { pick = r; changedLocal = true; }
      else if (!r) { pick = l; changedRemote = true; }
      else if ((r.updatedAt || 0) > (l.updatedAt || 0)) { pick = r; changedLocal = true; }
      else if ((l.updatedAt || 0) > (r.updatedAt || 0)) { pick = l; changedRemote = true; }
      else pick = l;
      if (pick.deleted && now - (pick.updatedAt || 0) > TOMBSTONE_MS) continue;
      out[coll].push(pick);
    }
  }
  return { data: out, changedLocal, changedRemote };
}

// Применить одну запись из облака: вернёт true, если локальные данные изменились
export function applyRemoteRecord(data, kind, rec) {
  const coll = KINDS.find((k) => k[0] === kind)?.[1];
  if (!coll) return false;
  const i = data[coll].findIndex((r) => r.id === rec.id);
  if (i < 0) { data[coll].push(rec); return true; }
  if ((rec.updatedAt || 0) > (data[coll][i].updatedAt || 0)) { data[coll][i] = rec; return true; }
  return false;
}

export function liveItems(data) { return data.items.filter((i) => !i.deleted); }
export function liveGroups(data) { return data.groups.filter((g) => !g.deleted); }
export function liveSpaces(data) { return data.spaces.filter((s) => !s.deleted).sort((a, b) => a.order - b.order); }

export function newItem(type, groupId, order = 0) {
  const now = Date.now();
  return {
    id: uid(), type, title: '', url: '', username: '', password: '', notes: '', tags: [],
    groupId, order, favorite: false, autoSubmit: false, createdAt: now, updatedAt: now,
  };
}

// Простой генератор паролей на crypto.getRandomValues (без смещения)
export function generatePassword(len = 20, opts = {}) {
  const { lower = true, upper = true, digits = true, symbols = true } = opts;
  let chars = '';
  if (lower) chars += 'abcdefghijkmnopqrstuvwxyz';
  if (upper) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  if (digits) chars += '23456789';
  if (symbols) chars += '!@#$%^&*-_=+?';
  if (!chars) chars = 'abcdefghijkmnopqrstuvwxyz';
  const max = Math.floor(256 / chars.length) * chars.length;
  let out = '';
  while (out.length < len) {
    const b = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const x of b) { if (x < max && out.length < len) out += chars[x % chars.length]; }
  }
  return out;
}
