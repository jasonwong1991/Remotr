import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, readdir, stat, rm, writeFile, readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import type {
  SessionId,
  RecordingListResponse,
  RecordingSessionInfo,
  RecordingSegmentInfo,
} from '@remotr/shared';

/**
 * 录制配置（来自环境变量，见 loadRecordingConfig）。
 */
export interface RecordingConfig {
  /** 是否启用录制 */
  enabled: boolean;
  /** 录制根目录 */
  dir: string;
  /** 单段时长（毫秒） */
  segmentMs: number;
  /** 全局磁盘配额（字节）；超出时删除最旧的段 */
  maxBytes: number;
}

/** 每段附带的会话元信息（写入 meta.json，供回放列表 API 读取） */
export interface SessionMeta {
  session: SessionId;
  identity?: string;
  url?: string;
  title?: string;
}

/** 解析 "1GB" / "500MB" / "1073741824" 形式的字节数 */
function parseBytes(s: string | undefined): number {
  if (!s) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(g|m|k)?b?$/i.exec(s.trim());
  if (!m) return Number(s) || 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  const mult = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1;
  return Math.floor(n * mult);
}

/** 从环境变量加载录制配置。默认开启、30s 分段、1GB 配额。 */
export function loadRecordingConfig(rootDir: string): RecordingConfig {
  const off = /^(off|false|0|no)$/i.test(process.env.REMOTR_REC ?? '');
  const segmentSec = Number(process.env.REMOTR_REC_SEGMENT_SEC) || 30;
  const maxBytes = parseBytes(process.env.REMOTR_REC_MAX_BYTES) || 1024 ** 3;
  const dir = process.env.REMOTR_REC_DIR || join(rootDir, 'recordings');
  return { enabled: !off, dir, segmentMs: segmentSec * 1000, maxBytes };
}

/** server 本地时区的 YYYY-MM-DD */
function localDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 文件名/目录名安全化：仅保留字母数字与 . _ -，其余替换为 _ */
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || '_';
}

/** 会话目录名：deviceId__pageId（仅用于人类可读；权威信息在 meta.json） */
function sessionDirName(session: SessionId): string {
  return `${sanitize(session.deviceId)}__${sanitize(session.pageId)}`;
}

interface SessionRecorder {
  room: string;
  session: SessionId;
  /** 当前段所属日期（YYYY-MM-DD） */
  date: string;
  /** 当前段起始时间戳（即文件名） */
  startTs: number;
  /** 当前段写入流；为 null 表示尚未打开（首段或正在异步打开） */
  stream: WriteStream | null;
  /** 流就绪前的待写缓冲（段头基线也先进这里） */
  buffer: string[];
  /** 是否正在异步打开新段流 */
  opening: boolean;
  /** 已写入 meta.json 的目录（避免重复写） */
  metaWritten: boolean;
}

/**
 * RecordingManager — 录制管理器（server 单例）。
 *
 * 职责：把流经 server 的 SDK 帧按会话、按时长分段追加写入磁盘（JSONL），
 * 每段以"基线"（system.info + 当前 rrweb backlog）开头，保证段自包含、可独立回放。
 * 同时负责"仅保留当天"清理与磁盘配额管理。
 *
 * 设计要点：
 *  - 写盘走 append-only 流，不阻塞帧转发热路径；段流异步打开期间帧先入 buffer。
 *  - 每段开头写入基线，使该段能被 rrweb Replayer 独立从全量快照重建。
 *  - 帧原样落盘（与实时流同构），因此 console/network（含 response body）回放零成本。
 */
