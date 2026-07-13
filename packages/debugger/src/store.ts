import { create } from 'zustand';
import type {
  SystemInfoEvent,
  ConsoleEvent,
  NetworkRequestEvent,
  NetworkResponseEvent,
  NetworkErrorEvent,
  StorageSnapshotEvent,
  StorageChangeEvent,
  PageErrorEvent,
  StorageType,
  BoxModel,
  ComputedStyles,
  MatchedRule,
  TraceHitEvent,
  TracepointDef,
  WsOpenEvent,
  WsFrameEvent,
  WsCloseEvent,
  WsErrorEvent,
  SseOpenEvent,
  SseMessageEvent,
  SseErrorEvent,
  SseCloseEvent,
  PerfVitalEvent,
  PerfLongtaskEvent,
  PerfMemoryEvent,
  PerfFpsEvent,
  WebVitalName,
} from '@remotr/shared';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export interface NetworkRecord {
  reqId: string;
  request?: NetworkRequestEvent;
  response?: NetworkResponseEvent;
  error?: NetworkErrorEvent;
}

/** WS/SSE 帧日志中的一条（send/recv 统一结构；SSE 消息带 event 名） */
export interface WsFrameRecord {
  direction: 'send' | 'recv';
  data: string;
  size: number;
  truncated?: boolean;
  binary?: boolean;
  /** SSE 事件类型（默认 "message"）；WS 帧为空 */
  event?: string;
  timestamp: number;
}

/** 一条 WebSocket / EventSource 连接及其帧日志 */
export interface WsConnectionRecord {
  connectionId: string;
  kind: 'ws' | 'sse';
  url: string;
  protocols?: string[];
  timestamp: number;
  status: 'open' | 'closed' | 'error';
  closeCode?: number;
  closeReason?: string;
  frames: WsFrameRecord[];
}

export interface ConsoleRecord {
  id: string;
  type: 'console' | 'page-error' | 'eval-result';
  level: string;
  entry?: ConsoleEvent;
  pageError?: PageErrorEvent;
  evalResult?: { code: string; atom: import('@remotr/shared').SpyAtom };
  timestamp: number;
}

/** 一次函数追踪点命中(来自 SDK 的 trace.hit 事件 + 面板本地时间戳/自增 id) */
export interface TraceHitRecord {
  id: string;
  hit: TraceHitEvent;
  timestamp: number;
}

export type StorageData = Record<string, string>;

/** 最新的 Web Vitals(按指标名保留最后一次采样) */
export type PerfVitals = Partial<Record<WebVitalName, PerfVitalEvent>>;

/** 一条长任务记录(SDK perf.longtask + 面板自增 seq 作 React key) */
export interface PerfLongtaskRecord {
  seq: number;
  startTime: number;
  duration: number;
}

export interface StorageState {
  local: StorageData;
  session: StorageData;
  cookie: StorageData;
}

import type { eventWithTime } from 'rrweb';
import type { RrwebNode } from './components/elements/domTree';
// rrweb event
export type RrwebEventRaw = eventWithTime;

export interface SelectedElementData {
  computedStyles: ComputedStyles | null;
  boxModel: BoxModel | null;
  matchedRules: MatchedRule[] | null;
}

/** Sources 面板的跳转目标 */
export interface SourceViewTarget {
  /** 可取的脚本 URL（SourcesPanel 据此 fetch 内容与 map） */
  scriptUrl: string;
  /** 该脚本 map 内的原始源路径；设置时展示还原后的原始源码 */
  source?: string;
  /** 高亮并滚动到的行号（1-based） */
  line?: number;
}

