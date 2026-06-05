/**
 * Session ID 管理模块
 * 负责生成和持久化 deviceId、pageId，以及读取身份标识
 */

import type { SessionId, SessionMetadata } from '@remotr/shared';

/**
 * 生成随机 ID
 */
function randomId(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * 获取或生成设备 ID
 * 优先级：config.deviceId > localStorage > 生成新 ID
 */
export function getDeviceId(configDeviceId?: string): string {
  if (configDeviceId) return configDeviceId;

  try {
    const key = '__remotr_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `dev_${randomId(16)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // localStorage 不可用时使用临时 ID
    return `dev_${randomId(16)}`;
  }
}

/**
 * 获取或生成页面 ID
 * 优先级：config.pageId > sessionStorage > 生成新 ID
 * 使用 sessionStorage 保证同一标签页刷新后保持不变，新标签页获得新 ID
 */
export function getPageId(configPageId?: string): string {
  if (configPageId) return configPageId;

  try {
    const key = '__remotr_page_id';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `page_${randomId(16)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    // sessionStorage 不可用时使用临时 ID
    return `page_${randomId(16)}`;
  }
}

/**
 * 从 cookie 中读取指定 key 的值
 */
function readCookie(name: string): string | undefined {
  try {
    const cookies = document.cookie.split(';');
    for (const item of cookies) {
      const [key, ...rest] = item.trim().split('=');
      if (key === name) {
        return decodeURIComponent(rest.join('='));
      }
    }
  } catch {
    // cookie 读取失败
  }
  return undefined;
}

/**
 * 获取身份标识
 * 优先级：config.identity > data-identity > data-identity-cookie
 */
export function getIdentity(configIdentity?: string, identityCookie?: string): string | undefined {
  if (configIdentity) return configIdentity;
  if (!identityCookie) return undefined;
  return readCookie(identityCookie);
}

/**
 * 构建完整的 SessionMetadata
 */
export function buildSessionMetadata(
  sessionId: SessionId,
  identity?: string,
  systemInfo?: { ua: string; url: string; title: string; platform?: string }
): SessionMetadata {
  const metadata: SessionMetadata = {
    session: sessionId,
  };

  if (identity) {
    metadata.identity = identity;
  }

  if (systemInfo) {
    metadata.device = {
      ua: systemInfo.ua,
      platform: systemInfo.platform,
    };
    metadata.page = {
      url: systemInfo.url,
      title: systemInfo.title,
    };
  }

  return metadata;
}

