#!/usr/bin/env node
/*
 * Server tĩnh + kho giả trong bộ nhớ để thử trang nhúng KHÔNG cần LMS:
 *   npm run build && npm run serve → http://localhost:8602/?project=new
 * Kho giả cài đúng giao thức mà Modules/ScratchStudio phục vụ, nên nó cũng là
 * đặc tả chạy được của giao thức đó.
 */
import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync, existsSync, statSync} from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'build');
const port = Number(process.env.PORT || 8602);
const projects = new Map();
const assets = new Map();
let nextId = 1;

const MIME = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.css': 'text/css', '.wasm': 'application/wasm'};

const body = req => new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
});

const json = (res, status, data) => {
    res.writeHead(status, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(data));
};

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    let m;
    if ((m = p.match(/^\/scratch\/api\/projects\/(\d+)\/thumbnail$/)) && req.method === 'POST') {
        await body(req);
        return json(res, 200, {status: 'ok'});
    }
    if ((m = p.match(/^\/scratch\/api\/projects\/(\d+)$/))) {
        if (req.method === 'GET') {
            const project = projects.get(m[1]);
            if (!project) return json(res, 404, {status: 'error'});
            res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
            return res.end(project.json);
        }
        if (req.method === 'PUT') {
            const raw = (await body(req)).toString();
            const hash = createHash('sha256').update(raw).digest('hex');
            projects.set(m[1], {json: raw, title: projects.get(m[1])?.title});
            console.log(`PUT project ${m[1]} (${raw.length} bytes)`);
            return json(res, 200, {status: 'ok', hash});
        }
    }
    if (p === '/scratch/api/projects/' && req.method === 'POST') {
        const raw = (await body(req)).toString();
        const id = String(nextId++);
        projects.set(id, {json: raw, title: url.searchParams.get('title')});
        console.log(`POST project → ${id} title=${url.searchParams.get('title')}`);
        return json(res, 200, {status: 'ok', 'content-name': id, hash: createHash('sha256').update(raw).digest('hex')});
    }
    if ((m = p.match(/^\/scratch\/api\/assets\/internalapi\/asset\/([a-f0-9]{32}\.\w+)\/get\/?$/))) {
        const asset = assets.get(m[1]);
        if (!asset) return json(res, 404, {status: 'error'});
        res.writeHead(200, {'Content-Type': MIME[path.extname(m[1])] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable'});
        return res.end(asset);
    }
    if ((m = p.match(/^\/scratch\/api\/assets\/([a-f0-9]{32}\.\w+)$/)) && req.method === 'POST') {
        const bytes = await body(req);
        const md5 = createHash('md5').update(bytes).digest('hex');
        if (md5 !== m[1].slice(0, 32)) return json(res, 422, {status: 'error', reason: 'md5_mismatch'});
        const created = !assets.has(m[1]);
        assets.set(m[1], bytes);
        console.log(`POST asset ${m[1]} (${bytes.length} bytes)`);
        return json(res, created ? 201 : 200, {status: 'ok', 'content-name': m[1]});
    }

    // tĩnh
    let file = path.join(root, decodeURIComponent(p === '/' ? '/index.html' : p));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
    res.end(readFileSync(file));
}).listen(port, () => console.log(`nextlms-scratch dev server: http://localhost:${port}/?project=new  (root: ${root})`));
