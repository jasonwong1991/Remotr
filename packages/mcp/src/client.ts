import WebSocket from 'ws';
import {
  decodeFrame,
  encodeFrame,
  makeEnvelope,
  type CommandMethod,
  type ConsoleEvent,
  type Envelope,
  type MethodData,
  type NetworkErrorEvent,
  type NetworkRequestEvent,
  type NetworkResponseEvent,
  type PageErrorEvent,
  type SessionId,
  type SessionSnapshot,
  type SystemInfoEvent,
  type TraceHitEvent,
} from '@remotr/shared';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ErrorRecord {
  index: number;
  kind: 'page-error' | 'console-error';
  message: string;
  stack?: string;
  timestamp: number;
  isPromiseRejection?: boolean;
}

export interface NetworkIssue {
  url?: string;
  method?: string;
  status?: number;
  error?: string;
  timestamp?: number;
}

/** 一次 tracepoint 命中（值均已压成 display 字符串，供 MCP 输出） */
export interface TraceHitRecord {
  id: string;
  path: string;
  seq: number;
  args: string[];
  ret?: string;
  thrown?: string;
  stack?: string;
  durationMs: number;
  timestamp: number;
}

/** /api/rooms 的一项：房间及其活跃度概览 */
export interface RoomSummary {
  id: string;
  hasSdk: boolean;
  debuggers: number;
  sessions: number;
}

/**
 * RemotrClient — 以 headless debugger 身份接入 Remotr server。
 * 列 session 走 HTTP（轻量、无状态）；查具体 session 走短连 WS（收 backlog + 发命令）。
 *
 * room 的解析策略：构造时传入的 defaultRoom 只是兜底（来自 /mcp?room= 或 --room），
 * 每次调用可以用参数覆盖。这样一份不带 ?room= 的 MCP 配置就能跨房间复用，
 * 换房间不必改 mcp.json —— 房间名由调用方（AI）从「复制给 AI 修复」的上下文里带进来。
 */
export class RemotrClient {
  constructor(
    private readonly serverUrl: string,
    private readonly defaultRoom: string,
  ) {}

  private httpBase(): string {
    return this.serverUrl.replace(/\/$/, '');
  }

