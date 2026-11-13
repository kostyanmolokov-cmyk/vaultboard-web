// Импорт: CSV (True Key, Chrome, Bitwarden, LastPass и т.п.) и закладки HTML (Tabsbook, Chrome, Firefox).
// Не зависит от DOM, поэтому проверяется в Node.

export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const pick = (header, names) => header.findIndex((h) => names.includes(h));

export function importCsv(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iTitle = pick(header, ['name', 'title', 'site', 'label', 'account']);
  const iUrl = pick(header, ['url', 'website', 'login_uri', 'web site', 'link', 'address']);
  const iUser = pick(header, ['username', 'login', 'login_username', 'user', 'email', 'user name', 'login name']);
  const iPass = pick(header, ['password', 'login_password', 'pass']);
  const iNote = pick(header, ['note', 'notes', 'extra', 'comment', 'comments']);
  const iFolder = pick(header, ['folder', 'grouping', 'group', 'category']);
  const out = [];
  for (const r of rows.slice(1)) {
    const g = (i) => (i >= 0 && r[i] != null ? r[i].trim() : '');
    const url = g(iUrl);
    const title = g(iTitle) || url.replace(/^https?:\/\//, '').split('/')[0];
    const username = g(iUser);
    const password = g(iPass);
    if (!title && !url && !username && !password) continue;
    out.push({ type: password || username ? 'login' : 'link', title, url, username, password, notes: g(iNote), folder: g(iFolder) });
  }
  return out;
}

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

// Закладки в формате Netscape: папки <H3> -> группы, ссылки <A> -> элементы
export function importBookmarksHtml(html) {
  const out = [];
  const stack = []; // имена папок
  let pending = null;
  const re = /<(\/?)(h3|a|dl)\b([^>]*)>([\s\S]*?)(?=<)/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, attrs, text] = m;
    const t = tag.toLowerCase();
    if (t === 'h3' && !close) pending = decodeEntities(text.trim());
    else if (t === 'dl' && !close) { stack.push(pending); pending = null; }
    else if (t === 'dl' && close) stack.pop();
    else if (t === 'a' && !close) {
      const href = (attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1];
      if (!href || /^(javascript|place):/i.test(href)) continue;
      const folders = stack.filter(Boolean);
      out.push({
        type: 'link',
        title: decodeEntities(text.trim()) || href,
        url: decodeEntities(href),
        username: '', password: '', notes: '',
        folder: folders.length ? folders[folders.length - 1] : '',
      });
    }
  }
  return out;
}

export function toCsv(items, groupName = () => '') {
  const esc = (v) => {
    v = v == null ? '' : String(v);
    return /[",\r\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const head = ['folder', 'type', 'name', 'url', 'username', 'password', 'notes', 'tags'];
  const lines = [head.join(',')];
  for (const i of items) lines.push([groupName(i.groupId), i.type, i.title, i.url, i.username, i.password, i.notes, (i.tags || []).join(' ')].map(esc).join(','));
  return lines.join('\r\n');
}
