import type { Transport } from '../transport.js';

let reqCounter = 0;
function nextId(): string {
  return `r${Date.now().toString(36)}-${(reqCounter++).toString(36)}`;
}

const MAX_BODY = 50_000;
function clampBody(s: string): string {
  return s.length > MAX_BODY ? s.slice(0, MAX_BODY) + '…[truncated]' : s;
}

function headersToRecord(h: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k] = v));
  } else {
    Object.assign(out, h);
  }
  return out;
}

/**
 * 模块级去重计数器：fetch / XHR / sendBeacon hook 在发起请求时 +1，
 * PerformanceObserver 看到同 URL 的 entry 时 -1 并跳过；计数归零或不存在
 * 时才认为是标签发起（CSS/JS/img/font…）。
 *
 * 用计数器而非 Set，是因为同一 URL 可能被业务多次请求（轮询/重试）。
 */
const pendingJsUrls = new Map<string, number>();

function markJsRequest(url: string): void {
  pendingJsUrls.set(url, (pendingJsUrls.get(url) ?? 0) + 1);
  // 兜底清理：10s 后强制 -1，避免 Observer 漏报导致计数永留
  setTimeout(() => {
    const n = pendingJsUrls.get(url) ?? 0;
    if (n <= 1) pendingJsUrls.delete(url);
    else pendingJsUrls.set(url, n - 1);
  }, 10_000);
}

function consumeJsRequest(url: string): boolean {
  const n = pendingJsUrls.get(url) ?? 0;
  if (n <= 0) return false;
  if (n === 1) pendingJsUrls.delete(url);
  else pendingJsUrls.set(url, n - 1);
  return true;
}

/**
 * Network 插件：拦截 fetch / XMLHttpRequest / sendBeacon + 监控所有资源加载。
 * 关键约束：
 *  - fetch 必须 response.clone() 后再读 body，避免消费业务侧的 body
 *  - 采集失败不能影响请求本身
 *  - 使用 PerformanceObserver 捕获标签加载（CSS/JS/图片/字体等）
 *  - JS hook 与 PerformanceObserver 通过模块级计数器去重
 */
export function installNetwork(transport: Transport): void {
  // 先装 Resource Timing，再装 JS hook：保证 hook 启动时 markJsRequest 链路已就绪
  hookResourceTiming(transport);
  hookFetch(transport);
  hookXHR(transport);
  hookBeacon(transport);
}

/**
 * 使用 PerformanceObserver 监控所有资源加载（包括 link/script/img/video/font 等）
 * 检测：缓存命中、详细时序。
 *
 * ⚠️ 不再做 CORS 启发式：跨域 no-cors 资源 / 缺失 Timing-Allow-Origin 都会
 *    返回 transferSize=0，无法可靠区分。CORS 错误统一由 fetch hook 的 catch 上报。
 */
