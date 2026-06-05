import type { WebSocket } from 'ws';
import type { Frame, SessionId } from '@remotr/shared';
import { encodeFrame } from '@remotr/shared';

interface SessionParams {
  deviceId?: string;
  pageId?: string;
  identity?: string;
}

interface Member {
  ws: WebSocket;
  role: 'sdk' | 'debugger';
  /** SDK 端连接会携带 session 信息 */
  session?: SessionParams;
}

/**
 * Room — 一个调试会话单元。
 * 维护 SDK 端与调试端连接，并保存消息 backlog 供延迟接入的调试端回放。
 *
 * backlog 策略（针对 rrweb）：
 *  - 记录最后一个 rrweb 全量快照(isCheckout)的位置
 *  - 调试端接入时，从该位置开始回放，保证镜像可完整重建
 *  - 非 rrweb 消息（console/network/storage）保留最近 N 条
 */
export class Room {
  readonly id: string;
  private members = new Set<Member>();

  /** rrweb 事件 backlog：从最近一次全量快照起 */
  private rrwebBacklog: Frame[] = [];
  /** 其他事件 backlog（环形，最多 maxBacklog 条） */
  private eventBacklog: Frame[] = [];
  /** 最近一次 system.info（始终重放给新接入的调试端） */
  private lastSystemInfo: Frame | null = null;

  private readonly maxBacklog: number;

  constructor(id: string, maxBacklog = 500) {
    this.id = id;
    this.maxBacklog = maxBacklog;
  }

  get size(): number {
    return this.members.size;
  }

  hasSdk(): boolean {
    for (const m of this.members) if (m.role === 'sdk') return true;
    return false;
  }

  debuggerCount(): number {
    let n = 0;
    for (const m of this.members) if (m.role === 'debugger') n++;
    return n;
  }

  add(ws: WebSocket, role: 'sdk' | 'debugger', session?: SessionParams): Member {
    const member: Member = { ws, role, session };
    this.members.add(member);
    return member;
  }

  remove(member: Member): void {
    this.members.delete(member);
  }

  /** 调试端刚接入：回放 backlog 以重建当前状态 */
  replayTo(ws: WebSocket): void {
    if (this.lastSystemInfo) ws.send(encodeFrame(this.lastSystemInfo));
    for (const f of this.rrwebBacklog) ws.send(encodeFrame(f));
    for (const f of this.eventBacklog) ws.send(encodeFrame(f));
  }

  /**
   * 处理来自某成员的帧并路由给对端。
   * SDK 的消息 → 广播给所有调试端，并按规则存入 backlog。
   * 调试端的消息（命令）→ 转发给 SDK。
   * reply 帧 → 广播给对端（命令结果回传）。
   */
  route(from: Member, frame: Frame, raw: string): void {
    if (from.role === 'sdk') {
      this.recordBacklog(frame);
      this.broadcast('debugger', raw);
    } else {
      // 调试端命令 / reply → 发给 SDK
      this.broadcast('sdk', raw);
    }
  }

  private recordBacklog(frame: Frame): void {
    if (frame.kind !== 'msg') return;
    const { method } = frame.envelope;

    if (method === 'system.info') {
      this.lastSystemInfo = frame;
      return;
    }

    if (method === 'dom.rrweb') {
      const data = frame.envelope.data as {
        isCheckout?: boolean;
        event?: { type?: number };
      };
      // rrweb 的 Meta 事件(type 4)标志一个新快照段的开始（初始 + 每次 checkout）。
      // 它总是紧接在 FullSnapshot(type 2) 之前，且包含 Replayer 初始化必需的
      // viewport/href 信息。以 Meta 为界裁剪 backlog，可保证回放基线完整：
      // [Meta, FullSnapshot, ...incrementals]。
      // 注意：不能用 isCheckout 裁剪——该版本 rrweb 把 isCheckout 标在 FullSnapshot 上，
      // 在它之前裁剪会误删 Meta，导致调试端无法重建镜像。
      if (data.event?.type === 4) {
        this.rrwebBacklog = [];
      }
      this.rrwebBacklog.push(frame);
      return;
    }

    // 其他事件：环形缓冲
    this.eventBacklog.push(frame);
    if (this.eventBacklog.length > this.maxBacklog) {
      this.eventBacklog.shift();
    }
  }

  private broadcast(toRole: 'sdk' | 'debugger', raw: string): void {
    for (const m of this.members) {
      if (m.role === toRole && m.ws.readyState === m.ws.OPEN) {
        m.ws.send(raw);
      }
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

  list(): Array<{ id: string; hasSdk: boolean; debuggers: number }> {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      hasSdk: r.hasSdk(),
      debuggers: r.debuggerCount(),
    }));
  }
}
