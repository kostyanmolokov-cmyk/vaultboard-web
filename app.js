// Vaultboard — панель: пространства → группы → записи (логины, ссылки, заметки).
import { deriveKey, randomBytes, b64, DEFAULT_ITER, newRecoveryKey, wrapKey } from './lib/crypto.js?v=1794651907';
import * as fb from './lib/firebase.js?v=1794651907';
import * as st from './lib/store.js?v=1794651907';
import * as sync from './lib/sync.js?v=1794651907';
import { uid, emptyData, newItem, generatePassword, liveItems, liveGroups, liveSpaces, mergeData, GROUP_COLORS } from './lib/model.js?v=1794651907';
import { normalizeUrl, hostOf, parseUrl, permissionPattern } from './lib/domain.js?v=1794651907';
import { importCsv, importBookmarksHtml, toCsv } from './lib/importers.js?v=1794651907';
import { h, icon, toast, modal, confirmBox, popMenu, renderMarkdown, vaultArt } from './ui.js?v=1794651907';

const $ = (s, r = document) => r.querySelector(s);
const root = document.getElementById('root');
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

const ALL_SITES = ['http://*/*', 'https://*/*'];
const IS_WEB = !globalThis.chrome?.runtime?.id; // веб-версия без расширения: нет автозаполнения и фонового процесса
// версия расширения: в самом расширении берём из манифеста, на сайте подставляется при сборке
const EXT_VERSION = IS_WEB ? '1.9.1' : chrome.runtime.getManifest().version;
const S = {
  env: null, key: null, data: null, prefs: null, ui: {}, sync: null,
  spaceId: null, q: '', type: 'all', tag: null, drag: null, reloadPending: false,
};
const TYPE_LABEL = { login: 'Логин', link: 'Ссылка', note: 'Заметка' };
const TYPE_ICON = { login: 'key', link: 'link', note: 'note' };

// подсветка под курсором: позиция мыши внутри карточки и пунктов сайдбара
let spotRaf = 0;
document.addEventListener('pointermove', (e) => {
  if (spotRaf || e.pointerType === 'touch') return;
  const t = e.target.closest?.('.group, .tab, .frow, .tab-add, .item, .group-add');
  if (!t) return;
  spotRaf = requestAnimationFrame(() => {
    spotRaf = 0;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
}, { passive: true });

// ───────────────────────── запуск ─────────────────────────
async function boot() {
  if (IS_WEB) fb.warmup();
  S.prefs = await st.getPrefs();
  if (!S.prefs.designV3) { await st.setPrefs({ scene: 'night', designV3: true }); S.prefs = await st.getPrefs(); } // новый тёмный дизайн по умолчанию
  S.ui = await st.getUi();
  applyTheme();
  S.env = await st.loadEnvelope();
  if (!S.env) return renderSetup();
  const key = await st.getSessionKey();
  if (!key) return renderUnlock();
  try { await enter(key); } catch { await st.clearSessionKey(); renderUnlock(); }
}

function applyTheme() {
  const sc = S.prefs.scene || 'night', d = document.documentElement.dataset;
  d.scene = sc; d.look = sc === 'pearl' || sc === 'peach' ? 'pearl' : sc === 'night' ? 'night' : 'glass'; d.theme = d.look === 'pearl' ? 'light' : 'dark';
  applyPalette();
}

// Цвета сфер и акцента зависят от пространства: фиолетово-розовый, изумрудно-голубой, тёпло-персиковый
const PALETTES = ['violet', 'emerald', 'peach'];
function applyPalette() {
  const d = document.documentElement.dataset;
  if (d.look !== 'pearl') { delete d.pal; return; }
  if (d.scene === 'peach') { d.pal = 'peach'; return; }
  const i = S.data ? liveSpaces(S.data).findIndex((s) => s.id === S.spaceId) : 0;
  d.pal = PALETTES[(i < 0 ? 0 : i) % PALETTES.length];
}

async function enter(key) {
  S.key = key;
  S.data = await st.readData(key, S.env);
  S.sync = await st.getSyncState();
  const spaces = liveSpaces(S.data);
  S.spaceId = spaces.find((s) => s.id === S.ui.lastSpace)?.id || spaces[0]?.id || null;
  renderApp();
  send({ cmd: 'touch' });
  if (S.sync.enabled) send({ cmd: 'syncSoon' });
}

chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area === 'local' && ch.envelope?.newValue && S.key && ch.envelope.newValue.iv !== S.env?.iv) {
    S.env = ch.envelope.newValue;
    if (document.querySelector('.scrim')) { S.reloadPending = true; return; }
    try { S.data = await st.readData(S.key, S.env); renderAll(); } catch { /* ключ сменился */ }
  }
  if (area === 'local' && ch.sync) { S.sync = await st.getSyncState(); if ($('#sync-btn')) renderSyncBadge(); }
  if (area === 'session' && ch.key && !ch.key.newValue && S.key) { S.key = null; S.data = null; renderUnlock(); }
});

// ───────────────────────── сохранение ─────────────────────────
async function commit() {
  const cur = await st.loadEnvelope();
  if (cur && cur.iv !== S.env.iv) {
    // пока мы редактировали, фон успел синхронизировать — сначала сливаем
    const remote = await st.readData(S.key, cur);
    S.data = mergeData(S.data, remote).data;
    S.env = cur;
  }
  S.env = await st.writeData(S.key, S.env, S.data);
  send({ cmd: 'syncSoon' });
}
const stamp = (o) => { o.updatedAt = Date.now(); return o; };

// ───────────────────────── экран создания / восстановления ─────────────────────────
function shell(content) {
  root.replaceChildren(h('main', { class: 'gate' },
    h('div', { class: 'gate-card' },
      vaultArt(112),
      h('div', { class: 'brand big' }, h('span', { class: 'mark' }, icon('lock', 20)), h('span', { class: 'brand-name' }, 'Vaultboard')),
      content)));
}

function pwField(label, id, opts = {}) {
  return h('label', { class: 'field' }, h('span', {}, label),
    h('input', { id, type: 'password', autocomplete: opts.autocomplete || 'off', placeholder: opts.placeholder || '', autofocus: opts.autofocus }));
}

function renderSetup(mode = 'new') {
  const tabs = h('div', { class: 'seg' },
    h('button', { class: mode === 'new' ? 'on' : '', onclick: () => renderSetup('new') }, 'Новое хранилище'),
    h('button', { class: mode === 'cloud' ? 'on' : '', onclick: () => renderSetup('cloud') }, 'Уже есть в Google'));
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  let form;
  if (mode === 'new') {
    const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Создать хранилище');
    form = h('form', { class: 'gate-form', onsubmit: async (e) => {
      e.preventDefault();
      const p1 = $('#pw1').value, p2 = $('#pw2').value;
      if (p1.length < 8) return (msg.textContent = 'Мастер-пароль должен быть не короче 8 символов.');
      if (p1 !== p2) return (msg.textContent = 'Пароли не совпадают.');
      btn.disabled = true; btn.textContent = 'Создаю…'; msg.textContent = '';
      const salt = b64.to(randomBytes(16));
      const key = await deriveKey(p1, salt, DEFAULT_ITER);
      const rk = newRecoveryKey();
      S.env = await st.writeData(key, { v: 1, kdf: 'PBKDF2-SHA256', iter: DEFAULT_ITER, salt, rk: await wrapKey(key, rk) }, emptyData());
      await st.setSessionKey(key);
      await enter(key);
      toast('Хранилище создано');
      showRecoveryKey(rk);
    } },
      h('p', { class: 'lead' }, 'Всё шифруется мастер-паролем на этом устройстве. Восстановить его нельзя, поэтому запомните или сохраните в надёжном месте.'),
      pwField('Мастер-пароль', 'pw1', { autofocus: true, autocomplete: 'new-password' }),
      pwField('Повторите пароль', 'pw2', { autocomplete: 'new-password' }),
      msg, btn);
  } else {
    let stage = h('div');
    const startBtn = h('button', { class: 'btn primary wide', type: 'button', onclick: async () => {
      startBtn.disabled = true; startBtn.textContent = 'Открываю вход Google…'; msg.textContent = '';
      try {
        const r = await sync.cloudHasVault();
        if (!r.exists) { msg.textContent = `В облаке для ${r.email} пока нет хранилища. Создайте новое и включите синхронизацию в меню.`; startBtn.disabled = false; startBtn.textContent = 'Войти через Google'; return; }
        const btn2 = h('button', { class: 'btn primary wide', type: 'submit' }, 'Расшифровать и открыть');
        stage.replaceChildren(h('form', { class: 'gate-form', onsubmit: async (e) => {
          e.preventDefault();
          btn2.disabled = true; btn2.textContent = 'Расшифровываю…'; msg.textContent = '';
          try {
            const res = await sync.restoreFromCloud($('#pwc').value);
            S.env = res.env;
            await enter(res.key);
            toast('Хранилище загружено из облака');
          } catch (er) {
            msg.textContent = er.code === 'WRONG_PASSWORD' ? 'Неверный мастер-пароль.' : 'Не удалось загрузить: ' + er.message;
            btn2.disabled = false; btn2.textContent = 'Расшифровать и открыть';
          }
        } }, h('p', { class: 'lead' }, `Вы вошли как ${r.email}. Введите мастер-пароль этого хранилища.`), pwField('Мастер-пароль', 'pwc', { autofocus: true }), btn2,
          h('button', { class: 'link-btn', type: 'button', onclick: openForgot }, 'Забыли мастер-пароль?')));
        startBtn.remove();
        $('#pwc')?.focus();
      } catch (er) {
        msg.textContent = 'Вход не удался: ' + er.message;
        startBtn.disabled = false; startBtn.textContent = 'Войти через Google';
      }
    } }, 'Войти через Google');
    form = h('div', { class: 'gate-form' },
      h('p', { class: 'lead' }, 'Войдите тем же аккаунтом Google, которым пользуетесь на другом устройстве. Данные придут зашифрованными, пароль понадобится только для расшифровки.'),
      startBtn, stage, msg);
  }
  shell([tabs, form]);
}

