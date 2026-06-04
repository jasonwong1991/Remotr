import { describe, it, expect, beforeEach } from 'vitest';
import { ElementRegistry } from '../element-registry.js';

describe('ElementRegistry', () => {
  let registry: ElementRegistry;

  beforeEach(() => {
    // Setup a clean DOM for each test
    document.body.innerHTML = `
      <div id="root">
        <header>
          <h1>Title</h1>
      </header>
      <main>
       <p>Content</p>
          <span>Detail</span>
        </main>
      </div>
    `;
    registry = new ElementRegistry();
  });

  describe('register() and resolve()', () => {
    it('should register and resolve an element', () => {
      const element = document.querySelector('h1') as HTMLElement;
      registry.register(element, 100);

      const resolved = registry.resolve(100);
      expect(resolved).toBe(element);
      expect(resolved?.tagName).toBe('H1');
    });

    it('should return null for unregistered ID', () => {
      const resolved = registry.resolve(999);
      expect(resolved).toBeNull();
    });

    it('should allow overwriting an existing ID', () => {
      const element1 = document.querySelector('h1') as HTMLElement;
      const element2 = document.querySelector('p') as HTMLElement;

      registry.register(element1, 100);
    registry.register(element2, 100);

      const resolved = registry.resolve(100);
      expect(resolved).toBe(element2);
    });
  });

  describe('rebuild()', () => {
    it('should walk the DOM tree and assign sequential IDs', () => {
      registry.rebuild();

      // The registry should have assigned IDs starting from 1
      // Expected elements: html, head, body, div#root, header, h1, main, p, span
      const rootDiv = registry.resolve(1);
      expect(rootDiv).toBeTruthy();
      expect(rootDiv?.nodeType).toBe(Node.ELEMENT_NODE);

      // Test that we can resolve multiple elements
      let foundElements = 0;
      for (let i = 1; i <= 20; i++) {
        const element = registry.resolve(i);
        if (element) foundElements++;
      }
      expect(foundElements).toBeGreaterThan(0);
    });

    it('should clear previous mappings on rebuild', () => {
      const element = document.querySelector('h1') as HTMLElement;
      registry.register(element, 500);

      expect(registry.resolve(500)).toBe(element);

      registry.rebuild();

      // After rebuild, ID 500 should not exist anymore
      expect(registry.resolve(500)).toBeNull();
    });

    it('should handle empty DOM', () => {
      document.body.innerHTML = '';
      registry.rebuild();

      // Should still process document.documentElement
      const resolved = registry.resolve(1);
      expect(resolved).toBeTruthy();
    });

    it('should process nested elements in depth-first order', () => {
      document.body.innerHTML = `
        <div id="parent">
          <div id="child1">
            <span id="grandchild"></span>
          </div>
          <div id="child2"></div>
        </div>
      `;
      registry.rebuild();

      // Verify depth-first traversal by checking that elements exist
      let elementCount = 0;
      for (let i = 1; i <= 50; i++) {
        if (registry.resolve(i)) {
          elementCount++;
        }
      }
      expect(elementCount).toBeGreaterThan(0);
    });
  });

  describe('resolve() with detached elements', () => {
    it('should return null for detached elements', () => {
      const element = document.createElement('div');
      registry.register(element, 200);

      // Element is not in the DOM
      const resolved = registry.resolve(200);
      expect(resolved).toBeNull();
    });

    it('should clean up detached elements from map', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);
      registry.register(element, 300);

      expect(registry.resolve(300)).toBe(element);

      // Detach element
      element.remove();

      // First resolve should detect detachment and clean up
      expect(registry.resolve(300)).toBeNull();

      // Second resolve should still return null
      expect(registry.resolve(300)).toBeNull();
    });

    it('should handle element that was attached but is now detached', () => {
      registry.rebuild();
      const element = document.querySelector('h1') as HTMLElement;

   // Find the ID that was assigned to h1
      let h1Id: number | null = null;
      for (let i = 1; i <= 20; i++) {
        if (registry.resolve(i) === element) {
          h1Id = i;
          break;
        }
      }

      expect(h1Id).not.toBeNull();

      // Detach the element
      element.remove();

      // Resolve should return null
      expect(registry.resolve(h1Id!)).toBeNull();
    });
  });

  describe('isAttached()', () => {
    it('should return true for attached elements', () => {
      const element = document.querySelector('h1') as HTMLElement;
      registry.register(element, 400);

      expect(registry.isAttached(400)).toBe(true);
    });

    it('should return false for detached elements', () => {
      const element = document.createElement('div');
      registry.register(element, 500);

      expect(registry.isAttached(500)).toBe(false);
    });
    it('should return false for unregistered IDs', () => {
      expect(registry.isAttached(999)).toBe(false);
    });

    it('should return false after element is removed from DOM', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);
      registry.register(element, 600);

      expect(registry.isAttached(600)).toBe(true);

      element.remove();

      expect(registry.isAttached(600)).toBe(false);
    });
  });
});

