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
 * Network 插件：拦截 fetch / XMLHttpRequest / sendBeacon。
 * 关键约束：
 *  - fetch 必须 response.clone() 后再读 body，避免消费业务侧的 body
 *  - 采集失败不能影响请求本身
 */
export function installNetwork(transport: Transport): void {
  hookFetch(transport);
  hookXHR(transport);
  hookBeacon(transport);
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
        transport.send('network.error', {
          reqId,
          error: String(err),
          duration: Date.now() - start,
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

      this.addEventListener('loadend', () => {
        try {
          const duration = Date.now() - meta.start;
          if (this.status === 0) {
            transport.send('network.error', { reqId: meta.reqId, error: 'Network error / aborted', duration });
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
    try {
      transport.send('network.request', {
        reqId,
        url: typeof url === 'string' ? url : url.href,
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
