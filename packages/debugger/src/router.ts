/**
 * 简单的 Hash 路由模块
 * 支持两种路由：
 *  - /#/dashboard?room=xxx → Dashboard 模式
 *  - /#/session?room=xxx&deviceId=xxx&pageId=xxx → Session 调试模式
 */

import { useEffect, useState } from 'react';

export type RouteName = 'dashboard' | 'session' | 'replay';

export interface RouteState {
  name: RouteName;
  params: URLSearchParams;
}

function parseHash(): RouteState {
  const hash = window.location.hash.slice(1) || '/dashboard';
  const [pathPart, queryPart = ''] = hash.split('?');
  const params = new URLSearchParams(queryPart);

  // 兼容旧 URL（?room=xxx 直接到调试面板）
  if (!hash.startsWith('/')) {
    return { name: 'dashboard', params: new URLSearchParams(window.location.search) };
  }

  if (pathPart === '/session') {
    return { name: 'session', params };
  }
  if (pathPart === '/replay') {
    return { name: 'replay', params };
  }
  return { name: 'dashboard', params };
}

export function useRoute(): RouteState {
  const [route, setRoute] = useState<RouteState>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}

/** 导航到 Dashboard */
export function navigateToDashboard(room: string = 'default'): void {
  window.location.hash = `#/dashboard?room=${encodeURIComponent(room)}`;
}

/** 导航到具体 Session 调试页面 */
export function navigateToSession(
  room: string,
  deviceId: string,
  pageId: string,
): void {
  const params = new URLSearchParams({
    room,
    deviceId,
    pageId,
  });
  window.location.hash = `#/session?${params.toString()}`;
}

/** 获取当前 room id（优先 hash，其次 search） */
export function getCurrentRoom(): string {
  const route = parseHash();
  return route.params.get('room') || 'default';
}

/** 导航到回放页（按 room 列出当天录制） */
export function navigateToReplay(room: string = 'default'): void {
  window.location.hash = `#/replay?room=${encodeURIComponent(room)}`;
}
