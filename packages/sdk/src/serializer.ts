import type { SpyAtom, SpyAtomEntry } from '@remotr/shared';

const MAX_DEPTH = 8;
const MAX_CHILDREN = 100;
const MAX_STRING = 10_000;

/**
 * 将任意 JS 值序列化为 SpyAtom，供跨端安全传输。
 * 处理：循环引用、深度截断、子项数量限制、特殊类型（Error/Date/RegExp/Node/函数）。
 */
export function serialize(value: unknown): SpyAtom {
  return walk(value, 0, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): SpyAtom {
  // primitives
  if (value === null) return { type: 'null', value: null, display: 'null' };
  const t = typeof value;

  if (t === 'undefined') return { type: 'undefined', display: 'undefined' };
  if (t === 'string') {
    const s = value as string;
    const truncated = s.length > MAX_STRING;
    return {
      type: 'string',
      value: truncated ? s.slice(0, MAX_STRING) : s,
      display: truncated ? `"${s.slice(0, 80)}…"` : `"${s}"`,
      truncated: truncated || undefined,
    };
  }
  if (t === 'number')
    return { type: 'number', value: value as number, display: String(value) };
  if (t === 'boolean')
    return { type: 'boolean', value: value as boolean, display: String(value) };
  if (t === 'bigint')
    return { type: 'bigint', display: `${String(value)}n` };
  if (t === 'symbol')
    return { type: 'symbol', display: String(value) };
  if (t === 'function') {
    const fn = value as Function;
    return { type: 'function', display: `ƒ ${fn.name || '(anonymous)'}()` };
  }

  // objects
  const obj = value as object;

  if (seen.has(obj)) {
    return { type: 'object', display: '[Circular]', circular: true };
  }

  // 特殊对象
  if (value instanceof Error) {
    return {
      type: 'error',
      display: `${value.name}: ${value.message}`,
      children: [
        { key: 'message', value: { type: 'string', value: value.message, display: `"${value.message}"` } },
        { key: 'stack', value: { type: 'string', value: value.stack ?? '', display: 'stack' } },
      ],
    };
  }
  if (value instanceof Date) {
    return { type: 'date', value: value.toISOString(), display: value.toISOString() };
  }
  if (value instanceof RegExp) {
    return { type: 'regexp', value: value.toString(), display: value.toString() };
  }
  if (isDomNode(value)) {
    return { type: 'node', display: describeNode(value) };
  }

  if (depth >= MAX_DEPTH) {
    return {
      type: Array.isArray(value) ? 'array' : 'object',
      display: Array.isArray(value) ? '[…]' : '{…}',
      truncated: true,
    };
  }

  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      const children: SpyAtomEntry[] = [];
      const limit = Math.min(value.length, MAX_CHILDREN);
      for (let i = 0; i < limit; i++) {
        children.push({ key: String(i), value: walk(value[i], depth + 1, seen) });
      }
      return {
        type: 'array',
        display: `Array(${value.length})`,
        children,
        truncated: value.length > MAX_CHILDREN || undefined,
      };
    }

    // Map / Set 简要处理
    if (value instanceof Map) {
      const children: SpyAtomEntry[] = [];
      let i = 0;
      for (const [k, v] of value) {
        if (i++ >= MAX_CHILDREN) break;
        children.push({ key: safeKey(k), value: walk(v, depth + 1, seen) });
      }
      return { type: 'object', display: `Map(${value.size})`, children };
    }
    if (value instanceof Set) {
      const children: SpyAtomEntry[] = [];
      let i = 0;
      for (const v of value) {
        if (i >= MAX_CHILDREN) break;
        children.push({ key: String(i++), value: walk(v, depth + 1, seen) });
      }
      return { type: 'object', display: `Set(${value.size})`, children };
    }

    // 普通对象
    const keys = Object.keys(obj);
    const children: SpyAtomEntry[] = [];
    const limit = Math.min(keys.length, MAX_CHILDREN);
    for (let i = 0; i < limit; i++) {
      const k = keys[i];
      try {
        children.push({ key: k, value: walk((obj as Record<string, unknown>)[k], depth + 1, seen) });
      } catch {
        children.push({ key: k, value: { type: 'string', display: '[Unreadable]' } });
      }
    }
    const ctor = (obj as { constructor?: { name?: string } }).constructor?.name;
    return {
      type: 'object',
      display: ctor && ctor !== 'Object' ? ctor : `{${keys.length} keys}`,
      children,
      truncated: keys.length > MAX_CHILDREN || undefined,
    };
  } finally {
    seen.delete(obj);
  }
}

function safeKey(k: unknown): string {
  try {
    return typeof k === 'object' ? JSON.stringify(k) : String(k);
  } catch {
    return String(k);
  }
}

function isDomNode(v: unknown): v is Node {
  return typeof Node !== 'undefined' && v instanceof Node;
}

function describeNode(node: Node): string {
  if (node instanceof Element) {
    const id = node.id ? `#${node.id}` : '';
    const cls = node.className && typeof node.className === 'string'
      ? '.' + node.className.trim().split(/\s+/).join('.')
      : '';
    return `<${node.tagName.toLowerCase()}${id}${cls}>`;
  }
  return `#${node.nodeName.toLowerCase()}`;
}
