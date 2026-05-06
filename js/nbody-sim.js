// N-body gravitational simulation — dark background, colored bodies + trails
import { get } from './settings.js';

const G         = 1.0;
const SOFTENING = 0.01;
const DT        = 1 / 600;   // match Python: 1/(120*5)
const STEPS_PER_FRAME = 10;  // 60fps * 10 * (1/600) = 1 s/s real-time

function nbodyF(state, n) {
  const d = new Array(4 * n).fill(0);
  for (let i = 0; i < n; i++) {
    d[4*i]   = state[4*i+2];
    d[4*i+1] = state[4*i+3];
    let ax = 0, ay = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = state[4*j]   - state[4*i];
      const dy = state[4*j+1] - state[4*i+1];
      const r3 = (dx*dx + dy*dy + SOFTENING*SOFTENING) ** 1.5;
      ax += G * dx / r3;
      ay += G * dy / r3;
    }
    d[4*i+2] = ax; d[4*i+3] = ay;
  }
  return d;
}

function rk4Step(state, n) {
  const f  = s => nbodyF(s, n);
  const k1 = f(state);
  const k2 = f(state.map((v,i) => v + DT/2*k1[i]));
  const k3 = f(state.map((v,i) => v + DT/2*k2[i]));
  const k4 = f(state.map((v,i) => v + DT*k3[i]));
  return state.map((v,i) => v + DT/6*(k1[i]+2*k2[i]+2*k3[i]+k4[i]));
}

// Python pygame colors (HSV evenly spaced, full brightness)
function bodyColor(i, n, brightness = 1.0) {
  const h = i / n;
  const [r, g, b] = hsvToRgb(h, 0.85, brightness);
  return `rgb(${r},${g},${b})`;
}
function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f*s), t = v * (1 - (1-f)*s);
  let r, g, b;
  switch (i % 6) {
    case 0: r=v; g=t; b=p; break; case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break; case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break; case 5: r=v; g=p; b=q; break;
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

export class NBodySim {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.running = false;
    this.n       = 2;
    this.state   = null;
    this.scale   = 100;
    this._raf    = null;
    this._accumulator   = 0;
    this._lastTimestamp = null;

    // Persistent trail canvas
    this._trail    = document.createElement('canvas');
    this._trail.width  = canvas.width;
    this._trail.height = canvas.height;
    this._trailCtx = this._trail.getContext('2d');
    this._prevPts  = null;
    this._clearTrail();
  }

  _clearTrail() {
    this._trailCtx.clearRect(0, 0, this._trail.width, this._trail.height);
    this._prevPts = null;
  }

  reset(positions, velocities) {
    this.n = positions.length;
    this.state = [];
    for (let i = 0; i < this.n; i++)
      this.state.push(positions[i][0], positions[i][1], velocities[i][0], velocities[i][1]);
    this._accumulator   = 0;
    this._lastTimestamp = null;
    this._clearTrail();
  }

  start() {
    if (!this.running) {
      this.running = true;
      this._raf = requestAnimationFrame(t => this._loop(t));
    }
  }
  stop() {
    this.running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._lastTimestamp = null;
    if (this.state) this._draw();
  }

  _loop(timestamp) {
    if (!this.running) return;
    if (this._lastTimestamp === null) this._lastTimestamp = timestamp;
    const elapsed = Math.min((timestamp - this._lastTimestamp) / 1000, 0.05);
    this._lastTimestamp = timestamp;
    this._accumulator  += elapsed;
    let steps = 0;
    while (this._accumulator >= DT && steps < 30) {
      this.state = rk4Step(this.state, this.n);
      this._accumulator -= DT;
      steps++;
    }
    this._draw();
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  _draw() {
    const { canvas, ctx, state, n, scale } = this;
    if (!state) return;
    const W = canvas.width, H = canvas.height;

    // COM for camera center
    let comX = 0, comY = 0;
    for (let i = 0; i < n; i++) { comX += state[4*i]; comY += state[4*i+1]; }
    comX /= n; comY /= n;

    const cx = W / 2, cy = H / 2;
    const toSx = x => cx + (x - comX) * scale;
    const toSy = y => cy - (y - comY) * scale;

    // Background
    ctx.fillStyle = get('nb_bg') ?? '#0f1923';
    ctx.fillRect(0, 0, W, H);

    // Grid
    const gridSpacing = scale;   // 1 world unit
    const gridColor   = 'rgba(60,100,140,0.35)';
    const offsetX = ((cx - comX * scale) % gridSpacing + gridSpacing) % gridSpacing;
    const offsetY = ((cy + comY * scale) % gridSpacing + gridSpacing) % gridSpacing;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let x = offsetX; x < W; x += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = offsetY; y < H; y += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Origin cross
    const ox = toSx(0), oy = toSy(0);
    if (ox > 0 && ox < W && oy > 0 && oy < H) {
      ctx.strokeStyle = 'rgba(100,160,220,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox-8,oy); ctx.lineTo(ox+8,oy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox,oy-8); ctx.lineTo(ox,oy+8); ctx.stroke();
    }

    // Update trail canvas (translated to current camera)
    const currPts = [];
    for (let i = 0; i < n; i++) currPts.push([toSx(state[4*i]), toSy(state[4*i+1])]);

    if (this._prevPts) {
      for (let i = 0; i < n; i++) {
        const color = bodyColor(i, n, 0.55);
        this._trailCtx.beginPath();
        this._trailCtx.moveTo(this._prevPts[i][0], this._prevPts[i][1]);
        this._trailCtx.lineTo(currPts[i][0], currPts[i][1]);
        this._trailCtx.strokeStyle = color;
        this._trailCtx.lineWidth = 1.5;
        this._trailCtx.stroke();
      }
    }
    this._prevPts = currPts;

    ctx.globalAlpha = 0.9;
    ctx.drawImage(this._trail, 0, 0);
    ctx.globalAlpha = 1.0;

    // Bodies
    for (let i = 0; i < n; i++) {
      const sx = toSx(state[4*i]), sy = toSy(state[4*i+1]);
      const color = bodyColor(i, n, 1.0);
      ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Scale bar — bottom right, 1 world unit
    const barLen = scale;
    const bx = W - 20, by = H - 20;
    ctx.strokeStyle = '#aabbcc'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx - barLen, by); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - barLen, by-4); ctx.lineTo(bx - barLen, by+4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by-4); ctx.lineTo(bx, by+4); ctx.stroke();
    ctx.fillStyle = '#aabbcc'; ctx.font = '10px Consolas,monospace';
    ctx.fillText('1 unit', bx - barLen/2 - 18, by - 6);
  }
}
