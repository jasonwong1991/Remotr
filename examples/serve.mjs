#!/usr/bin/env node
/**
 * examples 静态服务器 —— 零依赖(仅用 Node 内置 http/fs/path)。
 *
 * Remotr server 本身不托管 examples 目录(未知路径会 SPA fallback 到调试面板),
 * 所以 demo 页需要一个独立的静态服务。用法:
 *
 *   npm run examples              # 默认 http://localhost:8899
 *   npm run examples -- --port 3000
 *   node examples/serve.mjs --port 3000 --host 0.0.0.0
 *
 * 打开(URL 不带 /examples 前缀,根目录即 examples/):
 *   http://localhost:8899/demo.html
 *   http://localhost:8899/demo-react.html
 *   http://localhost:8899/demo-vue.html
 *
 * demo 页内注入的 SDK 硬编码指向 localhost:9777,记得同时启动 `npm start`。
 */

import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// 解析 --port / --host(其余忽略)
function parseArgs(argv) {
  const out = { port: 8899, host: 'localhost' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) out.port = Number(argv[++i]);
    else if (argv[i] === '--host' && argv[i + 1]) out.host = argv[++i];
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/** 简易目录索引:访问 / 时列出可打开的 demo 页 */
async function renderIndex(dir, urlPath) {
  const entries = await readdir(dir, { withFileTypes: true });
  const items = entries
    .filter((e) => e.isDirectory() || e.name.endsWith('.html'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      const name = e.isDirectory() ? `${e.name}/` : e.name;
      const href = join(urlPath, name).replace(/\\/g, '/');
      return `<li><a href="${href}">${name}</a></li>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Remotr examples</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#222}
h1{color:#2d6cdf}li{margin:6px 0;font-size:15px}a{color:#087ea4;text-decoration:none}a:hover{text-decoration:underline}
.hint{color:#888;font-size:13px;margin-top:20px}code{background:#f0f4f8;padding:1px 5px;border-radius:4px}</style>
<h1>🐛 Remotr examples</h1><ul>${items}</ul>
<p class="hint">注入的 SDK 指向 <code>localhost:9777</code> —— 记得同时运行 <code>npm start</code>。</p>`;
}

const { port, host } = parseArgs(process.argv.slice(2));

const server = createServer(async (req, res) => {
  try {
    // 去掉 query,解码,归一化,阻断 ../ 目录穿越
    const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
    const fsPath = join(ROOT, safePath);

    // 确保仍在 ROOT 内(防穿越)
    if (!fsPath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

    let target = fsPath;
    let info;
    try {
      info = await stat(target);
    } catch {
      return send(res, 404, `Not found: ${safePath}`);
    }

    if (info.isDirectory()) {
      // 优先目录下的 index.html,否则列目录
      try {
        const idx = join(target, 'index.html');
        await stat(idx);
        target = idx;
      } catch {
        return send(res, 200, await renderIndex(target, safePath), {
          'Content-Type': 'text/html; charset=utf-8',
        });
      }
    }

    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
    send(res, 200, data, { 'Content-Type': type });
  } catch (err) {
    send(res, 500, `Server error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`\n  Remotr examples static server`);
  console.log(`  ├─ Serving:  ${ROOT}`);
  console.log(`  ├─ URL:      http://${shown}:${port}/`);
  console.log(`  ├─ demo:     http://${shown}:${port}/demo.html`);
  console.log(`  ├─ react:    http://${shown}:${port}/demo-react.html`);
  console.log(`  └─ vue:      http://${shown}:${port}/demo-vue.html`);
  console.log(`\n  Note: run \`npm start\` too — demo pages inject the SDK from localhost:9777.\n`);
});
