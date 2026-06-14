// 端到端集成测试：真实 Remotr server + 假 SDK，验证 Phase 2 完整链路
//   listSessions(HTTP) → 收 page.error backlog → sources.fetch 命令经服务端往返 → sourcemap 还原
// 运行：node packages/mcp/test/integration.mjs（需先 npm run build）
import assert from 'node:assert';
import { once } from 'node:events';
import WebSocket from 'ws';
import { SourceMapGenerator } from 'source-map-js';
import { encodeFrame, decodeFrame, makeEnvelope } from '@remotr/shared';
import { startServer } from '@remotr/server';
import { RemotrClient, resolveStackVia } from '@remotr/mcp';

const ORIGINAL = 'function handleClick() {\n  throw new Error("boom");\n}\n';

function makeMap() {
  const gen = new SourceMapGenerator({ file: 'app.min.js' });
  // 压缩位置 (line 1, column 100) ← 原始 src/Foo.tsx (line 2, col 2)
  gen.addMapping({
    generated: { line: 1, column: 100 },
    original: { line: 2, column: 2 },
    source: 'src/Foo.tsx',
    name: 'handleClick',
  });
  gen.setSourceContent('src/Foo.tsx', ORIGINAL);
  return gen.toString();
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const check = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓', msg); passed++; };

async function main() {
  // 1. 起 server（禁用录制，随机端口）
  const { httpServer, wss, recorder } = startServer({
    port: 0,
    host: '127.0.0.1',
    panelDir: '/tmp',
    sdkPath: '/tmp/none.js',
    recording: { enabled: false, dir: '/tmp/remotr-it', segmentMs: 30000, maxBytes: 0 },
  });
  if (!httpServer.listening) await once(httpServer, 'listening');
  const port = httpServer.address().port;
  const base = `http://127.0.0.1:${port}`;
  const scriptUrl = `${base}/app.min.js`;

  // 2. 假 SDK 接入并应答 sources.fetch
  const sdk = new WebSocket(`ws://127.0.0.1:${port}/ws?room=default&role=sdk&deviceId=dev1&pageId=page1`);
  await once(sdk, 'open');
  sdk.on('message', (raw) => {
    const f = decodeFrame(raw.toString());
    if (f?.kind === 'msg' && f.envelope.method === 'sources.fetch') {
      const { url } = f.envelope.data;
      const result = { url, content: 'x\n//# sourceMappingURL=app.min.js.map', map: makeMap() };
      sdk.send(encodeFrame({ kind: 'reply', reply: { replyTo: f.envelope.id, result, error: null } }));
    }
  });

  // SDK 上报 system.info + 一个未捕获错误（堆栈指向压缩 bundle）
  sdk.send(encodeFrame({ kind: 'msg', envelope: makeEnvelope('system.info', {
    ua: 'test', url: `${base}/`, title: 'T', viewport: { width: 800, height: 600 },
    framework: 'React', sdkVersion: '0.0.0',
  }, 'sdk') }));
  const stack = `Error: boom\n    at handleClick (${scriptUrl}:1:101)`;
  sdk.send(encodeFrame({ kind: 'msg', envelope: makeEnvelope('page.error', {
    message: 'boom', stack,
  }, 'sdk') }));

  await delay(300); // 让 server 落 backlog

  // 3. MCP 客户端：列 session（HTTP）
  const client = new RemotrClient(base, 'default');
  const sessions = await client.listSessions();
  check(sessions.some((s) => s.session.deviceId === 'dev1' && s.session.pageId === 'page1'), 'listSessions 发现 dev1/page1');

  // 4. 连 session → 收 backlog → 取错误
  const conn = await client.connectSession({ deviceId: 'dev1', pageId: 'page1' });
  await conn.waitForBacklog();
  const errors = conn.errors();
  check(errors.length >= 1 && errors[0].message === 'boom', 'backlog 收到 page.error "boom"');

  // 5. 经服务端往返 sources.fetch → sourcemap 还原
  const frames = await resolveStackVia(conn, errors[0].stack);
  check(frames.length >= 1, '堆栈解析出至少 1 帧');
  check(frames[0].original?.source === 'src/Foo.tsx', `还原到原始源 src/Foo.tsx（实际 ${frames[0].original?.source}）`);
  check(frames[0].original?.line === 2, `还原到原始行 2（实际 ${frames[0].original?.line}）`);
  check(!!frames[0].snippet && frames[0].snippet.lines.length > 0, '附带原始源码片段');

  conn.close();
  sdk.close();
  wss.close();
  httpServer.close();
  recorder.destroy();

  console.log(`\n  结果: ${passed} 通过, 0 失败`);
  // 显式退出（server/ws 句柄可能仍挂着）
  setTimeout(() => process.exit(0), 50);
}

main().catch((err) => {
  console.error('集成测试失败:', err);
  process.exit(1);
});
