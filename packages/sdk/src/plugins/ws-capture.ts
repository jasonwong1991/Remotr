import type { Transport } from '../transport.js';
import { debugWarn } from '../internals.js';

/**
 * WebSocket / EventSource(SSE) 流量采集插件。
 *
 * 关键约束（与 network.ts 同款防御姿态）：
 *  - 被注入到老旧/敌对页面（Android 8 / Chrome 58，es2017）：所有全局都特性检测，
 *    缺失则静默跳过，绝不抛错。
 *  - 完全透传：包装后的 WebSocket / EventSource 行为与原生一致 —— 用原生 class 的
 *    子类保留 `instanceof`、静态常量（CONNECTING/OPEN/...）与原型链；采集只经
 *    addEventListener 被动旁听（与业务的 onmessage 并存，互不消费）。
 *  - 采集失败绝不影响连接：每次上报都包在 try/catch 里。
 *  - 排除 SDK 自身的 transport socket：按内部 /ws 前缀跳过，避免自采集导致无界回环。
 *  - 帧负载封顶（复用 network.ts 的 ~50KB 约定），超出截断并标记 truncated。
 */

const MAX_FRAME = 50_000;

function clampFrame(s: string): string {
  return s.length > MAX_FRAME ? s.slice(0, MAX_FRAME) + '…[truncated]' : s;
}

function now(): number {
  return Date.now();
}

let wsCounter = 0;
function nextWsId(): string {
  return `ws${Date.now().toString(36)}-${(wsCounter++).toString(36)}`;
}

let sseCounter = 0;
function nextSseId(): string {
  return `sse${Date.now().toString(36)}-${(sseCounter++).toString(36)}`;
}

/** 把 WebSocket.send / message 的多形态负载归一为 { text, size, truncated, binary } */
function describePayload(
  data: unknown,
): { text: string; size: number; truncated: boolean; binary: boolean } {
  try {
    if (typeof data === 'string') {
      const truncated = data.length > MAX_FRAME;
      return { text: clampFrame(data), size: data.length, truncated, binary: false };
    }
    if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
      return { text: `[ArrayBuffer ${data.byteLength} bytes]`, size: data.byteLength, truncated: false, binary: true };
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return { text: `[Blob ${data.size} bytes]`, size: data.size, truncated: false, binary: true };
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      const name = (view.constructor && view.constructor.name) || 'ArrayBufferView';
      return { text: `[${name} ${view.byteLength} bytes]`, size: view.byteLength, truncated: false, binary: true };
    }
  } catch {
    /* fall through to string coercion */
  }
  const str = String(data);
  return { text: clampFrame(str), size: str.length, truncated: str.length > MAX_FRAME, binary: false };
}

/**
 * 安装 WS/SSE 采集。
 * @param internalWsPrefix SDK transport 的 WebSocket URL 前缀（如 "ws://host/ws"），
 *        匹配的连接是 SDK 自身通道，跳过采集以防回环。
 * @returns 卸载函数：还原被替换的全局。
 */
export function installWsCapture(transport: Transport, internalWsPrefix: string): () => void {
  const uninstalls: Array<() => void> = [];

  const uWs = hookWebSocket(transport, internalWsPrefix);
  if (uWs) uninstalls.push(uWs);

  const uSse = hookEventSource(transport);
  if (uSse) uninstalls.push(uSse);

  return () => {
    for (const u of uninstalls) {
      try {
        u();
      } catch {
        /* best-effort */
      }
    }
  };
}

/** 每个被采集实例的 connectionId（内部 transport socket 不入表 → send 时按缺失跳过） */
const wsIds = new WeakMap<WebSocket, string>();

