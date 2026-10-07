const segmenter = new Intl.Segmenter();

// Coarse → fine. Each level: how to cut a piece, and how to glue pieces back together.
const levels: { cut: (s: string) => string[]; glue: string }[] = [
  { cut: (s) => s.split(/\n\s*\n/), glue: '\n\n' }, // paragraphs
  { cut: (s) => s.split(/(?<=[.!?…])\s+|(?<=[。！？])/), glue: ' ' }, // sentences
  { cut: (s) => s.split(/\s+/), glue: ' ' }, // words
  { cut: (s) => Array.from(segmenter.segment(s), (g) => g.segment), glue: '' }, // graphemes
];

/**
 * Split `text` into chunks with `count(chunk) <= max`, greedily packing paragraphs, then sentences, then words;
 * a single word longer than `max` is hard-split by graphemes. Returns `[text]` when it already fits.
 * Chunks are trimmed and never empty (whitespace-only input that does not fit yields `[]`).
 */
export function splitText(text: string, max: number, count: (s: string) => number): string[] {
  if (!Number.isInteger(max) || max < 1) throw new Error(`invalid max: ${max}`);
  if (count(text) <= max) return [text];
  return pack(text, 0, max, count);
}

function pack(text: string, level: number, max: number, count: (s: string) => number): string[] {
  const { cut, glue } = levels[level];
  const chunks: string[] = [];
  let current = '';
  for (const raw of cut(text)) {
    const piece = raw.trim();
    if (!piece) continue;
    const candidate = current ? current + glue + piece : piece;
    if (count(candidate) <= max) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (count(piece) <= max) {
      current = piece;
    } else if (level === 3) {
      throw new Error(`a single character exceeds max ${max}`);
    } else {
      const sub = pack(piece, level + 1, max, count);
      current = sub.pop()!; // non-empty: piece has content and does not fit
      chunks.push(...sub);
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c) => c.trim()).filter(Boolean);
}
