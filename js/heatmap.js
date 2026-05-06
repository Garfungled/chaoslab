// Heatmap loader, renderer with zoom/pan, colormap, click/hover
import { viridis, normLCE } from './utils.js';

export async function loadBin(url) {
  // Try chunked format first (.part0.bin).
  // Files > 90 MB are split by website/scripts/split_large_bins.py.
  const part0url = url.replace(/\.bin$/, '.part0.bin');
  const r0 = await fetch(part0url);

  if (r0.ok) {
    const buf0   = await r0.arrayBuffer();
    const hdr    = new Int32Array(buf0, 0, 3);          // rows, cols, nParts
    const rows   = hdr[0], cols = hdr[1], nParts = hdr[2];

    // Fetch all remaining parts in parallel
    const restBufs = await Promise.all(
      Array.from({ length: nParts - 1 }, (_, i) =>
        fetch(url.replace(/\.bin$/, `.part${i + 1}.bin`)).then(r => r.arrayBuffer())
      )
    );

    // Concatenate: part0 has a 12-byte header (3 × int32), the rest have none
    const parts = [new Float32Array(buf0, 12), ...restBufs.map(b => new Float32Array(b))];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const data  = new Float32Array(total);
    let   off   = 0;
    for (const p of parts) { data.set(p, off); off += p.length; }

    return { rows, cols, data };
  }

  // Single-file format (original, for files ≤ 90 MB)
  const resp = await fetch(url);
  const buf  = await resp.arrayBuffer();
  const hdr  = new Int32Array(buf, 0, 2);
  return { rows: hdr[0], cols: hdr[1], data: new Float32Array(buf, 8) };
}

// Load a 3-D heatmap binary (n_slices × rows × cols float32).
// Part-0 header: int32 n_slices, int32 rows, int32 cols, int32 n_parts (16 bytes).
// Subsequent parts have no header — raw float32 data only.
export async function loadBin3D(url) {
  const part0url = url.replace(/\.bin$/, '.part0.bin');
  const r0 = await fetch(part0url);

  if (r0.ok) {
    const buf0   = await r0.arrayBuffer();
    const hdr    = new Int32Array(buf0, 0, 4);   // nSlices, rows, cols, nParts
    const [nSlices, rows, cols, nParts] = hdr;

    // Fetch remaining parts, checking each response before reading bytes
    const restResps = await Promise.all(
      Array.from({ length: nParts - 1 }, (_, i) =>
        fetch(url.replace(/\.bin$/, `.part${i + 1}.bin`))
      )
    );
    for (const r of restResps) {
      if (!r.ok) throw new Error(`Part file missing (${r.status}) — run convert_n3_heatmap.py and commit all .partN.bin files`);
    }
    const restBufs = await Promise.all(restResps.map(r => r.arrayBuffer()));

    const parts = [new Float32Array(buf0, 16), ...restBufs.map(b => new Float32Array(b))];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const data  = new Float32Array(total);
    let   off   = 0;
    for (const p of parts) { data.set(p, off); off += p.length; }
    return { nSlices, rows, cols, data };
  }

  // Single file — check status before reading bytes to avoid HTML-body alignment errors
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(
    `Data file not found (${resp.status}). Run:  python docs/scripts/convert_n3_heatmap.py`);
  const buf = await resp.arrayBuffer();
  const hdr = new Int32Array(buf, 0, 3);
  return { nSlices: hdr[0], rows: hdr[1], cols: hdr[2], data: new Float32Array(buf, 12) };
}

// Pre-render the full heatmap to an OffscreenCanvas or regular canvas
export function prerender(data, rows, cols, cmapFn = viridis) {
  const off = document.createElement('canvas');
  off.width = cols; off.height = rows;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(cols, rows);

  const pos = Array.from(data).filter(v => v > 0).sort((a,b) => a-b);
  const vmin = pos[Math.floor(pos.length * 0.05)] ?? 0;
  const vmax = pos[Math.floor(pos.length * 0.99)] ?? 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v   = data[r * cols + c];
      const t   = normLCE(v, vmin, vmax);
      const rgb = cmapFn(t);
      const idx = ((rows - 1 - r) * cols + c) * 4;
      img.data[idx]   = rgb[0];
      img.data[idx+1] = rgb[1];
      img.data[idx+2] = rgb[2];
      img.data[idx+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { offscreen: off, vmin, vmax };
}

export function renderColorbar(canvas, vmin, vmax, steps = 200, cmapFn = viridis) {
  canvas.height = steps;
  canvas.width  = 18;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < steps; i++) {
    const rgb = cmapFn(i / (steps - 1));
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.fillRect(0, steps - 1 - i, 18, 1);
  }
}

