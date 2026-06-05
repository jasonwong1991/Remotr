import { record } from 'rrweb';
import type { Transport } from '../transport.js';

// Store rrweb mirror for ID mapping
let _mirror: any | null = null;

/**
 * Get the rrweb mirror instance for node ID lookups.
 * Returns null if rrweb has not been initialized yet.
 */
export function getMirror(): any | null {
  return _mirror;
}

/**
 * rrweb 插件：录制 DOM 全量+增量快照，透传给调试端做页面镜像。
 * 采样节流以控制带宽；定期 checkout 保证延迟接入的调试端可重建。
 */
export function installRrweb(transport: Transport): void {
  try {
    const stopFn = record({
      emit(event, isCheckout) {
        try {
          transport.send('dom.rrweb', { event, isCheckout });
      } catch {
          /* ignore */
        }
      },
      sampling: {
        mousemove: 50,
        scroll: 150,
        input: 'last',
      },
      // 每 20s 强制一次全量快照，作为新调试端的重建基线
      checkoutEveryNms: 20_000,
      recordCanvas: false,
      collectFonts: false,
    });

    // Capture mirror from rrweb's record function return value
    // rrweb returns a function with mirror attached
    _mirror = (stopFn as any).mirror || null;
  } catch (err) {
    // rrweb 初始化失败不应阻断其他采集功能
    console.warn('[remotr] rrweb record failed:', err);
  }
}
