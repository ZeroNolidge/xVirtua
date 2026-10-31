import { describe, expect, it } from 'vitest';
import { bestFit, bestShift, GRID, scaleAbout, SCALES } from './headMatch';

/** A soft "face": a bright blob with a darker band, centred at (cx, cy). */
function face(cx: number, cy: number, brightness = 0) {
  const g = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const r2 = (x - cx) ** 2 + ((y - cy) * 0.8) ** 2;
      const band = Math.abs(y - cy - 8) < 3 && Math.abs(x - cx) < 10 ? -60 : 0;
      g[y * GRID + x] = 60 + 140 * Math.exp(-r2 / 300) + band + brightness;
    }
  return g;
}

describe('bestShift', () => {
  it('finds no shift when the live face is at rest', () => {
    const s = bestShift(face(48, 40), face(48, 40));
    expect(Math.abs(s.x)).toBeLessThan(0.2);
    expect(Math.abs(s.y)).toBeLessThan(0.2);
  });

  it('finds where the live head has drifted to', () => {
    const s = bestShift(face(48, 40), face(51, 38));
    expect(s.x).toBeCloseTo(3, 0);
    expect(s.y).toBeCloseTo(-2, 0);
  });

  it('ignores a change in brightness', () => {
    const s = bestShift(face(48, 40), face(46, 41, 25));
    expect(s.x).toBeCloseTo(-2, 0);
    expect(s.y).toBeCloseTo(1, 0);
  });

  it('finds how much bigger or smaller the live head is (it leans in while talking)', () => {
    const rest = face(48, 34);
    const zoomed = SCALES.map((z) => scaleAbout(rest, z));
    for (const z of [0.985, 1, 1.02]) {
      const f = bestFit(zoomed, scaleAbout(rest, z));
      expect(f.scale).toBeCloseTo(z, 2);
      expect(Math.abs(f.x)).toBeLessThan(0.6);
    }
  });
});
