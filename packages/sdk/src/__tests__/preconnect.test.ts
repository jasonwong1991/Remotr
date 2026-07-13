import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installPreconnectCapture,
  uninstallPreconnectCapture,
  drainPreconnect,
} from '../preconnect.js';
import type { Transport } from '../transport.js';

/** 捕获 send 调用的假 Transport（drainPreconnect 只依赖 send）。 */
function fakeTransport(): { sent: Array<{ method: string; data: unknown }>; t: Transport } {
  const sent: Array<{ method: string; data: unknown }> = [];
  const t = {
    send: (method: string, data: unknown) => {
      sent.push({ method, data });
    },
  } as unknown as Transport;
  return { sent, t };
}

describe('preconnect ring buffer', () => {
  beforeEach(() => {
    // 清掉上一个用例的残留（drain 会 uninstall），重新装上采集
    uninstallPreconnectCapture();
    installPreconnectCapture();
  });

  afterEach(() => {
    uninstallPreconnectCapture();
  });

  it('captures window error events as page.error', () => {
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'boot crash', filename: 'app.js', lineno: 3, colno: 7 }),
    );

    const { sent, t } = fakeTransport();
    drainPreconnect(t);

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('page.error');
    expect(sent[0].data).toMatchObject({
      message: 'boot crash',
      url: 'app.js',
      line: 3,
      col: 7,
    });
  });

  it('captures console.error calls as console.entry', () => {
    console.error('early failure', 42);

    const { sent, t } = fakeTransport();
    drainPreconnect(t);

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('console.entry');
    const data = sent[0].data as { level: string; args: Array<{ preview?: string }> };
    expect(data.level).toBe('error');
    expect(data.args).toHaveLength(2);
  });

  it('preserves capture order across sources', () => {
    console.error('first');
    window.dispatchEvent(new ErrorEvent('error', { message: 'second' }));
    console.error('third');

    const { sent, t } = fakeTransport();
    drainPreconnect(t);

    expect(sent.map((s) => s.method)).toEqual(['console.entry', 'page.error', 'console.entry']);
  });

  it('caps the ring at 100 entries, dropping the oldest', () => {
    for (let i = 0; i < 120; i++) {
      window.dispatchEvent(new ErrorEvent('error', { message: `e${i}` }));
    }

    const { sent, t } = fakeTransport();
    drainPreconnect(t);

    expect(sent).toHaveLength(100);
    expect((sent[0].data as { message: string }).message).toBe('e20'); // 最旧的 20 条被丢弃
    expect((sent[99].data as { message: string }).message).toBe('e119');
  });

  it('stops capturing after drain (handoff to console plugin, no double-capture)', () => {
    const { sent, t } = fakeTransport();
    drainPreconnect(t);
    expect(sent).toHaveLength(0);

    // drain 之后：监听已卸载、console.error 已还原，后续错误不再进入环形缓冲
    window.dispatchEvent(new ErrorEvent('error', { message: 'after drain' }));
    console.error('after drain');

    const second = fakeTransport();
    drainPreconnect(second.t);
    expect(second.sent).toHaveLength(0);
  });

  it('restores the original console.error on uninstall', () => {
    const wrapped = console.error;
    uninstallPreconnectCapture();
    expect(console.error).not.toBe(wrapped);
    // 幂等：重复卸载不抛错
    expect(() => uninstallPreconnectCapture()).not.toThrow();
  });

  it('install is idempotent (no stacked wrappers)', () => {
    installPreconnectCapture();
    installPreconnectCapture();
    console.error('once');

    const { sent, t } = fakeTransport();
    drainPreconnect(t);
    expect(sent).toHaveLength(1);
  });

  it('drain keeps going when a single send throws', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'a' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'b' }));

    const sent: string[] = [];
    let first = true;
    const t = {
      send: (_m: string, data: { message: string }) => {
        if (first) {
          first = false;
          throw new Error('ws hiccup');
        }
        sent.push(data.message);
      },
    } as unknown as Transport;

    expect(() => drainPreconnect(t)).not.toThrow();
    expect(sent).toEqual(['b']);
  });
});
