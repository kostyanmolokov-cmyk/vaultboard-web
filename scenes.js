// Тестовый режим фонов: живые сцены 5 (кубики) и 6 (неоновый цветок) + плавающий пульт (номер сцены, яркость, размытие).
// Сцена 6 рисуется шейдером (raymarching в WebGL), сцена 5 — на Canvas 2D. Всё на заднем слое, клики не перехватывает.
const KEY = 'vb.bgtest';
const load = () => { try { return { scene: 0, op: 100, blur: 0, open: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { scene: 0, op: 100, blur: 0, open: false }; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ок */ } };
const st = load();
if (st.scene && ![5, 6].includes(st.scene)) st.scene = 0; // сцены 1–4 удалены
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const NAMES = ['', '', '', '', '', 'Стеклянные кубики', 'Неоновый цветок'];

// ───────────────────────── общие куски шейдеров ─────────────────────────
const HEAD = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uM;
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float sdTorus(vec3 p,vec2 t){vec2 q=vec2(length(p.xz)-t.x,p.y);return length(q)-t.y;}
float slab(float d2,float z,float th,float r){vec2 w=vec2(d2,abs(z)-th);return length(max(w,0.))+min(max(w.x,w.y),0.)-r;}
vec3 studio(vec3 d){vec3 c=mix(vec3(.80,.81,.85),vec3(1.),smoothstep(-.25,.75,d.y));
  c+=smoothstep(.9,1.,dot(d,normalize(vec3(-.45,.75,.5))))*.9;c+=smoothstep(.93,1.,dot(d,normalize(vec3(.7,.3,.6))))*.35;return c;}
`;
const TAIL = (steps, k) => `
vec3 calcN(vec3 p){vec2 e=vec2(.0018,0.);return normalize(vec3(map(p+e.xyy).x-map(p-e.xyy).x,map(p+e.yxy).x-map(p-e.yxy).x,map(p+e.yyx).x-map(p-e.yyx).x));}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  vec3 ro=vec3(0.,0.,6.3),rd=normalize(vec3(uv,-1.75));
  vec3 bg=bgCol(uv),col=bg;
  float t=0.;vec2 h=vec2(1.,0.);bool hit=false;
  for(int i=0;i<${steps};i++){h=map(ro+rd*t);if(h.x<.0016){hit=true;break;}t+=h.x*${k};if(t>13.)break;}
  if(hit){vec3 p=ro+rd*t;col=shade(p,calcN(p),rd,h.y,bg);}
  col=post(col,uv);
  col+=(hash(gl_FragCoord.xy+fract(uT))-.5)/255.;
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

// 6. Параметрический неоновый цветок из ребристых лепестков
const S6 = HEAD + `
float petal(vec3 r){vec3 e=r/vec3(.92,.36,.2);float d=(length(e)-1.)*.2;d+=.012*sin(r.x*58.)*smoothstep(.95,.3,abs(r.x-.0));return d;}
vec2 map(vec3 p){
  vec3 q=p;q.xz*=rot(uM.x*.45+sin(uT*.17)*.18);q.yz*=rot(-.45+uM.y*.3);q.xy*=rot(uT*.08);
  float s=1.+.05*sin(uT*1.4);q/=s;
  float N=6.,sec=6.28318/N,a=atan(q.y,q.x),best=1e3;
  for(int k=-1;k<=1;k++){float idx=floor(a/sec+.5)+float(k);vec3 r=q;r.xy*=rot(-idx*sec);r.x-=.86;r.xz*=rot(-.38);best=min(best,petal(r));}
  vec3 q2=q;q2.xy*=rot(sec*.5);q2.z+=.22;q2*=1.3;float a2=atan(q2.y,q2.x);
  for(int k=-1;k<=1;k++){float idx=floor(a2/sec+.5)+float(k);vec3 r=q2;r.xy*=rot(-idx*sec);r.x-=.86;r.xz*=rot(-.6);best=min(best,petal(r)/1.3);}
  return vec2(best*s*.8,1.);
}
vec3 bgCol(vec2 uv){vec3 c=mix(vec3(.05,.045,.11),vec3(.11,.08,.2),smoothstep(-.7,.6,uv.y+uv.x*.2));
  vec2 g=uv*9.;vec2 id=floor(g+vec2(0.,uT*.25));float h=hash(id);vec2 f=fract(g+vec2(0.,uT*.25))-.5-vec2(h-.5,fract(h*7.)-.5)*.6;
  float sp=step(.82,h)*smoothstep(.07,.0,length(f));c+=sp*mix(vec3(.55,.45,1.),vec3(.4,.95,1.),fract(h*13.))*.9;return c;}
vec3 shade(vec3 p,vec3 n,vec3 rd,float id,vec3 bg){
  vec3 l=normalize(vec3(-.4,.7,.6));float dif=max(dot(n,l),0.),fr=pow(1.-abs(dot(n,rd)),2.5),sp=pow(max(dot(reflect(rd,n),l),0.),40.);
  vec3 c=mix(vec3(.30,.20,.85),vec3(.55,.35,1.),dif);c=mix(c,vec3(.35,.85,1.),fr*.7);c+=sp*vec3(.8,.85,1.);
  c+=vec3(.45,.3,1.)*(.15+.1*sin(uT*1.4));
  return c;
}
vec3 post(vec3 c,vec2 uv){return c;}` + TAIL(100, '.7');

const FRAGS = { 6: S6 };
const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

// ───────────────────────── движок ─────────────────────────
let glc = null, gl = null, c2 = null, ctx2 = null, progs = {}, U = {}, raf = 0, t0 = performance.now();
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener('pointermove', (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = -((e.clientY / innerHeight) * 2 - 1); }, { passive: true });

function ensureCanvases() {
  if (glc) return;
  glc = Object.assign(document.createElement('canvas'), { className: 'bgt-canvas' }); glc.setAttribute('aria-hidden', 'true');
  c2 = Object.assign(document.createElement('canvas'), { className: 'bgt-canvas' }); c2.setAttribute('aria-hidden', 'true');
  document.body.prepend(glc, c2);
  gl = glc.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  ctx2 = c2.getContext('2d');
  if (gl) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); }
  addEventListener('resize', size);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.scene) loop(); });
}
function program(n) {
  if (progs[n] !== undefined) return progs[n];
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('Сцена ' + n, gl.getShaderInfoLog(s)); return null; } return s; };
  const v = sh(gl.VERTEX_SHADER, VERT), f = sh(gl.FRAGMENT_SHADER, FRAGS[n]);
  if (!v || !f) return (progs[n] = null);
  const pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return (progs[n] = null);
  U[n] = { res: gl.getUniformLocation(pr, 'uRes'), t: gl.getUniformLocation(pr, 'uT'), m: gl.getUniformLocation(pr, 'uM'), p: gl.getAttribLocation(pr, 'p') };
  return (progs[n] = pr);
}
let k = 0.6;
function size() {
  if (!glc) return;
  const w = innerWidth, h = innerHeight;
  // шейдерные сцены считаем в уменьшенном разрешении (они гладкие), кубики — в родном
  k = Math.min(0.7, Math.sqrt(620000 / Math.max(1, w * h)));
  glc.width = Math.max(2, Math.round(w * k)); glc.height = Math.max(2, Math.round(h * k));
  const d = Math.min(1.5, devicePixelRatio || 1);
  c2.width = Math.round(w * d); c2.height = Math.round(h * d);
  if (gl) gl.viewport(0, 0, glc.width, glc.height);
}

