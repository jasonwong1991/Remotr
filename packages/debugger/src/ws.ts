import {
  decodeFrame,
  encodeFrame,
  makeEnvelope,
  type CommandMethod,
  type MethodData,
  type Reply,
  type SessionId,
  type SpyAtom,
} from '@remotr/shared';
import { useStore } from './store';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;
const CMD_TIMEOUT_MS = 10_000;

// Pending command callbacks keyed by envelope id
const _pending = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();

let _ws: WebSocket | null = null;
let _reconnectDelay = RECONNECT_BASE_MS;
let _destroyed = false;
let _currentSession: SessionId | null = null;
let _connectionGeneration = 0; // Guard against stale socket callbacks

function getRoomId(): string {
  // 优先从 hash 读取，其次从 search
  const hash = window.location.hash.slice(1);
  if (hash.includes('?')) {
    const params = new URLSearchParams(hash.split('?')[1]);
    if (params.has('room')) return params.get('room')!;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('room') ?? 'default';
}

function getWsUrl(): string {
  const { protocol, host } = window.location;
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    room: getRoomId(),
    role: 'debugger',
  });
  if (_currentSession) {
    params.set('deviceId', _currentSession.deviceId);
    params.set('pageId', _currentSession.pageId);
  }
  return `${wsProto}//${host}/ws?${params.toString()}`;
}

/** Helper to compare sessions by value */
function sameSession(a: SessionId | null, b: SessionId | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.deviceId === b.deviceId && a.pageId === b.pageId;
}

/** 设置当前 session 目标（用于 Session 调试模式） */
export function setTargetSession(session: SessionId | null): void {
  _currentSession = session;
}

/** 获取当前 session 目标 */
export function getTargetSession(): SessionId | null {
  return _currentSession;
}

function handleFrame(raw: string, generation: number): void {
  // Ignore messages from stale connections
  if (generation !== _connectionGeneration) return;

  const frame = decodeFrame(raw);
  if (!frame) return;

  const store = useStore.getState();

  if (frame.kind === 'reply') {
    const pending = _pending.get(frame.reply.replyTo);
    if (pending) {
      clearTimeout(pending.timer);
      _pending.delete(frame.reply.replyTo);
      pending.resolve(frame.reply);
    }
    return;
  }

  // kind === 'msg'
  const { method, data, timestamp } = frame.envelope;

  switch (method) {
    case 'system.info':
      store.setSystemInfo(data as MethodData['system.info']);
      break;
    case 'console.entry':
      store.addConsoleEntry(data as MethodData['console.entry'], timestamp);
      break;
    case 'network.request':
      store.addNetworkRequest(data as MethodData['network.request']);
      break;
    case 'network.response':
      store.addNetworkResponse(data as MethodData['network.response']);
      break;
    case 'network.error':
      store.addNetworkError(data as MethodData['network.error']);
      break;
    case 'storage.snapshot':
      store.applyStorageSnapshot(data as MethodData['storage.snapshot']);
      break;
    case 'storage.change':
      store.applyStorageChange(data as MethodData['storage.change']);
      break;
    case 'page.error':
      store.addPageError(data as MethodData['page.error'], timestamp);
      break;
    case 'dom.rrweb': {
      const d = data as MethodData['dom.rrweb'];
      store.addRrwebEvent(d.event as import('./store').RrwebEventRaw);
      break;
    }
    case 'elements.picked': {
      const d = data as MethodData['elements.picked'];
      store.setSelectedNode(d.nodeId);
      store.setPickerActive?.(false);
      store.setPickerPending?.(false);
      break;
    }
    default:
      break;
  }
}

export function connect(): void {
  if (_destroyed) return;
  const store = useStore.getState();
  store.setConnStatus('connecting');

  const generation = ++_connectionGeneration;
  const ws = new WebSocket(getWsUrl());
  _ws = ws;

  ws.onopen = () => {
    if (generation !== _connectionGeneration) return; // Stale connection
    _reconnectDelay = RECONNECT_BASE_MS;
    useStore.getState().setConnStatus('connected');
  };

  ws.onmessage = (evt) => {
    if (typeof evt.data === 'string') handleFrame(evt.data, generation);
  };

  ws.onclose = () => {
    if (generation !== _connectionGeneration) return; // Stale connection
    _ws = null;
    useStore.getState().setConnStatus('disconnected');
    if (!_destroyed) {
      setTimeout(() => connect(), _reconnectDelay);
      _reconnectDelay = Math.min(_reconnectDelay * 2, RECONNECT_MAX_MS);
    }
  };

  ws.onerror = () => {
    ws.close();
  };
}

export function disconnect(): void {
  _destroyed = true;
  _ws?.close();
}

/** 重新连接（用于切换 session 时） */
export function reconnect(): void {
  _destroyed = false;
  _connectionGeneration++; // Invalidate old connection
  _ws?.close();
  // 清空 pending
  for (const { timer } of _pending.values()) {
    clearTimeout(timer);
  }
  _pending.clear();
  // 重置 store
  const store = useStore.getState();
  store.reset?.();
  connect();
}

/** Switch target session (centralized session switching) */
export function switchTargetSession(session: SessionId | null): void {
  const prevSession = _currentSession;

  // Use value comparison, not object reference
  if (sameSession(prevSession, session)) {
    return; // No change
  }

  _currentSession = session;

  // Clear pending commands
  for (const { timer } of _pending.values()) {
    clearTimeout(timer);
  }
  _pending.clear();

  // Reset store when switching
  const store = useStore.getState();
  store.reset();

  // If switching sessions (not just clearing), reconnect
  if (session !== null) {
    _destroyed = false;
    _connectionGeneration++; // Invalidate old connection
    _ws?.close();
    connect();
  } else {
    // Navigating to dashboard - disconnect
    _destroyed = true;
    _connectionGeneration++; // Invalidate old connection
    _ws?.close();
  }
}

let _idCounter = 0;
function nextId(): string {
  return `dbg-${Date.now()}-${++_idCounter}`;
}

export function sendCommand<M extends CommandMethod>(
  method: M,
  data: MethodData[M],
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    const id = nextId();
    const envelope = makeEnvelope(method, data, 'debugger', id);
    // 携带 target session（如果是 Session 调试模式）
    if (_currentSession) {
      envelope.target = _currentSession;
    }
    const frame = encodeFrame({ kind: 'msg', envelope });

    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error(`Command ${method} timed out`));
    }, CMD_TIMEOUT_MS);

    _pending.set(id, { resolve, timer });
    _ws.send(frame);
  });
}

export async function sendEval(code: string): Promise<SpyAtom | null> {
  try {
    const reply = await sendCommand('eval.run', { code });
    if (reply.error) return null;
    const result = reply.result as { result: SpyAtom };
    return result?.result ?? null;
  } catch {
    return null;
  }
}

export async function deleteElement(nodeId: number): Promise<Reply> {
  return sendCommand('elements.deleteNode', { nodeId });
}
