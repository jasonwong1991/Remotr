import type {
  ComponentAncestor,
  DetectedFramework,
  FrameworkInspectCmd,
  FrameworkInspectResult,
} from '@remotr/shared';
import type { Transport } from '../transport.js';
import { serialize } from '../serializer.js';
import { getMirror } from './rrweb.js';

/**
 * Framework 插件:框架组件检查(React / Vue3 / Vue2)。
 *
 * 面板传入 rrweb nodeId,SDK 经 mirror 解析为真实 DOM 元素,再按节点探测框架:
 *  - React 16+:元素上的 `__reactFiber$xxx`(或旧版 `__reactInternalInstance$xxx`)
 *    → fiber 链向上找最近的组件 fiber,读组件名 / memoizedProps / state(hooks 或 class state)
 *  - Vue 3:元素上的 `__vueParentComponent` → 组件实例的 type.name / props / setupState
 *  - Vue 2:元素上的 `__vue__` → $options.name / $props / $data
 *
 * 这些是 React DevTools / Vue DevTools 读组件的同一套入口,不受压缩混淆影响。
 * 按节点探测(而非全局一次性判定):同一页面混用多框架时各元素命中各自的框架。
 * 只读不写:检查绝不修改组件状态。
 */
export function installFramework(transport: Transport): void {
  transport.onCommand('framework.inspect', (data) => {
    const { nodeId } = data as FrameworkInspectCmd;
    const el = resolveElement(nodeId);
    if (!el) {
      return { framework: null, error: `Cannot resolve node ${nodeId} to a live element` };
    }
    return inspectElement(el);
  });
}

