const segmenter = new Intl.Segmenter();

/** User-perceived characters (grapheme clusters). */
export function graphemes(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
}

/** Unicode code points. */
export const codePoints = (text: string) => [...text].length;