function renderUnlock() {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Открыть');
  shell(h('form', { class: 'gate-form', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Проверяю…'; msg.textContent = '';
    try {
      const key = await deriveKey($('#pwu').value, S.env.salt, S.env.iter);
      await st.readData(key, S.env); // бросит ошибку при неверном пароле
      await st.setSessionKey(key);
      await enter(key);
    } catch {
      msg.textContent = 'Неверный мастер-пароль.';
      btn.disabled = false; btn.textContent = 'Открыть';
      $('#pwu').select();
    }
  } },
    h('p', { class: 'lead' }, 'Хранилище заблокировано.'),
    pwField('Мастер-пароль', 'pwu', { autofocus: true }),
    msg, btn,
    h('button', { class: 'link-btn', type: 'button', onclick: openForgot }, 'Забыли пароль?')));
}

// ───────────────────────── основной экран ─────────────────────────
function renderApp() {
  S.animate = true;
  root.replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }, icon('lock', 14)), h('span', { class: 'brand-name' }, 'Vaultboard')),
      h('div', { class: 'side-label' }, 'Пространства'),
      h('nav', { id: 'tabs', class: 'tabs', role: 'tablist' }),
      h('div', { id: 'filters', class: 'filters' }),
      h('div', { class: 'side-foot' },
        h('button', { class: 'frow', id: 'sync-btn', title: 'Синхронизация', onclick: openSyncDialog }, icon('cloud', 15), h('span', { class: 'flabel' }, 'Синхронизация'), h('i', { class: 'dot' })),
        h('button', { class: 'frow', title: 'Импорт, экспорт, настройки', onclick: (e) => mainMenu(e.currentTarget) }, icon('sliders', 15), h('span', { class: 'flabel' }, 'Меню')),
        h('button', { class: 'frow', title: 'Заблокировать', onclick: lockNow }, icon('lock', 15), h('span', { class: 'flabel' }, 'Заблокировать')))),
    h('section', { class: 'main' },
      h('header', { class: 'top' },
        h('label', { class: 'search' }, icon('search', 15),
          h('input', { id: 'q', type: 'search', placeholder: 'Поиск по всем записям', autocomplete: 'off', 'aria-label': 'Поиск', oninput: (e) => { S.q = e.target.value; renderBoard(); renderFilters(); },
            onkeydown: (e) => {
              if (e.key === 'Escape') { e.target.value = ''; S.q = ''; renderBoard(); renderFilters(); e.target.blur(); }
              if (e.key === 'Enter') { const first = $('.item'); if (first) activateById(first.dataset.id); }
            } }), h('kbd', {}, '/')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', id: 'add-btn', onclick: (e) => addMenu(e.currentTarget) }, icon('plus', 15), 'Добавить'))),
      h('div', { class: 'hero' }, h('h1', { id: 'crumb' }), h('p', { id: 'hsub' })),
      h('main', { id: 'board', class: 'board' }))));
  renderAll();
}

function renderAll() { renderTabs(); renderFilters(); renderBoard(); renderSyncBadge(); }

function renderSyncBadge() {
  const b = $('#sync-btn'); if (!b) return;
  const s = S.sync || {};
  b.dataset.state = !s.enabled ? 'off' : s.lastError ? 'error' : 'ok';
  const t = s.lastSync ? new Date(s.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  b.title = !s.enabled ? 'Синхронизация выключена' : s.lastError ? 'Ошибка синхронизации' : 'Синхронизировано ' + t;
  const lab = b.querySelector('.flabel'); if (lab) lab.textContent = !s.enabled ? 'Синхронизация выкл.' : s.lastError ? 'Ошибка синхронизации' : 'Синхронизировано ' + t;
}

// ───── вкладки пространств ─────
function itemsInSpace(spaceId) {
  const gids = new Set(liveGroups(S.data).filter((g) => g.spaceId === spaceId).map((g) => g.id));
  return liveItems(S.data).filter((i) => gids.has(i.groupId));
}

function renderTabs() {
  applyPalette();
  const el = $('#tabs'); el.replaceChildren();
  for (const sp of liveSpaces(S.data)) {
    const active = sp.id === S.spaceId;
    const tab = h('div', { class: 'tab' + (active ? ' active' : ''), role: 'tab', tabindex: '0', 'aria-selected': String(active), dataset: { id: sp.id },
      onclick: () => selectSpace(sp.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSpace(sp.id); } },
      ondragover: (e) => { if (S.drag?.type === 'item') { e.preventDefault(); tab.classList.add('drop'); } },
      ondragleave: () => tab.classList.remove('drop'),
      ondrop: (e) => { e.preventDefault(); tab.classList.remove('drop'); if (S.drag?.type === 'item') moveItemToSpace(S.drag.id, sp.id); } },
      h('span', { class: 'sico' }, h('i')),
      h('span', { class: 'tname' }, sp.name),
      h('span', { class: 'tcount' }, String(itemsInSpace(sp.id).length)),
      active ? h('button', { class: 'tmore', title: 'Действия с пространством', 'aria-label': 'Действия с пространством', onclick: (e) => { e.stopPropagation(); spaceMenu(e.currentTarget, sp); } }, icon('more', 16)) : null);
    el.append(tab);
  }
  el.append(h('button', { class: 'tab-add', title: 'Новое пространство', 'aria-label': 'Новое пространство', onclick: () => spaceDialog() }, icon('plus', 15), h('span', {}, 'Новое пространство')));
  const cr = $('#crumb'); if (cr) cr.textContent = liveSpaces(S.data).find((x) => x.id === S.spaceId)?.name || '';
  const hs = $('#hsub'); if (hs) { const ng = liveGroups(S.data).filter((g) => g.spaceId === S.spaceId).length, ni = itemsInSpace(S.spaceId).length; hs.textContent = `${plural(ni, ['запись', 'записи', 'записей'])} в ${plural(ng, ['группе', 'группах', 'группах'])}`; }
}

async function selectSpace(id) {
  S.spaceId = id; S.tag = null;
  S.ui.lastSpace = id; st.setUi({ lastSpace: id });
  S.animate = true;
  const hero = document.querySelector('.hero'); if (hero) { hero.classList.remove('fade'); void hero.offsetWidth; hero.classList.add('fade'); }
  renderTabs(); renderFilters(); renderBoard();
}

function spaceMenu(anchor, sp) {
  const spaces = liveSpaces(S.data);
  const i = spaces.findIndex((s) => s.id === sp.id);
  const swap = async (j) => {
    const a = spaces[i], b = spaces[j];
    [a.order, b.order] = [b.order, a.order]; stamp(a); stamp(b);
    await commit(); renderTabs();
  };
  popMenu(anchor, [
    { label: 'Переименовать', icon: 'edit', onClick: () => spaceDialog(sp) },
    i > 0 ? { label: 'Сдвинуть влево', onClick: () => swap(i - 1) } : null,
    i < spaces.length - 1 ? { label: 'Сдвинуть вправо', onClick: () => swap(i + 1) } : null,
    '-',
    { label: 'Удалить пространство', icon: 'trash', danger: true, onClick: async () => {
      const n = itemsInSpace(sp.id).length;
      if (spaces.length < 2) return toast('Должно остаться хотя бы одно пространство', 'warn');
      if (!(await confirmBox(`Удалить пространство «${sp.name}» вместе с группами и записями (${n})? Отменить нельзя.`))) return;
      for (const g of S.data.groups.filter((x) => x.spaceId === sp.id && !x.deleted)) deleteGroupRaw(g);
      sp.deleted = true; stamp(sp);
      await commit();
      S.spaceId = liveSpaces(S.data)[0].id; renderAll(); toast('Пространство удалено');
    } },
  ].filter(Boolean));
}

function spaceDialog(sp) {
  const input = h('input', { type: 'text', value: sp?.name || '', maxlength: '40', placeholder: 'Например, Клиенты', autofocus: true });
  const save = async () => {
    const name = input.value.trim(); if (!name) return;
    if (sp) { sp.name = name; stamp(sp); }
    else {
      const order = Math.max(-1, ...S.data.spaces.map((s) => s.order)) + 1;
      const ns = { id: uid(), name, order, updatedAt: Date.now() };
      S.data.spaces.push(ns); S.spaceId = ns.id;
    }
    await commit(); m.close(); renderAll();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const m = modal({ title: sp ? 'Переименовать пространство' : 'Новое пространство', body: h('label', { class: 'field' }, h('span', {}, 'Название'), input),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), h('button', { class: 'btn primary', onclick: save }, sp ? 'Сохранить' : 'Создать')] });
}

