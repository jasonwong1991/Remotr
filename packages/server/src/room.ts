import type { WebSocket } from 'ws';
import type {
  Frame,
  SessionId,
  SessionSnapshot,
  SystemInfoEvent,
  DashboardSessionsEvent,
} from '@remotr/shared';
import { decodeFrame, encodeFrame, makeEnvelope } from '@remotr/shared';
import type { RecordingManager, SessionMeta } from './recording.js';

/** SDK 端连接的 session 信息 */
interface SessionParams {
  deviceId: string;
  pageId: string;
  identity?: string;
  /** 本次页面加载标识（SDK 随连接参数上报）；刷新变、断线重连不变 */
  loadId?: string;
}

/** backlog 里的一条 rrweb 帧：原始 JSON 行 + 事件时间戳（录制基线做时间重定位用，免再解析） */
interface RrwebBacklogEntry {
  raw: string;
  ts: number | undefined;
}

/**
 * 每个 session 的 backlog 状态。
 * 全部存**原始 JSON 字符串**而非解析后的对象：回放/录制时零拷贝直接发，
 * 且字符串比对象树省 3~5 倍堆内存（pm2 512MB 重启会清空所有房间，内存就是容量）。
 */
interface SessionBacklog {
  lastSystemInfo: string | null;
  rrwebBacklog: RrwebBacklogEntry[];
  eventBacklog: string[];
  /** 产生当前 eventBacklog 的页面加载标识；换了就说明页面刷新过 */
  loadId?: string;
}

/**
 * 瞬时采样类事件：只对"正在看"的面板有意义，不进 backlog（新接入的面板 1~2s 内就会
 * 收到新样本），也不计入录制轮转阈值——否则空闲页面的 FPS/内存流水会把 500 条
 * backlog 里真正有用的 console/network 全部挤掉。
 */
const TRANSIENT_METHODS: ReadonlySet<string> = new Set(['perf.fps', 'perf.memory']);

/** SDK 成员 */
interface SdkMember {
  ws: WebSocket;
  role: 'sdk';
  session: SessionParams;
  systemInfo: SystemInfoEvent | null;
  connectedAt: number;
  lastActive: number;
}

/** Debugger 成员 */
interface DebuggerMember {
  ws: WebSocket;
  role: 'debugger';
  /** null = Dashboard 模式（接收所有 session 概览）；非 null = 调试特定 session */
  targetSession: SessionId | null;
}

export type Member = SdkMember | DebuggerMember;

/** 生成 session 唯一 key */
function sessionKey(s: SessionId): string {
  return `${s.deviceId}:${s.pageId}`;
}

function sameSession(a: SessionId | null | undefined, b: SessionId | null | undefined): boolean {
  if (!a || !b) return false;
  return a.deviceId === b.deviceId && a.pageId === b.pageId;
}

/** debugger 侧 ws 发送缓冲上限：超过则丢弃转发，防止慢消费者把大帧堆在 server 堆内存里 OOM */
const MAX_WS_BUFFERED = 12 * 1024 * 1024;

/** 带背压保护的发送：连接非 OPEN 或缓冲超限时丢弃（返回 false）。 */
function safeSend(ws: WebSocket, data: string): boolean {
  if (ws.readyState !== ws.OPEN) return false;
  if (ws.bufferedAmount > MAX_WS_BUFFERED) return false;
  ws.send(data);
  return true;
}

/** pendingReplies 条目最大存活时间：SDK 一直不回复的命令按超时回错并清除 */
const PENDING_REPLY_TTL = 60 * 1000;

/**
 * Room — 一个调试会话单元。
 * 支持多 session（多设备/多页面）的隔离路由。
 *
 * 路由规则：
 *  - SDK 消息 → 只发给订阅该 session 的 Debugger
 *  - Dashboard Debugger → 接收 session 概览
 *  - Debugger 命令 → 通过 envelope.target 定向到指定 SDK
 *  - Reply → 回到发起命令的 Debugger
 */
export class Room {
  readonly id: string;

