import type { Transport } from '../transport.js';
import { serialize } from '../serializer.js';
import { SDK_VERSION } from '../version.js';

/**
 * Page 插件：上报系统信息，并处理 eval.run / page.reload 命令。
 */
export function installPage(transport: Transport): void {
  transport.onConnected(() => sendSystemInfo(transport));

  // 视口变化时更新系统信息
  window.addEventListener('resize', () => sendSystemInfo(transport));

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