export class RecordingManager {
  private readonly cfg: RecordingConfig;
  private recorders = new Map<string, SessionRecorder>();
  /** 当天录制总字节数（用于配额触发） */
  private totalBytes = 0;
  private sweeping = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cfg: RecordingConfig) {
    this.cfg = cfg;
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  get rootDir(): string {
    return this.cfg.dir;
  }

  /** 启动：建目录、清理非当天数据、按配额裁剪、启动定时清理（每小时）。 */
  async start(): Promise<void> {
    if (!this.cfg.enabled) return;
    try {
      await mkdir(this.cfg.dir, { recursive: true });
    } catch (err) {
      console.warn('[Recording] failed to create dir, recording disabled:', err);
      this.cfg.enabled = false;
      return;
    }
    await this.cleanup();
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(() => {});
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
    console.log(
      `[Recording] enabled · dir=${this.cfg.dir} · segment=${this.cfg.segmentMs / 1000}s · quota=${(this.cfg.maxBytes / 1024 ** 2).toFixed(0)}MB`,
    );
  }

  private key(room: string, session: SessionId): string {
    return `${room}|${session.deviceId}|${session.pageId}`;
  }

  /**
   * 追加一帧到当前段。必要时先轮转（关闭旧段、以基线开启新段）。
   *
   * 重要：调用方须在更新内存 backlog **之前**调用本方法，使 baseline() 反映
   * "本帧之前"的状态——本帧随后作为段内实时帧写入，避免与基线重复。
   *
   * @param raw       原始帧 JSON 字符串（与转发给 debugger 的完全一致）
   * @param baseline  段头基线生产函数：返回 system.info + rrweb backlog 的 JSON 行
   * @param meta      会话元信息（写入 meta.json）
   */
  append(
    room: string,
    session: SessionId,
    raw: string,
    baseline: () => string[],
    meta: SessionMeta,
  ): void {
    if (!this.cfg.enabled) return;
    const k = this.key(room, session);
    let rec = this.recorders.get(k);
    if (!rec) {
      rec = {
        room,
        session,
        date: '',
        startTs: 0,
        stream: null,
        buffer: [],
        opening: false,
        metaWritten: false,
      };
      this.recorders.set(k, rec);
    }

    const now = Date.now();
    const needRotate =
      !rec.opening &&
      (rec.stream === null && rec.buffer.length === 0
        ? true // 首段
        : now - rec.startTs >= this.cfg.segmentMs || localDate(now) !== rec.date);

    if (needRotate) {
      this.rotate(rec, now, baseline(), meta);
    }

    this.enqueue(rec, raw);
  }

  /** 入队/写入一行。流未就绪则缓冲，就绪则直写。 */
  private enqueue(rec: SessionRecorder, line: string): void {
    if (rec.stream) {
      this.writeLine(rec, rec.stream, line);
    } else {
      rec.buffer.push(line);
    }
  }

  private writeLine(rec: SessionRecorder, stream: WriteStream, line: string): void {
    const buf = line + '\n';
    const n = Buffer.byteLength(buf);
    stream.write(buf);
    this.totalBytes += n;
    if (this.totalBytes > this.cfg.maxBytes) this.scheduleQuotaSweep();
  }

  /** 轮转到新段：关闭旧流，记录新段参数，异步打开新流并先写入基线。 */
  private rotate(rec: SessionRecorder, now: number, baselineLines: string[], meta: SessionMeta): void {
    if (rec.stream) {
      const old = rec.stream;
      rec.stream = null;
      old.end();
    }
    rec.startTs = now;
    rec.date = localDate(now);
    rec.opening = true;
    // 基线先入缓冲，确保它在任何段内实时帧之前落盘。
    rec.buffer = baselineLines.slice();

    const dir = join(this.cfg.dir, rec.date, sanitize(rec.room), sessionDirName(rec.session));
    const filePath = join(dir, `${now}.jsonl`);

    void this.openSegment(rec, dir, filePath, meta);
  }

  private async openSegment(
    rec: SessionRecorder,
    dir: string,
    filePath: string,
    meta: SessionMeta,
  ): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
      if (!rec.metaWritten) {
        await writeFile(join(dir, 'meta.json'), JSON.stringify(meta)).catch(() => {});
        rec.metaWritten = true;
      }
      const stream = createWriteStream(filePath, { flags: 'a' });
      // 打开期间累积的帧（基线 + 实时）一次性按序刷出。
      const buffered = rec.buffer;
      rec.buffer = [];
      rec.stream = stream;
      rec.opening = false;
      for (const line of buffered) this.writeLine(rec, stream, line);
    } catch (err) {
      // 打开失败：丢弃该段缓冲，标记非打开态，后续帧重试。
      rec.opening = false;
      rec.buffer = [];
      console.warn('[Recording] failed to open segment:', err);
    }
  }

  /** 会话断开：刷出并关闭当前段流。 */
  closeSession(room: string, session: SessionId): void {
    const k = this.key(room, session);
    const rec = this.recorders.get(k);
    if (!rec) return;
    if (rec.stream) {
      rec.stream.end();
      rec.stream = null;
    }
    rec.buffer = [];
    this.recorders.delete(k);
  }

  /** 配额超限时调度一次异步清理（合并并发请求）。 */
  private scheduleQuotaSweep(): void {
    if (this.sweeping) return;
    this.sweeping = true;
    this.enforceQuota()
      .catch(() => {})
      .finally(() => {
        this.sweeping = false;
      });
  }

  /**
   * 清理：删除非当天日期目录，并按配额裁剪当天最旧的段。
   * 启动时与每小时调用。
   */
  async cleanup(): Promise<void> {
    if (!this.cfg.enabled) return;
    const today = localDate(Date.now());
    try {
      const entries = await readdir(this.cfg.dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        // 仅删除"看起来像日期且非今天"的目录，避免误删其他内容。
        if (/^\d{4}-\d{2}-\d{2}$/.test(e.name) && e.name !== today) {
          await rm(join(this.cfg.dir, e.name), { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {
      /* dir 不存在等，忽略 */
    }
    // 重新统计当天总字节并按配额裁剪。
    this.totalBytes = await this.sumTodayBytes(today);
    await this.enforceQuota();
  }

  /** 汇总当天所有段文件字节数。 */
  private async sumTodayBytes(today: string): Promise<number> {
    let total = 0;
    for (const f of await this.listTodaySegmentFiles(today)) {
      total += f.bytes;
    }
    return total;
  }

  /** 列出当天所有段文件（含路径、大小、起始时间），按 startTs 升序。 */
  private async listTodaySegmentFiles(
    today: string,
  ): Promise<Array<{ path: string; bytes: number; startTs: number }>> {
    const out: Array<{ path: string; bytes: number; startTs: number }> = [];
    const dateDir = join(this.cfg.dir, today);
    let rooms: import('node:fs').Dirent[];
    try {
      rooms = await readdir(dateDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const room of rooms) {
      if (!room.isDirectory()) continue;
      const roomDir = join(dateDir, room.name);
      const sessions = await readdir(roomDir, { withFileTypes: true }).catch(() => []);
      for (const sess of sessions) {
        if (!sess.isDirectory()) continue;
        const sessDir = join(roomDir, sess.name);
        const files = await readdir(sessDir, { withFileTypes: true }).catch(() => []);
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
          const startTs = parseInt(file.name, 10);
          if (!Number.isFinite(startTs)) continue;
          const s = await stat(join(sessDir, file.name)).catch(() => null);
          if (!s) continue;
          out.push({ path: join(sessDir, file.name), bytes: s.size, startTs });
        }
      }
    }
    out.sort((a, b) => a.startTs - b.startTs);
    return out;
  }

  /** 当天总字节超过配额时，从最旧的段开始删除，直到降到配额的 90% 以下。 */
  private async enforceQuota(): Promise<void> {
    if (!this.cfg.enabled || this.totalBytes <= this.cfg.maxBytes) return;
    const today = localDate(Date.now());
    const files = await this.listTodaySegmentFiles(today);
    const target = Math.floor(this.cfg.maxBytes * 0.9);
    let total = files.reduce((sum, f) => sum + f.bytes, 0);
    for (const f of files) {
      if (total <= target) break;
      // 不删除正在写入的当前段。
      if (this.isActiveSegment(f.path)) continue;
      await rm(f.path, { force: true }).catch(() => {});
      total -= f.bytes;
    }
    this.totalBytes = total;
  }

  /** 判断某段文件是否为某会话当前正在写入的段。 */
  private isActiveSegment(path: string): boolean {
    for (const rec of this.recorders.values()) {
      const active = join(
        this.cfg.dir,
        rec.date,
        sanitize(rec.room),
        sessionDirName(rec.session),
        `${rec.startTs}.jsonl`,
      );
      if (active === path) return true;
    }
    return false;
  }

  /**
   * 列出某 room 当天的全部录制（按会话分组）。供 HTTP API 使用。
   */
  async listRecordings(room: string): Promise<RecordingListResponse> {
    const date = localDate(Date.now());
    const resp: RecordingListResponse = { room, date, enabled: this.cfg.enabled, sessions: [] };
    if (!this.cfg.enabled) return resp;

    const roomDir = join(this.cfg.dir, date, sanitize(room));
    let sessDirs: import('node:fs').Dirent[];
    try {
      sessDirs = await readdir(roomDir, { withFileTypes: true });
    } catch {
      return resp; // 当天该 room 无录制
    }

    for (const sd of sessDirs) {
      if (!sd.isDirectory()) continue;
      const sessDir = join(roomDir, sd.name);

      // 读取 meta.json 获取权威会话信息
      let meta: SessionMeta | null = null;
      try {
        meta = JSON.parse(await readFile(join(sessDir, 'meta.json'), 'utf-8')) as SessionMeta;
      } catch {
        continue; // 无 meta 视为无效目录，跳过
      }

      const segments: RecordingSegmentInfo[] = [];
      const files = await readdir(sessDir, { withFileTypes: true }).catch(() => []);
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const startTs = parseInt(f.name, 10);
        if (!Number.isFinite(startTs)) continue;
        const s = await stat(join(sessDir, f.name)).catch(() => null);
        if (!s || s.size === 0) continue;
        segments.push({ file: f.name, startTs, endTs: Math.floor(s.mtimeMs), bytes: s.size });
      }
      if (segments.length === 0) continue;
      segments.sort((a, b) => a.startTs - b.startTs);

      const info: RecordingSessionInfo = {
        session: meta.session,
        dir: sd.name,
        identity: meta.identity,
        url: meta.url,
        title: meta.title,
        segments,
      };
      resp.sessions.push(info);
    }
    return resp;
  }

  /**
   * 把 (room, dir, file) 解析为当天段文件的绝对路径，并做目录穿越校验。
   * 非法或越界路径返回 null。
   */
  resolveSegmentPath(room: string, dir: string, file: string): string | null {
    if (!/^[\w.-]+$/.test(dir) || !/^\d+\.jsonl$/.test(file)) return null;
    const date = localDate(Date.now());
    const base = join(this.cfg.dir, date, sanitize(room));
    const full = normalize(join(base, dir, file));
    // 必须仍在 base 目录之内，防止 ../ 穿越
    if (!full.startsWith(normalize(base))) return null;
    return full;
  }

  /** 关闭所有流并停止定时器（server 关停时）。 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const rec of this.recorders.values()) {
      rec.stream?.end();
      rec.stream = null;
    }
    this.recorders.clear();
  }
}
