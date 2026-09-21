import type { Transport } from '../transport.js';
import { debugWarn } from '../internals.js';

let reqCounter = 0;
function nextId(): string {
  return `r${Date.now().toString(36)}-${(reqCounter++).toString(36)}`;
}

const MAX_BODY = 50_000;
/**
 * fetch 响应体预览的最长等待。非 SSE 的分块流（AI 对话等）可能长时间不结束，
 * 超时后带上已读到的部分上报并停止读取，不再无限缓冲。
 */
const BODY_READ_TIMEOUT_MS = 5_000;
/**
 * Resource Timing 缓冲上限。默认仅 250 条，资源多的页面在 SDK 安装前就满了，
 * `buffered: true` 回放会漏掉更早的资源。
 */
const RESOURCE_BUFFER_SIZE = 2000;
/**
 * 标签加载失败（img/script/link onerror）与对应 Resource Timing 条目的合并窗口。
 * 两者到达顺序不定（Chrome 通常先到 timing 条目，再派发 error 事件），任一方先到
 * 都在此窗口内等另一方；超时说明对方不会来了，各自独立成一条记录。
 */
const TAG_ERROR_GRACE_MS = 1_500;

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

/** 归一为绝对 URL：Resource Timing 的 entry.name 永远是绝对地址，去重比对必须同构 */
function absoluteUrl(url: string): string {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

/** 把 fetch / XHR / beacon 的多形态请求体归一为可展示字符串 */
function describeBody(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return clampBody(body);
  try {
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return clampBody(body.toString());
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const parts: string[] = [];
      body.forEach((v, k) => {
        parts.push(`${k}=${typeof v === 'string' ? v : `[File ${v.name} ${v.size} bytes]`}`);
      });
      return clampBody(`[FormData]\n${parts.join('\n')}`);
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      return `[Blob ${body.size} bytes${body.type ? ` ${body.type}` : ''}]`;
    }
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
      return `[ArrayBuffer ${body.byteLength} bytes]`;
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
      return `[${body.constructor.name} ${body.byteLength} bytes]`;
    }
    if (typeof Document !== 'undefined' && body instanceof Document) return '[Document]';
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[ReadableStream]';
  } catch {
    /* fall through */
  }
  return '[binary]';
}

/**
 * 模块级去重计数器：fetch / XHR / sendBeacon hook 在发起请求时 +1，
 * PerformanceObserver 看到同 URL 的 entry 时 -1 并跳过；计数归零或不存在
 * 时才认为是标签发起（CSS/JS/img/font…）。
 *
 * 用计数器而非 Set，是因为同一 URL 可能被业务多次请求（轮询/重试）。
 * 键为绝对 URL（见 absoluteUrl）。
 */
const pendingJsUrls = new Map<string, number>();

