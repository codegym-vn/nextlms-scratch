/*
 * Trang nhúng trình soạn Scratch cho NextLMS.
 *
 * Đọc cấu hình từ query string, dựng GUI của @scratch/scratch-gui bằng API
 * công khai `createStandaloneRoot` (không sửa source của Scratch), cắm kho
 * lưu `NextLmsScratchStorage`, và nói chuyện với trang LMS bên ngoài bằng
 * `postMessage` cùng origin. LMS không biết gì về Redux/VM; mọi thứ nó cần
 * là bảng thông điệp dưới đây (README.md là tài liệu chuẩn):
 *
 *   host → LMS : scratch:ready, scratch:created {id}, scratch:saved {id, hash, requestIds},
 *                scratch:dirty {dirty}, scratch:run {running}, scratch:error {reason, message, requestIds}
 *   LMS → host : scratch:save {requestId?}, scratch:stop, scratch:probe {criteria}
 *
 * `scratch:save {requestId}`: LMS muốn biết ĐÚNG lượt lưu do mình yêu cầu đã
 * xong (nút Nộp bài). Tự lưu đang chạy thì yêu cầu xếp hàng và chỉ dispatch
 * sau khi lượt đó kết thúc — scratch-gui bỏ qua `manualUpdateProject` khi
 * đang AUTO_UPDATING, nên gửi ngay là mất; lượt lưu mang `requestIds` của
 * các yêu cầu nó phục vụ, tự lưu thì `requestIds: []`.
 *
 * Query: project=<id>|new, mode=editor|player, locale=vi|en, title=<tên khi tạo mới>,
 *        autosave=<giây>, projectHost, assetHost, libraryHost
 *        (csrf=<token> chỉ để thử tay; bình thường đọc <meta name="csrf-token"> của trang cha)
 */
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);

    function parentCsrfToken () {
        try {
            return window.parent !== window
                ? (window.parent.document.querySelector('meta[name="csrf-token"]')?.content || '')
                : '';
        } catch (e) {
            return '';
        }
    }
    const boot = document.getElementById('boot');
    const appTarget = document.getElementById('app');

    const config = {
        project: params.get('project') || 'new',
        mode: params.get('mode') === 'player' ? 'player' : 'editor',
        locale: params.get('locale') || 'vi',
        title: params.get('title') || '',
        autosave: Math.max(15, parseInt(params.get('autosave') || '60', 10) || 60),
        // Token CSRF đọc từ <meta> của trang LMS cha (cùng origin) — không đi
        // qua query string, nơi nó lọt vào access log và Referer.
        csrf: params.get('csrf') || parentCsrfToken(),
        projectHost: params.get('projectHost') || '/scratch/api/projects',
        assetHost: params.get('assetHost') || '/scratch/api/assets',
        libraryHost: params.get('libraryHost') || 'library'
    };

    // Nhật ký sự kiện cho smoke test/khắc phục sự cố (không gửi đi đâu).
    const events = window.NextLmsScratchEvents = [];

    const post = (type, payload) => {
        const message = Object.assign({type: `scratch:${type}`}, payload || {});
        events.push(message);
        if (window.parent !== window) {
            window.parent.postMessage(message, window.location.origin);
        }
    };

    const fail = message => {
        boot.className = 'error';
        boot.textContent = message;
        post('error', {reason: 'boot', message});
    };

    if (typeof window.GUI === 'undefined') {
        fail('Không nạp được trình soạn (scratch-gui-standalone.js).');
        return;
    }

    let dirty = false;
    let vm = null;
    let editorState = null;

    // Yêu cầu lưu từ LMS chờ dispatch / đang được một lượt lưu phục vụ.
    let queuedSaveRequests = [];
    let activeSaveRequests = [];

    const storage = new window.NextLmsScratchStorage({
        projectHost: config.projectHost,
        assetHost: config.assetHost,
        libraryHost: config.libraryHost,
        csrfToken: config.csrf,
        onEvent: (event, payload) => {
            if (event === 'created' || event === 'saved') {
                setDirty(false);
            }
            if (event === 'created' || event === 'saved' || event === 'error') {
                payload = Object.assign({}, payload, {requestIds: activeSaveRequests});
                activeSaveRequests = [];
            }
            post(event, payload);
            if (event === 'created' || event === 'saved' || event === 'error') {
                // Trạng thái redux về SHOWING_WITH_ID sau tick này.
                setTimeout(flushSaveRequests, 0);
            }
        }
    });

    function loadingState () {
        try {
            return editorState.store.getState().scratchGui.projectState.loadingState;
        } catch (e) {
            return null;
        }
    }

    function flushSaveRequests () {
        if (!editorState || queuedSaveRequests.length === 0) return;
        if (loadingState() !== 'SHOWING_WITH_ID') return; // đang lưu: đợi lượt này xong
        activeSaveRequests = queuedSaveRequests;
        queuedSaveRequests = [];
        editorState.store.dispatch(GUI.manualUpdateProject());
    }

    function setDirty (value) {
        if (dirty === value) return;
        dirty = value;
        post('dirty', {dirty});
    }

    // Trình duyệt chỉ hỏi "rời trang?" khi thật sự còn thay đổi chưa lưu.
    window.addEventListener('beforeunload', event => {
        if (dirty && config.mode === 'editor') {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin || !event.data || typeof event.data.type !== 'string') return;

        switch (event.data.type) {
        case 'scratch:save':
            queuedSaveRequests.push(event.data.requestId == null ? null : String(event.data.requestId));
            flushSaveRequests();
            break;
        case 'scratch:stop':
            if (vm) vm.stopAll();
            break;
        case 'scratch:probe':
            post('state', {requestId: event.data.requestId || null, state: probe()});
            break;
        default:
            break;
        }
    });

    /** Ảnh chụp trạng thái VM cho tầng chấm formative (P2 mở rộng theo criteria). */
    function probe () {
        if (!vm || !vm.runtime) return null;

        const targets = vm.runtime.targets.filter(t => t.isOriginal);

        return {
            running: vm.runtime.threads.length > 0,
            targets: targets.map(t => ({
                name: t.getName(),
                isStage: t.isStage,
                x: t.x, y: t.y, direction: t.direction, size: t.size,
                costume: t.getCurrentCostume() ? t.getCurrentCostume().name : null,
                visible: t.visible,
                variables: Object.values(t.variables || {}).filter(v => v.type === '').map(v => ({name: v.name, value: v.value})),
                blocks: Object.keys(t.blocks._blocks || {}).length
            }))
        };
    }

    try {
        GUI.setAppElement(appTarget);

        editorState = new GUI.EditorState({
            locale: config.locale,
            isEmbedded: true,
            isPlayerOnly: config.mode === 'player',
            isFullScreen: false
        }, () => ({storage}));

        const root = GUI.createStandaloneRoot(editorState, appTarget);
        window.NextLmsScratchDebug = {state: editorState, get vm () { return vm; }};

        const projectId = config.project === 'new' ? null : config.project;

        root.render({
            // Không có id thì phải đưa `defaultProjectId` (0) — bỏ trống thì
            // project-fetcher-hoc không setProjectId và editor đứng ở NOT_LOADED mãi.
            projectId: projectId === null ? GUI.defaultProjectId : projectId,
            projectHost: config.projectHost,
            assetHost: config.assetHost,
            autoSaveIntervalSecs: config.autosave,
            canSave: true,
            canCreateNew: projectId === null,
            canEditTitle: false,
            canManageFiles: true,
            canRemix: false,
            canCreateCopy: false,
            canShare: false,
            canChangeLanguage: false,
            enableCommunity: false,
            backpackVisible: false,
            showComingSoon: false,
            hideTutorialProjects: true,
            isPlayerOnly: config.mode === 'player',
            logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
            onClickLogo: () => {},
            onClickAbout: showAbout,
            onUpdateProjectData: (id, vmState, saveParams) => storage.saveProject(id, vmState, Object.assign({}, saveParams, {
                // Tên đặt từ LMS thắng tên mặc định "Scratch Project" khi tạo mới.
                title: config.title || (saveParams && saveParams.title)
            })),
            onVmInit: instance => {
                vm = instance;
                vm.on('PROJECT_CHANGED', () => setDirty(true));
                vm.on('PROJECT_RUN_START', () => post('run', {running: true}));
                vm.on('PROJECT_RUN_STOP', () => post('run', {running: false}));
            },
            onProjectLoaded: () => {
                boot.remove();
                post('ready', {project: config.project, mode: config.mode});
            }
        });
    } catch (error) {
        fail(`Không khởi động được trình soạn: ${error.message}`);
        throw error;
    }

    function showAbout () {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000;';
        const card = document.createElement('div');
        card.style.cssText = 'background:#fff;border-radius:8px;max-width:560px;width:90%;padding:20px 24px;box-shadow:0 10px 40px rgba(0,0,0,.3);';
        card.appendChild(window.NextLmsScratchAbout.render());
        const close = document.createElement('button');
        close.textContent = 'Đóng';
        close.style.cssText = 'margin-top:12px;padding:6px 16px;border:0;border-radius:6px;background:#4c97ff;color:#fff;cursor:pointer;';
        close.onclick = () => overlay.remove();
        card.appendChild(close);
        overlay.appendChild(card);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }
})();
