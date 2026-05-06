"""
docs/scripts/convert_n3_heatmap.py

Converts  nPendulum/data/heatmap_n3_d{d}_s{s}_*.npy  to a web-ready binary
and splits it into ≤ 90 MB chunks for GitHub Pages.

Binary format
  Part 0  : int32 n_slices, int32 rows, int32 cols, int32 n_parts  (16 bytes)
             followed by the first chunk of float32 LCE data
  Part 1+ : raw float32 data (no header)

The file is placed in  docs/data/  and named
  pendulum_heatmap_n3_{rows}x{cols}x{n_slices}.bin          (single file)
  pendulum_heatmap_n3_{rows}x{cols}x{n_slices}.part0.bin    (chunked)
  pendulum_heatmap_n3_{rows}x{cols}x{n_slices}.part1.bin    ...

Usage:
    python docs/scripts/convert_n3_heatmap.py
    python docs/scripts/convert_n3_heatmap.py path/to/heatmap_n3_d1000_s50.npy
"""

import sys
import struct
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# ── Locate the .npy file ────────────────────────────────────────────────────
if len(sys.argv) > 1:
    npy_path = Path(sys.argv[1]).resolve()
else:
    candidates = sorted((ROOT / "nPendulum" / "data").glob("heatmap_n3_*.npy"))
    if not candidates:
        print("No heatmap_n3_*.npy files found in nPendulum/data/")
        raise SystemExit(1)
    npy_path = candidates[-1]
    print(f"Auto-selected: {npy_path.name}")

print(f"Loading {npy_path} …")
grid = np.load(str(npy_path))   # expected shape: (n_slices, rows, cols)

if grid.ndim != 3:
    print(f"Expected 3D array (n_slices, rows, cols), got shape {grid.shape}")
    raise SystemExit(1)

n_slices, rows, cols = grid.shape
total_mb = grid.nbytes / 1e6
print(f"  Shape: {n_slices} slices × {rows} × {cols}   ({total_mb:.0f} MB float32)")

# ── Flatten to float32 bytes (C order: slice varies slowest) ────────────────
data_bytes = grid.astype(np.float32).tobytes()

# ── Split into ≤ 90 MB chunks ───────────────────────────────────────────────
CHUNK = 90 * 1024 * 1024          # 90 MB per file
HDR   = 16                         # 4 × int32 header on part 0

chunks, pos = [], 0
first = True
while pos < len(data_bytes):
    cap = (CHUNK - HDR) if first else CHUNK
    chunks.append(data_bytes[pos : pos + cap])
    pos  += cap
    first = False

n_parts = len(chunks)

# ── Write output files ───────────────────────────────────────────────────────
out_dir  = ROOT / "docs" / "data"
out_dir.mkdir(exist_ok=True)
stem = f"pendulum_heatmap_n3_{rows}x{cols}x{n_slices}"

for i, chunk in enumerate(chunks):
    if n_parts == 1:
        name = f"{stem}.bin"
    else:
        name = f"{stem}.part{i}.bin"
    path = out_dir / name
    with open(path, "wb") as f:
        if i == 0:
            f.write(struct.pack("iiii", n_slices, rows, cols, n_parts))
        f.write(chunk)
    print(f"  → {name}  ({path.stat().st_size / 1e6:.1f} MB)")

print(f"\nDone — {n_parts} file(s) written to {out_dir}")
print(f"Commit them to git, then the website will load:")
print(f"  data/{stem}.bin")
