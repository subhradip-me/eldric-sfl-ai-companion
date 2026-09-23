/**
 * server/tests/strategyPolicyStore.test.ts
 * Slice 3 — the StrategyPolicy hot cache: the seam where the background planner's output
 * lands so the get_best_plan tool + Explainer can read it without recomputing.
 *
 * Tested against the DB-free MemoryStrategyPolicyStore (guaranteed-identical semantics to the
 * live Redis driver), so the suite needs no infrastructure. The invariants under test:
 *  - round-trip fidelity: what you put is what you get;
 *  - per-goal keying `strategy:{farmId}:{goalId|DEFAULT}` isolates a named goal from DEFAULT;
 *  - a get miss is null, never a throw;
 *  - monotonic honesty: a policy computed no later than the stored one is rejected, never
 *    silently clobbering a fresher plan (mirrors the hot store's stale-write guard, keyed on
 *    computedAt rather than snapshotVersion);
 *  - schema is the boundary: a structurally invalid policy is refused before it is stored.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MemoryStrategyPolicyStore,
  createStrategyPolicyStore,
} from '../storage/strategyPolicyStore.js';
import type { StrategyPolicy } from '../domain/strategy.js';
import type { CalculationProvenance } from '../domain/provenance.js';

const COMPUTED_AT = 1715346000000; // 2024-05-10T13:00:00.000Z

const PROVENANCE: CalculationProvenance = {
  farmId: 'farm-1', snapshotVersion: 7, calculationEngineVersion: 'sim-1.0.0',
  gameDataVersion: 'game-1.0.0', computedAt: COMPUTED_AT,
};

function makePolicy(overrides: Partial<StrategyPolicy> = {}): StrategyPolicy {
  return {
    farmId: 'farm-1',
    goalId: 'DEFAULT',
    computedAt: COMPUTED_AT,
    planChangedAt: COMPUTED_AT,
    horizonDays: 1,
    objective: 'XP',
    plan: [{
      day: 1, date: '2024-05-10',
      actions: [{ type: 'cook', item: 'Pumpkin Soup', quantity: 1 }],
      projectedXp: 24, projectedNetFlower: 0,
    }],
    projected: { totalXp: 24, totalNetFlower: 0 },
    counterfactuals: [{ label: 'sell Pumpkin', deltaXp: -24, deltaFlower: 2, whyRejected: 'lower XP' }],
    calibration: { confidence: 'HIGH', recentErrorPct: 0 },
    provenance: PROVENANCE,
    ...overrides,
  };
}

describe('MemoryStrategyPolicyStore — round-trip', () => {
  it('returns exactly what was stored', async () => {
    const store = new MemoryStrategyPolicyStore();
    const policy = makePolicy();

    const res = await store.put(policy);
    assert.ok(res.committed, res.reason);

    const got = await store.get('farm-1');
    assert.deepEqual(got, policy);
  });
});

describe('MemoryStrategyPolicyStore — per-goal keying', () => {
  it('isolates a named goal from the DEFAULT policy on the same farm', async () => {
    const store = new MemoryStrategyPolicyStore();
    await store.put(makePolicy({ goalId: 'DEFAULT', objective: 'XP' }));
    await store.put(makePolicy({ goalId: 'goal-42', objective: 'FLOWER' }));

    // No goalId → the DEFAULT slot.
    assert.equal((await store.get('farm-1'))?.objective, 'XP');
    assert.equal((await store.get('farm-1', 'DEFAULT'))?.objective, 'XP');
    // The named goal is a distinct key and unaffected.
    assert.equal((await store.get('farm-1', 'goal-42'))?.objective, 'FLOWER');
  });
});

describe('MemoryStrategyPolicyStore — miss', () => {
  it('returns null for an unknown farm or goal', async () => {
    const store = new MemoryStrategyPolicyStore();
    assert.equal(await store.get('nope'), null);
    await store.put(makePolicy());
    assert.equal(await store.get('farm-1', 'ghost-goal'), null);
  });
});

describe('MemoryStrategyPolicyStore — monotonic stale-write rejection', () => {
  it('refuses a policy computed no later than the stored one and preserves the fresher plan', async () => {
    const store = new MemoryStrategyPolicyStore();

    assert.ok((await store.put(makePolicy({ computedAt: 2000, objective: 'XP' }))).committed);

    // Strictly older → rejected, stored plan untouched.
    const older = await store.put(makePolicy({ computedAt: 1000, objective: 'FLOWER' }));
    assert.equal(older.committed, false);
    assert.match(older.reason ?? '', /stale/i);
    assert.equal((await store.get('farm-1'))?.objective, 'XP');

    // Equal computedAt → also rejected (monotonic strict).
    assert.equal((await store.put(makePolicy({ computedAt: 2000, objective: 'TIME' }))).committed, false);
    assert.equal((await store.get('farm-1'))?.objective, 'XP');

    // Strictly newer → accepted.
    assert.ok((await store.put(makePolicy({ computedAt: 3000, objective: 'FLOWER' }))).committed);
    assert.equal((await store.get('farm-1'))?.objective, 'FLOWER');
  });
});

describe('MemoryStrategyPolicyStore — schema boundary', () => {
  it('rejects a structurally invalid policy before storing it', async () => {
    const store = new MemoryStrategyPolicyStore();
    const bad = { ...makePolicy(), objective: 'MONEY' }; // not a SimObjectiveFocus

    await assert.rejects(() => store.put(bad as unknown as StrategyPolicy));
    assert.equal(await store.get('farm-1'), null); // nothing leaked into the store
  });
});

describe('createStrategyPolicyStore — factory', () => {
  it('returns a DB-free memory store when no Redis client is supplied', async () => {
    const store = createStrategyPolicyStore();
    assert.ok(store instanceof MemoryStrategyPolicyStore);
    assert.ok((await store.put(makePolicy())).committed);
    assert.deepEqual(await store.get('farm-1'), makePolicy());
  });
});
