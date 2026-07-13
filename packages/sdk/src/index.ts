// preconnect 必须最先 import：其模块加载副作用（安装 boot 期错误环形缓冲）越早越好。
import { drainPreconnect, uninstallPreconnectCapture } from './preconnect.js';
import { Transport } from './transport.js';
import { installConsole } from './plugins/console.js';
import { installNetwork } from './plugins/network.js';
import { installWsCapture } from './plugins/ws-capture.js';
import { installStorage } from './plugins/storage.js';
import { installPage } from './plugins/page.js';
import { installSources } from './plugins/sources.js';
import { installRrweb } from './plugins/rrweb.js';
import { installElements } from './plugins/elements.js';
import { installTrace } from './plugins/trace.js';
import { installFramework } from './plugins/framework.js';
import { installPerformance } from './plugins/performance.js';
import { SDK_VERSION } from './version.js';
import { getDeviceId, getPageId, getIdentity, stopSession } from './session.js';
import { setDebug, debugLog } from './internals.js';
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
  /** 是否输出 SDK 内部诊断日志（会被 console 插件再采集，生产默认关闭） */
  debug?: boolean;
}

let started = false;
/** start() 装配的运行时句柄，供 stop()/destroy() 拆卸。 */
let runtime: { transport: Transport; uninstalls: Array<() => void> } | null = null;

/**
 * 启动 SDK。可通过 REMOTR.start(config) 手动调用，
 * 或注入脚本时自动从 <script> 标签的 data-* 属性读取配置启动。
 */
export function start(config: REMOTRConfig = {}): void {
  if (started) return;
  started = true;

  if (config.debug) setDebug(true);

  const server = config.server || inferServer();
  const room = config.room || 'default';
  const mirror = config.mirror !== false;

  // 生成或读取 session 标识
  const deviceId = getDeviceId(config.deviceId);
  const pageId = getPageId(config.pageId);
  const identity = getIdentity(config.identity, config.identityCookie);

  const sessionId: SessionId = { deviceId, pageId };

  const transport = new Transport(server, room, sessionId, identity);

  // SDK 自身 transport 的 WebSocket URL 前缀，供 ws-capture 排除自采集（防回环）。
  let internalWsPrefix = '';
  try {
    const su = new URL(server);
    const wsProto = su.protocol === 'https:' ? 'wss:' : 'ws:';
    internalWsPrefix = `${wsProto}//${su.host}/ws`;
  } catch {
    /* server 非法 URL 时留空，ws-capture 不做排除（transport 也连不上） */
  }

  // 采集插件按职责拆分，互不依赖（SOLID: 单一职责 + 开闭）。
  // 返回 uninstall 的插件收集起来供 stop() 拆卸；其余尽力而为。
  const uninstalls: Array<() => void> = [];
  const collect = (fn: void | (() => void)): void => {
    if (typeof fn === 'function') uninstalls.push(fn);
  };

  // 回放 boot 期错误环形缓冲：此刻 socket 未连上，条目落入离线队列队首，先于实时
  // 流送达；drain 内部随即卸载 pre-connect 采集，交接给下面的 console 插件（不双采）。
  drainPreconnect(transport);

  collect(installConsole(transport));
  collect(installNetwork(transport));
  collect(installWsCapture(transport, internalWsPrefix));
  collect(installStorage(transport));
  collect(installPage(transport));
  collect(installSources(transport));
  if (mirror) collect(installRrweb(transport));
  collect(installElements(transport));
  collect(installFramework(transport));
  collect(installTrace(transport));
  collect(installPerformance(transport));

  transport.connect();

  runtime = { transport, uninstalls };

  debugLog(
    `%c[remotr]%c v${SDK_VERSION} connected → ${server} (room: ${room}, device: ${deviceId.slice(0, 12)}..., page: ${pageId.slice(0, 12)}...)`,
    'color:#4caf50;font-weight:bold',
    'color:inherit',
  );
}

/**
 * 停止 SDK：断开连接、还原被劫持的全局、解绑监听、清定时器。
 * 尽力而为：单个拆卸失败不阻断其余。幂等。
 */
export function stop(): void {
  if (!started) return;
  started = false;

  // 正常路径下 drainPreconnect 已卸载 boot 期采集；此处幂等兜底（防御异常路径）。
  try {
    uninstallPreconnectCapture();
  } catch {
    /* best-effort */
  }

  if (runtime) {
    for (const uninstall of runtime.uninstalls) {
      try {
        uninstall();
      } catch {
        /* best-effort */
      }
    }
    try {
      runtime.transport.close();
    } catch {
      /* best-effort */
    }
    runtime = null;
  }

  try {
    stopSession();
  } catch {
    /* best-effort */
  }
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
  const debug = script.hasAttribute('data-debug');

  // 有 data-room 或 data-server 时视为自动启动模式
  if (script.hasAttribute('data-room') || script.hasAttribute('data-server') || script.hasAttribute('data-auto')) {
    start({ room, server, mirror, deviceId, pageId, identity, identityCookie, debug });
  }
}

autoStart();

/** destroy() 是 stop() 的别名（对齐常见 SDK 生命周期命名）。 */
export const destroy = stop;

export { SDK_VERSION };
