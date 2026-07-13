import { getMirror } from './rrweb.js';

/**
 * A mirror is "live" only once rrweb is actually recording and has tracked at
 * least one node. rrweb exposes a module-level mirror object at import time
 * whose `idNodeMap` is empty until `record()` runs — treating that empty object
 * as authoritative would wrongly fail-close every lookup even when rrweb is
 * disabled. `mirror.has(id)` (backed by idNodeMap) is the reliable liveness
 * signal; we guard every access defensively since the mirror is untyped.
 */
function isMirrorActive(mirror: unknown): mirror is { getNode(id: number): Node | null } {
  if (!mirror || typeof (mirror as { getNode?: unknown }).getNode !== 'function') return false;
  const idMap = (mirror as { idNodeMap?: { size?: number } }).idNodeMap;
  return !!idMap && typeof idMap.size === 'number' && idMap.size > 0;
}

/**
 * ElementRegistry: Maintains mapping between rrweb node IDs and live DOM elements.
 * Uses rrweb's mirror API for accurate ID mapping, with fallback to manual traversal.
 */
export class ElementRegistry {
  private map: Map<number, HTMLElement> = new Map();
  /**
   * 反向映射 element → id。用 WeakMap 避免对已从 DOM 卸载的元素保持强引用
   * （否则整个注册表会阻止元素被 GC）。getRrwebId 的 O(n) 线性回退因此消除。
   */
  private reverse: WeakMap<HTMLElement, number> = new WeakMap();

  /**
   * Rebuild the registry by walking the DOM tree and assigning sequential IDs.
   * This is a fallback for when rrweb mirror is not available.
   */
  rebuild(): void {
    this.map.clear();
    this.reverse = new WeakMap();
    let nextId = 1;

    const walk = (node: Node): void => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        const id = nextId++;
        this.map.set(id, element);
        this.reverse.set(element, id);
      }

      for (let i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i]);
      }
    };

    if (document.documentElement) {
    walk(document.documentElement);
    }
  }

  /**
   * Resolve an rrweb node ID to its corresponding HTMLElement.
   *
   * The rrweb mirror and the internal `map` live in DIFFERENT ID spaces: the
   * mirror uses rrweb's own node IDs, while `rebuild()` assigns sequential
   * DOM-order IDs. Mixing them silently resolves the WRONG element.
   *
   * So when a LIVE mirror is tracking nodes it is authoritative and consulted
   * EXCLUSIVELY — a miss fails closed (returns null) rather than falling through
   * to the mismatched sequential-ID map. The map is only consulted when no live
   * mirror exists (rrweb disabled / not yet recording), where explicit
   * `register()` entries are the sole source of truth.
   */
  resolve(rrwebId: number): HTMLElement | null {
    const mirror = getMirror();
    if (isMirrorActive(mirror)) {
      try {
        const node = mirror.getNode(rrwebId);
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          if (document.contains(element)) return element;
        }
      } catch {
        /* mirror threw — fall through to fail-closed below */
      }
      // Live mirror is authoritative: never shadow a miss with a sequential-ID
      // map entry (would return a wrong element). Fail closed.
      return null;
    }

    // No live mirror: the internal map is the sole source of truth.
    return this.resolveFromMap(rrwebId);
  }

  /** Look up an ID in the internal map, cleaning up detached entries. */
  private resolveFromMap(rrwebId: number): HTMLElement | null {
    const element = this.map.get(rrwebId);
    if (!element) return null;

    // Check if element is still attached to the DOM
    if (!document.contains(element)) {
      // Clean up detached element
      this.map.delete(rrwebId);
      return null;
    }

    return element;
  }

  /**
   * Manually register an element with a specific rrweb ID.
   * Useful for dynamically created elements or integration with rrweb's ID system.
   */
  register(element: HTMLElement, rrwebId: number): void {
    this.map.set(rrwebId, element);
    this.reverse.set(element, rrwebId);
  }

  /**
   * Check if an element with the given rrweb ID exists and is still attached to the DOM.
   */
  isAttached(rrwebId: number): boolean {
    const element = this.map.get(rrwebId);
    if (!element) return false;
    return document.contains(element);
  }

  /**
   * Get the rrweb ID for a given HTMLElement (reverse lookup).
   * Uses rrweb's mirror API for accurate mapping.
   * Returns undefined if the element is not in rrweb's tracking.
   */
  getRrwebId(element: HTMLElement): number | undefined {
    // Try rrweb mirror first
    const mirror = getMirror();
    if (mirror && mirror.getId) {
      try {
        const id = mirror.getId(element);
        if (id !== undefined && id !== -1) {
          return id;
        }
      } catch {
        // Fall through to map lookup
      }
    }

    // Fallback to reverse lookup for explicitly registered elements (WeakMap:
    // O(1), and holds no strong ref so detached elements can still be GC'd).
    return this.reverse.get(element);
  }
}
