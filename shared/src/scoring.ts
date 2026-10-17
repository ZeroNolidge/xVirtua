import { METRICS, type Metric, type ScoringWeights } from './model.js';

/**
 * Weighted overall score (0–100, rounded). Weights are normalized, so they
 * don't need to sum to exactly 1. Missing metrics are skipped and the
 * remaining weights re-normalized.
 */
export function overallScore(
  scores: Partial<Record<Metric, number>>,
  weights: ScoringWeights,
): number | null {
  let total = 0;
  let weightSum = 0;
  for (const m of METRICS) {
    const s = scores[m];
    const w = weights[m];
    if (s === undefined || !Number.isFinite(s) || w <= 0) continue;
    total += clamp(s, 0, 100) * w;
    weightSum += w;
  }
  if (weightSum === 0) return null;
  return Math.round(total / weightSum);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
