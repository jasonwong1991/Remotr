import { describe, it, expect } from 'vitest';
import { SourceMapGenerator } from 'source-map-js';
import {
  parseSourceMappingURL,
  parseStack,
  sliceSnippet,
  createResolver,
} from './index.js';

describe('parseSourceMappingURL', () => {
  it('extracts an external .map reference', () => {
    const content = 'console.log(1)\n//# sourceMappingURL=app.min.js.map\n';
    expect(parseSourceMappingURL(content)).toBe('app.min.js.map');
  });

  it('extracts an inline data URI', () => {
    const content = '0\n//# sourceMappingURL=data:application/json;base64,eyJ2IjozfQ==';
    expect(parseSourceMappingURL(content)).toBe(
      'data:application/json;base64,eyJ2IjozfQ==',
    );
  });

  it('supports the legacy //@ form and returns the last match', () => {
    const content = '//# sourceMappingURL=old.map\ncode\n//@ sourceMappingURL=new.map';
    expect(parseSourceMappingURL(content)).toBe('new.map');
  });

  it('returns null when absent', () => {
    expect(parseSourceMappingURL('just code')).toBeNull();
  });
});

describe('parseStack', () => {
  it('parses V8 frames with and without function names', () => {
    const stack = [
      'Error: boom',
      '    at handleClick (https://app.example.com/js/main.abc.js:1:2345)',
      '    at https://app.example.com/js/main.abc.js:2:10',
    ].join('\n');
    const frames = parseStack(stack);
    expect(frames).toEqual([
      { fn: 'handleClick', url: 'https://app.example.com/js/main.abc.js', line: 1, col: 2345 },
      { url: 'https://app.example.com/js/main.abc.js', line: 2, col: 10 },
    ]);
  });

  it('parses Firefox frames', () => {
    const stack = 'handleClick@https://app.example.com/js/main.abc.js:1:2345';
    const frames = parseStack(stack);
    expect(frames).toEqual([
      { fn: 'handleClick', url: 'https://app.example.com/js/main.abc.js', line: 1, col: 2345 },
    ]);
  });
});

describe('sliceSnippet', () => {
  const source = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');

  it('centers on the target line with the given radius', () => {
    const snip = sliceSnippet(source, 10, 2);
    expect(snip.startLine).toBe(8);
    expect(snip.lines).toEqual(['line8', 'line9', 'line10', 'line11', 'line12']);
    expect(snip.lines[snip.focusIndex]).toBe('line10');
  });

  it('clamps near the top of file', () => {
    const snip = sliceSnippet(source, 2, 5);
    expect(snip.startLine).toBe(1);
    expect(snip.lines[snip.focusIndex]).toBe('line2');
  });
});

describe('createResolver', () => {
  const original = 'function handleClick() {\n  throw new Error("boom");\n}\n';

  function makeMap(): string {
    const gen = new SourceMapGenerator({ file: 'app.min.js' });
    // 压缩后 (1,100) ← 原始 src/Foo.tsx (2,2) 符号 handleClick
    gen.addMapping({
      generated: { line: 1, column: 100 },
      original: { line: 2, column: 2 },
      source: 'src/Foo.tsx',
      name: 'handleClick',
    });
    gen.setSourceContent('src/Foo.tsx', original);
    return gen.toString();
  }

  it('resolves a generated position back to the original source', () => {
    const resolver = createResolver(makeMap());
    expect(resolver).not.toBeNull();
    // 堆栈列 101 (1-based) → 100 (0-based) 命中映射
    const pos = resolver!.resolve(1, 101);
    expect(pos).toMatchObject({ source: 'src/Foo.tsx', line: 2, name: 'handleClick' });
  });

  it('returns the embedded original source content', () => {
    const resolver = createResolver(makeMap());
    expect(resolver!.sourceContent('src/Foo.tsx')).toBe(original);
    expect(resolver!.sources).toContain('src/Foo.tsx');
  });

  it('returns null for an unmapped position', () => {
    const resolver = createResolver(makeMap());
    expect(resolver!.resolve(99, 0)).toBeNull();
  });

  it('returns null on invalid map JSON (graceful degradation)', () => {
    expect(createResolver('not json')).toBeNull();
  });
});