function markJsRequest(url: string): void {
  const key = absoluteUrl(url);
  pendingJsUrls.set(key, (pendingJsUrls.get(key) ?? 0) + 1);
  // 兜底清理：10s 后强制 -1，避免 Observer 漏报导致计数永留
  setTimeout(() => {
    const n = pendingJsUrls.get(key) ?? 0;
    if (n <= 1) pendingJsUrls.delete(key);
    else pendingJsUrls.set(key, n - 1);
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
 *  - 使用 PerformanceObserver（buffered）捕获标签加载（CSS/JS/图片/字体等），
 *    含 SDK 安装之前已完成的资源与页面文档自身，对齐 DevTools 的 Network 视图
 *  - 标签加载失败（onerror）单独捕获，Resource Timing 不一定产出失败条目
 *  - JS hook 与 PerformanceObserver 通过模块级计数器去重
 *
 * 返回卸载函数：还原全局、断开 observer、解绑监听。
 */
export function installNetwork(transport: Transport): () => void {
  const uninstalls: Array<(() => void) | void> = [];
  // 先装 Resource Timing，再装 JS hook：保证 hook 启动时 markJsRequest 链路已就绪
  uninstalls.push(hookResourceTiming(transport));
  uninstalls.push(hookFetch(transport));
  uninstalls.push(hookXHR(transport));
  uninstalls.push(hookBeacon(transport));
  return () => {
    for (const u of uninstalls) {
      try {
        u?.();
      } catch {
        /* best-effort */
      }
    }
  };
}

/** Resource Timing 的 initiatorType 归一到面板使用的分类名 */
function normalizeInitiator(initiatorType: string): string {
  if (initiatorType === 'xmlhttprequest') return 'xhr';
  return initiatorType || 'other';
}

/** 标签加载失败的待决记录：等 Resource Timing 条目合并，超时则单独上报 */
interface TagFailure {
  tag: string;
  timer: ReturnType<typeof setTimeout>;
}

/** 刚上报过的 Resource Timing 条目：等可能随后到达的 error 事件把它改判为失败 */
interface RecentEntry {
  reqId: string;
  duration: number;
  status: number | undefined;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 使用 PerformanceObserver 监控所有资源加载（包括 link/script/img/video/font 等）
 * 检测：缓存命中、详细时序、真实状态码（Chrome 109+ responseStatus）。
 *
 * ⚠️ 不再做 CORS 启发式：跨域 no-cors 资源 / 缺失 Timing-Allow-Origin 都会
 *    返回 transferSize=0，无法可靠区分。CORS 错误统一由 fetch hook 的 catch 上报。
 */
function hookResourceTiming(transport: Transport): (() => void) | void {
  if (typeof PerformanceObserver === 'undefined' || typeof performance === 'undefined') {
    return;
  }

  const failedTags = new Map<string, TagFailure>();
  const recentEntries = new Map<string, RecentEntry>();

  /** 记住刚上报的条目一小段时间，供随后到达的 error 事件改判 */
  const remember = (url: string, reqId: string, duration: number, status: number | undefined): void => {
    const prev = recentEntries.get(url);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => recentEntries.delete(url), TAG_ERROR_GRACE_MS);
    recentEntries.set(url, { reqId, duration, status, timer });
  };

  // 标签加载失败（img/script/link/video/audio/iframe…）：error 事件不冒泡，
  // 只能在 window 的捕获阶段旁听；ev.target === window 的是脚本运行时错误，跳过。
  const onResourceError = (ev: Event): void => {
    try {
      const target = ev.target;
      if (!target || !(target instanceof Element)) return;
      const url = (target as HTMLImageElement).src || (target as HTMLLinkElement).href;
      if (!url || typeof url !== 'string') return;
      const abs = absoluteUrl(url);
      const tag = target.tagName.toLowerCase();

      // timing 条目已先到：把那条记录改判为失败（同一 reqId 追加 error），不另起一行
      const recent = recentEntries.get(abs);
      if (recent) {
        clearTimeout(recent.timer);
        recentEntries.delete(abs);
        sendTagError(transport, recent.reqId, tag, recent.status, recent.duration);
        return;
      }

      if (failedTags.has(abs)) return;
      const timer = setTimeout(() => {
        failedTags.delete(abs);
        reportTagFailure(transport, abs, tag, undefined);
      }, TAG_ERROR_GRACE_MS);
      failedTags.set(abs, { tag, timer });
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('error', onResourceError, true);

  let observer: PerformanceObserver | null = null;
  try {
    // 扩大缓冲，让 buffered 回放拿到 SDK 安装前的全部资源
    try {
      performance.setResourceTimingBufferSize?.(RESOURCE_BUFFER_SIZE);
    } catch {
      /* ignore */
    }

    // 页面文档自身：Resource Timing 不含 navigation，单独从 Navigation Timing 补一条
    reportNavigation(transport);

    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'resource') continue;
        const resource = entry as PerformanceResourceTiming;

        // 跳过 fetch/XHR hook 已记录的请求
        if (consumeJsRequest(resource.name)) continue;

        const failed = failedTags.get(resource.name);
        if (failed) {
          clearTimeout(failed.timer);
          failedTags.delete(resource.name);
          reportTagFailure(transport, resource.name, failed.tag, resource);
          continue;
        }

        const reported = reportResourceEntry(transport, resource, normalizeInitiator(resource.initiatorType));
        if (reported) remember(resource.name, reported.reqId, resource.duration, reported.status);
      }
    });

    // buffered:true 可拿到订阅前已产生的条目（SDK 常在 </body> 前注入，此前的
    // CSS/JS/图片都已加载完）；老内核不支持时回退到仅观察后续条目。
    try {
      observer.observe({ type: 'resource', buffered: true } as PerformanceObserverInit);
    } catch {
      observer.observe({ entryTypes: ['resource'] });
    }
  } catch (e) {
    // 浏览器不支持时静默降级
    debugWarn('[remotr] PerformanceObserver resource entries unavailable:', e);
  }

  return () => {
    window.removeEventListener('error', onResourceError, true);
    for (const f of failedTags.values()) clearTimeout(f.timer);
    failedTags.clear();
    for (const r of recentEntries.values()) clearTimeout(r.timer);
    recentEntries.clear();
    try {
      observer?.disconnect();
    } catch {
      /* best-effort */
    }
  };
}

/** 页面文档请求（对齐 DevTools 首行的 document 条目） */
function reportNavigation(transport: Transport): void {
  try {
    if (typeof performance.getEntriesByType !== 'function') return;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return;
    reportResourceEntry(transport, nav, 'navigation');
  } catch {
    /* ignore */
  }
}

/** Chrome 109+ 才有的字段（lib.dom 未必声明），单独声明避免整处 any */
type ResourceTimingExt = PerformanceResourceTiming & {
  responseStatus?: number;
  contentType?: string;
};

/**
 * 上报一条 Resource / Navigation Timing 条目为 request + response（或 error）。
 * Resource Timing 拿不到请求/响应头；状态码在支持 responseStatus 的内核上取真实值，
 * 否则按 200 推断并标记 statusEstimated。
 * 返回 reqId 与已知状态码（上报为 response 时），供随后的 error 事件改判；失败返回 null。
 */
function reportResourceEntry(
  transport: Transport,
  resource: PerformanceResourceTiming,
  initiator: string,
): { reqId: string; status: number | undefined } | null {
  const reqId = nextId();
  const ext = resource as ResourceTimingExt;

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
      initiator,
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

    // 跨域缺 Timing-Allow-Origin 时 responseStart 被置 0，但 responseEnd 始终可用；
    // 两者都为 0 才视为未收到响应。
    const succeeded = resource.responseStart > 0 || resource.responseEnd > 0;
    if (!succeeded) {
      transport.send('network.error', {
        reqId,
        error: 'Resource failed to load',
        duration: resource.duration,
        errorType: 'network',
      });
      return null;
    }

    // Chrome 109+：真实状态码（跨域需 TAO，否则为 0 → 退回推断）
    const realStatus =
      typeof ext.responseStatus === 'number' && ext.responseStatus > 0 ? ext.responseStatus : undefined;
    transport.send('network.response', {
      reqId,
      status: realStatus ?? 200,
      statusText: fromCache ? '(from cache)' : '',
      headers: {},
      mimeType: ext.contentType || inferMimeType(resource.name, initiator),
      duration: resource.duration,
      fromCache,
      statusEstimated: realStatus === undefined || undefined,
    });
    return { reqId, status: realStatus };
  } catch {
    return null;
  }
}