// ───── фильтры ─────
function renderFilters() {
  const el = $('#filters'); if (!el) return;
  el.replaceChildren();
  const inSpace = itemsInSpace(S.spaceId);
  const count = { all: inSpace.length, login: 0, link: 0, note: 0, fav: 0 };
  for (const i of inSpace) { count[i.type]++; if (i.favorite) count.fav++; }
  const types = [['all', 'Все записи', 'folder'], ['login', 'Логины', 'key'], ['link', 'Ссылки', 'link'], ['note', 'Заметки', 'note'], ['fav', 'Избранное', 'star']];
  el.append(h('div', { class: 'side-label' }, 'Показать'));
  for (const [v, label, ic] of types) el.append(h('button', { class: 'frow' + (S.type === v ? ' on' : ''), onclick: () => { S.type = v; renderFilters(); renderBoard(); } }, icon(ic, 15), h('span', { class: 'flabel' }, label), h('span', { class: 'fcount' }, String(count[v]))));
  const tags = new Map();
  for (const i of inSpace) for (const t of i.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
  const top = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  if (top.length) {
    el.append(h('div', { class: 'side-label' }, 'Теги'));
    const tg = h('div', { class: 'tagwrap' });
    for (const [t, n] of top) tg.append(h('button', { class: 'chip' + (S.tag === t ? ' on' : ''), onclick: () => { S.tag = S.tag === t ? null : t; renderFilters(); renderBoard(); } }, '#' + t, h('small', {}, String(n))));
    el.append(tg);
  }
  if (S.q.trim()) el.append(h('div', { class: 'scope' }, 'Поиск идёт по всем пространствам'));
}

// ───── доска с группами ─────
const plural = (n, f) => `${n} ${f[n % 10 === 1 && n % 100 !== 11 ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2]}`;
const lc = (s) => String(s || '').toLowerCase();
function matches(i, terms) {
  if (!terms.length) return true;
  const hay = lc([i.title, i.url, i.username, (i.tags || []).join(' '), i.notes].join(' '));
  return terms.every((t) => hay.includes(t));
}

async function autofillBanner(board) {
  if (S.prefs.autofill === false) return;
  let has = false;
  try { has = await chrome.permissions.contains({ origins: ALL_SITES }); } catch { return; }
  if (has || !board.isConnected || board.querySelector('.afbanner')) return;
  board.prepend(h('div', { class: 'afbanner' },
    h('span', {}, 'Чтобы логин и пароль подставлялись при открытии любого сайта, разрешите расширению доступ к сайтам.'),
    h('button', { class: 'btn primary', onclick: async (e) => {
      let ok = false;
      try { ok = await chrome.permissions.request({ origins: ALL_SITES }); } catch { ok = false; }
      if (ok) { e.target.closest('.afbanner').remove(); toast('Автозаполнение включено на всех сайтах'); } else toast('Доступ не выдан', 'warn');
    } }, 'Разрешить')));
}

function renderBoard() {
  const board = $('#board'); if (!board) return;
  const terms = lc(S.q).split(/\s+/).filter(Boolean);
  const global = terms.length > 0;
  const filtering = global || S.tag || S.type !== 'all';
  const spaces = new Map(liveSpaces(S.data).map((s) => [s.id, s]));
  const groups = liveGroups(S.data).filter((g) => spaces.has(g.spaceId) && (global || g.spaceId === S.spaceId))
    .sort((a, b) => (global ? spaces.get(a.spaceId).order - spaces.get(b.spaceId).order : 0) || a.order - b.order);
  const items = liveItems(S.data);
  board.replaceChildren();
  if (!IS_WEB) autofillBanner(board);
  board.classList.toggle('enter', !!S.animate); S.animate = false;
  let shown = 0, gi = 0, ii = 0;
  for (const g of groups) {
    let list = items.filter((i) => i.groupId === g.id).sort((a, b) => a.order - b.order);
    list = list.filter((i) => matches(i, terms) && (S.type === 'all' || (S.type === 'fav' ? i.favorite : i.type === S.type)) && (!S.tag || (i.tags || []).includes(S.tag)));
    if (filtering && !list.length) continue;
    shown += list.length;
    const card = groupCard(g, list, global ? spaces.get(g.spaceId).name : null, filtering);
    card.style.setProperty('--gi', String(Math.min(gi++, 8)));
    card.querySelectorAll('.item').forEach((el) => el.style.setProperty('--ii', String(Math.min(ii++, 14))));
    board.append(card);
  }
  if (!board.children.length) board.append(emptyState(global, groups.length === 0 && !filtering));
  else if (!filtering) board.append(h('button', { class: 'group-add', style: { '--gi': String(Math.min(gi, 8)) }, onclick: () => groupDialog() }, icon('plus', 16), 'Новая группа'));
}

function emptyState(global, noGroups) {
  if (global) return h('div', { class: 'empty' }, vaultArt(110), h('p', { class: 'empty-title' }, 'Ничего не найдено'), h('p', {}, `По запросу «${S.q.trim()}» нет записей. Проверьте написание или очистите фильтры.`));
  if (noGroups) return h('div', { class: 'empty' }, vaultArt(170),
    h('p', { class: 'empty-title' }, 'В этом пространстве пока нет групп'),
    h('p', {}, 'Создайте группу и добавьте в неё логины, ссылки и заметки. Либо импортируйте закладки или пароли из файла.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => groupDialog() }, icon('plus', 16), 'Создать группу'), h('button', { class: 'btn', onclick: openImport }, icon('upload', 16), 'Импортировать')));
  return h('div', { class: 'empty' }, vaultArt(110), h('p', { class: 'empty-title' }, 'Нет записей с такими фильтрами'), h('button', { class: 'btn', onclick: () => { S.type = 'all'; S.tag = null; renderFilters(); renderBoard(); } }, 'Сбросить фильтры'));
}

function groupCard(g, list, spaceName, filtering) {
  const collapsed = !!S.ui.collapsed?.[g.id] && !filtering;
  const el = h('section', { class: 'group' + (collapsed ? ' collapsed' : ''), dataset: { id: g.id }, style: { '--c': g.color || GROUP_COLORS[0] },
    ondragover: (e) => groupDragOver(e, el, g), ondragleave: () => el.classList.remove('drop-before', 'drop-after'),
    ondrop: (e) => groupDrop(e, el, g) });
  el.append(h('i', { class: 'spot', 'aria-hidden': 'true' })); // подсветка рамки под курсором
  const grip = h('span', { class: 'grip', title: 'Перетащить группу', draggable: true,
    ondragstart: (e) => { S.drag = { type: 'group', id: g.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.id); e.dataTransfer.setDragImage(el, 16, 16); el.classList.add('dragging'); },
    ondragend: () => { S.drag = null; document.querySelectorAll('.dragging,.drop-before,.drop-after').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after')); } }, icon('grip', 16));
  el.append(h('header', { class: 'ghead' },
    grip,
    h('button', { class: 'gname', 'aria-expanded': String(!collapsed), title: collapsed ? 'Развернуть' : 'Свернуть', onclick: () => toggleGroup(g) },
      h('span', { class: 'chev' }, icon('chevron', 14)), h('h3', {}, g.name), spaceName ? h('em', { class: 'gspace' }, spaceName) : null, h('span', { class: 'gcount' }, String(list.length))),
    h('button', { class: 'icon-btn sm', title: 'Добавить запись в группу', 'aria-label': 'Добавить запись в группу', onclick: (e) => addMenu(e.currentTarget, g.id) }, icon('plus', 16)),
    h('button', { class: 'icon-btn sm', title: 'Действия с группой', 'aria-label': 'Действия с группой', onclick: (e) => groupMenu(e.currentTarget, g) }, icon('more', 16))));
  if (!collapsed) {
    const ul = h('div', { class: 'glist', ondragover: (e) => itemDragOver(e, ul), ondragleave: (e) => { if (!ul.contains(e.relatedTarget)) clearDrop(ul); }, ondrop: (e) => itemDrop(e, ul, g.id) });
    if (!list.length) ul.append(h('button', { class: 'gempty', onclick: () => openItemEditor(newItemFor('login', g.id), true) }, 'Пусто. Добавить первую запись'));
    for (const i of list) ul.append(itemRow(i));
    el.append(ul);
  }
  return el;
}

async function toggleGroup(g) {
  const was = !!S.ui.collapsed?.[g.id];
  S.ui.collapsed = { ...(S.ui.collapsed || {}), [g.id]: !was };
  st.setUi({ collapsed: S.ui.collapsed });
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sel = `.group[data-id="${CSS.escape(g.id)}"]`;
  const el0 = document.querySelector(sel);
  const list0 = el0?.querySelector('.glist');
  if (calm || !el0) return renderBoard();
  if (!was && list0) { // сворачиваем: высота и прозрачность до нуля, потом перерисовка
    el0.classList.add('collapsed'); el0.querySelector('.gname')?.setAttribute('aria-expanded', 'false');
    list0.classList.add('anim');
    const a = list0.animate([{ height: list0.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }], { duration: 240, easing: 'ease-out', fill: 'forwards' });
    a.onfinish = a.oncancel = () => renderBoard();
    return;
  }
  renderBoard(); // разворачиваем: после перерисовки раскрываем список
  const list = document.querySelector(sel + ' .glist');
  if (list) { list.classList.add('anim'); list.animate([{ height: '0px', opacity: 0 }, { height: list.scrollHeight + 'px', opacity: 1 }], { duration: 260, easing: 'ease-out' }).onfinish = () => list.classList.remove('anim'); }
}

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl); u.searchParams.set('size', '32');
  return u.toString();
}

function itemRow(i) {
  // значок: настоящий фавикон сайта, а если адреса нет или значок не загрузился, буква названия на градиенте в тон теме
  let fav;
  if (i.type === 'note') fav = h('span', { class: 'fav glyph note' }, icon(TYPE_ICON.note, 18));
  else {
    const host = hostOf(i.url), nm = (i.title || host || '?').trim().replace(/^www\./, '');
    let hue = 0; for (const ch of host || nm) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    const letter = h('span', { class: 'fav letter', style: { '--hue': String(hue) } }, (nm.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase());
    fav = letter;
    if (i.url && host && (!IS_WEB || S.prefs.favicons !== false)) {
      const src = IS_WEB ? `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent('https://' + host)}&size=64` : faviconUrl(normalizeUrl(i.url));
      const img = h('img', { class: 'fav fav-img', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', src });
      img.addEventListener('error', () => img.replaceWith(letter));
      img.addEventListener('load', () => { if (img.naturalWidth <= 16) img.replaceWith(letter); }); // 16 px у Google = заглушка-глобус
      fav = img;
    }
  }
  const sub = i.type === 'login' ? i.username : i.type === 'link' ? hostOf(i.url) : (i.notes || '').split('\n')[0];
  const qv = i.type === 'login' ? i.password : i.type === 'link' ? normalizeUrl(i.url) : (i.notes || '');
  const quick = qv ? h('button', { class: 'quick', title: i.type === 'login' ? 'Скопировать пароль' : i.type === 'link' ? 'Скопировать адрес' : 'Скопировать текст', 'aria-label': 'Быстро скопировать',
    onclick: (e) => { e.stopPropagation(); copy(qv, i.type === 'login' ? 'Пароль скопирован' : i.type === 'link' ? 'Адрес скопирован' : 'Текст скопирован', i.type === 'login'); quick.classList.add('done'); quick.replaceChildren(icon('check', 16)); setTimeout(() => { quick.classList.remove('done'); quick.replaceChildren(icon('copy', 16)); }, 1300); } }, icon('copy', 16)) : null;
  const row = h('div', { class: 'item ' + i.type, dataset: { id: i.id }, draggable: true, tabindex: '0', role: 'button', 'aria-label': `${TYPE_LABEL[i.type]}: ${i.title}`,
    onclick: () => activate(i),
    onkeydown: (e) => { if (e.key === 'Enter') activate(i); },
    ondragstart: (e) => { S.drag = { type: 'item', id: i.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', i.id); row.classList.add('dragging'); },
    ondragend: () => { S.drag = null; row.classList.remove('dragging'); document.querySelectorAll('.over,.drop-before,.drop-end,.drop').forEach((n) => n.classList.remove('over', 'drop-before', 'drop-end', 'drop')); } },
    fav,
    h('span', { class: 'ititle' }, i.title || hostOf(i.url) || '(без названия)'),
    sub ? h('span', { class: 'isub' }, sub) : null,
    quick,
    h('span', { class: 'iacts' },
      i.type === 'login' && i.username ? act('user', 'Скопировать логин', () => copy(i.username, 'Логин скопирован')) : null,
      i.type === 'login' && i.password ? act('copy', 'Скопировать пароль', () => copy(i.password, 'Пароль скопирован', true)) : null,
      act('edit', 'Изменить', () => openItemEditor(i, false)),
      h('button', { class: 'iact star' + (i.favorite ? ' on' : ''), title: i.favorite ? 'Убрать из избранного' : 'В избранное', 'aria-label': 'Избранное', 'aria-pressed': String(!!i.favorite),
        onclick: async (e) => { e.stopPropagation(); i.favorite = !i.favorite; stamp(i); await commit(); renderBoard(); } }, icon('star', 15))));
  return row;
  function act(name, title, fn) {
    return h('button', { class: 'iact', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(name, 15));
  }
}

// ───── действия с записью ─────
function activateById(id) { const i = S.data.items.find((x) => x.id === id); if (i) activate(i); }

async function activate(i) {
  if (i.type === 'note') return openItemEditor(i, false, true);
  const url = normalizeUrl(i.url);
  if (!url) return openItemEditor(i, false);
  if (i.type === 'link') { if (IS_WEB) window.open(url, '_blank', 'noopener'); else chrome.tabs.create({ url }); return; }
  if (IS_WEB) { // страница сама подставить пароль на чужой сайт не может: просим об этом расширение, если оно есть
    const r = await askExtension({ cmd: 'fillOpen', url, username: i.username || '', password: i.password || '', autoSubmit: !!i.autoSubmit });
    if (r?.ok && r.filled) return toast('Сайт открыт, логин и пароль подставятся сами');
    if (r?.ok) { // расширение открыло сайт, но у него нет доступа к этому сайту
      if (i.password) await copy(i.password, i.username ? `Пароль скопирован. Логин: ${i.username}` : 'Пароль скопирован', true);
      return toast('Откройте расширение Vaultboard и нажмите «Разрешить» — тогда пароли будут подставляться сами', 'warn');
    }
    if (i.password) await copy(i.password, i.username ? `Пароль скопирован. Логин: ${i.username}` : 'Пароль скопирован', true);
    window.open(url, '_blank', 'noopener'); return;
  }
  // логин: сначала разрешение на сайт (запрос должен идти прямо из клика), затем открытие и подстановка
  const pattern = permissionPattern(url);
  let ok = false;
  try { ok = pattern ? await chrome.permissions.request({ origins: [pattern] }) : false; } catch { ok = false; }
  if (!ok) { chrome.tabs.create({ url }); return toast('Сайт открыт без автозаполнения: нет разрешения на этот сайт', 'warn'); }
  const r = await send({ cmd: 'launch', itemId: i.id });
  if (!r?.ok) toast(r?.error || 'Не удалось открыть сайт', 'warn');
}

const EXT_ID = 'eikfacgkflahhdghibgdlohfjkikjejk';
function askExtension(msg) { // ответ расширения или null, если его нет / оно старое
  return new Promise((resolve) => {
    const send = globalThis.__vbRealSend;
    if (!send) return resolve(null);
    const t = setTimeout(() => resolve(null), 2500);
    try { send(EXT_ID, msg, (r) => { clearTimeout(t); void chrome.runtime?.lastError; resolve(r || null); }); } catch { clearTimeout(t); resolve(null); }
  });
}

let clipTimer = null;
async function copy(text, msg, secret = false) {
  try { await navigator.clipboard.writeText(text); } catch { return toast('Не удалось скопировать', 'warn'); }
  const sec = S.prefs.clipClearSec;
  toast(secret && sec ? `${msg}. Буфер очистится через ${sec} с` : msg);
  if (secret && sec > 0) { clearTimeout(clipTimer); clipTimer = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), sec * 1000); }
  send({ cmd: 'touch' });
}

function nextOrder(groupId) {
  return Math.max(-1, ...S.data.items.filter((i) => i.groupId === groupId && !i.deleted).map((i) => i.order)) + 1;
}
function newItemFor(type, groupId) { return newItem(type, groupId, nextOrder(groupId)); }

function makeGroup(spaceId, name, color) {
  const order = Math.max(-1, ...S.data.groups.filter((g) => g.spaceId === spaceId && !g.deleted).map((g) => g.order)) + 1;
  const g = { id: uid(), spaceId, name, color: color || GROUP_COLORS[order % GROUP_COLORS.length], order, updatedAt: Date.now() };
  S.data.groups.push(g);
  return g;
}
function deleteGroupRaw(g) {
  for (const i of S.data.items.filter((x) => x.groupId === g.id && !x.deleted)) { i.deleted = true; stamp(i); }
  g.deleted = true; stamp(g);
}

// ───── меню ─────
function addMenu(anchor, groupId) {
  const gid = groupId || firstGroupId();
  const mk = (type) => async () => {
    const id = gid || (await ensureGroup()).id;
    openItemEditor(newItemFor(type, id), true);
  };
  popMenu(anchor, [
    { label: 'Логин (сайт + пароль)', icon: 'key', onClick: mk('login') },
    { label: 'Ссылка', icon: 'link', onClick: mk('link') },
    { label: 'Заметка', icon: 'note', onClick: mk('note') },
    ...(groupId ? [] : ['-', { label: 'Группа', icon: 'folder', onClick: () => groupDialog() }]),
  ]);
}
function firstGroupId() {
  const g = liveGroups(S.data).filter((x) => x.spaceId === S.spaceId).sort((a, b) => a.order - b.order)[0];
  return g?.id || null;
}
async function ensureGroup() {
  const g = makeGroup(S.spaceId, 'Общее');
  await commit(); renderBoard();
  return g;
}

function mainMenu(anchor) {
  popMenu(anchor, [
    { label: 'Импорт из файла', icon: 'upload', onClick: openImport },
    { label: 'Экспорт и резервная копия', icon: 'download', onClick: openExport },
    { label: 'Настройки', icon: 'sliders', onClick: openSettings },
    { label: 'Ключ восстановления', icon: 'key', onClick: renewRecovery },
    { label: 'Где что лежит', icon: 'folder', onClick: openMap },
    IS_WEB ? { label: `Скачать расширение для Chrome (v${EXT_VERSION})`, icon: 'download', onClick: openExtDownload } : null,
    '-',
    { label: 'Заблокировать', icon: 'lock', onClick: lockNow },
  ].filter(Boolean));
}

async function lockNow() { await send({ cmd: 'lock' }); await st.clearSessionKey(); S.key = null; S.data = null; renderUnlock(); }

function groupMenu(anchor, g) {
  popMenu(anchor, [
    { label: 'Изменить группу', icon: 'edit', onClick: () => groupDialog(g) },
    { label: 'Свернуть / развернуть', icon: 'chevron', onClick: () => toggleGroup(g) },
    '-',
    { label: 'Удалить группу', icon: 'trash', danger: true, onClick: async () => {
      const n = S.data.items.filter((i) => i.groupId === g.id && !i.deleted).length;
      if (!(await confirmBox(`Удалить группу «${g.name}» и все записи в ней (${n})? Отменить нельзя.`))) return;
      deleteGroupRaw(g); await commit(); renderAll(); toast('Группа удалена');
    } },
  ]);
}

function groupDialog(g) {
  const spaces = liveSpaces(S.data);
  let color = g?.color || GROUP_COLORS[liveGroups(S.data).filter((x) => x.spaceId === S.spaceId).length % GROUP_COLORS.length];
  const name = h('input', { type: 'text', value: g?.name || '', maxlength: '60', placeholder: 'Например, Хостинг и серверы', autofocus: true });
  const space = h('select', {}, spaces.map((s) => h('option', { value: s.id, selected: s.id === (g?.spaceId || S.spaceId) }, s.name)));
  const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Цвет группы' });
  const paint = () => sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.c === color)));
  for (const c of GROUP_COLORS) sw.append(h('button', { type: 'button', role: 'radio', class: 'swatch', dataset: { c }, style: { background: c }, 'aria-label': c, onclick: () => { color = c; paint(); } }));
  paint();
  const save = async () => {
    const nm = name.value.trim(); if (!nm) return name.focus();
    if (g) { g.name = nm; g.color = color; if (g.spaceId !== space.value) { g.spaceId = space.value; g.order = Math.max(-1, ...S.data.groups.filter((x) => x.spaceId === g.spaceId).map((x) => x.order)) + 1; } stamp(g); }
    else makeGroup(space.value, nm, color);
    await commit(); m.close(); renderAll();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const m = modal({ title: g ? 'Изменить группу' : 'Новая группа',
    body: [h('label', { class: 'field' }, h('span', {}, 'Название'), name), h('label', { class: 'field' }, h('span', {}, 'Пространство'), space), h('div', { class: 'field' }, h('span', {}, 'Цвет'), sw)],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), h('button', { class: 'btn primary', onclick: save }, g ? 'Сохранить' : 'Создать')] });
}

// ───── редактор записи ─────
function openItemEditor(item, isNew, startPreview = false) {
  const d = structuredClone(item);
  const body = h('div', { class: 'editor' });
  const seg = h('div', { class: 'seg' });
  const secLogin = h('div', { class: 'sec' });
  const secUrl = h('div', { class: 'sec' });
  const title = h('input', { type: 'text', value: d.title, placeholder: 'Название', maxlength: '120', autofocus: true });
  const url = h('input', { type: 'text', value: d.url, placeholder: 'https://example.com/login', autocomplete: 'off', spellcheck: 'false' });
  const user = h('input', { type: 'text', value: d.username, autocomplete: 'off', spellcheck: 'false' });
  const pass = h('input', { type: 'password', value: d.password, autocomplete: 'new-password', spellcheck: 'false' });
  const eye = h('button', { type: 'button', class: 'icon-btn sm', title: 'Показать пароль', 'aria-label': 'Показать пароль', onclick: () => { pass.type = pass.type === 'password' ? 'text' : 'password'; } }, icon('eye', 16));
  const len = h('input', { type: 'number', min: '8', max: '64', value: String(S.ui.genLen || 20), class: 'num', 'aria-label': 'Длина пароля' });
  const sym = h('input', { type: 'checkbox', checked: S.ui.genSym !== false });
  const gen = h('button', { type: 'button', class: 'btn sm', onclick: () => {
    const n = Math.min(64, Math.max(8, Number(len.value) || 20));
    S.ui.genLen = n; S.ui.genSym = sym.checked; st.setUi({ genLen: n, genSym: sym.checked });
    pass.value = generatePassword(n, { symbols: sym.checked }); pass.type = 'text';
  } }, icon('refresh', 14), 'Создать пароль');
  const auto = h('input', { type: 'checkbox', checked: !!d.autoSubmit });
  const notes = h('textarea', { rows: d.type === 'note' ? '12' : '4', placeholder: 'Текст заметки. Поддерживается Markdown: # заголовок, **жирный**, - список, `код`' }, d.notes);
  const preview = h('div', { class: 'preview hidden' });
  const tags = h('input', { type: 'text', value: (d.tags || []).join(', '), placeholder: 'через запятую: клиент, хостинг' });
  const gsel = h('select', {});
  const spaces = liveSpaces(S.data);
  for (const sp of spaces) {
    const gs = liveGroups(S.data).filter((g) => g.spaceId === sp.id).sort((a, b) => a.order - b.order);
    if (!gs.length) continue;
    gsel.append(h('optgroup', { label: sp.name }, gs.map((g) => h('option', { value: g.id, selected: g.id === d.groupId }, g.name))));
  }
  const fav = h('input', { type: 'checkbox', checked: !!d.favorite });
  const prevBtn = h('button', { type: 'button', class: 'link-btn', onclick: () => togglePreview() }, 'Просмотр');
  const togglePreview = (on) => {
    const show = on ?? preview.classList.contains('hidden');
    if (show) { preview.replaceChildren(renderMarkdown(notes.value || '*Пусто*')); }
    preview.classList.toggle('hidden', !show); notes.classList.toggle('hidden', show);
    prevBtn.textContent = show ? 'Редактировать' : 'Просмотр';
  };
  const refresh = () => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === d.type));
    secLogin.classList.toggle('hidden', d.type !== 'login');
    secUrl.classList.toggle('hidden', d.type === 'note');
    notes.rows = d.type === 'note' ? 12 : 4;
  };
  for (const t of ['login', 'link', 'note']) seg.append(h('button', { type: 'button', dataset: { t }, onclick: () => { d.type = t; refresh(); } }, icon(TYPE_ICON[t], 15), TYPE_LABEL[t]));
  secUrl.append(h('label', { class: 'field' }, h('span', {}, 'Адрес сайта'), url));
  secLogin.append(
    h('div', { class: 'two' }, h('label', { class: 'field' }, h('span', {}, 'Логин или почта'), user), h('label', { class: 'field' }, h('span', {}, 'Пароль'), h('div', { class: 'inp-row' }, pass, eye))),
    h('div', { class: 'genrow' }, gen, h('label', { class: 'inline' }, 'Длина', len), h('label', { class: 'inline' }, sym, 'Символы')),
    h('label', { class: 'inline check' }, auto, 'После подстановки нажимать «Войти» автоматически'));
  body.append(
    isNew ? h('div', { class: 'field' }, h('span', {}, 'Тип'), seg) : h('div', { class: 'field' }, seg),
    h('label', { class: 'field' }, h('span', {}, 'Название'), title),
    secUrl, secLogin,
    h('div', { class: 'field' }, h('div', { class: 'label-row' }, h('span', {}, 'Заметки'), prevBtn), notes, preview),
    h('div', { class: 'two' }, h('label', { class: 'field' }, h('span', {}, 'Группа'), gsel), h('label', { class: 'field' }, h('span', {}, 'Теги'), tags)),
    h('label', { class: 'inline check' }, fav, 'В избранное'));
  refresh();
  if (startPreview && d.notes) togglePreview(true);

  const save = async () => {
    d.title = title.value.trim(); d.url = d.type === 'note' ? '' : url.value.trim();
    d.username = d.type === 'login' ? user.value.trim() : ''; d.password = d.type === 'login' ? pass.value : '';
    d.autoSubmit = d.type === 'login' && auto.checked; d.notes = notes.value; d.favorite = fav.checked;
    d.tags = [...new Set(tags.value.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
    if (d.type !== 'note' && d.url) d.url = normalizeUrl(d.url);
    if (!d.title) d.title = hostOf(d.url).replace(/^www\./, '');
    if (!d.title) { title.focus(); return toast('Укажите название или адрес', 'warn'); }
    let gid = gsel.value;
    if (!gid) gid = (await ensureGroup()).id;
    if (gid !== d.groupId) { d.groupId = gid; if (!isNew) d.order = nextOrder(gid); }
    const real = isNew ? d : S.data.items.find((x) => x.id === d.id);
    Object.assign(real, d); stamp(real);
    if (isNew) S.data.items.push(real);
    await commit(); mm.close(); renderAll(); toast(isNew ? 'Запись добавлена' : 'Сохранено');
  };
  const del = async () => {
    if (!(await confirmBox(`Удалить «${item.title || 'запись'}»? Отменить нельзя.`))) return;
    const real = S.data.items.find((x) => x.id === item.id); real.deleted = true; stamp(real);
    await commit(); mm.close(); renderAll(); toast('Удалено');
  };
  const mm = modal({ title: isNew ? 'Новая запись' : 'Изменить запись', body, wide: true,
    footer: [!isNew ? h('button', { class: 'btn danger left', onclick: del }, icon('trash', 15), 'Удалить') : null,
      h('button', { class: 'btn', onclick: () => mm.close() }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: save }, 'Сохранить')],
    onClose: () => flushReload() });
  mm.box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
}

async function flushReload() {
  if (!S.reloadPending || document.querySelector('.scrim')) return;
  S.reloadPending = false;
  try { S.data = await st.readData(S.key, S.env); renderAll(); } catch { /* */ }
}

// ───── перетаскивание ─────
function clearDrop(ul) { ul.classList.remove('over'); ul.querySelectorAll('.drop-before').forEach((n) => n.classList.remove('drop-before')); ul.classList.remove('drop-end'); }
function dropTarget(ul, y) {
  const rows = [...ul.querySelectorAll('.item:not(.dragging)')];
  return rows.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; }) || null;
}
function itemDragOver(e, ul) {
  if (S.drag?.type !== 'item') return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  ul.classList.add('over');
  const t = dropTarget(ul, e.clientY);
  ul.querySelectorAll('.drop-before').forEach((n) => n.classList.remove('drop-before'));
  ul.classList.toggle('drop-end', !t);
  t?.classList.add('drop-before');
}
async function itemDrop(e, ul, groupId) {
  if (S.drag?.type !== 'item') return;
  e.preventDefault();
  const t = dropTarget(ul, e.clientY);
  const id = S.drag.id; clearDrop(ul);
  await moveItem(id, groupId, t?.dataset.id || null);
}
async function moveItem(id, groupId, beforeId) {
  const it = S.data.items.find((x) => x.id === id); if (!it) return;
  const list = S.data.items.filter((x) => x.groupId === groupId && !x.deleted && x.id !== id).sort((a, b) => a.order - b.order);
  const idx = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
  list.splice(idx < 0 ? list.length : idx, 0, it);
  list.forEach((x, n) => { if (x.order !== n || x.groupId !== groupId) { x.order = n; x.groupId = groupId; stamp(x); } });
  await commit(); renderAll();
}
async function moveItemToSpace(id, spaceId) {
  let g = liveGroups(S.data).filter((x) => x.spaceId === spaceId).sort((a, b) => a.order - b.order)[0];
  if (!g) g = makeGroup(spaceId, 'Общее');
  await moveItem(id, g.id, null);
  toast('Запись перенесена в «' + S.data.spaces.find((s) => s.id === spaceId).name + '»');
}
function groupDragOver(e, el, g) {
  if (S.drag?.type !== 'group' || S.drag.id === g.id) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  const before = e.clientY < r.top + r.height / 2;
  el.classList.toggle('drop-before', before); el.classList.toggle('drop-after', !before);
}
async function groupDrop(e, el, g) {
  if (S.drag?.type !== 'group' || S.drag.id === g.id) return;
  e.preventDefault();
  const before = el.classList.contains('drop-before');
  el.classList.remove('drop-before', 'drop-after');
  const dragged = S.data.groups.find((x) => x.id === S.drag.id);
  const list = liveGroups(S.data).filter((x) => x.spaceId === g.spaceId && x.id !== dragged.id).sort((a, b) => a.order - b.order);
  let idx = list.findIndex((x) => x.id === g.id); if (!before) idx++;
  dragged.spaceId = g.spaceId;
  list.splice(idx, 0, dragged);
  list.forEach((x, n) => { if (x.order !== n || x === dragged) { x.order = n; stamp(x); } });
  await commit(); renderAll();
}

