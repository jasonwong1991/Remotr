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
 * Network 插件：拦截 fetch / XMLHttpRequest / sendBeacon + 监控所有资源加载。
 * 关键约束：
 *  - fetch 必须 response.clone() 后再读 body，避免消费业务侧的 body
 *  - 采集失败不能影响请求本身
 *  - 使用 PerformanceObserver 捕获资源加载（CSS/JS/图片/字体等）
 */
export function installNetwork(transport: Transport): void {
  hookFetch(transport);
  hookXHR(transport);
  hookBeacon(transport);
  hookResourceTiming(transport);
}

/**
 * 使用 PerformanceObserver 监控所有资源加载（包括 link/script/img/video/font 等）
 * 可以检测 CORS 失败、缓存命中、详细时序
 */
function hookResourceTiming(transport: Transport): void {
  if (typeof PerformanceObserver === 'undefined' || typeof performance === 'undefined') {
    return;
  }

  // Track URLs from JS interception to avoid duplicates
  const jsRequestUrls = new Set<string>();
  const urlTimestampMap = new Map<string, number>();

  // Helper to mark JS-initiated requests
  (window as any).__remotr_markJsRequest = (url: string) => {
    jsRequestUrls.add(url);
    urlTimestampMap.set(url, Date.now());
    // Auto-cleanup after 10s
    setTimeout(() => {
      jsRequestUrls.delete(url);
      urlTimestampMap.delete(url);
    }, 10_000);
  };

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'resource') continue;
        const resource = entry as PerformanceResourceTiming;

        // Skip if already captured by fetch/XHR hooks
        const isDuplicate = jsRequestUrls.has(resource.name);
        if (isDuplicate) {
          jsRequestUrls.delete(resource.name);
          continue;
        }

        const reqId = nextId();
        const initiatorType = resource.initiatorType || 'other';

        // Detect CORS blocking: transferSize=0 && responseStart=0 (not from cache)
        const corsBlocked = resource.transferSize === 0 && resource.responseStart === 0 && resource.fetchStart > 0;

        // Detect cache hit: transferSize=0 && responseStart>0
        const fromCache = resource.transferSize === 0 && resource.responseStart > 0;

        try {
          // Send request event
          transport.send('network.request', {
            reqId,
            url: resource.name,
            method: 'GET',
            headers: {},
            initiator: initiatorType as any,
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

          // Send response or error event
          if (corsBlocked) {
            transport.send('network.error', {
              reqId,
              error: 'CORS policy: No \'Access-Control-Allow-Origin\' header is present',
              duration: resource.duration,
              errorType: 'cors',
            });
          } else {
            // Estimate status from timing (not available in Resource Timing API)
            const status = resource.responseStart > 0 ? 200 : 0;
            transport.send('network.response', {
              reqId,
              status,
              statusText: fromCache ? 'OK (cached)' : status === 200 ? 'OK' : '',
              headers: {},
              mimeType: inferMimeType(resource.name, initiatorType),
              duration: resource.duration,
              fromCache,
              corsBlocked,
            });
          }
        } catch (e) {
          // Ignore send errors
        }
      }
    });

    observer.observe({ entryTypes: ['resource'] });
  } catch (e) {
    console.warn('[remotr] PerformanceObserver not supported:', e);
  }
}

/**
 * Infer MIME type from URL and initiator type
 */
function inferMimeType(url: string, initiatorType: string): string | undefined {
  const lower = url.toLowerCase();

  if (initiatorType === 'css' || lower.endsWith('.css')) return 'text/css';
  if (initiatorType === 'script' || lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
  if (initiatorType === 'img' || /\.(png|jpg|jpeg|gif|svg|webp|ico)/.test(lower)) return 'image/*';
  if (/\.(woff2?|ttf|otf|eot)/.test(lower)) return 'font/*';
  if (/\.(mp4|webm|ogg)/.test(lower)) return 'video/*';
  if (/\.(mp3|wav|m4a)/.test(lower)) return 'audio/*';

  return undefined;
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

    // Mark this URL as JS-initiated to avoid duplicate in PerformanceObserver
    if ((window as any).__remotr_markJsRequest) {
      (window as any).__remotr_markJsRequest(url);
    }

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
        let errorType: 'network' | 'cors' | 'timeout' | 'abort' | 'unknown' = 'unknown';

        if (/cors|cross-origin/i.test(errorMsg)) errorType = 'cors';
        else if (/timeout/i.test(errorMsg)) errorType = 'timeout';
        else if (/abort/i.test(errorMsg)) errorType = 'abort';
        else if (/network|failed to fetch/i.test(errorMsg)) errorType = 'network';

        transport.send('network.error', {
          reqId,
          error: errorMsg,
          duration: Date.now() - start,
          errorType,
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
    const urlStr = typeof url === 'string' ? url : url.href;
    META.set(this, {
      reqId: nextId(),
      method: method.toUpperCase(),
      url: urlStr,
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

      // Mark as JS-initiated
      if ((window as any).__remotr_markJsRequest) {
        (window as any).__remotr_markJsRequest(meta.url);
      }

      try {
        transport.send('network.request', {
          reqId: meta.reqId,
          url: meta.url,
          method: meta.method,
          headers: meta.reqHeaders,
          body: meta.body,
          initiator: 'xmlhttprequest',
        });
      } catch {
        /* ignore */
      }

      this.addEventListener('loadend', () => {
        try {
          const duration = Date.now() - meta.start;
          if (this.status === 0) {
            const errorMsg = 'Network error / aborted';
            let errorType: 'network' | 'cors' | 'abort' | 'unknown' = 'network';

            // Try to determine if it's CORS or abort
            if (this.readyState === 4) errorType = 'cors';
            else if (this.readyState === 0) errorType = 'abort';

            transport.send('network.error', {
              reqId: meta.reqId,
              error: errorMsg,
              duration,
              errorType,
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

    if ((window as any).__remotr_markJsRequest) {
      (window as any).__remotr_markJsRequest(urlStr);
    }

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
