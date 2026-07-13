// AI 工具端到端集成测试：真实 Remotr server + 假 SDK，经 MCP 协议（InMemoryTransport）
// 验证 run_eval / set_tracepoint / get_tracepoint_hits / diagnose 及 R6 输出上限。
// 运行：node packages/mcp/test/ai-tools.integration.mjs（需先 npm run build）
import assert from 'node:assert';
import { once } from 'node:events';
import WebSocket from 'ws';
import { SourceMapGenerator } from 'source-map-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encodeFrame, decodeFrame, makeEnvelope } from '@remotr/shared';
import { startServer } from '@remotr/server';
import { RemotrClient, createMcpServer } from '@remotr/mcp';

const ORIGINAL = 'function handleClick() {\n  throw new Error("boom");\n}\n';

function makeMap() {
  const gen = new SourceMapGenerator({ file: 'app.min.js' });
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

  // 2. 假 SDK：应答 sources.fetch / eval.run / trace.set，trace.set 后模拟一次命中
  const sdk = new WebSocket(`ws://127.0.0.1:${port}/ws?room=default&role=sdk&deviceId=dev1&pageId=page1`);
  await once(sdk, 'open');
  const send = (frame) => sdk.send(encodeFrame(frame));
  sdk.on('message', (raw) => {
    const f = decodeFrame(raw.toString());
    if (f?.kind !== 'msg') return;
    const { method, data, id } = f.envelope;
    const reply = (result) => send({ kind: 'reply', reply: { replyTo: id, result, error: null } });
    if (method === 'sources.fetch') {
      reply({ url: data.url, content: 'x\n//# sourceMappingURL=app.min.js.map', map: makeMap() });
    } else if (method === 'eval.run') {
      // 回显表达式结果（假装求值）
      reply({ result: { type: 'number', value: 42, display: '42' } });
    } else if (method === 'trace.set') {
      reply({ ok: true });
      // 模拟随后的一次命中
      send({ kind: 'msg', envelope: makeEnvelope('trace.hit', {
        id: data.tracepoint.id, path: data.tracepoint.path, seq: 1,
        args: [{ type: 'string', value: '/api/x', display: '"/api/x"' }],
        ret: { type: 'object', display: 'Promise' },
        stack: 'Error\n    at wrapped', durationMs: 0.3,
      }, 'sdk') });
    }
  });

  // SDK 上报 system.info + 错误 + console + 失败网络请求
  send({ kind: 'msg', envelope: makeEnvelope('system.info', {
    ua: 'test', url: `${base}/`, title: 'T', viewport: { width: 800, height: 600 },
    framework: 'React', sdkVersion: '0.0.0',
  }, 'sdk') });
  send({ kind: 'msg', envelope: makeEnvelope('console.entry', {
    level: 'warn', args: [{ type: 'string', value: 'about to click', display: 'about to click' }],
  }, 'sdk') });
  send({ kind: 'msg', envelope: makeEnvelope('network.request', {
    reqId: 'r1', url: `${base}/api/data`, method: 'GET', headers: {}, initiator: 'fetch',
  }, 'sdk') });
  send({ kind: 'msg', envelope: makeEnvelope('network.response', {
    reqId: 'r1', status: 500, statusText: 'ISE', headers: {}, duration: 12,
  }, 'sdk') });
  const stack = `TypeError: Cannot read properties of undefined (reading 'x')\n    at handleClick (${scriptUrl}:1:101)`;
  send({ kind: 'msg', envelope: makeEnvelope('page.error', {
    message: "Cannot read properties of undefined (reading 'x')", stack,
  }, 'sdk') });

  await delay(300); // 让 server 落 backlog

  // 3. MCP client ↔ server（InMemoryTransport），像 Claude 一样调工具
  const mcpServer = createMcpServer(new RemotrClient(base, 'default'));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverT);
  const mcp = new Client({ name: 'it', version: '0.0.0' });
  await mcp.connect(clientT);
  const call = async (name, args = {}) => {
    const res = await mcp.callTool({ name, arguments: { deviceId: 'dev1', pageId: 'page1', ...args } });
    return { text: res.content[0].text, isError: res.isError };
  };

  // 工具列表包含全部 8 个
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['remotr_run_eval', 'remotr_set_tracepoint', 'remotr_get_tracepoint_hits', 'remotr_diagnose']) {
    check(names.includes(n), `listTools 暴露 ${n}`);
  }

  // run_eval
  const evalRes = JSON.parse((await call('remotr_run_eval', { expression: '6*7' })).text);
  check(evalRes.result === '42' && evalRes.threw === false, `run_eval 返回 42（threw=false）`);

  // set_tracepoint → get_tracepoint_hits
  const tp = JSON.parse((await call('remotr_set_tracepoint', { functionPath: 'window.fetch' })).text);
  check(tp.ok === true && tp.tracepointId.startsWith('tp-'), `set_tracepoint ok，id=${tp.tracepointId}`);
  await delay(300); // 命中事件落 backlog
  const hits = JSON.parse((await call('remotr_get_tracepoint_hits', { tracepointId: tp.tracepointId })).text);
  check(hits.count === 1 && hits.hits[0].args[0] === '"/api/x"', 'get_tracepoint_hits 返回命中（含 args）');
  const noHits = JSON.parse((await call('remotr_get_tracepoint_hits', { tracepointId: 'tp-nope' })).text);
  check(noHits.count === 0, 'get_tracepoint_hits 按 id 过滤');

  // diagnose：一次调用拿到 suggestedCause + 还原帧 + console + 网络
  const diag = JSON.parse((await call('remotr_diagnose')).text);
  check(typeof diag.suggestedCause === 'string' && diag.suggestedCause.includes('src/Foo.tsx:2'),
    `suggestedCause 指向还原后的源（${diag.suggestedCause.slice(0, 60)}…）`);
  check(diag.topFrame?.at?.source === 'src/Foo.tsx', 'diagnose topFrame 还原到 src/Foo.tsx');
  check(diag.topFrame.snippet.lines.length <= 11, `snippet ≤ 11 行（实际 ${diag.topFrame.snippet.lines.length}）`);
  check(diag.networkTimeline.some((n) => n.status === 500), 'diagnose 携带 500 网络问题');
  check(diag.recentConsole.some((c) => c.text.includes('about to click')), 'diagnose 携带 console 时间线');

  // R6：输出为紧凑 JSON（无 pretty-print 缩进）
  const raw = (await call('remotr_get_errors')).text;
  check(!raw.includes('\n  "'), '输出为紧凑 JSON（无缩进）');

  mcp.close();
  sdk.close();
  wss.close();
  httpServer.close();
  recorder.destroy();

  console.log(`\n  结果: ${passed} 通过, 0 失败`);
  setTimeout(() => process.exit(0), 50);
}

main().catch((err) => {
  console.error('AI 工具集成测试失败:', err);
  process.exit(1);
});