/** 给已有记录追加标签加载失败的 error（面板同一行显示状态码 + 错误徽标） */
function sendTagError(
  transport: Transport,
  reqId: string,
  tag: string,
  status: number | undefined,
  duration: number,
): void {
  try {
    transport.send('network.error', {
      reqId,
      error: status ? `Failed to load <${tag}> (HTTP ${status})` : `Failed to load <${tag}>`,
      duration,
      errorType: 'network',
    });
  } catch {
    /* ignore */
  }
}

/** 标签加载失败：有 Resource Timing 条目则带上时序与真实状态码，否则只记 URL */
function reportTagFailure(
  transport: Transport,
  url: string,
  tag: string,
  resource: PerformanceResourceTiming | undefined,
): void {
  const reqId = nextId();
  const status = (resource as ResourceTimingExt | undefined)?.responseStatus;
  try {
    transport.send('network.request', {
      reqId,
      url,
      method: 'GET',
      headers: {},
      initiator: resource ? normalizeInitiator(resource.initiatorType) : tag,
      timing: resource
        ? {
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
          }
        : undefined,
    });
  } catch {
    /* ignore */
  }
  sendTagError(transport, reqId, tag, status, resource?.duration ?? 0);
}

/**
 * 根据 URL 后缀和 initiatorType 推断 MIME 类型（Resource Timing 拿不到 Content-Type）。
 */
