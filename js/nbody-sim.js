// N-body gravitational simulation — auto-zoom, smart grid, body labels
import { get } from './settings.js';

const G         = 1.0;
const SOFTENING = 0.01;
const DT        = 1 / 600;
const BODY_WORLD_R = 0.05;   // body radius in world units (scales with zoom)
const SAFE_FRAC    = 0.85;   // bodies kept within this fraction of half-canvas
const HUD_BOTTOM   = 36;     // px reserved at top for HUD (body label avoidance)

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

function bodyColor(i, n, brightness = 1.0) {
  const h = i / n;
  const [r, g, b] = hsvToRgb(h, 0.85, brightness);
  return `rgb(${r},${g},${b})`;
}
function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  let r, g, b;
  switch (i % 6) {
    case 0: r=v;g=t;b=p; break; case 1: r=q;g=v;b=p; break;
    case 2: r=p;g=v;b=t; break; case 3: r=p;g=q;b=v; break;
    case 4: r=t;g=p;b=v; break; case 5: r=v;g=p;b=q; break;
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
    this._initialScale = 100;
    this._raf    = null;
    this._accumulator   = 0;
    this._lastTimestamp = null;

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
    this._initialScale   = this.scale;   // current scale becomes the zoom-in ceiling
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
    const { canvas, ctx, state, n } = this;
    if (!state) return;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;

    // COM
    let comX = 0, comY = 0;
    for (let i = 0; i < n; i++) { comX += state[4*i]; comY += state[4*i+1]; }
    comX /= n; comY /= n;

    // Auto-zoom: zoom out only when a body reaches the boundary; slow zoom-in back
    let maxExtent = 0;
    for (let i = 0; i < n; i++) {
      maxExtent = Math.max(maxExtent,
        Math.abs(state[4*i]   - comX),
        Math.abs(state[4*i+1] - comY));
    }
    if (maxExtent > 0) {
      const safePx = Math.min(W, H) / 2 * SAFE_FRAC;
      const prevScale = this.scale;
      if (maxExtent * this.scale > safePx) {
        this.scale = Math.max(0.001, safePx / maxExtent);
        if (Math.abs(this.scale - prevScale) / prevScale > 0.015) this._clearTrail();
      } else if (maxExtent * this.scale < safePx * 0.55 && this.scale < this._initialScale) {
        this.scale = Math.min(this._initialScale, this.scale * 1.001);
      }
    }

    const S = this.scale;
    const toSx = x => cx + (x - comX) * S;
    const toSy = y => cy - (y - comY) * S;

    // Background
    ctx.fillStyle = get('nb_bg') ?? '#0f1923';
    ctx.fillRect(0, 0, W, H);

    // Grid — snap to nice world unit (~80 px target spacing)
    const rawUnit = 80 / S;
    const exp10   = Math.pow(10, Math.floor(Math.log10(Math.max(rawUnit, 1e-12))));
    const frac    = rawUnit / exp10;
    const unit    = frac < 2 ? exp10 : frac < 5 ? 2 * exp10 : 5 * exp10;
    const dec     = Math.max(0, -Math.floor(Math.log10(Math.max(unit, 1e-12))));
    const fmt     = v => v.toFixed(dec);

    const GRID_COL   = 'rgba(60,100,140,0.35)';
    const LABEL_COL  = 'rgba(95,155,210,0.70)';
    const ORIGIN_COL = 'rgba(200,215,235,0.90)';

    const worldL = comX - cx / S, worldR = comX + cx / S;
    const worldB = comY - cy / S, worldT = comY + cy / S;

    ctx.font = '9px Consolas, monospace';
    ctx.textBaseline = 'alphabetic';

    // Vertical grid lines + x labels
    ctx.strokeStyle = GRID_COL; ctx.lineWidth = 0.5;
    ctx.fillStyle   = LABEL_COL;
    let wx = Math.ceil(worldL / unit) * unit;
    while (wx <= worldR + unit * 0.001) {
      const sx = toSx(wx);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      ctx.fillText(fmt(wx), sx + 2, H - 5);
      wx += unit;
    }

    // Horizontal grid lines + y labels
    let wy = Math.ceil(worldB / unit) * unit;
    while (wy <= worldT + unit * 0.001) {
      const sy = toSy(wy);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      ctx.fillText(fmt(wy), 4, sy - 3);
      wy += unit;
    }

    // Origin — bright dot + cross + label
    const ox = toSx(0), oy = toSy(0);
    if (ox > -10 && ox < W + 10 && oy > -10 && oy < H + 10) {
      ctx.strokeStyle = ORIGIN_COL; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox-10, oy); ctx.lineTo(ox+10, oy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy-10); ctx.lineTo(ox, oy+10); ctx.stroke();
      ctx.fillStyle = ORIGIN_COL;
      ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillText('(0, 0)', ox + 5, oy - 4);
    }

    // Trails
    const currPts = [];
    for (let i = 0; i < n; i++) currPts.push([toSx(state[4*i]), toSy(state[4*i+1])]);
    if (this._prevPts) {
      for (let i = 0; i < n; i++) {
        this._trailCtx.beginPath();
        this._trailCtx.moveTo(this._prevPts[i][0], this._prevPts[i][1]);
        this._trailCtx.lineTo(currPts[i][0], currPts[i][1]);
        this._trailCtx.strokeStyle = bodyColor(i, n, 0.55);
        this._trailCtx.lineWidth   = 1.5;
        this._trailCtx.stroke();
      }
    }
    this._prevPts = currPts;

    ctx.globalAlpha = 0.9;
    ctx.drawImage(this._trail, 0, 0);
    ctx.globalAlpha = 1.0;

    // Bodies — radius proportional to zoom; label when too small to see
    ctx.font = '9px Consolas, monospace';
    for (let i = 0; i < n; i++) {
      const sx    = toSx(state[4*i]);
      const sy    = toSy(state[4*i+1]);
      const color = bodyColor(i, n, 1.0);
      const rWorld = BODY_WORLD_R * S;

      if (rWorld < 4) {
        // Tiny: dot + labelled pointer line
        ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();

        const nameStr  = `B${i}`;
        const coordStr = `(${state[4*i].toFixed(2)}, ${state[4*i+1].toFixed(2)})`;
        const nameW    = ctx.measureText(nameStr).width;
        const coordW   = ctx.measureText(coordStr).width;
        const boxW     = Math.max(nameW, coordW) + 6;
        const lineLen  = 25;

        const goUp = (sy - lineLen - 26) > HUD_BOTTOM;
        const ty   = goUp ? sy - lineLen : sy + lineLen;

        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, ty); ctx.stroke();

        const ly = Math.max(HUD_BOTTOM + 2, goUp ? ty - 24 : ty + 2);

        ctx.fillStyle = 'rgba(10,20,30,0.82)';
        ctx.fillRect(sx - boxW/2 - 2, ly - 2, boxW + 4, 26);
        ctx.fillStyle = color;
        ctx.fillText(nameStr,  sx - nameW/2,  ly + 10);
        ctx.fillText(coordStr, sx - coordW/2, ly + 21);
      } else {
        const r = Math.max(3, Math.min(80, Math.round(rWorld)));
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }
}
