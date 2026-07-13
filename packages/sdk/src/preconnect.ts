/**
 * Pre-connect error ring buffer.
 *
 * 页面 boot 阶段（脚本执行到 transport 连上之前）抛出的 window.onerror /
 * unhandledrejection / console.error 会早于 console 插件的 hook 安装，此前无任何
 * 采集者 —— 这些"最早的崩溃"最有诊断价值却最容易丢失。本模块在**模块加载时**
 * （早于所有插件，与 internals.ts 的 rawFetch、session.ts 的 rawSetItem 同源思路）
 * 立即挂上全局错误监听，把错误暂存进有界环形缓冲；start() 建好 transport 后第一时
 * 间 drainPreconnect() 把它们回放进 transport 的离线队列，随首个连接一并冲刷。
 *
 * 与 console 插件的分工（避免重复采集）：环形缓冲只负责 **console 插件安装之前** 的
 * 窗口。drain 时立即卸载自己的监听并还原 console.error，把采集权交还给 console 插件
 * —— 此后错误经 console 插件正常入离线队列，不会被双采。
 */

import type { ConsoleEvent, PageErrorEvent } from '@remotr/shared';
import { serialize } from './serializer.js';
import type { Transport } from './transport.js';

/** 环形缓冲容量；超出丢弃最旧，防止未连接时内存无界增长。 */
const RING_CAP = 100;

/** 缓冲条目：复用现有 page.error / console.entry 协议事件，不新增协议方法。 */
type PreconnectEntry =
  | { method: 'page.error'; data: PageErrorEvent }
  | { method: 'console.entry'; data: ConsoleEvent };

let ring: PreconnectEntry[] = [];
let recording = false;
let installed = false;
let origConsoleError: ((...args: unknown[]) => void) | null = null;
const teardownFns: Array<() => void> = [];

function record(entry: PreconnectEntry): void {
  if (!recording) return;
  ring.push(entry);
  if (ring.length > RING_CAP) ring.shift();
}

function onError(ev: ErrorEvent): void {
  record({
    method: 'page.error',
    data: {
      message: ev.message,
      stack: ev.error?.stack,
      url: ev.filename,
      line: ev.lineno,
      col: ev.colno,
    },
  });
}

function onRejection(ev: PromiseRejectionEvent): void {
  const reason = ev.reason;
  record({
    method: 'page.error',
    data: {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      isPromiseRejection: true,
    },
  });
}

/**
 * 安装 pre-connect 采集。幂等；模块加载时自动调用（见文件末尾），也可显式调用。
 * 每步独立 try/catch —— 敌意/老旧 WebView 下任一 API 缺失都不能阻断其余采集。
 */
export function installPreconnectCapture(): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  installed = true;
  recording = true;

  try {
    window.addEventListener('error', onError);
    teardownFns.push(() => window.removeEventListener('error', onError));
  } catch {
    /* ignore */
  }

  try {
    window.addEventListener('unhandledrejection', onRejection);
    teardownFns.push(() => window.removeEventListener('unhandledrejection', onRejection));
  } catch {
    /* ignore */
  }

  try {
    const c = console as unknown as Record<string, (...a: unknown[]) => void>;
    if (typeof c.error === 'function') {
      origConsoleError = c.error.bind(console);
      c.error = (...args: unknown[]) => {
        origConsoleError?.(...args);
        record({
          method: 'console.entry',
          data: {
            level: 'error',
            args: args.map((a) => serialize(a)),
            stack: new Error().stack,
          },
        });
      };
      teardownFns.push(() => {
        if (origConsoleError) c.error = origConsoleError;
      });
    }
  } catch {
    /* ignore */
  }
}

/** 卸载采集、清空缓冲并还原被包裹的 console.error。幂等。 */
export function uninstallPreconnectCapture(): void {
  recording = false;
  ring = [];
  while (teardownFns.length) {
    const fn = teardownFns.pop();
    try {
      fn?.();
    } catch {
      /* best-effort */
    }
  }
  origConsoleError = null;
  installed = false;
}

/**
 * 把缓冲的 boot 期错误回放进 transport，然后停止采集、交接给 console 插件。
 *
 * 调用时机：start() 建好 transport、且在 installConsole 之前 —— 此刻 socket 尚未
 * 连上，send() 落入离线队列的**队首**，从而保证 boot 错误在实时流之前送达；随后
 * console 插件安装、后续错误经离线队列自然排在其后，顺序得以保持。
 */
export function drainPreconnect(transport: Transport): void {
  const entries = ring;
  ring = [];
  recording = false;
  for (const e of entries) {
    try {
      if (e.method === 'page.error') transport.send('page.error', e.data);
      else transport.send('console.entry', e.data);
    } catch {
      /* 单条回放失败不影响其余 */
    }
  }
  uninstallPreconnectCapture();
}

// 模块加载即安装：这是本模块存在的意义 —— 尽可能早地开始采集 boot 期错误。
installPreconnectCapture();
