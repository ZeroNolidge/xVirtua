/**
 * Helpers for streaming the patient's reply: read the "text" field out of a
 * JSON object while it is still arriving, and cut it into sentences so the
 * voice can start on the first one.
 */

/**
 * Incrementally decodes one top-level string field from streamed JSON.
 * Call `push(chunk)` with each new piece; `value` is what has been decoded so
 * far and `done` turns true once the closing quote arrives.
 */
export class JsonStringFieldReader {
  private buf = '';
  private start = -1;
  private pos = 0;
  value = '';
  done = false;
  /** Everything before the field, once the field has started. */
  before: string | null = null;

  constructor(private readonly field: string) {}

  push(chunk: string): string {
    if (this.done) return this.value;
    this.buf += chunk;
    if (this.start < 0) {
      const m = new RegExp(`"${this.field}"\\s*:\\s*"`).exec(this.buf);
      if (!m) return this.value;
      this.start = m.index + m[0].length;
      this.before = this.buf.slice(0, m.index);
      this.pos = this.start;
    }
    const b = this.buf;
    while (this.pos < b.length) {
      const ch = b[this.pos]!;
      if (ch === '"') {
        this.done = true;
        this.pos++;
        break;
      }
      if (ch !== '\\') {
        this.value += ch;
        this.pos++;
        continue;
      }
      // Escape sequence: wait until it has fully arrived.
      const next = b[this.pos + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = b.slice(this.pos + 2, this.pos + 6);
        if (hex.length < 4) break;
        this.value += String.fromCharCode(parseInt(hex, 16));
        this.pos += 6;
        continue;
      }
      const map: Record<string, string> = {
        n: ' ',
        t: ' ',
        r: '',
        b: '',
        f: '',
        '"': '"',
        '\\': '\\',
        '/': '/',
      };
      this.value += map[next] ?? next;
      this.pos += 2;
    }
    return this.value;
  }
}

/**
 * Removes stage directions the model sometimes writes into speech, such as
 * "(frowns)" or "*looks away*". They are shown separately as nonverbal cues.
 */
export function stripStageDirections(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+([,.!?…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Splits growing text into speakable sentences. `take(text, final)` returns
 * the sentences completed since the last call; with `final` it also returns
 * whatever is left.
 */
export class SentenceSplitter {
  private emitted = 0;

  /**
   * `firstClauseMinWords`: let the very first piece end at a comma or dash
   * once it has this many words, so speech can start sooner.
   */
  constructor(private readonly opts: { firstClauseMinWords?: number } = {}) {}

  take(text: string, final = false): string[] {
    const out: string[] = [];
    const min = this.opts.firstClauseMinWords;
    if (min && this.emitted === 0) {
      const sentenceEnd = /[.!?…]/.exec(text)?.index ?? Infinity;
      for (const m of text.matchAll(/[,;:—–]\s+/g)) {
        if (m.index > sentenceEnd) break;
        const piece = text.slice(0, m.index + 1).trim();
        if (piece.split(/\s+/).length < min) continue;
        out.push(piece);
        this.emitted = m.index + m[0].length;
        break;
      }
    }
    const re = /[.!?…]+["'”’)\]]*\s+/g;
    re.lastIndex = this.emitted;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      const s = text.slice(this.emitted, end).trim();
      // Very short fragments ("Oh.") are joined to the next sentence.
      if (s.split(/\s+/).length < 3) continue;
      if (s) out.push(s);
      this.emitted = end;
    }
    if (final) {
      const rest = text.slice(this.emitted).trim();
      if (rest) out.push(rest);
      this.emitted = text.length;
    }
    return out;
  }
}

/**
 * Parses the fields that came before the one being streamed, e.g. delivery
 * and nonverbal cues ahead of "text". Returns null if they aren't valid JSON.
 */
export function parseJsonPrefix(before: string | null): Record<string, unknown> | null {
  if (!before) return null;
  try {
    const v: unknown = JSON.parse(before.replace(/,\s*$/, '') + '}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
