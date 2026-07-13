import type { WebVitalName, WebVitalRating } from '@remotr/shared';
import type { Transport } from '../transport.js';
import { debugWarn } from '../internals.js';

/**
 * Performance 插件:采样上报 Web Vitals / 长任务 / JS 堆 / FPS。
 *
 * 铁律:注入到老旧/敌意页面(Android 8 ≈ Chrome 58)。这里用到的
 * PerformanceObserver、`layout-shift`/`largest-contentful-paint`/`longtask`
 * entryType、`{buffered:true}`、performance.memory 均晚于 Chrome 58 —— 每个
 * 能力独立特性探测 + try/catch,任一缺失只静默降级,绝不破坏宿主页面。
 *
 * 全部为单向事件(SDK → 调试端),无命令。install 返回 uninstall:断开全部 observer、
 * 清定时器、取消 rAF,并置 stopped 位,保证卸载后任何异步回调都不再上报。
 */

/** Google Web Vitals 阈值 [good 上界, needs-improvement 上界];超出即 poor。 */
const THRESHOLDS: Record<WebVitalName, [number, number]> = {
  FCP: [1800, 3000],
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
};

function rate(name: WebVitalName, value: number): WebVitalRating {
  const [good, ni] = THRESHOLDS[name];
  if (value <= good) return 'good';
  if (value <= ni) return 'needs-improvement';
  return 'poor';
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/** JS 堆采样间隔 */
const MEMORY_INTERVAL_MS = 2000;
/** FPS 估算窗口 */
const FPS_WINDOW_MS = 1000;

export function installPerformance(transport: Transport): () => void {
  let stopped = false;
  const observers: PerformanceObserver[] = [];
  let memoryTimer: ReturnType<typeof setInterval> | null = null;
  let rafId: number | null = null;

  const sendVital = (name: WebVitalName, value: number): void => {
    if (stopped) return;
    try {
      transport.send('perf.vital', { name, value, rating: rate(name, value) });
    } catch {
      /* ignore */
    }
  };

  /**
   * 为单个 entryType 建立 observer:优先 `{type,buffered:true}`(可拿到订阅前已产生的
   * 条目,如插件晚于首屏绘制才安装),不支持时回退 `{entryTypes}`,再不支持则整体降级。
   */
  const observe = (
    type: string,
    cb: (entries: PerformanceEntryList) => void,
  ): void => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const observer = new PerformanceObserver((list) => {
        if (stopped) return;
        try {
          cb(list.getEntries());
        } catch {
          /* 采集失败绝不影响页面 */
        }
      });
      try {
        observer.observe({ type, buffered: true } as PerformanceObserverInit);
      } catch {
        observer.observe({ entryTypes: [type] });
      }
      observers.push(observer);
    } catch (e) {
      debugWarn('[remotr] perf observer unavailable:', type, e);
    }
  };

  // ── FCP:paint 条目中的 first-contentful-paint ──
  observe('paint', (entries) => {
    for (const e of entries) {
      if (e.name === 'first-contentful-paint') sendVital('FCP', e.startTime);
    }
  });

  // ── LCP:保留最新一次(标准语义为页面生命周期内最大;此处持续刷新最新值) ──
  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1] as
      | (PerformanceEntry & { renderTime?: number; loadTime?: number })
      | undefined;
    if (last) sendVital('LCP', last.renderTime || last.loadTime || last.startTime);
  });

  // ── CLS:累加 layout-shift,排除近期有用户输入的位移(hadRecentInput) ──
  let clsValue = 0;
  observe('layout-shift', (entries) => {
    let changed = false;
    for (const e of entries) {
      const ls = e as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (!ls.hadRecentInput) {
        clsValue += ls.value || 0;
        changed = true;
      }
    }
    if (changed) sendVital('CLS', clsValue);
  });

  // ── TTFB:navigation 条目的 responseStart(安装时同步读取已缓冲条目) ──
  try {
    if (
      typeof performance !== 'undefined' &&
      typeof performance.getEntriesByType === 'function'
    ) {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav && typeof nav.responseStart === 'number' && nav.responseStart > 0) {
        sendVital('TTFB', nav.responseStart);
      }
    }
  } catch {
    /* ignore */
  }

  // ── 长任务(≥50ms 阻塞主线程) ──
  observe('longtask', (entries) => {
    for (const e of entries) {
      try {
        transport.send('perf.longtask', { startTime: e.startTime, duration: e.duration });
      } catch {
        /* ignore */
      }
    }
  });

  // ── 周期性 JS 堆采样(仅 Chromium 系有 performance.memory) ──
  const hasMemory =
    typeof performance !== 'undefined' &&
    !!(performance as Performance & { memory?: unknown }).memory;
  if (hasMemory) {
    memoryTimer = setInterval(() => {
      if (stopped) return;
      try {
        const m = (
          performance as Performance & {
            memory?: {
              usedJSHeapSize: number;
              totalJSHeapSize: number;
              jsHeapSizeLimit: number;
            };
          }
        ).memory;
        if (!m) return;
        transport.send('perf.memory', {
          usedJSHeapSize: m.usedJSHeapSize,
          totalJSHeapSize: m.totalJSHeapSize,
          jsHeapSizeLimit: m.jsHeapSizeLimit,
          timestamp: Date.now(),
        });
      } catch {
        /* ignore */
      }
    }, MEMORY_INTERVAL_MS);
  }

  // ── FPS:rAF 计帧,每窗口结算一次 ──
  if (typeof requestAnimationFrame === 'function') {
    let frames = 0;
    let windowStart = now();
    const tick = (): void => {
      if (stopped) return;
      frames++;
      const t = now();
      const elapsed = t - windowStart;
      if (elapsed >= FPS_WINDOW_MS) {
        const fps = Math.round((frames * 1000) / elapsed);
        try {
          transport.send('perf.fps', { value: fps, timestamp: Date.now() });
        } catch {
          /* ignore */
        }
        frames = 0;
        windowStart = t;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  return function uninstall(): void {
    stopped = true;
    for (const o of observers) {
      try {
        o.disconnect();
      } catch {
        /* best-effort */
      }
    }
    observers.length = 0;
    if (memoryTimer !== null) {
      try {
        clearInterval(memoryTimer);
      } catch {
        /* best-effort */
      }
      memoryTimer = null;
    }
    if (rafId !== null) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      } catch {
        /* best-effort */
      }
      rafId = null;
    }
  };
}
