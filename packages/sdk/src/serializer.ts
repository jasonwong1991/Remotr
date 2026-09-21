import type { SpyAtom, SpyAtomEntry } from '@remotr/shared';

const MAX_DEPTH = 8;
const MAX_CHILDREN = 100;
const MAX_STRING = 10_000;
/**
 * 单次序列化的节点总预算。深度 × 子项数的上限是 100^8，
 * `console.log(bigStore)` 一类的宽而深的对象会把宿主页面卡死——超预算的子树整体截断。
 */
const MAX_NODES = 2_000;

/** 一次 serialize 调用内共享的遍历状态 */
interface Ctx {
  seen: WeakSet<object>;
  /** 剩余节点预算 */
  budget: number;
}

/**
 * 将任意 JS 值序列化为 SpyAtom，供跨端安全传输。
 * 处理：循环引用、深度截断、子项数量限制、节点总量预算、特殊类型（Error/Date/RegExp/Node/函数）。
 */
export function serialize(value: unknown): SpyAtom {
  return walk(value, 0, { seen: new WeakSet(), budget: MAX_NODES });
}

function walk(value: unknown, depth: number, ctx: Ctx): SpyAtom {
  const { seen } = ctx;
  if (ctx.budget-- <= 0) {
    return { type: 'object', display: '…', truncated: true };
  }
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
      // proxy 包装的数组读 length 也可能触发抛错的 get trap
      let len: number;
      try {
        len = value.length;
      } catch {
        return { type: 'array', display: '[Unreadable]' };
      }
      const children: SpyAtomEntry[] = [];
      const limit = Math.min(len, MAX_CHILDREN);
      // 迭代可能触发抛错的 proxy 陷阱(getter/has trap);逐项包裹,失败降级为占位。
      let i = 0;
      for (; i < limit && ctx.budget > 0; i++) {
        try {
          children.push({ key: String(i), value: walk(value[i], depth + 1, ctx) });
        } catch {
          children.push({ key: String(i), value: { type: 'string', display: '[Unreadable]' } });
        }
      }
      return {
        type: 'array',
        display: `Array(${len})`,
        children,
        truncated: len > i || undefined,
      };
    }

    // Map / Set 简要处理。for..of 会走 Symbol.iterator,恶意/异常 proxy 可能在
    // 迭代过程中抛错 —— 整体包 try/catch,已收集的子项照常返回(部分降级)。
    if (value instanceof Map) {
      const children: SpyAtomEntry[] = [];
      try {
        let i = 0;
        for (const [k, v] of value) {
          if (i++ >= MAX_CHILDREN || ctx.budget <= 0) break;
          children.push({ key: safeKey(k), value: walk(v, depth + 1, ctx) });
        }
      } catch {
        children.push({ key: '…', value: { type: 'string', display: '[Unreadable]' } });
      }
      return { type: 'object', display: `Map(${safeSize(value)})`, children };
    }
    if (value instanceof Set) {
      const children: SpyAtomEntry[] = [];
      try {
        let i = 0;
        for (const v of value) {
          if (i >= MAX_CHILDREN || ctx.budget <= 0) break;
          children.push({ key: String(i++), value: walk(v, depth + 1, ctx) });
        }
      } catch {
        children.push({ key: '…', value: { type: 'string', display: '[Unreadable]' } });
      }
      return { type: 'object', display: `Set(${safeSize(value)})`, children };
    }

    // 普通对象
    let keys: string[];
    try {
      keys = Object.keys(obj);
    } catch {
      // Object.keys 在恶意 proxy 的 ownKeys/getOwnPropertyDescriptor trap 上可能抛错
      return { type: 'object', display: '[Unreadable]' };
    }
    const children: SpyAtomEntry[] = [];
    const limit = Math.min(keys.length, MAX_CHILDREN);
    let i = 0;
    for (; i < limit && ctx.budget > 0; i++) {
      const k = keys[i];
      try {
        children.push({ key: k, value: walk((obj as Record<string, unknown>)[k], depth + 1, ctx) });
      } catch {
        children.push({ key: k, value: { type: 'string', display: '[Unreadable]' } });
      }
    }
    const ctor = (obj as { constructor?: { name?: string } }).constructor?.name;
    return {
      type: 'object',
      display: ctor && ctor !== 'Object' ? ctor : `{${keys.length} keys}`,
      children,
      truncated: keys.length > i || undefined,
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

/** 读取 Map/Set 的 size，proxy 陷阱抛错时降级为 '?'。 */
function safeSize(value: { size: number }): string {
  try {
    return String(value.size);
  } catch {
    return '?';
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
