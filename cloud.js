// Окно «Облако»: личные файлы на Google Диске, зашифрованные ключом хранилища.
import { h, icon, modal, toast, confirmBox, popMenu } from './ui.js?v=1794727718';
import * as drive from './lib/drive.js?v=1794727718';

const KB = 1024, MB = KB * 1024, GB = MB * 1024;
export const fmtSize = (n) => n >= GB ? (n / GB).toFixed(2) + ' ГБ' : n >= MB ? (n / MB).toFixed(n >= 100 * MB ? 0 : 1) + ' МБ' : n >= KB ? Math.round(n / KB) + ' КБ' : n + ' Б';
const fmtDate = (t) => t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const extOf = (n) => (String(n).match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toLowerCase();
const KIND = [
  [/^(pdf)$/, 'pdf', '#ef4444'], [/^(docx?|odt|rtf|txt|md)$/, 'doc', '#3b82f6'], [/^(xlsx?|ods|csv)$/, 'xls', '#10b981'],
  [/^(pptx?|odp|key)$/, 'ppt', '#f97316'], [/^(zip|rar|7z|tar|gz|bz2|xz)$/, 'zip', '#a855f7'], [/^(exe|msi|apk|dmg|pkg|deb|appimage|bat|cmd|ps1|sh|jar)$/, 'app', '#0ea5e9'],
  [/^(png|jpe?g|gif|webp|svg|heic|bmp|ico)$/, 'img', '#ec4899'], [/^(mp4|mov|avi|mkv|webm)$/, 'vid', '#f43f5e'], [/^(mp3|wav|flac|ogg|m4a)$/, 'aud', '#eab308'],
];
const kindOf = (name) => { const e = extOf(name); for (const [re, k, c] of KIND) if (re.test(e)) return { k, c, e }; return { k: 'file', c: '#64748b', e }; };

export function openCloud(ctx) {
  let files = null, folder = '', q = '', busy = false, extraFolders = new Set();
  const queue = []; // { name, size, p, ctrl, state, error }
  const body = h('div', { class: 'cl' });
  const m = modal({ title: 'Облако', body, wide: true, onClose: () => { for (const u of queue) if (u.state === 'up') u.ctrl.abort(); } });
  m.box.classList.add('cl-modal');

  const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { addFiles([...input.files]); input.value = ''; } });

  // перетаскивание файлов в окно
  let dragN = 0;
  m.box.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types?.includes('Files') || !files) return; e.preventDefault(); dragN++; m.box.classList.add('cl-drag'); });
  m.box.addEventListener('dragover', (e) => { if (files && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  m.box.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; m.box.classList.remove('cl-drag'); } });
  m.box.addEventListener('drop', (e) => { if (!files) return; e.preventDefault(); dragN = 0; m.box.classList.remove('cl-drag'); addFiles([...(e.dataTransfer?.files || [])]); });

  async function key() { return ctx.cloudKey(); }

  async function connect(interactive) {
    busy = true; paint();
    try {
      await drive.driveToken(interactive);
      files = await drive.listFiles(await key());
    } catch (e) {
      files = null;
      if (interactive || e.code !== 'DRIVE_AUTH') toast(e.code === 'DRIVE_OFF' ? 'Google Drive API ещё не включён в проекте. Напишите мне, я включу.' : e.message, 'err');
    }
    busy = false; paint();
  }

  function addFiles(list) {
    for (const f of list) {
      if (f.size > drive.MAX_FILE) { toast(`«${f.name}» больше 1 ГБ, такие файлы не поддерживаются`, 'err'); continue; }
      queue.push({ file: f, name: f.name, size: f.size, p: 0, ctrl: new AbortController(), state: 'wait', folder });
    }
    paint(); pump();
  }
  let pumping = false;
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      let u;
      while ((u = queue.find((x) => x.state === 'wait'))) {
        u.state = 'up'; paint();
        try {
          const rec = await drive.uploadFile(await key(), u.file, u.folder, (p) => { u.p = p; paintQueue(); }, u.ctrl.signal);
          files = [rec, ...(files || [])]; u.state = 'done'; delete u.file;
          ctx.sound?.('ok');
        } catch (e) {
          u.state = e.code === 'ABORT' ? 'cancel' : 'error'; u.error = e.message; delete u.file;
          if (e.code !== 'ABORT') toast(`«${u.name}»: ${e.message}`, 'err');
        }
        paint();
      }
    } finally { pumping = false; }
    setTimeout(() => { for (let i = queue.length - 1; i >= 0; i--) if (queue[i].state === 'done') queue.splice(i, 1); paint(); }, 2500);
  }

  async function download(f, row) {
    const bar = row?.querySelector('.cl-rp');
    row?.classList.add('busy');
    try {
      const blob = await drive.downloadFile(await key(), f, (p) => { if (bar) bar.style.width = Math.round(p * 100) + '%'; });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: f.name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast(e.message, 'err'); }
    row?.classList.remove('busy'); if (bar) bar.style.width = '0';
  }

  function askText(title, value, okLabel) {
    return new Promise((res) => {
      const inp = h('input', { type: 'text', value: value || '', autofocus: true, maxlength: 200 });
      let done = false;
      const fin = (v) => { if (done) return; done = true; res(v); mm.close(); };
      const mm = modal({ title, body: h('form', { onsubmit: (e) => { e.preventDefault(); fin(inp.value.trim()); } }, h('label', { class: 'field' }, inp)),
        footer: [h('button', { class: 'btn', onclick: () => fin(null) }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => fin(inp.value.trim()) }, okLabel)],
        onClose: () => fin(null) });
      setTimeout(() => { const d = inp.value.lastIndexOf('.'); inp.setSelectionRange(0, d > 0 ? d : inp.value.length); }, 30);
    });
  }
  async function rename(f) {
    const v = await askText('Переименовать файл', f.name, 'Сохранить'); if (!v || v === f.name) return;
    try { const n = await drive.updateMeta(await key(), f, { name: v }); files = files.map((x) => x.id === f.id ? n : x); paint(); } catch (e) { toast(e.message, 'err'); }
  }
  async function move(f, anchor) {
    const names = folders().filter((x) => x !== (f.folder || ''));
    const go = async (to) => { try { const n = await drive.updateMeta(await key(), f, { folder: to }); files = files.map((x) => x.id === f.id ? n : x); paint(); toast(to ? `Перемещено в «${to}»` : 'Перемещено в корень'); } catch (e) { toast(e.message, 'err'); } };
    popMenu(anchor, [
      ...(f.folder ? [{ label: 'Без папки', icon: 'folder', onClick: () => go('') }] : []),
      ...names.filter(Boolean).map((n) => ({ label: n, icon: 'folder', onClick: () => go(n) })),
      '-', { label: 'Новая папка…', icon: 'plus', onClick: async () => { const n = await askText('Новая папка', '', 'Создать'); if (n) go(n); } },
    ]);
  }
  async function remove(f) {
    if (!await confirmBox(`Удалить «${f.name}» из облака? Восстановить файл будет нельзя.`)) return;
    try { await drive.deleteFile(f.id); files = files.filter((x) => x.id !== f.id); paint(); toast('Файл удалён'); } catch (e) { toast(e.message, 'err'); }
  }

  const folders = () => [...new Set([...(files || []).map((f) => f.folder || ''), ...extraFolders])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));

  // ───── отрисовка ─────
  const queueBox = h('div', { class: 'cl-queue' });
  function paintQueue() {
    const live = queue.filter((u) => u.state !== 'cancel');
    queueBox.replaceChildren(...live.map((u) => h('div', { class: 'cl-up ' + u.state },
      fileIcon(u.name),
      h('div', { class: 'cl-ut' }, h('b', {}, u.name), h('span', {}, u.state === 'wait' ? 'В очереди · ' + fmtSize(u.size) : u.state === 'up' ? `Шифрую и загружаю · ${Math.round(u.p * 100)}% из ${fmtSize(u.size)}` : u.state === 'done' ? 'Загружено' : 'Ошибка: ' + (u.error || '')),
        h('i', { class: 'cl-bar' }, h('i', { style: { width: Math.round((u.state === 'done' ? 1 : u.p) * 100) + '%' } }))),
      u.state === 'up' || u.state === 'wait' ? h('button', { class: 'icon-btn', title: 'Отменить', 'aria-label': 'Отменить загрузку', onclick: () => { if (u.state === 'wait') u.state = 'cancel'; else u.ctrl.abort(); paint(); } }, icon('x', 16)) : null)));
  }
  function fileIcon(name) { const k = kindOf(name); return h('span', { class: 'cl-ico', style: { '--k': k.c } }, h('i', {}, (k.e || 'файл').slice(0, 4).toUpperCase())); }

  function paint() {
    if (!files) {
      body.replaceChildren(h('div', { class: 'cl-connect' },
        h('div', { class: 'cl-art', 'aria-hidden': 'true' }, icon('cloud', 40)),
        h('h3', {}, 'Личное облако на вашем Google Диске'),
        h('p', {}, 'Документы и небольшие программы хранятся в скрытой папке Vaultboard на вашем Диске. Каждый файл шифруется ещё на этом устройстве, поэтому прочитать его не сможет никто, даже Google. Остальные файлы Диска Vaultboard не видит.'),
        h('button', { class: 'btn primary cl-big', disabled: busy, onclick: () => connect(true) }, icon('cloud', 16), busy ? 'Подключаю…' : 'Подключить Google Диск'),
        h('small', {}, 'До 1 ГБ на файл. Место берётся из бесплатных 15 ГБ вашего аккаунта Google.')));
      return;
    }
    const all = folders();
    const shown = files.filter((f) => (!folder || (f.folder || '') === folder) && (!q || f.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => (b.added || 0) - (a.added || 0));
    const used = files.reduce((s, f) => s + (f.size || 0), 0);
    const search = h('input', { type: 'search', class: 'cl-q', placeholder: 'Найти файл', value: q, oninput: (e) => { q = e.target.value; const pos = e.target.selectionStart; paint(); const n = body.querySelector('.cl-q'); n.focus(); n.setSelectionRange(pos, pos); } });
    body.replaceChildren(input,
      h('div', { class: 'cl-bar-top' },
        h('button', { class: 'btn primary', onclick: () => input.click() }, icon('upload', 16), 'Загрузить файлы'),
        search,
        h('span', { class: 'cl-used', title: 'Зашифрованные файлы лежат в скрытой папке Vaultboard на вашем Google Диске' }, `${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')} · ${fmtSize(used)}`)),
      h('div', { class: 'cl-folders', role: 'tablist', 'aria-label': 'Папки' },
        h('button', { class: 'cl-chip' + (!folder ? ' on' : ''), onclick: () => { folder = ''; paint(); } }, icon('folder', 14), 'Все файлы'),
        ...all.map((n) => h('button', { class: 'cl-chip' + (folder === n ? ' on' : ''), onclick: () => { folder = n; paint(); } }, icon('folder', 14), n,
          h('b', {}, String(files.filter((f) => f.folder === n).length)))),
        h('button', { class: 'cl-chip add', onclick: async () => { const n = await askText('Новая папка', '', 'Создать'); if (n) { extraFolders.add(n); folder = n; paint(); } } }, icon('plus', 14), 'Папка')),
      queueBox,
      shown.length ? h('div', { class: 'cl-list' }, shown.map((f) => {
        const row = h('div', { class: 'cl-row' + (f.broken ? ' broken' : '') },
          fileIcon(f.name),
          h('div', { class: 'cl-t' }, h('b', { title: f.name }, f.name), h('span', {}, [f.folder && !folder ? f.folder : '', fmtSize(f.size || 0), fmtDate(f.added || f.created)].filter(Boolean).join(' · '))),
          h('div', { class: 'cl-acts' },
            f.broken ? null : h('button', { class: 'icon-btn', title: 'Скачать', 'aria-label': 'Скачать ' + f.name, onclick: () => download(f, row) }, icon('download', 17)),
            h('button', { class: 'icon-btn', title: 'Ещё', 'aria-label': 'Действия с файлом', onclick: (e) => popMenu(e.currentTarget, [
              f.broken ? null : { label: 'Скачать', icon: 'download', onClick: () => download(f, row) },
              f.broken ? null : { label: 'Переименовать', icon: 'edit', onClick: () => rename(f) },
              f.broken ? null : { label: 'Переместить в папку', icon: 'folder', onClick: () => move(f, row.querySelector('.cl-acts')) },
              '-', { label: 'Удалить', icon: 'trash', danger: true, onClick: () => remove(f) }].filter(Boolean)) }, icon('more', 17))),
          h('i', { class: 'cl-rp' }));
        return row;
      })) : h('div', { class: 'cl-empty' }, icon('upload', 28), h('b', {}, q ? 'Ничего не найдено' : folder ? 'В этой папке пока пусто' : 'Облако пока пустое'),
        h('span', {}, q ? 'Проверьте название файла.' : 'Перетащите файлы сюда или нажмите «Загрузить файлы».')),
      h('div', { class: 'cl-drop', 'aria-hidden': 'true' }, icon('upload', 34), h('b', {}, folder ? `Отпустите, чтобы загрузить в «${folder}»` : 'Отпустите, чтобы загрузить')));
    paintQueue();
  }
  const plural = (n, a, b, c) => { const t = n % 100, u = n % 10; return t > 10 && t < 20 ? c : u === 1 ? a : u >= 2 && u <= 4 ? b : c; };

  paint();
  if (drive.hasToken() || globalThis.chrome?.runtime?.id) connect(false);
}
