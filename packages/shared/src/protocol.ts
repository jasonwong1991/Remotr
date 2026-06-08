import type { SpyAtom } from './atom.js';
import type { BoxModel, ComputedStyles, CSSRule } from './elements-types.js';

/** 连接角色 */
export type Role = 'sdk' | 'debugger';

/** Session 标识（设备 + 页面） */
export interface SessionId {
  deviceId: string;
  pageId: string;
}

/** Session 元数据 */
export interface SessionMetadata {
  session: SessionId;
  /** 可选身份标识，例如从 cookie 读取的 username / userId */
  identity?: string;
  /** 设备展示信息 */
  device?: {
    label?: string;
    ua?: string;
    platform?: string;
  };
  /** 页面展示信息 */
  page?: {
    url: string;
    title: string;
  };
}

/**
 * 消息信封 — 所有 WebSocket 消息共用的统一结构。
 * - id 为 null：单向事件（无需响应）
 * - id 为字符串：命令（接收方需回复同 id 的 Reply）
 */
export interface Envelope<M extends MethodName = MethodName> {
  id: string | null;
  method: M;
  data: MethodData[M];
  timestamp: number;
  source: Role;
  /** SDK → Server/Debugger 消息携带来源 session 信息 */
  metadata?: SessionMetadata;
  /** Debugger → SDK 命令携带目标 session */
  target?: SessionId;
}

/** 命令回复信封 */
export interface Reply {
  /** 对应命令的 id */
  replyTo: string;
  result?: unknown;
  error?: string | null;
}

// ─────────────────────────────────────────────────────────
// 事件方法（SDK → 调试端）
// ─────────────────────────────────────────────────────────

export type ConsoleLevel =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'table'
  | 'dir';

export interface ConsoleEvent {
  level: ConsoleLevel;
  args: SpyAtom[];
  /** error 级别携带调用栈 */
  stack?: string;
}

export interface NetworkRequestEvent {
  reqId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** 发起方：fetch / xhr / beacon / websocket / resource (CSS/JS/img/font/media etc.) */
  initiator: 'fetch' | 'xhr' | 'beacon' | 'websocket' | 'link' | 'script' | 'img' | 'css' | 'xmlhttprequest' | 'fetch' | 'other';
  /** Resource timing details (for resource initiator types) */
  timing?: {
    startTime: number;
    fetchStart: number;
    domainLookupStart: number;
    domainLookupEnd: number;
    connectStart: number;
    connectEnd: number;
    requestStart: number;
    responseStart: number;
    responseEnd: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  };
}

export interface NetworkResponseEvent {
  reqId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  /** 响应体 MIME 类型 */
  mimeType?: string;
  /** 耗时（毫秒） */
  duration: number;
  /** 是否来自缓存 */
  fromCache?: boolean;
  /** 是否 CORS 阻止（transferSize=0 且 responseStart=0） */
  corsBlocked?: boolean;
}

export interface NetworkErrorEvent {
  reqId: string;
  error: string;
  duration: number;
  /** 错误类型：network / cors / timeout / abort */
  errorType?: 'network' | 'cors' | 'timeout' | 'abort' | 'unknown';
}

export type StorageType = 'local' | 'session' | 'cookie';

export interface StorageSnapshotEvent {
  storageType: StorageType;
  entries: Array<[string, string]>;
}

export interface StorageChangeEvent {
  storageType: StorageType;
  action: 'set' | 'remove' | 'clear';
  key?: string;
  value?: string;
}

export interface SystemInfoEvent {
  ua: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  framework?: string;
  sdkVersion: string;
}

export interface PageErrorEvent {
  message: string;
  stack?: string;
  url?: string;
  line?: number;
  col?: number;
  /** true 表示来自 unhandledrejection */
  isPromiseRejection?: boolean;
}

/** rrweb 录制事件（透传，data 即 rrweb eventWithTime） */
export interface DomRrwebEvent {
  event: unknown;
  isCheckout?: boolean;
}

// ─────────────────────────────────────────────────────────
// Dashboard 事件
// ─────────────────────────────────────────────────────────

/** Session 快照（供 Dashboard 展示） */
export interface SessionSnapshot {
  session: SessionId;
  identity?: string;
  /** 是否在线（SDK 还连着） */
  connected: boolean;
  /** 最近一次活动时间戳 */
  lastActive: number;
  /** 首次连接时间戳 */
  connectedAt: number;
  /** 设备/页面信息（来自 system.info 或 SessionMetadata） */
  systemInfo?: SystemInfoEvent;
}

/** Dashboard 全量 session 列表事件（Server → Debugger） */
export interface DashboardSessionsEvent {
  room: string;
  sessions: SessionSnapshot[];
}

// ─────────────────────────────────────────────────────────
// 命令方法（调试端 → SDK）及其结果
// ─────────────────────────────────────────────────────────

export interface EvalRunCmd {
  code: string;
}
export interface EvalRunResult {
  result: SpyAtom;
}

