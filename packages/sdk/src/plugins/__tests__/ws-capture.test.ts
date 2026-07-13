import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installWsCapture } from '../ws-capture.js';
import type { Transport } from '../../transport.js';

/**
 * 用可控 stub 替换 window.WebSocket / window.EventSource，
 * 验证插件的"透传 + 旁听"行为与内部通道排除逻辑。
 */

type Listener = (ev: unknown) => void;

class FakeSocketBase {
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(): void {}
  emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

class FakeWebSocket extends FakeSocketBase {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  protocols?: string | string[];
  sent: unknown[] = [];
  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.protocols = protocols;
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {}
}

class FakeEventSource extends FakeSocketBase {
  url: string;
  withCredentials: boolean;
  readyState = 1;
  closed = false;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    super();
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
  }
  close(): void {
    this.closed = true;
  }
}

const INTERNAL_PREFIX = 'ws://remotr-server:9777/ws';

function makeTransport(): { transport: Transport; sent: Array<{ method: string; data: any }> } {
  const sent: Array<{ method: string; data: any }> = [];
  const transport = {
    send: vi.fn((method: string, data: unknown) => {
      sent.push({ method, data: data as any });
    }),
  } as unknown as Transport;
  return { transport, sent };
}

describe('installWsCapture — WebSocket', () => {
  let origWS: typeof WebSocket;
  let origES: typeof EventSource | undefined;
  let uninstall: () => void;
  let sent: Array<{ method: string; data: any }>;

  beforeEach(() => {
    origWS = window.WebSocket;
    origES = window.EventSource;
    (window as any).WebSocket = FakeWebSocket;
    (window as any).EventSource = FakeEventSource;
    const t = makeTransport();
    sent = t.sent;
    uninstall = installWsCapture(t.transport, INTERNAL_PREFIX);
  });

  afterEach(() => {
    uninstall();
    (window as any).WebSocket = origWS;
    (window as any).EventSource = origES;
  });

  it('replaces window.WebSocket and reports open with url + protocols', () => {
    const ws = new window.WebSocket('ws://example.com/chat', ['proto1']);
    expect(ws).toBeInstanceOf(FakeWebSocket);
    const open = sent.find((e) => e.method === 'network.ws.open');
    expect(open).toBeDefined();
    expect(open!.data.url).toBe('ws://example.com/chat');
    expect(open!.data.protocols).toEqual(['proto1']);
    expect(open!.data.connectionId).toMatch(/^ws/);
  });

  it('passes send() through to the real socket and reports the frame', () => {
    const ws = new window.WebSocket('ws://example.com/chat') as unknown as FakeWebSocket;
    (ws as unknown as WebSocket).send('hello');
    expect(ws.sent).toEqual(['hello']);
    const frame = sent.find((e) => e.method === 'network.ws.send');
    expect(frame!.data.data).toBe('hello');
    expect(frame!.data.size).toBe(5);
    expect(frame!.data.truncated).toBeUndefined();
  });

  it('truncates oversized outgoing frames and flags them', () => {
    const ws = new window.WebSocket('ws://example.com/chat') as unknown as FakeWebSocket;
    const big = 'x'.repeat(60_000);
    (ws as unknown as WebSocket).send(big);
    // 业务侧收到完整数据，采集侧截断
    expect((ws.sent[0] as string).length).toBe(60_000);
    const frame = sent.find((e) => e.method === 'network.ws.send');
    expect(frame!.data.truncated).toBe(true);
    expect(frame!.data.size).toBe(60_000);
    expect(frame!.data.data.length).toBeLessThan(60_000);
  });

  it('reports incoming messages without consuming them', () => {
    const ws = new window.WebSocket('ws://example.com/chat') as unknown as FakeWebSocket;
    const appListener = vi.fn();
    (ws as unknown as WebSocket).addEventListener('message', appListener);
    ws.emit('message', { data: 'pong' });
    expect(appListener).toHaveBeenCalledTimes(1);
    const frame = sent.find((e) => e.method === 'network.ws.message');
    expect(frame!.data.data).toBe('pong');
  });

  it('describes binary frames with a placeholder instead of raw bytes', () => {
    const ws = new window.WebSocket('ws://example.com/chat') as unknown as FakeWebSocket;
    (ws as unknown as WebSocket).send(new ArrayBuffer(16));
    const frame = sent.find((e) => e.method === 'network.ws.send');
    expect(frame!.data.binary).toBe(true);
    expect(frame!.data.size).toBe(16);
    expect(frame!.data.data).toContain('ArrayBuffer');
  });

  it('reports close with code/reason and error events', () => {
    const ws = new window.WebSocket('ws://example.com/chat') as unknown as FakeWebSocket;
    ws.emit('close', { code: 1006, reason: 'abnormal', wasClean: false });
    ws.emit('error', {});
    const close = sent.find((e) => e.method === 'network.ws.close');
    expect(close!.data.code).toBe(1006);
    expect(close!.data.reason).toBe('abnormal');
    expect(sent.some((e) => e.method === 'network.ws.error')).toBe(true);
  });

  it('skips the SDK internal transport socket entirely', () => {
    const ws = new window.WebSocket(`${INTERNAL_PREFIX}?room=default&role=sdk`) as unknown as FakeWebSocket;
    (ws as unknown as WebSocket).send('internal-frame');
    ws.emit('message', { data: 'internal-reply' });
    // 透传不受影响
    expect(ws.sent).toEqual(['internal-frame']);
    // 但零采集
    expect(sent.filter((e) => e.method.indexOf('network.ws.') === 0)).toEqual([]);
  });

  it('uninstall restores the original constructors', () => {
    uninstall();
    expect(window.WebSocket).toBe(FakeWebSocket as unknown as typeof WebSocket);
    expect(window.EventSource).toBe(FakeEventSource as unknown as typeof EventSource);
    // 幂等：重装以满足 afterEach 的再次 uninstall
    const t = makeTransport();
    uninstall = installWsCapture(t.transport, INTERNAL_PREFIX);
  });
});

