import type { ConsoleLevel } from '@remotr/shared';
import type { Transport } from '../transport.js';
import { serialize } from '../serializer.js';

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * Console 插件：劫持 console.* 并捕获全局错误。
 * 原则：先调用原始方法（不影响开发者本地输出），再采集（同步，保证时序）。
 */
export function installConsole(transport: Transport): void {
  const original: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};

  for (const level of LEVELS) {
    const orig = (console as unknown as Record<string, (...a: unknown[]) => void>)[level];
    if (typeof orig !== 'function') continue;
    original[level] = orig.bind(console);

    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = (
      ...args: unknown[]
    ) => {
      original[level]?.(...args);
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
  window.addEventListener('error', (ev: ErrorEvent) => {
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
  });

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
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
  });
}