function hookResourceTiming(transport: Transport): void {
  if (typeof PerformanceObserver === 'undefined' || typeof performance === 'undefined') {
    return;
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'resource') continue;
        const resource = entry as PerformanceResourceTiming;

        // 跳过 fetch/XHR hook 已记录的请求
        if (consumeJsRequest(resource.name)) continue;

        const reqId = nextId();
        const initiatorType = resource.initiatorType || 'other';

        // 缓存命中启发式：transferSize=0 + 有响应时间 + 有解码体积
        // 加 decodedBodySize > 0 这一条，能区分掉 no-cors 跨域（后者拿不到 size）
        const fromCache = resource.transferSize === 0
          && resource.responseStart > 0
          && resource.decodedBodySize > 0;

        try {
          transport.send('network.request', {
            reqId,
            url: resource.name,
            method: 'GET',
            headers: {},
            initiator: initiatorType,
            timing: {
              startTime: resource.startTime,
              fetchStart: resource.fetchStart,
              domainLookupStart: resource.domainLookupStart,
              domainLookupEnd: resource.domainLookupEnd,
              connectStart: resource.connectStart,
              connectEnd: resource.connectEnd,
              requestStart: resource.requestStart,
              responseStart: resource.responseStart,
              responseEnd: resource.responseEnd,
              transferSize: resource.transferSize,
              encodedBodySize: resource.encodedBodySize,
              decodedBodySize: resource.decodedBodySize,
            },
          });

          // Resource Timing API 拿不到 status；只要 responseStart>0 就视为成功
          // （真正失败的资源浏览器不会上报 entry 或 responseStart=0）
          const succeeded = resource.responseStart > 0 || resource.responseEnd > 0;
          if (succeeded) {
            transport.send('network.response', {
              reqId,
              status: 200, // 推断值；详情面板会标注 "(estimated)"
              statusText: fromCache ? '(from cache)' : '',
              headers: {},
              mimeType: inferMimeType(resource.name, initiatorType),
              duration: resource.duration,
              fromCache,
            });
          } else {
            transport.send('network.error', {
              reqId,
              error: 'Resource failed to load',
              duration: resource.duration,
              errorType: 'network',
            });
          }
        } catch {
          /* ignore */
        }
      }
    });

    observer.observe({ entryTypes: ['resource'] });
  } catch (e) {
    // 浏览器不支持时静默降级
    console.warn('[remotr] PerformanceObserver resource entries unavailable:', e);
  }
}

/**
 * 根据 URL 后缀和 initiatorType 推断 MIME 类型（Resource Timing 拿不到 Content-Type）。
 */
function inferMimeType(url: string, initiatorType: string): string | undefined {
  const lower = url.split('?')[0].toLowerCase();

  if (initiatorType === 'css' || lower.endsWith('.css')) return 'text/css';
  if (initiatorType === 'script' || /\.(m?js|cjs)$/.test(lower)) return 'application/javascript';
  if (initiatorType === 'img' || /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/.test(lower)) return 'image/*';
  if (/\.(woff2?|ttf|otf|eot)$/.test(lower)) return 'font/*';
  if (initiatorType === 'video' || /\.(mp4|webm|m4v)$/.test(lower)) return 'video/*';
  if (initiatorType === 'audio' || /\.(mp3|wav|m4a|flac|aac)$/.test(lower)) return 'audio/*';
  // .ogg 既可能是音频也可能是视频，保守不猜

  return undefined;
}

/** 根据错误信息分类 fetch/XHR 抛出的错误 */
function classifyError(msg: string): 'network' | 'cors' | 'timeout' | 'abort' | 'unknown' {
  if (/cors|cross-origin/i.test(msg)) return 'cors';
  if (/timeout/i.test(msg)) return 'timeout';
  if (/abort/i.test(msg)) return 'abort';
  if (/network|failed to fetch/i.test(msg)) return 'network';
  return 'unknown';
}

function hookFetch(transport: Transport): void {
  if (typeof window.fetch !== 'function') return;
  const origFetch = window.fetch.bind(window);

  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const reqId = nextId();
    const start = Date.now();

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const reqHeaders = init?.headers
      ? headersToRecord(new Headers(init.headers))
      : input instanceof Request
        ? headersToRecord(input.headers)
        : {};

    // 标记此 URL 已由 JS 发起，避免 PerformanceObserver 重复上报
    markJsRequest(url);

    try {
      transport.send('network.request', {
        reqId,
        url,
        method,
        headers: reqHeaders,
        body: typeof init?.body === 'string' ? clampBody(init.body) : undefined,
        initiator: 'fetch',
      });
    } catch {
      /* ignore */
    }

    try {
      const res = await origFetch(input, init);
      const clone = res.clone();
      clone
        .text()
        .then((text) => {
          transport.send('network.response', {
            reqId,
            status: res.status,
            statusText: res.statusText,
            headers: headersToRecord(res.headers),
            body: clampBody(text),
            mimeType: res.headers.get('content-type') ?? undefined,
            duration: Date.now() - start,
          });
        })
        .catch(() => {
          transport.send('network.response', {
            reqId,
            status: res.status,
            statusText: res.statusText,
            headers: headersToRecord(res.headers),
            duration: Date.now() - start,
          });
        });
      return res;
    } catch (err) {
      try {
        const errorMsg = String(err);
        transport.send('network.error', {
          reqId,
          error: errorMsg,
          duration: Date.now() - start,
          errorType: classifyError(errorMsg),
        });
      } catch {
        /* ignore */
      }
      throw err;
    }
  };
}