// ───────────────────────── синхронизация ─────────────────────────
function openSyncDialog() {
  const body = h('div', { class: 'sync-body' });
  const m = modal({ title: 'Синхронизация между устройствами', body, footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Закрыть')] });
  const draw = async () => {
    S.sync = await st.getSyncState(); renderSyncBadge();
    const s = S.sync; const msg = h('p', { class: 'form-msg', role: 'alert' });
    body.replaceChildren();
    if (!s.enabled) {
      body.append(
        h('p', { class: 'lead' }, 'Вход через Google подключит облачную копию. В облако уходит только зашифрованное содержимое: названия, адреса, логины и пароли расшифровываются мастер-паролем только у вас.'),
        h('ul', { class: 'bullets' }, h('li', {}, 'На втором устройстве откройте сайт или расширение, нажмите «Уже есть в Google» и введите тот же мастер-пароль.'), h('li', {}, 'Правки с разных устройств сливаются автоматически, побеждает более поздняя.')));
      const b = h('button', { class: 'btn primary', onclick: async () => {
        b.disabled = true; b.textContent = 'Подключаю…'; msg.textContent = '';
        try { await sync.enableSync(); toast('Синхронизация включена'); } catch (e) { msg.textContent = describeSyncError(e); }
        await draw();
      } }, icon('cloud', 16), 'Войти через Google и включить');
      body.append(b, msg);
    } else {
      body.append(
        h('dl', { class: 'kv' }, h('dt', {}, 'Аккаунт'), h('dd', {}, s.email || '—'), h('dt', {}, 'Последняя синхронизация'), h('dd', {}, s.lastSync ? new Date(s.lastSync).toLocaleString('ru-RU') : 'ещё не было')));
      const gr = h('input', { type: 'checkbox', checked: s.googleRecovery !== false, onchange: async () => {
        try { await sync.setGoogleRecovery(gr.checked); toast(gr.checked ? 'Сброс через Google включён' : 'Сброс через Google выключен'); } catch (e) { toast(describeSyncError(e), 'warn'); }
      } });
      body.append(h('label', { class: 'inline check' }, gr, 'Разрешить сброс мастер-пароля через вход Google'),
        h('p', { class: 'hint' }, 'Если выключить, пароль можно сбросить только по ключу восстановления. Если включено, тот, кто получит доступ к вашему аккаунту Google, сможет открыть хранилище.'));
      if (s.lastError) body.append(h('p', { class: 'form-msg' }, describeSyncError({ code: s.lastError.split(':')[0], message: s.lastError })));
      const row = h('div', { class: 'row' });
      const now = h('button', { class: 'btn primary', onclick: async () => {
        now.disabled = true; now.textContent = 'Синхронизирую…';
        const r = await send({ cmd: 'syncNow' });
        if (!r?.ok) toast(describeSyncError(r || {}), 'warn'); else toast('Готово');
        S.data = await st.readData(S.key, await st.loadEnvelope()); S.env = await st.loadEnvelope(); renderAll(); await draw();
      } }, icon('sync', 16), 'Синхронизировать сейчас');
      row.append(now);
      if (/SALT_MISMATCH/.test(s.lastError || '')) row.append(h('button', { class: 'btn primary', onclick: async () => {
        if (!(await confirmBox('Хранилище на этом устройстве будет стёрто, а вместо него откроется то, что лежит в облаке (нужен его мастер-пароль). Продолжить?', 'Открыть облачное', false))) return;
        m.close(); await st.wipeAll(); S.key = null; S.data = null; S.env = null; renderSetup('cloud');
      } }, 'Открыть облачное хранилище'));
      if (/SALT_MISMATCH/.test(s.lastError || '')) row.append(h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmBox('В облаке лежит хранилище с другим мастер-паролем. Заменить его текущим? Другие устройства потребуют заново войти и ввести новый пароль.', 'Заменить облачную копию', true))) return;
        try { await sync.overwriteCloud(); toast('Облачная копия заменена'); } catch (e) { toast(describeSyncError(e), 'warn'); }
        await draw();
      } }, 'Заменить облачную копию'));
      row.append(h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmBox('Отключить синхронизацию на этом устройстве? Данные в облаке и на устройстве останутся.', 'Отключить', false))) return;
        await sync.disableSync(); await draw();
      } }, 'Отключить'));
      body.append(row, msg);
    }
  };
  draw();
}
function describeSyncError(e) {
  const code = e.code || ''; const msg = e.message || e.error || '';
  if (code === 'SALT_MISMATCH' || /SALT_MISMATCH/.test(msg)) return 'В облаке уже есть хранилище с другим мастер-паролем. Войдите в него на этом устройстве через «Уже есть в Google» или замените облачную копию текущей.';
  if (code === 'GOOGLE_AUTH') return 'Вход в Google не удался: ' + msg;
  if (/HTTP_403|PERMISSION/.test(code + msg)) return 'Доступ к облаку запрещён. Проверьте правила Firestore и что вход выполнен тем же аккаунтом.';
  if (code === 'NOT_SIGNED_IN') return 'Нужно войти через Google заново.';
  return msg || 'Неизвестная ошибка синхронизации';
}

