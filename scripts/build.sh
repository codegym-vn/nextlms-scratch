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

# Bundle hard-code webpack publicPath "/" (cả runtime chính lẫn runtime lồng của
# scratch-storage) → fetch-worker bị gọi ở /chunks/… của GỐC SITE. Dưới LMS trang
# nhúng nằm ở /scratch-editor/<ver>/ nên 404 → tài nguyên không nạp, editor kẹt
# ở màn chờ. Vá thành đọc biến index.html đặt sẵn (thư mục của trang).
PUBLIC_PATH='(typeof window!=="undefined"\&\&window.__NEXTLMS_SCRATCH_BASE__||"/")'
sed -E -i.bak "s#(__nested_webpack_require_[0-9]+__|__webpack_require__)\.p=\"/\"#\1.p=$PUBLIC_PATH#g" build/scratch-gui-standalone.js
rm -f build/scratch-gui-standalone.js.bak
PATCHED=$(grep -o '__NEXTLMS_SCRATCH_BASE__' build/scratch-gui-standalone.js | wc -l | tr -d ' ')
if [ "$PATCHED" -lt 2 ]; then
    echo "build: chỉ vá được $PATCHED/2 publicPath trong scratch-gui-standalone.js — bundle đổi hình dạng?" >&2
    exit 1
fi
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
