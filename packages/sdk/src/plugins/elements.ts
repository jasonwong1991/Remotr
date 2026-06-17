import type { Transport } from '../transport.js';
import { ElementRegistry } from './element-registry.js';
import { ElementOverlay } from './element-overlay.js';
import { ElementPicker } from './element-picker.js';
import type {
  ElementsGetComputedStylesCmd,
  ElementsGetComputedStylesResult,
  ElementsGetBoxModelCmd,
  ElementsGetBoxModelResult,
  BoxQuad,
  ElementsGetMatchedRulesCmd,
  ElementsGetMatchedRulesResult,
  CSSRule,
  ElementsHighlightCmd,
  ElementsSetStyleCmd,
  ElementsSetForcedStatesCmd,
} from '@remotr/shared';

/** Parse a CSS pixel value like "10px" → 10. Returns 0 for unparseable values. */
function parsePx(value: string): number {
  const n = parseFloat(value);
  return isFinite(n) ? n : 0;
}

/**
 * 计算 CSS 选择器的优先级 [a, b, c]
 * a = ID 选择器数量
 * b = 类选择器 + 属性选择器 + 伪类数量
 * c = 元素选择器 + 伪元素数量
 */
function calculateSpecificity(selector: string): [number, number, number] {
  // 剔除伪元素和字符串内容，避免干扰计数
  const stripped = selector
    .replace(/::[a-zA-Z-]+/g, '\x00PE\x00') // 伪元素占位
    .replace(/(['"]).*?\1/g, '')             // 去除字符串内容
    .replace(/\(.*?\)/g, '()');             // 简化括号内容

  // a: ID 选择器
  const a = (stripped.match(/#[a-zA-Z_-][a-zA-Z0-9_-]*/g) ?? []).length;

  // b: 类选择器、属性选择器、伪类
  const bClasses = (stripped.match(/\.[a-zA-Z_-][a-zA-Z0-9_-]*/g) ?? []).length;
  const bAttrs = (stripped.match(/\[[^\]]*\]/g) ?? []).length;
  const bPseudoClasses = (stripped.match(/:[a-zA-Z-]+(?:\(\))?/g) ?? []).length;
  const b = bClasses + bAttrs + bPseudoClasses;

  // c: 元素选择器、伪元素（占位符计数）
  const cElements = (stripped.match(/(?:^|[\s>+~])([a-zA-Z][a-zA-Z0-9-]*)/g) ?? []).length;
  const cPseudoElements = (stripped.match(/\x00PE\x00/g) ?? []).length;
  const c = cElements + cPseudoElements;

  return [a, b, c];
}

/**
 * 比较两个优先级，返回差值（用于排序）
 * 低优先级在前
 */
function compareSpecificity(
  a: [number, number, number],
  b: [number, number, number],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine whether `element` matches `selector` once the given force-enabled
 * pseudo-classes are stripped from it — e.g. for forced [":hover"], the rule
 * `.btn:hover` matches a `.btn` element. Returns the comma-joined pseudo-classes
 * that were present (and made it match), or undefined if it doesn't apply.
 *
 * The negative lookahead `(?![\w-])` keeps `:focus` from also matching inside
 * `:focus-visible`.
 */
function matchForcedState(
  element: Element,
  selector: string,
  forced: string[],
): string | undefined {
  const present: string[] = [];
  let stripped = selector;
  for (const pseudo of forced) {
    const escaped = escapeRegExp(pseudo);
    if (!new RegExp(escaped + '(?![\\w-])').test(selector)) continue;
    present.push(pseudo);
    stripped = stripped.replace(new RegExp(escaped + '(?![\\w-])', 'g'), '');
  }
  if (present.length === 0) return undefined;

  stripped = stripped.trim();
  if (!stripped) return undefined;

  try {
    if (element.matches(stripped)) return present.join(', ');
  } catch {
    // stripped selector became invalid — ignore
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────
// Forced pseudo-state emulation
//
// We can't reach the rendering engine to force a real :hover, so we emulate
// it in CSS: add a marker class to the element and inject a stylesheet that
// re-creates every :hover/:focus/... rule with the pseudo-class swapped for
// that marker class. A class has the same specificity as a pseudo-class, so
// the cascade is preserved. rrweb captures the marker class and the injected
// <style>, so the mirror renders the forced state too.
// ─────────────────────────────────────────────────────────

/** Forced pseudo-class → the marker class that stands in for it. */
const FORCE_MARKER: Record<string, string> = {
  ':hover': 'remotr-force-hover',
  ':active': 'remotr-force-active',
  ':focus': 'remotr-force-focus',
  ':focus-visible': 'remotr-force-focus-visible',
};

/**
 * Swap each forced pseudo-class in `selector` for its marker class — e.g.
 * `.btn:hover` → `.btn.remotr-force-hover`. The `(?![\w-])` lookahead keeps
 * `:focus` from matching inside `:focus-visible`. Returns the selector
 * unchanged when it references none of the forced pseudo-classes.
 */
function rewriteForcedSelector(selector: string, forced: string[]): string {
  let out = selector;
  for (const pseudo of forced) {
    const marker = FORCE_MARKER[pseudo];
    if (!marker) continue;
    out = out.replace(new RegExp(escapeRegExp(pseudo) + '(?![\\w-])', 'g'), '.' + marker);
  }
  return out;
}

/** Same-origin → 'same-origin'（带 Cookie），跨域 → 'omit'（避免 CORS preflight 拒绝） */
function credentialsFor(url: string): RequestCredentials {
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin ? 'same-origin' : 'omit';
  } catch {
    return 'same-origin';
  }
}

/**
 * 跨域 stylesheet 即便 CDN 返回了 ACAO，缺少 `<link crossorigin>` 属性时
 * 浏览器仍拒绝暴露 cssRules（CSS 安全模型 vs fetch CORS 是两套规则）。
 * 这里用 SDK 同源 fetch 拿到 CSS 文本，再用 Constructable Stylesheet
 * 重建—手工构造的 sheet 没有 CORS 限制，cssRules 可读。按 href 缓存。
 */
const _parsedSheetCache = new Map<string, CSSRuleList | null>();

async function accessibleRules(sheet: CSSStyleSheet): Promise<CSSRuleList | null> {
  try {
    return sheet.cssRules;
  } catch {
    /* CORS — 回退到 fetch + Constructable Stylesheet 重建 */
  }

  const href = sheet.href;
  if (!href) return null;
  if (_parsedSheetCache.has(href)) return _parsedSheetCache.get(href) ?? null;
  if (typeof CSSStyleSheet === 'undefined' || typeof (CSSStyleSheet.prototype as { replaceSync?: unknown }).replaceSync !== 'function') {
    return null;
  }

  try {
    const res = await fetch(href, { credentials: credentialsFor(href) });
    if (!res.ok) {
      _parsedSheetCache.set(href, null);
      return null;
    }
    const text = await res.text();
    const parsed = new CSSStyleSheet();
    parsed.replaceSync(text);
    const rules = parsed.cssRules;
    _parsedSheetCache.set(href, rules);
    return rules;
  } catch (err) {
    console.warn('[remotr] Failed to fetch+parse cross-origin stylesheet:', href, err);
    _parsedSheetCache.set(href, null);
    return null;
  }
}

/**
 * Walk a CSSRuleList and, for every style rule that references a forced
 * pseudo-class and (after rewriting) targets a currently-marked element, push
 * the rewritten rule text into `out`. Recurses into @media / @supports,
 * preserving the wrapping condition via `pre`/`post`. The querySelector check
 * both scopes rules to the forced element(s) — markers are applied first — and
 * keeps the injected sheet small.
 */
function collectForcedRules(
  rules: CSSRuleList,
  forced: string[],
  out: string[],
  pre: string,
  post: string,
): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule instanceof CSSStyleRule) {
      const selector = rule.selectorText;
      const rewritten = rewriteForcedSelector(selector, forced);
      if (rewritten === selector) continue; // no forced pseudo-class in this rule
      let targetsForced = false;
      try {
        targetsForced = document.querySelector(rewritten) !== null;
      } catch {
        continue; // rewritten selector is invalid — skip
      }
      if (!targetsForced) continue;
      const body = rule.style.cssText;
      if (body) out.push(`${pre}${rewritten}{${body}}${post}`);
    } else if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
      collectForcedRules(rule.cssRules, forced, out, `${pre}@media ${rule.conditionText}{`, `}${post}`);
    } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
      collectForcedRules(rule.cssRules, forced, out, `${pre}@supports ${rule.conditionText}{`, `}${post}`);
    }
  }
}

/**
 * Elements 插件：管理 DOM 元素与 rrweb node ID 的映射关系。
 * 用于前端与后端 DOM 定位的关联。
 */
export function installElements(transport: Transport): void {
  const registry = new ElementRegistry();

  // 强制伪类状态：nodeId → 该元素当前强制的伪类集合，以及承载改写规则的注入样式表。
  const forcedByNode = new Map<number, Set<string>>();
  let forcedStyleEl: HTMLStyleElement | null = null;

  /** Rebuild the injected stylesheet from every node's current forced states. */
  async function rebuildForcedStylesheet(): Promise<void> {
    const union = new Set<string>();
    for (const set of forcedByNode.values()) {
      for (const pseudo of set) union.add(pseudo);
    }

    if (union.size === 0) {
      if (forcedStyleEl) forcedStyleEl.textContent = '';
      return;
    }

    if (!forcedStyleEl) {
      forcedStyleEl = document.createElement('style');
      forcedStyleEl.id = '__remotr_forced_pseudo';
      (document.head ?? document.documentElement).appendChild(forcedStyleEl);
    }

    const forced = Array.from(union);
    const out: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode === forcedStyleEl) continue; // never rewrite our own sheet
      const rules = await accessibleRules(sheet);
      if (rules) collectForcedRules(rules, forced, out, '', '');
    }
    forcedStyleEl.textContent = out.join('\n');
  }

  // 创建 overlay 和 picker 实例
  const overlay = new ElementOverlay();
  const picker = new ElementPicker(overlay, (element: HTMLElement) => {
    // 当用户选择元素时，查找其 rrweb ID 并发送事件
    const rrwebId = registry.getRrwebId(element);
    if (rrwebId !== undefined) {
      transport.send('elements.picked', { nodeId: rrwebId });
    } else {
      console.warn('[remotr] Picked element has no rrweb ID');
    }
  });

  // 连接时初始化元素注册表
  transport.onConnected(() => {
    registry.rebuild();
  });

  // 处理元素查询命令
  transport.onCommand('element.resolve', (data) => {
    const { rrwebId } = data as { rrwebId: number };
    const element = registry.resolve(rrwebId);
    if (!element) {
      return { element: null, error: `Element with rrwebId ${rrwebId} not found` };
    }
    return { element: { tag: element.tagName, classes: element.className } };
  });

  // 处理元素注册命令
  transport.onCommand('element.register', (data) => {
    const { selector, rrwebId } = data as { selector: string; rrwebId: number };
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
      return { ok: false, error: `Element matching selector "${selector}" not found` };
    }
    registry.register(element, rrwebId);
    return { ok: true };
  });

  // 处理元素检测命令
  transport.onCommand('element.isAttached', (data) => {
    const { rrwebId } = data as { rrwebId: number };
    return { attached: registry.isAttached(rrwebId) };
  });

  // 处理元素高亮命令
  transport.onCommand('elements.highlight', (data) => {
    const cmd = data as ElementsHighlightCmd;

    if (cmd.nodeId === null) {
      overlay.hide();
      return { ok: true };
    }

    const element = registry.resolve(cmd.nodeId);
    if (!element) {
      overlay.hide();
      return { ok: false, error: `Element not found for nodeId: ${cmd.nodeId}` };
    }

    overlay.show(element);
    return { ok: true };
  });

  // 处理启动元素选择器命令
  transport.onCommand('elements.startPicker', () => {
    console.log('[remotr] elements.startPicker command received');
    picker.start();
    return { ok: true };
  });

  // 处理停止元素选择器命令
  transport.onCommand('elements.stopPicker', () => {
    picker.stop();
    return { ok: true };
  });

  // 处理设置内联样式命令
  transport.onCommand('elements.setStyle', (data) => {
    const cmd = data as ElementsSetStyleCmd;
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

    element.style.setProperty(cmd.property, cmd.value);
    return { ok: true };
  });

  transport.onCommand('elements.deleteNode', (data) => {
    const cmd = data as { nodeId: number };
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

    element.remove();
    return { ok: true };
  });

  // 处理编辑 outerHTML 命令
  transport.onCommand('elements.setHTML', (data) => {
    const cmd = data as { nodeId: number; outerHTML: string };
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

    element.outerHTML = cmd.outerHTML;
    return { ok: true };
  });

  // 处理滚动到视图命令
  transport.onCommand('elements.scrollIntoView', (data) => {
    const cmd = data as { nodeId: number };
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { ok: true };
  });

  // 处理强制伪类状态命令：在真实 DOM 上模拟 :hover/:focus/... 以便镜像呈现
  transport.onCommand('elements.setForcedStates', (data) => {
    const cmd = data as ElementsSetForcedStatesCmd;
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    const states = (cmd.states ?? []).filter((s) => s in FORCE_MARKER);

    // 先清掉该元素已有的标记类，再按当前请求重新打上（标记类必须在重建样式表前就位）
    for (const marker of Object.values(FORCE_MARKER)) {
      element.classList.remove(marker);
    }
    for (const state of states) {
      element.classList.add(FORCE_MARKER[state]);
    }

    if (states.length > 0) {
      forcedByNode.set(cmd.nodeId, new Set(states));
    } else {
      forcedByNode.delete(cmd.nodeId);
    }

    // rebuildForcedStylesheet 现在是 async（跨域 fetch 重建样式表）；
    // 标记类已同步应用，注入样式表就绪即可，主流程不阻塞。
    void rebuildForcedStylesheet();
    return { ok: true };
  });

  // 处理获取计算样式命令
  transport.onCommand('elements.getComputedStyles', async (data): Promise<ElementsGetComputedStylesResult> => {
    const cmd = data as ElementsGetComputedStylesCmd;
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

    const computed = window.getComputedStyle(element);
    const styles: Record<string, string> = {};

    // 使用指定的属性列表，或使用默认的常用属性
    const props = cmd.properties || [
      // 布局
      'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
      'float', 'clear',
      // 盒模型
      'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
      'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border', 'border-width', 'border-style', 'border-color',
      'box-sizing',
      // 排版
      'font-family', 'font-size', 'font-weight', 'line-height', 'color',
      'text-align', 'text-decoration', 'text-transform',
      // 视觉效果
      'background', 'background-color', 'background-image',
      'opacity', 'visibility',
      // Flexbox
      'flex', 'flex-direction', 'align-items', 'justify-content',
      // Grid
      'grid-template-columns', 'grid-template-rows'
    ];

    for (const prop of props) {
      try {
        const value = computed.getPropertyValue(prop);
        if (value) {
          styles[prop] = value;
        }
      } catch {
        // 跳过无效属性
      }
    }

    return { styles };
  });

  // 处理获取盒模型命令
  transport.onCommand('elements.getBoxModel', async (data): Promise<ElementsGetBoxModelResult> => {
    const cmd = data as ElementsGetBoxModelCmd;
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);

    const marginTop    = parsePx(computed.getPropertyValue('margin-top'));
    const marginRight  = parsePx(computed.getPropertyValue('margin-right'));
    const marginBottom = parsePx(computed.getPropertyValue('margin-bottom'));
    const marginLeft   = parsePx(computed.getPropertyValue('margin-left'));

    const paddingTop    = parsePx(computed.getPropertyValue('padding-top'));
    const paddingRight  = parsePx(computed.getPropertyValue('padding-right'));
    const paddingBottom = parsePx(computed.getPropertyValue('padding-bottom'));
    const paddingLeft   = parsePx(computed.getPropertyValue('padding-left'));

    const borderTop    = parsePx(computed.getPropertyValue('border-top-width'));
    const borderRight  = parsePx(computed.getPropertyValue('border-right-width'));
    const borderBottom = parsePx(computed.getPropertyValue('border-bottom-width'));
    const borderLeft   = parsePx(computed.getPropertyValue('border-left-width'));

    // content box: the inner rect (border-box minus border minus padding)
    const contentX = rect.x + borderLeft + paddingLeft;
    const contentY = rect.y + borderTop  + paddingTop;
    const contentW = rect.width  - borderLeft - borderRight  - paddingLeft - paddingRight;
    const contentH = rect.height - borderTop  - borderBottom - paddingTop  - paddingBottom;
    const content: BoxQuad = [contentX, contentY, contentW, contentH];

    // padding box: border-box minus border
    const paddingX = rect.x + borderLeft;
    const paddingY = rect.y + borderTop;
    const paddingW = rect.width  - borderLeft - borderRight;
    const paddingH = rect.height - borderTop  - borderBottom;
    const padding: BoxQuad = [paddingX, paddingY, paddingW, paddingH];

    // border box: getBoundingClientRect already includes border
    const border: BoxQuad = [rect.x, rect.y, rect.width, rect.height];

    // margin box: extend border box by margins
    const margin: BoxQuad = [
      rect.x      - marginLeft,
      rect.y      - marginTop,
      rect.width  + marginLeft + marginRight,
      rect.height + marginTop  + marginBottom,
    ];

    return {
      boxModel: {
        content,
        padding,
        border,
        margin,
        offsetTop:  element.offsetTop,
        offsetLeft: element.offsetLeft,
      },
    };
  });

  // 处理获取匹配 CSS 规则命令
  transport.onCommand('elements.getMatchedRules', async (data): Promise<ElementsGetMatchedRulesResult> => {
    const cmd = data as ElementsGetMatchedRulesCmd;
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

    const forced = (cmd.forcedStates ?? []).filter(Boolean);

    // 提取内联样式
    const inlineStyles: Record<string, string> = {};
    const style = (element as HTMLElement).style;
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i);
      const value = style.getPropertyValue(prop);
      if (prop && value) {
        inlineStyles[prop] = value;
      }
    }

    // 遍历所有样式表，收集匹配规则
    const matchedRules: CSSRule[] = [];
    const sheets = Array.from(document.styleSheets);

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
      const sheet = sheets[sheetIndex];
      // Skip our own forced-state sheet — its rewritten rules aren't real matches.
      if (forcedStyleEl && sheet.ownerNode === forcedStyleEl) continue;

      // 跨域样式表 cssRules 直接读会被拒（即便 CDN 配了 ACAO，也需要 <link crossorigin>）；
      // accessibleRules 会回退到 SDK 同源 fetch + Constructable Stylesheet 重建。
      const rules = await accessibleRules(sheet);
      if (!rules) continue;

      const source = sheet.href ?? '<style>';

      for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
        const rule = rules[ruleIndex];

        // 只处理普通样式规则（排除 @media、@keyframes 等）
        if (!(rule instanceof CSSStyleRule)) continue;

        const selector = rule.selectorText;

        let matches = false;
        try {
          matches = element.matches(selector);
        } catch {
          // 跳过无效选择器（如包含不支持的伪类）
          continue;
        }

        // 当伪类被强制开启时，额外纳入"去掉强制伪类后即可匹配"的规则
        // （如强制 :hover 时纳入 .btn:hover），并标记其对应状态。
        let forState: string | undefined;
        if (!matches) {
          if (forced.length === 0) continue;
          forState = matchForcedState(element, selector, forced);
          if (!forState) continue;
        }

        // 提取规则中的样式属性
        const properties: Record<string, string> = {};
        const ruleStyle = rule.style;
        for (let propIndex = 0; propIndex < ruleStyle.length; propIndex++) {
          const prop = ruleStyle.item(propIndex);
          const value = ruleStyle.getPropertyValue(prop);
          if (prop && value) {
            properties[prop] = value;
          }
        }

        matchedRules.push({
          selector,
          styleSheetIndex: sheetIndex,
          source,
          properties,
          specificity: calculateSpecificity(selector),
          forState,
        });
      }
    }

    // 按优先级从低到高排序
    matchedRules.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

    return { inlineStyles, rules: matchedRules };
  });
}