interface XHRMeta {
  reqId: string;
  method: string;
  url: string;
  start: number;
  reqHeaders: Record<string, string>;
  body?: string;
}

function hookXHR(transport: Transport): void {
  const XHR = window.XMLHttpRequest;
  if (!XHR) return;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;
  const origSetHeader = XHR.prototype.setRequestHeader;
  const META = new WeakMap<XMLHttpRequest, XHRMeta>();

  XHR.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    META.set(this, {
      reqId: nextId(),
      method: method.toUpperCase(),
      url: typeof url === 'string' ? url : url.href,
      start: 0,
      reqHeaders: {},
    });
    // @ts-expect-error 透传剩余参数
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.prototype.setRequestHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    const meta = META.get(this);
    if (meta) meta.reqHeaders[name] = value;
    return origSetHeader.call(this, name, value);
  };

  XHR.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = META.get(this);
    if (meta) {
      meta.start = Date.now();
      if (typeof body === 'string') meta.body = clampBody(body);

      markJsRequest(meta.url);

      try {
        transport.send('network.request', {
          reqId: meta.reqId,
          url: meta.url,
          method: meta.method,
          headers: meta.reqHeaders,
          body: meta.body,
          initiator: 'xhr',
        });
      } catch {
        /* ignore */
      }

      // 主动 abort 标记
      let aborted = false;
      this.addEventListener('abort', () => { aborted = true; });

      this.addEventListener('loadend', () => {
        try {
          const duration = Date.now() - meta.start;
          if (this.status === 0) {
            // status=0 + abort 事件：用户主动取消
            // status=0 + 无 abort：网络错误或 CORS（无法可靠区分，统一标 network）
            transport.send('network.error', {
              reqId: meta.reqId,
              error: aborted ? 'Request aborted' : 'Network error',
              duration,
              errorType: aborted ? 'abort' : 'network',
            });
            return;
          }
          transport.send('network.response', {
            reqId: meta.reqId,
            status: this.status,
            statusText: this.statusText,
            headers: parseRawHeaders(this.getAllResponseHeaders()),
            body: readXHRBody(this),
            mimeType: this.getResponseHeader('content-type') ?? undefined,
            duration,
          });
        } catch {
          /* ignore */
        }
      });
    }
    return origSend.call(this, body ?? null);
  };
}

function readXHRBody(xhr: XMLHttpRequest): string | undefined {
  try {
    if (xhr.responseType === '' || xhr.responseType === 'text') {
      return clampBody(xhr.responseText);
    }
    if (xhr.responseType === 'json') {
      return clampBody(JSON.stringify(xhr.response));
    }
    return `[${xhr.responseType}]`;
  } catch {
    return undefined;
  }
}

function parseRawHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function hookBeacon(transport: Transport): void {
  const nav = navigator as Navigator & {
    sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean;
  };
  if (typeof nav.sendBeacon !== 'function') return;
  const orig = nav.sendBeacon.bind(nav);

  nav.sendBeacon = function (url: string | URL, data?: BodyInit | null): boolean {
    const reqId = nextId();
    const urlStr = typeof url === 'string' ? url : url.href;

    markJsRequest(urlStr);

    try {
      transport.send('network.request', {
        reqId,
        url: urlStr,
        method: 'POST',
        headers: {},
        body: typeof data === 'string' ? clampBody(data) : data ? '[binary]' : undefined,
        initiator: 'beacon',
      });
    } catch {
      /* ignore */
    }
    return orig(url, data);
  };
}
