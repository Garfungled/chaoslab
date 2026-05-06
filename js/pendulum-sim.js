// n-Pendulum simulation — LCE visualisation + settings-driven colors
// Delta-time accumulator: monitor-rate independent

import { get } from './settings.js';

const G  = 9.80665;
const DT = 1 / 120;

function pendulumF(state, n) {
  const thetas = state.slice(0, n);
  const omegas = state.slice(n, 2 * n);
  const A = Array.from({ length: n }, () => new Float64Array(n));
  const B = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ms_i = n - i;
    B[i] = -G * Math.sin(thetas[i]) * ms_i;
    for (let j = 0; j < n; j++) {
      const ms_ij = n - Math.max(i, j);
      A[i][j] = Math.cos(thetas[i] - thetas[j]) * ms_ij;
      if (j !== i)
        B[i] -= omegas[j] ** 2 * Math.sin(thetas[i] - thetas[j]) * ms_ij;
    }
  }
  for (let col = 0; col < n; col++) {
    for (let row = col + 1; row < n; row++) {
      const f = A[row][col] / A[col][col];
      for (let k = col; k < n; k++) A[row][k] -= f * A[col][k];
      B[row] -= f * B[col];
    }
  }
  const alphas = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    alphas[i] = B[i];
    for (let j = i + 1; j < n; j++) alphas[i] -= A[i][j] * alphas[j];
    alphas[i] /= A[i][i];
  }
  return [...omegas, ...alphas];
}

