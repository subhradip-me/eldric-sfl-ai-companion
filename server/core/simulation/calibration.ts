/**
 * server/core/simulation/calibration.ts
 * Slice 3 — pure calibration primitives: the honesty feedback loop.
 *
 * ARCHITECTURAL INVARIANTS (mirror forwardModel.ts):
 *  - Pure & deterministic: zero I/O, no ambient clock, no RNG. The service layer
 *    supplies the predicted/observed deltas and persists the rolling window; the
 *    math lives here so it is testable without infra.
 *  - Every replan cycle compares the model's PREDICTED delta for the step the player
 *    actually took against the OBSERVED delta, on the SAME `FarmDelta` shape both the
 *    forward and backward models produce. Sustained error lowers the confidence tier,
 *    which the Explainer states plainly instead of projecting confidently wrong numbers.
 */

import type { FarmDelta } from '../../domain/history.js';
import type { ConfidenceLevel } from '../../domain/history.js';

/** Rolling window of the most recent cycles' error (fraction, 0..1). */
export const DEFAULT_WINDOW_SIZE = 10;

/** Error thresholds on the mean recent error (fraction). Calibration policy, not game data. */
export const HIGH_MAX_ERROR = 0.10; // ≤10% mean error → HIGH confidence
export const MEDIUM_MAX_ERROR = 0.25; // ≤25% → MEDIUM; above → LOW

const EPSILON = 1e-9;

export interface CalibrationSample {
  xpErrorPct: number;
  flowerErrorPct: number;
  inventoryErrorPct: number;
  /** Combined error for the cycle: the mean of the three components. */
  errorPct: number;
}

export interface CalibrationResult {
  sample: CalibrationSample;
  /** The rolling window after appending this cycle's errorPct. */
  window: number[];
  /** Mean of the window. */
  recentErrorPct: number;
  confidence: ConfidenceLevel;
}

/**
 * Symmetric relative error between a predicted and observed scalar, clamped to [0, 1].
 * 0 when both are 0 or they match exactly; 1 when one is 0 (or they oppose in sign).
 */
export function relativeError(predicted: number, observed: number): number {
  const denom = Math.max(Math.abs(predicted), Math.abs(observed), EPSILON);
  return Math.min(1, Math.abs(predicted - observed) / denom);
}

/** Magnitude-weighted relative error over the union of inventory keys, clamped to [0, 1]. */
function inventoryError(
  predicted: Record<string, number>,
  observed: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(predicted), ...Object.keys(observed)]);
  let numerator = 0;
  let denominator = 0;
  for (const key of keys) {
    const p = predicted[key] ?? 0;
    const o = observed[key] ?? 0;
    numerator += Math.abs(p - o);
    denominator += Math.max(Math.abs(p), Math.abs(o));
  }
  if (denominator <= EPSILON) return 0;
  return Math.min(1, numerator / denominator);
}

/** Compare a predicted delta against the observed delta across XP, FLOWER, and inventory. */
export function compareDelta(predicted: FarmDelta, observed: FarmDelta): CalibrationSample {
  const xpErrorPct = relativeError(predicted.xpDiff, observed.xpDiff);
  const flowerErrorPct = relativeError(predicted.balanceDiff, observed.balanceDiff);
  const inventoryErrorPct = inventoryError(predicted.inventoryDiff, observed.inventoryDiff);
  const errorPct = (xpErrorPct + flowerErrorPct + inventoryErrorPct) / 3;
  return { xpErrorPct, flowerErrorPct, inventoryErrorPct, errorPct };
}

/** Append a sample to the rolling window, evicting the oldest beyond `maxSize`. */
export function rollWindow(prev: number[], next: number, maxSize: number = DEFAULT_WINDOW_SIZE): number[] {
  const appended = [...prev, next];
  return appended.length > maxSize ? appended.slice(appended.length - maxSize) : appended;
}

/**
 * Derive a confidence tier from the mean of the recent-error window.
 * An empty window claims no confidence (LOW): we have measured no accuracy yet.
 */
export function deriveConfidenceTier(errors: number[]): ConfidenceLevel {
  if (errors.length === 0) return 'LOW';
  const mean = errors.reduce((sum, e) => sum + e, 0) / errors.length;
  if (mean <= HIGH_MAX_ERROR) return 'HIGH';
  if (mean <= MEDIUM_MAX_ERROR) return 'MEDIUM';
  return 'LOW';
}

/**
 * Run one calibration cycle: compare predicted vs observed, roll the error window,
 * and derive the current confidence tier. Pure — the caller persists `window`.
 */
export function calibrate(
  predicted: FarmDelta,
  observed: FarmDelta,
  priorWindow: number[] = [],
  windowSize: number = DEFAULT_WINDOW_SIZE,
): CalibrationResult {
  const sample = compareDelta(predicted, observed);
  const window = rollWindow(priorWindow, sample.errorPct, windowSize);
  const recentErrorPct = window.reduce((sum, e) => sum + e, 0) / window.length;
  return { sample, window, recentErrorPct, confidence: deriveConfidenceTier(window) };
}
