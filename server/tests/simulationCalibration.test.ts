/**
 * server/tests/simulationCalibration.test.ts
 * Slice 3 — pure calibration primitives (the honesty feedback loop).
 *
 * Each replan cycle compares the model's PREDICTED delta for the step the player
 * actually took against the OBSERVED delta, producing a bounded error and a rolling
 * confidence tier. This is what keeps the agent honest instead of confidently wrong:
 * when the model drifts, the tier drops and the Explainer says so.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  relativeError,
  compareDelta,
  rollWindow,
  deriveConfidenceTier,
  calibrate,
} from '../core/simulation/calibration.js';
import type { FarmDelta } from '../domain/history.js';

interface DeltaShape {
  xpDiff?: number;
  balanceDiff?: number;
  coinsDiff?: number;
  inventoryDiff?: Record<string, number>;
}

/** Minimal FarmDelta carrying only the fields calibration reads. */
function makeDelta(d: DeltaShape): FarmDelta {
  return {
    fromVersion: 0,
    toVersion: 1,
    fromTimestamp: 0,
    toTimestamp: 1000,
    durationMs: 1000,
    quality: { complete: true, gapDetected: false },
    temporalAttribution: { sameDay: true },
    inventoryDiff: d.inventoryDiff ?? {},
    xpDiff: d.xpDiff ?? 0,
    balanceDiff: d.balanceDiff ?? 0,
    coinsDiff: d.coinsDiff ?? 0,
    observedEvents: [],
    inferredEvents: [],
    events: [],
  } as unknown as FarmDelta;
}

describe('Slice 3 calibration — relativeError bounds', () => {
  it('is 0 when both values are 0, 0 on an exact match, and clamped to [0,1]', () => {
    assert.equal(relativeError(0, 0), 0);
    assert.equal(relativeError(5, 5), 0);
    assert.equal(relativeError(0, 5), 1); // predicted nothing, observed something
    assert.equal(relativeError(10, 5), 0.5);
    assert.equal(relativeError(-5, 5), 1); // opposite sign clamps at 100%
  });
});

describe('Slice 3 calibration — compareDelta', () => {
  it('reports zero error when prediction exactly matches observation', () => {
    const d = makeDelta({ xpDiff: 24, balanceDiff: 5, inventoryDiff: { Pumpkin: -10, 'Pumpkin Soup': 1 } });
    const sample = compareDelta(d, makeDelta({ xpDiff: 24, balanceDiff: 5, inventoryDiff: { Pumpkin: -10, 'Pumpkin Soup': 1 } }));

    assert.equal(sample.xpErrorPct, 0);
    assert.equal(sample.flowerErrorPct, 0);
    assert.equal(sample.inventoryErrorPct, 0);
    assert.equal(sample.errorPct, 0);
  });

  it('isolates FLOWER drift when the market moved more than the model expected', () => {
    const predicted = makeDelta({ xpDiff: 24, balanceDiff: 10 });
    const observed = makeDelta({ xpDiff: 24, balanceDiff: 5 });

    const sample = compareDelta(predicted, observed);

    assert.equal(sample.xpErrorPct, 0);
    assert.equal(sample.flowerErrorPct, 0.5); // |10-5| / max(10,5)
    assert.equal(sample.inventoryErrorPct, 0);
    // errorPct = mean of the three components
    assert.ok(Math.abs(sample.errorPct - 0.5 / 3) < 1e-9);
  });

  it('aggregates inventory error by magnitude across the union of keys', () => {
    const predicted = makeDelta({ inventoryDiff: { Pumpkin: -10, 'Pumpkin Soup': 1 } });
    const observed = makeDelta({ inventoryDiff: { Pumpkin: -8, 'Pumpkin Soup': 1 } });

    const sample = compareDelta(predicted, observed);
    // Σ|p-o| = 2 ; Σmax(|p|,|o|) = 10 + 1 = 11
    assert.ok(Math.abs(sample.inventoryErrorPct - 2 / 11) < 1e-9);
  });
});

describe('Slice 3 calibration — rolling window & confidence tier', () => {
  it('rollWindow appends and evicts the oldest beyond maxSize', () => {
    assert.deepEqual(rollWindow([0.1, 0.2], 0.3, 3), [0.1, 0.2, 0.3]);
    assert.deepEqual(rollWindow([0.1, 0.2, 0.3], 0.4, 3), [0.2, 0.3, 0.4]);
  });

  it('derives HIGH / MEDIUM / LOW from the mean recent error', () => {
    assert.equal(deriveConfidenceTier([0.05, 0.08]), 'HIGH');
    assert.equal(deriveConfidenceTier([0.2, 0.2]), 'MEDIUM');
    assert.equal(deriveConfidenceTier([0.5, 0.4]), 'LOW');
    assert.equal(deriveConfidenceTier([]), 'LOW'); // no evidence → no confidence claimed
  });
});

describe('Slice 3 calibration — calibrate() composes one cycle', () => {
  it('a perfect prediction yields zero error and HIGH confidence', () => {
    const d = makeDelta({ xpDiff: 24, balanceDiff: 5 });
    const result = calibrate(d, makeDelta({ xpDiff: 24, balanceDiff: 5 }));

    assert.equal(result.recentErrorPct, 0);
    assert.equal(result.confidence, 'HIGH');
    assert.deepEqual(result.window, [0]);
  });

  it('sustained drift pushes the tier down over the rolling window', () => {
    // Model predicts +10 FLOWER every cycle; reality delivers 0 → large flower error each time.
    const predicted = makeDelta({ balanceDiff: 10 });
    const observed = makeDelta({ balanceDiff: 0 });

    let window: number[] = [];
    let confidence = 'HIGH';
    for (let i = 0; i < 3; i++) {
      const r = calibrate(predicted, observed, window);
      window = r.window;
      confidence = r.confidence;
    }

    assert.equal(confidence, 'LOW');
    assert.equal(window.length, 3);
  });
});
