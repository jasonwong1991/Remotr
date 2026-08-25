import { describe, it, expect, beforeEach } from 'vitest';
import {
  cyrb53,
  pageIdForUrl,
  pruneRegistry,
  lowestFreeSlot,
  getPageId,
  getDeviceId,
} from '../session.js';

describe('cyrb53', () => {
  it('is deterministic for the same input', () => {
    expect(cyrb53('http://x/a')).toBe(cyrb53('http://x/a'));
  });

  it('differs for different inputs', () => {
    expect(cyrb53('http://x/a')).not.toBe(cyrb53('http://x/b'));
  });
});

describe('pageIdForUrl', () => {
  it('same URL → same pageId (stable across reopen)', () => {
    expect(pageIdForUrl('https://app.com/dashboard')).toBe(pageIdForUrl('https://app.com/dashboard'));
  });

  it('different path → different pageId', () => {
    expect(pageIdForUrl('https://app.com/a')).not.toBe(pageIdForUrl('https://app.com/b'));
  });

  it('produces a page_-prefixed id', () => {
    expect(pageIdForUrl('https://app.com/')).toMatch(/^page_/);
  });
});

describe('pruneRegistry', () => {
  it('drops slots whose heartbeat is stale', () => {
    const now = 1_000_000;
    const reg = {
      'page_a': { t: 'x', ts: now - 20_000 }, // stale
      'page_a-2': { t: 'y', ts: now - 1_000 }, // fresh
    };
    pruneRegistry(reg, now, 10_000);
    expect(reg['page_a']).toBeUndefined();
    expect(reg['page_a-2']).toBeDefined();
  });

  it('drops malformed entries', () => {
    const reg = { 'page_a': undefined as never, 'page_b': { t: 'z', ts: 'bad' as never } };
    pruneRegistry(reg, 1000, 10_000);
    expect(Object.keys(reg)).toHaveLength(0);
  });
});

describe('lowestFreeSlot', () => {
  it('returns base when registry is empty (reopen reuses same session)', () => {
    expect(lowestFreeSlot({}, 'page_a')).toBe('page_a');
  });

  it('returns base-2 when base is occupied by a live tab', () => {
    expect(lowestFreeSlot({ 'page_a': { t: 'x', ts: 1 } }, 'page_a')).toBe('page_a-2');
  });

  it('skips to the lowest free slot in a sequence', () => {
    const reg = { 'page_a': { t: 'x', ts: 1 }, 'page_a-2': { t: 'y', ts: 1 } };
    expect(lowestFreeSlot(reg, 'page_a')).toBe('page_a-3');
  });
});

describe('getPageId / getDeviceId integration (jsdom)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // jsdom 默认 location = http://localhost/
  });

  it('same tab reloading keeps the same pageId (slot 备忘录生效)', () => {
    // 重载场景：sessionStorage 保留（同标签页），localStorage 里旧 slot 的心跳仍新鲜
    // ——这正是 pagehide/beforeunload 未触发时的状态。必须拿回原 slot，
    // 否则 pageId 漂移到 base-2，Debugger 仍钉在 base 上，命令全部失效。
    const first = getPageId();
    expect(first).toMatch(/^page_/);
    const afterReload = getPageId();
    expect(afterReload).toBe(first);
  });

  it('a second concurrent tab gets the next slot', () => {
    const first = getPageId();
    // 新标签页有自己的空 sessionStorage，但共享 localStorage 里的标签页注册表
    sessionStorage.clear();
    const second = getPageId();
    expect(second).not.toBe(first);
    expect(second.startsWith(first)).toBe(true); // base-2 形如 base 前缀
  });

  it('honors an explicit pageId config', () => {
    expect(getPageId('page_custom')).toBe('page_custom');
  });

  it('getDeviceId persists across calls', () => {
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBe(b);
    expect(a).toMatch(/^dev_/);
  });
});
