/**
 * Session ID 管理模块
 * 负责生成和持久化 deviceId、pageId，以及读取身份标识
 */

import type { SessionId, SessionMetadata } from '@remotr/shared';

/**
 * 模块加载时（storage 插件 hook 安装前）捕获的原始 setItem。
 * 心跳每 3s 写一次 __remotr_tabs:* —— 若走被劫持的 setItem，会把 SDK 自己的
 * 内部写入采集成 storage.change 噪声。localStorage 访问在隐私模式可能抛错。
 */
const rawSetItem: ((key: string, value: string) => void) | null = (() => {
  try {
    return localStorage.setItem.bind(localStorage);
  } catch {
    return null;
  }
})();

function internalSetItem(key: string, value: string): void {
  if (rawSetItem) rawSetItem(key, value);
  else localStorage.setItem(key, value);
}

/** slot 心跳 teardown（由 claimPageSlot 设置，stopSession 调用）。 */
let slotHeartbeatTeardown: (() => void) | null = null;

/** 停止 session 相关的后台活动：清心跳定时器、解绑卸载监听、释放 slot。 */
export function stopSession(): void {
  if (slotHeartbeatTeardown) {
    try {
      slotHeartbeatTeardown();
    } catch {
      /* best-effort */
    }
    slotHeartbeatTeardown = null;
  }
}

/**
 * 生成随机 ID
 */
function randomId(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * 确定性字符串哈希（cyrb53）。同一输入恒定产生同一输出，
 * 用于从 URL / 浏览器指纹生成稳定的 session 标识。
 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 收集稳定的浏览器特征（localStorage 不可用时的 deviceId 兜底来源）。 */
function browserFingerprint(): string {
  try {
    const n = navigator;
    return [
      n.userAgent,
      n.language,
      (n.languages || []).join(','),
      (n as unknown as { platform?: string }).platform ?? '',
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      new Date().getTimezoneOffset(),
    ].join('|');
  } catch {
    return 'unknown';
  }
}

/**
 * 获取或生成设备 ID
 * 优先级：config.deviceId > localStorage > 浏览器指纹
 *
 * localStorage 跨标签页、跨重启持久，是设备身份的首选来源；不可用（隐私模式/
 * 禁用存储）时回退到浏览器指纹的确定性哈希，避免每次加载都产生新 deviceId。
 */
export function getDeviceId(configDeviceId?: string): string {
  if (configDeviceId) return configDeviceId;

  try {
    const key = '__remotr_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `dev_${randomId(16)}`;
      internalSetItem(key, id);
    }
    return id;
  } catch {
    // localStorage 不可用：用指纹生成稳定 ID（而非随机）以避免 session 碎片化
    return `dev_${cyrb53(browserFingerprint())}`;
  }
}

// ─────────────────────────────────────────────────────────
// pageId：基于 URL 指纹的确定性身份 + 并发标签页区分
// ─────────────────────────────────────────────────────────

/** 标签页注册表的 localStorage key 前缀 */
const TAB_REGISTRY_PREFIX = '__remotr_tabs:';
/** 心跳间隔；存活标签页周期性刷新自己的 slot 时间戳 */
const HEARTBEAT_MS = 3000;
/** slot 过期阈值；超过此时长无心跳视为标签页已关闭（约 3 个心跳） */
const STALE_MS = 10_000;

interface SlotEntry {
  /** 持有者随机 token，用于并发写入下的归属判定 */
  t: string;
  /** 最近一次心跳时间戳 */
  ts: number;
}
type TabRegistry = Record<string, SlotEntry>;

/** 由 URL 生成确定性的 pageId 基值（同 URL 恒定同值）。 */
export function pageIdForUrl(url: string): string {
  return `page_${cyrb53(url)}`;
}

/** 剪除过期 slot（心跳超过 STALE_MS 的视为死标签页）。就地修改并返回。 */
export function pruneRegistry(reg: TabRegistry, now: number, staleMs = STALE_MS): TabRegistry {
  for (const slot of Object.keys(reg)) {
    if (!reg[slot] || typeof reg[slot].ts !== 'number' || now - reg[slot].ts > staleMs) {
      delete reg[slot];
    }
  }
  return reg;
}

/** 在 base, base-2, base-3… 序列中返回最低的空闲 slot。 */
export function lowestFreeSlot(reg: TabRegistry, base: string): string {
  if (reg[base] == null) return base;
  let n = 2;
  while (reg[`${base}-${n}`] != null) n++;
  return `${base}-${n}`;
}

