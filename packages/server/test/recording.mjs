// 录制/回放端到端验证：SDK 发帧 → server 落盘分段 → HTTP API 列表/下载 → 校验内容。
import { WebSocket } from 'ws';
import { encodeFrame, makeEnvelope } from '@remotr/shared';
import { startServer } from '@remotr/server';
import { rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9911;
const REC_DIR = join(tmpdir(), 'remotr-rec-test-' + Date.now());
const room = 'rectest';
const deviceId = 'dev_test123';
const pageId = 'page_test123';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
}

function sdkFrame(method, data) {
  return encodeFrame({ kind: 'msg', envelope: makeEnvelope(method, data, 'sdk') });
}

// 最小 rrweb 事件（server 仅透传存储，不解析内部结构）
const META = (ts) => ({ type: 4, data: { href: 'http://test/', width: 800, height: 600 }, timestamp: ts });
const FULL = (ts) => ({ type: 2, data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } }, timestamp: ts });
const INCR = (ts) => ({ type: 3, data: { source: 0, texts: [], attributes: [], removes: [], adds: [] }, timestamp: ts });

async function main() {
  await mkdir(REC_DIR, { recursive: true });
  const recording = { enabled: true, dir: REC_DIR, segmentMs: 1000, maxBytes: 1024 ** 3 };
  const srv = startServer({ port: PORT, host: '127.0.0.1', panelDir: REC_DIR, sdkPath: REC_DIR, recording });
  await wait(200);

  const sdk = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}&role=sdk&deviceId=${deviceId}&pageId=${pageId}`);
  await new Promise((res, rej) => { sdk.on('open', res); sdk.on('error', rej); });

  const now = Date.now();
  // 段 1：system.info + rrweb 基线 + console + network(含 response body)
  sdk.send(sdkFrame('system.info', { ua: 'test', url: 'http://test/', title: 'Rec Test', viewport: { width: 800, height: 600 }, sdkVersion: '0.1.0' }));
  sdk.send(sdkFrame('dom.rrweb', { event: META(now), isCheckout: true }));
  sdk.send(sdkFrame('dom.rrweb', { event: FULL(now + 1) }));
  sdk.send(sdkFrame('console.entry', { level: 'log', args: [{ type: 'string', value: 'seg1-log', display: '"seg1-log"' }] }));
  sdk.send(sdkFrame('network.request', { reqId: 'rq1', url: 'http://test/api/data', method: 'GET', headers: {}, initiator: 'fetch' }));
  sdk.send(sdkFrame('network.response', { reqId: 'rq1', status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: 'HELLO_BODY_12345', mimeType: 'application/json', duration: 12 }));
  await wait(300);

  // 等待跨过段时长，再发帧触发轮转到段 2
  await wait(900);
  sdk.send(sdkFrame('dom.rrweb', { event: INCR(Date.now()) }));
  sdk.send(sdkFrame('console.entry', { level: 'warn', args: [{ type: 'string', value: 'seg2-log', display: '"seg2-log"' }] }));
  await wait(400);

  // 1) 列表 API
  const listRes = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${room}/recordings`).then((r) => r.json());
  assert(listRes.enabled === true, 'API: 录制已启用');
  assert(listRes.date && /^\d{4}-\d{2}-\d{2}$/.test(listRes.date), 'API: 返回当天日期 ' + listRes.date);
  assert(listRes.sessions.length === 1, 'API: 列出 1 个会话');
  const sess = listRes.sessions[0];
  assert(sess && sess.session.deviceId === deviceId, 'API: 会话 deviceId 正确');
  assert(sess && sess.url === 'http://test/', 'API: meta.url 来自 system.info');
  assert(sess && sess.segments.length >= 2, `API: 至少 2 段（轮转生效），实际 ${sess?.segments.length}`);

  // 2) 下载段 1，校验基线 + network body
  const seg1 = sess.segments[0];
  const text1 = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${room}/recordings/${sess.dir}/${seg1.file}`).then((r) => r.text());
  const lines1 = text1.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert(lines1[0]?.envelope?.method === 'system.info', '段1: 首行为 system.info 基线');
  assert(lines1.some((f) => f.envelope.method === 'dom.rrweb' && f.envelope.data.event.type === 2), '段1: 含 FullSnapshot');
  const resp = lines1.find((f) => f.envelope.method === 'network.response');
  assert(resp?.envelope?.data?.body === 'HELLO_BODY_12345', '段1: network.response body 完整保留 ✅（这是回放能看到响应数据的关键）');
  assert(lines1.some((f) => f.envelope.method === 'console.entry'), '段1: 含 console.entry');

  // 3) 段 2 也以基线开头（自包含）
  const seg2 = sess.segments[1];
  const text2 = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${room}/recordings/${sess.dir}/${seg2.file}`).then((r) => r.text());
  const lines2 = text2.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert(lines2[0]?.envelope?.method === 'system.info', '段2: 首行为 system.info 基线（自包含）');
  assert(lines2.some((f) => f.envelope.method === 'dom.rrweb' && f.envelope.data.event.type === 2), '段2: 基线含上一个 FullSnapshot');
  assert(lines2.some((f) => f.envelope.data?.value === 'seg2-log' || (f.envelope.method === 'console.entry')), '段2: 含段内实时 console');

  // 4) 基线时间重定位：段2 的 rrweb 时间跨度应为真实活动时长（毫秒级），
  //    而非把基线之前 ~1.2s 的空闲间隔算进去（幻影时长）
  const rrTs2 = lines2.filter((f) => f.envelope.method === 'dom.rrweb').map((f) => f.envelope.data.event.timestamp);
  const span2 = Math.max(...rrTs2) - Math.min(...rrTs2);
  assert(span2 < 100, `段2: 基线时间已重定位（rrweb 跨度 ${span2}ms < 100ms，未含空闲间隔）`);

  // 5) 空闲门控：超过段时长后，非 rrweb 帧不触发轮转（不再产出 0 秒垃圾段）
  await wait(1100);
  sdk.send(sdkFrame('console.entry', { level: 'log', args: [{ type: 'string', value: 'idle-log', display: '"idle-log"' }] }));
  await wait(300);
  let list2 = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${room}/recordings`).then((r) => r.json());
  assert(list2.sessions[0].segments.length === 2, `空闲门控: 超时后 console 不轮转（仍 2 段，实际 ${list2.sessions[0].segments.length}）`);

  // 6) rrweb 活动到来才轮转 → 第 3 段
  sdk.send(sdkFrame('dom.rrweb', { event: INCR(Date.now()) }));
  await wait(300);
  list2 = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${room}/recordings`).then((r) => r.json());
  assert(list2.sessions[0].segments.length === 3, `活动门控: rrweb 到来触发轮转（3 段，实际 ${list2.sessions[0].segments.length}）`);

  // 7) 路径穿越防护
  const trav = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${room}/recordings/${sess.dir}/..%2f..%2fmeta.json`);
  assert(trav.status === 400 || trav.status === 404, '安全: 拒绝目录穿越路径');

  sdk.close();
  srv.recorder.destroy();
  srv.httpServer.close();
  await rm(REC_DIR, { recursive: true, force: true });

  console.log(`\n  结果: ${pass} 通过, ${fail} 失败\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