describe('installWsCapture — EventSource (SSE)', () => {
  let origWS: typeof WebSocket;
  let origES: typeof EventSource | undefined;
  let uninstall: () => void;
  let sent: Array<{ method: string; data: any }>;

  beforeEach(() => {
    origWS = window.WebSocket;
    origES = window.EventSource;
    (window as any).WebSocket = FakeWebSocket;
    (window as any).EventSource = FakeEventSource;
    const t = makeTransport();
    sent = t.sent;
    uninstall = installWsCapture(t.transport, INTERNAL_PREFIX);
  });

  afterEach(() => {
    uninstall();
    (window as any).WebSocket = origWS;
    (window as any).EventSource = origES;
  });

  it('reports open with url + withCredentials', () => {
    new window.EventSource('/events', { withCredentials: true });
    const open = sent.find((e) => e.method === 'network.sse.open');
    expect(open!.data.url).toBe('/events');
    expect(open!.data.withCredentials).toBe(true);
    expect(open!.data.connectionId).toMatch(/^sse/);
  });

  it('reports default messages with lastEventId', () => {
    const es = new window.EventSource('/events') as unknown as FakeEventSource;
    es.emit('message', { data: '{"a":1}', lastEventId: '42' });
    const msg = sent.find((e) => e.method === 'network.sse.message');
    expect(msg!.data.event).toBe('message');
    expect(msg!.data.data).toBe('{"a":1}');
    expect(msg!.data.lastEventId).toBe('42');
  });

  it('captures named events once the app subscribes, without breaking the app listener', () => {
    const es = new window.EventSource('/events') as unknown as FakeEventSource;
    const appListener = vi.fn();
    (es as unknown as EventSource).addEventListener('ticker', appListener as EventListener);
    es.emit('ticker', { data: 'up', lastEventId: '' });
    expect(appListener).toHaveBeenCalledTimes(1);
    const msg = sent.find((e) => e.method === 'network.sse.message' && e.data.event === 'ticker');
    expect(msg!.data.data).toBe('up');
  });

  it('reports error with readyState and close() calls', () => {
    const es = new window.EventSource('/events') as unknown as FakeEventSource;
    es.readyState = 2;
    es.emit('error', {});
    (es as unknown as EventSource).close();
    expect(es.closed).toBe(true); // close 透传
    const err = sent.find((e) => e.method === 'network.sse.error');
    expect(err!.data.readyState).toBe(2);
    expect(sent.some((e) => e.method === 'network.sse.close')).toBe(true);
  });
});
