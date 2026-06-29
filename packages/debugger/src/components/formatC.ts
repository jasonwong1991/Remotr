/**
 * DevTools 风格的 console 格式字符串处理。
 *
 * 当首个参数是含格式说明符（%c/%s/%d/%i/%f/%o/%O）的字符串时，
 * 按 DevTools 语义消费后续参数：
 *   - %c   切换当前文本样式（消费一个 CSS 字符串参数）
 *   - %s   字符串替换
 *   - %d %i 整数替换
 *   - %f   浮点替换
 *   - %o %O 对象预览替换
 *   - %%   字面量 %
 *
 * 未被格式串消费的尾随参数原样返回（由调用方用 SpyAtomView 渲染）。
 */
import type { SpyAtom } from '@remotr/shared';

export interface StyledSegment {
  text: string;
  /** 已解析为 React style 的样式对象（仅含白名单内的视觉属性） */
  style: React.CSSProperties;
}

export interface ConsoleFormatResult {
  segments: StyledSegment[];
  /** 格式串未消费的尾随参数 */
  rest: SpyAtom[];
}

/** %c 允许的 CSS 属性白名单——只放视觉属性，防止远程样式破坏日志布局。 */
const ALLOWED_CSS = new Set([
  'color',
  'background',
  'background-color',
  'font',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'text-decoration',
  'text-transform',
  'text-shadow',
  'padding',
  'padding-left',
  'padding-right',
  'padding-top',
  'padding-bottom',
  'margin',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'border',
  'border-radius',
  'border-color',
  'border-width',
  'border-style',
  'line-height',
  'letter-spacing',
]);

/** 将 CSS 声明字符串解析为受限的 React style 对象。 */
function cssToStyleObject(css: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_CSS.has(prop)) continue;
    // 拦截 url()——避免加载远程资源 / 被追踪
    if (/url\s*\(/i.test(value)) continue;
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[camel] = value;
  }
  return style as React.CSSProperties;
}

/** 将被替换说明符消费的 atom 转成文本。 */
function substitute(atom: SpyAtom | undefined, spec: string): string {
  if (!atom) return '';
  if (spec === 'd' || spec === 'i') {
    const n = typeof atom.value === 'number' ? atom.value : parseFloat(String(atom.value ?? atom.display));
    return Number.isNaN(n) ? 'NaN' : String(Math.floor(n));
  }
  if (spec === 'f') {
    const n = typeof atom.value === 'number' ? atom.value : parseFloat(String(atom.value ?? atom.display));
    return Number.isNaN(n) ? 'NaN' : String(n);
  }
  // %s / %o / %O：字符串取原始值，其余取预览
  if (atom.type === 'string') return typeof atom.value === 'string' ? atom.value : atom.display;
  return atom.display;
}

const HAS_SPECIFIER = /%[csdifoO]/;

export function formatConsoleArgs(args: SpyAtom[]): ConsoleFormatResult | null {
  if (args.length === 0) return null;
  const first = args[0];
  if (first.type !== 'string' || typeof first.value !== 'string') return null;
  const fmt = first.value;
  if (!HAS_SPECIFIER.test(fmt)) return null;

  const segments: StyledSegment[] = [];
  let currentStyle: React.CSSProperties = {};
  let buffer = '';
  let argIdx = 1; // args[0] 是格式串

  const flush = () => {
    if (buffer !== '') {
      segments.push({ text: buffer, style: currentStyle });
      buffer = '';
    }
  };

  for (let i = 0; i < fmt.length; ) {
    if (fmt[i] === '%' && i + 1 < fmt.length) {
      const spec = fmt[i + 1];
      if (spec === '%') {
        buffer += '%';
        i += 2;
        continue;
      }
      if (spec === 'c') {
        flush();
        const styleAtom = args[argIdx++];
        currentStyle =
          styleAtom && typeof styleAtom.value === 'string' ? cssToStyleObject(styleAtom.value) : {};
        i += 2;
        continue;
      }
      if (spec === 's' || spec === 'd' || spec === 'i' || spec === 'f' || spec === 'o' || spec === 'O') {
        buffer += substitute(args[argIdx++], spec);
        i += 2;
        continue;
      }
    }
    buffer += fmt[i];
    i++;
  }
  flush();

  return { segments, rest: args.slice(argIdx) };
}
