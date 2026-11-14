// Оформление «Нова»: живой 3D-фон на WebGL (без сторонних библиотек), наклон карточек, HUD-эффекты,
// «расшифровка» заголовка и синтезатор микрозвуков. Модуль подгружается только когда выбрана эта тема.

const TONES = { violet: [0.62, 0.45, 1.0], emerald: [0.2, 0.9, 0.62], amber: [1.0, 0.68, 0.22], cyan: [0.25, 0.82, 1.0] };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const FINE = matchMedia('(hover: hover) and (pointer: fine)');

let active = false, wired = false;
let canvas = null, gl = null, prog = null, U = {}, raf = 0, lost = false;
const acc = [...TONES.violet]; let target = TONES.violet;
let shock = 1, push = 0, spin = 0, last = 0;
const mouse = [0, 0], cam = [0, 0], t1 = [0, 0], t2 = [0, 0];

// ───────────────────────── 3D-сцена: сферы и ленты с иризацией ─────────────────────────
const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision highp float;
uniform vec2 uRes,uCam,uT1,uT2;uniform float uTime,uShock,uPush,uSpin;uniform vec3 uAcc;
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float torus(vec3 p,vec2 t){vec2 q=vec2(length(p.xz)-t.x,p.y);return length(q)-t.y;}
float frame(vec3 p,vec2 b,float r,float th){vec2 d=abs(p.xy)-b+r;float e=length(max(d,0.))+min(max(d.x,d.y),0.)-r;return length(vec2(e,p.z))-th;}
vec2 map(vec3 p){
  vec2 res=vec2(1e3,0.);
  vec3 q=p;q.xy*=rot(uSpin*.6);q.xz*=rot(sin(uSpin*.7)*.32);
  for(int i=0;i<6;i++){
    float f=float(i);
    vec3 c=vec3(sin(f*2.4+1.)*2.7,cos(f*1.7+.5)*1.35,sin(f*3.1)*1.5-.3);
    c.y+=sin(uTime*.35+f*1.9)*.22;c.x+=cos(uTime*.21+f)*.12;
    c.xy+=normalize(c.xy)*uPush;
    float r=.26+.36*fract(sin(f*12.9898)*43758.5453);
    float d=length(q-c)-r;
    if(d<res.x)res=vec2(d,1.+f);
  }
  vec3 t=p-vec3(.7,-.25,-1.3);t.xy*=rot(.5+uSpin*.3);t.yz*=rot(1.12+sin(uTime*.12)*.15);
  float d=torus(t,vec2(2.6,.2));if(d<res.x)res=vec2(d,10.);
  vec3 fr=p-vec3(-2.5,.55,-.9);fr.xz*=rot(.6+sin(uTime*.1)*.2+uSpin*.5);fr.xy*=rot(-.2);
  d=frame(fr,vec2(1.15,.85),.36,.17);if(d<res.x)res=vec2(d,11.);
  return res;
}
vec3 normal(vec3 p){vec2 e=vec2(.002,0.);return normalize(vec3(map(p+e.xyy).x-map(p-e.xyy).x,map(p+e.yxy).x-map(p-e.yxy).x,map(p+e.yyx).x-map(p-e.yyx).x));}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  float asp=uRes.x/uRes.y;
  vec3 ro=vec3(uCam.x*.55,uCam.y*.38,6.2*max(1.,pow(1./asp,.8))),ta=vec3(0.,0.,-.4);
  vec3 ww=normalize(ta-ro),uu=normalize(cross(ww,vec3(0.,1.,0.))),vv=cross(uu,ww);
  vec3 rd=normalize(uv.x*uu+uv.y*vv+1.7*ww);
  vec3 bg=vec3(.0196,.0275,.055)+uAcc*.05*exp(-dot(uv-vec2(.25,.2),uv-vec2(.25,.2))*1.6)+vec3(.02,.03,.07)*exp(-dot(uv+vec2(.5,.35),uv+vec2(.5,.35))*2.2);
  vec3 col=bg;
  float t=0.,id=0.,edge=1.;
  for(int i=0;i<64;i++){vec2 m=map(ro+rd*t);if(m.x<.003){id=m.y;break;}edge=min(edge,m.x/max(t,.5));t+=m.x;if(t>14.)break;}
  if(id>0.){
    vec3 pos=ro+rd*t,n=normal(pos),v=-rd;
    float fr=pow(1.-max(dot(n,v),0.),2.3);
    vec3 ir=.5+.5*cos(6.2831*(fr*.9+dot(n,vec3(.3,.5,.2))*.35+id*.07+uTime*.02+vec3(0.,.33,.67)));
    vec3 l=normalize(vec3(.5,.8,.6));
    float dif=max(dot(n,l),0.),sp=pow(max(dot(reflect(-l,n),v),0.),42.);
    vec3 c=vec3(.012,.016,.036)+uAcc*.045*(.5+.5*n.y)+uAcc*dif*.1+mix(ir,uAcc,.58)*fr*.78+sp*.22*mix(vec3(1.),uAcc,.5);
    col=mix(c,bg,smoothstep(4.5,13.,t));
  }else{
    // мягкий ореол у края фигур: сглаживает «лесенку» и даёт неоновый блик по контуру
    float px=2.6/uRes.y;
    col+=mix(vec3(.55,.75,1.),uAcc,.7)*(1.-smoothstep(0.,px,edge))*.42+uAcc*(1.-smoothstep(0.,px*9.,edge))*.05;
  }
  float rr=length(uv)-uShock*2.3;
  col+=uAcc*exp(-rr*rr*150.)*(1.-uShock)*.3;
  vec2 a=uv-uT1,b=uv-uT2;
  col+=uAcc*(exp(-dot(a,a)*34.)*.07+exp(-dot(b,b)*13.)*.04);
  col*=1.-.32*dot(uv,uv);
  col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;
  gl_FragColor=vec4(max(col,0.),1.);
}`;

function initGL() {
  canvas = document.createElement('canvas');
  canvas.className = 'nv-bg'; canvas.setAttribute('aria-hidden', 'true');
  (document.querySelector('.scene') || document.body.firstChild).after(canvas);
  gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false });
  if (!gl) { canvas.remove(); canvas = null; return false; }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; if (build()) loop(); });
  return build();
}
function build() {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : (console.warn('nova shader', gl.getShaderInfoLog(s)), null); };
  const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return false;
  prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const n of ['uRes', 'uCam', 'uT1', 'uT2', 'uTime', 'uShock', 'uPush', 'uSpin', 'uAcc']) U[n] = gl.getUniformLocation(prog, n);
  resize();
  return true;
}
function resize() {
  if (!canvas) return;
  // рисуем в уменьшенном разрешении: фон всё равно размыт стеклом, а видеокарте в разы легче
  const w = innerWidth, hgt = innerHeight, k = Math.min(0.75, Math.sqrt(640000 / Math.max(1, w * hgt)));
  canvas.width = Math.max(2, Math.round(w * k)); canvas.height = Math.max(2, Math.round(hgt * k));
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  for (let i = 0; i < 3; i++) acc[i] += (target[i] - acc[i]) * Math.min(1, dt * 3.2);
  if (shock < 1) shock = Math.min(1, shock + dt / 0.95);
  push = Math.sin(Math.PI * shock) * 0.38;
  spin += dt * (0.045 + (1 - shock) * 1.5);
  const e = Math.min(1, dt * 3);
  cam[0] += (mouse[0] - cam[0]) * e; cam[1] += (mouse[1] - cam[1]) * e;
  const asp = innerWidth / Math.max(1, innerHeight), mx = mouse[0] * asp * 0.5, my = mouse[1] * 0.5;
  t1[0] += (mx - t1[0]) * Math.min(1, dt * 7); t1[1] += (my - t1[1]) * Math.min(1, dt * 7);
  t2[0] += (t1[0] - t2[0]) * Math.min(1, dt * 2.6); t2[1] += (t1[1] - t2[1]) * Math.min(1, dt * 2.6);
  gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform2f(U.uCam, cam[0], cam[1]);
  gl.uniform2f(U.uT1, t1[0], t1[1]); gl.uniform2f(U.uT2, t2[0], t2[1]);
  gl.uniform1f(U.uTime, now / 1000); gl.uniform1f(U.uShock, shock); gl.uniform1f(U.uPush, push); gl.uniform1f(U.uSpin, spin);
  gl.uniform3f(U.uAcc, acc[0], acc[1], acc[2]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function loop() {
  cancelAnimationFrame(raf); raf = 0;
  if (!active || !gl || lost || document.hidden) return;
  if (REDUCED.matches) { for (let i = 0; i < 3; i++) acc[i] = target[i]; shock = 1; frame(performance.now()); return; } // без движения: один статичный кадр
  const step = (now) => { frame(now); raf = requestAnimationFrame(step); };
  last = performance.now(); raf = requestAnimationFrame(step);
}

// ───────────────────────── звук: синтез на Web Audio, без файлов ─────────────────────────
let sfx = true, armed = false, ctx = null, noise = null, lastTick = 0;
function audio() {
  if (!sfx || !armed) return null;
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { ctx = new C(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
function env(a, peak, t0, attack, dur) { const g = a.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); g.connect(a.destination); return g; }
function tick() {
  const now = performance.now(); if (now - lastTick < 70) return; lastTick = now;
  const a = audio(); if (!a) return;
  const t = a.currentTime, o = a.createOscillator();
  o.type = 'triangle'; o.frequency.setValueAtTime(1850, t); o.frequency.exponentialRampToValueAtTime(1250, t + 0.04);
  o.connect(env(a, 0.018, t, 0.004, 0.05)); o.start(t); o.stop(t + 0.06);
}
function blip() {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  for (const [f, d] of [[660, 0], [990, 0.05]]) { const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t + d); o.connect(env(a, 0.03, t + d, 0.006, 0.12)); o.start(t + d); o.stop(t + d + 0.14); }
}
function swoosh() {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  if (!noise) { noise = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate); const ch = noise.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
  const src = a.createBufferSource(); src.buffer = noise;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1; bp.frequency.setValueAtTime(380, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
  src.connect(bp); bp.connect(env(a, 0.05, t, 0.08, 0.42)); src.start(t); src.stop(t + 0.45);
  const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(620, t + 0.3);
  o.connect(env(a, 0.022, t, 0.06, 0.38)); o.start(t); o.stop(t + 0.4);
}

// ───────────────────────── эффекты интерфейса ─────────────────────────
const GLYPHS = '▚▞▓▒░#%&/<>01АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ';
function scramble(el) {
  if (!el || REDUCED.matches) return;
  const final = el.textContent; if (!final) return;
  const t0 = performance.now(); let shown = final;
  const step = () => {
    if (!el.isConnected || el.textContent !== shown) return; // текст сменили снаружи: не мешаем
    const p = (performance.now() - t0) / 300;
    if (p >= 1) { el.textContent = final; return; }
    const keep = Math.floor(final.length * p);
    shown = final.slice(0, keep) + [...final.slice(keep)].map((c) => (c === ' ' ? ' ' : GLYPHS[Math.random() * GLYPHS.length | 0])).join('');
    el.textContent = shown;
    requestAnimationFrame(step);
  };
  step();
}
function burst(x, y) {
  if (REDUCED.matches) return;
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('i'); p.className = 'nv-p';
    const ang = Math.random() * Math.PI * 2, dist = 28 + Math.random() * 54, s = 2 + Math.random() * 3;
    p.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px`;
    document.body.append(p);
    p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(.2)`, opacity: 0 }],
      { duration: 420 + Math.random() * 320, easing: 'cubic-bezier(.15,.7,.25,1)' }).onfinish = () => p.remove();
  }
}

function wire() {
  if (wired) return; wired = true;
  addEventListener('resize', () => { resize(); if (active && REDUCED.matches) loop(); }, { passive: true });
  document.addEventListener('visibilitychange', loop);
  REDUCED.addEventListener?.('change', loop);
  const arm = () => { armed = true; };
  addEventListener('pointerdown', arm, { capture: true, passive: true }); addEventListener('keydown', arm, { capture: true, passive: true });
  let hot = null, tiltRaf = 0;
  document.addEventListener('pointermove', (e) => {
    if (!active || e.pointerType === 'touch') return;
    mouse[0] = (e.clientX / innerWidth) * 2 - 1; mouse[1] = 1 - (e.clientY / innerHeight) * 2;
    if (tiltRaf || REDUCED.matches || !FINE.matches) return;
    const it = e.target.closest?.('.item'); if (!it) return;
    tiltRaf = requestAnimationFrame(() => {
      tiltRaf = 0;
      const r = it.getBoundingClientRect(); if (!r.width) return;
      const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      it.style.setProperty('--nv-rx', (nx * 9).toFixed(2) + 'deg'); it.style.setProperty('--nv-ry', (-ny * 11).toFixed(2) + 'deg');
      it.style.setProperty('--nv-gl', (50 + nx * 120).toFixed(1) + '%');
    });
  }, { passive: true });
  document.addEventListener('pointerover', (e) => {
    if (!active || e.pointerType === 'touch') return;
    const it = e.target.closest?.('.item');
    if (it !== hot) { hot = it; if (it) tick(); }
  }, { passive: true });
  document.addEventListener('click', (e) => {
    if (!active) return;
    const b = e.target.closest?.('#add-btn'); if (!b) return;
    const r = b.getBoundingClientRect();
    burst(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2); blip();
  }, true);
}

// ───────────────────────── управление из приложения ─────────────────────────
export function setActive(on, opts = {}) {
  if ('sound' in opts) sfx = !!opts.sound;
  if (on === active) return;
  active = on;
  if (on) {
    wire();
    if (!canvas && !initGL()) document.documentElement.dataset.nvFlat = '1'; // нет WebGL: остаётся спокойный градиент из CSS
    if (canvas) canvas.hidden = false;
    target = TONES[document.documentElement.dataset.nv] || TONES.violet;
    for (let i = 0; i < 3; i++) acc[i] = target[i];
    loop();
  } else {
    cancelAnimationFrame(raf); raf = 0;
    if (canvas) canvas.hidden = true;
    delete document.documentElement.dataset.nvFlat;
  }
}
export function setSound(on) { sfx = !!on; if (on) { armed = true; tick(); } }
/** Пространство сменили: ударная волна по сцене, новый цвет, «расшифровка» заголовка, свуш. */
export function spaceChanged() {
  if (!active) return;
  target = TONES[document.documentElement.dataset.nv] || TONES.violet;
  shock = 0; swoosh(); scramble(document.getElementById('crumb'));
  if (REDUCED.matches) loop();
}
/** Только цвет, без волны: например после переименования или синхронизации. */
export function retone() { if (active) { target = TONES[document.documentElement.dataset.nv] || TONES.violet; if (REDUCED.matches) loop(); } }
