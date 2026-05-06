"""
website/scripts/split_large_bins.py

Splits .bin heatmap files that exceed 90 MB into .part0.bin, .part1.bin, ...
so they stay under GitHub Pages' 100 MB per-file limit.

Files ≤ 90 MB are left untouched as plain .bin files.
Files already split (.partN.bin) are skipped.

The JavaScript loadBin() in heatmap.js auto-detects chunked files by
trying <name>.part0.bin first, then falling back to the single .bin.

Part 0 header  : int32 rows, int32 cols, int32 n_parts  (12 bytes)
Part 1+ header : none  (raw float32 data only)

Usage:
    python website/scripts/split_large_bins.py
"""

import struct
from pathlib import Path

LIMIT_BYTES = 90 * 1024 * 1024   # split files above this size
CHUNK_BYTES = 90 * 1024 * 1024   # each chunk is at most this large

data_dir = Path(__file__).resolve().parent.parent / "data"

if not data_dir.exists():
    print(f"Data directory not found: {data_dir}")
    raise SystemExit(1)

bins = sorted(p for p in data_dir.glob("*.bin") if ".part" not in p.name)

if not bins:
    print(f"No .bin files found in {data_dir}")
    raise SystemExit(0)

for bf in bins:
    size = bf.stat().st_size

    if size <= LIMIT_BYTES:
        print(f"  {bf.name:<45} {size/1e6:6.1f} MB  — no split needed")
        continue

    print(f"  {bf.name:<45} {size/1e6:6.1f} MB  — splitting...")

    with open(bf, "rb") as f:
        header  = f.read(8)        # int32 rows, int32 cols
        payload = f.read()         # raw float32 data

    rows, cols = struct.unpack("ii", header)

    # Build chunks from the raw payload
    chunks = [payload[i:i + CHUNK_BYTES] for i in range(0, len(payload), CHUNK_BYTES)]
    n = len(chunks)

    for i, chunk in enumerate(chunks):
        out = bf.with_name(bf.stem + f".part{i}.bin")
        with open(out, "wb") as f:
            if i == 0:
                # Extended header so JS knows how many parts to fetch
                f.write(struct.pack("iii", rows, cols, n))
            f.write(chunk)
        print(f"    → {out.name:<48} {out.stat().st_size/1e6:6.1f} MB")

    # Remove the original — chunks replace it
    bf.unlink()
    print(f"    Removed original {bf.name}")

print("\nDone. Commit the .partN.bin files to git.")
print("Run this script again any time you add new large .bin files.")