interface DebuggerState {
  connStatus: ConnStatus;
  systemInfo: SystemInfoEvent | null;
  consoleRecords: ConsoleRecord[];
  traceHits: TraceHitRecord[];
  /** 当前活跃的追踪点(乐观维护:set 成功即加入,remove 即删除) */
  tracepoints: TracepointDef[];
  networkMap: Map<string, NetworkRecord>;
  /** WS/SSE 长连接（connectionId → 连接 + 帧日志），封顶淘汰最旧 */
  wsConnections: Map<string, WsConnectionRecord>;
  /** 最新 Web Vitals(按指标名) */
  perfVitals: PerfVitals;
  /** 长任务记录,封顶淘汰最旧 */
  perfLongtasks: PerfLongtaskRecord[];
  /** JS 堆采样时间线,封顶淘汰最旧 */
  perfMemory: PerfMemoryEvent[];
  /** FPS 采样时间线,封顶淘汰最旧 */
  perfFps: PerfFpsEvent[];
  storage: StorageState;
  rrwebEvents: RrwebEventRaw[];
  /**
   * 累计从 rrwebEvents 头部裁剪掉的事件数(裁剪发生在快照边界/硬上限)。
   * PageMirror 用它把"逻辑序号游标"换算成当前数组下标,使裁剪不破坏增量喂入。
   */
  rrwebDropped: number;
  /** Live Elements tree, rebuilt from the rrweb mirror by PageMirror. */
  domTree: RrwebNode | null;
  selectedNodeId: number | null;
  selectedElementData: SelectedElementData | null;
  hoveredNodeId: number | null;
  pickerActive: boolean;
  pickerPending: boolean;
  pickerError: string | null;
  /** Sources 面板跳转目标（由 Console 还原后点击触发） */
  sourceView: SourceViewTarget | null;

  // Actions
  setConnStatus: (s: ConnStatus) => void;
  setSystemInfo: (info: SystemInfoEvent) => void;
  addConsoleEntry: (entry: ConsoleEvent, ts: number) => void;
  addPageError: (err: PageErrorEvent, ts: number) => void;
  addEvalResult: (code: string, atom: import('@remotr/shared').SpyAtom, ts: number) => void;
  clearConsole: () => void;
  addTraceHit: (hit: TraceHitEvent, ts: number) => void;
  clearTrace: () => void;
  addTracepoint: (tp: TracepointDef) => void;
  removeTracepoint: (id: string) => void;
  addNetworkRequest: (req: NetworkRequestEvent) => void;
  addNetworkResponse: (res: NetworkResponseEvent) => void;
  addNetworkError: (err: NetworkErrorEvent) => void;
  clearNetwork: () => void;
  addWsOpen: (ev: WsOpenEvent) => void;
  addWsFrame: (direction: 'send' | 'recv', ev: WsFrameEvent) => void;
  addWsClose: (ev: WsCloseEvent) => void;
  addWsError: (ev: WsErrorEvent) => void;
  addSseOpen: (ev: SseOpenEvent) => void;
  addSseMessage: (ev: SseMessageEvent) => void;
  addSseError: (ev: SseErrorEvent) => void;
  addSseClose: (ev: SseCloseEvent) => void;
  clearWs: () => void;
  addPerfVital: (ev: PerfVitalEvent) => void;
  addPerfLongtask: (ev: PerfLongtaskEvent) => void;
  addPerfMemory: (ev: PerfMemoryEvent) => void;
  addPerfFps: (ev: PerfFpsEvent) => void;
  clearPerf: () => void;
  applyStorageSnapshot: (snap: StorageSnapshotEvent) => void;
  applyStorageChange: (change: StorageChangeEvent) => void;
  addRrwebEvent: (event: RrwebEventRaw) => void;
  setDomTree: (tree: RrwebNode | null) => void;
  setSelectedNode: (id: number | null) => void;
  setElementData: (data: Partial<SelectedElementData>) => void;
  clearElementData: () => void;
  setHoveredNode: (id: number | null) => void;
  setPickerActive: (active: boolean) => void;
  setPickerPending: (pending: boolean) => void;
  setPickerError: (error: string | null) => void;
  requestSourceView: (target: SourceViewTarget) => void;
  clearSourceView: () => void;
  /** 重置整个 store（用于切换 session 时） */
  reset: () => void;
  /** 重置 session 运行时数据但保留连接状态（用于页面刷新时） */
  resetSessionDataPreserveConnection: () => void;
}

let _consoleIdCounter = 0;
function nextId(): string {
  return String(++_consoleIdCounter);
}

let _perfSeq = 0;

