import type { ConsoleLevel } from '@remotr/shared';
import type { Transport } from '../transport.js';
import { serialize } from '../serializer.js';

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * Console 插件：劫持 console.* 并捕获全局错误。
 * 原则：先调用原始方法（不影响开发者本地输出），再采集（同步，保证时序）。
 * 返回卸载函数：还原 console 方法、解绑全局错误监听。
 */
export function installConsole(transport: Transport): () => void {
  const c = console as unknown as Record<string, (...a: unknown[]) => void>;
  const original: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};

  for (const level of LEVELS) {
    const orig = c[level];
    if (typeof orig !== 'function') continue;
    original[level] = orig;

    c[level] = (...args: unknown[]) => {
      orig.apply(console, args);
      try {
        transport.send('console.entry', {
          level,
          args: args.map((a) => serialize(a)),
          stack: level === 'error' ? new Error().stack : undefined,
        });
      } catch {
        /* 采集失败绝不影响业务 */
      }
    };
  }

  // 全局错误捕获
  const onError = (ev: ErrorEvent): void => {
    try {
      transport.send('page.error', {
        message: ev.message,
        stack: ev.error?.stack,
        url: ev.filename,
        line: ev.lineno,
        col: ev.colno,
      });
    } catch {
      /* ignore */
    }
  };

  const onRejection = (ev: PromiseRejectionEvent): void => {
    try {
      const reason = ev.reason;
      transport.send('page.error', {
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        isPromiseRejection: true,
      });
    } catch {
      /* ignore */
    }
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    for (const level of LEVELS) {
      const orig = original[level];
      if (orig) c[level] = orig;
    }
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
