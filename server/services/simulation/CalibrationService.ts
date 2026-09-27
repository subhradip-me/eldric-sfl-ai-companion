/**
 * server/services/simulation/CalibrationService.ts
 * Slice 3 — the predicted-vs-observed honesty loop (service layer).
 *
 * Given the PRIOR farm state and the OBSERVED FarmDelta for the step the player actually
 * took, this reconstructs the SimAction behind that observation, re-runs the forward model
 * on the prior state to obtain the model's PREDICTED delta, and scores predicted-vs-observed
 * through the pure `calibrate` primitive. Sustained error lowers the confidence tier, which
 * the Explainer states plainly rather than projecting confidently-wrong numbers.
 *
 * DI for testability: the caller supplies the state, the observed delta, and the sim clock
 * via SimContext — no SnapshotService, no DB, no Redis. Only pure core is imported.
 *
 * Limitation (honest): only cook/sell/buy steps are replayable today, matching the forward
 * model's supported actions. A step the model cannot replay is reported `calibrated: false`
 * with the rolling window left UNTOUCHED — an unmeasured step must not fake accuracy.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { FarmDelta, FarmEvent, ConfidenceLevel } from '../../domain/history.js';
import { applyAction, type SimAction, type SimContext } from '../../core/simulation/forwardModel.js';
import { calibrate, deriveConfidenceTier, type CalibrationSample } from '../../core/simulation/calibration.js';

export interface CalibrateStepInput {
  prevState: NormalizedFarmState;
  observed: FarmDelta;
  ctx?: SimContext;
  /** Rolling error window from prior cycles (fractions, 0..1). */
  priorWindow?: number[];
  windowSize?: number;
}

export interface CalibrateStepResult {
  /** True when the observed step was replayable and scored; false leaves the window as-is. */
  calibrated: boolean;
  reason?: string;
  action?: SimAction;
  confidence: ConfidenceLevel;
  recentErrorPct: number;
  window: number[];
  sample?: CalibrationSample;
}

/** Event types the forward model can replay to a PREDICTED delta. */
const REPLAYABLE: ReadonlySet<string> = new Set(['COOK', 'TRADE']);

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** Read `metadata.tradeType` from a TRADE event; inferred (backward) trades carry none. */
function tradeSide(evt: FarmEvent): 'BUY' | 'SELL' {
  const meta = 'metadata' in evt ? evt.metadata : undefined;
  return meta?.tradeType === 'BUY' ? 'BUY' : 'SELL'; // backward inference only detects sells
}

/**
 * Reconstruct the SimAction behind an observed delta from its events. Reads observed events
 * first (forward-model deltas), then inferred (backward-model deltas). Returns a reason when
 * no event maps to a replayable action.
 */
function reconstructAction(
  observed: FarmDelta,
  prevState: NormalizedFarmState,
  ctx: SimContext,
): { action: SimAction } | { reason: string } {
  const all: FarmEvent[] = [...observed.observedEvents, ...observed.inferredEvents];
  const evt = all.find((e) => REPLAYABLE.has(e.type));
  if (!evt) {
    const seen = all[0]?.type?.toLowerCase() ?? 'unknown';
    return { reason: `unsupported step for calibration: ${seen}` };
  }
  if (!evt.item) return { reason: `event ${evt.type} carries no item to replay` };

  if (evt.type === 'COOK') {
    // The event quantity is OUTPUT units; probe a single batch to learn output-per-batch,
    // then recover the batch count the player actually cooked.
    const probe = applyAction(prevState, { type: 'cook', item: evt.item, quantity: 1 }, ctx);
    if (!probe.feasible) return { reason: `cannot replay cook of ${evt.item}: ${probe.blocker}` };
    const perBatch = probe.delta.inventoryDiff[evt.item] ?? 1;
    const outputUnits = evt.quantity ?? perBatch;
    const batches = perBatch > 0 ? Math.max(1, Math.round(outputUnits / perBatch)) : 1;
    return { action: { type: 'cook', item: evt.item, quantity: batches } };
  }

  // TRADE
  const type = tradeSide(evt) === 'BUY' ? 'buy' : 'sell';
  return { action: { type, item: evt.item, quantity: evt.quantity ?? 1 } };
}

export class CalibrationService {
  calibrateStep(input: CalibrateStepInput): CalibrateStepResult {
    const ctx = input.ctx ?? {};
    const priorWindow = input.priorWindow ?? [];

    const uncalibrated = (reason: string): CalibrateStepResult => ({
      calibrated: false,
      reason,
      confidence: deriveConfidenceTier(priorWindow),
      recentErrorPct: mean(priorWindow),
      window: priorWindow,
    });

    const rec = reconstructAction(input.observed, input.prevState, ctx);
    if ('reason' in rec) return uncalibrated(rec.reason);

    const predicted = applyAction(input.prevState, rec.action, ctx);
    if (!predicted.feasible) return uncalibrated(`prediction infeasible: ${predicted.blocker}`);

    const result = calibrate(predicted.delta, input.observed, priorWindow, input.windowSize);
    return {
      calibrated: true,
      action: rec.action,
      confidence: result.confidence,
      recentErrorPct: result.recentErrorPct,
      window: result.window,
      sample: result.sample,
    };
  }
}

/** Shared stateless singleton — the rolling window is passed in, never held here. */
export const calibrationService = new CalibrationService();
