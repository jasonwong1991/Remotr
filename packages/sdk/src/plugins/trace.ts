import type {
  TracepointDef,
  TraceSetCmd,
  TraceSetResult,
  TraceRemoveCmd,
  TraceRemoveResult,
} from '@remotr/shared';
import type { Transport } from '../transport.js';
import { serialize } from '../serializer.js';

/**
 * Trace 插件:函数级追踪点(无暂停调试)。
 *
 * 面板按点号路径(如 "app.store.dispatch")指定目标函数,SDK 用 Object.defineProperty
 * 包装它(与 storage 插件劫持 setItem 同款技术)。每次调用捕获入参 / 返回值 / 异常 /
 * 调用栈 / 耗时,序列化为 SpyAtom 上报一条 trace.hit,不暂停执行。
 *
 * 铁律:采集绝不影响业务 —— 包装器透传 this、返回值与异常;所有上报、条件求值、
 * 序列化都包在 try/catch 里,任何失败都不改变被追踪函数的行为。
 *
 * Phase 1 边界:只捕获同步返回值。async 函数返回的是 Promise 对象本身(不 await 解析值),
 * 以免把"未处理的 rejection"变成已处理,污染 console 插件的 unhandledrejection 采集。
 */

interface ActiveEntry {
  owner: Record<string, unknown>;
  key: string;
  path: string;
  original: (...args: unknown[]) => unknown;
  /** 包装前该属性是否为 owner 自有属性(用于还原时决定 redefine 还是 delete) */
  hadOwn: boolean;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export function installTrace(transport: Transport): void {
  /** id → 已包装的追踪点 */
  const active = new Map<string, ActiveEntry>();
  /** 已被追踪的路径集合(防止对同一路径重复包装导致嵌套) */
  const tracedPaths = new Set<string>();
  /** id → 命中序号计数器 */
  const seqs = new Map<string, number>();

  transport.onCommand('trace.set', (data) => setTracepoint((data as TraceSetCmd).tracepoint));
  transport.onCommand('trace.remove', (data) => removeTracepoint((data as TraceRemoveCmd).id));

  function setTracepoint(tp: TracepointDef): TraceSetResult {
    if (active.has(tp.id)) return { ok: false, error: `Tracepoint ${tp.id} already set` };
    if (tracedPaths.has(tp.path)) return { ok: false, error: `Path already traced: ${tp.path}` };

    const resolved = resolvePath(tp.path);
    if (!resolved) return { ok: false, error: `Cannot resolve path: ${tp.path}` };

    const { owner, key } = resolved;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    // 访问器属性(getter)语义特殊,包装会改变行为 —— 明确拒绝而非静默出错
    if (descriptor?.get) return { ok: false, error: `Accessor property not supported: ${tp.path}` };

    const value = owner[key];
    if (typeof value !== 'function') {
      return { ok: false, error: `Not a function: ${tp.path} (${typeof value})` };
    }

    const original = value as (...args: unknown[]) => unknown;
    seqs.set(tp.id, 0);
    const wrapped = makeWrapper(tp, original);

    try {
      Object.defineProperty(owner, key, {
        value: wrapped,
        writable: true,
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
      });
    } catch {
      // 顶层 function 声明的全局绑定是 {writable:true, configurable:false}(HTML 规范),
      // defineProperty 必然失败,但直接赋值合法 —— 回退赋值覆盖。
      try {
        owner[key] = wrapped;
        if (owner[key] !== wrapped) throw new Error('assignment ignored');
      } catch (err) {
        seqs.delete(tp.id);
        return { ok: false, error: `Cannot wrap (non-writable & non-configurable): ${String(err)}` };
      }
    }

    active.set(tp.id, { owner, key, path: tp.path, original, hadOwn: !!descriptor });
    tracedPaths.add(tp.path);
    return { ok: true };
  }

  function removeTracepoint(id: string): TraceRemoveResult {
    const entry = active.get(id);
    if (!entry) return { ok: true }; // 幂等:未知 id 视为已移除

    try {
      if (entry.hadOwn) {
        Object.defineProperty(entry.owner, entry.key, {
          value: entry.original,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        // 原本是继承属性,包装时创建了自有遮蔽属性 —— 删除以恢复原型委托
        delete entry.owner[entry.key];
      }
    } catch {
      // non-configurable 属性(如顶层 function 声明)无法 defineProperty,
      // 与包装时同理回退为直接赋值还原
      try {
        entry.owner[entry.key] = entry.original;
      } catch {
        // 尽力还原;即使失败也从注册表移除,避免状态泄漏
      }
    }

    active.delete(id);
    seqs.delete(id);
    tracedPaths.delete(entry.path);
    return { ok: true };
  }

  /** 构造包装函数:透传 this / 返回值 / 异常,命中时上报 */
  function makeWrapper(
    tp: TracepointDef,
    original: (...args: unknown[]) => unknown,
  ): (...args: unknown[]) => unknown {
    function wrapped(this: unknown, ...args: unknown[]): unknown {
      const start = now();
      let ret: unknown;
      let thrown: unknown;
      let didThrow = false;
      try {
        ret = original.apply(this, args);
        return ret;
      } catch (err) {
        didThrow = true;
        thrown = err;
        throw err;
      } finally {
        // 上报与业务完全隔离:任何异常都不得逃逸到被追踪函数
        try {
          const durationMs = now() - start;
          const pass = tp.condition
            ? evalCondition(tp.condition, args, didThrow ? undefined : ret, this)
            : true;
          if (pass) {
            const seq = (seqs.get(tp.id) ?? 0) + 1;
            seqs.set(tp.id, seq);
            transport.send('trace.hit', {
              id: tp.id,
              path: tp.path,
              seq,
              args: args.map((a) => serialize(a)),
              ret: didThrow ? undefined : serialize(ret),
              thrown: didThrow ? serialize(thrown) : undefined,
              stack: trimStack(new Error().stack),
              durationMs,
            });
          }
        } catch {
          /* 采集失败绝不影响业务 */
        }
      }
    }

    // 保留函数身份信息,尽量减少对反射代码的干扰
    try {
      Object.defineProperty(wrapped, 'name', { value: original.name, configurable: true });
      Object.defineProperty(wrapped, 'length', { value: original.length, configurable: true });
      // 拷贝挂在函数上的自有静态属性(如 fn.foo = ...)
      Object.assign(wrapped, original);
    } catch {
      /* 保留身份失败无碍核心功能 */
    }

    return wrapped;
  }
}

/**
 * 从 window 按点号路径解析出 { owner, key }。
 * owner 是持有目标函数的对象,key 是属性名 —— 二者用于重新赋值包装函数。
 */
function resolvePath(path: string): { owner: Record<string, unknown>; key: string } | null {
  const parts = path
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let owner: unknown = window;
  for (let i = 0; i < parts.length - 1; i++) {
    if (owner == null) return null;
    owner = (owner as Record<string, unknown>)[parts[i]];
  }
  if (owner == null || (typeof owner !== 'object' && typeof owner !== 'function')) return null;

  return { owner: owner as Record<string, unknown>, key: parts[parts.length - 1] };
}

/**
 * 在调用之后求值过滤条件,可引用 args(参数数组)、ret(返回值)、self(this)。
 * 条件抛错时 fail-open(返回 true 照常上报),避免"设了条件却静默无输出"的困惑。
 */
function evalCondition(condition: string, args: unknown[], ret: unknown, self: unknown): boolean {
  try {
    // 间接构造,在全局作用域求值(与 page 插件的 eval.run 一致的安全边界)
    const fn = new Function('args', 'ret', 'self', `return (${condition});`);
    return !!fn(args, ret, self);
  } catch {
    return true; // fail-open
  }
}

/** 去掉 V8 栈顶的包装器帧,让调用栈从真实调用点开始 */
function trimStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  // V8: 行0 是 "Error",行1 是本包装器帧 → 删掉行1
  if (lines[0]?.trim().startsWith('Error') && lines.length > 2) {
    lines.splice(1, 1);
  }
  return lines.join('\n');
}