function readRegistry(regKey: string): TabRegistry {
  try {
    return JSON.parse(localStorage.getItem(regKey) || '{}') as TabRegistry;
  } catch {
    return {};
  }
}

/**
 * 认领一个页面 slot。
 *
 * 同一页面（同 deviceId + 同 URL）单标签页退出重进会复用同一 base，保证 session
 * 连续；当检测到另一个标签页"同时在线"（心跳新鲜）时，后开者顺延到 base-2/base-3…
 * 以避免两个标签页的录制流交错。标签页关闭（pagehide）时释放自己的 slot。
 */
function claimPageSlot(base: string): string {
  const regKey = TAB_REGISTRY_PREFIX + base;
  const token = randomId(8);
  let slot = base;
  try {
    // 最多重试 5 次以化解并发认领竞争（最后写入者保留该 slot，其余顺延）
    for (let attempt = 0; attempt < 5; attempt++) {
      const now = Date.now();
      const reg = pruneRegistry(readRegistry(regKey), now);
      slot = lowestFreeSlot(reg, base);
      reg[slot] = { t: token, ts: now };
      internalSetItem(regKey, JSON.stringify(reg));
      // 并发校验：确认 slot 仍归我；被他人覆盖则换下一个重试
      const after = readRegistry(regKey);
      if (after[slot] && after[slot].t === token) break;
    }
    slotHeartbeatTeardown = startSlotHeartbeat(regKey, slot, token);
  } catch {
    return base;
  }
  return slot;
}

/** 启动 slot 心跳，并在页面卸载时释放 slot。返回停止心跳 + 解绑监听的 teardown。 */
function startSlotHeartbeat(regKey: string, slot: string, token: string): () => void {
  const beat = () => {
    try {
      const reg = pruneRegistry(readRegistry(regKey), Date.now());
      reg[slot] = { t: token, ts: Date.now() };
      internalSetItem(regKey, JSON.stringify(reg));
    } catch {
      /* ignore */
    }
  };
  const release = () => {
    try {
      const reg = readRegistry(regKey);
      if (reg[slot] && reg[slot].t === token) {
        delete reg[slot];
        internalSetItem(regKey, JSON.stringify(reg));
      }
    } catch {
      /* ignore */
    }
  };
  const timer = setInterval(beat, HEARTBEAT_MS);
  window.addEventListener('pagehide', release);
  window.addEventListener('beforeunload', release);

  return () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', release);
    window.removeEventListener('beforeunload', release);
    release();
  };
}

/**
 * 获取或生成页面 ID
 * 优先级：config.pageId > URL 指纹（+ 并发标签页 slot）
 *
 * 不再使用随机数 + sessionStorage（关闭标签页即失效，导致退出重进产生新 session）。
 * 改用 origin + pathname 的确定性指纹：同设备、同浏览器、同页面退出重进仍是同一
 * session，离线记录可续上、回放归一。query/hash 不参与，避免动态参数造成碎片化。
 */
export function getPageId(configPageId?: string): string {
  if (configPageId) return configPageId;

  try {
    const base = pageIdForUrl(location.origin + location.pathname);
    return claimPageSlot(base);
  } catch {
    // location/localStorage 均不可用时的最终兜底
    return `page_${randomId(16)}`;
  }
}

/**
 * 从 cookie 中读取指定 key 的值
 */
function readCookie(name: string): string | undefined {
  try {
    const cookies = document.cookie.split(';');
    for (const item of cookies) {
      const [key, ...rest] = item.trim().split('=');
      if (key === name) {
        return decodeURIComponent(rest.join('='));
      }
    }
  } catch {
    // cookie 读取失败
  }
  return undefined;
}

/**
 * 获取身份标识
 * 优先级：config.identity > data-identity > data-identity-cookie
 */
export function getIdentity(configIdentity?: string, identityCookie?: string): string | undefined {
  if (configIdentity) return configIdentity;
  if (!identityCookie) return undefined;
  return readCookie(identityCookie);
}

/**
 * 构建完整的 SessionMetadata
 */
export function buildSessionMetadata(
  sessionId: SessionId,
  identity?: string,
  systemInfo?: { ua: string; url: string; title: string; platform?: string }
): SessionMetadata {
  const metadata: SessionMetadata = {
    session: sessionId,
  };

  if (identity) {
    metadata.identity = identity;
  }

  if (systemInfo) {
    metadata.device = {
      ua: systemInfo.ua,
      platform: systemInfo.platform,
    };
    metadata.page = {
      url: systemInfo.url,
      title: systemInfo.title,
    };
  }

  return metadata;
}
