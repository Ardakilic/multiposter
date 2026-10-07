import { describe, expect, it } from 'vitest';
import { graphemes } from './count';
import { splitText } from './split';

const len = (s: string) => s.length;

function check(chunks: string[], max: number, count: (s: string) => number) {
  for (const c of chunks) {
    expect(c.trim()).not.toBe('');
    expect(count(c)).toBeLessThanOrEqual(max);
  }
}

describe('splitText', () => {
  it('returns [text] when it fits (untouched)', () => {
    expect(splitText('  hello  ', 20, len)).toEqual(['  hello  ']);
    expect(splitText('', 5, len)).toEqual(['']);
  });

  it('rejects invalid max', () => {
    expect(() => splitText('x', 0, len)).toThrow('invalid max');
    expect(() => splitText('x', 1.5, len)).toThrow('invalid max');
  });

  it('packs paragraphs greedily', () => {
    const text = 'Para one.\n\nPara two.\n\n  \n\nPara three is here.';
    const out = splitText(text, 22, len);
    expect(out).toEqual(['Para one.\n\nPara two.', 'Para three is here.']);
    check(out, 22, len);
  });

  it('splits long paragraphs by sentences', () => {
    const text = 'First sentence here. Second one! Third? Fourth sentence ends.';
    const out = splitText(text, 25, len);
    expect(out).toEqual(['First sentence here.', 'Second one! Third?', 'Fourth sentence ends.']);
    check(out, 25, len);
  });

  it('splits long sentences by words and keeps packing after', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta. Short.';
    const out = splitText(text, 16, len);
    expect(out).toEqual(['alpha beta gamma', 'delta epsilon', 'zeta eta theta.', 'Short.']);
    check(out, 16, len);
  });

  it('hard-splits a single overlong word by graphemes', () => {
    const out = splitText('go https://example.com/abcdefghijklmnop ok', 10, len);
    expect(out).toEqual(['go', 'https://ex', 'ample.com/', 'abcdefghij', 'klmnop ok']);
    check(out, 10, len);
  });

  it('never splits inside an emoji grapheme', () => {
    const fam = '👨‍👩‍👧‍👦';
    const text = fam.repeat(5);
    const out = splitText(text, 2, graphemes);
    expect(out).toEqual([fam + fam, fam + fam, fam]);
    check(out, 2, graphemes);
  });

  it('splits CJK sentences without spaces', () => {
    const text = '今日は良い天気です。明日も晴れるでしょう。';
    const out = splitText(text, 12, graphemes);
    expect(out).toEqual(['今日は良い天気です。', '明日も晴れるでしょう。']);
    check(out, 12, graphemes);
  });

  it('handles long CJK runs with no punctuation', () => {
    const text = '漢'.repeat(25);
    const out = splitText(text, 10, graphemes);
    expect(out.map(graphemes)).toEqual([10, 10, 5]);
  });

  it('yields no chunks for overlong whitespace', () => {
    expect(splitText(' '.repeat(10), 3, len)).toEqual([]);
  });

  it('throws when a single grapheme exceeds max', () => {
    expect(() => splitText('ab', 1, () => 2)).toThrow('single character');
  });

  it('respects a non-additive counter on random-ish input', () => {
    const words = Array.from({ length: 300 }, (_, i) => 'w'.repeat((i * 7) % 13 + 1) + (i % 9 === 0 ? '.' : ''));
    const text = words.join(' ');
    const count = (s: string) => graphemes(s) + (s.includes('.') ? 5 : 0);
    const out = splitText(text, 40, count);
    check(out, 40, count);
    expect(out.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });
});
