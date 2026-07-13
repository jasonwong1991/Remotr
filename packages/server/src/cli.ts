#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DEFAULT_PORT } from '@remotr/shared';
import { startServer } from './index.js';
import { loadRecordingConfig } from './recording.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 解析 CLI 参数：--port / --host */
function parseArgs(argv: string[]) {
  const out: { port: number; host: string } = {
    port: Number(process.env.REMOTR_PORT) || DEFAULT_PORT,
    host: process.env.REMOTR_HOST || '0.0.0.0',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--host' || a === '-h') out.host = argv[++i];
  }
  return out;
}

const { port, host } = parseArgs(process.argv.slice(2));

// dist 布局: packages/server/dist/cli.js
// 面板:  packages/debugger/dist
// SDK:   packages/sdk/dist/remotr.js
const repoRoot = resolve(__dirname, '..', '..', '..');
const panelDir = join(repoRoot, 'packages', 'debugger', 'dist');
const sdkPath = join(repoRoot, 'packages', 'sdk', 'dist', 'remotr.js');

if (!existsSync(sdkPath)) {
  console.warn(`[warn] 未找到注入脚本: ${sdkPath}`);
  console.warn(`       请先运行: npm run build:sdk`);
}
if (!existsSync(join(panelDir, 'index.html'))) {
  console.warn(`[warn] 未找到调试面板: ${panelDir}`);
  console.warn(`       请先运行: npm run build:debugger`);
}

// 录制：默认根目录在仓库根的 recordings/（可被 REMOTR_REC_DIR 覆盖）
const recording = loadRecordingConfig(repoRoot);

const { httpServer, wss, recorder } = startServer({ port, host, panelDir, sdkPath, recording });

// 优雅关停：等录制流刷盘（含末段）后再退出；2s 兜底防止卡死。
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // 停止接受新连接（best-effort，不阻塞退出）。
    wss.close();
    httpServer.close();
    const flush = recorder.destroy();
    const timeout = new Promise<void>((res) => setTimeout(res, 2000).unref?.());
    Promise.race([flush, timeout]).finally(() => process.exit(0));
  });
}