// ───────────────────────── памятка: где что лежит ─────────────────────────
function openMap() {
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const row = (title, text, links) => h('div', { class: 'maprow' }, h('strong', {}, title), h('p', {}, text), links ? h('div', { class: 'maplinks' }, links) : null);
  const m = modal({ title: 'Где что лежит', wide: true,
    body: [
      row('Ваши пароли и записи', 'Хранятся зашифрованными на каждом устройстве: в браузере сайта и в хранилище расширения. Расшифровать их может только мастер-пароль. Если включена синхронизация, зашифрованная копия лежит ещё и в облаке Firebase.'),
      row('Сайт (веб-версия)', 'Лежит на GitHub Pages. Исходный код сайта: репозиторий vaultboard-web на вашем GitHub. Здесь же файл расширения. Сайт обновляется, когда в репозиторий загружают новую версию.',
        [link('https://kostyanmolokov-cmyk.github.io/vaultboard-web/', 'Открыть сайт'), link('https://github.com/kostyanmolokov-cmyk/vaultboard-web', 'Репозиторий на GitHub'), link('https://github.com/kostyanmolokov-cmyk/vaultboard-web/settings/pages', 'Настройки Pages')]),
      row('Расширение для Chrome', `Установленная папка лежит у вас на компьютере (куда распаковали архив). Новый архив берётся на сайте: меню → «Скачать расширение». Сейчас актуальная версия ${EXT_VERSION}. Код расширения целиком внутри архива.`,
        [link('chrome://extensions', 'Страница расширений (скопируйте адрес в Chrome)')]),
      row('Облако и вход через Google', 'Проект Firebase vaultboard-kostya. В Firestore лежат только зашифрованные записи и данные для восстановления пароля, в Authentication учётная запись Google. Здесь же разрешённые адреса сайта: новый адрес нужно добавить в Authentication → Settings → Authorized domains.',
        [link('https://console.firebase.google.com/project/vaultboard-kostya/firestore', 'Firestore (данные)'), link('https://console.firebase.google.com/project/vaultboard-kostya/authentication/users', 'Authentication (вход)')]),
      row('Что хранить у себя', 'Мастер-пароль и ключ восстановления (меню → «Ключ восстановления»). Без них, если ещё и недоступен Google-аккаунт, записи не открыть. Резервную копию делайте в меню → «Экспорт и резервная копия».')],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Закрыть')] });
}

// ───────────────────────── скачать расширение (только веб) ─────────────────────────
function openExtDownload() {
  const dl = h('a', { class: 'btn primary', href: 'vaultboard-extension.zip', download: `vaultboard-extension-v${EXT_VERSION}.zip` }, icon('download', 16), `Скачать версию ${EXT_VERSION} (.zip)`);
  const m = modal({ title: 'Расширение для Chrome',
    body: [h('p', { class: 'lead' }, `Расширение открывает сайт и подставляет логин и пароль одним кликом. Здесь всегда самая свежая версия: сейчас ${EXT_VERSION}. Ставится на компьютере, на телефоне Chrome расширения не поддерживает.`),
      h('p', { class: 'hint' }, 'Какая версия уже стоит у вас, видно в расширении: меню → «Настройки», внизу. Если число меньше, обновите.'),
      dl,
      h('ol', { class: 'bullets steps' },
        h('li', {}, 'Распакуйте архив в постоянную папку и не удаляйте её. При обновлении распакуйте новый архив поверх старого.'),
        h('li', {}, 'Откройте в Chrome адрес chrome://extensions и включите «Режим разработчика».'),
        h('li', {}, 'Нажмите «Загрузить распакованное расширение» и выберите папку. Если расширение уже стоит, нажмите на нём значок обновления.'),
        h('li', {}, 'Хранилище и синхронизация не пропадут: вход через Google и мастер-пароль те же.'))],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Закрыть')] });
}

// ───────────────────────── восстановление доступа ─────────────────────────
function showRecoveryKey(rk, intro) {
  const ok = h('input', { type: 'checkbox' });
  const done = h('button', { class: 'btn primary', disabled: true, onclick: () => m.close() }, 'Готово');
  ok.addEventListener('change', () => { done.disabled = !ok.checked; });
  const m = modal({ title: 'Ключ восстановления',
    body: [h('p', { class: 'lead' }, intro || 'Если забудете мастер-пароль, этот ключ поможет задать новый. Сохраните его в надёжном месте: в другом менеджере паролей, на бумаге или в личных заметках. Показывается один раз.'),
      h('div', { class: 'rkbox' }, rk.split('-').slice(0, 4).join('-') + '\n' + rk.split('-').slice(4).join('-')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => copy(rk, 'Ключ скопирован') }, icon('copy', 15), 'Копировать'),
        h('button', { class: 'btn', onclick: () => download('vaultboard-recovery-key.txt', `Vaultboard. Ключ восстановления\n${rk}\n\nХраните отдельно от мастер-пароля.\n`, 'text/plain') }, icon('download', 15), 'Скачать файлом')),
      h('label', { class: 'inline check' }, ok, 'Я сохранил ключ')],
    footer: [done] });
}

async function renewRecovery() {
  if (!(await confirmBox('Создать новый ключ восстановления? Прежний ключ перестанет работать.', 'Создать', false))) return;
  try { const r = await sync.createRecoveryKey(); S.env = r.env; showRecoveryKey(r.rk); } catch (e) { toast(describeSyncError(e), 'warn'); }
}

function openForgot() {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const m = modal({ title: 'Не помню мастер-пароль', body: [], footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена')] });
  const run = (btn, fn) => async () => {
    btn.disabled = true; msg.textContent = '';
    try { const rec = await fn(); const data = await sync.dataForKey(rec.key, rec.auth); m.close(); askNewPassword(data, rec.auth); }
    catch (e) { msg.textContent = describeSyncError(e); btn.disabled = false; }
  };
  const gbtn = h('button', { class: 'btn wide', type: 'button' }, icon('cloud', 16), 'Войти через Google');
  gbtn.onclick = run(gbtn, () => sync.recoverWithGoogle());
  const rkIn = h('input', { type: 'text', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', autocomplete: 'off', spellcheck: 'false' });
  const rbtn = h('button', { class: 'btn wide', type: 'button' }, icon('key', 16), 'Использовать ключ');
  rbtn.onclick = run(rbtn, () => { if (!rkIn.value.trim()) throw Object.assign(new Error('Введите ключ восстановления'), { code: 'X' }); return sync.recoverWithKey(rkIn.value); });
  m.box.querySelector('.mbody').append(
    h('p', { class: 'lead' }, 'Сам мастер-пароль восстановить нельзя, но можно задать новый. Записи при этом сохранятся. Нужен один из двух способов.'),
    h('div', { class: 'field' }, h('span', {}, 'Способ 1. Аккаунт Google'), h('p', { class: 'hint' }, 'Войдите той же почтой, с которой включали синхронизацию.'), gbtn),
    h('div', { class: 'field' }, h('span', {}, 'Способ 2. Ключ восстановления'), rkIn, rbtn),
    msg,
    S.env ? h('button', { class: 'link-btn', type: 'button', onclick: async () => {
      if (await confirmBox('Хранилище будет стёрто на этом устройстве. Копия в облаке (если синхронизация была включена) останется. Продолжить?', 'Стереть на этом устройстве')) { m.close(); await st.wipeAll(); S.env = null; renderSetup(); }
    } }, 'Ничего нет: стереть хранилище на этом устройстве') : null);
}

function askNewPassword(data, auth) {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const save = h('button', { class: 'btn primary', onclick: async () => {
    const p1 = $('#npw1').value, p2 = $('#npw2').value;
    if (p1.length < 8) return (msg.textContent = 'Мастер-пароль должен быть не короче 8 символов.');
    if (p1 !== p2) return (msg.textContent = 'Пароли не совпадают.');
    save.disabled = true; save.textContent = 'Сохраняю…'; msg.textContent = '';
    try {
      const r = await sync.resetPassword(data, p1, auth);
      S.env = r.env; m.close(); await enter(r.key); toast('Новый мастер-пароль задан');
      showRecoveryKey(r.rk, 'Старый ключ восстановления больше не действует. Сохраните новый.');
    } catch (e) { msg.textContent = 'Не удалось сменить пароль: ' + (e.message || e); save.disabled = false; save.textContent = 'Сохранить'; }
  } }, 'Сохранить');
  const m = modal({ title: 'Новый мастер-пароль',
    body: [h('p', { class: 'lead' }, 'Доступ подтверждён. Задайте новый мастер-пароль: им будут шифроваться записи. На других устройствах его понадобится ввести заново.'),
      pwField('Новый мастер-пароль', 'npw1', { autofocus: true, autocomplete: 'new-password' }), pwField('Повторите пароль', 'npw2', { autocomplete: 'new-password' }), msg],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), save] });
}

// ───────────────────────── настройки, импорт, экспорт ─────────────────────────
function openSettings() {
  const lockOn = h('input', { type: 'checkbox', checked: S.prefs.autolockMin > 0 });
  const lockMin = h('input', { type: 'number', min: '1', max: '1440', step: '1', class: 'num', 'aria-label': 'Минут до блокировки', value: String(S.prefs.autolockMin > 0 ? S.prefs.autolockMin : (S.prefs.autolockLast || 15)) });
  const syncLock = () => { lockMin.disabled = !lockOn.checked; lockRow.classList.toggle('off', !lockOn.checked); };
  const lockRow = h('div', { class: 'lockrow' }, lockMin, h('span', {}, 'мин'),
    ...[1, 5, 15, 30, 60, 240].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { lockMin.value = String(v); lockOn.checked = true; syncLock(); } }, v >= 60 ? v / 60 + ' ч' : v + ' мин')));
  lockOn.addEventListener('change', syncLock); syncLock();
  const lockMinutes = () => Math.min(1440, Math.max(1, Math.round(Number(lockMin.value)) || 15));
  const clip = h('select', {}, [[0, 'Не очищать'], [15, '15 секунд'], [30, '30 секунд'], [60, '1 минута']].map(([v, l]) => h('option', { value: v, selected: v === S.prefs.clipClearSec }, l)));
  const theme = h('select', {}, [['night', 'Ночь (тёмная, стекло)'], ['pearl', 'Жемчуг (светлая, цвет по пространствам)'], ['peach', 'Персик (светлая, 3D)'], ['dusk', 'Закат (тёмная)'], ['city', 'Ночной город (тёмная)'], ['forest', 'Туманный лес (тёмная)'], ['plain', 'Тёмная без картинки']].map(([v, l]) => h('option', { value: v, selected: v === (S.prefs.scene || 'night') }, l)));
  const favOn = h('input', { type: 'checkbox', checked: S.prefs.favicons !== false });
  const autoOn = h('input', { type: 'checkbox', checked: S.prefs.autofill !== false });
  const m = modal({ title: 'Настройки',
    body: [h('div', { class: 'field' }, h('label', { class: 'inline check' }, lockOn, 'Блокировать при бездействии'), lockRow),
      h('label', { class: 'field' }, h('span', {}, 'Очищать буфер после копирования пароля'), clip),
      h('label', { class: 'field' }, h('span', {}, 'Фон'), theme),
      IS_WEB ? null : h('label', { class: 'inline check' }, autoOn, 'Автоматически подставлять логин и пароль на любых сайтах из хранилища'),
      IS_WEB ? h('label', { class: 'inline check' }, favOn, 'Показывать значки сайтов (адреса запрашиваются у Google)') : null,
      IS_WEB ? null : h('button', { type: 'button', class: 'btn', onclick: openAutofillLog }, 'Проверить автозаполнение'),
      h('p', { class: 'hint' }, 'Хранилище также блокируется при закрытии браузера или вкладки.'),
      h('p', { class: 'hint' }, IS_WEB ? `Веб-версия. Актуальная версия расширения: ${EXT_VERSION}.` : `Установлена версия расширения: ${EXT_VERSION}.`)],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), h('button', { class: 'btn primary', onclick: async () => {
      let afOk = true;
      if (!IS_WEB && autoOn.checked) { // запрос разрешения должен идти прямо из клика
        try { afOk = await chrome.permissions.request({ origins: ALL_SITES }); } catch { afOk = false; }
        if (!afOk) toast('Без доступа ко всем сайтам автозаполнение при открытии не заработает', 'warn');
      }
      await st.setPrefs({ autofill: autoOn.checked, autolockMin: lockOn.checked ? lockMinutes() : 0, autolockLast: lockMinutes(), clipClearSec: Number(clip.value), scene: theme.value, favicons: favOn.checked });
      S.prefs = await st.getPrefs(); applyTheme(); renderBoard(); send({ cmd: 'touch' }); m.close(); toast('Настройки сохранены');
    } }, 'Сохранить')] });
}