/** rrweb nodeId → 真实元素(与 elements 插件同路径:mirror 优先) */
function resolveElement(nodeId: number): HTMLElement | null {
  const mirror = getMirror();
  if (mirror?.getNode) {
    try {
      const node = mirror.getNode(nodeId);
      if (node && node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (document.contains(el)) return el;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** 按节点探测框架并提取组件信息;全部失败返回 framework:null */
function inspectElement(el: HTMLElement): FrameworkInspectResult {
  // 探测顺序:Vue3 → Vue2 → React。
  // Vue 的标记是专属键名,误报率为零;React 键带随机后缀需要遍历,放最后。
  try {
    const vue3 = inspectVue3(el);
    if (vue3) return vue3;
  } catch {
    /* try next */
  }
  try {
    const vue2 = inspectVue2(el);
    if (vue2) return vue2;
  } catch {
    /* try next */
  }
  try {
    const react = inspectReact(el);
    if (react) return react;
  } catch {
    /* fall through */
  }
  return { framework: null, error: 'Element does not belong to a React/Vue component tree' };
}

// ───────────────────────── React ─────────────────────────

/** React fiber 的最小结构(只声明用到的字段) */
interface FiberNode {
  tag: number;
  type: unknown;
  return: FiberNode | null;
  memoizedProps: unknown;
  memoizedState: unknown;
  stateNode: unknown;
}

/** React 组件 fiber 的 tag 值(react-reconciler WorkTag,自 React 16 起稳定) */
const REACT_FUNCTION_COMPONENT = 0;
const REACT_CLASS_COMPONENT = 1;
const REACT_FORWARD_REF = 11;
const REACT_MEMO_COMPONENT = 14;
const REACT_SIMPLE_MEMO_COMPONENT = 15;

const REACT_COMPONENT_TAGS = new Set([
  REACT_FUNCTION_COMPONENT,
  REACT_CLASS_COMPONENT,
  REACT_FORWARD_REF,
  REACT_MEMO_COMPONENT,
  REACT_SIMPLE_MEMO_COMPONENT,
]);

/** 沿元素向上找带 fiber 键的节点(文本/注释节点没有 fiber,元素一般都有) */
function findFiber(el: HTMLElement): FiberNode | null {
  let node: HTMLElement | null = el;
  // 最多向上找 3 层:被选元素自身通常就有;Portal 边界等少数情况需借父级
  for (let depth = 0; node && depth < 3; depth++) {
    for (const key of Object.keys(node)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        return (node as unknown as Record<string, unknown>)[key] as FiberNode;
      }
    }
    node = node.parentElement;
  }
  return null;
}

function isComponentFiber(fiber: FiberNode): boolean {
  return REACT_COMPONENT_TAGS.has(fiber.tag);
}

/** 从 fiber.type 提取组件显示名(memo/forwardRef 解包) */
function reactComponentName(type: unknown): string {
  if (typeof type === 'function') {
    return (type as { displayName?: string; name?: string }).displayName || (type as { name?: string }).name || 'Anonymous';
  }
  if (type && typeof type === 'object') {
    const t = type as { displayName?: string; render?: { name?: string }; type?: unknown };
    if (t.displayName) return t.displayName;
    // forwardRef: { render: fn } / memo: { type: inner }
    if (t.render?.name) return t.render.name;
    if (t.type) return reactComponentName(t.type);
  }
  return 'Anonymous';
}

/**
 * 提取 React 函数组件 hooks 链上的 state:
 * memoizedState 是 hook 链表,每个 hook 的 memoizedState 是该 hook 的值。
 * 只收集"像 useState/useReducer"的 hook(带 queue 的),其余(effect 等)跳过。
 */
function reactHooksState(fiber: FiberNode): unknown[] {
  const states: unknown[] = [];
  let hook = fiber.memoizedState as { memoizedState?: unknown; queue?: unknown; next?: unknown } | null;
  let guard = 0;
  while (hook && typeof hook === 'object' && guard++ < 64) {
    if (hook.queue != null) states.push(hook.memoizedState);
    hook = hook.next as typeof hook;
  }
  return states;
}

function inspectReact(el: HTMLElement): FrameworkInspectResult | null {
  const hostFiber = findFiber(el);
  if (!hostFiber) return null;

  // 从宿主 fiber 沿 return 链向上找最近的组件 fiber
  let fiber: FiberNode | null = hostFiber;
  let guard = 0;
  while (fiber && !isComponentFiber(fiber) && guard++ < 200) {
    fiber = fiber.return;
  }
  if (!fiber || !isComponentFiber(fiber)) {
    return { framework: 'react', error: 'Element is not rendered by a component (host root?)' };
  }

  // 组件祖先链(继续向上收集组件 fiber 的名字)
  const ancestors: ComponentAncestor[] = [];
  let cursor = fiber.return;
  guard = 0;
  while (cursor && guard++ < 200 && ancestors.length < 20) {
    if (isComponentFiber(cursor)) {
      ancestors.push({ name: reactComponentName(cursor.type) });
    }
    cursor = cursor.return;
  }

  // state:类组件读 stateNode.state;函数组件读 hooks 链
  let state: unknown;
  if (fiber.tag === REACT_CLASS_COMPONENT) {
    state = (fiber.stateNode as { state?: unknown } | null)?.state;
  } else {
    const hooks = reactHooksState(fiber);
    state = hooks.length > 0 ? hooks : undefined;
  }

  return {
    framework: 'react',
    componentName: reactComponentName(fiber.type),
    props: fiber.memoizedProps != null ? serialize(fiber.memoizedProps) : undefined,
    state: state != null ? serialize(state) : undefined,
    ancestors,
  };
}

// ───────────────────────── Vue 3 ─────────────────────────

/** Vue3 组件内部实例的最小结构 */
interface Vue3Instance {
  type: { name?: string; __name?: string } | null;
  parent: Vue3Instance | null;
  props: unknown;
  setupState: unknown;
  data: unknown;
}

function vue3ComponentName(inst: Vue3Instance): string {
  return inst.type?.name || inst.type?.__name || 'Anonymous';
}

function inspectVue3(el: HTMLElement): FrameworkInspectResult | null {
  // __vueParentComponent 挂在组件根元素及其内部元素上;向上最多找 3 层
  let node: HTMLElement | null = el;
  let inst: Vue3Instance | null = null;
  for (let depth = 0; node && depth < 3; depth++) {
    const candidate = (node as unknown as { __vueParentComponent?: Vue3Instance }).__vueParentComponent;
    if (candidate) {
      inst = candidate;
      break;
    }
    node = node.parentElement;
  }
  if (!inst) return null;

  const ancestors: ComponentAncestor[] = [];
  let cursor = inst.parent;
  let guard = 0;
  while (cursor && guard++ < 100 && ancestors.length < 20) {
    ancestors.push({ name: vue3ComponentName(cursor) });
    cursor = cursor.parent;
  }

  // setupState 优先(<script setup> 的变量);options data 存在时合并展示
  const setupState = inst.setupState as Record<string, unknown> | undefined;
  const data = inst.data as Record<string, unknown> | undefined;
  const hasSetup = setupState && Object.keys(setupState).length > 0;
  const hasData = data && Object.keys(data).length > 0;
  const state = hasSetup && hasData ? { ...data, ...setupState } : hasSetup ? setupState : hasData ? data : undefined;

  return {
    framework: 'vue3',
    componentName: vue3ComponentName(inst),
    props: inst.props != null ? serialize(inst.props) : undefined,
    state: state != null ? serialize(state) : undefined,
    ancestors,
  };
}

// ───────────────────────── Vue 2 ─────────────────────────

/** Vue2 实例的最小结构 */
interface Vue2Instance {
  $options: { name?: string; _componentTag?: string } | undefined;
  $parent: Vue2Instance | null;
  $props: unknown;
  $data: unknown;
}

function vue2ComponentName(inst: Vue2Instance): string {
  return inst.$options?.name || inst.$options?._componentTag || 'Anonymous';
}

function inspectVue2(el: HTMLElement): FrameworkInspectResult | null {
  let node: HTMLElement | null = el;
  let inst: Vue2Instance | null = null;
  for (let depth = 0; node && depth < 3; depth++) {
    const candidate = (node as unknown as { __vue__?: Vue2Instance }).__vue__;
    if (candidate) {
      inst = candidate;
      break;
    }
    node = node.parentElement;
  }
  if (!inst) return null;

  const ancestors: ComponentAncestor[] = [];
  let cursor = inst.$parent;
  let guard = 0;
  while (cursor && guard++ < 100 && ancestors.length < 20) {
    ancestors.push({ name: vue2ComponentName(cursor) });
    cursor = cursor.$parent;
  }

  return {
    framework: 'vue2',
    componentName: vue2ComponentName(inst),
    props: inst.$props != null ? serialize(inst.$props) : undefined,
    state: inst.$data != null ? serialize(inst.$data) : undefined,
    ancestors,
  };
}
