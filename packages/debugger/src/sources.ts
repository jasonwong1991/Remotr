import { sendCommand } from './ws';
import {
  createResolver,
  parseStack,
  type OriginalPosition,
  type StackFrame,
} from '@remotr/sourcemap';
import type { ScriptInfo, SourcesFetchResult } from '@remotr/shared';

/**
 * Sources 取数层：通过 sources.* 命令让 SDK 同源代取脚本/map，
 * 并在调试端用 @remotr/sourcemap 还原堆栈。模块级缓存避免重复拉取大 bundle。
 */

/** 大 bundle 同源 fetch + 传输可能较慢，单独给更长超时 */
const FETCH_TIMEOUT_MS = 30_000;

const _cache = new Map<string, SourcesFetchResult>();

/**
 * 手动导入的 source map（scriptUrl → map JSON）。
 * 用于 map 未同源部署 / hidden-source-map / 被 CORS 拦下的场景。
 * 以脚本 url 为键、独立于 _cache：切 session 不清（同一 bundle 换台设备照样能用），
 * 且优先级高于 SDK 自动取到的 map。
 */
const _manualMaps = new Map<string, string>();

/** 用手动导入的 map 覆盖取回结果（无导入则原样返回） */
function withManualMap(res: SourcesFetchResult): SourcesFetchResult {
  const map = _manualMaps.get(res.url);
  return map ? { ...res, map, mapError: undefined } : res;
}

/**
 * 登记手动导入的 map。做最小校验（须为含 mappings 的 JSON），失败返回 false。
 * 之后 fetchSource / resolveStack 对该脚本一律用它。
 */
export function importSourceMap(scriptUrl: string, mapJson: string): boolean {
  if (!createResolver(mapJson)) return false;
  _manualMaps.set(scriptUrl, mapJson);
  return true;
}

export function hasManualMap(scriptUrl: string): boolean {
  return _manualMaps.has(scriptUrl);
}

export async function listSources(): Promise<ScriptInfo[]> {
  try {
    const reply = await sendCommand('sources.list', {});
    if (reply.error) return [];
    return (reply.result as { scripts: ScriptInfo[] }).scripts ?? [];
  } catch {
    return [];
  }
}

export async function fetchSource(url: string): Promise<SourcesFetchResult | null> {
  const cached = _cache.get(url);
  if (cached) return withManualMap(cached);
  try {
    const reply = await sendCommand('sources.fetch', { url }, FETCH_TIMEOUT_MS);
    if (reply.error) return withManualMap({ url, content: '', error: reply.error });
    const result = reply.result as SourcesFetchResult;
    // 仅缓存成功取到内容的结果，失败可重试
    if (result && result.content) _cache.set(url, result);
    return result ? withManualMap(result) : result;
  } catch (err) {
    return withManualMap({ url, content: '', error: err instanceof Error ? err.message : String(err) });
  }
}

export interface ResolvedFrame {
  raw: StackFrame;
  /** 经 source map 还原后的原始位置；map 缺失/无映射则为 undefined */
  original?: OriginalPosition;
}

/**
 * 解析整条调用栈，逐帧用对应脚本的 map 还原为原始位置。
 * 同一脚本的 resolver 仅构建一次（避免重复解析多 MB map）。
 */
export async function resolveStack(stack: string): Promise<ResolvedFrame[]> {
  const frames = parseStack(stack);
  const resolvers = new Map<string, ReturnType<typeof createResolver>>();
  const out: ResolvedFrame[] = [];

  for (const fr of frames) {
    if (!resolvers.has(fr.url)) {
      const res = await fetchSource(fr.url);
      resolvers.set(fr.url, res?.map ? createResolver(res.map) : null);
    }
    const resolver = resolvers.get(fr.url) ?? null;
    out.push({ raw: fr, original: resolver?.resolve(fr.line, fr.col) ?? undefined });
  }

  return out;
}

/** 切换 session 时清空缓存，避免跨 session 复用陈旧脚本 */
export function clearSourcesCache(): void {
  _cache.clear();
}
