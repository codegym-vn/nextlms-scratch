#!/usr/bin/env node
/*
 * Smoke test thật trên Chrome headless qua DevTools Protocol, không cần
 * Playwright: mở trang nhúng với kho giả (dev-server), đợi dự án mặc định
 * nạp xong, kiểm editor tự tạo dự án (POST) rồi ép lưu (PUT) và xác nhận
 * không request nào rời origin (thư viện media phải lấy từ bản sao local).
 *
 *   npm run build && node scripts/dev-server.mjs &   # cổng 8602
 *   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/smoke.mjs
 *
 * Node chạy trong container còn Chrome ở máy chủ (máy dev không có node):
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 \
 *       --remote-allow-origins=* --user-data-dir=/tmp/smoke-prof about:blank &
 *   docker run --rm -e DEVTOOLS=http://host.docker.internal:9333 --entrypoint node -v "$PWD":/w -w /w <image> scripts/smoke.mjs
 */
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8602';
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9333;

// DEVTOOLS đặt sẵn → Chrome do người khác mở (vd ở máy chủ, node trong container).
const DEVTOOLS = process.env.DEVTOOLS || `http://localhost:${PORT}`;
let chrome = null;
let profile = null;
if (!process.env.DEVTOOLS) {
    profile = mkdtempSync(path.join(tmpdir(), 'nextlms-scratch-smoke-'));
    chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
        `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
    ], {stdio: 'ignore'});
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => { chrome?.kill(); if (profile) rmSync(profile, {recursive: true, force: true}); };
const fail = message => { console.error(`FAIL: ${message}`); cleanup(); process.exit(1); };

let targets = null;
for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250);
    targets = await fetch(`${DEVTOOLS}/json`).then(r => r.json()).catch(() => null);
}
if (!targets) fail(`Chrome DevTools không lên tại ${DEVTOOLS}`);

// Tab mới, đừng bám vào tab đầu tiên (Chrome mở kèm tab nội bộ như "Omnibox Popup").
const tab = await fetch(`${DEVTOOLS}/json/new?about:blank`, {method: 'PUT'}).then(r => r.json());
const devtoolsHost = new URL(DEVTOOLS).host;
const wsUrl = tab.webSocketDebuggerUrl.replace(/\/\/[^/]+/, `//${devtoolsHost}`);
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));

let seq = 0;
const pending = new Map();
const requests = [];
ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request);
});
const send = (method, params = {}) => new Promise(resolve => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({id, method, params}));
});
const evaluate = async expression => {
    const {result} = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    return result.result.value;
};

await send('Network.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {width: 1366, height: 900, deviceScaleFactor: 1, mobile: false});
await send('Page.navigate', {url: `${BASE}/?project=new&locale=vi&title=Smoke&autosave=15`});

// 1. Dự án mặc định nạp xong (scratch:ready) trong 60 s.
let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
    await sleep(500);
    ready = await evaluate(`(window.NextLmsScratchEvents || []).some(e => e.type === 'scratch:ready')`);
}
if (!ready) {
    const state = await evaluate(`(() => { try { const s = window.NextLmsScratchDebug.state.store.getState().scratchGui; return {projectState: s.projectState, alerts: s.alerts, modals: s.modals, boot: document.getElementById('boot')?.textContent}; } catch (e) { return String(e); } })()`);
    fail('không thấy scratch:ready sau 60 s — events: ' + JSON.stringify(await evaluate('window.NextLmsScratchEvents')) + ' state: ' + JSON.stringify(state));
}
console.log('ok  scratch:ready');

// 2. Editor tự tạo dự án mới (canCreateNew + isShowingWithoutId → POST).
let created = null;
for (let i = 0; i < 60 && !created; i++) {
    await sleep(500);
    created = await evaluate(`((window.NextLmsScratchEvents || []).find(e => e.type === 'scratch:created') || null)`);
}
if (!created) fail('editor không POST tạo dự án — events: ' + JSON.stringify(await evaluate('window.NextLmsScratchEvents')));
console.log(`ok  scratch:created id=${created.id}`);

// 3. Lệnh lưu từ "LMS" (postMessage cùng origin) → PUT → scratch:saved.
await evaluate(`window.postMessage({type: 'scratch:save'}, window.location.origin)`);
let saved = null;
for (let i = 0; i < 40 && !saved; i++) {
    await sleep(500);
    saved = await evaluate(`((window.NextLmsScratchEvents || []).find(e => e.type === 'scratch:saved') || null)`);
}
if (!saved) fail('không thấy scratch:saved sau scratch:save — events: ' + JSON.stringify(await evaluate('window.NextLmsScratchEvents')));
console.log(`ok  scratch:saved hash=${saved.hash}`);

// 4. Không request nào rời origin trong suốt phiên (thư viện media phải là bản sao local).
//    ⚠ Thư viện nhân vật mở qua redux trong headless không render item (react-modal
//    + lazy chunk), nên thumbnail của thư viện chưa kiểm tự động được — QA tay
//    trên trình duyệt thật khi cài vào LMS (xem README).
const foreign = requests.filter(r => !r.url.startsWith(BASE) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
if (foreign.length) fail('có request rời origin:\n' + foreign.map(r => r.url).slice(0, 10).join('\n'));
console.log(`ok  không request nào rời origin (${requests.length} request)`);

const errors = await evaluate(`(window.NextLmsScratchEvents || []).filter(e => e.type === 'scratch:error')`);
if (errors.length) fail('scratch:error: ' + JSON.stringify(errors));

console.log('SMOKE OK');
cleanup();
process.exit(0);
