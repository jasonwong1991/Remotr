/**
 * 简单的 Hash 路由模块
 * 支持四种路由：
 *  - /#/                                              → Home（所有项目/房间列表）
 *  - /#/dashboard?project=xxx                          → Dashboard 模式
 *  - /#/session?project=xxx&deviceId=xxx&pageId=xxx    → Session 调试模式
 *  - /#/replay?project=xxx[&deviceId&pageId]           → 回放
 *
 * URL 参数名是 `project`；服务端/SDK/MCP 仍叫 room（同一概念）。
 * 旧的 `?room=` 链接继续可用（readProject 兼容读取）。
 */

import { useEffect, useState } from 'react';

export type RouteName = 'home' | 'dashboard' | 'session' | 'replay';

export interface RouteState {
  name: RouteName;
  params: URLSearchParams;
}

const PROJECT_PARAM = 'project';
/** 旧参数名，仅用于读取兼容 */
const LEGACY_PARAM = 'room';

/** 从参数里读项目名：project 优先，其次旧的 room；都没有返回 null（不再默认 default） */
export function readProject(params: URLSearchParams): string | null {
  return params.get(PROJECT_PARAM) || params.get(LEGACY_PARAM) || null;
}

function parseHash(): RouteState {
  const hash = window.location.hash.slice(1) || '/';
  const [pathPart, queryPart = ''] = hash.split('?');
  const params = new URLSearchParams(queryPart);

  // 兼容旧 URL（?room=xxx 直接到 dashboard；无参数则首页）
  if (!hash.startsWith('/')) {
    const legacy = new URLSearchParams(window.location.search);
    return readProject(legacy)
      ? { name: 'dashboard', params: legacy }
      : { name: 'home', params: legacy };
  }

  if (pathPart === '/session') {
    return { name: 'session', params };
  }
  if (pathPart === '/replay') {
    return { name: 'replay', params };
  }
  if (pathPart === '/dashboard') {
    // 没带项目名的 dashboard 没意义，回首页选
    return readProject(params) ? { name: 'dashboard', params } : { name: 'home', params };
  }
  return { name: 'home', params };
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

/** 导航到首页（项目列表） */
export function navigateToHome(): void {
  window.location.hash = '#/';
}

/** 导航到 Dashboard */
export function navigateToDashboard(project: string): void {
  window.location.hash = `#/dashboard?${PROJECT_PARAM}=${encodeURIComponent(project)}`;
}

/** 导航到具体 Session 调试页面 */
export function navigateToSession(
  project: string,
  deviceId: string,
  pageId: string,
): void {
  const params = new URLSearchParams({
    [PROJECT_PARAM]: project,
    deviceId,
    pageId,
  });
  window.location.hash = `#/session?${params.toString()}`;
}

/** 获取当前项目名（优先 hash，其次 search）；无则 null */
export function getCurrentProject(): string | null {
  const route = parseHash();
  return readProject(route.params);
}

/** 导航到回放页（按项目列出当天录制；可携带 session 直接定位） */
export function navigateToReplay(project: string, deviceId?: string, pageId?: string): void {
  const params = new URLSearchParams({ [PROJECT_PARAM]: project });
  if (deviceId && pageId) {
    params.set('deviceId', deviceId);
    params.set('pageId', pageId);
  }
  window.location.hash = `#/replay?${params.toString()}`;
}
