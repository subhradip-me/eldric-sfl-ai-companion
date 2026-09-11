/**
 * server/tests/domainContract.test.ts
 * Phase 0 verification suite: validates domain contracts, runtime Zod schemas,
 * ownership relations, strategic scenario fixtures, and architectural invariants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateProgress,
  type User,
  type Farm,
  type FarmSnapshot,
  type InferredEvent,
  type ObservedEvent,
  type CalculationResult,
  type Goal,
} from '../domain/index.js';

import {
  CommunityFarmDataSchema,
  FarmSnapshotSchema,
  GoalSchema,
} from '../schemas/index.js';

import { loadFixture } from '../fixtures/index.js';

describe('Phase 0: Domain Contracts & Invariants', () => {

  describe('1. User -> Farm Relational Ownership', () => {
    it('models 1:N relational ownership between User and Farm', () => {
      const user: User = {
        userId: 'usr_001',
        username: 'farmer_alice',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const farm1: Farm = {
        farmId: '12345',
        userId: user.userId,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const farm2: Farm = {
        farmId: '67890',
        userId: user.userId,
        createdAt: 1700005000000,
        updatedAt: 1700005000000,
      };

      assert.equal(farm1.userId, user.userId);
      assert.equal(farm2.userId, user.userId);
      assert.notEqual(farm1.farmId, farm2.farmId);
    });
  });

  describe('2. FarmSnapshot Contract & Schema Validation', () => {
    it('validates a valid snapshot and preserves rawData separately from normalizedState', () => {
      const rawApiData = { coins: 1000, balance: '25.5' };
      const snapshot: FarmSnapshot = {
        farmId: 'farm_999',
        snapshotVersion: 18427,
        capturedAt: 1700010000000,
        rawHash: 'sha256:abc123def456',
        rawData: rawApiData,
      };

      const validated = FarmSnapshotSchema.parse(snapshot);
      assert.equal(validated.farmId, 'farm_999');
      assert.equal(validated.snapshotVersion, 18427);
      assert.deepEqual(validated.rawData, rawApiData);
      assert.equal(validated.normalizedState, undefined);
    });

    it('rejects invalid snapshot with negative version or missing farmId', () => {
      assert.throws(() => {
        FarmSnapshotSchema.parse({
          farmId: '',
          snapshotVersion: -1,
          capturedAt: 1700010000000,
          rawHash: 'hash',
          rawData: {},
        });
      });
    });
  });

  describe('3. Real-World Regression Fixture Validation', () => {
    it('successfully loads and validates farm-high-level-spooky.json through Zod schema', () => {
      const rawFixture = loadFixture<any>('farm-high-level-spooky');
      assert.ok(rawFixture.farm, 'Fixture must contain root farm object');

      const validated = CommunityFarmDataSchema.parse(rawFixture.farm);
      assert.ok(validated.coins > 100000, 'Must reflect high coin balance');
      assert.equal(validated.balance, '45.331892241468325');
      const inv = validated.inventory as Record<string, number>;
      assert.ok(inv['Sunflower'] > 100000, 'Must have Sunflower inventory');
      assert.ok(inv['Axe'] > 1000, 'Must have Axe inventory');
      assert.equal(validated.island?.type, 'spooky');
      assert.equal(validated.island?.ascensionLevel, 2);
      assert.equal(validated.bumpkin?.id, 10340);
      assert.ok(validated.bumpkin?.experience > 500000000, 'Must have late-game Bumpkin XP');
    });
  });

  describe('4. Strategic Scenario Fixtures', () => {
    it('validates reservation conflict logic in farm-reservation-conflict.json', () => {
      const fixture = loadFixture<any>('farm-reservation-conflict');
      assert.equal(fixture.scenario, 'RESERVATION_CONFLICT');

      const balance = Number(fixture.farm.balance);
      const reservedTomorrow = fixture.planningContext.tomorrowRequirement.reservedFlower;
      const discretionary = balance - reservedTomorrow;
      const immediateCost = fixture.planningContext.todayOpportunity.flowerCost;

      assert.equal(discretionary, 30);
      assert.equal(immediateCost, 80);
      // Invariant: Immediate action cost exceeds discretionary budget
      assert.ok(immediateCost > discretionary, 'Immediate cost exceeds discretionary reserve');
      assert.equal(fixture.planningContext.expectedDecision.actionPermitted, false);
    });

    it('validates hard constraint feasibility logic in farm-multi-objective-conflict.json', () => {
      const fixture = loadFixture<any>('farm-multi-objective-conflict');
      const maxCost = fixture.goal.constraints.maxFlowerCost;

      for (const strat of fixture.candidateStrategies) {
        const isFeasible = strat.estimatedFlowerCost <= maxCost;
        const expectedFeasibility = isFeasible ? 'VALID' : 'INVALID';
        assert.equal(strat.expectedFeasibility, expectedFeasibility);
      }
    });

    it('validates active production pipeline logic in farm-active-production.json', () => {
      const fixture = loadFixture<any>('farm-active-production');
      const owned = fixture.farm.inventory.Wheat;
      const inProduction = fixture.farm.crops.activePlots.expectedYield;
      const totalProjected = owned + inProduction;
      const required = fixture.planningContext.requiredResource.quantity;

      assert.equal(owned, 50);
      assert.equal(inProduction, 500);
      assert.equal(totalProjected, 550);
      assert.ok(totalProjected >= required, 'Active production satisfies future requirements');
    });

    it('validates seasonal boundary pressure in farm-season-boundary.json', () => {
      const fixture = loadFixture<any>('farm-season-boundary');
      assert.equal(fixture.temporalContext.currentSeason, 'AUTUMN');
      assert.equal(fixture.temporalContext.daysRemainingInSeason, 2);
      assert.equal(fixture.temporalContext.seasonalConstraints.Artichoke.availableInWinter, false);
      assert.equal(fixture.planningContext.expectedWarning.code, 'SEASONAL_DEADLINE');
    });
  });

  describe('5. Observed vs Inferred History Contract', () => {
    it('enforces that InferredEvent contains confidence, evidence, and inferenceMethod', () => {
      const inferred: InferredEvent = {
        kind: 'INFERRED',
        id: 'evt_101',
        type: 'HARVEST',
        timestamp: 1700002700000,
        item: 'Wheat',
        quantity: 500,
        confidence: 'HIGH',
        evidence: ['50 plots completed growth', 'wheat inventory delta +500'],
        sourceSnapshotVersion: 18428,
        inferenceMethod: 'CROP_COMPLETION_PLUS_INVENTORY_DELTA',
      };

      assert.equal(inferred.kind, 'INFERRED');
      assert.equal(inferred.confidence, 'HIGH');
      assert.ok(inferred.evidence.length >= 2);
      assert.equal(inferred.inferenceMethod, 'CROP_COMPLETION_PLUS_INVENTORY_DELTA');
    });

    it('formats ObservedEvent directly without inference metadata', () => {
      const observed: ObservedEvent = {
        kind: 'OBSERVED',
        id: 'evt_102',
        type: 'DELIVERY_COMPLETE',
        timestamp: 1700003000000,
        item: 'Delivery #42',
      };

      assert.equal(observed.kind, 'OBSERVED');
      assert.equal(observed.type, 'DELIVERY_COMPLETE');
    });
  });

  describe('6. Active Production Progress Derived Helper', () => {
    it('calculates derived progress fraction dynamically', () => {
      const startedAt = 1000;
      const readyAt = 3000;

      assert.equal(calculateProgress(500, startedAt, readyAt), 0);
      assert.equal(calculateProgress(1000, startedAt, readyAt), 0);
      assert.equal(calculateProgress(2000, startedAt, readyAt), 0.5);
      assert.equal(calculateProgress(3000, startedAt, readyAt), 1);
      assert.equal(calculateProgress(4000, startedAt, readyAt), 1);
    });
  });

  describe('7. Calculation Provenance Envelope', () => {
    it('preserves complete provenance metadata in CalculationResult<T>', () => {
      const calculation: CalculationResult<{ level: number; xpRemaining: number }> = {
        value: { level: 80, xpRemaining: 45000 },
        provenance: {
          farmId: 'farm_123',
          snapshotVersion: 18428,
          calculationEngineVersion: '1.0.0',
          gameDataVersion: '2026.09.11',
          marketDataVersion: '2026.09.11-12:00',
          plannerVersion: '1.0.0',
          computedAt: 1700000000000,
        },
      };

      assert.equal(calculation.value.level, 80);
      assert.equal(calculation.provenance.farmId, 'farm_123');
      assert.equal(calculation.provenance.snapshotVersion, 18428);
      assert.equal(calculation.provenance.calculationEngineVersion, '1.0.0');
    });
  });

  describe('8. Goal Domain & Lifecycle Schema', () => {
    it('validates a structured goal across status lifecycle', () => {
      const goal: Goal = {
        goalId: 'goal_777',
        farmId: 'farm_123',
        status: 'ACTIVE',
        objective: 'REACH_LEVEL',
        target: { level: 80, deadlineDays: 30 },
        constraints: { maxFlowerCost: 50000, disallowMarketPurchases: false },
        preferences: { riskTolerance: 'BALANCED', primaryFocus: 'XP', avoidMarket: false },
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const validated = GoalSchema.parse(goal);
      assert.equal(validated.goalId, 'goal_777');
      assert.equal(validated.status, 'ACTIVE');
      assert.equal(validated.target.level, 80);
      assert.equal(validated.constraints.maxFlowerCost, 50000);
    });

    it('rejects invalid goal with level > 200 or negative cost', () => {
      assert.throws(() => {
        GoalSchema.parse({
          goalId: 'g1',
          farmId: 'f1',
          objective: 'REACH_LEVEL',
          target: { level: 999 },
          constraints: { maxFlowerCost: -100 },
          createdAt: 100,
          updatedAt: 100,
        });
      });
    });
  });

});
