import { getMirror } from './rrweb.js';

/**
 * ElementRegistry: Maintains mapping between rrweb node IDs and live DOM elements.
 * Uses rrweb's mirror API for accurate ID mapping, with fallback to manual traversal.
 */
export class ElementRegistry {
  private map: Map<number, HTMLElement> = new Map();

  /**
   * Rebuild the registry by walking the DOM tree and assigning sequential IDs.
   * This is a fallback for when rrweb mirror is not available.
   */
  rebuild(): void {
    this.map.clear();
    let nextId = 1;

    const walk = (node: Node): void => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        this.map.set(nextId++, element);
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
   * First attempts to use rrweb's mirror, then falls back to internal map.
   * Returns null if the ID is not found or the element has been detached.
   */
  resolve(rrwebId: number): HTMLElement | null {
    // Try rrweb mirror first
    const mirror = getMirror();
  if (mirror && mirror.getNode) {
      try {
        const node = mirror.getNode(rrwebId);
     if (node && node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          // Verify it's still attached
          if (document.contains(element)) {
            return element;
          }
        }
      } catch {
      // Fall through to map lookup
      }
    }

    // Fallback to internal map
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

    // Fallback to reverse lookup in internal map
    for (const [id, el] of this.map.entries()) {
      if (el === element) {
        return id;
      }
    }
    return undefined;
  }
}
