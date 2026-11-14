// Мелкие помощники интерфейса: создание DOM, иконки, окна, уведомления, Markdown без innerHTML.
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') { for (const [a, b] of Object.entries(v)) a.startsWith('--') ? el.style.setProperty(a, b) : (el.style[a] = b); }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected', 'draggable', 'readOnly'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  sync: '<path d="M4 12a8 8 0 0113.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 01-13.7 5.6L4 16M4 20v-4h4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.7M20 4v5h-5"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5.2 5.2 0 019.8-1A4.6 4.6 0 0117 18z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  sliders: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  volume: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  mute: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
};

// Свой выпадающий список вместо встроенного <select>: везде выглядит одинаково, стрелка одна.
export function dropdown(options, value, onChange) {
  let cur = String(value);
  const label = h('span', { class: 'dd-label' });
  const btn = h('button', { type: 'button', class: 'dd-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, label, h('span', { class: 'dd-chev', 'aria-hidden': 'true' }, icon('chevron', 14)));
  const root = h('div', { class: 'dd' }, btn);
  const text = (v) => (options.find(([o]) => String(o) === String(v)) || [0, ''])[1];
  const sync = () => { label.textContent = text(cur); };
  sync();
  let list = null, idx = 0;
  const close = () => {
    if (!list) return;
    list.remove(); list = null; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keys, true);
    removeEventListener('resize', close); removeEventListener('scroll', close, true);
  };
  const choose = (v) => { cur = String(v); sync(); close(); btn.focus(); onChange && onChange(cur); };
  const outside = (e) => { if (list && !list.contains(e.target) && !root.contains(e.target)) close(); };
  const mark = () => { [...list.children].forEach((el, i) => { el.classList.toggle('hi', i === idx); if (i === idx) el.scrollIntoView({ block: 'nearest' }); }); };
  const keys = (e) => {
    if (!list) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(options.length - 1, idx + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); mark(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); choose(options[idx][0]); }
  };
  const open = () => {
    if (list) return close();
    idx = Math.max(0, options.findIndex(([o]) => String(o) === cur));
    list = h('div', { class: 'dd-list', role: 'listbox' }, options.map(([v, l], i) =>
      h('div', { class: 'dd-opt' + (String(v) === cur ? ' on' : ''), role: 'option', 'aria-selected': String(String(v) === cur), onpointerdown: (e) => { e.preventDefault(); choose(v); }, onpointerenter: () => { idx = i; mark(); } }, l)));
    const r = btn.getBoundingClientRect();
    Object.assign(list.style, { left: r.left + 'px', width: r.width + 'px', top: (r.bottom + 6) + 'px' });
    document.body.append(list);
    const maxH = Math.max(140, innerHeight - r.bottom - 16);
    list.style.maxHeight = Math.min(maxH, 320) + 'px';
    if (list.scrollHeight > maxH && r.top > innerHeight / 2) { list.style.top = 'auto'; list.style.bottom = (innerHeight - r.top + 6) + 'px'; list.style.maxHeight = Math.min(r.top - 16, 320) + 'px'; }
    btn.setAttribute('aria-expanded', 'true'); mark();
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true);
    addEventListener('resize', close); addEventListener('scroll', close, true);
  };
  btn.addEventListener('click', open);
  btn.addEventListener('keydown', (e) => { if (!list && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); open(); } });
  Object.defineProperty(root, 'value', { get: () => cur, set: (v) => { cur = String(v); sync(); } });
  return root;
}

export function icon(name, size = 18) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ''; // статические строки выше, не пользовательские данные
  return s;
}

// ───────── уведомления ─────────
export function toast(msg, kind = '') {
  const el = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// ───────── окна ─────────
export function modal({ title, body, footer, wide = false, onClose }) {
  const scrim = h('div', { class: 'scrim' });
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose(v);
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const all = document.querySelectorAll('.scrim');
    if (all[all.length - 1] !== scrim) return;
    e.stopPropagation();
    close();
  };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'mhead' }, h('h2', {}, title), h('button', { class: 'icon-btn', title: 'Закрыть', 'aria-label': 'Закрыть', onclick: () => close() }, icon('x'))),
    h('div', { class: 'mbody' }, body),
    footer ? h('div', { class: 'mfoot' }, footer) : null);
  scrim.append(box);
  document.body.append(scrim);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('input:not([type=checkbox]),textarea,select'))?.focus(), 0);
  return { close, box };
}

export function confirmBox(text, okLabel = 'Удалить', danger = true) {
  return new Promise((resolve) => {
    let m;
    const done = (v) => { resolve(v); m.close(); };
    m = modal({
      title: 'Подтвердите',
      body: h('p', { class: 'confirm-text' }, text),
      footer: [
        h('button', { class: 'btn', onclick: () => done(false) }, 'Отмена'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), autofocus: true, onclick: () => done(true) }, okLabel),
      ],
      onClose: () => resolve(false),
    });
  });
}

