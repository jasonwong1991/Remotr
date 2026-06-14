import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';

/**
 * @remotr/sourcemap — 纯函数 Source Map 还原工具。
 *
 * 同步、无 WASM（基于 source-map-js），可同时运行于浏览器（debugger 面板）
 * 与 Node（mcp server）。职责单一：把"压缩后的 bundle 位置"还原为"原始源码位置 + 源码"。
 * 不做网络请求（脚本/.map 由 SDK 同源代取），不做 UI。
 */

/** 解析后的单个调用栈帧 */
export interface StackFrame {
  /** 函数名（匿名帧为 undefined） */
  fn?: string;
  /** 脚本 URL */
  url: string;
  /** 行号（1-based，来自浏览器堆栈） */
  line: number;
  /** 列号（1-based，来自浏览器堆栈） */
  col: number;
}

/** 还原后的原始位置 */
export interface OriginalPosition {
  /** 原始源文件路径（source map 中的 source，如 webpack://app/src/Foo.tsx） */
  source: string;
  /** 原始行号（1-based） */
  line: number;
  /** 原始列号（0-based，source-map 原生口径） */
  column: number;
  /** 原始符号名（如可还原） */
  name?: string;
}

/** 源码片段 */
export interface Snippet {
  /** 片段首行的行号（1-based） */
  startLine: number;
  /** 片段各行文本（不含换行符） */
  lines: string[];
  /** 目标行在 lines 中的下标（0-based），便于高亮 */
  focusIndex: number;
}

/** 绑定单张 source map 的还原器（consumer 仅构建一次，复用于多帧还原） */
export interface Resolver {
  /** 该 map 覆盖的原始源文件列表 */
  readonly sources: string[];
  /** 把 bundle 位置（1-based line / 1-based col）还原为原始位置；失败返回 null */
  resolve(line: number, col: number): OriginalPosition | null;
  /** 取某原始源文件的完整内容（来自 sourcesContent）；缺失返回 null */
  sourceContent(source: string): string | null;
}

/**
 * 从脚本内容尾部解析 `//# sourceMappingURL=` 注释值。
 * 兼容旧式 `//@`。返回最后一处匹配（注释通常在文件末尾）。
 */
export function parseSourceMappingURL(content: string): string | null {
  const re = /\/\/[#@]\s*sourceMappingURL=(\S+)/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    last = m[1];
  }
  return last;
}

const V8_WITH_FN = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const V8_BARE = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;
const FIREFOX = /^(.*?)@(.+):(\d+):(\d+)\s*$/;

/**
 * 解析 Error.stack 为结构化帧列表。兼容 Chrome/V8 与 Firefox 两种格式。
 * 无法解析的行（如 `<anonymous>`、消息首行）会被跳过。
 */
export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trimEnd();
    let m = V8_WITH_FN.exec(line);
    if (m) {
      frames.push({ fn: m[1], url: m[2], line: +m[3], col: +m[4] });
      continue;
    }
    m = V8_BARE.exec(line);
    if (m) {
      frames.push({ url: m[1], line: +m[2], col: +m[3] });
      continue;
    }
    m = FIREFOX.exec(line);
    if (m) {
      frames.push({ fn: m[1] || undefined, url: m[2], line: +m[3], col: +m[4] });
      continue;
    }
  }
  return frames;
}

/**
 * 从完整源码中截取以 `line` 为中心、上下各 `radius` 行的片段。
 * `line` 为 1-based；返回片段首行号与目标行下标，便于高亮。
 */
export function sliceSnippet(source: string, line: number, radius = 10): Snippet {
  const all = source.split('\n');
  const start = Math.max(1, line - radius);
  const end = Math.min(all.length, line + radius);
  return {
    startLine: start,
    lines: all.slice(start - 1, end),
    focusIndex: line - start,
  };
}

/**
 * 构建一个绑定该 map 的还原器。map 解析失败（非法 JSON 或缺字段）返回 null，
 * 由调用方优雅降级（退回仅展示压缩位置）。
 */
export function createResolver(mapJson: string): Resolver | null {
  let consumer: SourceMapConsumer;
  try {
    const raw = JSON.parse(mapJson) as RawSourceMap;
    consumer = new SourceMapConsumer(raw);
  } catch {
    return null;
  }

  return {
    get sources(): string[] {
      // source-map-js 在 consumer 上暴露 sources 数组
      return (consumer as unknown as { sources: string[] }).sources ?? [];
    },
    resolve(line: number, col: number): OriginalPosition | null {
      try {
        const pos = consumer.originalPositionFor({
          line,
          column: Math.max(0, col - 1), // 堆栈列 1-based → source-map 0-based
        });
        if (!pos || pos.source == null || pos.line == null) return null;
        return {
          source: pos.source,
          line: pos.line,
          column: pos.column ?? 0,
          name: pos.name ?? undefined,
        };
      } catch {
        return null;
      }
    },
    sourceContent(source: string): string | null {
      try {
        return consumer.sourceContentFor(source, true) ?? null;
      } catch {
        return null;
      }
    },
  };
}
