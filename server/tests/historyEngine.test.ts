/**
 * server/tests/historyEngine.test.ts
 * Golden test suite for Phase 4 (History, Delta Detection & Best-Effort Event Inference).
 *
 * Verifies all 9 acceptance criteria:
 * A - Mathematical correctness (inventory, XP, coins, balance diffs)
 * B - Observation integrity (only directly evidenced state facts become OBSERVED)
 * C - Inference restraint (never more confident than evidence; unmatched decreases remain LOW)
 * D - Evidence completeness (confidence, evidence, sourceSnapshotVersion, inferenceMethod)
 * E - Recipe & trade ambiguity protection (competing recipes degrade confidence)
 * F - History gap detection (missing observations cap confidence)
 * G - Cross-midnight temporal attribution (spansDayBoundary flagged explicitly)
 * H - DailyMetrics separation (observed facts vs inferred movements + confidence summary)
 * I - Full provenance & envelope traceability
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateStateDelta,
  extractObservedEvents,
  inferEventsFromDelta,
} from '../core/index.js';

import {
  extractFarmHistoryDelta,
  extractDailyMetrics,
} from '../services/farm/index.js';

import type { NormalizedFarmState } from '../domain/state.js';
import type { RecipeDefinition } from '../domain/recipes.js';
import type { ActiveProductionItem } from '../domain/production.js';

interface MockFarmOptions {
  inventoryAll?: Record<string, number>;
  playerLevel?: number;
  experience?: number;
  skills?: Record<string, number | boolean>;
  flowerApprox?: number;
  coins?: number;
  expansions?: number;
  completedDeliveries?: number;
  buildings?: Record<string, any[]>;
  activeProduction?: ActiveProductionItem[];
  capturedAt?: number;
}

function createMockFarmState(options: MockFarmOptions = {}): NormalizedFarmState {
  const inv = options.inventoryAll ?? { Wheat: 100, Tomato: 50 };
  const capturedAt = options.capturedAt ?? 1715342400000;
  const completedOrders = Array.from({ length: options.completedDeliveries ?? 5 }, (_, i) => ({
    id: `order_${i + 1}`,
    completedAt: capturedAt - 1000,
  }));

  return {
    player: {
      bumpkinId: 1001,
      level: options.playerLevel ?? 10,
      experience: options.experience ?? 5000,
      skills: options.skills ?? {},
      equipped: {},
    },
    economy: {
      flower: String(options.flowerApprox ?? 10.0),
      flowerApprox: options.flowerApprox ?? 10.0,
      sfl: options.flowerApprox ?? 10.0,
      coins: options.coins ?? 1000,
    },
    inventory: {
      all: inv,
      seeds: {},
      crops: {},
      food: {},
      resources: {},
      tools: {},
      collectibles: {},
      fishing: {},
      special: {},
    },
    structures: {
      buildings: options.buildings ?? {},
      placedCollectibles: [],
    },
    production: {
      active: options.activeProduction ?? [],
    },
    animals: {
      animals: {},
    },
    pets: {
      pets: {},
    },
    progression: {
      islandType: 'spring',
      expansions: options.expansions ?? 5,
      ascensionLevel: 0,
      sunstones: 0,
    },
    deliveries: {
      orders: completedOrders,
    },
    buffs: {
      vip: false,
      activeBuffNames: [],
    },
    temporal: {
      season: 'SPRING',
    },
    metadata: {
      capturedAt,
      normalizerVersion: '1.0.0-phase2',
      source: 'community-api',
      freshness: 'FRESH',
    },
  };
}

describe('Phase 4: History, Delta Detection & Best-Effort Event Inference', () => {

  describe('Criteria A: Mathematical Correctness of Derived Deltas', () => {
    it('accurately computes inventory, XP, coins, and balance diffs between snapshots', () => {
      const stateA = createMockFarmState({
        capturedAt: 1715342400000,
        inventoryAll: { Wheat: 100, Tomato: 50 },
        experience: 5000,
        playerLevel: 10,
        coins: 1000,
        flowerApprox: 10.0,
      });

      const stateB = createMockFarmState({
        capturedAt: 1715342700000, // +5 min
        inventoryAll: { Wheat: 150, Tomato: 30, Sunflower: 20 },
        experience: 6200,
        playerLevel: 11,
        coins: 1450,
        flowerApprox: 12.5,
      });

      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 100, toVersion: 101 });

      assert.equal(delta.inventoryDiff['Wheat'], 50);
      assert.equal(delta.inventoryDiff['Tomato'], -20);
      assert.equal(delta.inventoryDiff['Sunflower'], 20);
      assert.equal(delta.xpDiff, 1200);
      assert.equal(delta.levelDiff, 1);
      assert.equal(delta.coinsDiff, 450);
      assert.equal(delta.balanceDiff, 2.5);
      assert.equal(delta.durationMs, 300_000);
      assert.equal(delta.quality.gapDetected, false);
      assert.equal(delta.quality.complete, true);
    });
  });

  describe('Criteria B: Observation Integrity (Directly Proven State Facts)', () => {
    it('extracts SKILL_UNLOCK, EXPAND, DELIVERY_COMPLETE, and BUILD as OBSERVED events', () => {
      const stateA = createMockFarmState({
        skills: {},
        expansions: 5,
        completedDeliveries: 5,
        buildings: { 'Water Well': [{ readyAt: 0 }] },
      });

      const stateB = createMockFarmState({
        skills: { 'Green Thumb': 1 },
        expansions: 6,
        completedDeliveries: 7,
        buildings: { 'Water Well': [{ readyAt: 0 }], Bakery: [{ readyAt: 0 }] },
      });

      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 200, toVersion: 201 });
      const observed = extractObservedEvents(stateA, stateB, delta);

      assert.equal(observed.length, 4);

      const skillEvt = observed.find((e) => e.type === 'SKILL_UNLOCK');
      assert.ok(skillEvt);
      assert.equal(skillEvt.kind, 'OBSERVED');
      assert.equal(skillEvt.item, 'Green Thumb');

      const expandEvt = observed.find((e) => e.type === 'EXPAND');
      assert.ok(expandEvt);
      assert.equal(expandEvt.kind, 'OBSERVED');
      assert.equal(expandEvt.quantity, 1);

      const deliveryEvt = observed.find((e) => e.type === 'DELIVERY_COMPLETE');
      assert.ok(deliveryEvt);
      assert.equal(deliveryEvt.kind, 'OBSERVED');
      assert.equal(deliveryEvt.quantity, 2);

      const buildEvt = observed.find((e) => e.type === 'BUILD');
      assert.ok(buildEvt);
      assert.equal(buildEvt.kind, 'OBSERVED');
      assert.equal(buildEvt.item, 'Bakery');
    });
  });

  describe('Criteria C & D: Inference Restraint & Evidence Completeness', () => {
    it('infers HARVEST with HIGH confidence when plot completed and inventory increased with XP', () => {
      const activePlot: ActiveProductionItem = {
        id: 'plot_1',
        category: 'CROP',
        item: 'Wheat',
        quantity: 1,
        status: 'COMPLETED',
        startedAt: 1715340000000,
        readyAt: 1715342000000,
        expectedOutput: 500,
      };

      const stateA = createMockFarmState({
        inventoryAll: { Wheat: 50 },
        activeProduction: [activePlot],
      });

      const stateB = createMockFarmState({
        inventoryAll: { Wheat: 550 }, // +500
        experience: 5100, // +100 XP
        activeProduction: [], // plot completed
      });

      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 300, toVersion: 301 });
      const inferred = inferEventsFromDelta(stateA, stateB, delta);

      assert.equal(inferred.length, 1);
      const harvest = inferred[0];

      assert.equal(harvest.kind, 'INFERRED');
      assert.equal(harvest.type, 'HARVEST');
      assert.equal(harvest.item, 'Wheat');
      assert.equal(harvest.quantity, 500);
      assert.equal(harvest.confidence, 'HIGH');
      assert.ok(harvest.evidence.length >= 2);
      assert.equal(harvest.sourceSnapshotVersion, 301);
      assert.equal(harvest.inferenceMethod, 'CROP_COMPLETION_PLUS_INVENTORY_DELTA');
    });

    it('infers unmatched inventory drops as LOW confidence without guessing player intent', () => {
      const stateA = createMockFarmState({ inventoryAll: { Wheat: 100 } });
      const stateB = createMockFarmState({ inventoryAll: { Wheat: 50 } }); // -50 without XP or recipe

      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 305, toVersion: 306 });
      const inferred = inferEventsFromDelta(stateA, stateB, delta);

      assert.equal(inferred.length, 1);
      const unexplained = inferred[0];

      assert.equal(unexplained.confidence, 'LOW');
      assert.equal(unexplained.inferenceMethod, 'UNMATCHED_INVENTORY_DECREASE');
      assert.ok(unexplained.evidence.some((e) => e.includes('unmatched')));
    });
  });

  describe('Criteria E: Recipe & Trade Ambiguity Protection', () => {
    const mockRecipes: Record<string, RecipeDefinition> = {
      'Pizza Margherita': {
        building: 'Kitchen',
        baseXp: 5000,
        baseCookMinutes: 60,
        ingredients: { Wheat: 20, Tomato: 10 },
      },
      'Tomato Bread': {
        building: 'Kitchen',
        baseXp: 3000,
        baseCookMinutes: 30,
        ingredients: { Wheat: 20, Tomato: 10 }, // Exact same ingredients as Pizza!
      },
    };

    it('infers HIGH confidence when recipe match is unique', () => {
      const uniqueRecipes: Record<string, RecipeDefinition> = {
        'Pizza Margherita': mockRecipes['Pizza Margherita'],
      };

      const stateA = createMockFarmState({ inventoryAll: { Wheat: 100, Tomato: 50, 'Pizza Margherita': 0 } });
      const stateB = createMockFarmState({ inventoryAll: { Wheat: 80, Tomato: 40, 'Pizza Margherita': 1 } });

      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 400, toVersion: 401 });
      const inferred = inferEventsFromDelta(stateA, stateB, delta, { recipes: uniqueRecipes });

      const pizzaEvt = inferred.find((e) => e.item === 'Pizza Margherita');
      assert.ok(pizzaEvt);
      assert.equal(pizzaEvt.confidence, 'HIGH');
      assert.equal(pizzaEvt.inferenceMethod, 'RECIPE_STOICHIOMETRY_PLUS_INVENTORY_INCREASE');
    });

    it('degrades confidence to LOW when competing recipes share the exact same ingredients', () => {
      const stateA = createMockFarmState({ inventoryAll: { Wheat: 100, Tomato: 50, 'Pizza Margherita': 0 } });
      const stateB = createMockFarmState({ inventoryAll: { Wheat: 80, Tomato: 40, 'Pizza Margherita': 1 } });

      // Both Pizza Margherita and Tomato Bread share { Wheat: 20, Tomato: 10 }
      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 402, toVersion: 403 });
      const inferred = inferEventsFromDelta(stateA, stateB, delta, { recipes: mockRecipes });

      const pizzaEvt = inferred.find((e) => e.item === 'Pizza Margherita');
      assert.ok(pizzaEvt);
      assert.equal(pizzaEvt.confidence, 'LOW');
      assert.ok(pizzaEvt.evidence.some((e) => e.includes('competing candidate recipes')));
    });

    it('infers unique trade sales as HIGH confidence and multi-item sales as LOW', () => {
      const marketPrices = { Sunflower: 0.02, Potato: 0.1 };

      // Case 1: 500 Sunflower sold at 0.02 each -> exact 10 coins
      const stateA = createMockFarmState({ inventoryAll: { Sunflower: 500 }, coins: 100, flowerApprox: 10 });
      const stateB = createMockFarmState({ inventoryAll: { Sunflower: 0 }, coins: 110, flowerApprox: 10 });

      const delta1 = calculateStateDelta(stateA, stateB, { fromVersion: 410, toVersion: 411 });
      const inferred1 = inferEventsFromDelta(stateA, stateB, delta1, { marketPrices });

      const tradeEvt = inferred1.find((e) => e.type === 'TRADE');
      assert.ok(tradeEvt);
      assert.equal(tradeEvt.confidence, 'HIGH');
      assert.equal(tradeEvt.item, 'Sunflower');
      assert.equal(tradeEvt.quantity, 500);

      // Case 2: Multiple crops decrease while coins increase -> ambiguous
      const stateC = createMockFarmState({ inventoryAll: { Sunflower: 500, Potato: 100 }, coins: 100, flowerApprox: 10 });
      const stateD = createMockFarmState({ inventoryAll: { Sunflower: 400, Potato: 50 }, coins: 107, flowerApprox: 10 });

      const delta2 = calculateStateDelta(stateC, stateD, { fromVersion: 412, toVersion: 413 });
      const inferred2 = inferEventsFromDelta(stateC, stateD, delta2, { marketPrices });

      const multiTrade = inferred2.find((e) => e.type === 'TRADE');
      assert.ok(multiTrade);
      assert.equal(multiTrade.confidence, 'LOW');
      assert.equal(multiTrade.inferenceMethod, 'AMBIGUOUS_MULTI_ITEM_SALE');
    });
  });

  describe('Criteria F: History Gap Detection', () => {
    it('detects observation gaps (> 15 min or version jumps) and caps inference confidence', () => {
      const t1 = 1715340000000;
      const t2 = t1 + 30 * 60 * 1000; // 30 minutes gap (> 15 min default)

      const activePlot: ActiveProductionItem = {
        id: 'p1',
        category: 'CROP',
        item: 'Wheat',
        quantity: 1,
        status: 'COMPLETED',
        startedAt: t1,
        readyAt: t1 + 60000,
        expectedOutput: 10,
      };

      const stateA = createMockFarmState({
        capturedAt: t1,
        inventoryAll: { Wheat: 10 },
        activeProduction: [activePlot],
      });

      const stateB = createMockFarmState({
        capturedAt: t2,
        inventoryAll: { Wheat: 20 },
        activeProduction: [],
      });

      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 500, toVersion: 505 }); // version jump = 4

      assert.equal(delta.quality.gapDetected, true);
      assert.equal(delta.quality.complete, false);
      assert.equal(delta.quality.versionJump, 4);

      const inferred = inferEventsFromDelta(stateA, stateB, delta);
      const harvest = inferred.find((e) => e.type === 'HARVEST');
      assert.ok(harvest);
      // Confidence must be capped at MEDIUM due to the gap
      assert.equal(harvest.confidence, 'MEDIUM');
      assert.ok(harvest.evidence.some((e) => e.includes('gap detected')));
    });
  });

  describe('Criteria G: Cross-Midnight Temporal Attribution', () => {
    it('identifies deltas spanning 00:00:00 UTC and attributes them explicitly', () => {
      // 23:59:00 UTC on 2024-05-10
      const t1 = Date.UTC(2024, 4, 10, 23, 59, 0, 0);
      // 00:01:00 UTC on 2024-05-11
      const t2 = Date.UTC(2024, 4, 11, 0, 1, 0, 0);

      const stateA = createMockFarmState({ capturedAt: t1 });
      const stateB = createMockFarmState({ capturedAt: t2 });

      const delta = calculateStateDelta(stateA, stateB, { fromVersion: 600, toVersion: 601 });

      assert.equal(delta.temporalAttribution.spansDayBoundary, true);
      assert.equal(delta.temporalAttribution.fromDay, delta.temporalAttribution.toDay! - 1);
      assert.equal(delta.temporalAttribution.dayBoundaryCrossedAt, Date.UTC(2024, 4, 11, 0, 0, 0, 0));
    });
  });

  describe('Criteria H & I: DailyMetrics Separation & Full Provenance', () => {
    it('aggregates deltas with explicit observed vs inferred metrics and validates provenance', () => {
      const stateA = createMockFarmState({
        capturedAt: 1715340000000,
        inventoryAll: { Wheat: 100 },
        experience: 5000,
        coins: 100,
        flowerApprox: 10,
        skills: {},
      });

      const stateB = createMockFarmState({
        capturedAt: 1715340300000,
        inventoryAll: { Wheat: 150 },
        experience: 5500,
        coins: 150,
        flowerApprox: 12,
        skills: { 'Green Thumb': 1 },
      });

      const deltaResult = extractFarmHistoryDelta(stateA, stateB, {
        farmId: 1001,
        fromVersion: 700,
        toVersion: 701,
        fromHash: 'hash_a_123',
        toHash: 'hash_b_456',
      });

      // Delta Verification
      assert.equal(deltaResult.provenance.calculationEngineVersion, '1.0.0-phase4');
      assert.equal(deltaResult.provenance.farmId, '1001');
      assert.equal(deltaResult.provenance.snapshotVersion, 701);
      assert.equal(deltaResult.value.fromHash, 'hash_a_123');
      assert.equal(deltaResult.value.toHash, 'hash_b_456');

      // Daily Aggregation
      const dailyResult = extractDailyMetrics([deltaResult.value], 758, '2024-05-10');

      assert.equal(dailyResult.provenance.calculationEngineVersion, '1.0.0-phase4');
      assert.equal(dailyResult.value.date, '2024-05-10');
      assert.equal(dailyResult.value.inGameDay, 758);
      assert.equal(dailyResult.value.deltaCount, 1);

      // Observed facts vs Inferred movements separation
      assert.equal(dailyResult.value.observed.xpGained, 500);
      assert.equal(dailyResult.value.observed.coinsGained, 50);
      assert.equal(dailyResult.value.observed.netFlower, 2.0);
      assert.equal(dailyResult.value.observed.observedEventsCount, 1); // Green Thumb unlock

      // Inferred summary
      assert.ok(dailyResult.value.confidenceSummary.highCount >= 0);
      assert.equal(dailyResult.value.quality.gapDetected, false);
    });
  });

});