function frame(now) {
  raf = 0;
  if (!st.scene || document.hidden) return;
  const t = (now - t0) / 1000 * (calm() ? 0.15 : 1);
  mouse.x += (mouse.tx - mouse.x) * 0.06; mouse.y += (mouse.ty - mouse.y) * 0.06;
  if (st.scene === 5) drawCubes(t);
  else if (gl) {
    const pr = program(st.scene);
    if (pr) {
      gl.useProgram(pr); const u = U[st.scene];
      gl.enableVertexAttribArray(u.p); gl.vertexAttribPointer(u.p, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.res, glc.width, glc.height); gl.uniform1f(u.t, t); gl.uniform2f(u.m, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  loop();
}
function loop() { if (!raf && st.scene && !document.hidden) raf = requestAnimationFrame(frame); }

// 5. Переплетающиеся ленты из стеклянных кубиков (Canvas 2D)
const RIB = [[168, 85, 247], [59, 130, 246], [239, 68, 68], [250, 204, 21], [34, 197, 94]];
function drawCubes(t) {
  const W = c2.width, H = c2.height, g = ctx2;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0d0b1d'); bg.addColorStop(1, '#1b1433');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const cubes = [];
  const L = Math.hypot(W, H) * 1.25, sp = 0.032, flow = (t * 0.012) % sp;
  RIB.forEach((col, ri) => {
    for (let s = -0.1 + flow; s < 1.05; s += sp) {
      const u = s + ri * 0.004;
      const along = u * L - L * 0.12;
      const amp = H * (0.12 + ri * 0.025), ph = ri * 1.25;
      const off = Math.sin(u * 7 + ph + t * 0.25) * amp + (ri - 2) * H * 0.07 + mouse.y * 30 * (1 + ri * 0.2);
      // диагональ снизу-слева вверх-вправо
      const x = along * 0.8 - off * 0.6 + mouse.x * 25, y = H - along * 0.6 - off * 0.8 + H * 0.05;
      const depth = 0.55 + 0.75 * (1 - u) + Math.sin(u * 5 + ph) * 0.12;
      const size = Math.max(6, (W / 38) * depth);
      const ang = Math.atan2(-0.6 + Math.cos(u * 7 + ph + t * 0.25) * 0.05, 0.8) + Math.sin(u * 9 + ri) * 0.25;
      cubes.push({ x, y, size, ang, col, depth });
    }
  });
  cubes.sort((a, b) => a.depth - b.depth);
  for (const c of cubes) {
    if (c.x < -c.size * 2 || c.x > W + c.size * 2 || c.y < -c.size * 2 || c.y > H + c.size * 2) continue;
    const s = c.size, [r, gg, b] = c.col, d = s * 0.38;
    g.save(); g.translate(c.x, c.y); g.rotate(c.ang);
    // верхняя и боковая грани (объём), затем передняя полупрозрачная
    g.fillStyle = `rgba(${Math.min(255, r + 70)},${Math.min(255, gg + 70)},${Math.min(255, b + 70)},.55)`;
    g.beginPath(); g.moveTo(-s / 2, -s / 2); g.lineTo(-s / 2 + d, -s / 2 - d); g.lineTo(s / 2 + d, -s / 2 - d); g.lineTo(s / 2, -s / 2); g.closePath(); g.fill();
    g.fillStyle = `rgba(${r * 0.6 | 0},${gg * 0.6 | 0},${b * 0.6 | 0},.6)`;
    g.beginPath(); g.moveTo(s / 2, -s / 2); g.lineTo(s / 2 + d, -s / 2 - d); g.lineTo(s / 2 + d, s / 2 - d); g.lineTo(s / 2, s / 2); g.closePath(); g.fill();
    const fg = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    fg.addColorStop(0, `rgba(${Math.min(255, r + 90)},${Math.min(255, gg + 90)},${Math.min(255, b + 90)},.75)`); fg.addColorStop(1, `rgba(${r},${gg},${b},.5)`);
    g.fillStyle = fg; g.fillRect(-s / 2, -s / 2, s, s);
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = Math.max(1, s * 0.04); g.strokeRect(-s / 2, -s / 2, s, s);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-s / 2 + s * 0.12, -s / 2 + s * 0.12, s * 0.22, s * 0.08);
    g.restore();
  }
  // редкие искры
  for (let i = 0; i < 26; i++) {
    const hx = (Math.sin(i * 91.7) * 0.5 + 0.5), hy = ((Math.sin(i * 47.3) * 0.5 + 0.5) + t * 0.01 * (1 + i % 3)) % 1;
    const a = 0.4 + 0.4 * Math.sin(t * 2 + i);
    g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(hx * W, (1 - hy) * H, 1.5 + (i % 3), 0, 6.283); g.fill();
  }
}

// ───────────────────────── применение и пульт ─────────────────────────
function apply() {
  const d = document.documentElement;
  if (st.scene) {
    ensureCanvases(); size();
    d.dataset.bgtest = String(st.scene);
    glc.hidden = st.scene === 5; c2.hidden = st.scene !== 5;
    for (const c of [glc, c2]) { c.style.opacity = String(st.op / 100); c.style.filter = st.blur ? `blur(${st.blur}px)` : 'none'; c.style.transform = st.blur ? 'scale(1.04)' : 'none'; }
    loop();
  } else {
    delete d.dataset.bgtest;
    if (glc) { glc.hidden = true; c2.hidden = true; }
  }
  paintPanel();
}
let panel = null, ctx = null;
function paintPanel() {
  if (!st.open) { panel?.remove(); panel = null; return; }
  if (!panel) {
    panel = document.createElement('div'); panel.className = 'bgt-panel'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Тест фонов');
    document.body.append(panel);
  }
  panel.innerHTML = `
    <div class="bgt-head"><b>3D-фоны</b><span></span><button class="bgt-x" title="Закрыть пульт" aria-label="Закрыть пульт">×</button></div>
    ${ctx ? `<div class="bgt-cap">Тема</div><div class="bgt-themes" role="listbox" aria-label="Тема">${ctx.themes.map(([v, l]) => {
      const [name, ...rest] = l.split(' ('); const hint = rest.join(' (').replace(/\)$/, '');
      return `<button data-t="${v}" class="${ctx.current() === v ? 'on' : ''}" title="${l.replace(/"/g, '&quot;')}"><b>${name}</b>${hint ? `<span>${hint}</span>` : ''}</button>`; }).join('')}</div>` : ''}
    <div class="bgt-cap">3D-сцена поверх темы<em>${st.scene ? NAMES[st.scene] : 'выключена'}</em></div>
    <div class="bgt-btns">${[5, 6].map((n) => `<button data-n="${n}" class="${st.scene === n ? 'on' : ''}" title="${NAMES[n]}">${n}</button>`).join('')}<button data-n="0" class="off ${!st.scene ? 'on' : ''}">Выкл</button></div>
    <label class="bgt-r"><span>Яркость</span><input type="range" min="10" max="100" step="1" value="${st.op}" data-k="op"><output>${st.op}%</output></label>
    <label class="bgt-r"><span>Размытие</span><input type="range" min="0" max="20" step="1" value="${st.blur}" data-k="blur"><output>${st.blur}px</output></label>`;
  panel.querySelectorAll('.bgt-themes button').forEach((b) => { b.onclick = async () => { await ctx.setTheme(b.dataset.t); paintPanel(); }; });
  panel.querySelector('.bgt-x').onclick = () => { st.open = false; save(); paintPanel(); };
  panel.querySelectorAll('.bgt-btns button').forEach((b) => { b.onclick = () => { st.scene = +b.dataset.n; save(); apply(); }; });
  panel.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.oninput = () => {
      st[inp.dataset.k] = +inp.value; save();
      inp.nextElementSibling.textContent = inp.dataset.k === 'op' ? st.op + '%' : st.blur + 'px';
      for (const c of [glc, c2].filter(Boolean)) { c.style.opacity = String(st.op / 100); c.style.filter = st.blur ? `blur(${st.blur}px)` : 'none'; c.style.transform = st.blur ? 'scale(1.04)' : 'none'; }
    };
  });
}
export function openBgTest(c) { if (c) ctx = c; st.open = true; save(); apply(); }
export function initBgTest(c) { if (c) ctx = c; if (st.scene || st.open) apply(); }
