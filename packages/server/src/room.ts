import type { WebSocket } from 'ws';
import type {
  Frame,
  SessionId,
  SessionSnapshot,
  SystemInfoEvent,
  DashboardSessionsEvent,
} from '@remotr/shared';
import { encodeFrame, makeEnvelope } from '@remotr/shared';

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
  /** Pending commands: commandId → Debugger（reply 路由） */
  private pendingReplies = new Map<string, DebuggerMember>();

  private readonly maxBacklog: number;
  private readonly maxRrwebBacklog: number;

  constructor(id: string, maxBacklog = 500, maxRrwebBacklog = 1000) {
    this.id = id;
    this.maxBacklog = maxBacklog;
    this.maxRrwebBacklog = maxRrwebBacklog;
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
    this.sdks.set(sessionKey(session), member);
    // 清除离线记录
    this.offlineSessions.delete(sessionKey(session));
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
      this.sdks.delete(key);
      // 标记为离线，但保留 backlog
      this.offlineSessions.set(key, this.buildSessionSnapshot(member, false));
    } else {
      this.debuggers.delete(member);
      // 清理该 debugger 的 pending replies
      for (const [id, dbg] of this.pendingReplies) {
        if (dbg === member) this.pendingReplies.delete(id);
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
    const backlog = this.backlogs.get(key);
    if (!backlog) return;

    if (backlog.lastSystemInfo) member.ws.send(encodeFrame(backlog.lastSystemInfo));
    for (const f of backlog.rrwebBacklog) member.ws.send(encodeFrame(f));
    for (const f of backlog.eventBacklog) member.ws.send(encodeFrame(f));
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
      this.recordBacklog(key, frame);

      // 路由到订阅了该 session 的 Debugger
      for (const dbg of this.debuggers) {
        if (sameSession(dbg.targetSession, from.session)) {
          if (dbg.ws.readyState === dbg.ws.OPEN) {
            dbg.ws.send(raw);
          }
        }
      }

      // 通知所有 Dashboard 模式的 Debugger
      this.broadcastDashboardSnapshot();
    } else if (frame.kind === 'reply') {
      // SDK 回复 → 找到原始 Debugger
      const dbg = this.pendingReplies.get(frame.reply.replyTo);
      if (dbg && dbg.ws.readyState === dbg.ws.OPEN) {
        dbg.ws.send(raw);
      }
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

    const key = sessionKey(target);
    const sdk = this.sdks.get(key);
    if (!sdk || sdk.ws.readyState !== sdk.ws.OPEN) {
      this.replyError(from, frame, `Target session ${key} is offline`);
      return;
    }

    // 记录 pending reply（如果是带 id 的命令）
    if (frame.envelope.id) {
      this.pendingReplies.set(frame.envelope.id, from);
    }

    sdk.ws.send(raw);
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
      if (dbg.targetSession === null && dbg.ws.readyState === dbg.ws.OPEN) {
        dbg.ws.send(raw);
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
    if (member.ws.readyState === member.ws.OPEN) {
      member.ws.send(encodeFrame(frame));
    }
  }
}

/** 房间注册表 */
export class RoomRegistry {
  private rooms = new Map<string, Room>();

  get(id: string): Room {
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id);
      this.rooms.set(id, room);
    }
    return room;
  }

  delete(id: string): void {
    this.rooms.delete(id);
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
