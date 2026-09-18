/*
 * Kho lưu của trình soạn trỏ về NextLMS. Cài hợp đồng `GUIStorage` của
 * @scratch/scratch-gui (packages/scratch-gui/src/gui-config.ts) bằng đúng
 * hình dạng request mà LegacyStorage của Scratch phát ra — phía LMS
 * (Modules/ScratchStudio) chỉ phục vụ hình dạng đó:
 *
 *   GET  {projectHost}/{id}                         → project.json
 *   POST {projectHost}/?title=…                      → {status:'ok', 'content-name': id}
 *   PUT  {projectHost}/{id}                          → {status:'ok', hash}
 *   GET  {assetHost}/internalapi/asset/{md5ext}/get/ → bytes
 *   POST {assetHost}/{md5ext}                        → {status:'ok'}
 *   POST {projectHost}/{id}/thumbnail                → {status:'ok'}
 *
 * Tài nguyên thư viện (nhân vật/phông/âm thanh có sẵn) lấy từ bản sao tĩnh
 * `libraryHost` thay vì CDN của MIT — không byte nào của học sinh rời máy chủ.
 */
(function () {
    'use strict';

    class LmsStorage {
        constructor (options) {
            this.projectHost = options.projectHost;
            this.assetHost = options.assetHost;
            this.libraryHost = options.libraryHost;
            this.csrfToken = options.csrfToken || null;
            this.onEvent = options.onEvent || (() => {});
            this.translator = null;

            this.scratchStorage = new GUI.ScratchStorage();
            this.cacheDefaultProject();
            this.addWebStores();
        }

        // --- hợp đồng GUIStorage ---------------------------------------------

        setProjectHost (host) { this.projectHost = host; }

        setAssetHost (host) { this.assetHost = host; }

        setProjectToken () {}

        setBackpackHost () {}

        setProjectMetadata () {}

        setTranslatorFunction (translator) {
            this.translator = translator;
            this.cacheDefaultProject();
        }

        getLibraryAssetUrl (assetId, dataFormat) {
            return `${this.libraryHost}/${assetId}.${dataFormat}`;
        }

        /**
         * Lưu project.json. `projectId` null/undefined = tạo mới (POST), ngược
         * lại PUT. Trả `{id}` — project-saver-hoc gọi `response.id.toString()`.
         */
        async saveProject (projectId, vmState, params) {
            const creating = projectId === null || typeof projectId === 'undefined' || projectId === 0 || projectId === '0';
            const query = new URLSearchParams();
            if (params && params.title) query.set('title', params.title);
            if (params && params.originalId) query.set('original_id', params.originalId);
            if (params && params.isRemix) query.set('is_remix', '1');
            if (params && params.isCopy) query.set('is_copy', '1');
            const qs = query.toString() ? `?${query}` : '';

            const url = creating ? `${this.projectHost}/${qs}` : `${this.projectHost}/${projectId}${qs}`;
            const response = await fetch(url, {
                method: creating ? 'POST' : 'PUT',
                credentials: 'same-origin',
                headers: this.headers({'Content-Type': 'application/json'}),
                body: vmState
            });

            const body = await this.json(response);

            if (!response.ok || body.status !== 'ok') {
                const error = new Error(body.message || `Save failed (${response.status})`);
                error.reason = body.reason || `http_${response.status}`;
                this.onEvent('error', {reason: error.reason, message: error.message, status: response.status});
                throw error;
            }

            const id = creating ? String(body['content-name']) : String(projectId);
            this.onEvent(creating ? 'created' : 'saved', {id, hash: body.hash || null});

            return {id, hash: body.hash || null};
        }

        saveProjectThumbnail (projectId, thumbnail, onSuccess, onError) {
            fetch(`${this.projectHost}/${projectId}/thumbnail`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: this.headers({'Content-Type': 'image/png'}),
                body: thumbnail
            })
                .then(response => (response.ok ? onSuccess?.() : onError?.(new Error(`thumbnail ${response.status}`))))
                .catch(error => onError?.(error));
        }

        // --- nội bộ ------------------------------------------------------------

        headers (extra) {
            const headers = Object.assign({Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest'}, extra);
            if (this.csrfToken) headers['X-CSRF-TOKEN'] = this.csrfToken;
            return headers;
        }

        async json (response) {
            try {
                return await response.json();
            } catch (e) {
                return {};
            }
        }

        /**
         * Dự án mặc định (mèo + phông trắng) nằm sẵn trong bundle; nạp vào
         * builtinHelper để id 0 mở ra được mà không hỏi máy chủ — y hệt
         * LegacyStorage. Tài nguyên của nó được POST lên kho ở lần lưu đầu.
         */
        cacheDefaultProject () {
            const storage = this.scratchStorage;
            GUI.buildDefaultProject(this.translator || undefined).forEach(asset => storage.builtinHelper._store(
                storage.AssetType[asset.assetType],
                storage.DataFormat[asset.dataFormat],
                asset.data,
                asset.id
            ));
        }

        addWebStores () {
            const storage = this.scratchStorage;

            storage.addWebStore(
                [storage.AssetType.Project],
                asset => `${this.projectHost}/${asset.assetId}`,
                () => ({url: `${this.projectHost}/`, withCredentials: true}),
                asset => ({url: `${this.projectHost}/${asset.assetId}`, withCredentials: true})
            );

            const assetCreate = asset => ({
                // Không có "update" tài nguyên: content-addressed, luôn POST.
                method: 'post',
                url: `${this.assetHost}/${asset.assetId}.${asset.dataFormat}`,
                withCredentials: true
            });

            storage.addWebStore(
                [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
                asset => `${this.assetHost}/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`,
                assetCreate,
                assetCreate
            );

            // Âm thanh của extension Music nằm trong static của bundle.
            storage.addWebStore(
                [storage.AssetType.Sound],
                asset => `static/extension-assets/scratch3_music/${asset.assetId}.${asset.dataFormat}`
            );
        }
    }

    window.NextLmsScratchStorage = LmsStorage;
})();
