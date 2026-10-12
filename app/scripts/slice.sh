#!/usr/bin/env bash
# Slice design/kq1bgs.png (12×7 grid of 320×168 tiles, pixels doubled horizontally)
# into 82 logical 160×168 reference tiles: reference/kq1/rRR-cCC.png.
# The last two tiles (blank + "ripped by napalm" credit) are skipped.
# Requires ImageMagick 7 (`magick`). Run `pnpm exec tsx app/scripts/slice-verify.ts` afterwards.
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
magick design/kq1bgs.png -crop 320x168 +repage -sample 50%x100% +adjoin "$tmp/t%02d.png"
mkdir -p reference/kq1
for i in $(seq 0 81); do
  r=$((i / 12 + 1)); c=$((i % 12 + 1))
  cp "$tmp/t$(printf %02d "$i").png" "reference/kq1/r$(printf %02d "$r")-c$(printf %02d "$c").png"
done
echo "sliced 82 tiles into reference/kq1/"
