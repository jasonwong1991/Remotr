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
  /**
   * 发起方分类：
   * - 'fetch' / 'xhr' / 'beacon' / 'websocket'：JS API 主动发起
   * - 'link' / 'script' / 'img' / 'css' / 'video' / 'audio' / 'iframe' / 'other'：
   *   PerformanceResourceTiming.initiatorType 上报的标签加载
   */
  initiator: string;
  /** Resource timing（来自 PerformanceResourceTiming） */
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
  /** 是否来自缓存（基于 transferSize=0 && responseStart>0 推断） */
  fromCache?: boolean;
}

export interface NetworkErrorEvent {
  reqId: string;
  error: string;
  duration: number;
  /** 错误类型：网络层 / CORS / 超时 / 主动 abort / 未知 */
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
// 回放录制（HTTP API: /api/rooms/:room/recordings）
// ─────────────────────────────────────────────────────────

/** 单个录制段的元信息 */
export interface RecordingSegmentInfo {
  /** 段文件名（如 "1718082000000.jsonl"），文件名即段起始时间戳 */
  file: string;
  /** 段起始时间戳（毫秒） */
  startTs: number;
  /** 段结束时间戳（毫秒，取文件最后写入时间） */
  endTs: number;
  /** 文件字节数 */
  bytes: number;
}

/** 某个 session 当天的全部录制段 */
export interface RecordingSessionInfo {
  session: SessionId;
  /** 磁盘目录名（用于拼接段下载 URL） */
  dir: string;
  identity?: string;
  /** 页面信息（取自录制时的 system.info） */
  url?: string;
  title?: string;
  /** UA（用于在回放列表解析展示真实设备名） */
  ua?: string;
  /** 录制段列表，按 startTs 升序 */
  segments: RecordingSegmentInfo[];
}

/** GET /api/rooms/:room/recordings 响应 */
export interface RecordingListResponse {
  room: string;
  /** 日期（YYYY-MM-DD，server 本地时区） */
  date: string;
  /** 录制功能是否开启 */
  enabled: boolean;
  sessions: RecordingSessionInfo[];
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
// Sources（源码查看 + Source Map 还原）
// ─────────────────────────────────────────────────────────

/** 页面加载的脚本资源 */
export interface ScriptInfo {
  url: string;
}

export interface SourcesListCmd {}
export interface SourcesListResult {
  scripts: ScriptInfo[];
}

export interface SourcesFetchCmd {
  url: string;
}
export interface SourcesFetchResult {
  url: string;
  content: string;
  /** 原始 //# sourceMappingURL 注释值（绝对化后的 url 或 data: URI） */
  sourceMappingURL?: string;
  /** SDK 代取/解析出的 source map JSON 字符串（外链与内联 base64 均归一为此） */
  map?: string;
  /** 取脚本失败时的原因；取到则为空 */
  error?: string;
  /** content/map 因超过体积上限被截断时为 true */
  truncated?: boolean;
}

// ─────────────────────────────────────────────────────────
// Trace(函数追踪点:命中时上报入参/返回值/调用栈,不暂停执行)
// ─────────────────────────────────────────────────────────

/**
 * 一个追踪点定义。SDK 按 `path`(点号分隔,如 "app.store.dispatch")从全局作用域
 * 解析出目标函数,用 Object.defineProperty 包装它,每次调用上报一条 trace.hit。
 */
export interface TracepointDef {
  /** 追踪点 ID(面板生成,用于取消) */
  id: string;
  /** 目标函数的点号路径,从 window 解析,如 "app.cart.calcTotal" */
  path: string;
  /**
   * 可选过滤条件表达式,在调用之后求值,可引用 `args`(参数数组)、`ret`(返回值)、
   * `self`(this)。返回真值才上报。留空则每次调用都上报。
   * 条件抛错时 fail-open(照常上报),避免"静默无输出"的调试困惑。
   */
  condition?: string;
}

export interface TraceSetCmd {
  tracepoint: TracepointDef;
}
export interface TraceSetResult {
  /** 是否成功解析并包装了目标函数 */
  ok: boolean;
  /** 失败原因(路径解析失败 / 目标非函数 / 不可配置) */
  error?: string;
}

export interface TraceRemoveCmd {
  id: string;
}
export interface TraceRemoveResult {
  ok: boolean;
}

/** 一次函数调用命中(SDK → 调试端) */
export interface TraceHitEvent {
  /** 对应的追踪点 ID */
  id: string;
  /** 目标函数路径(冗余携带,便于面板分组展示) */
  path: string;
  /** 第几次命中(该追踪点自设置以来的调用序号,从 1 开始) */
  seq: number;
  /** 入参列表 */
  args: SpyAtom[];
  /** 返回值;函数抛错时为 undefined,错误见 thrown */
  ret?: SpyAtom;
  /** 函数抛出的异常(序列化);正常返回时为空 */
  thrown?: SpyAtom;
  /** 调用栈文本(new Error().stack,去掉包装帧) */
  stack?: string;
  /** 同步执行耗时(毫秒) */
  durationMs: number;
}

// ─────────────────────────────────────────────────────────
// Framework(框架组件检查:React fiber / Vue 实例)
// ─────────────────────────────────────────────────────────

/** 检测到的前端框架 */
export type DetectedFramework = 'react' | 'vue3' | 'vue2';

/** 组件祖先链中的一项(从被选元素所属组件向根方向) */
export interface ComponentAncestor {
  /** 组件显示名;匿名组件为 "Anonymous" */
  name: string;
}

export interface FrameworkInspectCmd {
  /** rrweb 节点 ID(与 elements.* 命令一致,SDK 经 mirror 解析为真实元素) */
  nodeId: number;
}

export interface FrameworkInspectResult {
  /** 命中的框架;元素不属于任何已知框架组件时为 null */
  framework: DetectedFramework | null;
  /** 组件显示名 */
  componentName?: string;
  /** 组件 props(SpyAtom 序列化) */
  props?: SpyAtom;
  /**
   * 组件状态:
   * - React 函数组件:hooks 链上各 useState/useReducer 的 memoizedState 列表
   * - React 类组件:this.state
   * - Vue3:setupState(<script setup> / setup() 返回值)
   * - Vue2:$data
   */
  state?: SpyAtom;
  /** 组件祖先链(不含自身,靠近自身的在前),用于面包屑展示 */
  ancestors?: ComponentAncestor[];
  /** 元素不属于组件 / 解析失败时的说明 */
  error?: string;
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
  'trace.hit': TraceHitEvent;
  // Dashboard 事件 (Server → debugger)
  'dashboard.sessions': DashboardSessionsEvent;
  // 命令 (debugger → SDK)
  'eval.run': EvalRunCmd;
  'trace.set': TraceSetCmd;
  'trace.remove': TraceRemoveCmd;
  'framework.inspect': FrameworkInspectCmd;
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
  'sources.list': SourcesListCmd;
  'sources.fetch': SourcesFetchCmd;
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
  | 'trace.hit'
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
  | 'elements.setForcedStates'
  | 'sources.list'
  | 'sources.fetch'
  | 'trace.set'
  | 'trace.remove'
  | 'framework.inspect';

/**
 * 运行时已知方法名集合 —— 与上面的 MethodData / EventMethod / CommandMethod 对应,
 * 供服务端在转发前做方法名校验(类型在运行时不可用,故单独维护此常量)。
 * 新增协议方法时,请同步在此登记。
 */
export const KNOWN_METHODS: ReadonlySet<MethodName> = new Set<MethodName>([
  // 事件 (SDK → debugger)
  'console.entry',
  'network.request',
  'network.response',
  'network.error',
  'storage.snapshot',
  'storage.change',
  'system.info',
  'page.error',
  'dom.rrweb',
  'trace.hit',
  'elements.picked',
  // Dashboard 事件 (Server → debugger)
  'dashboard.sessions',
  // 命令 (debugger → SDK)
  'eval.run',
  'trace.set',
  'trace.remove',
  'framework.inspect',
  'storage.getAll',
  'storage.set',
  'storage.delete',
  'storage.clear',
  'page.reload',
  'elements.getComputedStyles',
  'elements.getBoxModel',
  'elements.getMatchedRules',
  'elements.highlight',
  'elements.startPicker',
  'elements.stopPicker',
  'elements.setStyle',
  'elements.deleteNode',
  'elements.setHTML',
  'elements.scrollIntoView',
  'elements.setForcedStates',
  'sources.list',
  'sources.fetch',
]);
