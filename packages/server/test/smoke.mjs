// 端到端 WS 中继冒烟测试：验证 SDK→服务端→调试端 的消息路由与 backlog 回放。
import { WebSocket } from 'ws';
import { encodeFrame, decodeFrame, makeEnvelope } from '@remotr/shared';

const PORT = process.env.PORT || 9777;
const base = `ws://127.0.0.1:${PORT}/ws`;
const room = 'smoketest-' + Date.now();
// 会话路由要求 SDK 携带 deviceId/pageId；debugger 以同一 session 接入才能收到 backlog。
const deviceId = 'dev_smoke';
const pageId = 'page_smoke';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(role, session) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ room, role });
    if (session) {
      params.set('deviceId', session.deviceId);
      params.set('pageId', session.pageId);
    }
    const ws = new WebSocket(`${base}?${params.toString()}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
}

async function main() {
  // 1. SDK 先连接并发送事件（在 debugger 接入前 → 测试 backlog）
  const sdk = await connect('sdk', { deviceId, pageId });

  // 发送 system.info（应被 backlog 保留并回放）
  sdk.send(encodeFrame({ kind: 'msg', envelope: makeEnvelope('system.info', {
    ua: 'test-ua', url: 'http://test', title: 'T', viewport: { width: 800, height: 600 }, sdkVersion: '0.1.0',
  }, 'sdk') }));

  // 发送一条 console（backlog 环形缓冲）
  sdk.send(encodeFrame({ kind: 'msg', envelope: makeEnvelope('console.entry', {
    level: 'log', args: [{ type: 'string', value: 'before-debugger', display: '"before-debugger"' }],
  }, 'sdk') }));

  await wait(200);

  // 2. debugger 接入 → 应立即收到 backlog（system.info + console）
  const dbg = await connect('debugger', { deviceId, pageId });
  const received = [];
  dbg.on('message', (raw) => {
    const f = decodeFrame(raw.toString());
    if (f && f.kind === 'msg') received.push(f.envelope.method);
  });

  await wait(300);
  assert(received.includes('system.info'), 'debugger 接入后收到 backlog 的 system.info');
  assert(received.includes('console.entry'), 'debugger 接入后收到 backlog 的 console.entry');

  // 3. 实时转发：SDK 再发一条，debugger 应实时收到
  received.length = 0;
  sdk.send(encodeFrame({ kind: 'msg', envelope: makeEnvelope('console.entry', {
    level: 'warn', args: [{ type: 'string', value: 'live', display: '"live"' }],
  }, 'sdk') }));
  await wait(200);
  assert(received.includes('console.entry'), 'SDK 实时事件转发到 debugger');

  // 4. 命令往返：debugger 发命令 → SDK 收到 → 回复 → debugger 收到 reply
  let sdkGotCmd = false;
  let dbgGotReply = false;
  const cmdId = 'cmd-1';
  sdk.on('message', (raw) => {
    const f = decodeFrame(raw.toString());
    if (f && f.kind === 'msg' && f.envelope.method === 'eval.run') {
      sdkGotCmd = true;
      // 回复
      sdk.send(encodeFrame({ kind: 'reply', reply: { replyTo: f.envelope.id, result: { ok: true }, error: null } }));
    }
  });
  dbg.on('message', (raw) => {
    const f = decodeFrame(raw.toString());
    if (f && f.kind === 'reply' && f.reply.replyTo === cmdId) dbgGotReply = true;
  });
  dbg.send(encodeFrame({ kind: 'msg', envelope: { id: cmdId, method: 'eval.run', data: { code: '1+1' }, timestamp: Date.now(), source: 'debugger' } }));
  await wait(300);
  assert(sdkGotCmd, 'debugger 命令转发到 SDK');
  assert(dbgGotReply, 'SDK 回复转发回 debugger');

  sdk.close();
  dbg.close();

  console.log(`\n  结果: ${pass} 通过, ${fail} 失败\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