function rk4Step(state, n) {
  const f = s => pendulumF(s, n);
  const k1 = f(state);
  const k2 = f(state.map((v, i) => v + DT/2 * k1[i]));
  const k3 = f(state.map((v, i) => v + DT/2 * k2[i]));
  const k4 = f(state.map((v, i) => v + DT   * k3[i]));
  return state.map((v, i) => v + DT/6 * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
}

function getPositions(thetas, n, SCALE, cx, cy) {
  const pts = [];
  let x = cx, y = cy;
  for (let i = 0; i < n; i++) {
    x += SCALE * Math.sin(thetas[i]);
    y += SCALE * Math.cos(thetas[i]);
    pts.push([x, y]);
  }
  return pts;
}

export class PendulumSim {
  constructor(canvas, n = 2) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.n       = n;
    this.running = false;
    this.state   = null;
    this.pert    = null;
    this.lceSum  = 0;
    this.lceTime = 0;
    this.lceEps  = get('pend_lce_eps') ?? 1e-6;
    this.dI      = this.lceEps;
    this.lce          = 0;
    this.elapsed      = 0;
    this.separation   = 0;
    this.rescaleCount = 0;
    this.logRatio     = 0;
    this.lceMode      = false;
    this.vispert      = null;
    this.visOffset    = get('pend_vis_eps') ?? 0.05;
    this.onLCE   = null;
    this._raf    = null;
    this._accumulator   = 0;
    this._lastTimestamp = null;
    this._prevTip      = null;
    this._prevPertTip  = null;

    this._trail    = document.createElement('canvas');
    this._trail.width  = canvas.width;
    this._trail.height = canvas.height;
    this._trailCtx = this._trail.getContext('2d');

    this._pertTrail    = document.createElement('canvas');
    this._pertTrail.width  = canvas.width;
    this._pertTrail.height = canvas.height;
    this._pertTrailCtx = this._pertTrail.getContext('2d');

    this._clearTrail();
  }

  _clearTrail() {
    // Transparent — background filled fresh each frame in _draw()
    this._trailCtx.clearRect(0, 0, this._trail.width, this._trail.height);
    this._pertTrailCtx.clearRect(0, 0, this._pertTrail.width, this._pertTrail.height);
    this._prevTip     = null;
    this._prevPertTip = null;
  }

  reset(thetas) {
    this.n        = thetas.length;
    this.lceEps   = get('pend_lce_eps') ?? 1e-6;
    this.visOffset = get('pend_vis_eps') ?? 0.05;
    this.state    = [...thetas, ...new Array(this.n).fill(0)];
    this.pert     = [...this.state];
    this.pert[0] += this.lceEps;
    this.vispert  = [...this.state];
    this.vispert[0] += this.visOffset;
    this.lceSum       = 0;
    this.lceTime      = 0;
    this.dI           = this.lceEps;
    this.lce          = 0;
    this.elapsed      = 0;
    this.separation   = this.lceEps;
    this.rescaleCount = 0;
    this.logRatio     = 0;
    this._accumulator    = 0;
    this._lastTimestamp  = null;
    this._clearTrail();
    this._draw();
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
    this._accumulator += elapsed;
    let steps = 0;
    while (this._accumulator >= DT && steps < 20) {
      this._step();
      this._accumulator -= DT;
      steps++;
    }
    this._draw();
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  _step() {
    if (!this.state) return;
    this.state    = rk4Step(this.state,   this.n);
    this.pert     = rk4Step(this.pert,    this.n);
    this.vispert  = rk4Step(this.vispert, this.n);
    this.lceTime += DT;
    this.elapsed += DT;

    let d2 = 0;
    for (let i = 0; i < 2 * this.n; i++) {
      const d = this.pert[i] - this.state[i]; d2 += d * d;
    }
    this.separation = Math.sqrt(d2);

    if (Math.round(this.lceTime / DT) % 10 === 0) {
      const dF = this.separation;
      if (dF > 0) {
        const ratio = dF / this.dI;
        this.lceSum   += Math.log(ratio);
        this.logRatio  = Math.log(ratio);
        this.rescaleCount++;
        const sc = this.dI / dF;
        for (let i = 0; i < 2 * this.n; i++)
          this.pert[i] = this.state[i] + (this.pert[i] - this.state[i]) * sc;
        let d2b = 0;
        for (let i = 0; i < 2 * this.n; i++) {
          const d = this.pert[i] - this.state[i]; d2b += d*d;
        }
        this.dI = Math.sqrt(d2b) || this.lceEps;
        this.separation = this.dI;
      }
      this.lce = Math.max(this.lceSum / this.lceTime, 0);
      if (this.onLCE) this.onLCE(this.lce);
    }
  }

  _draw() {
    const { canvas, ctx, state, vispert, n, lceMode } = this;
    if (!state) return;
    const W = canvas.width, H = canvas.height;
    const SCALE     = (W / 850) * 400 / n;
    const bobRadius = Math.max(3, Math.round((W / 850) * 15 / n));
    const pivRadius = Math.max(3, Math.round(bobRadius / 2));
    const cx = W / 2, cy = H / 2;

    // Read colors from settings each frame
    const bgColor    = get('pend_bg')    ?? '#ffffff';
    const rodColor   = get('pend_rod')   ?? '#000000';
    const bobColor   = get('pend_bob')   ?? '#0000c8';
    const trailColor = get('pend_trail') ?? '#e6e6e6';
    const trailW     = get('pend_trail_w') ?? 1;
    const pertColor  = get('pend_pert')  ?? '#dc3c00';
    const showStats  = get('show_stats') ?? true;

    const refThetas  = state.slice(0, n);
    const visThetas  = vispert ? vispert.slice(0, n) : null;
    const refPts  = getPositions(refThetas, n, SCALE, cx, cy);
    const pertPts = visThetas  ? getPositions(visThetas, n, SCALE, cx, cy) : null;
    const tip     = refPts[n - 1];
    const pertTip = pertPts ? pertPts[n - 1] : null;

    // Draw reference trail segment
    if (this._prevTip) {
      this._trailCtx.beginPath();
      this._trailCtx.moveTo(this._prevTip[0], this._prevTip[1]);
      this._trailCtx.lineTo(tip[0], tip[1]);
      this._trailCtx.strokeStyle = trailColor;
      this._trailCtx.lineWidth   = trailW;
      this._trailCtx.stroke();
    }
    this._prevTip = [tip[0], tip[1]];

    // Draw perturbed trail (LCE mode only)
    if (lceMode && pertTip && this._prevPertTip) {
      this._pertTrailCtx.globalAlpha = 0.45;
      this._pertTrailCtx.beginPath();
      this._pertTrailCtx.moveTo(this._prevPertTip[0], this._prevPertTip[1]);
      this._pertTrailCtx.lineTo(pertTip[0], pertTip[1]);
      this._pertTrailCtx.strokeStyle = pertColor;
      this._pertTrailCtx.lineWidth   = trailW;
      this._pertTrailCtx.stroke();
      this._pertTrailCtx.globalAlpha = 1.0;
    }
    if (pertTip) this._prevPertTip = [pertTip[0], pertTip[1]];

    // Composite: background → trails → pendulums
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this._trail, 0, 0);
    if (lceMode) ctx.drawImage(this._pertTrail, 0, 0);

    // Perturbed pendulum (behind reference)
    if (lceMode && pertPts) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = pertColor; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(pertPts[0][0], pertPts[0][1]); ctx.stroke();
      for (let i = 0; i < n - 1; i++) {
        ctx.beginPath(); ctx.moveTo(pertPts[i][0], pertPts[i][1]);
        ctx.lineTo(pertPts[i+1][0], pertPts[i+1][1]); ctx.stroke();
      }
      for (let i = 0; i < n; i++) {
        ctx.beginPath(); ctx.arc(pertPts[i][0], pertPts[i][1], bobRadius, 0, Math.PI * 2);
        ctx.fillStyle = pertColor; ctx.fill();
        ctx.strokeStyle = rodColor; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // Separation line
      ctx.beginPath();
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(pertTip[0], pertTip[1]);
      ctx.strokeStyle = 'rgba(0,180,0,0.8)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Reference pendulum
    ctx.strokeStyle = rodColor; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(refPts[0][0], refPts[0][1]); ctx.stroke();
    for (let i = 0; i < n - 1; i++) {
      ctx.beginPath(); ctx.moveTo(refPts[i][0], refPts[i][1]);
      ctx.lineTo(refPts[i+1][0], refPts[i+1][1]); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, pivRadius, 0, Math.PI * 2);
    ctx.fillStyle = rodColor; ctx.fill();
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.arc(refPts[i][0], refPts[i][1], bobRadius, 0, Math.PI * 2);
      ctx.fillStyle = bobColor; ctx.fill();
      ctx.strokeStyle = rodColor; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Stats overlay
    if (showStats) {
      const fs = Math.max(9, 13 - n);
      // Compute readable text color from background
      const textColor = _contrastColor(bgColor);
      ctx.font      = `${fs}px Consolas, monospace`;
      ctx.fillStyle = textColor;
      const omegas  = state.slice(n, 2 * n).map(v => v.toFixed(3));
      ctx.fillText(`${n} pendulums   t = ${this.elapsed.toFixed(1)} s   dt = ${DT.toFixed(4)}`, 8, fs + 4);
      ctx.fillText(`LCE = ${this.lce.toFixed(5)}   omega = [${omegas.join(', ')}]`, 8, fs * 2 + 8);

      if (lceMode) {
        const pad = 8, lh = fs + 3;
        let visSep = 0;
        if (this.vispert) {
          for (let i = 0; i < n; i++) {
            const d = this.vispert[i] - state[i]; visSep += d*d;
          }
          visSep = Math.sqrt(visSep);
        }
        const lines = [
          '-- LCE Computation --',
          `delta_th1 (visual) = ${this.visOffset} rad`,
          `delta_th1 (LCE e0) = ${this.lceEps.toExponential(1)}`,
          `||d_LCE|| = ${this.separation.toExponential(3)}`,
          `||d_visual|| = ${visSep.toFixed(4)}`,
          `ln(dF/dI) = ${this.logRatio.toFixed(4)}`,
          `Rescales = ${this.rescaleCount}`,
          `LCE = ${this.lce.toFixed(5)}`,
        ];
        const panW = 170, panH = lines.length * lh + pad * 2;
        const px = W - panW - 8, py = 8;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(px - 4, py - 4, panW + 8, panH + 8);
        ctx.strokeStyle = '#aaa'; ctx.lineWidth = 0.8;
        ctx.strokeRect(px - 4, py - 4, panW + 8, panH + 8);
        ctx.fillStyle = '#000';
        lines.forEach((line, i) => {
          if (i === 0) { ctx.font = `bold ${fs}px Consolas, monospace`; }
          else         { ctx.font = `${fs}px Consolas, monospace`; }
          ctx.fillText(line, px, py + i * lh + lh);
        });

        // Legend
        ctx.font = `${fs}px Consolas, monospace`;
        const ly = H - fs * 3 - 12;
        ctx.fillStyle = bobColor;
        ctx.fillRect(8, ly, 14, 14);
        ctx.fillStyle = textColor;
        ctx.fillText('Reference trajectory', 28, ly + 11);
        ctx.fillStyle = pertColor;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(8, ly + lh + 2, 14, 14);
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = textColor;
        ctx.fillText(`Perturbed (delta_th1 = ${this.visOffset} rad)`, 28, ly + lh + 13);
        ctx.strokeStyle = 'rgba(0,180,0,0.8)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.moveTo(8, ly + lh*2 + 10); ctx.lineTo(22, ly + lh*2 + 10); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = textColor;
        ctx.fillText('Separation ||delta(t)||', 28, ly + lh*2 + 14);
      }
    }
  }
}

// Return black or white depending on background luminance
function _contrastColor(hex) {
  const c = hex.replace('#', '');
  if (c.length !== 6) return '#000000';
  const r = parseInt(c.slice(0,2), 16);
  const g = parseInt(c.slice(2,4), 16);
  const b = parseInt(c.slice(4,6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 128 ? '#000000' : '#ffffff';
}
