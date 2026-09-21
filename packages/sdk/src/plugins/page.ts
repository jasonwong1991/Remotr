import type { Transport } from '../transport.js';
import { serialize } from '../serializer.js';
import { SDK_VERSION } from '../version.js';

/** system.info 重发防抖：resize 拖拽 / 路由切换连发时合并 */
const REFRESH_DEBOUNCE_MS = 200;

/**
 * Page 插件：上报系统信息，并处理 eval.run / page.reload 命令。
 *
 * system.info 在连接建立、视口变化、以及 SPA 路由切换（pushState / replaceState /
 * popstate / hashchange）时重发，保证面板顶栏的 URL / 标题跟随页面实际状态。
 */
export function installPage(transport: Transport): () => void {
  transport.onConnected(() => sendSystemInfo(transport));

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = (): void => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      sendSystemInfo(transport);
    }, REFRESH_DEBOUNCE_MS);
  };

  window.addEventListener('resize', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  const restoreHistory = hookHistory(scheduleRefresh);

  transport.onCommand('eval.run', (data) => {
    const { code } = data as { code: string };
    try {
      // 间接 eval，在全局作用域执行
      const result = (0, eval)(code);
      return { result: serialize(result) };
    } catch (err) {
      return { result: serialize(err) };
    }
  });

  transport.onCommand('page.reload', (data) => {
    const { hard } = (data as { hard?: boolean }) ?? {};
    // hard 在现代浏览器已无差异，统一 reload
    void hard;
    setTimeout(() => location.reload(), 50);
    return { ok: true };
  });

  return () => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    window.removeEventListener('resize', scheduleRefresh);
    window.removeEventListener('popstate', scheduleRefresh);
    window.removeEventListener('hashchange', scheduleRefresh);
    restoreHistory();
  };
}

/**
 * 包装 history.pushState / replaceState：SPA 路由切换不触发任何 DOM 事件，
 * 只能在这两个入口旁听。先透传再通知，异常照常传播。返回还原函数。
 */
function hookHistory(onChange: () => void): () => void {
  const h = window.history;
  if (!h || typeof h.pushState !== 'function') return () => {};
  const origPush = h.pushState;
  const origReplace = h.replaceState;
  try {
    h.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      const ret = origPush.apply(this, args);
      onChange();
      return ret;
    };
    h.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
      const ret = origReplace.apply(this, args);
      onChange();
      return ret;
    };
  } catch {
    return () => {};
  }
  return () => {
    try {
      h.pushState = origPush;
      h.replaceState = origReplace;
    } catch {
      /* best-effort */
    }
  };
}

function sendSystemInfo(transport: Transport): void {
  try {
    transport.send('system.info', {
      ua: navigator.userAgent,
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      framework: detectFramework(),
      sdkVersion: SDK_VERSION,
    });
  } catch {
    /* ignore */
  }
}

function detectFramework(): string | undefined {
  const w = window as unknown as Record<string, unknown>;
  if (w.React || document.querySelector('[data-reactroot],#root')) return 'React';
  if (w.Vue || w.__VUE__ || document.querySelector('[data-v-app],#app')) return 'Vue';
  if (w.ng || document.querySelector('[ng-version]')) return 'Angular';
  return undefined;
}
