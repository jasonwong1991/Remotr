/**
 * SDK 内部原始 API 引用与调试开关。
 *
 * rawFetch 在模块加载时（任何插件 hook 安装之前）捕获，供 SDK 自身的内部请求
 * 使用，避免走被 network 插件劫持后的 window.fetch 而把自己的请求采集成噪声。
 *
 * debugLog / debugWarn 默认关闭：SDK 的诊断输出会被自己的 console hook 再采集
 * 一遍（自噪声），生产环境必须静默；start({ debug: true }) 或 data-debug 开启。
 */

export const rawFetch: typeof fetch | null =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function debugLog(...args: unknown[]): void {
  if (!debugEnabled) return;
  try {
    console.log(...args);
  } catch {
    /* ignore */
  }
}

export function debugWarn(...args: unknown[]): void {
  if (!debugEnabled) return;
  try {
    console.warn(...args);
  } catch {
    /* ignore */
  }
}
