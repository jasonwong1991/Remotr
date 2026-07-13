import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installPerformance } from '../performance.js';
import type { Transport } from '../../transport.js';

/**
 * 用可控 stub 替换 PerformanceObserver / performance.memory / requestAnimationFrame,
 * 验证插件的特性探测、事件上报与卸载后静默(stopped 守卫 + observer 断开)。
 */

interface FakeEntry {
  name?: string;
  startTime?: number;
  duration?: number;
  responseStart?: number;
  value?: number;
  hadRecentInput?: boolean;
  renderTime?: number;
}

class FakePerformanceObserver {
  static instances: FakePerformanceObserver[] = [];
  static supportedEntryTypes: string[] = [];
  cb: (list: { getEntries: () => FakeEntry[] }) => void;
  observed: unknown[] = [];
  disconnected = false;
  constructor(cb: (list: { getEntries: () => FakeEntry[] }) => void) {
    this.cb = cb;
    FakePerformanceObserver.instances.push(this);
  }
  observe(opts: unknown): void {
    this.observed.push(opts);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  emit(entries: FakeEntry[]): void {
    this.cb({ getEntries: () => entries });
  }
}

function makeTransport(): { transport: Transport; sent: Array<{ method: string; data: any }> } {
  const sent: Array<{ method: string; data: any }> = [];
  const transport = {
    send: vi.fn((method: string, data: unknown) => {
      sent.push({ method, data: data as any });
    }),
  } as unknown as Transport;
  return { transport, sent };
}

describe('installPerformance', () => {
  let origPO: typeof PerformanceObserver | undefined;
  let origRAF: typeof requestAnimationFrame | undefined;
  let origCAF: typeof cancelAnimationFrame | undefined;

  beforeEach(() => {
    FakePerformanceObserver.instances = [];
    origPO = (globalThis as any).PerformanceObserver;
    origRAF = (globalThis as any).requestAnimationFrame;
    origCAF = (globalThis as any).cancelAnimationFrame;
    (globalThis as any).PerformanceObserver = FakePerformanceObserver;
    // rAF/cAF 设为惰性 stub:避免 FPS 计帧在测试里自循环
    (globalThis as any).requestAnimationFrame = vi.fn(() => 1);
    (globalThis as any).cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    (globalThis as any).PerformanceObserver = origPO;
    (globalThis as any).requestAnimationFrame = origRAF;
    (globalThis as any).cancelAnimationFrame = origCAF;
    delete (performance as any).memory;
    vi.useRealTimers();
  });

  it('returns an uninstall function and registers one observer per entry type', () => {
    const { transport } = makeTransport();
    const uninstall = installPerformance(transport);
    expect(typeof uninstall).toBe('function');
    // paint / largest-contentful-paint / layout-shift / longtask
    expect(FakePerformanceObserver.instances.length).toBe(4);
    uninstall();
  });

  it('reports FCP from a first-contentful-paint entry with a rating', () => {
    const { transport, sent } = makeTransport();
    const uninstall = installPerformance(transport);
    FakePerformanceObserver.instances[0].emit([{ name: 'first-contentful-paint', startTime: 1000 }]);
    const vital = sent.find((e) => e.method === 'perf.vital' && e.data.name === 'FCP');
    expect(vital).toBeDefined();
    expect(vital!.data.value).toBe(1000);
    expect(vital!.data.rating).toBe('good'); // 1000ms ≤ 1800ms
    uninstall();
  });

  it('accumulates CLS excluding entries with recent input', () => {
    const { transport, sent } = makeTransport();
    const uninstall = installPerformance(transport);
    const cls = FakePerformanceObserver.instances[2];
    cls.emit([{ value: 0.05, hadRecentInput: false }, { value: 0.5, hadRecentInput: true }]);
    cls.emit([{ value: 0.03, hadRecentInput: false }]);
    const vitals = sent.filter((e) => e.method === 'perf.vital' && e.data.name === 'CLS');
    // 只累加非用户输入引起的位移:0.05 → 0.08
    expect(vitals[vitals.length - 1].data.value).toBeCloseTo(0.08, 5);
    uninstall();
  });

  it('reports long tasks', () => {
    const { transport, sent } = makeTransport();
    const uninstall = installPerformance(transport);
    FakePerformanceObserver.instances[3].emit([{ startTime: 500, duration: 120 }]);
    const lt = sent.find((e) => e.method === 'perf.longtask');
    expect(lt!.data.startTime).toBe(500);
    expect(lt!.data.duration).toBe(120);
    uninstall();
  });

  it('samples JS heap on an interval when performance.memory exists', () => {
    vi.useFakeTimers();
    (performance as any).memory = {
      usedJSHeapSize: 1000,
      totalJSHeapSize: 2000,
      jsHeapSizeLimit: 4000,
    };
    const { transport, sent } = makeTransport();
    const uninstall = installPerformance(transport);
    vi.advanceTimersByTime(2000);
    const mem = sent.find((e) => e.method === 'perf.memory');
    expect(mem!.data.usedJSHeapSize).toBe(1000);
    expect(mem!.data.jsHeapSizeLimit).toBe(4000);
    uninstall();
  });

  it('stops reporting after uninstall and disconnects observers', () => {
    const { transport, sent } = makeTransport();
    const uninstall = installPerformance(transport);
    const paint = FakePerformanceObserver.instances[0];
    uninstall();
    expect(paint.disconnected).toBe(true);
    // 卸载后回调进来也不再上报(stopped 守卫)
    paint.emit([{ name: 'first-contentful-paint', startTime: 1000 }]);
    expect(sent.filter((e) => e.method === 'perf.vital')).toEqual([]);
  });

  it('degrades gracefully when PerformanceObserver is unavailable', () => {
    delete (globalThis as any).PerformanceObserver;
    const { transport } = makeTransport();
    expect(() => {
      const uninstall = installPerformance(transport);
      uninstall();
    }).not.toThrow();
  });
});
