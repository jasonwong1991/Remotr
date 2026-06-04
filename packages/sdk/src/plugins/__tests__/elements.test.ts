import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { installElements } from '../elements.js';
import type { Transport } from '../../transport.js';
import type { ElementsGetComputedStylesCmd } from '@remotr/shared';

describe('Elements Plugin', () => {
  let transport: Transport;
  let commandHandlers: Map<string, (data: unknown) => Promise<unknown> | unknown>;
  let connectedCallbacks: Array<() => void>;

  beforeEach(() => {
    // Setup mock transport
    commandHandlers = new Map();
    connectedCallbacks = [];

    transport = {
      onCommand: vi.fn((method: string, handler: (data: unknown) => Promise<unknown> | unknown) => {
        commandHandlers.set(method, handler);
      }),
      onConnected: vi.fn((callback: () => void) => {
        connectedCallbacks.push(callback);
      }),
      send: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
    } as unknown as Transport;

    // Setup DOM
    document.body.innerHTML = `
      <div id="test-container">
        <h1 class="title">Test Title</h1>
        <p class="content">Test content</p>
        <span style="color: red; font-size: 16px;">Styled span</span>
      </div>
    `;

    // Mock getComputedStyle
    vi.stubGlobal('getComputedStyle', (_element: Element) => {
      const mockStyles = new Map<string, string>([
        ['display', 'block'],
        ['position', 'static'],
        ['color', 'rgb(255, 0, 0)'],
        ['font-size', '16px'],
        ['width', '100px'],
        ['height', '50px'],
        ['margin', '0px'],
        ['padding', '10px'],
        ['border', '1px solid black'],
        ['font-family', 'Arial'],
        ['font-weight', '400'],
        ['background-color', 'rgb(255, 255, 255)'],
        ['opacity', '1'],
        ['z-index', 'auto'],
      ]);

      return {
        getPropertyValue: (prop: string) => mockStyles.get(prop) || '',
        length: mockStyles.size,
        item: (index: number) => Array.from(mockStyles.keys())[index] || '',
        [Symbol.iterator]: function* () {
          yield* mockStyles.keys();
        },
      } as CSSStyleDeclaration;
    });

    installElements(transport);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('installElements', () => {
    it('should register command handlers', () => {
      expect(transport.onCommand).toHaveBeenCalledWith('element.resolve', expect.any(Function));
      expect(transport.onCommand).toHaveBeenCalledWith('element.register', expect.any(Function));
      expect(transport.onCommand).toHaveBeenCalledWith('element.isAttached', expect.any(Function));
      expect(transport.onCommand).toHaveBeenCalledWith('elements.getComputedStyles', expect.any(Function));
    });

    it('should register onConnected callback', () => {
      expect(transport.onConnected).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should rebuild registry on connected', () => {
      // Trigger connected callback
      connectedCallbacks.forEach(cb => cb());

      // Verify registry was rebuilt by trying to resolve elements
      const resolveHandler = commandHandlers.get('element.resolve')!;
      const result = resolveHandler({ rrwebId: 1 }) as { element: { tag: string } | null };

      // Should find some element after rebuild (id 1 = html element)
      expect(result.element).toBeTruthy();
    });
  });

  describe('elements.getComputedStyles command', () => {
    beforeEach(() => {
      // Rebuild registry to assign IDs
      connectedCallbacks.forEach(cb => cb());
    });

    it('should return computed styles for valid element', async () => {
      const handler = commandHandlers.get('elements.getComputedStyles')!;

      // Register the element manually via element.register command
      const registerHandler = commandHandlers.get('element.register')!;
      registerHandler({ selector: 'h1', rrwebId: 100 });

      const cmd: ElementsGetComputedStylesCmd = { nodeId: 100 };
      const result = await handler(cmd) as { styles: Record<string, string> };

      expect(result).toBeDefined();
      expect(result.styles).toBeDefined();
      expect(typeof result.styles).toBe('object');
      expect(result.styles.display).toBe('block');
      expect(result.styles.position).toBe('static');
    });

    it('should throw error for invalid nodeId', async () => {
      const handler = commandHandlers.get('elements.getComputedStyles')!;

      const cmd: ElementsGetComputedStylesCmd = { nodeId: 999999 };

      await expect(handler(cmd)).rejects.toThrow('Element not found for nodeId: 999999');
    });

    it('should throw error for detached element', async () => {
      // Note: resolve() in ElementRegistry already returns null for detached elements,
      // so getComputedStyles throws "Element not found" (not "detached") when
      // an element is removed from the DOM after being registered.
      const handler = commandHandlers.get('elements.getComputedStyles')!;
      const registerHandler = commandHandlers.get('element.register')!;

      // Register an attached element first
      registerHandler({ selector: 'h1', rrwebId: 200 });

      // Then detach it
      document.querySelector('h1')?.remove();

      const cmd: ElementsGetComputedStylesCmd = { nodeId: 200 };

      // resolve() detects detachment and returns null → "Element not found"
      await expect(handler(cmd)).rejects.toThrow('Element not found for nodeId: 200');
    });

    it('should filter properties when specified', async () => {
      const handler = commandHandlers.get('elements.getComputedStyles')!;
      const registerHandler = commandHandlers.get('element.register')!;
      registerHandler({ selector: 'span', rrwebId: 300 });

      const cmd: ElementsGetComputedStylesCmd = {
        nodeId: 300,
        properties: ['color', 'font-size', 'width'],
      };

      const result = await handler(cmd) as { styles: Record<string, string> };

      expect(result.styles).toBeDefined();
      expect(Object.keys(result.styles).length).toBeLessThanOrEqual(3);
      expect(result.styles.color).toBe('rgb(255, 0, 0)');
      expect(result.styles['font-size']).toBe('16px');
      expect(result.styles.width).toBe('100px');
    });

    it('should return default properties when none specified', async () => {
      const handler = commandHandlers.get('elements.getComputedStyles')!;
      const registerHandler = commandHandlers.get('element.register')!;
      registerHandler({ selector: 'p', rrwebId: 400 });

      const cmd: ElementsGetComputedStylesCmd = { nodeId: 400 };
      const result = await handler(cmd) as { styles: Record<string, string> };

      expect(result.styles).toBeDefined();
      // Default property list has many entries, and mock returns values for most
      expect(Object.keys(result.styles).length).toBeGreaterThan(5);
      expect(result.styles.display).toBeDefined();
      expect(result.styles.position).toBeDefined();
      expect(result.styles.width).toBeDefined();
      expect(result.styles.height).toBeDefined();
    });

    it('should skip properties with empty values gracefully', async () => {
      const handler = commandHandlers.get('elements.getComputedStyles')!;
      const registerHandler = commandHandlers.get('element.register')!;
      registerHandler({ selector: 'h1', rrwebId: 500 });

      const cmd: ElementsGetComputedStylesCmd = {
        nodeId: 500,
        // 'invalid-property-xyz' returns '' from mock, so it's excluded
        properties: ['color', 'invalid-property-xyz', 'width'],
      };

      const result = await handler(cmd) as { styles: Record<string, string> };

      expect(result.styles).toBeDefined();
      expect(result.styles.color).toBeDefined();
      expect(result.styles.width).toBeDefined();
      // Property that returns empty string should be absent
      expect(result.styles['invalid-property-xyz']).toBeUndefined();
    });
  });

  describe('element.resolve command', () => {
    beforeEach(() => {
      connectedCallbacks.forEach(cb => cb());
    });

    it('should resolve registered element', () => {
      const registerHandler = commandHandlers.get('element.register')!;
      registerHandler({ selector: 'h1', rrwebId: 100 });

      const resolveHandler = commandHandlers.get('element.resolve')!;
      const result = resolveHandler({ rrwebId: 100 }) as { element: { tag: string; classes: string } };

      expect(result.element).toBeTruthy();
      expect(result.element.tag).toBe('H1');
      expect(result.element.classes).toBe('title');
    });

    it('should return error for non-existent element', () => {
      const resolveHandler = commandHandlers.get('element.resolve')!;
      const result = resolveHandler({ rrwebId: 999 }) as { element: null; error: string };

      expect(result.element).toBeNull();
      expect(result.error).toContain('not found');
    });
  });

  describe('element.register command', () => {
    it('should register element with selector', () => {
      const registerHandler = commandHandlers.get('element.register')!;
      const result = registerHandler({ selector: 'h1', rrwebId: 100 }) as { ok: boolean };

      expect(result.ok).toBe(true);
    });

    it('should return error for invalid selector', () => {
      const registerHandler = commandHandlers.get('element.register')!;
      const result = registerHandler({ selector: '.non-existent', rrwebId: 100 }) as { ok: boolean; error: string };

      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('element.isAttached command', () => {
    beforeEach(() => {
      connectedCallbacks.forEach(cb => cb());
    });

    it('should return true for attached element', () => {
      const registerHandler = commandHandlers.get('element.register')!;
      registerHandler({ selector: 'h1', rrwebId: 100 });

      const isAttachedHandler = commandHandlers.get('element.isAttached')!;
      const result = isAttachedHandler({ rrwebId: 100 }) as { attached: boolean };

      expect(result.attached).toBe(true);
    });

    it('should return false for detached element', () => {
      const registerHandler = commandHandlers.get('element.register')!;
      registerHandler({ selector: 'h1', rrwebId: 100 });

      // Detach the element
      document.querySelector('h1')?.remove();

      const isAttachedHandler = commandHandlers.get('element.isAttached')!;
      const result = isAttachedHandler({ rrwebId: 100 }) as { attached: boolean };

      expect(result.attached).toBe(false);
    });

    it('should return false for non-existent element', () => {
      const isAttachedHandler = commandHandlers.get('element.isAttached')!;
      const result = isAttachedHandler({ rrwebId: 999 }) as { attached: boolean };

      expect(result.attached).toBe(false);
    });
  });
});
