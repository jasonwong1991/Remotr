import type { WebSocket } from 'ws';
import type {
  Frame,
  SessionId,
  SessionSnapshot,
  SystemInfoEvent,
  DashboardSessionsEvent,
} from '@remotr/shared';
import { encodeFrame, makeEnvelope } from '@remotr/shared';
import type { RecordingManager, SessionMeta } from './recording.js';

/** SDK 端连接的 session 信息 */
interface SessionParams {
  deviceId: string;
  pageId: string;
  identity?: string;
}

/** 每个 session 的 backlog 状态 */
interface SessionBacklog {
  lastSystemInfo: Frame | null;
  rrwebBacklog: Frame[];
  eventBacklog: Frame[];
}

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
    // 通知正在调试该 session 的 Debugger：目标已上线
    this.notifySessionStatus(session, true);
    return member;
  }

  /** 添加 Debugger 成员（Dashboard 或 Session 模式） */
  addDebugger(ws: WebSocket, targetSession: SessionId | null): DebuggerMember {
    const member: DebuggerMember = { ws, role: 'debugger', targetSession };
    this.debuggers.add(member);
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
        envelope: makeEnvelope('session.status', { session: member.targetSession, connected }, 'debugger'),
      }),
    );

    const backlog = this.backlogs.get(key);
    if (!backlog) return;

    if (backlog.lastSystemInfo) safeSend(member.ws, encodeFrame(backlog.lastSystemInfo));
    for (const f of backlog.rrwebBacklog) safeSend(member.ws, encodeFrame(f));
    for (const f of backlog.eventBacklog) safeSend(member.ws, encodeFrame(f));
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
        );
      }

      this.recordBacklog(key, frame);

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

  /** 向订阅了指定 session 的 Debugger 推送目标在线状态变更 */
  private notifySessionStatus(session: SessionParams, connected: boolean): void {
    const target: SessionId = { deviceId: session.deviceId, pageId: session.pageId };
    const raw = encodeFrame({
      kind: 'msg',
      envelope: makeEnvelope('session.status', { session: target, connected }, 'debugger'),
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

  private recordBacklog(key: string, frame: Frame): void {
    if (frame.kind !== 'msg') return;
    let backlog = this.backlogs.get(key);
    if (!backlog) {
      backlog = { lastSystemInfo: null, rrwebBacklog: [], eventBacklog: [] };
      this.backlogs.set(key, backlog);
    }

    const { method } = frame.envelope;
    if (method === 'system.info') {
      backlog.lastSystemInfo = frame;
      return;
    }

    if (method === 'dom.rrweb') {
      const data = frame.envelope.data as {
        isCheckout?: boolean;
        event?: { type?: number };
      };
      // rrweb Meta 事件(type 4)标志新快照段起点
      if (data.event?.type === 4) {
        backlog.rrwebBacklog = [];
      }
      backlog.rrwebBacklog.push(frame);
      if (backlog.rrwebBacklog.length > this.maxRrwebBacklog) {
        backlog.rrwebBacklog.shift();
      }
      return;
    }

    backlog.eventBacklog.push(frame);
    if (backlog.eventBacklog.length > this.maxBacklog) {
      backlog.eventBacklog.shift();
    }
  }

  /** 构建 session 快照（用于 Dashboard） */
  private buildSessionSnapshot(member: SdkMember, connected: boolean): SessionSnapshot {
    return {
      session: member.session,
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
      if (f.kind !== 'msg') continue;
      const ev = (f.envelope.data as { event?: { timestamp?: number } }).event;
      if (ev?.timestamp && ev.timestamp > lastTs) lastTs = ev.timestamp;
    }
    const offset = lastTs > 0 ? Math.max(0, anchorTs - lastTs - 1) : 0;

    for (const f of backlog.rrwebBacklog) {
      if (f.kind !== 'msg') continue;
      const data = f.envelope.data as { event?: { timestamp?: number } };
      const ev = data.event;
      if (offset === 0 || !ev || typeof ev.timestamp !== 'number') {
        out.push(encodeFrame(f));
        continue;
      }
      // 浅拷贝信封/数据/事件三层后改时间戳；backlog 对象与实时回放共享，不可原地改
      out.push(
        encodeFrame({
          kind: 'msg',
          envelope: {
            ...f.envelope,
            timestamp: f.envelope.timestamp + offset,
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
      session: member.session,
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

  list(): Array<{ id: string; hasSdk: boolean; debuggers: number; sessions: number }> {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      hasSdk: r.hasSdk(),
      debuggers: r.debuggerCount(),
      sessions: r.getAllSessions().length,
    }));
  }
}
