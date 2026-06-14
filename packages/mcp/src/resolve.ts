import { createResolver, parseStack, sliceSnippet } from '@remotr/sourcemap';
import type { SourcesFetchResult } from '@remotr/shared';
import type { SessionConnection } from './client.js';

export interface ResolvedFrameOut {
  fn?: string;
  /** 压缩后的原始帧位置 */
  raw: { url: string; line: number; col: number };
  /** source map 还原后的原始位置（map 缺失/无映射则为 undefined） */
  original?: { source: string; line: number; column: number; name?: string };
  /** 原始源码片段（以出错行为中心） */
  snippet?: { startLine: number; lines: string[]; focusIndex: number };
}

/**
 * 解析整条调用栈：逐帧经会话发 sources.fetch 取脚本 map，用 @remotr/sourcemap 还原，
 * 并附上以出错行为中心的源码片段，供 AI 直接定位与修复。
 */
export async function resolveStackVia(
  conn: SessionConnection,
  stack: string,
  radius = 12,
): Promise<ResolvedFrameOut[]> {
  const frames = parseStack(stack);
  const cache = new Map<string, ReturnType<typeof createResolver>>();
  const out: ResolvedFrameOut[] = [];

  for (const fr of frames) {
    if (!cache.has(fr.url)) {
      let resolver: ReturnType<typeof createResolver> = null;
      try {
        const res = (await conn.sendCommand('sources.fetch', { url: fr.url })) as SourcesFetchResult;
        resolver = res?.map ? createResolver(res.map) : null;
      } catch {
        resolver = null;
      }
      cache.set(fr.url, resolver);
    }

    const resolver = cache.get(fr.url) ?? null;
    const original = resolver?.resolve(fr.line, fr.col) ?? undefined;
    let snippet: ResolvedFrameOut['snippet'];
    if (original) {
      const content = resolver!.sourceContent(original.source);
      if (content) snippet = sliceSnippet(content, original.line, radius);
    }

    out.push({ fn: fr.fn, raw: { url: fr.url, line: fr.line, col: fr.col }, original, snippet });
  }

  return out;
}