async function openAutofillLog() {
  let all = false;
  try { all = await chrome.permissions.contains({ origins: ALL_SITES }); } catch { /* ignore */ }
  const { aflog = [] } = await chrome.storage.local.get('aflog');
  const logins = liveItems(S.data).filter((i) => i.type === 'login');
  const state = [
    ['Доступ ко всем сайтам', all ? 'выдан' : 'НЕ выдан (нажмите «Разрешить» на главном экране)'],
    ['Автозаполнение при открытии', S.prefs.autofill === false ? 'выключено' : 'включено'],
    ['Записей с паролем', String(logins.filter((i) => i.password).length) + ' из ' + logins.length],
    ['Версия расширения', EXT_VERSION],
  ];
  const fmt = (t) => new Date(t).toLocaleTimeString('ru-RU');
  const m = modal({ title: 'Проверка автозаполнения',
    body: [h('div', { class: 'maplist' }, ...state.map(([a, b]) => h('div', { class: 'maprow' }, h('strong', {}, a), h('p', {}, b)))),
      h('p', { class: 'hint' }, aflog.length ? 'Последние попытки (пароли здесь не показываются):' : 'Попыток пока не было. Откройте любую карточку и вернитесь сюда.'),
      ...aflog.slice().reverse().map((e) => h('div', { class: 'maprow' }, h('strong', {}, `${fmt(e.t)} · ${e.host || ''}`), h('p', {}, `${e.how}: ${e.step}`)))],
    footer: [h('button', { class: 'btn primary', onclick: () => m.close() }, 'Закрыть')] });
}

