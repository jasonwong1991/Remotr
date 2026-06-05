import type { Envelope, MethodName, Reply, Role } from './protocol.js';

/** WebSocket 传输的顶层帧：要么是消息信封，要么是命令回复 */
export type Frame =
  | { kind: 'msg'; envelope: Envelope }
  | { kind: 'reply'; reply: Reply };

/** 序列化帧为 WebSocket 文本载荷 */
export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

/** 解析 WebSocket 文本载荷为帧；非法输入返回 null */
export function decodeFrame(raw: string): Frame | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && (obj.kind === 'msg' || obj.kind === 'reply')) {
      return obj as Frame;
    }
    return null;
  } catch {
    return null;
  }
}

/** 构造事件/命令信封 */
export function makeEnvelope<M extends MethodName>(
  method: M,
  data: Envelope<M>['data'],
  source: Role,
  id: string | null = null,
  timestamp = Date.now(),
  metadata?: Envelope['metadata'],
): Envelope<M> {
  const envelope: Envelope<M> = { id, method, data, timestamp, source };
  if (metadata) {
    envelope.metadata = metadata;
  }
  return envelope;
}
