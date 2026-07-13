import { describe, it, expect } from 'vitest';
import { buildHar } from '../har';
import type { NetworkRecord } from '../store';

const FIXED = '2026-01-01T00:00:00.000Z';

function fullRecord(): NetworkRecord {
  return {
    reqId: 'a',
    request: {
      reqId: 'a',
      url: 'https://api.example.com/users?page=2&q=bob',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: '{"name":"bob"}',
      initiator: 'fetch',
    },
    response: {
      reqId: 'a',
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":1}',
      mimeType: 'application/json',
      duration: 42,
    },
  };
}

describe('buildHar', () => {
  it('produces a valid HAR 1.2 envelope with creator', () => {
    const har = buildHar([fullRecord()], '0.2.0', FIXED);
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator).toEqual({ name: 'Remotr', version: '0.2.0' });
    expect(har.log.entries).toHaveLength(1);
  });

  it('maps request method, url, headers, queryString and postData', () => {
    const { request } = buildHar([fullRecord()], '0.2.0', FIXED).log.entries[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.example.com/users?page=2&q=bob');
    expect(request.headers).toContainEqual({ name: 'Authorization', value: 'Bearer t' });
    expect(request.queryString).toContainEqual({ name: 'page', value: '2' });
    expect(request.queryString).toContainEqual({ name: 'q', value: 'bob' });
    expect(request.postData).toEqual({ mimeType: 'application/json', text: '{"name":"bob"}' });
    expect(request.headersSize).toBe(-1);
    expect(request.bodySize).toBe(14);
  });

  it('maps response status, headers, content and timings', () => {
    const entry = buildHar([fullRecord()], '0.2.0', FIXED).log.entries[0];
    expect(entry.response.status).toBe(201);
    expect(entry.response.statusText).toBe('Created');
    expect(entry.response.content).toEqual({ size: 8, mimeType: 'application/json', text: '{"id":1}' });
    expect(entry.response.redirectURL).toBe('');
    expect(entry.response.headersSize).toBe(-1);
    expect(entry.timings).toEqual({ send: -1, wait: 42, receive: -1 });
    expect(entry.time).toBe(42);
    expect(entry.startedDateTime).toBe(FIXED);
    expect(entry.cache).toEqual({});
  });

  it('degrades gracefully for a GET with no body and no response', () => {
    const rec: NetworkRecord = {
      reqId: 'b',
      request: { reqId: 'b', url: 'https://x.test/a', method: 'GET', headers: {}, initiator: 'xhr' },
    };
    const entry = buildHar([rec], '0.2.0', FIXED).log.entries[0];
    expect(entry.request.postData).toBeUndefined();
    expect(entry.request.bodySize).toBe(-1);
    expect(entry.response.status).toBe(0);
    expect(entry.response.content).toEqual({ size: 0, mimeType: '', text: '' });
    expect(entry.timings.wait).toBe(-1);
    expect(entry.time).toBe(0);
  });

  it('uses the error duration for wait when the request failed', () => {
    const rec: NetworkRecord = {
      reqId: 'c',
      request: { reqId: 'c', url: 'https://x.test/a', method: 'GET', headers: {}, initiator: 'fetch' },
      error: { reqId: 'c', error: 'Failed to fetch', duration: 17, errorType: 'network' },
    };
    const entry = buildHar([rec], '0.2.0', FIXED).log.entries[0];
    expect(entry.timings.wait).toBe(17);
    expect(entry.time).toBe(17);
  });

  it('serializes an empty log when there are no records', () => {
    const har = buildHar([], '0.2.0', FIXED);
    expect(har.log.entries).toEqual([]);
  });
});
