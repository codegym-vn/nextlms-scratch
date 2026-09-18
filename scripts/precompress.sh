#!/usr/bin/env bash
# Nén sẵn .gz (và .br nếu có brotli) cho mọi tệp text > 1 KB trong thư mục đã
# giải nén, để nginx `gzip_static on` phục vụ 17 MB JS mà không nén lại cho
# từng client lạnh. Chạy bởi `php artisan scratch:install-editor` của LMS,
# hoặc tay: bash precompress.sh <thư mục>.
set -euo pipefail
DIR="${1:-$(dirname "$0")}"
find "$DIR" -type f \( -name '*.js' -o -name '*.json' -o -name '*.svg' -o -name '*.css' -o -name '*.html' -o -name '*.wasm' \) -size +1k -print0 \
    | xargs -0 -P 4 -I{} sh -c 'gzip -9 -k -f "{}"; if command -v brotli >/dev/null 2>&1; then brotli -q 9 -f "{}"; fi'
