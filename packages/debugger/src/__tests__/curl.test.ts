import { describe, it, expect } from 'vitest';
import { buildCurl } from '../curl';
import type { NetworkRecord } from '../store';

function rec(request: Partial<NetworkRecord['request']>): NetworkRecord {
  return {
    reqId: '1',
    request: {
      reqId: '1',
      url: 'https://api.example.com/x',
      method: 'GET',
      headers: {},
      initiator: 'fetch',
      ...(request as object),
    } as NetworkRecord['request'],
  };
}

describe('buildCurl', () => {
  it('emits a plain GET without -X or a body', () => {
    const cmd = buildCurl(rec({ method: 'GET', url: 'https://api.example.com/users' }));
    expect(cmd).toBe("curl 'https://api.example.com/users'");
  });

  it('adds -X and --data-raw for POST with a body', () => {
    const cmd = buildCurl(rec({
      method: 'POST',
      url: 'https://api.example.com/users',
      body: '{"name":"bob"}',
    }));
    expect(cmd).toContain('-X POST');
    expect(cmd).toContain("--data-raw '{\"name\":\"bob\"}'");
  });

  it('renders one -H per request header', () => {
    const cmd = buildCurl(rec({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    }));
    expect(cmd).toContain("-H 'Content-Type: application/json'");
    expect(cmd).toContain("-H 'Authorization: Bearer t'");
  });

  it('shell-escapes single quotes in header and body values', () => {
    const cmd = buildCurl(rec({
      method: 'POST',
      headers: { 'X-Note': "it's fine" },
      body: "a'b",
    }));
    // single quote becomes '\'' inside the surrounding quotes
    expect(cmd).toContain("-H 'X-Note: it'\\''s fine'");
    expect(cmd).toContain("--data-raw 'a'\\''b'");
  });

  it('omits the body flag when body is empty or absent', () => {
    expect(buildCurl(rec({ method: 'POST', body: '' }))).not.toContain('--data-raw');
    expect(buildCurl(rec({ method: 'POST' }))).not.toContain('--data-raw');
  });

  it('uppercases the method and defaults to GET when missing', () => {
    const cmd = buildCurl({ reqId: '1' });
    expect(cmd).toBe("curl ''");
  });
});
