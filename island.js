// Макет «Остров»: парящая верхняя панель, вкладки-капсула, список групп и инспектор записи,
// командный поиск ⌘K. Живёт отдельно от остальных тем: данные и действия берёт из app.js через ctx.
import { h, icon, renderMarkdown, dropdown, setGroupSpy, wheelToX, scrollToEl, spyFocus, popMenu } from './ui.js?v=1794729315';

// цвета по пространствам: акцент, три пастельных шара (старый фон) и три сочных цвета глянцевых сфер.
// k — имя тона для 3D-фона «Тестов» (nova.js). Тон выбирается по названию пространства, иначе по порядку.
const PAL = [
  { k: 'indigo', a: '#6366f1', b: ['#c7d2fe', '#fbcfe8', '#bae6fd'], s: ['#6366f1', '#a855f7', '#38bdf8'] },
  { k: 'sapphire', a: '#2563eb', b: ['#bae6fd', '#c7f9e5', '#e0e7ff'], s: ['#2563eb', '#06b6d4', '#6366f1'] },
  { k: 'teal', a: '#059669', b: ['#bbf7d0', '#fef3c7', '#bae6fd'], s: ['#10b981', '#14b8a6', '#22d3ee'] },
  { k: 'coral', a: '#ea580c', b: ['#fde68a', '#fecaca', '#fbcfe8'], s: ['#f97316', '#f43f5e', '#f59e0b'] },
  { k: 'fuchsia', a: '#c026d3', b: ['#fbcfe8', '#ddd6fe', '#fed7aa'], s: ['#d946ef', '#8b5cf6', '#ec4899'] },
  { k: 'sky', a: '#0284c7', b: ['#ddd6fe', '#bfdbfe', '#fbcfe8'], s: ['#0ea5e9', '#6366f1', '#2dd4bf'] },
];
const BY_NAME = [[/дом|home|семь|family/i, 'coral'], [/разраб|dev|код|code|прог|сайт/i, 'sapphire'], [/каф|caf|коф|coffee|ресторан|еда/i, 'teal'], [/переб|разобр|sort|inbox|входящ/i, 'fuchsia']];
export function spaceTone(name, index) {
  for (const [re, k] of BY_NAME) if (re.test(name || '')) return PAL.find((p) => p.k === k);
  return PAL[Math.max(0, index) % PAL.length];
}
const TYPES = [['all', 'Все'], ['login', 'Логины'], ['link', 'Ссылки'], ['note', 'Заметки'], ['fav', 'Избранное']];
const lc = (s) => String(s || '').toLowerCase();
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createIsland(c) {
  const S = c.S;
  let root = null, ui = null, sel = null, groupFilter = '', shownSel = null, showPw = false;
  let prevPill = null, animateList = false, palEl = null, raf = 0;

  const spaceName = (id) => c.liveSpaces(S.data).find((s) => s.id === id)?.name || '';
  const subOf = (i) => i.type === 'login' ? i.username : i.type === 'link' ? c.hostOf(i.url)
    : ((i.notes || '').split('\n').find((l) => l.trim()) || c.fieldsOf(i).map((x) => x.name).filter(Boolean).join(' · '));

  // Esc закрывает инспектор (если не открыт поиск или другое окно)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sel || !root?.isConnected || palEl || document.querySelector('.scrim, .popmenu')) return;
    if (document.documentElement.dataset.layout !== 'island') return;
    e.preventDefault(); sel = null; render();
  });
  function mount(el) {
    root = el; sel = null; shownSel = null; prevPill = null;
    const ring = (cls, dash) => { const o = h('div', { class: 'orb ' + cls });
      o.innerHTML = `<svg viewBox="-100 -100 200 200" preserveAspectRatio="none"><ellipse rx="99" ry="99" vector-effect="non-scaling-stroke"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg><i class="ox"><i class="oy"></i></i>`;
      return o; };
    root.replaceChildren(h('div', { class: 'isl-bg', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('div', { class: 'isl-orb', 'aria-hidden': 'true' }, ring('o1'), ring('o2'), ring('o3')),
      ui = h('div', { class: 'isl-ui' }));
    root.addEventListener('pointermove', (e) => {
      if (raf || e.pointerType === 'touch') return;
      const t = e.target.closest?.('.ig, .isl-insp, .ic'); if (!t) return;
      raf = requestAnimationFrame(() => { raf = 0; const r = t.getBoundingClientRect(); t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
    }, { passive: true });
  }

  function pick(id) {
    if (id === S.spaceId) return;
    sel = null; groupFilter = ''; animateList = true;
    c.selectSpace(id);
  }
  function select(id) { sel = sel === id ? null : id; showPw = false; render(); if (sel) c.onSelect?.(); }

  // ───── верхняя панель ─────
  function syncBtn() {
    const s = S.sync || {};
    const d = s.lastSync ? new Date(s.lastSync) : null;
    const t = d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    const full = d ? d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'ещё не было';
    const state = !s.enabled ? 'off' : s.lastError ? 'error' : 'ok';
    const tip = state === 'off' ? 'Синхронизация выключена' : state === 'error' ? 'Ошибка синхронизации' : 'Синхронизировано: ' + full;
    return h('button', { class: 'isl-sync', id: 'isl-sync', dataset: { state }, title: tip, 'aria-label': tip, onclick: c.openSyncDialog }, h('i', { class: 'dot' }), h('span', {}, state === 'off' ? 'выкл.' : state === 'error' ? 'ошибка' : (t || '—')));
  }
  function refreshSync() { const b = document.getElementById('isl-sync'); if (b) b.replaceWith(syncBtn()); }

  function topBar(spaces) {
    const nav = h('nav', { class: 'isl-tabs', role: 'tablist', 'aria-label': 'Пространства' }, h('i', { class: 'isl-pill' }));
    spaces.forEach((sp, n) => {
      const on = sp.id === S.spaceId;
      const tab = h('div', { class: 'isl-tab' + (on ? ' on' : ''), role: 'tab', tabindex: '0', 'aria-selected': String(on), style: { '--c': spaceTone(sp.name, n).a },
        onclick: () => pick(sp.id), oncontextmenu: (e) => { e.preventDefault(); c.spaceMenu(tab, sp); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(sp.id); } } },
        h('i', { class: 'dotc' }), h('span', {}, sp.name),
        on ? h('button', { class: 'isl-tmore', title: 'Действия с пространством', 'aria-label': 'Действия с пространством', onclick: (e) => { e.stopPropagation(); c.spaceMenu(e.currentTarget, sp); } }, icon('more', 14)) : null);
      nav.append(tab);
    });
    nav.append(h('button', { class: 'isl-tab-add', title: 'Новое пространство', 'aria-label': 'Новое пространство', onclick: () => c.spaceDialog() }, icon('plus', 15)));
    return h('header', { class: 'isl-top' },
      h('div', { class: 'isl-left' }, h('span', { class: 'isl-mark' }, icon('lock', 15)), h('span', { class: 'isl-brand' }, 'Vaultboard'), syncBtn()),
      nav,
      h('div', { class: 'isl-right' },
        h('button', { class: 'isl-search', title: 'Поиск по всем записям (Ctrl+K)', 'aria-label': 'Поиск', onclick: openPalette }, icon('search', 15), h('span', {}, 'Поиск'), h('kbd', {}, /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K')),
        h('button', { class: 'isl-round', title: 'Облако: ваши файлы на Google Диске', 'aria-label': 'Облако', onclick: c.openCloud }, icon('folder', 16)),
        h('button', { class: 'isl-add', onclick: (e) => c.addMenu(e.currentTarget) }, icon('plus', 15), h('span', {}, 'Добавить')),
        c.fx?.() ? h('button', { class: 'isl-round', title: c.sfxOn() ? 'Выключить звуки' : 'Включить звуки', 'aria-label': 'Звуки интерфейса', 'aria-pressed': String(c.sfxOn()), onclick: c.toggleSfx }, icon(c.sfxOn() ? 'volume' : 'mute', 16)) : null,
        h('button', { class: 'isl-round', title: 'Меню: импорт, настройки', 'aria-label': 'Меню', onclick: (e) => c.mainMenu(e.currentTarget) }, icon('sliders', 16)),
        h('button', { class: 'isl-round', title: 'Заблокировать', 'aria-label': 'Заблокировать', onclick: c.lockNow }, icon('lock', 16))));
  }
  function placePill() {
    const nav = ui.querySelector('.isl-tabs'); if (!nav) return;
    const pill = nav.querySelector('.isl-pill'), on = nav.querySelector('.isl-tab.on');
    if (!on) { pill.style.opacity = '0'; return; }
    const to = { l: on.offsetLeft, w: on.offsetWidth };
    pill.style.opacity = '1';
    if (prevPill && !calm()) { pill.style.transition = 'none'; pill.style.transform = `translateX(${prevPill.l}px)`; pill.style.width = prevPill.w + 'px'; void pill.offsetWidth; pill.style.transition = ''; }
    pill.style.transform = `translateX(${to.l}px)`; pill.style.width = to.w + 'px';
    prevPill = to;
    on.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }

  // ───── карточки ─────
  function card(i, n) {
    return h('button', { type: 'button', class: 'ic' + (sel === i.id ? ' sel' : ''), dataset: { id: i.id }, style: { '--ii': String(n) }, title: 'Нажмите, чтобы посмотреть. Двойной клик: открыть сайт',
      onclick: () => select(i.id), ondblclick: () => c.activate(i) },
      c.itemIcon(i), h('span', { class: 'ic-t' }, c.cleanTitle(i.title) || c.hostOf(i.url) || '(без названия)'), h('span', { class: 'ic-s' }, subOf(i) || ''));
  }
  function groupBlock(g, list) {
    const collapsed = !!S.ui.collapsed?.[g.id];
    return h('section', { class: 'ig' + (collapsed ? ' collapsed' : ''), dataset: { id: g.id }, style: { '--c': g.color || '#6366f1' } },
      h('header', { class: 'ig-head' },
        h('button', { class: 'ig-name', 'aria-expanded': String(!collapsed), title: collapsed ? 'Развернуть' : 'Свернуть', onclick: () => c.setCollapsed([g], !collapsed) },
          h('i'), h('h3', {}, c.cleanTitle(g.name)), h('b', {}, String(list.length)), h('span', { class: 'chev' }, icon('chevron', 14))),
        h('button', { class: 'ig-btn', title: 'Добавить запись в группу', 'aria-label': 'Добавить запись в группу', onclick: (e) => c.addMenu(e.currentTarget, g.id) }, icon('plus', 15)),
        h('button', { class: 'ig-btn', title: 'Действия с группой', 'aria-label': 'Действия с группой', onclick: (e) => c.groupMenu(e.currentTarget, g) }, icon('more', 15))),
      collapsed ? null : h('div', { class: 'ig-grid' }, list.length ? list.map(card) : h('div', { class: 'ig-empty' }, 'Здесь пока пусто')));
  }

  // ───── инспектор ─────
  function field(label, value, { secret = false, link = false, copyMsg, copySecret } = {}) {
    const text = h('span', { class: 'if-text' + (secret ? ' mono' : '') }, secret ? '••••••••••' : value);
    const acts = [];
    if (secret) {
      const eye = h('button', { type: 'button', class: 'if-btn', title: 'Показать пароль', 'aria-label': 'Показать или скрыть пароль' }, icon('eye', 16));
      let shown = showPw; const paint = () => { text.textContent = shown ? value : '••••••••••'; eye.classList.toggle('on', shown); eye.title = shown ? 'Скрыть пароль' : 'Показать пароль'; }; paint();
      eye.onclick = () => { shown = !shown; showPw = shown; paint(); };
      acts.push(eye);
    }
    acts.push(c.tipBtn('if-btn', 'copy', 'Копировать', () => c.copy(value, copyMsg || 'Скопировано', copySecret), 16));
    const val = link ? h('a', { class: 'if-text if-link', href: c.normalizeUrl(value) || '#', onclick: (e) => { e.preventDefault(); c.openSite(value); }, title: value }, value) : text;
    return h('div', { class: 'if' }, h('label', {}, label), h('div', { class: 'if-v' }, val, h('span', { class: 'if-acts' }, acts)));
  }
  function inspector(spaceItems) {
    const i = sel && S.data.items.find((x) => x.id === sel && !x.deleted);
    if (!i) { sel = null; return welcome(spaceItems); }
    const g = S.data.groups.find((x) => x.id === i.groupId);
    const flds = c.fieldsOf(i);
    return h('div', { class: 'insp-in' },
      h('div', { class: 'insp-head' },
        h('span', { class: 'insp-ico' }, c.itemIcon(i)),
        h('div', { class: 'insp-ht' }, h('h2', {}, c.cleanTitle(i.title) || c.hostOf(i.url) || '(без названия)'),
          h('div', { class: 'insp-badges' },
            g ? h('span', { class: 'badge', style: { '--c': g.color || '#6366f1' } }, h('i'), c.cleanTitle(g.name)) : null,
            h('span', { class: 'badge soft' }, spaceName(g?.spaceId)), h('span', { class: 'badge soft' }, ({ login: 'Логин', link: 'Ссылка', note: 'Заметка' })[i.type]))),
        h('button', { class: 'if-btn insp-close', title: 'Закрыть (Esc)', 'aria-label': 'Закрыть', onclick: () => { sel = null; render(); } }, icon('x', 16))),
      i.type === 'login' && i.username ? field('Логин', i.username, { copyMsg: 'Логин скопирован' }) : null,
      i.type === 'login' && i.password ? field('Пароль', i.password, { secret: true, copyMsg: 'Пароль скопирован', copySecret: true }) : null,
      i.url ? field('Адрес сайта', i.url, { link: true, copyMsg: 'Адрес скопирован' }) : null,
      ...flds.map((x) => field(x.name || 'Поле', x.value, { copyMsg: (x.name || 'Поле') + ': скопировано', copySecret: true })),
      (i.tags || []).length ? h('div', { class: 'if' }, h('label', {}, 'Теги'), h('div', { class: 'insp-tags' }, i.tags.map((t) => h('span', { class: 'badge soft' }, '#' + t)))) : null,
      i.notes ? h('div', { class: 'if' }, h('label', {}, i.type === 'note' ? 'Текст' : 'Заметка'), h('div', { class: 'insp-note' }, i.type === 'note' ? renderMarkdown(i.notes) : i.notes)) : null,
      h('div', { class: 'insp-foot' },
        i.type !== 'note' && i.url ? h('button', { class: 'isl-add', onclick: () => c.activate(i) }, icon('open', 15), i.type === 'login' ? 'Открыть и войти' : 'Открыть') : null,
        h('button', { class: 'isl-btn', onclick: () => c.openItemEditor(i, false) }, icon('edit', 15), 'Редактировать'),
        h('button', { class: 'isl-round' + (i.favorite ? ' fav-on' : ''), title: i.favorite ? 'Убрать из избранного' : 'В избранное', 'aria-label': 'Избранное', onclick: () => c.toggleFav(i) }, icon('star', 16))));
  }
  function welcome(spaceItems) {
    const n = { login: 0, link: 0, note: 0 }; for (const i of spaceItems) n[i.type]++;
    const sp = spaceName(S.spaceId);
    return h('div', { class: 'insp-in welcome' },
      h('div', { class: 'wel-art', 'aria-hidden': 'true' }, h('i'), h('i')),
      h('h2', {}, sp || 'Пространство'),
      h('p', { class: 'wel-sub' }, spaceItems.length ? 'Выберите запись слева: здесь появятся логин, пароль и быстрые кнопки копирования.' : 'Здесь пока пусто. Добавьте первую запись или импортируйте закладки и пароли.'),
      h('div', { class: 'wel-stats' }, [['Логины', n.login, 'key'], ['Ссылки', n.link, 'link'], ['Заметки', n.note, 'note']].map(([l, v, ic]) => h('div', { class: 'wel-stat' }, icon(ic, 16), h('b', {}, String(v)), h('span', {}, l)))),
      h('div', { class: 'insp-foot' },
        h('button', { class: 'isl-add', onclick: (e) => c.addMenu(e.currentTarget) }, icon('plus', 15), 'Новая запись'),
        h('button', { class: 'isl-btn', onclick: () => c.groupDialog() }, icon('plus', 15), 'Новая группа')));
  }

  // ───── сборка ─────
  function render() {
    if (!root || !ui || !S.data) return;
    const spaces = c.liveSpaces(S.data);
    if (!spaces.length) return;
    const si = Math.max(0, spaces.findIndex((s) => s.id === S.spaceId));
    const pal = spaceTone(spaces[si]?.name, si);
    root.style.setProperty('--a', pal.a); pal.b.forEach((v, k) => root.style.setProperty('--b' + (k + 1), v)); pal.s.forEach((v, k) => root.style.setProperty('--s' + (k + 1), v));

    const spaceItems = c.itemsInSpace(S.spaceId);
    if (sel && !spaceItems.some((x) => x.id === sel)) sel = null;
    const groups = c.liveGroups(S.data).filter((g) => g.spaceId === S.spaceId).sort((a, b) => a.order - b.order);
    if (groupFilter && !groups.some((g) => g.id === groupFilter)) groupFilter = '';
    const count = { all: spaceItems.length, login: 0, link: 0, note: 0, fav: 0 };
    for (const i of spaceItems) { count[i.type]++; if (i.favorite) count.fav++; }

    const seg = h('div', { class: 'isl-seg', role: 'tablist', 'aria-label': 'Категории' }, TYPES.map(([v, l]) =>
      h('button', { class: S.type === v ? 'on' : '', role: 'tab', 'aria-selected': String(S.type === v), onclick: () => { S.type = v; render(); } }, l, h('b', {}, String(count[v])))));
    const allCollapsed = groups.length > 0 && groups.every((g) => S.ui.collapsed?.[g.id]);
    const gdd = groups.length > 1 ? dropdown([['', 'Все группы'], ...groups.map((g) => [g.id, c.cleanTitle(g.name)])], groupFilter, (v) => { groupFilter = v; render(); }) : null;
    gdd?.classList.add('isl-dd');
    const sub = h('div', { class: 'isl-sub' }, seg, h('div', { class: 'isl-sub-r' }, gdd,
      groups.length ? h('button', { class: 'isl-btn sm', title: allCollapsed ? 'Развернуть все группы' : 'Свернуть все группы', onclick: () => c.setCollapsed(groups, !allCollapsed) }, icon('chevron', 14), allCollapsed ? 'Развернуть все' : 'Свернуть все') : null));

    const blocks = [], shownGroups = [];
    for (const g of groups) {
      if (groupFilter && g.id !== groupFilter) continue;
      const list = spaceItems.filter((i) => i.groupId === g.id && (S.type === 'all' || (S.type === 'fav' ? i.favorite : i.type === S.type))).sort((a, b) => a.order - b.order);
      if (S.type !== 'all' && !list.length) continue;
      blocks.push(groupBlock(g, list)); shownGroups.push([g, list.length]);
    }
    // закреплённая строка групп: клик — прокрутка к группе, подсвечена та, что на экране
    const chips = shownGroups.length >= 2 ? wheelToX(h('div', { class: 'isl-gchips', role: 'navigation', 'aria-label': 'Перейти к группе' }, shownGroups.map(([g, n]) =>
      h('button', { class: 'isl-gchip', dataset: { gid: g.id }, style: { '--c': g.color || '#6366f1' }, title: 'Перейти к группе «' + c.cleanTitle(g.name) + '»', onclick: () => jump(g) },
        h('i'), h('span', {}, c.cleanTitle(g.name)), h('b', {}, String(n)))))) : null;
    const allBtn = chips ? h('button', { class: 'isl-gall', title: 'Список всех групп', 'aria-haspopup': 'menu',
      onclick: (e) => popMenu(e.currentTarget, shownGroups.map(([g, n]) => ({ label: `${c.cleanTitle(g.name)} · ${n}`, icon: 'folder', onClick: () => jump(g) }))) },
      'Все ' + shownGroups.length, icon('chevron', 13)) : null;
    const list = h('div', { class: 'isl-list' + (animateList ? ' enter' : '') }, chips ? h('div', { class: 'isl-gnav' }, chips, allBtn) : null, blocks.length ? blocks : h('div', { class: 'isl-none' }, groups.length ? 'Нет записей с такими фильтрами' : 'В этом пространстве пока нет групп'),
      h('button', { class: 'ig-add', onclick: () => c.groupDialog() }, icon('plus', 15), 'Новая группа'));
    animateList = false;
    const opening = sel && !shownSel;
    const insp = sel ? h('aside', { class: 'isl-insp' + (shownSel !== sel ? ' enter' : '') + (opening ? ' slide' : ''), 'aria-label': 'Запись' }, inspector(spaceItems)) : null;
    shownSel = sel;
    const y = scrollY;
    ui.replaceChildren(topBar(spaces), sub, h('div', { class: 'isl-work' + (sel ? ' has-sel' : ''), onclick: (e) => { if (e.target === e.currentTarget && sel && matchMedia('(max-width: 980px)').matches) { sel = null; render(); } } }, list, insp));
    scrollTo(0, y);
    placePill();
    if (chips) setGroupSpy(chips, '#island .ig', () => chips.getBoundingClientRect().bottom + 10); else setGroupSpy(null);
  }

  function jump(g) {
    const go = () => {
      const el = ui.querySelector(`.ig[data-id="${CSS.escape(g.id)}"]`), nav = ui.querySelector('.isl-gnav'); if (!el) return;
      scrollToEl(el, (nav ? nav.offsetHeight : 0) + 24);
      spyFocus(g.id);
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
    };
    if (S.ui.collapsed?.[g.id]) { c.setCollapsed([g], false); requestAnimationFrame(() => requestAnimationFrame(go)); } else go();
  }

  // ───── командный поиск ─────
  function closePalette() { palEl?.remove(); palEl = null; document.removeEventListener('keydown', palKeys, true); }
  let palKeys = () => {};
  function openPalette() {
    if (palEl) return closePalette();
    if (!S.data) return;
    const spaces = c.liveSpaces(S.data), spaceMap = new Map(spaces.map((s) => [s.id, s]));
    const groupMap = new Map(c.liveGroups(S.data).map((g) => [g.id, g]));
    const all = c.liveItems(S.data).map((i) => { const g = groupMap.get(i.groupId), sp = g && spaceMap.get(g.spaceId); return g && sp ? { i, g, sp } : null; }).filter(Boolean);
    let results = [], idx = 0;
    const input = h('input', { class: 'pal-in', type: 'text', placeholder: 'Поиск по всем пространствам, группам, названиям, логинам и адресам', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Поиск' });
    const list = h('div', { class: 'pal-list', role: 'listbox' });
    const compute = () => {
      const terms = lc(input.value).split(/\s+/).filter(Boolean);
      if (!terms.length) { results = all.filter((r) => r.sp.id === S.spaceId).slice(0, 8); return; }
      const scored = [];
      for (const r of all) {
        const title = lc(c.cleanTitle(r.i.title)), hay = lc([title, r.i.url, r.i.username, r.sp.name, r.g.name, (r.i.tags || []).join(' '), r.i.notes].join(' '));
        if (!terms.every((t) => hay.includes(t))) continue;
        let s = 0; for (const t of terms) s += title.startsWith(t) ? 3 : title.includes(t) ? 2 : 1;
        scored.push([s, r]);
      }
      results = scored.sort((a, b) => b[0] - a[0]).slice(0, 40).map((x) => x[1]);
    };
    const paint = () => {
      compute(); idx = Math.min(idx, Math.max(0, results.length - 1));
      list.replaceChildren(...(results.length ? [
        h('div', { class: 'pal-cap' }, input.value.trim() ? `Найдено: ${results.length}` : 'В этом пространстве'),
        ...results.map((r, n) => h('div', { class: 'pal-row' + (n === idx ? ' hi' : ''), role: 'option', dataset: { n: String(n) }, onclick: () => choose(r), onpointermove: () => { if (idx !== n) { idx = n; mark(); } } },
          c.itemIcon(r.i),
          h('div', { class: 'pal-t' }, h('b', {}, c.cleanTitle(r.i.title) || c.hostOf(r.i.url) || '(без названия)'), h('span', {}, `${r.sp.name} • ${c.cleanTitle(r.g.name)}`)),
          h('div', { class: 'pal-acts' },
            r.i.type === 'login' && r.i.username ? c.tipBtn('if-btn', 'user', 'Копировать логин', () => c.copy(r.i.username, 'Логин скопирован'), 16) : null,
            r.i.type === 'login' && r.i.password ? c.tipBtn('if-btn', 'key', 'Копировать пароль', () => c.copy(r.i.password, 'Пароль скопирован', true), 16) : null)))
      ] : [h('div', { class: 'pal-none' }, 'Ничего не найдено. Проверьте написание.')]));
    };
    const mark = () => [...list.querySelectorAll('.pal-row')].forEach((el, n) => { el.classList.toggle('hi', n === idx); if (n === idx) el.scrollIntoView({ block: 'nearest' }); });
    async function choose(r) {
      closePalette();
      if (r.sp.id !== S.spaceId) { S.spaceId = r.sp.id; S.ui.lastSpace = r.sp.id; c.setUi({ lastSpace: r.sp.id }); }
      c.onSelect && requestAnimationFrame(() => requestAnimationFrame(() => c.onSelect()));
      sel = r.i.id; shownSel = null; groupFilter = ''; S.type = 'all'; showPw = false; animateList = true;
      if (S.ui.collapsed?.[r.g.id]) c.setCollapsed([r.g], false); else c.renderAllNow();
      requestAnimationFrame(() => { const el = ui.querySelector(`.ic[data-id="${CSS.escape(r.i.id)}"]`); if (el) { el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); } });
    }
    palKeys = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(results.length - 1, idx + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (results[idx]) choose(results[idx]); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); closePalette(); }
    };
    input.addEventListener('input', () => { idx = 0; paint(); });
    palEl = h('div', { class: 'isl-scrim', onpointerdown: (e) => { if (e.target === palEl) closePalette(); } },
      h('div', { class: 'pal', role: 'dialog', 'aria-label': 'Командный поиск' },
        h('div', { class: 'pal-top' }, icon('search', 18), input, h('kbd', {}, 'Esc')), list,
        h('div', { class: 'pal-foot' }, h('span', {}, h('kbd', {}, '↑↓'), ' выбор'), h('span', {}, h('kbd', {}, 'Enter'), ' открыть'), h('span', {}, h('kbd', {}, 'Esc'), ' закрыть'))));
    document.body.append(palEl); document.addEventListener('keydown', palKeys, true); c.onPalette?.();
    paint(); input.focus();
  }

  addEventListener('resize', () => { if (ui) { prevPill = null; placePill(); } });
  return { mount, render, refreshSync, openPalette, closePalette, isOpen: () => !!palEl };
}
