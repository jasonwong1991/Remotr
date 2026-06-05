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

/**
 * Elements 插件：管理 DOM 元素与 rrweb node ID 的映射关系。
 * 用于前端与后端 DOM 定位的关联。
 */
export function installElements(transport: Transport): void {
  const registry = new ElementRegistry();

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
  transport.onCommand('elements.getMatchedRules', (data): ElementsGetMatchedRulesResult => {
    const cmd = data as ElementsGetMatchedRulesCmd;
    const element = registry.resolve(cmd.nodeId);

    if (!element) {
      throw new Error(`Element not found for nodeId: ${cmd.nodeId}`);
    }

    if (!document.contains(element)) {
      throw new Error('Element is detached from DOM');
    }

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
      let rules: CSSRuleList;

      try {
        rules = sheet.cssRules;
      } catch {
        // CORS 限制：跳过无法访问的跨域样式表
        console.warn(`[remotr] Cannot access cssRules for stylesheet at index ${sheetIndex} (CORS restriction)`);
        continue;
      }

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

        if (!matches) continue;

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
        });
      }
    }

    // 按优先级从低到高排序
    matchedRules.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

    return { inlineStyles, rules: matchedRules };
  });
}
