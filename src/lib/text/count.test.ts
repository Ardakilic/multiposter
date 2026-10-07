import { describe, expect, it } from 'vitest';
import { codePoints, graphemes } from './count';

describe('count', () => {
  it('counts graphemes', () => {
    expect(graphemes('')).toBe(0);
    expect(graphemes('abc')).toBe(3);
    expect(graphemes('👨‍👩‍👧‍👦é')).toBe(2);
    expect(graphemes('日本語')).toBe(3);
  });

  it('counts code points', () => {
    expect(codePoints('a😀')).toBe(2);
    expect(codePoints('👨‍👩‍👧‍👦')).toBe(7);
  });
});
