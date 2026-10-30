/**
 * Finds how far the patient's live video face has drifted from his resting
 * face (the first and last frame of every body-language clip), so a clip can
 * be shifted to line up with the live face while it fades in or out.
 * Works on small greyscale copies, so it costs about a millisecond.
 */

/** Size of the greyscale copies. */
export const GRID = 96;
/** Largest shift searched, in grid pixels (about 6% of the picture). */
const MAX_SHIFT = 6;
/** The part compared: his head and shoulders, not the edges. */
const AREA = { x0: 18, x1: 78, y0: 6, y1: 80 };

/**
 * The shift (in grid pixels) that best lines `live` up with `ref`: where the
 * live head sits relative to the resting head. Both are GRID × GRID greyscale.
 * Brightness differences are ignored (each is compared around its own average).
 */
export function bestShift(ref: Float32Array, live: Float32Array): { x: number; y: number } {
  const mean = (a: Float32Array) => {
    let s = 0;
    for (let y = AREA.y0; y < AREA.y1; y++)
      for (let x = AREA.x0; x < AREA.x1; x++) s += a[y * GRID + x] ?? 0;
    return s / ((AREA.y1 - AREA.y0) * (AREA.x1 - AREA.x0));
  };
  const mr = mean(ref);
  const ml = mean(live);
  const size = MAX_SHIFT * 2 + 1;
  const cost = new Float64Array(size * size);
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++)
    for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
      let s = 0;
      for (let y = AREA.y0; y < AREA.y1; y++) {
        const ly = y + dy;
        for (let x = AREA.x0; x < AREA.x1; x++)
          s += Math.abs((ref[y * GRID + x] ?? 0) - mr - ((live[ly * GRID + x + dx] ?? 0) - ml));
      }
      cost[(dy + MAX_SHIFT) * size + dx + MAX_SHIFT] = s;
    }
  let best = 0;
  for (let i = 1; i < cost.length; i++) if ((cost[i] ?? 0) < (cost[best] ?? 0)) best = i;
  const bx = best % size;
  const by = Math.floor(best / size);
  // A little finer than a whole pixel: fit a curve through the best one and its neighbours.
  const fine = (a: number, b: number, c: number) => {
    const d = a - 2 * b + c;
    return d > 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * d))) : 0;
  };
  const at = (x: number, y: number) => cost[y * size + x] ?? 0;
  const fx = bx > 0 && bx < size - 1 ? fine(at(bx - 1, by), at(bx, by), at(bx + 1, by)) : 0;
  const fy = by > 0 && by < size - 1 ? fine(at(bx, by - 1), at(bx, by), at(bx, by + 1)) : 0;
  return { x: bx - MAX_SHIFT + fx, y: by - MAX_SHIFT + fy };
}

export class HeadMatcher {
  private ctx: CanvasRenderingContext2D | null;
  private refs = new Map<string, Float32Array>();

  constructor() {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (c) c.width = c.height = GRID;
    this.ctx = c?.getContext('2d', { willReadFrequently: true }) ?? null;
  }

  private grey(src: CanvasImageSource): Float32Array | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      ctx.drawImage(src, 0, 0, GRID, GRID);
      const d = ctx.getImageData(0, 0, GRID, GRID).data;
      const g = new Float32Array(GRID * GRID);
      for (let i = 0; i < g.length; i++)
        g[i] = 0.299 * (d[i * 4] ?? 0) + 0.587 * (d[i * 4 + 1] ?? 0) + 0.114 * (d[i * 4 + 2] ?? 0);
      return g;
    } catch {
      return null; // not readable (or not loaded yet)
    }
  }

  /** Loads a resting face (the poster for a mood), once. */
  async addReference(url: string) {
    if (this.refs.has(url) || !this.ctx) return;
    const img = new Image();
    img.src = url;
    await img.decode();
    const g = this.grey(img);
    if (g) this.refs.set(url, g);
  }

  /**
   * Where the live face sits relative to the resting face `refUrl`, as a
   * fraction of the picture's width and height. Null when it can't tell.
   */
  offset(live: HTMLVideoElement | null | undefined, refUrl: string | null) {
    const ref = refUrl ? this.refs.get(refUrl) : undefined;
    if (!ref || !live || live.readyState < 2 || !live.videoWidth) return null;
    const g = this.grey(live);
    if (!g) return null;
    const s = bestShift(ref, g);
    return { x: s.x / GRID, y: s.y / GRID };
  }
}
