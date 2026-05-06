"""
Prepares binary data files for the website heatmaps.

1. Converts double/fastData/data/data_1000x1000.csv  → data/pendulum_heatmap_1000.bin
2. Generates nBody 2-body heatmap at 500×500           → data/nbody_heatmap_500.bin

Run from the project root:
  python website/scripts/prepare_data.py
"""

import os
import sys
import struct
import subprocess
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT  = os.path.join(ROOT, "website", "data")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------------------
# 1. Pendulum heatmap — convert CSV to Float32 binary
# ---------------------------------------------------------------------------
csv_path = os.path.join(ROOT, "double", "fastData", "data", "data_1000x1000.csv")
bin_path = os.path.join(OUT, "pendulum_heatmap_1000.bin")

if os.path.exists(bin_path):
    print(f"Skipping pendulum heatmap — {bin_path} already exists")
else:
    print(f"Converting {csv_path} ...")
    if not os.path.exists(csv_path):
        print(f"  WARNING: {csv_path} not found — skipping")
    else:
        data = np.loadtxt(csv_path, delimiter=",", dtype=np.float32)
        print(f"  Loaded {data.shape}  min={data.min():.4f}  max={data.max():.4f}")
        # Write header (2 x int32: rows, cols) then flat float32 array
        with open(bin_path, "wb") as f:
            f.write(struct.pack("<ii", data.shape[0], data.shape[1]))
            data.astype(np.float32).tofile(f)
        size_mb = os.path.getsize(bin_path) / 1e6
        print(f"  Written {bin_path}  ({size_mb:.1f} MB)")

# ---------------------------------------------------------------------------
# 2. N-body heatmap — run heatmap_2d.py then convert .npy cache to binary
# ---------------------------------------------------------------------------
nbody_bin = os.path.join(OUT, "nbody_heatmap_500.bin")

if os.path.exists(nbody_bin):
    print(f"Skipping n-body heatmap — {nbody_bin} already exists")
else:
    print("Generating n-body heatmap (500×500) via GPU...")
    nbody_dir    = os.path.join(ROOT, "nBody")
    heatmap_script = os.path.join(nbody_dir, "heatmap_2d.py")

    # Run heatmap_2d.py — it saves a .npy cache in nBody/data/
    result = subprocess.run(
        [sys.executable, heatmap_script, "--res", "500",
         "--total-time", "60", "--epsilon", "0.001"],
        cwd=nbody_dir
    )
    if result.returncode != 0:
        print("  n-body heatmap generation failed — skipping")
    else:
        # Find the .npy cache file it wrote
        npy_files = [f for f in os.listdir(os.path.join(nbody_dir, "data"))
                     if f.startswith("heatmap2d_") and f.endswith(".npy")]
        if not npy_files:
            print("  .npy cache not found — skipping")
        else:
            npy_path = os.path.join(nbody_dir, "data", npy_files[0])
            lce_flat = np.load(npy_path).astype(np.float32)
            res = int(np.sqrt(len(lce_flat)))
            with open(nbody_bin, "wb") as f:
                f.write(struct.pack("<ii", res, res))
                lce_flat.tofile(f)
            size_mb = os.path.getsize(nbody_bin) / 1e6
            print(f"  Written {nbody_bin}  ({size_mb:.1f} MB)")

print("\nDone.")