// Attach zoom/pan + hover/click to a display canvas.
// Returns { updateOffscreen(newOffscreen) } for live colormap updates.
export function attachInteraction(displayCanvas, offscreenIn, data, rows, cols,
                                  dataRange, onHover, onClick) {
  const W = displayCanvas.width, H = displayCanvas.height;
  const tooltip = displayCanvas.parentElement.querySelector('.heatmap-tooltip');
  const ctx = displayCanvas.getContext('2d');
  let offscreen = offscreenIn;

  let view = { srcX: 0, srcY: 0, srcW: cols, srcH: rows };

  function render() {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen,
      view.srcX, view.srcY, view.srcW, view.srcH,
      0, 0, W, H);
  }

  function canvasToData(px, py) {
    const srcCol = view.srcX + (px / W)  * view.srcW;
    const srcRow = view.srcY + (py / H)  * view.srcH;
    const dataRow = rows - 1 - srcRow;
    const { xMin, xMax, yMin, yMax } = dataRange;
    const x = xMin + (srcCol / cols) * (xMax - xMin);
    const y = yMin + (dataRow / rows) * (yMax - yMin);
    const lce = data[Math.round(dataRow) * cols + Math.round(srcCol)] ?? 0;
    return { x, y, lce };
  }

  function clampView() {
    view.srcW = Math.max(10, Math.min(cols, view.srcW));
    view.srcH = Math.max(10, Math.min(rows, view.srcH));
    view.srcX = Math.max(0, Math.min(cols - view.srcW, view.srcX));
    view.srcY = Math.max(0, Math.min(rows - view.srcH, view.srcY));
  }

  render();

  displayCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.85 : 1.0 / 0.85;
    const mx = e.offsetX / W;
    const my = e.offsetY / H;
    const newW = view.srcW * zoomFactor;
    const newH = view.srcH * zoomFactor;
    view.srcX += (view.srcW - newW) * mx;
    view.srcY += (view.srcH - newH) * my;
    view.srcW = newW;
    view.srcH = newH;
    clampView();
    render();
  }, { passive: false });

  let dragging = false, dragStartX = 0, dragStartY = 0, dragView0 = null;
  displayCanvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true;
    dragStartX = e.offsetX; dragStartY = e.offsetY;
    dragView0  = { ...view };
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = (e.offsetX - dragStartX) / W * dragView0.srcW;
    const dy = (e.offsetY - dragStartY) / H * dragView0.srcH;
    view.srcX = dragView0.srcX - dx;
    view.srcY = dragView0.srcY - dy;
    clampView();
    render();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  displayCanvas.addEventListener('dblclick', () => {
    view = { srcX: 0, srcY: 0, srcW: cols, srcH: rows };
    render();
  });

  displayCanvas.addEventListener('mousemove', e => {
    if (dragging) return;
    const { x, y, lce } = canvasToData(e.offsetX, e.offsetY);
    if (tooltip) {
      tooltip.style.display = 'block';
      tooltip.style.left = (e.offsetX + 12) + 'px';
      tooltip.style.top  = (e.offsetY - 22) + 'px';
      tooltip.textContent = `(${x.toFixed(4)}, ${y.toFixed(4)})  LCE=${lce.toFixed(4)}`;
    }
    if (onHover) onHover(x, y, lce);
  });
  displayCanvas.addEventListener('mouseleave', () => {
    if (tooltip) tooltip.style.display = 'none';
  });

  displayCanvas.addEventListener('click', e => {
    if (dragging) return;
    const { x, y, lce } = canvasToData(e.offsetX, e.offsetY);
    if (onClick) onClick(x, y, lce);
  });

  return {
    updateOffscreen(newOffscreen) {
      offscreen = newOffscreen;
      render();
    },
  };
}
