// Световые микро-эффекты для тем «Жемчуг» и «Нова»: фонарик на рамках, бегущий луч, 3D-кристалл в пустых разделах.
// Всё работает через CSS-переменные и один requestAnimationFrame, без перерисовки DOM.
import { h } from './ui.js?v=1794728817';

const ON = () => { const s = document.documentElement.dataset.scene; return s === 'pearl' || s === 'nova'; };
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───── фонарик: координаты курсора относительно каждой ближней карточки ─────
const R = 320; // радиус, в котором рамки «ловят» свет
let pt = null, raf = 0, lit = new Set();
function frame() {
  raf = 0;
  const board = document.getElementById('board');
  if (!board || !pt || !ON()) return clearLit();
  const els = board.querySelectorAll('.group, .item');
  const rects = []; // сначала только чтение размеров, потом только запись: без лишних пересчётов вёрстки
  for (const el of els) rects.push(el.getBoundingClientRect());
  const next = new Set();
  els.forEach((el, k) => {
    const r = rects[k];
    const dx = Math.max(r.left - pt.x, 0, pt.x - r.right), dy = Math.max(r.top - pt.y, 0, pt.y - r.bottom);
    if (dx > R || dy > R || r.bottom < 0 || r.top > innerHeight) return;
    el.style.setProperty('--mouse-x', (pt.x - r.left).toFixed(1) + 'px');
    el.style.setProperty('--mouse-y', (pt.y - r.top).toFixed(1) + 'px');
    next.add(el);
  });
  for (const el of lit) if (!next.has(el)) { el.style.removeProperty('--mouse-x'); el.style.removeProperty('--mouse-y'); el.classList.remove('lit'); }
  for (const el of next) el.classList.add('lit');
  lit = next;
}
function clearLit() { for (const el of lit) { el.classList.remove('lit'); } lit = new Set(); }
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || !ON()) return;
  pt = { x: e.clientX, y: e.clientY };
  if (!raf) raf = requestAnimationFrame(frame);
  if (springs.size && !sraf) sraf = requestAnimationFrame(springStep);
}, { passive: true });
document.addEventListener('pointerleave', () => { pt = null; clearLit(); if (springs.size && !sraf) sraf = requestAnimationFrame(springStep); });
addEventListener('scroll', () => { if (pt && !raf && ON()) raf = requestAnimationFrame(frame); }, { passive: true, capture: true });

// ───── выбранная карточка: на ней бежит луч ─────
let curId = null;
export const currentItem = () => curId;
document.addEventListener('focusin', (e) => {
  const it = e.target.closest?.('#board .item'); if (!it) return;
  curId = it.dataset.id;
  document.querySelectorAll('#board .item.cur').forEach((n) => n !== it && n.classList.remove('cur'));
  it.classList.add('cur');
});

// ───── 3D-кристалл-замок, наклоняется за курсором с пружинистым возвратом ─────
const springs = new Map(); // el → { rx, ry, vx, vy }
let sraf = 0, last = 0;
function springStep(t) {
  sraf = 0;
  const dt = Math.min(0.033, last ? (t - last) / 1000 : 0.016); last = t;
  let moving = false;
  for (const [el, s] of springs) {
    if (!el.isConnected) { springs.delete(el); continue; }
    let tx = 0, ty = 0;
    if (pt && ON() && !calm()) {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const nx = (pt.x - cx) / Math.max(320, innerWidth / 2), ny = (pt.y - cy) / Math.max(260, innerHeight / 2);
      tx = Math.max(-1, Math.min(1, ny)) * -22; ty = Math.max(-1, Math.min(1, nx)) * 30;
    }
    // пружина: жёсткость 140, затухание 13
    s.vx += ((tx - s.rx) * 140 - s.vx * 13) * dt; s.vy += ((ty - s.ry) * 140 - s.vy * 13) * dt;
    s.rx += s.vx * dt; s.ry += s.vy * dt;
    if (Math.abs(tx - s.rx) > 0.05 || Math.abs(ty - s.ry) > 0.05 || Math.abs(s.vx) > 0.05 || Math.abs(s.vy) > 0.05) moving = true;
    el.style.setProperty('--rx', s.rx.toFixed(2) + 'deg'); el.style.setProperty('--ry', s.ry.toFixed(2) + 'deg');
  }
  if (moving) sraf = requestAnimationFrame(springStep); else last = 0;
}
export function crystal3d(size = 'lg') {
  const layers = [];
  for (let k = 0; k < 6; k++) layers.push(h('i', { class: 'c3-slab', style: { '--z': (k * 4 - 10) + 'px', '--k': String(k) } }));
  const obj = h('div', { class: 'c3-obj' },
    h('i', { class: 'c3-ring' }), h('i', { class: 'c3-ring r2' }),
    h('i', { class: 'c3-shackle' }), h('i', { class: 'c3-shackle back' }),
    ...layers,
    h('i', { class: 'c3-face' }, h('i', { class: 'c3-hole' }), h('i', { class: 'c3-gloss' })),
    h('i', { class: 'c3-spark s1' }), h('i', { class: 'c3-spark s2' }));
  const el = h('div', { class: 'c3d c3-' + size, 'aria-hidden': 'true' }, h('i', { class: 'c3-shadow' }), obj);
  springs.set(el, { rx: 0, ry: 0, vx: 0, vy: 0 });
  return el;
}
