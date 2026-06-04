/**
 * ElementRegistry: Maintains mapping between rrweb node IDs and live DOM elements.
 * Phase 1: Simple sequential ID assignment via DOM traversal.
 */
export class ElementRegistry {
  private map: Map<number, HTMLElement> = new Map();

  /**
   * Rebuild the registry by walking the DOM tree and assigning sequential IDs.
   * This is a simplified heuristic for Phase 1 - actual rrweb ID mapping
   * would require coordination with rrweb's internal ID assignment.
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
   * Returns null if the ID is not found or the element has been detached.
   */
  resolve(rrwebId: number): HTMLElement | null {
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
   * Returns undefined if the element is not in the registry.
   */
  getRrwebId(element: HTMLElement): number | undefined {
    for (const [id, el] of this.map.entries()) {
      if (el === element) {
      return id;
      }
    }
    return undefined;
  }
}
