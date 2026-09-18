#!/usr/bin/env node
/*
 * Tải bản sao thư viện media của Scratch (nhân vật, trang phục, phông nền,
 * âm thanh) về `library/` để editor tự host không gọi CDN của MIT.
 *
 * Danh sách lấy từ chính gói @scratch/scratch-gui đã cài (4 file JSON thư
 * viện), nên bản sao luôn khớp phiên bản editor đang dùng. Mỗi tệp kiểm md5
 * theo tên; chạy lại chỉ tải phần thiếu.
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Gói khai "exports" nên require.resolve('@scratch/scratch-gui/package.json') bị chặn.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guiRoot = path.join(repoRoot, 'node_modules', '@scratch', 'scratch-gui');
const librariesDir = path.join(guiRoot, 'dist', 'libraries');
const outDir = path.resolve(process.argv[2] || 'library');
const CDN = process.env.SCRATCH_ASSET_CDN || 'https://cdn.assets.scratch.mit.edu/internalapi/asset';
const CONCURRENCY = 8;

const names = new Set();
for (const file of ['sprites.json', 'costumes.json', 'backdrops.json', 'sounds.json']) {
    const items = JSON.parse(readFileSync(path.join(librariesDir, file), 'utf8'));
    for (const item of items) {
        if (item.md5ext) names.add(item.md5ext);
        for (const c of item.costumes || []) names.add(c.md5ext);
        for (const s of item.sounds || []) names.add(s.md5ext);
    }
}

mkdirSync(outDir, {recursive: true});

// Dự án mặc định (mèo + phông trắng + 2 âm thanh) nằm trong bundle; editor coi
// tài nguyên của nó là "sạch" nên KHÔNG POST lên kho — kho phải tìm thấy chúng
// ở bản sao thư viện. Phông trắng (cd21514d…) không có trong sprites.json.
import {readdirSync, copyFileSync} from 'node:fs';
const defaultProjectDir = path.join(guiRoot, 'src', 'lib', 'default-project');
for (const file of readdirSync(defaultProjectDir)) {
    if (/^[a-f0-9]{32}\.(svg|wav|png|mp3)$/.test(file)) {
        names.add(file);
        if (!existsSync(path.join(outDir, file))) copyFileSync(path.join(defaultProjectDir, file), path.join(outDir, file));
    }
}

const queue = [...names].filter(name => !existsSync(path.join(outDir, name)));
console.log(`${names.size} library assets, ${queue.length} to fetch → ${outDir}`);

let done = 0;
let failed = 0;

async function worker () {
    while (queue.length) {
        const name = queue.shift();
        try {
            const response = await fetch(`${CDN}/${name}/get/`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            const md5 = createHash('md5').update(bytes).digest('hex');
            if (md5 !== name.slice(0, 32)) throw new Error(`md5 mismatch (${md5})`);
            writeFileSync(path.join(outDir, name), bytes);
            done++;
            if (done % 100 === 0) console.log(`  ${done} fetched`);
        } catch (error) {
            failed++;
            console.error(`  FAIL ${name}: ${error.message}`);
            queue.push(name);
            if (failed > 50) throw new Error('Too many failures, aborting');
        }
    }
}

await Promise.all(Array.from({length: CONCURRENCY}, worker));

const manifest = [...names].sort().map(name => ({name, size: statSync(path.join(outDir, name)).size}));
const total = manifest.reduce((sum, item) => sum + item.size, 0);
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: CDN,
    license: 'CC BY-SA 2.0 — Scratch Foundation media library',
    count: manifest.length,
    totalBytes: total,
    files: manifest
}, null, 1));
console.log(`done: ${manifest.length} files, ${(total / 1e6).toFixed(1)} MB`);