// Всплывающее меню у элемента
export function popMenu(anchor, entries) {
  document.querySelectorAll('.popmenu').forEach((n) => n.remove());
  const menu = h('div', { class: 'popmenu', role: 'menu' });
  const closeAll = () => { menu.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  const away = (e) => { if (!menu.contains(e.target)) closeAll(); };
  const esc = (e) => { if (e.key === 'Escape') closeAll(); };
  for (const e of entries) {
    if (e === '-') { menu.append(h('div', { class: 'pm-sep' })); continue; }
    menu.append(h('button', { class: 'pm-item' + (e.danger ? ' danger' : ''), role: 'menuitem', onclick: () => { closeAll(); e.onClick(); } },
      e.icon ? icon(e.icon, 16) : h('span', { class: 'pm-gap' }), e.label));
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, hgt = menu.offsetHeight;
  let x = Math.min(r.left, window.innerWidth - w - 8);
  let y = r.bottom + 4;
  if (y + hgt > window.innerHeight - 8) y = Math.max(8, r.top - hgt - 4);
  menu.style.left = Math.max(8, x) + 'px';
  menu.style.top = y + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true); }, 0);
  menu.querySelector('button')?.focus();
  return closeAll;
}

// ───────── Markdown (безопасно, через DOM) ─────────
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : null);
const anchor = (text, href) => {
  const u = safeUrl(href);
  return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, text) : document.createTextNode(text);
};

function inline(text) {
  const frag = document.createDocumentFragment();
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1]) frag.append(h('code', {}, m[1].slice(1, -1)));
    else if (m[2]) frag.append(h('strong', {}, m[2].slice(2, -2)));
    else if (m[3]) frag.append(h('em', {}, m[3].slice(1, -1)));
    else if (m[4]) { const mm = m[4].match(/\[([^\]]+)\]\(([^)]+)\)/); frag.append(anchor(mm[1], mm[2])); }
    else frag.append(anchor(m[5], m[5]));
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export function renderMarkdown(src) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let list = null, listType = null, para = [], code = null;
  const flushPara = () => { if (para.length) { root.append(h('p', {}, inline(para.join(' ')))); para = []; } };
  const flushList = () => { list = null; listType = null; };
  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) { root.append(h('pre', {}, h('code', {}, code.join('\n')))); code = null; }
      else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); flushList(); root.append(h('h' + (m[1].length + 2), {}, inline(m[2]))); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara();
      if (listType !== 'ul') { list = h('ul'); root.append(list); listType = 'ul'; }
      list.append(h('li', {}, inline(m[1]))); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (listType !== 'ol') { list = h('ol'); root.append(list); listType = 'ol'; }
      list.append(h('li', {}, inline(m[1]))); continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); root.append(h('blockquote', {}, inline(m[1]))); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  if (code) root.append(h('pre', {}, h('code', {}, code.join('\n'))));
  flushPara();
  return root;
}

// ───────── плитка с иконкой для пустых состояний ─────────
export function vaultArt(size = 56) {
  const w = document.createElement('div');
  w.className = 'vault-art';
  w.setAttribute('aria-hidden', 'true');
  w.append(icon('lock', Math.round(size / 2.6)));
  const o = document.createElementNS(SVG_NS, 'svg'); o.setAttribute('viewBox', '0 0 200 200'); o.setAttribute('class', 'orb3d');
  o.innerHTML = ORB;
  w.append(o);
  return w;
}

const ORB = `<defs>
<radialGradient id="ob-s" cx=".34" cy=".26" r=".95"><stop offset="0" stop-color="#fff"/><stop offset=".12" style="stop-color:color-mix(in srgb, var(--p-o1l) 22%, #fff)"/><stop offset=".4" style="stop-color:var(--p-o1l)"/><stop offset=".78" style="stop-color:var(--p-o1m)"/><stop offset="1" style="stop-color:var(--p-o1d)"/></radialGradient>
<linearGradient id="ob-r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--p-o2l)"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" style="stop-color:var(--p-o3l)"/></linearGradient>
<radialGradient id="ob-h" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="ob-k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:color-mix(in srgb, var(--p-o1d) 62%, #000)"/><stop offset="1" style="stop-color:color-mix(in srgb, var(--p-o1d) 36%, #000)"/></linearGradient>
<clipPath id="ob-front"><rect x="0" y="108" width="200" height="100"/></clipPath>
<filter id="ob-bl"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>
<ellipse cx="100" cy="176" rx="52" ry="8" style="fill:var(--p-o1d)" opacity=".28" filter="url(#ob-bl)"/>
<ellipse cx="100" cy="104" rx="88" ry="24" transform="rotate(-16 100 104)" fill="none" stroke="url(#ob-r)" stroke-width="8" opacity=".95"/>
<circle cx="100" cy="98" r="58" fill="url(#ob-s)"/>
<circle cx="100" cy="98" r="58" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>
<ellipse cx="78" cy="68" rx="24" ry="14" transform="rotate(-32 78 68)" fill="url(#ob-h)"/>
<path d="M146 126a58 58 0 0 1-70 28" fill="none" style="stroke:var(--p-o2l)" stroke-opacity=".6" stroke-width="5" stroke-linecap="round" filter="url(#ob-bl)"/>
<g clip-path="url(#ob-front)"><ellipse cx="100" cy="104" rx="88" ry="24" transform="rotate(-16 100 104)" fill="none" stroke="url(#ob-r)" stroke-width="8"/></g>
<g transform="translate(100 100)"><circle cx="0" cy="-5" r="10" fill="url(#ob-k)"/><path d="M-4.5 2h9l3 19h-15z" fill="url(#ob-k)"/>
<circle cx="-3" cy="-8" r="3" fill="#fff" opacity=".25"/><path d="M-9 -12a10 10 0 0 1 12-4" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/></g>`;