  /** key: sessionKey → SDK 成员 */
  private sdks = new Map<string, SdkMember>();
  /** Debugger 成员集合 */
  private debuggers = new Set<DebuggerMember>();
  /** key: sessionKey → backlog */
  private backlogs = new Map<string, SessionBacklog>();
  /** 离线 session 信息（保留以便 Dashboard 展示） */
  private offlineSessions = new Map<string, SessionSnapshot>();
  /** Pending commands: commandId → Debugger + target session（reply 路由）+ 存储时间（TTL 清理用） */
  private pendingReplies = new Map<
    string,
    { debugger: DebuggerMember; targetSession: SessionId; at: number }
  >();

  private readonly maxBacklog: number;
  private readonly maxRrwebBacklog: number;
  private readonly offlineSessionTTL: number; // milliseconds
  private readonly maxOfflineSessions: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly recorder: RecordingManager | null;
  /** 房间完全空（无成员且无 session 记录）时回调，供注册表删除该房间（M4：防泄漏） */
  onEmpty: (() => void) | null = null;

  constructor(
    id: string,
    maxBacklog = 500,
    maxRrwebBacklog = 1000,
    offlineSessionTTL = 10 * 60 * 1000, // 10 minutes
    maxOfflineSessions = 100,
    recorder: RecordingManager | null = null
  ) {
    this.id = id;
    this.maxBacklog = maxBacklog;
    this.maxRrwebBacklog = maxRrwebBacklog;
    this.offlineSessionTTL = offlineSessionTTL;
    this.maxOfflineSessions = maxOfflineSessions;
    this.recorder = recorder;

    // Start periodic cleanup (every 2 minutes). unref() so the timer doesn't
    // keep the Node process alive on shutdown.
    this.cleanupTimer = setInterval(() => this.cleanupOfflineSessions(), 2 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  get size(): number {
    return this.sdks.size + this.debuggers.size;
  }

  hasSdk(): boolean {
    return this.sdks.size > 0;
  }

  /** 在线 session 数（当前连着的 SDK） */
  onlineCount(): number {
    return this.sdks.size;
  }

  debuggerCount(): number {
    return this.debuggers.size;
  }

  /** 添加 SDK 成员 */
  addSdk(ws: WebSocket, session: SessionParams): SdkMember {
    const now = Date.now();
    const member: SdkMember = {
      ws,
      role: 'sdk',
      session,
      systemInfo: null,
      connectedAt: now,
      lastActive: now,
    };
    const key = sessionKey(session);
    // 重连接管：同一 session 的旧连接被取代时先关闭其 socket。
    // remove() 里的身份守卫保证旧 socket 迟到的 close 不会误删这个新成员。
    const old = this.sdks.get(key);
    if (old && old !== member) {
      try {
        old.ws.close(1000, 'Superseded by reconnect');
      } catch {
        /* 已断开等，忽略 */
      }
    }
    this.sdks.set(key, member);
    // 清除离线记录
    this.offlineSessions.delete(key);
    // 页面刷新（loadId 变化）= 新起点：清掉上一次加载的事件 backlog，否则旧报错会一直
    // 排在 MCP remotr_get_errors 的前面，AI 在新会话里会去"修"早已修好的问题。
    // rrweb backlog 由新加载的 Meta 事件自行重置；断线重连 loadId 不变，什么都不清。
    // 在这里（连接建立时）而不是收到 system.info 时清：boot 期错误经离线队列先于
    // system.info 到达，若等 system.info 再清会把新加载的首批帧一起抹掉。
    if (session.loadId) {
      const backlog = this.backlogs.get(key);
      if (backlog && backlog.loadId !== session.loadId) {
        backlog.eventBacklog = [];
        backlog.lastSystemInfo = null;
      }
      if (backlog) backlog.loadId = session.loadId;
      else this.backlogs.set(key, { lastSystemInfo: null, rrwebBacklog: [], eventBacklog: [], loadId: session.loadId });
    }
    // 通知正在调试该 session 的 Debugger：目标已上线（带 loadId，面板据此判断是否刷新过）
    this.notifySessionStatus(session, true);
    // 告知（可能是重连的）SDK 当前有几个面板在看，决定是否开高频采样
    this.notifyWatchers(session);
    return member;
  }

  /** 添加 Debugger 成员（Dashboard 或 Session 模式） */
  addDebugger(ws: WebSocket, targetSession: SessionId | null): DebuggerMember {
    const member: DebuggerMember = { ws, role: 'debugger', targetSession };
    this.debuggers.add(member);
    if (targetSession) this.notifyWatchers(targetSession);
    return member;
  }

  /** 移除成员 */
  remove(member: Member): void {
    if (member.role === 'sdk') {
      const key = sessionKey(member.session);

      // 身份守卫：仅当 map 里仍是这个 member 时才拆除（M1）。
      // 重连场景下新成员已 set 到同一 key，旧 socket 迟到的 close 不得误删/误标离线新成员。
      if (this.sdks.get(key) !== member) {
        return;
      }
      this.sdks.delete(key);

      // Clean up pending replies for this SDK session
      for (const [commandId, pending] of this.pendingReplies) {
        if (sameSession(pending.targetSession, member.session)) {
          // Send error reply to the debugger
          const replyFrame: Frame = {
            kind: 'reply',
            reply: { replyTo: commandId, error: 'SDK disconnected' },
          };
          if (pending.debugger.ws.readyState === pending.debugger.ws.OPEN) {
            pending.debugger.ws.send(encodeFrame(replyFrame));
          }
          this.pendingReplies.delete(commandId);
        }
      }

      // 标记为离线，但保留 backlog
      this.offlineSessions.set(key, this.buildSessionSnapshot(member, false));

      // 通知正在调试该 session 的 Debugger：目标已掉线
      this.notifySessionStatus(member.session, false);

      // 关闭该会话的录制段，刷新落盘
      this.recorder?.closeSession(this.id, member.session);
    } else {
      this.debuggers.delete(member);
      // 清理该 debugger 的 pending replies
      for (const [id, pending] of this.pendingReplies) {
        if (pending.debugger === member) this.pendingReplies.delete(id);
      }
      if (member.targetSession) this.notifyWatchers(member.targetSession);
    }
  }

  /** 新调试端接入：回放对应 session 的 backlog */
  replayTo(member: DebuggerMember): void {
    if (member.targetSession === null) {
      // Dashboard 模式：发送当前 sessions 列表
      this.sendDashboardSnapshot(member);
      return;
    }

    const key = sessionKey(member.targetSession);

    // 先告知目标 session 当前的真实在线状态（backlog 回放会让离线 session 看起来"活着"）
    const sdk = this.sdks.get(key);
    const connected = !!sdk && sdk.ws.readyState === sdk.ws.OPEN;
    safeSend(
      member.ws,
      encodeFrame({
        kind: 'msg',
        envelope: makeEnvelope(
          'session.status',
          { session: member.targetSession, connected, loadId: sdk?.session.loadId },
          'debugger',
        ),
      }),
    );

    const backlog = this.backlogs.get(key);
    if (!backlog) return;

    if (backlog.lastSystemInfo) safeSend(member.ws, backlog.lastSystemInfo);
    for (const f of backlog.rrwebBacklog) safeSend(member.ws, f.raw);
    for (const raw of backlog.eventBacklog) safeSend(member.ws, raw);
  }

  /**
   * 处理来自某成员的帧并路由。
   */
  route(from: Member, frame: Frame, raw: string): void {
    if (from.role === 'sdk') {
      this.handleSdkFrame(from, frame, raw);
    } else {
      this.handleDebuggerFrame(from, frame, raw);
    }
  }

  /** SDK → Server: 记录 backlog + 路由到对应 Debugger */
  private handleSdkFrame(from: SdkMember, frame: Frame, raw: string): void {
    from.lastActive = Date.now();
    const key = sessionKey(from.session);

    if (frame.kind === 'msg') {
      // 记录 system.info 到 SDK 成员
      if (frame.envelope.method === 'system.info') {
        from.systemInfo = frame.envelope.data as SystemInfoEvent;
      }

      // 录制：在更新 backlog 之前追加，使段头基线反映"本帧之前"的状态，
      // 本帧随后作为段内实时帧落盘，避免与基线重复。
      if (this.recorder?.enabled) {
        // 时间锚点：rrweb 帧用事件自带时间戳（SDK 时钟），其余用信封时间戳，
        // 供基线压缩对齐，避免段时长把基线之前的空闲间隔算进去。
        const d = frame.envelope.data as { event?: { timestamp?: number } } | undefined;
        const anchorTs =
          (frame.envelope.method === 'dom.rrweb' ? d?.event?.timestamp : undefined) ??
          frame.envelope.timestamp ??
          Date.now();
        this.recorder.append(
          this.id,
          from.session,
          raw,
          () => this.buildRecordingBaseline(key, from, anchorTs),
          this.buildRecordingMeta(from),
          frame.envelope.method,
          TRANSIENT_METHODS.has(frame.envelope.method),
        );
      }

      this.recordBacklog(key, frame, raw);

      // 路由到订阅了该 session 的 Debugger（带背压保护，慢消费者丢帧而非堆内存）
      for (const dbg of this.debuggers) {
        if (sameSession(dbg.targetSession, from.session)) {
          safeSend(dbg.ws, raw);
        }
      }

      // 通知所有 Dashboard 模式的 Debugger
      this.broadcastDashboardSnapshot();
    } else if (frame.kind === 'reply') {
      // SDK 回复 → 找到原始 Debugger
      const pending = this.pendingReplies.get(frame.reply.replyTo);
      if (pending) safeSend(pending.debugger.ws, raw);
      this.pendingReplies.delete(frame.reply.replyTo);
    }
  }

  /** Debugger → Server: 命令定向到目标 SDK */
  private handleDebuggerFrame(from: DebuggerMember, frame: Frame, raw: string): void {
    if (frame.kind !== 'msg') return;

    // 优先使用 envelope.target，其次使用 debugger 自己的 targetSession
    const target = frame.envelope.target ?? from.targetSession;
    if (!target) {
      // 没有目标，无法路由命令
      this.replyError(from, frame, 'No target session specified for command');
      return;
    }

    // Authorization check: debugger can only control their targetSession
    if (from.targetSession && !sameSession(from.targetSession, target)) {
      console.warn('[Room] Debugger attempted to control unauthorized session');
      this.replyError(from, frame, 'Not authorized to control this session');
      return;
    }

    const key = sessionKey(target);
    const sdk = this.sdks.get(key);
    if (!sdk || sdk.ws.readyState !== sdk.ws.OPEN) {
      this.replyError(from, frame, `Target session ${key} is offline`);
      return;
    }

    // 记录 pending reply（如果是带 id 的命令）
    if (frame.envelope.id) {
      this.pendingReplies.set(frame.envelope.id, {
        debugger: from,
        targetSession: target,
        at: Date.now(),
      });
    }

    sdk.ws.send(raw);
  }

  /** 把"有几个面板正在看这个 session"推给对应 SDK（驱动 SDK 侧高频采样启停） */
  private notifyWatchers(session: SessionId): void {
    const sdk = this.sdks.get(sessionKey(session));
    if (!sdk) return;
    let count = 0;
    for (const dbg of this.debuggers) {
      if (sameSession(dbg.targetSession, session)) count++;
    }
    safeSend(
      sdk.ws,
      encodeFrame({
        kind: 'msg',
        envelope: makeEnvelope('session.watchers', { count }, 'debugger'),
      }),
    );
  }

  /** 向订阅了指定 session 的 Debugger 推送目标在线状态变更 */
  private notifySessionStatus(session: SessionParams, connected: boolean): void {
    const target: SessionId = { deviceId: session.deviceId, pageId: session.pageId };
    const raw = encodeFrame({
      kind: 'msg',
      envelope: makeEnvelope(
        'session.status',
        { session: target, connected, loadId: session.loadId },
        'debugger',
      ),
    });
    for (const dbg of this.debuggers) {
      if (sameSession(dbg.targetSession, target)) safeSend(dbg.ws, raw);
    }
  }

  private replyError(to: DebuggerMember, frame: Frame, error: string): void {
    if (frame.kind !== 'msg' || !frame.envelope.id) return;
    const replyFrame: Frame = {
      kind: 'reply',
      reply: { replyTo: frame.envelope.id, error },
    };
    if (to.ws.readyState === to.ws.OPEN) {
      to.ws.send(encodeFrame(replyFrame));
    }
  }

  private recordBacklog(key: string, frame: Frame, raw: string): void {
    if (frame.kind !== 'msg') return;
    const { method } = frame.envelope;
    if (TRANSIENT_METHODS.has(method)) return;

    let backlog = this.backlogs.get(key);
    if (!backlog) {
      backlog = { lastSystemInfo: null, rrwebBacklog: [], eventBacklog: [] };
      this.backlogs.set(key, backlog);
    }

    if (method === 'system.info') {
      backlog.lastSystemInfo = raw;
      return;
    }

    if (method === 'dom.rrweb') {
      const data = frame.envelope.data as {
        isCheckout?: boolean;
        event?: { type?: number; timestamp?: number };
      };
      // rrweb Meta 事件(type 4)标志新快照段起点
      if (data.event?.type === 4) {
        backlog.rrwebBacklog = [];
      }
      backlog.rrwebBacklog.push({ raw, ts: data.event?.timestamp });
      if (backlog.rrwebBacklog.length > this.maxRrwebBacklog) {
        backlog.rrwebBacklog.shift();
      }
      return;
    }

    backlog.eventBacklog.push(raw);
    if (backlog.eventBacklog.length > this.maxBacklog) {
      backlog.eventBacklog.shift();
    }
  }

  /** 构建 session 快照（用于 Dashboard） */
  private buildSessionSnapshot(member: SdkMember, connected: boolean): SessionSnapshot {
    return {
      // 只暴露 SessionId 两个字段；identity/loadId 等连接参数不混进对外快照
      session: { deviceId: member.session.deviceId, pageId: member.session.pageId },
      identity: member.session.identity,
      connected,
      lastActive: member.lastActive,
      connectedAt: member.connectedAt,
      systemInfo: member.systemInfo ?? undefined,
    };
  }

  /**
   * 构建录制段头基线：system.info + 当前 rrweb backlog，编码为 JSON 行。
   * 在 recordBacklog 之前调用，因此反映"本帧之前"的页面状态——使每段都能
   * 从一个全量快照独立重建。
   *
   * 基线时间重定位：backlog 里的 rrweb 事件保留原始时间戳，页面空闲多久基线
   * 就比锚点旧多久——直接拷贝会让该段回放时长虚增出整段空闲（幻影时长）。
   * 这里把整组基线事件平移到锚点紧前（保留组内相对间隔），回放时长即真实
   * 活动时长。锚点与事件时间戳同属 SDK 时钟，不受服务端时钟偏差影响。
   */
  private buildRecordingBaseline(key: string, member: SdkMember, anchorTs: number): string[] {
    const out: string[] = [];
    if (member.systemInfo) {
      out.push(
        encodeFrame({
          kind: 'msg',
          envelope: makeEnvelope('system.info', member.systemInfo, 'sdk', null, anchorTs),
        }),
      );
    }
    const backlog = this.backlogs.get(key);
    if (!backlog || backlog.rrwebBacklog.length === 0) return out;

    let lastTs = 0;
    for (const f of backlog.rrwebBacklog) {
      if (f.ts && f.ts > lastTs) lastTs = f.ts;
    }
    const offset = lastTs > 0 ? Math.max(0, anchorTs - lastTs - 1) : 0;

    for (const f of backlog.rrwebBacklog) {
      if (offset === 0 || typeof f.ts !== 'number') {
        out.push(f.raw);
        continue;
      }
      // 只有轮转时（≥30s 一次）才解析一遍 backlog 改时间戳；热路径始终是原始字符串
      const frame = decodeFrame(f.raw);
      if (!frame || frame.kind !== 'msg') {
        out.push(f.raw);
        continue;
      }
      const data = frame.envelope.data as { event?: { timestamp?: number } };
      const ev = data.event;
      if (!ev || typeof ev.timestamp !== 'number') {
        out.push(f.raw);
        continue;
      }
      out.push(
        encodeFrame({
          kind: 'msg',
          envelope: {
            ...frame.envelope,
            timestamp: frame.envelope.timestamp + offset,
            data: { ...data, event: { ...ev, timestamp: ev.timestamp + offset } },
          },
        }),
      );
    }
    return out;
  }

  /** 构建录制会话元信息（写入 meta.json）。 */
  private buildRecordingMeta(member: SdkMember): SessionMeta {
    return {
      session: { deviceId: member.session.deviceId, pageId: member.session.pageId },
      identity: member.session.identity,
      url: member.systemInfo?.url,
      title: member.systemInfo?.title,
      ua: member.systemInfo?.ua,
    };
  }

  /** 清理过期的离线 sessions */
  private cleanupOfflineSessions(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    // 1. Remove sessions offline longer than TTL
    for (const [key, session] of this.offlineSessions) {
      if (now - session.lastActive > this.offlineSessionTTL) {
        toDelete.push(key);
      }
    }

    // 2. If still exceeds max count, remove oldest
    if (this.offlineSessions.size - toDelete.length > this.maxOfflineSessions) {
      const sorted = Array.from(this.offlineSessions.entries())
        .filter(([key]) => !toDelete.includes(key))
        .sort((a, b) => a[1].lastActive - b[1].lastActive);

      const excess = sorted.length - this.maxOfflineSessions;
      for (let i = 0; i < excess; i++) {
        toDelete.push(sorted[i][0]);
      }
    }

    // 3. Delete sessions and their backlogs
    for (const key of toDelete) {
      this.offlineSessions.delete(key);
      this.backlogs.delete(key);
    }

    if (toDelete.length > 0) {
      console.log(`[Room ${this.id}] Cleaned up ${toDelete.length} offline sessions`);
      // Notify dashboards after cleanup
      this.broadcastDashboardSnapshot();
    }

    // m1：清理 SDK 一直未应答的 pending 命令，按超时回错给发起的 debugger
    for (const [commandId, pending] of this.pendingReplies) {
      if (now - pending.at > PENDING_REPLY_TTL) {
        const replyFrame: Frame = {
          kind: 'reply',
          reply: { replyTo: commandId, error: 'Command timed out (no reply from SDK)' },
        };
        safeSend(pending.debugger.ws, encodeFrame(replyFrame));
        this.pendingReplies.delete(commandId);
      }
    }

    // M4：房间彻底空（无成员、无在线/离线 session）时通知注册表删除，
    // 否则仅剩离线 session 的房间在 TTL 清理后会连同定时器永久泄漏。
    if (this.size === 0 && this.getAllSessions().length === 0) {
      this.onEmpty?.();
    }
  }

  /** 获取所有 sessions（在线 + 离线） */
  getAllSessions(): SessionSnapshot[] {
    const list: SessionSnapshot[] = [];
    for (const sdk of this.sdks.values()) {
      list.push(this.buildSessionSnapshot(sdk, true));
    }
    for (const offline of this.offlineSessions.values()) {
      list.push(offline);
    }
    return list;
  }

  /** Destroy room and cleanup timers */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** 推送 dashboard 快照到所有 Dashboard 模式的 Debugger */
  broadcastDashboardSnapshot(): void {
    const sessions = this.getAllSessions();
    const event: DashboardSessionsEvent = {
      room: this.id,
      sessions,
    };
    const frame: Frame = {
      kind: 'msg',
      envelope: makeEnvelope('dashboard.sessions', event, 'debugger'),
    };
    const raw = encodeFrame(frame);

    for (const dbg of this.debuggers) {
      if (dbg.targetSession === null) {
        safeSend(dbg.ws, raw);
      }
    }
  }

  /** 单独给某个 Dashboard Debugger 推送快照 */
  private sendDashboardSnapshot(member: DebuggerMember): void {
    const sessions = this.getAllSessions();
    const event: DashboardSessionsEvent = {
      room: this.id,
      sessions,
    };
    const frame: Frame = {
      kind: 'msg',
      envelope: makeEnvelope('dashboard.sessions', event, 'debugger'),
    };
    safeSend(member.ws, encodeFrame(frame));
  }
}

/** 房间注册表 */
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private readonly recorder: RecordingManager | null;

  constructor(recorder: RecordingManager | null = null) {
    this.recorder = recorder;
  }

  /** 只读查找：不存在不创建（HTTP 读接口用，避免任意 GET 造出幽灵房间出现在首页） */
  peek(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  get(id: string): Room {
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id, undefined, undefined, undefined, undefined, this.recorder);
      // M4：房间自报为空时从注册表删除并清理其定时器，防止用户可控的 room id 无限累积。
      room.onEmpty = () => this.delete(id);
      this.rooms.set(id, room);
    }
    return room;
  }

  delete(id: string): void {
    const room = this.rooms.get(id);
    if (room) {
      room.destroy();
      this.rooms.delete(id);
    }
  }

  list(): Array<{ id: string; hasSdk: boolean; online: number; debuggers: number; sessions: number }> {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      hasSdk: r.hasSdk(),
      online: r.onlineCount(),
      debuggers: r.debuggerCount(),
      sessions: r.getAllSessions().length,
    }));
  }
}
