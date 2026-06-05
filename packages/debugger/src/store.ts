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

export type StorageData = Record<string, string>;

export interface StorageState {
  local: StorageData;
  session: StorageData;
  cookie: StorageData;
}

import type { eventWithTime } from 'rrweb';
// rrweb event
export type RrwebEventRaw = eventWithTime;

export interface SelectedElementData {
  computedStyles: ComputedStyles | null;
  boxModel: BoxModel | null;
  matchedRules: MatchedRule[] | null;
}

interface DebuggerState {
  connStatus: ConnStatus;
  systemInfo: SystemInfoEvent | null;
  consoleRecords: ConsoleRecord[];
  networkMap: Map<string, NetworkRecord>;
  storage: StorageState;
  rrwebEvents: RrwebEventRaw[];
  selectedNodeId: number | null;
  selectedElementData: SelectedElementData | null;
  hoveredNodeId: number | null;

  // Actions
  setConnStatus: (s: ConnStatus) => void;
  setSystemInfo: (info: SystemInfoEvent) => void;
  addConsoleEntry: (entry: ConsoleEvent, ts: number) => void;
  addPageError: (err: PageErrorEvent, ts: number) => void;
  addEvalResult: (code: string, atom: import('@remotr/shared').SpyAtom, ts: number) => void;
  clearConsole: () => void;
  addNetworkRequest: (req: NetworkRequestEvent) => void;
  addNetworkResponse: (res: NetworkResponseEvent) => void;
  addNetworkError: (err: NetworkErrorEvent) => void;
  clearNetwork: () => void;
  applyStorageSnapshot: (snap: StorageSnapshotEvent) => void;
  applyStorageChange: (change: StorageChangeEvent) => void;
  addRrwebEvent: (event: RrwebEventRaw) => void;
  setSelectedNode: (id: number | null) => void;
  setElementData: (data: Partial<SelectedElementData>) => void;
  clearElementData: () => void;
  setHoveredNode: (id: number | null) => void;
  /** 重置整个 store（用于切换 session 时） */
  reset: () => void;
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
  networkMap: new Map(),
  storage: { local: {}, session: {}, cookie: {} },
  rrwebEvents: [],
  selectedNodeId: null,
  selectedElementData: null,
  hoveredNodeId: null,

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

  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),

  setElementData: (data) =>
    set((s) => ({
      selectedElementData: s.selectedElementData
        ? { ...s.selectedElementData, ...data }
        : { computedStyles: null, boxModel: null, matchedRules: null, ...data },
    })),

  clearElementData: () => set({ selectedElementData: null }),

  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),

  reset: () =>
    set({
      connStatus: 'connecting',
      systemInfo: null,
      consoleRecords: [],
      networkMap: new Map(),
      storage: { local: {}, session: {}, cookie: {} },
      rrwebEvents: [],
      selectedNodeId: null,
      selectedElementData: null,
      hoveredNodeId: null,
    }),
}));