function openImport() {
  const file = h('input', { type: 'file', accept: '.csv,.html,.htm,text/csv,text/html', 'aria-label': 'Файл для импорта' });
  const info = h('div', { class: 'import-info' });
  const spaces = liveSpaces(S.data);
  const space = h('select', {}, spaces.map((s) => h('option', { value: s.id, selected: s.id === S.spaceId }, s.name)));
  const byFolder = h('input', { type: 'checkbox', checked: true });
  let rows = [];
  const go = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    const r = applyImport(rows, space.value, byFolder.checked);
    await commit(); m.close(); S.spaceId = space.value; renderAll();
    toast(`Добавлено: ${r.added}. Пропущено дубликатов: ${r.skipped}`);
  } }, 'Импортировать');
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    const text = await f.text();
    rows = /<dl|<a\s/i.test(text.slice(0, 5000)) && !/^[^<]*,/.test(text.slice(0, 200)) ? importBookmarksHtml(text) : importCsv(text);
    const logins = rows.filter((r) => r.type === 'login').length;
    const folders = new Set(rows.map((r) => r.folder).filter(Boolean));
    info.replaceChildren(rows.length
      ? h('p', {}, `Найдено записей: ${rows.length} (логинов: ${logins}, ссылок: ${rows.length - logins}). Папок: ${folders.size}.`)
      : h('p', { class: 'form-msg' }, 'В файле не нашлось подходящих записей. Подойдёт CSV с колонками name, url, username, password или файл закладок HTML.'));
    go.disabled = !rows.length;
  });
  const m = modal({ title: 'Импорт из файла',
    body: [h('p', { class: 'lead' }, 'CSV из True Key, Chrome, Bitwarden, LastPass и других менеджеров паролей либо файл закладок HTML (например, из Tabsbook). Папки станут группами. Повторяющиеся записи пропускаются.'),
      h('label', { class: 'field' }, h('span', {}, 'Файл'), file), info,
      h('label', { class: 'field' }, h('span', {}, 'Пространство'), space),
      h('label', { class: 'inline check' }, byFolder, 'Создавать группы по папкам'),
      h('p', { class: 'hint' }, 'После импорта удалите файл с паролями с компьютера: в нём они лежат открытым текстом.')],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), go] });
}

