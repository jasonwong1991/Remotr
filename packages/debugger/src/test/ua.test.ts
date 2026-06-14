import { describe, it, expect } from 'vitest';
import { parseDevice, deviceDisplay } from '../ua';

describe('parseDevice', () => {
  it('iPhone：产品线 + iOS 版本', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(parseDevice(ua)).toBe('iPhone · iOS 17.4');
  });

  it('iPad', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 16_3 like Mac OS X) AppleWebKit/605.1.15';
    // iPad UA 的 OS 段不带 "iPhone" 前缀
    expect(parseDevice(ua)).toBe('iPad · iOS 16.3');
  });

  it('vivo 安卓：型号 + Android 版本', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; V2309A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36';
    expect(parseDevice(ua)).toBe('V2309A · Android 13');
  });

  it('xiaomi 安卓（带 Build 段 + WebView）', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 10; MI 8 Build/QKQ1.190828.002; wv) AppleWebKit/537.36 Chrome/89.0.4389.72 Mobile Safari/537.36';
    expect(parseDevice(ua)).toBe('MI 8 · Android 10');
  });

  it('老式安卓 UA（型号前带 locale 段）', () => {
    const ua = 'Mozilla/5.0 (Linux; U; Android 4.4.4; zh-cn; MI 4LTE Build/KTU84P) AppleWebKit/533.1';
    expect(parseDevice(ua)).toBe('MI 4LTE · Android 4.4.4');
  });

  it('macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseDevice(ua)).toBe('Mac · macOS 10.15.7');
  });

  it('Windows 10/11', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0';
    expect(parseDevice(ua)).toBe('Windows 10/11');
  });

  it('无法识别 → null', () => {
    expect(parseDevice('SomeBot/1.0')).toBeNull();
    expect(parseDevice(undefined)).toBeNull();
    expect(parseDevice('')).toBeNull();
  });
});

describe('deviceDisplay', () => {
  it('解析成功：设备名 + 括号内截断 deviceId', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; V2309A) AppleWebKit/537.36';
    expect(deviceDisplay('dev_xkfrdhwrwv09k9hy', ua)).toBe('V2309A · Android 13 (dev_xkfrdh…)');
  });

  it('解析失败：回退原始 deviceId', () => {
    expect(deviceDisplay('dev_abc123', undefined)).toBe('dev_abc123');
  });
});
