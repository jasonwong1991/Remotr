import { describe, it, expect } from 'vitest';
import { formatConsoleArgs } from '../formatC';
import type { SpyAtom } from '@remotr/shared';

const str = (s: string): SpyAtom => ({ type: 'string', value: s, display: `"${s}"` });
const num = (n: number): SpyAtom => ({ type: 'number', value: n, display: String(n) });
const obj = (display: string): SpyAtom => ({ type: 'object', display });

describe('formatConsoleArgs', () => {
  it('returns null when first arg is not a string', () => {
    expect(formatConsoleArgs([num(1), str('x')])).toBeNull();
  });

  it('returns null when no format specifier present', () => {
    expect(formatConsoleArgs([str('plain text'), str('more')])).toBeNull();
  });

  it('parses the remotr banner %c case', () => {
    const result = formatConsoleArgs([
      str('%c[remotr]%c v0.1.0 connected'),
      str('color:#4caf50;font-weight:bold'),
      str('color:inherit'),
    ]);
    expect(result).not.toBeNull();
    expect(result!.segments).toEqual([
      { text: '[remotr]', style: { color: '#4caf50', fontWeight: 'bold' } },
      { text: ' v0.1.0 connected', style: { color: 'inherit' } },
    ]);
    expect(result!.rest).toEqual([]);
  });

  it('substitutes %s / %d / %f', () => {
    const result = formatConsoleArgs([
      str('user %s age %d score %f'),
      str('alice'),
      num(30),
      num(9.5),
    ]);
    expect(result!.segments).toEqual([{ text: 'user alice age 30 score 9.5', style: {} }]);
  });

  it('handles %% as literal percent', () => {
    const result = formatConsoleArgs([str('100%% done %s'), str('ok')]);
    expect(result!.segments).toEqual([{ text: '100% done ok', style: {} }]);
  });

  it('keeps unconsumed trailing args in rest', () => {
    const extra = obj('Object');
    const result = formatConsoleArgs([str('hi %s'), str('there'), extra]);
    expect(result!.segments).toEqual([{ text: 'hi there', style: {} }]);
    expect(result!.rest).toEqual([extra]);
  });

  it('filters disallowed CSS properties and url()', () => {
    const result = formatConsoleArgs([
      str('%ctext'),
      str('color:red;position:absolute;background:url(http://evil/x.png);font-size:12px'),
    ]);
    expect(result!.segments).toEqual([
      { text: 'text', style: { color: 'red', fontSize: '12px' } },
    ]);
  });

  it('renders %o object preview as text', () => {
    const result = formatConsoleArgs([str('val %o'), obj('Array(3)')]);
    expect(result!.segments).toEqual([{ text: 'val Array(3)', style: {} }]);
  });
});
