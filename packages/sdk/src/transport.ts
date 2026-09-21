import {
  decodeFrame,
  encodeFrame,
  makeEnvelope,
  type CommandMethod,
  type Frame,
  type MethodData,
  type MethodName,
  type Reply,
  type SessionId,
} from '@remotr/shared';

type CommandHandler = (data: unknown) => Promise<unknown> | unknown;

/** Server → SDK 的单向事件（无 id，不回复） */
type ServerEventMethod = 'session.watchers';

/**
 * Transport — SDK 端 WebSocket 传输层。
 * 职责：连接管理、自动重连、离线消息队列、命令分发。
 * 单一职责：只管通信，不关心采集逻辑（采集插件通过 send 推送事件）。
 */
export class Transport {
  private ws: WebSocket | null = null;
  private url: string;
  private queue: string[] = [];
  private reconnectDelay = 1000;
  private readonly maxDelay = 10_000;
  private closedByUser = false;
  private handlers = new Map<CommandMethod | ServerEventMethod, CommandHandler>();
  private connectedListeners: Array<() => void> = [];
  private sessionId: SessionId;
  private identity?: string;

  constructor(
    serverUrl: string,
    room: string,
    sessionId: SessionId,
    identity?: string,
    loadId?: string,
  ) {
    // serverUrl 形如 http(s)://host:port，转为 ws(s)://host:port/ws
    const u = new URL(serverUrl);
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';

    // WebSocket URL 包含 session 信息；load 标识本次页面加载，服务端据此区分
    // "刷新后重新连上"与"断线重连"（前者要清上一次加载的事件 backlog）
    const params = new URLSearchParams({
      room,
      role: 'sdk',
      deviceId: sessionId.deviceId,
      pageId: sessionId.pageId,
    });
    if (loadId) params.set('load', loadId);

    if (identity) {
      params.set('identity', identity);
    }

    this.url = `${wsProto}//${u.host}/ws?${params.toString()}`;
    this.sessionId = sessionId;
    this.identity = identity;
  }

  /** 获取 session ID */
  getSessionId(): SessionId {
    return this.sessionId;
  }

  /** 获取身份标识 */
  getIdentity(): string | undefined {
    return this.identity;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.flushQueue();
      this.connectedListeners.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
    };

    this.ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : '';
      if (text) this.onFrame(text);
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      if (!this.closedByUser) this.open();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
  }

  /** 注册命令处理器（调试端 → SDK 的命令） */
  onCommand(method: CommandMethod, handler: CommandHandler): void {
    this.handlers.set(method, handler);
  }

  /** 注册服务端事件处理器（Server → SDK 的单向通知，如观看者数变化） */
  onServerEvent<M extends ServerEventMethod>(method: M, handler: (data: MethodData[M]) => void): void {
    this.handlers.set(method, handler as CommandHandler);
  }

  /** 连接建立时回调（用于发送初始快照） */
  onConnected(fn: () => void): void {
    this.connectedListeners.push(fn);
  }

  /** 发送事件（SDK → 调试端） */
  send<M extends MethodName>(method: M, data: MethodData[M]): void {
    const frame: Frame = {
      kind: 'msg',
      envelope: makeEnvelope(method, data, 'sdk'),
    };
    this.raw(encodeFrame(frame));
  }

  private raw(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
    } else {
      // 离线队列，最多缓存 1000 条，防止内存暴涨
      this.queue.push(text);
      if (this.queue.length > 1000) this.queue.shift();
    }
  }

  private flushQueue(): void {
    if (!this.ws) return;
    const pending = this.queue;
    this.queue = [];
    for (const text of pending) this.ws.send(text);
  }

  private async onFrame(text: string): Promise<void> {
    const frame = decodeFrame(text);
    if (!frame || frame.kind !== 'msg') return;
    const env = frame.envelope;
    const handler = this.handlers.get(env.method as CommandMethod | ServerEventMethod);
    if (!handler) return;

    let reply: Reply;
    try {
      const result = await handler(env.data);
      reply = { replyTo: env.id ?? '', result, error: null };
    } catch (err) {
      reply = { replyTo: env.id ?? '', error: String(err) };
    }
    // 命令必须带 id 才回复
    if (env.id) this.raw(encodeFrame({ kind: 'reply', reply }));
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }
}
