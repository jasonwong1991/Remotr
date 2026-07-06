import { record } from 'rrweb';
import type { recordOptions, eventWithTime } from 'rrweb';
import type { Transport } from '../transport.js';

/**
 * Get the rrweb mirror instance for node ID lookups.
 * The mirror is a static property on the record function.
 */
export function getMirror(): any | null {
  try {
    // Access mirror as static property on record function
    return (record as any).mirror || null;
  } catch {
    return null;
  }
}

/**
 * rrweb 插件：录制 DOM 全量+增量快照，透传给调试端做页面镜像。
 *
 * 调优说明：
 * - 保留 mousemove / scroll 采样，避免高频事件挤占带宽。
 * - 不对 DOM mutation / attribute / style 变更做额外节流，样式修改应由 rrweb 的 MutationObserver 在当前批次内尽快发出。
 * - rrweb 当前版本没有暴露“缩短 mutation batch 延迟”的配置；MutationBuffer 会在浏览器的 MutationObserver 回调里立刻 processMutations -> emit。
 * - recordAfter 仅决定何时开始录制，不影响后续 mutation flush 延迟，因此保持默认立即启动行为。
 */
export function installRrweb(transport: Transport): void {
  try {
    const options: recordOptions<eventWithTime> = {
      emit(event, isCheckout) {
        try {
          transport.send('dom.rrweb', { event, isCheckout });
        } catch {
          /* ignore */
        }
      },
      sampling: {
        // 鼠标移动非常高频，保留 50ms 采样以控制事件体积。
        mousemove: 50,
        // 滚动事件也保持节流，避免连续滚动期间产生大量增量事件。
        scroll: 150,
        // 输入框变更不要只发最后一次，减少 debugger 修改 value/className/style 等联动时的感知延迟。
        input: 'all',
      },
      // 每 20s 强制一次全量快照，作为新调试端的重建基线。
      checkoutEveryNms: 20_000,
      // 不录制 canvas，降低带宽与序列化成本。
      recordCanvas: false,
      // 不额外采集字体资源，避免引入非必要开销。
      collectFonts: false,
      // 保持默认立即开始录制；该选项只影响启动时机，不会降低后续 mutation 延迟。
      // recordAfter: undefined,
      // 保持 DOM 录制开启；不要对 attributes/style mutation 增加任何额外采样或延时。
      recordDOM: true,
    };

    record(options);
  } catch (err) {
    // rrweb 初始化失败不应阻断其他采集功能
    console.warn('[remotr] rrweb record failed:', err);
  }
}
