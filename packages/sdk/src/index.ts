import { Transport } from './transport.js';
import { installConsole } from './plugins/console.js';
import { installNetwork } from './plugins/network.js';
import { installStorage } from './plugins/storage.js';
import { installPage } from './plugins/page.js';
import { installSources } from './plugins/sources.js';
import { installRrweb } from './plugins/rrweb.js';
import { installElements } from './plugins/elements.js';
import { SDK_VERSION } from './version.js';
import { getDeviceId, getPageId, getIdentity } from './session.js';
import type { SessionId } from '@remotr/shared';

export interface REMOTRConfig {
  /** 服务端地址，如 http://localhost:9777。默认从注入脚本的 src 推断 */
  server?: string;
  /** 房间 ID，默认 'default' */
  room?: string;
  /** 是否启用页面镜像（rrweb），默认 true */
  mirror?: boolean;
  /** 设备 ID，默认自动生成并持久化到 localStorage */
  deviceId?: string;
  /** 页面 ID，默认由 URL 指纹确定性生成（同页面退出重进保持同一 session） */
  pageId?: string;
  /** 身份标识，例如用户名 */
  identity?: string;
  /** 从 cookie 中读取身份标识的 key */
  identityCookie?: string;
}

let started = false;

/**
 * 启动 SDK。可通过 REMOTR.start(config) 手动调用，
 * 或注入脚本时自动从 <script> 标签的 data-* 属性读取配置启动。
 */
export function start(config: REMOTRConfig = {}): void {
  if (started) return;
  started = true;

  const server = config.server || inferServer();
  const room = config.room || 'default';
  const mirror = config.mirror !== false;

  // 生成或读取 session 标识
  const deviceId = getDeviceId(config.deviceId);
  const pageId = getPageId(config.pageId);
  const identity = getIdentity(config.identity, config.identityCookie);

  const sessionId: SessionId = { deviceId, pageId };

  const transport = new Transport(server, room, sessionId, identity);

  // 采集插件按职责拆分，互不依赖（SOLID: 单一职责 + 开闭）
  installConsole(transport);
  installNetwork(transport);
  installStorage(transport);
  installPage(transport);
  installSources(transport);
  if (mirror) installRrweb(transport);
  installElements(transport);

  transport.connect();

  console.log(
    `%c[remotr]%c v${SDK_VERSION} connected → ${server} (room: ${room}, device: ${deviceId.slice(0, 12)}..., page: ${pageId.slice(0, 12)}...)`,
    'color:#4caf50;font-weight:bold',
    'color:inherit',
  );
}

/** 从当前注入脚本的 src 推断服务端地址 */
function inferServer(): string {
  const script =
    (document.currentScript as HTMLScriptElement | null) ||
    document.querySelector<HTMLScriptElement>('script[src*="remotr.js"]');
  if (script?.src) {
    try {
      const u = new URL(script.src);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  return `${location.protocol}//${location.host}`;
}

/** 读取注入脚本 data-* 属性，自动启动 */
function autoStart(): void {
  const script =
    (document.currentScript as HTMLScriptElement | null) ||
    document.querySelector<HTMLScriptElement>('script[src*="remotr.js"]');
  if (!script) return;

  const room = script.getAttribute('data-room') || undefined;
  const server = script.getAttribute('data-server') || undefined;
  const mirror = script.getAttribute('data-mirror') !== 'false';
  const deviceId = script.getAttribute('data-device-id') || undefined;
  const pageId = script.getAttribute('data-page-id') || undefined;
  const identity = script.getAttribute('data-identity') || undefined;
  const identityCookie = script.getAttribute('data-identity-cookie') || undefined;

  // 有 data-room 或 data-server 时视为自动启动模式
  if (script.hasAttribute('data-room') || script.hasAttribute('data-server') || script.hasAttribute('data-auto')) {
    start({ room, server, mirror, deviceId, pageId, identity, identityCookie });
  }
}

autoStart();

export { SDK_VERSION };