function inferMimeType(url: string, initiatorType: string): string | undefined {
  const lower = url.split('?')[0].toLowerCase();

  if (initiatorType === 'navigation' || initiatorType === 'iframe') return 'text/html';
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

/** 不读正文的响应类型：二进制/媒体读了也没法展示，流式 SSE 读了永不结束 */
function isOpaqueBodyType(contentType: string): boolean {
  return /^(image|video|audio|font)\//.test(contentType)
    || /octet-stream|zip|pdf|wasm|protobuf|msgpack/.test(contentType);
}

/**
 * 读取响应体预览（不消费业务侧 body）。
 *  - text/event-stream：不读（永不结束的流），只给占位
 *  - 二进制/媒体：不读，占位含类型与长度
 *  - 其余：经 clone 的流按块读取，到 MAX_BODY 即 cancel，超时也 cancel 带部分上报；
 *    没有流 API 的老内核回退 clone().text()（有 content-length 且过大时跳过）
 */
async function readBodyPreview(res: Response): Promise<string | undefined> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const lenHeader = res.headers.get('content-length');
  const length = lenHeader ? Number(lenHeader) : NaN;
  const typeLabel = contentType.split(';')[0] || 'unknown type';

  if (res.status === 204 || res.status === 304) return undefined;
  if (/text\/event-stream/.test(contentType)) return '[text/event-stream — streaming body not buffered]';
  if (isOpaqueBodyType(contentType)) {
    return `[${typeLabel}${Number.isFinite(length) ? ` ${length} bytes` : ''}]`;
  }

  const clone = res.clone();
  const body = clone.body;
  if (!body || typeof body.getReader !== 'function' || typeof TextDecoder === 'undefined') {
    if (Number.isFinite(length) && length > MAX_BODY * 100) return `[${typeLabel} ${length} bytes — too large]`;
    return clampBody(await clone.text());
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, BODY_READ_TIMEOUT_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length >= MAX_BODY) {
        reader.cancel().catch(() => {});
        return out.slice(0, MAX_BODY) + '…[truncated]';
      }
    }
    out += decoder.decode();
    return timedOut ? out + '…[stream still open after 5s, stopped reading]' : out;
  } finally {
    clearTimeout(timer);
  }
}

function hookFetch(transport: Transport): (() => void) | void {
  if (typeof window.fetch !== 'function') return;
  const rawFetch = window.fetch;
  const origFetch = rawFetch.bind(window);

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
    // Request 对象的 body 是一次性流，不能在这里读；只标注存在
    const body = init?.body != null
      ? describeBody(init.body)
      : input instanceof Request && input.body
        ? '[Request body]'
        : undefined;

    // 标记此 URL 已由 JS 发起，避免 PerformanceObserver 重复上报
    markJsRequest(url);

    try {
      transport.send('network.request', {
        reqId,
        url,
        method,
        headers: reqHeaders,
        body,
        initiator: 'fetch',
      });
    } catch {
      /* ignore */
    }

    try {
      const res = await origFetch(input, init);
      readBodyPreview(res)
        .then((text) => {
          transport.send('network.response', {
            reqId,
            status: res.status,
            statusText: res.statusText,
            headers: headersToRecord(res.headers),
            body: text,
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

  return () => {
    try {
      window.fetch = rawFetch;
    } catch {
      /* best-effort */
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
  aborted: boolean;
}

function hookXHR(transport: Transport): (() => void) | void {
  const XHR = window.XMLHttpRequest;
  if (!XHR) return;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;
  const origSetHeader = XHR.prototype.setRequestHeader;
  const META = new WeakMap<XMLHttpRequest, XHRMeta>();
  /** 已挂过 loadend/abort 监听的实例：同一 XHR 复用（多次 open/send）不重复挂 */
  const LISTENED = new WeakSet<XMLHttpRequest>();

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
      aborted: false,
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
      meta.body = describeBody(body);

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

      // 监听器每实例只挂一次，回调时按当前 META 取本次请求的元信息
      if (!LISTENED.has(this)) {
        LISTENED.add(this);
        this.addEventListener('abort', () => {
          const m = META.get(this);
          if (m) m.aborted = true;
        });
        this.addEventListener('loadend', () => {
          const m = META.get(this);
          if (!m) return;
          try {
            const duration = Date.now() - m.start;
            if (this.status === 0) {
              // status=0 + abort 事件：用户主动取消
              // status=0 + 无 abort：网络错误或 CORS（无法可靠区分，统一标 network）
              transport.send('network.error', {
                reqId: m.reqId,
                error: m.aborted ? 'Request aborted' : 'Network error',
                duration,
                errorType: m.aborted ? 'abort' : 'network',
              });
              return;
            }
            transport.send('network.response', {
              reqId: m.reqId,
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
    }
    return origSend.call(this, body ?? null);
  };

  return () => {
    try {
      XHR.prototype.open = origOpen;
      XHR.prototype.send = origSend;
      XHR.prototype.setRequestHeader = origSetHeader;
    } catch {
      /* best-effort */
    }
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

function hookBeacon(transport: Transport): (() => void) | void {
  const nav = navigator as Navigator & {
    sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean;
  };
  if (typeof nav.sendBeacon !== 'function') return;
  const rawBeacon = nav.sendBeacon;
  const orig = rawBeacon.bind(nav);

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
        body: describeBody(data),
        initiator: 'beacon',
      });
    } catch {
      /* ignore */
    }
    return orig(url, data);
  };

  return () => {
    try {
      nav.sendBeacon = rawBeacon;
    } catch {
      /* best-effort */
    }
  };
}
