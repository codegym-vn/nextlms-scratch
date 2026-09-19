# nextlms-scratch

Trang nhúng trình soạn Scratch cho NextLMS. Repo này **không sửa** mã nguồn Scratch: nó lấy bản build sẵn `dist/` của gói npm [`@scratch/scratch-gui`](https://github.com/scratchfoundation/scratch-editor) (AGPL-3.0) nguyên vẹn, thêm một trang HTML + ~300 dòng JS gọi API nhúng công khai (`createStandaloneRoot`, hợp đồng `GUIStorage`) để trỏ kho lưu về LMS, kèm bản sao thư viện media để không request nào rời máy chủ của trường.

Giấy phép: AGPL-3.0-only (xem `LICENSE`). Nhãn hiệu: xem `TRADEMARK` — không dùng logo/mèo Scratch, màn hình Giới thiệu ghi "Based on Scratch from the MIT Media Laboratory".

## Build

```bash
npm ci                 # tải @scratch/scratch-gui@15.1.1 (≈150 MB)
npm run fetch-library  # 1.348 tệp ≈ 57 MB từ cdn.assets.scratch.mit.edu → library/
npm run build          # build/ + nextlms-scratch-<version>.tar.gz + .sha256 (≈130 MB)
```

Tarball chứa: `index.html`, `host.js`, `storage.js`, `about.js`, `precompress.sh`, `scratch-gui-standalone.js` (17 MB), `chunks/`, `static/`, `libraries/`, `library/`, `LICENSE`, `TRADEMARK`, `VERSION`. ⚠ SHA256 phụ thuộc mtime/thứ tự trong tar nên **chỉ SHA của tarball trên GitHub Release là chuẩn**; bản build local khác SHA là bình thường. Không nén sẵn `.gz` (gz lồng tar.gz phình gấp đôi); bên nhận chạy `precompress.sh` sau khi giải nén để nginx `gzip_static` dùng.

Máy không có Node: mọi lệnh chạy được trong image php của LMS (`docker run --rm --entrypoint node -v "$PWD":/w -w /w next-lms-v2-php-test scripts/fetch-library.mjs`).

## Thử không cần LMS

```bash
npm run serve          # http://localhost:8602/?project=new — kho giả trong bộ nhớ, cùng giao thức
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/smoke.mjs
```

`scripts/smoke.mjs` lái Chrome headless qua DevTools Protocol: đợi `scratch:ready`, **soi giao diện** (bảng khối + sprite + sân khấu ở `mode=editor`, không logo; chỉ sân khấu ở `mode=player`), kiểm editor tự tạo dự án (POST), ép lưu bằng `postMessage` (PUT, `requestIds`), **mở lại dự án đã lưu**, xác nhận mọi request 2xx/3xx và không request nào rời origin. ⚠ Chạy dev-server với `PREFIX=/scratch-editor/x` (`BASE=http://localhost:8602/scratch-editor/x`) để mô phỏng LMS — bản 0.1.0/0.1.1 từng "xanh" ở gốc `/` mà dưới sub-path fetch-worker 404, và `isEmbedded` từng khiến `mode=editor` chỉ vẽ sân khấu suốt hai bản mà smoke không nhìn giao diện. Thumbnail thư viện nhân vật chưa kiểm tự động được (modal không render trong headless) — QA tay khi cài vào LMS.

## Giao thức với LMS — tài liệu chuẩn

### Query string của trang nhúng

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `project` | `new` | id dự án, hoặc `new` → nạp dự án mặc định rồi editor **tự POST tạo** (`canCreateNew`) |
| `mode` | `editor` | `editor` \| `player` (chỉ sân khấu, `isPlayerOnly`) |
| `locale` | `vi` | mã trong `scratch-l10n` |
| `title` | — | tên dùng khi tạo mới (thắng "Scratch Project") |
| `autosave` | `60` | giây, tối thiểu 15 |
| `csrf` | đọc `<meta name="csrf-token">` của trang cha | token gửi trong `X-CSRF-TOKEN` cho POST/PUT do trang này tự gọi; query chỉ để thử tay (query lọt vào access log/Referer) |
| `projectHost` / `assetHost` / `libraryHost` | `/scratch/api/projects` / `/scratch/api/assets` / `library` | nơi lưu; đường dẫn tương đối |

### HTTP (hình dạng của scratch-storage, LMS phục vụ đúng như vậy)

| | |
|---|---|
| `GET {projectHost}/{id}` | `project.json` |
| `POST {projectHost}/?title=…` (body JSON) | `{"status":"ok","content-name":"<id>"}` |
| `PUT {projectHost}/{id}` | `{"status":"ok","hash":…}` |
| `GET {assetHost}/internalapi/asset/{md5}.{ext}/get/` | bytes |
| `POST {assetHost}/{md5}.{ext}` (body bytes) | `{"status":"ok"}` — scratch-storage đòi đúng khoá `status` |
| `POST {projectHost}/{id}/thumbnail` (body PNG) | 200 |
| `GET {libraryHost}/{md5}.{ext}` | tài nguyên thư viện (tĩnh) |

⚠ **Editor không POST tài nguyên thư viện.** Nhân vật/âm thanh lấy từ thư viện (kể cả mèo và phông trắng của dự án mặc định) được đánh dấu "sạch" và không bao giờ tải lên kho; `project.json` vẫn quy chiếu chúng. Kho phía LMS phải coi tên có trong `library/` là tồn tại và phục vụ chúng ở `GET internalapi/asset/…` (đo bằng `scripts/smoke.mjs`: 0 request POST tài nguyên cho dự án mặc định).

### `postMessage` (cùng origin, `event.origin === location.origin`)

| Chiều | Thông điệp | Khi nào |
|---|---|---|
| host → LMS | `scratch:ready {project, mode}` | dự án đã nạp |
| host → LMS | `scratch:created {id, hash}` | editor vừa POST tạo (chỉ khi `project=new`) — LMS đổi URL sang id |
| host → LMS | `scratch:saved {id, hash, requestIds}` | sau mỗi PUT (tự lưu, Lưu, hoặc lệnh `scratch:save`); `requestIds` = các `requestId` của lệnh `scratch:save` mà lượt lưu này phục vụ (tự lưu: `[]`) |
| host → LMS | `scratch:dirty {dirty}` | có/hết thay đổi chưa lưu |
| host → LMS | `scratch:run {running}` | cờ xanh / dừng |
| host → LMS | `scratch:error {reason, message, status?}` | lưu thất bại, `reason` là mã lỗi của LMS |
| host → LMS | `scratch:state {requestId, state}` | trả lời `scratch:probe` |
| LMS → host | `scratch:save {requestId?}` | ép lưu ngay (`manualUpdateProject`); đang tự lưu thì xếp hàng, dispatch sau khi lượt đó xong; `requestId` được trả lại trong `requestIds` của `scratch:saved`/`scratch:error` |
| LMS → host | `scratch:stop` | `vm.stopAll()` |
| LMS → host | `scratch:probe {requestId}` | ảnh chụp trạng thái VM (target, biến, số khối) |

Mọi thông điệp còn được ghi vào `window.NextLmsScratchEvents` để khắc phục sự cố; `window.NextLmsScratchDebug` giữ `state` (redux) và `vm`.

## Phát hành

`git tag v0.1.0 && git push --tags` → workflow `release` build tarball trên `ubuntu-latest` (node 22), kiểm `VERSION` khớp tag, đăng GitHub Release với `nextlms-scratch-<ver>.tar.gz` + `.sha256`. LMS ghim `<ver>` + SHA đó trong `Modules/ScratchStudio/config/config.php`.

## Nâng phiên bản upstream

1. Đổi `@scratch/scratch-gui` trong `package.json`, `upstream` trong `src/about.js`; `npm install`.
2. Xem `packages/scratch-gui/src/gui-config.ts` và `index-standalone.tsx` của bản mới còn xuất `EditorState`, `createStandaloneRoot`, `buildDefaultProject`, `manualUpdateProject`, `defaultProjectId`, `openSpriteLibrary`, `ScratchStorage` không — `src/host.js`/`src/storage.js` dựa vào đúng những tên đó.
3. `npm run fetch-library` (thư viện có thể thêm tệp), `npm run build`, chạy smoke, tag `vX.Y.Z`.