function applyImport(rows, spaceId, byFolder) {
  const key = (u, n) => (normalizeUrl(u) + '|' + n).toLowerCase();
  const existing = new Set(liveItems(S.data).filter((i) => i.url || i.username).map((i) => key(i.url, i.username)));
  const groups = new Map(liveGroups(S.data).filter((g) => g.spaceId === spaceId).map((g) => [lc(g.name), g]));
  let added = 0, skipped = 0;
  for (const r of rows) {
    const k = key(r.url, r.username);
    if ((r.url || r.username) && existing.has(k)) { skipped++; continue; }
    const gname = (byFolder && r.folder) || 'Импорт';
    let g = groups.get(lc(gname));
    if (!g) { g = makeGroup(spaceId, gname); groups.set(lc(gname), g); }
    const it = newItemFor(r.type, g.id);
    Object.assign(it, { title: r.title, url: r.url ? normalizeUrl(r.url) : '', username: r.username, password: r.password, notes: r.notes });
    S.data.items.push(it); existing.add(k); added++;
  }
  return { added, skipped };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function openExport() {
  const date = new Date().toISOString().slice(0, 10);
  const m = modal({ title: 'Экспорт и резервная копия',
    body: [
      h('div', { class: 'xrow' }, h('div', {}, h('strong', {}, 'Зашифрованная копия'), h('p', { class: 'hint' }, 'Файл .json открывается только с вашим мастер-паролем. Безопасно хранить где угодно.')),
        h('button', { class: 'btn', onclick: async () => { download(`vaultboard-backup-${date}.json`, JSON.stringify(await st.loadEnvelope()), 'application/json'); toast('Копия сохранена'); } }, icon('download', 16), 'Скачать')),
      h('div', { class: 'xrow' }, h('div', {}, h('strong', {}, 'Открытый CSV'), h('p', { class: 'hint warn' }, 'Пароли будут в файле открытым текстом. Удалите файл сразу после использования.')),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmBox('Файл будет содержать все пароли в открытом виде. Продолжить?', 'Скачать CSV', true))) return;
          const gname = (id) => S.data.groups.find((g) => g.id === id)?.name || '';
          download(`vaultboard-export-${date}.csv`, '﻿' + toCsv(liveItems(S.data), gname), 'text/csv'); toast('CSV сохранён');
        } }, icon('download', 16), 'Скачать'))],
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Закрыть')] });
}

// ───────────────────────── глобальные события ─────────────────────────
document.addEventListener('keydown', (e) => {
  if (!S.key || document.querySelector('.scrim')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); $('#q')?.focus(); $('#q')?.select(); }
});
let lastTouch = 0;
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { const n = Date.now(); if (S.key && n - lastTouch > 20000) { lastTouch = n; send({ cmd: 'touch' }); } }, true);

// 3D-наклон плиток за курсором (светлая тема)
{
  let raf = 0, cur = null, pt = null;
  const reset = (el) => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || S.drag || document.documentElement.dataset.look !== 'pearl' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = e.target.closest?.('.group, .empty, .gate-card');
    if (cur && cur !== t) reset(cur);
    cur = t; pt = e; if (!t || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0; if (!cur || !pt) return;
      const r = cur.getBoundingClientRect(), x = (pt.clientX - r.left) / r.width, y = (pt.clientY - r.top) / r.height;
      const max = Math.min(5, 1400 / Math.max(r.width, 1) * 1.2);
      cur.style.setProperty('--ry', ((x - .5) * max * 2).toFixed(2) + 'deg');
      cur.style.setProperty('--rx', ((.5 - y) * max * 1.6).toFixed(2) + 'deg');
      cur.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); cur.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    });
  }, { passive: true });
  document.addEventListener('pointerleave', () => cur && reset(cur), true);
}

// Параллакс сфер: мягко следуют за курсором с разной скоростью (дальняя медленнее) и чуть меняют масштаб
{
  const orbs = document.querySelector('.orbs');
  if (orbs && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const tick = () => {
      x += (tx - x) * 0.07; y += (ty - y) * 0.07;
      orbs.style.setProperty('--px', x.toFixed(3)); orbs.style.setProperty('--py', y.toFixed(3));
      orbs.style.setProperty('--pd', Math.min(1, Math.hypot(x, y)).toFixed(3));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
  }
}

boot();