// 热路径事件流封顶,防止长会话下无限增长拖垮页面(与 traceHits/server backlog 同策略)
const MAX_CONSOLE_RECORDS = 2000;
const MAX_NETWORK_RECORDS = 1000;
// WS/SSE 长连接封顶：连接数 + 每连接帧数（高频推送场景防 OOM，超出丢最旧）
const MAX_WS_CONNECTIONS = 100;
const MAX_WS_FRAMES_PER_CONN = 500;
// Performance 采样时间线封顶(长任务/堆/FPS 各自独立)
const MAX_PERF_SAMPLES = 300;
// rrweb 只在快照段边界(Meta 事件,type 4)裁剪,绝不裁到段中间(会破坏重建基线)。
// SOFT 在段边界触发裁剪;HARD 是极端情况(长时间无 checkout)的兜底硬上限。
const MAX_RRWEB_EVENTS = 1500;
const MAX_RRWEB_EVENTS_HARD = 4000;
// rrweb Meta 事件类型:标志一个新的快照段起点(其后紧跟 FullSnapshot)。
const RRWEB_META_TYPE = 4;

/** 追加一条记录并封顶,超出丢弃最旧的 */
function appendCapped<T>(arr: T[], item: T, cap: number): T[] {
  const next = [...arr, item];
  if (next.length > cap) next.splice(0, next.length - cap);
  return next;
}

