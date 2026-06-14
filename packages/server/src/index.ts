import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { decodeFrame } from '@remotr/shared';
import { RoomRegistry } from './room.js';
import { RecordingManager, loadRecordingConfig, type RecordingConfig } from './recording.js';

export interface ServerOptions {
  port: number;
  host: string;
  /** 调试面板静态文件目录 (debugger/dist) */
  panelDir: string;
  /** 注入 SDK 文件路径 (sdk/dist/remotr.js) */
  sdkPath: string;
  /** 录制配置；省略时从环境变量加载（根目录回退到 process.cwd()） */
  recording?: RecordingConfig;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function startServer(opts: ServerOptions) {
  const recCfg = opts.recording ?? loadRecordingConfig(process.cwd());
  const recorder = new RecordingManager(recCfg);
  void recorder.start();

  const rooms = new RoomRegistry(recorder);

  const httpServer = createServer((req, res) => {
    handleHttp(req, res, opts, rooms, recorder).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleWs(ws, url, rooms);
    });
  });

  httpServer.listen(opts.port, opts.host, () => {
    const base = `http://${opts.host}:${opts.port}`;
    console.log(`\n  Remotr server running`);
    console.log(`  ├─ 调试面板:   ${base}/`);
    console.log(`  ├─ 注入脚本:   ${base}/remotr.js`);
    console.log(`  └─ WebSocket:  ws://${opts.host}:${opts.port}/ws\n`);
    console.log(`  在目标页面注入:`);
    console.log(
      `  <script src="${base}/remotr.js" data-room="default"></script>\n`,
    );
  });

  return { httpServer, wss, rooms, recorder };
}

function handleWs(ws: WebSocket, url: URL, rooms: RoomRegistry): void {
  const roomId = url.searchParams.get('room') || 'default';
  const role = url.searchParams.get('role') === 'sdk' ? 'sdk' : 'debugger';

  // 提取 session 参数
  const deviceId = url.searchParams.get('deviceId') || undefined;
  const pageId = url.searchParams.get('pageId') || undefined;
  const identity = url.searchParams.get('identity') || undefined;

  const room = rooms.get(roomId);

  let member: import('./room.js').Member;

  if (role === 'sdk') {
    // SDK 必须携带 deviceId 和 pageId
    if (!deviceId || !pageId) {
      ws.close(1008, 'SDK must provide deviceId and pageId');
      return;
    }
    member = room.addSdk(ws, { deviceId, pageId, identity });
  } else {
    // Debugger：有 deviceId/pageId 则为 Session 模式，否则为 Dashboard 模式
    const targetSession = deviceId && pageId ? { deviceId, pageId } : null;
    member = room.addDebugger(ws, targetSession);
    // 接入时立即回放
    room.replayTo(member);
  }

  ws.on('message', (raw: Buffer | string) => {
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
      const frame = decodeFrame(text);

      if (!frame) {
        console.warn(`[Security] Invalid frame from ${member.role} ${member.role === 'sdk' ? `${member.session.deviceId}:${member.session.pageId}` : member.targetSession ? `${member.targetSession.deviceId}:${member.targetSession.pageId}` : 'dashboard'}`);
        return;
      }

      // Validate frame structure
      if (frame.kind === 'msg') {
        if (!frame.envelope || typeof frame.envelope.method !== 'string') {
          console.warn(`[Security] Malformed envelope from ${member.role}`);
          return;
        }

        // Validate known methods
        const validMethods = [
          'system.info', 'console.entry', 'network.request', 'network.requestBody',
          'network.response', 'network.responseBody', 'storage.set', 'storage.delete',
          'storage.clear', 'dom.rrweb', 'elements.picked', 'eval.run', 'page.error',
          'page.reload', 'sources.list', 'sources.fetch'
        ];

        const methodPrefix = frame.envelope.method.split('.')[0];
        if (!validMethods.some(m => m.startsWith(methodPrefix))) {
          console.warn(`[Security] Unknown method '${frame.envelope.method}' from ${member.role}`);
          // Don't return - allow forward compatibility with new methods
        }
      }

      room.route(member, frame, text);
    } catch (err) {
      console.error(`[Security] Frame processing error from ${member.role}:`, err);
    }
  });

  const cleanup = () => {
    room.remove(member);
    // 通知 Dashboard 更新（SDK 离开时）
    if (member.role === 'sdk') {
      // Use setImmediate to ensure removal completed
      setImmediate(() => room.broadcastDashboardSnapshot());
    }
    if (room.size === 0 && room.getAllSessions().length === 0) {
      rooms.delete(roomId);
    }
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ServerOptions,
  rooms: RoomRegistry,
  recorder: RecordingManager,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // CORS：注入脚本可能被任意源页面加载
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 房间列表 API
  if (pathname === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(rooms.list()));
    return;
  }

  // 录制 API：列表 + 单段下载
  //   GET /api/rooms/:room/recordings              → 当天录制列表
  //   GET /api/rooms/:room/recordings/:dir/:file    → 单段 JSONL
  const recMatch = /^\/api\/rooms\/(.+)\/recordings(?:\/([^/]+)\/([^/]+))?$/.exec(pathname);
  if (recMatch) {
    const [, room, dir, file] = recMatch;
    if (dir && file) {
      const path = recorder.resolveSegmentPath(room, dir, file);
      if (!path) {
        res.writeHead(400);
        res.end('Bad recording path');
        return;
      }
      try {
        const body = await readFile(path);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('Recording segment not found');
      }
      return;
    }
    const list = await recorder.listRecordings(room);
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(list));
    return;
  }

  // Sessions API（特定 room 的所有 session）
  if (pathname.startsWith('/api/rooms/') && pathname.endsWith('/sessions')) {
    const roomId = pathname.slice('/api/rooms/'.length, -'/sessions'.length);
    const room = rooms.get(roomId);
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ room: roomId, sessions: room.getAllSessions() }));
    return;
  }

  // 注入 SDK 脚本
  if (pathname === '/remotr.js') {
    await serveFile(res, opts.sdkPath, '.js');
    return;
  }

  // 调试面板静态资源（SPA：未知路径回退 index.html）
  if (pathname === '/') pathname = '/index.html';
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(opts.panelDir, safe);

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
    await serveFile(res, filePath, extname(filePath));
  } catch {
    // SPA fallback
    await serveFile(res, join(opts.panelDir, 'index.html'), '.html').catch(
      () => {
        res.writeHead(404);
        res.end('Not found');
      },
    );
  }
}

async function serveFile(
  res: ServerResponse,
  filePath: string,
  ext: string,
): Promise<void> {
  const body = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  res.end(body);
}