function hookWebSocket(transport: Transport, internalWsPrefix: string): (() => void) | void {
  const OrigWS = window.WebSocket;
  if (typeof OrigWS !== 'function') return;

  const isInternal = (url: string): boolean => {
    if (!internalWsPrefix) return false;
    try {
      return new URL(url, location.href).href.indexOf(internalWsPrefix) === 0;
    } catch {
      return false;
    }
  };

  const normalizeProtocols = (p?: string | string[]): string[] | undefined => {
    if (p == null) return undefined;
    return Array.isArray(p) ? p.slice() : [p];
  };

  class RemotrWebSocket extends OrigWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url as string, protocols);
      try {
        const urlStr = typeof url === 'string' ? url : String(url);
        if (isInternal(urlStr)) return; // SDK 自身通道，不采集

        const connectionId = nextWsId();
        wsIds.set(this, connectionId);

        transport.send('network.ws.open', {
          connectionId,
          url: urlStr,
          protocols: normalizeProtocols(protocols),
          timestamp: now(),
        });

        this.addEventListener('message', (ev: MessageEvent) => {
          const cid = wsIds.get(this);
          if (!cid) return;
          try {
            const p = describePayload(ev.data);
            transport.send('network.ws.message', {
              connectionId: cid,
              data: p.text,
              size: p.size,
              truncated: p.truncated || undefined,
              binary: p.binary || undefined,
              timestamp: now(),
            });
          } catch {
            /* ignore */
          }
        });

        this.addEventListener('close', (ev: CloseEvent) => {
          const cid = wsIds.get(this);
          if (!cid) return;
          try {
            transport.send('network.ws.close', {
              connectionId: cid,
              code: ev.code,
              reason: ev.reason,
              wasClean: ev.wasClean,
              timestamp: now(),
            });
          } catch {
            /* ignore */
          }
        });

        this.addEventListener('error', () => {
          const cid = wsIds.get(this);
          if (!cid) return;
          try {
            transport.send('network.ws.error', { connectionId: cid, timestamp: now() });
          } catch {
            /* ignore */
          }
        });
      } catch (e) {
        // 采集初始化失败绝不影响连接本身
        debugWarn('[remotr] ws capture init failed:', e);
      }
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      // 先透传再上报：send 抛错（如 CONNECTING 状态）时异常照常传播，且不记录未发出的帧
      super.send(data as string);
      const cid = wsIds.get(this);
      if (cid) {
        try {
          const p = describePayload(data);
          transport.send('network.ws.send', {
            connectionId: cid,
            data: p.text,
            size: p.size,
            truncated: p.truncated || undefined,
            binary: p.binary || undefined,
            timestamp: now(),
          });
        } catch {
          /* ignore */
        }
      }
    }
  }

  try {
    window.WebSocket = RemotrWebSocket as unknown as typeof WebSocket;
  } catch (e) {
    debugWarn('[remotr] cannot replace window.WebSocket:', e);
    return;
  }

  return () => {
    try {
      window.WebSocket = OrigWS;
    } catch {
      /* best-effort */
    }
  };
}

/** 每个被采集 EventSource 的 connectionId */
const sseIds = new WeakMap<EventSource, string>();
/** 每个 EventSource 已附加旁听器的具名事件类型集合（防重复附加） */
const sseNamed = new WeakMap<EventSource, Set<string>>();

function hookEventSource(transport: Transport): (() => void) | void {
  // 部分 WebView 无 EventSource —— 特性检测，缺失静默跳过
  const OrigES = window.EventSource;
  if (typeof OrigES !== 'function') return;

  const captureMessage = (self: EventSource, eventType: string, ev: MessageEvent): void => {
    const cid = sseIds.get(self);
    if (!cid) return;
    try {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      transport.send('network.sse.message', {
        connectionId: cid,
        event: eventType,
        data: clampFrame(raw),
        size: raw.length,
        truncated: raw.length > MAX_FRAME || undefined,
        lastEventId: ev.lastEventId || undefined,
        timestamp: now(),
      });
    } catch {
      /* ignore */
    }
  };

  class RemotrEventSource extends OrigES {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url as string, init);
      try {
        const connectionId = nextSseId();
        sseIds.set(this, connectionId);

        transport.send('network.sse.open', {
          connectionId,
          url: typeof url === 'string' ? url : String(url),
          withCredentials: !!(init && init.withCredentials),
          timestamp: now(),
        });

        this.addEventListener('message', (ev: MessageEvent) => captureMessage(this, 'message', ev));
        this.addEventListener('error', () => {
          const cid = sseIds.get(this);
          if (!cid) return;
          try {
            transport.send('network.sse.error', {
              connectionId: cid,
              readyState: this.readyState,
              timestamp: now(),
            });
          } catch {
            /* ignore */
          }
        });
      } catch (e) {
        debugWarn('[remotr] sse capture init failed:', e);
      }
    }

    // 具名事件（es.addEventListener('foo', ...)）无法预知类型 —— 拦截注册，
    // 首次为该类型附加一个被动旁听器，业务监听器照常透传。
    // 重载签名照抄 lib.dom 的 EventSource.addEventListener，保持子类型兼容。
    addEventListener<K extends keyof EventSourceEventMap>(
      type: K,
      listener: (this: EventSource, ev: EventSourceEventMap[K]) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: (this: EventSource, event: MessageEvent) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: unknown,
      options?: boolean | AddEventListenerOptions,
    ): void {
      try {
        if (type !== 'message' && type !== 'open' && type !== 'error' && sseIds.get(this)) {
          let seen = sseNamed.get(this);
          if (!seen) {
            seen = new Set<string>();
            sseNamed.set(this, seen);
          }
          if (!seen.has(type)) {
            seen.add(type);
            super.addEventListener(type, (ev: Event) => captureMessage(this, type, ev as MessageEvent));
          }
        }
      } catch {
        /* ignore — 采集附加失败不影响业务监听注册 */
      }
      super.addEventListener(type, listener as EventListenerOrEventListenerObject, options);
    }

    close(): void {
      const cid = sseIds.get(this);
      if (cid) {
        try {
          transport.send('network.sse.close', { connectionId: cid, timestamp: now() });
        } catch {
          /* ignore */
        }
      }
      super.close();
    }
  }

  try {
    window.EventSource = RemotrEventSource as unknown as typeof EventSource;
  } catch (e) {
    debugWarn('[remotr] cannot replace window.EventSource:', e);
    return;
  }

  return () => {
    try {
      window.EventSource = OrigES;
    } catch {
      /* best-effort */
    }
  };
}