export interface StorageGetAllCmd {
  storageType: StorageType;
}
export interface StorageSetCmd {
  storageType: StorageType;
  key: string;
  value: string;
}
export interface StorageDeleteCmd {
  storageType: StorageType;
  key: string;
}
export interface StorageClearCmd {
  storageType: StorageType;
}

export interface PageReloadCmd {
  /** 强制绕过缓存 */
  hard?: boolean;
}

export interface ElementsGetComputedStylesCmd {
  nodeId: number;
  /** 要获取的 CSS 属性列表，未指定则返回所有计算样式 */
  properties?: string[];
}
export interface ElementsGetComputedStylesResult {
  styles: ComputedStyles;
}

export interface ElementsGetBoxModelCmd {
  nodeId: number;
}
export interface ElementsGetBoxModelResult {
  boxModel: BoxModel;
}

export interface ElementsGetMatchedRulesCmd {
  nodeId: number;
  /**
   * Pseudo-classes to treat as force-enabled (e.g. [":hover", ":focus"]). Rules
   * that match the element once these pseudo-classes are stripped from their
   * selector are returned too, tagged with `forState`.
   */
  forcedStates?: string[];
}
export interface ElementsGetMatchedRulesResult {
  inlineStyles: Record<string, string>;
  rules: CSSRule[];
}

export interface ElementsHighlightCmd {
  /** null 表示清除高亮 */
  nodeId: number | null;
}
export interface ElementsStartPickerCmd {}
export interface ElementsStopPickerCmd {}
export interface ElementsSetStyleCmd {
  nodeId: number;
  property: string;
  value: string;
}

export interface ElementsPickedEvent {
  nodeId: number;
}

export interface ElementsDeleteNodeCmd {
  nodeId: number;
}

export interface ElementsSetHTMLCmd {
  nodeId: number;
  /** 新的 outerHTML 字符串，用于替换目标元素 */
  outerHTML: string;
}

export interface ElementsScrollIntoViewCmd {
  nodeId: number;
}

export interface ElementsSetForcedStatesCmd {
  nodeId: number;
  /**
   * Full set of forced pseudo-classes for this node (e.g. [":hover", ":focus"]).
   * The SDK applies these to the real element so the forced state renders in the
   * mirror. An empty array clears all forced states for the node.
   */
  states: string[];
}

// ─────────────────────────────────────────────────────────
// 方法名 → 数据类型 映射表（单一事实来源，DRY）
// ─────────────────────────────────────────────────────────

export interface MethodData {
  // 事件 (SDK → debugger)
  'console.entry': ConsoleEvent;
  'network.request': NetworkRequestEvent;
  'network.response': NetworkResponseEvent;
  'network.error': NetworkErrorEvent;
  'storage.snapshot': StorageSnapshotEvent;
  'storage.change': StorageChangeEvent;
  'system.info': SystemInfoEvent;
  'page.error': PageErrorEvent;
  'dom.rrweb': DomRrwebEvent;
  // Dashboard 事件 (Server → debugger)
  'dashboard.sessions': DashboardSessionsEvent;
  // 命令 (debugger → SDK)
  'eval.run': EvalRunCmd;
  'storage.getAll': StorageGetAllCmd;
  'storage.set': StorageSetCmd;
  'storage.delete': StorageDeleteCmd;
  'storage.clear': StorageClearCmd;
  'page.reload': PageReloadCmd;
  'elements.getComputedStyles': ElementsGetComputedStylesCmd;
  'elements.getBoxModel': ElementsGetBoxModelCmd;
  'elements.getMatchedRules': ElementsGetMatchedRulesCmd;
  'elements.highlight': ElementsHighlightCmd;
  'elements.startPicker': ElementsStartPickerCmd;
  'elements.stopPicker': ElementsStopPickerCmd;
  'elements.setStyle': ElementsSetStyleCmd;
  'elements.deleteNode': ElementsDeleteNodeCmd;
  'elements.setHTML': ElementsSetHTMLCmd;
  'elements.scrollIntoView': ElementsScrollIntoViewCmd;
  'elements.setForcedStates': ElementsSetForcedStatesCmd;
  'elements.picked': ElementsPickedEvent;
}

export type MethodName = keyof MethodData;

/** SDK → 调试端的事件方法名 */
export type EventMethod =
  | 'console.entry'
  | 'network.request'
  | 'network.response'
  | 'network.error'
  | 'storage.snapshot'
  | 'storage.change'
  | 'system.info'
  | 'page.error'
  | 'dom.rrweb'
  | 'elements.picked';

/** 调试端 → SDK 的命令方法名 */
export type CommandMethod =
  | 'eval.run'
  | 'storage.getAll'
  | 'storage.set'
  | 'storage.delete'
  | 'storage.clear'
  | 'page.reload'
  | 'elements.getComputedStyles'
  | 'elements.getBoxModel'
  | 'elements.getMatchedRules'
  | 'elements.highlight'
  | 'elements.startPicker'
  | 'elements.stopPicker'
  | 'elements.setStyle'
  | 'elements.deleteNode'
  | 'elements.setHTML'
  | 'elements.scrollIntoView'
  | 'elements.setForcedStates';
