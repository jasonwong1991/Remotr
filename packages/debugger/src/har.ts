import type { NetworkRecord } from './store';

/**
 * HAR 1.2 serialization of the captured HTTP log.
 *
 * Remotr captures a pragmatic subset of what a full HAR archive records
 * (no cookies parsing, no per-phase timing, no wall-clock start per request),
 * so absent fields degrade to the HAR-conventional sentinels: `-1` for unknown
 * sizes/times and `[]`/`""` for unavailable collections. The output still
 * validates as HAR 1.2 and imports cleanly into Chrome DevTools / other tools.
 */

interface HarNameValue {
  name: string;
  value: string;
}

interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarNameValue[];
  headers: HarNameValue[];
  queryString: HarNameValue[];
  postData?: { mimeType: string; text: string };
  headersSize: number;
  bodySize: number;
}

interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarNameValue[];
  headers: HarNameValue[];
  content: { size: number; mimeType: string; text: string };
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
}

export interface Har {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

const HTTP_VERSION = 'HTTP/1.1';

function toNameValues(headers: Record<string, string> | undefined): HarNameValue[] {
  return Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }));
}

/** Parse the URL search params into HAR queryString entries (empty on parse failure). */
function toQueryString(url: string | undefined): HarNameValue[] {
  if (!url) return [];
  try {
    const u = new URL(url, 'http://_');
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/** Byte length of a UTF-8 string; `-1` when absent (HAR "unknown" sentinel). */
function byteSize(text: string | undefined): number {
  if (text == null) return -1;
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

function buildEntry(record: NetworkRecord, startedDateTime: string): HarEntry {
  const req = record.request;
  const res = record.response;

  const method = (req?.method ?? 'GET').toUpperCase();
  const url = req?.url ?? '';
  const reqBody = req?.body;
  const resBody = res?.body;
  const wait = res?.duration ?? record.error?.duration ?? -1;

  const request: HarRequest = {
    method,
    url,
    httpVersion: HTTP_VERSION,
    cookies: [],
    headers: toNameValues(req?.headers),
    queryString: toQueryString(url),
    headersSize: -1,
    bodySize: byteSize(reqBody),
  };
  if (reqBody != null && reqBody !== '') {
    request.postData = {
      mimeType: req?.headers?.['content-type'] ?? req?.headers?.['Content-Type'] ?? 'application/octet-stream',
      text: reqBody,
    };
  }

  const response: HarResponse = {
    status: res?.status ?? 0,
    statusText: res?.statusText ?? '',
    httpVersion: HTTP_VERSION,
    cookies: [],
    headers: toNameValues(res?.headers),
    content: {
      size: byteSize(resBody) < 0 ? 0 : byteSize(resBody),
      mimeType: res?.mimeType ?? '',
      text: resBody ?? '',
    },
    redirectURL: res?.headers?.['location'] ?? res?.headers?.['Location'] ?? '',
    headersSize: -1,
    bodySize: byteSize(resBody),
  };

  return {
    startedDateTime,
    time: wait < 0 ? 0 : wait,
    request,
    response,
    cache: {},
    timings: { send: -1, wait, receive: -1 },
  };
}

/**
 * Serialize network records into a HAR 1.2 archive.
 *
 * @param records captured HTTP records (from store `networkMap.values()`)
 * @param creatorVersion Remotr version string embedded in `log.creator`
 * @param startedDateTime ISO 8601 export timestamp; used for every entry since
 *   per-request wall-clock isn't captured. Defaults to now.
 */
export function buildHar(
  records: Iterable<NetworkRecord>,
  creatorVersion = '0.0.0',
  startedDateTime: string = new Date().toISOString(),
): Har {
  const entries = Array.from(records).map((r) => buildEntry(r, startedDateTime));
  return {
    log: {
      version: '1.2',
      creator: { name: 'Remotr', version: creatorVersion },
      entries,
    },
  };
}
