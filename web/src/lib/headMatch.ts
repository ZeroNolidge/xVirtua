/**
 * Finds how far the patient's live video face has drifted from their resting
 * face (the first and last frame of every body-language clip) — both where
 * the head is and how big it is (Simli's faces lean in while talking and take
 * a few seconds to settle back) — so a clip can wait for a still moment, or
 * be lined up with the live face while it fades in.
 * Works on small greyscale copies, so it costs a few milliseconds.
 */

/** Size of the greyscale copies. */
export const GRID = 96;
/** Largest shift searched, in grid pixels (about 6% of the picture). */
const MAX_SHIFT = 6;
/** The part compared: the head (what people watch), not the shoulders or edges. */
const HEAD = { x0: 28, x1: 68, y0: 6, y1: 58 };
/** Head sizes tried, relative to the resting face (±5%; leaning in while talking reaches ~4%). */
export const SCALES = Array.from({ length: 21 }, (_, i) => 0.95 + i * 0.005);

/** The resting face zoomed by `s` about the middle of the picture (smooth sampling). */
export function scaleAbout(ref: Float32Array, s: number): Float32Array {
  const out = new Float32Array(GRID * GRID);
  const c = GRID / 2;
  const px = (x: number, y: number) => {
    const xi = Math.min(GRID - 1, Math.max(0, x));
    const yi = Math.min(GRID - 1, Math.max(0, y));
    return ref[yi * GRID + xi] ?? 0;
  };
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const sx = c + (x - c) / s;
      const sy = c + (y - c) / s;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      out[y * GRID + x] =
        px(x0, y0) * (1 - fx) * (1 - fy) +
        px(x0 + 1, y0) * fx * (1 - fy) +
        px(x0, y0 + 1) * (1 - fx) * fy +
        px(x0 + 1, y0 + 1) * fx * fy;
    }
  return out;
}

/** A little finer than a whole step: fit a curve through the best one and its neighbours. */
const fine = (a: number, b: number, c: number) => {
  const d = a - 2 * b + c;
  return d > 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * d))) : 0;
};

/**
 * The shift (in grid pixels) that best lines `live` up with `ref`, and how
 * good that is (lower is better). Brightness differences are ignored (each
 * is compared around its own average).
 */
function fitShift(ref: Float32Array, live: Float32Array) {
  const n = (HEAD.y1 - HEAD.y0) * (HEAD.x1 - HEAD.x0);
  let mr = 0;
  for (let y = HEAD.y0; y < HEAD.y1; y++)
    for (let x = HEAD.x0; x < HEAD.x1; x++) mr += ref[y * GRID + x] ?? 0;
  mr /= n;
  const size = MAX_SHIFT * 2 + 1;
  const cost = new Float64Array(size * size);
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++)
    for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
      let ml = 0;
      for (let y = HEAD.y0; y < HEAD.y1; y++)
        for (let x = HEAD.x0; x < HEAD.x1; x++) ml += live[(y + dy) * GRID + x + dx] ?? 0;
      ml /= n;
      let s = 0;
      for (let y = HEAD.y0; y < HEAD.y1; y++) {
        const ly = y + dy;
        for (let x = HEAD.x0; x < HEAD.x1; x++)
          s += Math.abs((ref[y * GRID + x] ?? 0) - mr - ((live[ly * GRID + x + dx] ?? 0) - ml));
      }
      cost[(dy + MAX_SHIFT) * size + dx + MAX_SHIFT] = s;
    }
  let best = 0;
  for (let i = 1; i < cost.length; i++) if ((cost[i] ?? 0) < (cost[best] ?? 0)) best = i;
  const bx = best % size;
  const by = Math.floor(best / size);
  const at = (x: number, y: number) => cost[y * size + x] ?? 0;
  const fx = bx > 0 && bx < size - 1 ? fine(at(bx - 1, by), at(bx, by), at(bx + 1, by)) : 0;
  const fy = by > 0 && by < size - 1 ? fine(at(bx, by - 1), at(bx, by), at(bx, by + 1)) : 0;
  return { x: bx - MAX_SHIFT + fx, y: by - MAX_SHIFT + fy, cost: at(bx, by) };
}

/** Where the live head is (grid pixels), ignoring size. */
export function bestShift(ref: Float32Array, live: Float32Array): { x: number; y: number } {
  const { x, y } = fitShift(ref, live);
  return { x, y };
}

/**
 * Where the live head is and how big, relative to the resting face.
 * `zoomed` holds the resting face at each of SCALES (see scaleAbout).
 */
export function bestFit(zoomed: Float32Array[], live: Float32Array) {
  const fits = zoomed.map((z) => fitShift(z, live));
  let i = 0;
  for (let k = 1; k < fits.length; k++) if (fits[k]!.cost < fits[i]!.cost) i = k;
  const step = (SCALES[1] ?? 1) - (SCALES[0] ?? 1);
  const f =
    i > 0 && i < fits.length - 1 ? fine(fits[i - 1]!.cost, fits[i]!.cost, fits[i + 1]!.cost) : 0;
  return { x: fits[i]!.x, y: fits[i]!.y, scale: (SCALES[i] ?? 1) + f * step };
}

export class HeadMatcher {
  private ctx: CanvasRenderingContext2D | null;
  private refs = new Map<string, Float32Array[]>();

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
    if (g) this.refs.set(url, SCALES.map((s) => scaleAbout(g, s)));
  }

  /**
   * Where the live head is relative to the resting face `refUrl` (as a
   * fraction of the picture's width and height) and how big (1 = the same).
   * Null when it can't tell.
   */
  offset(live: HTMLVideoElement | null | undefined, refUrl: string | null) {
    const zoomed = refUrl ? this.refs.get(refUrl) : undefined;
    if (!zoomed || !live || live.readyState < 2 || !live.videoWidth) return null;
    const g = this.grey(live);
    if (!g) return null;
    const f = bestFit(zoomed, g);
    return { x: f.x / GRID, y: f.y / GRID, scale: f.scale };
  }
}