  private wsBase(): string {
    const u = new URL(this.serverUrl);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}/ws`;
  }

  /** 入参 room 优先，空/缺省则回落到配置里的默认房间 */
  resolveRoom(room?: string): string {
    return room && room.trim() ? room.trim() : this.defaultRoom;
  }

  async listRooms(): Promise<RoomSummary[]> {
    const res = await fetch(`${this.httpBase()}/api/rooms`);
    if (!res.ok) throw new Error(`listRooms HTTP ${res.status}`);
    return (await res.json()) as RoomSummary[];
  }

  async listSessions(room?: string): Promise<SessionSnapshot[]> {
    const url = `${this.httpBase()}/api/rooms/${encodeURIComponent(this.resolveRoom(room))}/sessions`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`listSessions HTTP ${res.status}`);
    const data = (await res.json()) as { sessions?: SessionSnapshot[] };
    return data.sessions ?? [];
  }

  connectSession(session: SessionId, room?: string): Promise<SessionConnection> {
    return SessionConnection.open(this.wsBase(), this.resolveRoom(room), session);
  }
}

/** 单 session 的短连：收集 backlog 事件，并支持命令/回复（如 sources.fetch）。 */
export class SessionConnection {
  private readonly pending = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private idCounter = 0;
  private lastMsgAt = 0;
  readonly events: Envelope[] = [];

  private constructor(
    private readonly ws: WebSocket,
    private readonly session: SessionId,
  ) {
    ws.on('message', (raw: Buffer | string) =>
      this.onMessage(typeof raw === 'string' ? raw : raw.toString('utf-8')),
    );
  }

  static open(wsBase: string, room: string, session: SessionId): Promise<SessionConnection> {
    const params = new URLSearchParams({
      room,
      role: 'debugger',
      deviceId: session.deviceId,
      pageId: session.pageId,
    });
    const ws = new WebSocket(`${wsBase}?${params.toString()}`);
    return new Promise((resolve, reject) => {
      const conn = new SessionConnection(ws, session);
      ws.on('open', () => resolve(conn));
      ws.on('error', (err: unknown) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  }

  private onMessage(text: string): void {
    this.lastMsgAt = Date.now();
    const frame = decodeFrame(text);
    if (!frame) return;
    if (frame.kind === 'reply') {
      const p = this.pending.get(frame.reply.replyTo);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(frame.reply.replyTo);
      if (frame.reply.error) p.reject(new Error(frame.reply.error));
      else p.resolve(frame.reply.result);
      return;
    }
    this.events.push(frame.envelope);
  }

  /** 等待 backlog 静默（settleMs 内无新消息）或到 maxMs 上限 */
  async waitForBacklog(settleMs = 400, maxMs = 4000): Promise<void> {
    const start = Date.now();
    this.lastMsgAt = Date.now();
    while (Date.now() - start < maxMs) {
      await delay(100);
      if (Date.now() - this.lastMsgAt >= settleMs) return;
    }
  }

  sendCommand<M extends CommandMethod>(
    method: M,
    data: MethodData[M],
    timeoutMs = 30_000,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not open'));
        return;
      }
      const id = `mcp-${++this.idCounter}`;
      const envelope = makeEnvelope(method, data, 'debugger', id);
      envelope.target = this.session;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(encodeFrame({ kind: 'msg', envelope }));
    });
  }

  systemInfo(): SystemInfoEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].method === 'system.info') return this.events[i].data as SystemInfoEvent;
    }
    return undefined;
  }

  /** 页面错误 + error 级 console，按出现顺序编号 */
  errors(): ErrorRecord[] {
    const out: ErrorRecord[] = [];
    for (const env of this.events) {
      if (env.method === 'page.error') {
        const e = env.data as PageErrorEvent;
        out.push({
          index: out.length,
          kind: 'page-error',
          message: e.message,
          stack: e.stack,
          timestamp: env.timestamp,
          isPromiseRejection: e.isPromiseRejection,
        });
      } else if (env.method === 'console.entry') {
        const e = env.data as ConsoleEvent;
        if (e.level === 'error') {
          out.push({
            index: out.length,
            kind: 'console-error',
            message: e.args.map((a) => a.display).join(' '),
            stack: e.stack,
            timestamp: env.timestamp,
          });
        }
      }
    }
    return out;
  }

  /** 最近 n 条 console（任意级别），给 AI 时间线上下文 */
  recentConsole(n = 30): Array<{ level: string; text: string; timestamp: number }> {
    const all: Array<{ level: string; text: string; timestamp: number }> = [];
    for (const env of this.events) {
      if (env.method === 'console.entry') {
        const e = env.data as ConsoleEvent;
        all.push({ level: e.level, text: e.args.map((a) => a.display).join(' '), timestamp: env.timestamp });
      }
    }
    return all.slice(-n);
  }

  /** 失败的网络请求（网络错误 + 4xx/5xx 响应），最多 max 条（取最近的） */
  networkIssues(max = 20): NetworkIssue[] {
    const reqs = new Map<string, NetworkRequestEvent>();
    const out: NetworkIssue[] = [];
    for (const env of this.events) {
      if (env.method === 'network.request') {
        const r = env.data as NetworkRequestEvent;
        reqs.set(r.reqId, r);
      } else if (env.method === 'network.error') {
        const e = env.data as NetworkErrorEvent;
        const r = reqs.get(e.reqId);
        out.push({ url: r?.url, method: r?.method, error: e.error, timestamp: env.timestamp });
      } else if (env.method === 'network.response') {
        const e = env.data as NetworkResponseEvent;
        if (e.status >= 400) {
          const r = reqs.get(e.reqId);
          out.push({ url: r?.url, method: r?.method, status: e.status, timestamp: env.timestamp });
        }
      }
    }
    return out.slice(-max);
  }

  /** 最近的 tracepoint 命中，最多 max 条（取最近的）；可按 id 过滤 */
  traceHits(max = 20, id?: string): TraceHitRecord[] {
    const out: TraceHitRecord[] = [];
    for (const env of this.events) {
      if (env.method !== 'trace.hit') continue;
      const h = env.data as TraceHitEvent;
      if (id && h.id !== id) continue;
      out.push({
        id: h.id,
        path: h.path,
        seq: h.seq,
        args: h.args.map((a) => a.display),
        ret: h.ret?.display,
        thrown: h.thrown?.display,
        stack: h.stack,
        durationMs: h.durationMs,
        timestamp: env.timestamp,
      });
    }
    return out.slice(-max);
  }

  close(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.ws.close();
  }
}
