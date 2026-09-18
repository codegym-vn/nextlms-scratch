#!/usr/bin/env bash
# Dựng thư mục phát hành `build/` rồi đóng gói thành tarball có phiên bản.
#
#   build/
#     index.html, host.js, storage.js, about.js     ← src/ (VERSION thay vào about.js)
#     scratch-gui-standalone.js, chunks/, static/,  ← dist/ của gói npm, nguyên vẹn
#     libraries/, extension-worker.js, *.hex
#     library/                                      ← bản sao media (scripts/fetch-library.mjs)
#     LICENSE, TRADEMARK, VERSION
#   nextlms-scratch-<version>.tar.gz + .sha256
#
# KHÔNG nén sẵn .gz ở đây: gz lồng trong tar.gz làm tarball to gấp đôi mà
# không nén thêm được gì. Bên nhận (`php artisan scratch:install-editor`) chạy
# scripts/precompress.sh sau khi giải nén để nginx `gzip_static` có tệp .gz.
# Chỉ dùng công cụ có trong image node:22 / php của LMS: cp, find, gzip, tar.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
GUI_DIR="node_modules/@scratch/scratch-gui"

[ -d library ] || { echo "library/ missing — run: npm run fetch-library" >&2; exit 1; }

rm -rf build
mkdir -p build

# dist của scratch-gui, bỏ source map (27 MB mỗi cái) và bản lib (không dùng).
cp -R "$GUI_DIR/dist/." build/
find build -name '*.map' -delete
rm -f build/scratch-gui.js build/scratch-gui.js.LICENSE.txt
cp src/index.html src/host.js src/storage.js build/
sed "s/__VERSION__/$VERSION/" src/about.js > build/about.js
cp -R library build/library
cp LICENSE TRADEMARK build/
echo "$VERSION" > build/VERSION

cp scripts/precompress.sh build/precompress.sh

TARBALL="nextlms-scratch-$VERSION.tar.gz"
tar -czf "$TARBALL" -C build .
sha256sum "$TARBALL" > "$TARBALL.sha256"
du -sh build "$TARBALL"
