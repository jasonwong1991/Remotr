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
} from '@remotr/shared';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export interface NetworkRecord {
  reqId: string;
  request?: NetworkRequestEvent;
  response?: NetworkResponseEvent;
  error?: NetworkErrorEvent;
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
  storage: StorageState;
  rrwebEvents: RrwebEventRaw[];
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

function storageKey(type: StorageType): keyof StorageState {
  if (type === 'local') return 'local';
  if (type === 'session') return 'session';
  return 'cookie';
}

export const useStore = create<DebuggerState>((set) => ({
  connStatus: 'connecting',
  systemInfo: null,
  consoleRecords: [],
  traceHits: [],
  tracepoints: [],
  networkMap: new Map(),
  storage: { local: {}, session: {}, cookie: {} },
  rrwebEvents: [],
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
      consoleRecords: [
        ...s.consoleRecords,
        { id: nextId(), type: 'console', level: entry.level, entry, timestamp: ts },
      ],
    })),

  addPageError: (pageError, ts) =>
    set((s) => ({
      consoleRecords: [
        ...s.consoleRecords,
        { id: nextId(), type: 'page-error', level: 'error', pageError, timestamp: ts },
      ],
    })),

  addEvalResult: (code, atom, ts) =>
    set((s) => ({
      consoleRecords: [
        ...s.consoleRecords,
        { id: nextId(), type: 'eval-result', level: 'log', evalResult: { code, atom }, timestamp: ts },
      ],
    })),
  clearConsole: () => set({ consoleRecords: [] }),

  addTraceHit: (hit, ts) =>
    set((s) => {
      // 高频调用可能海量涌入,封顶 500 条,超出丢弃最旧的(与 network backlog 同策略)
      const next = [
        ...s.traceHits,
        { id: nextId(), hit, timestamp: ts },
      ];
      if (next.length > 500) next.splice(0, next.length - 500);
      return { traceHits: next };
    }),
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
      return { networkMap: map };
    }),

  addNetworkResponse: (res) =>
    set((s) => {
   const map = new Map(s.networkMap);
      const existing = map.get(res.reqId) ?? { reqId: res.reqId };
      map.set(res.reqId, { ...existing, response: res });
      return { networkMap: map };
    }),

  addNetworkError: (err) =>
    set((s) => {
      const map = new Map(s.networkMap);
      const existing = map.get(err.reqId) ?? { reqId: err.reqId };
      map.set(err.reqId, { ...existing, error: err });
      return { networkMap: map };
  }),

  clearNetwork: () => set({ networkMap: new Map() }),

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
    set((s) => ({ rrwebEvents: [...s.rrwebEvents, event] })),

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
      storage: { local: {}, session: {}, cookie: {} },
      rrwebEvents: [],
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
      storage: { local: {}, session: {}, cookie: {} },
      rrwebEvents: [],
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