/** Map 封顶:按插入顺序淘汰最旧条目 */
function evictOldest<K, V>(map: Map<K, V>, cap: number): void {
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function storageKey(type: StorageType): keyof StorageState {
  if (type === 'local') return 'local';
  if (type === 'session') return 'session';
  return 'cookie';
}

/**
 * 向（已克隆的）连接表追加一帧：帧日志按 MAX_WS_FRAMES_PER_CONN 封顶。
 * open 事件晚到/丢失时创建占位连接，保证帧不静默丢弃。
 */
function appendWsFrame(
  map: Map<string, WsConnectionRecord>,
  connectionId: string,
  kind: 'ws' | 'sse',
  frame: WsFrameRecord,
): void {
  const existing = map.get(connectionId);
  if (!existing) {
    map.set(connectionId, {
      connectionId,
      kind,
      url: '(unknown)',
      timestamp: frame.timestamp,
      status: 'open',
      frames: [frame],
    });
    evictOldest(map, MAX_WS_CONNECTIONS);
    return;
  }
  map.set(connectionId, {
    ...existing,
    frames: appendCapped(existing.frames, frame, MAX_WS_FRAMES_PER_CONN),
  });
}

/** 更新（已克隆的）连接表中某连接的状态字段；连接不存在时忽略（open 已被淘汰） */
function patchWsConn(
  map: Map<string, WsConnectionRecord>,
  connectionId: string,
  patch: Partial<WsConnectionRecord>,
): void {
  const existing = map.get(connectionId);
  if (!existing) return;
  map.set(connectionId, { ...existing, ...patch });
}

export const useStore = create<DebuggerState>((set) => ({
  connStatus: 'connecting',
  systemInfo: null,
  consoleRecords: [],
  traceHits: [],
  tracepoints: [],
  networkMap: new Map(),
  wsConnections: new Map(),
  perfVitals: {},
  perfLongtasks: [],
  perfMemory: [],
  perfFps: [],
  storage: { local: {}, session: {}, cookie: {} },
  rrwebEvents: [],
  rrwebDropped: 0,
  domTree: null,
  selectedNodeId: null,
  selectedElementData: null,
  hoveredNodeId: null,
  pickerActive: false,
  pickerPending: false,
  pickerError: null,
  sourceView: null,

  setConnStatus: (connStatus) => set({ connStatus }),
  setSystemInfo: (systemInfo) => set({ systemInfo }),

  addConsoleEntry: (entry, ts) =>
    set((s) => ({
      consoleRecords: appendCapped(
        s.consoleRecords,
        { id: nextId(), type: 'console', level: entry.level, entry, timestamp: ts },
        MAX_CONSOLE_RECORDS,
      ),
    })),

  addPageError: (pageError, ts) =>
    set((s) => ({
      consoleRecords: appendCapped(
        s.consoleRecords,
        { id: nextId(), type: 'page-error', level: 'error', pageError, timestamp: ts },
        MAX_CONSOLE_RECORDS,
      ),
    })),

  addEvalResult: (code, atom, ts) =>
    set((s) => ({
      consoleRecords: appendCapped(
        s.consoleRecords,
        { id: nextId(), type: 'eval-result', level: 'log', evalResult: { code, atom }, timestamp: ts },
        MAX_CONSOLE_RECORDS,
      ),
    })),
  clearConsole: () => set({ consoleRecords: [] }),

  addTraceHit: (hit, ts) =>
    set((s) => ({
      // 高频调用可能海量涌入,封顶 500 条,超出丢弃最旧的(与 network backlog 同策略)
      traceHits: appendCapped(s.traceHits, { id: nextId(), hit, timestamp: ts }, 500),
    })),
  clearTrace: () => set({ traceHits: [] }),

  addTracepoint: (tp) =>
    set((s) => (s.tracepoints.some((t) => t.id === tp.id)
      ? s
      : { tracepoints: [...s.tracepoints, tp] })),
  removeTracepoint: (id) =>
    set((s) => ({ tracepoints: s.tracepoints.filter((t) => t.id !== id) })),

  addNetworkRequest: (req) =>
    set((s) => {
      const map = new Map(s.networkMap);
      const existing = map.get(req.reqId) ?? { reqId: req.reqId };
      map.set(req.reqId, { ...existing, request: req });
      evictOldest(map, MAX_NETWORK_RECORDS);
      return { networkMap: map };
    }),

  addNetworkResponse: (res) =>
    set((s) => {
      const map = new Map(s.networkMap);
      const existing = map.get(res.reqId) ?? { reqId: res.reqId };
      map.set(res.reqId, { ...existing, response: res });
      evictOldest(map, MAX_NETWORK_RECORDS);
      return { networkMap: map };
    }),

  addNetworkError: (err) =>
    set((s) => {
      const map = new Map(s.networkMap);
      const existing = map.get(err.reqId) ?? { reqId: err.reqId };
      map.set(err.reqId, { ...existing, error: err });
      evictOldest(map, MAX_NETWORK_RECORDS);
      return { networkMap: map };
    }),

  clearNetwork: () => set({ networkMap: new Map() }),

  addWsOpen: (ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      map.set(ev.connectionId, {
        connectionId: ev.connectionId,
        kind: 'ws',
        url: ev.url,
        protocols: ev.protocols,
        timestamp: ev.timestamp,
        status: 'open',
        frames: [],
      });
      evictOldest(map, MAX_WS_CONNECTIONS);
      return { wsConnections: map };
    }),

  addWsFrame: (direction, ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      appendWsFrame(map, ev.connectionId, 'ws', {
        direction,
        data: ev.data,
        size: ev.size,
        truncated: ev.truncated,
        binary: ev.binary,
        timestamp: ev.timestamp,
      });
      return { wsConnections: map };
    }),

  addWsClose: (ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      patchWsConn(map, ev.connectionId, {
        status: 'closed',
        closeCode: ev.code,
        closeReason: ev.reason,
      });
      return { wsConnections: map };
    }),

  addWsError: (ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      patchWsConn(map, ev.connectionId, { status: 'error' });
      return { wsConnections: map };
    }),

  addSseOpen: (ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      map.set(ev.connectionId, {
        connectionId: ev.connectionId,
        kind: 'sse',
        url: ev.url,
        timestamp: ev.timestamp,
        status: 'open',
        frames: [],
      });
      evictOldest(map, MAX_WS_CONNECTIONS);
      return { wsConnections: map };
    }),

  addSseMessage: (ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      appendWsFrame(map, ev.connectionId, 'sse', {
        direction: 'recv',
        data: ev.data,
        size: ev.size,
        truncated: ev.truncated,
        event: ev.event,
        timestamp: ev.timestamp,
      });
      return { wsConnections: map };
    }),

  addSseError: (ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      // EventSource 出错后会自动重连(readyState=CONNECTING)；只有 CLOSED(2) 视为终态错误
      patchWsConn(map, ev.connectionId, { status: ev.readyState === 2 ? 'error' : 'open' });
      return { wsConnections: map };
    }),

  addSseClose: (ev) =>
    set((s) => {
      const map = new Map(s.wsConnections);
      patchWsConn(map, ev.connectionId, { status: 'closed' });
      return { wsConnections: map };
    }),

  clearWs: () => set({ wsConnections: new Map() }),

  addPerfVital: (ev) =>
    set((s) => ({ perfVitals: { ...s.perfVitals, [ev.name]: ev } })),

  addPerfLongtask: (ev) =>
    set((s) => ({
      perfLongtasks: appendCapped(
        s.perfLongtasks,
        { seq: ++_perfSeq, startTime: ev.startTime, duration: ev.duration },
        MAX_PERF_SAMPLES,
      ),
    })),

  addPerfMemory: (ev) =>
    set((s) => ({ perfMemory: appendCapped(s.perfMemory, ev, MAX_PERF_SAMPLES) })),

  addPerfFps: (ev) =>
    set((s) => ({ perfFps: appendCapped(s.perfFps, ev, MAX_PERF_SAMPLES) })),

  clearPerf: () => set({ perfVitals: {}, perfLongtasks: [], perfMemory: [], perfFps: [] }),

  applyStorageSnapshot: (snap) =>
    set((s) => {
      const key = storageKey(snap.storageType);
    const data: StorageData = {};
      for (const [k, v] of snap.entries) data[k] = v;
      return { storage: { ...s.storage, [key]: data } };
    }),

  applyStorageChange: (change) =>
    set((s) => {
      const key = storageKey(change.storageType);
      const prev = { ...s.storage[key] };
      if (change.action === 'set' && change.key != null) {
        prev[change.key] = change.value ?? '';
      } else if (change.action === 'remove' && change.key != null) {
        delete prev[change.key];
      } else if (change.action === 'clear') {
        Object.keys(prev).forEach((k) => delete prev[k]);
      }
      return { storage: { ...s.storage, [key]: prev } };
    }),

  addRrwebEvent: (event) =>
    set((s) => {
      const type = (event as { type?: number }).type;
      let events = s.rrwebEvents;
      let dropped = s.rrwebDropped;

      // 只在快照段边界裁剪:收到 Meta(type 4)=新段起点时,若已超软上限,
      // 整段丢弃上一段历史——绝不裁到段中间(否则破坏重建基线)。镜像 room.ts 的 backlog 逻辑。
      if (type === RRWEB_META_TYPE && events.length >= MAX_RRWEB_EVENTS) {
        dropped += events.length;
        events = [];
      }

      events = [...events, event];

      // 兜底硬上限:长时间无 checkout 的极端场景防 OOM(可能裁到段中,下次 checkout 会重建)。
      if (events.length > MAX_RRWEB_EVENTS_HARD) {
        const cut = events.length - MAX_RRWEB_EVENTS_HARD;
        events = events.slice(cut);
        dropped += cut;
      }

      return { rrwebEvents: events, rrwebDropped: dropped };
    }),

  setDomTree: (domTree) => set({ domTree }),

  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),

  setElementData: (data) =>
    set((s) => ({
      selectedElementData: s.selectedElementData
        ? { ...s.selectedElementData, ...data }
        : { computedStyles: null, boxModel: null, matchedRules: null, ...data },
    })),

  clearElementData: () => set({ selectedElementData: null }),

  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),

  setPickerActive: (pickerActive) => set({ pickerActive }),
  setPickerPending: (pickerPending) => set({ pickerPending }),
  setPickerError: (pickerError) => set({ pickerError }),

  requestSourceView: (sourceView) => set({ sourceView }),
  clearSourceView: () => set({ sourceView: null }),

  reset: () =>
    set({
      connStatus: 'connecting',
      systemInfo: null,
      consoleRecords: [],
      traceHits: [],
      tracepoints: [],
      networkMap: new Map(),
      wsConnections: new Map(),
      perfVitals: {},
      perfLongtasks: [],
      perfMemory: [],
      perfFps: [],
      storage: { local: {}, session: {}, cookie: {} },
      rrwebEvents: [],
      rrwebDropped: 0,
      domTree: null,
      selectedNodeId: null,
      selectedElementData: null,
      hoveredNodeId: null,
      pickerActive: false,
      pickerPending: false,
      pickerError: null,
      sourceView: null,
    }),

  resetSessionDataPreserveConnection: () =>
    set(() => ({
      // Keep connStatus
      systemInfo: null,
      consoleRecords: [],
      traceHits: [],
      tracepoints: [],
      networkMap: new Map(),
      wsConnections: new Map(),
      perfVitals: {},
      perfLongtasks: [],
      perfMemory: [],
      perfFps: [],
      storage: { local: {}, session: {}, cookie: {} },
      rrwebEvents: [],
      rrwebDropped: 0,
      domTree: null,
      selectedNodeId: null,
      selectedElementData: null,
      hoveredNodeId: null,
      pickerActive: false,
      pickerPending: false,
      pickerError: null,
      sourceView: null,
    })),
}));
