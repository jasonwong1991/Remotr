import type { Transport } from '../transport.js';
import type { ScriptInfo, SourcesFetchResult } from '@remotr/shared';
import { rawFetch } from '../internals.js';

/** SDK 内部代取用原始 fetch（network hook 安装前捕获），避免把自己的请求采集成 network 噪声 */
const doFetch: typeof fetch = rawFetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

/**
 * Sources 插件：响应调试端的 sources.* 命令，由 SDK 在页面同源上下文中
 * 代取脚本内容与 source map（绕开调试面板的跨域限制）。
 *
 * 单一职责：只做"取 + 归一"，不做 source map 解析（解析在消费端 @remotr/sourcemap，
 * 以保持注入脚本零额外依赖、体积可控）。所有失败都收敛进返回值，绝不抛出影响业务。
 */

/** content / map 单次传输体积上限，超出则截断，避免单帧过大 */
const MAX_BYTES = 8 * 1024 * 1024;

export function installSources(transport: Transport): void {
  transport.onCommand('sources.list', () => ({ scripts: listScripts() }));

  transport.onCommand('sources.fetch', (data) => {
    const { url } = data as { url: string };
    return fetchSource(url);
  });
}

/** 合并 document.scripts 与 resource timing 中的脚本资源，按 url 去重 */
function listScripts(): ScriptInfo[] {
  const urls = new Set<string>();

  for (const s of Array.from(document.scripts)) {
    if (s.src) urls.add(s.src);
  }

  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const e of entries) {
      if (e.initiatorType === 'script' && e.name) urls.add(e.name);
    }
  } catch {
    /* performance API 不可用时忽略 */
  }

  return Array.from(urls, (url) => ({ url }));
}

/** 同源代取脚本文本，并尽力取出其 source map（外链或内联 base64 均归一为 map 字符串） */
async function fetchSource(url: string): Promise<SourcesFetchResult> {
  try {
    // 静态资源（js/map）不需要 Cookie，一律 omit：避免 CORS 规范下
    // "带凭据 + ACAO:* 被拒"（TypeError: Load failed）。
    const res = await doFetch(url, { credentials: 'omit' });
    if (!res.ok) return { url, content: '', error: `HTTP ${res.status}` };

    let content = await res.text();
    let truncated = false;
    if (content.length > MAX_BYTES) {
      content = content.slice(0, MAX_BYTES);
      truncated = true;
    }

    const smURL = extractSourceMappingURL(content);
    let sourceMappingURL: string | undefined;
    let map: string | undefined;

    if (smURL) {
      if (smURL.startsWith('data:')) {
        sourceMappingURL = smURL;
        map = decodeMapDataUri(smURL);
      } else {
        try {
          const abs = new URL(smURL, url).href;
          sourceMappingURL = abs;
          const mapRes = await doFetch(abs, { credentials: 'omit' });
          if (mapRes.ok) {
            const mapText = await mapRes.text();
            if (mapText.length > MAX_BYTES) truncated = true;
            else map = mapText;
          }
        } catch {
          /* map 取不到（跨域 / 未部署）→ 降级，仅返回 content */
        }
      }
    }

    return { url, content, sourceMappingURL, map, truncated: truncated || undefined };
  } catch (err) {
    return { url, content: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/** 从脚本尾部提取 //# 或 //@ sourceMappingURL 注释值（取最后一处） */
function extractSourceMappingURL(content: string): string | null {
  const re = /\/\/[#@]\s*sourceMappingURL=(\S+)/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) last = m[1];
  return last;
}

/** 解码内联 data: URI source map（base64 或 URL 编码），UTF-8 安全 */
function decodeMapDataUri(uri: string): string | undefined {
  const comma = uri.indexOf(',');
  if (comma < 0) return undefined;
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      const bin = atob(payload);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}
