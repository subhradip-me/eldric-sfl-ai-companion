/**
 * server/tests/plannerEngine.test.ts
 * Golden test suite for Phase 5 (Goal Engine & Hierarchical Strategic Planner).
 *
 * Verifies all 6 approved review amendments:
 * 1. Feasibility receives complete StrategyCandidate & discards INVALID prior to scoring
 * 2. Strict temporal separation of availableNow from inProduction / projectedAvailable
 * 3. Item-specific ResourceLedger accounting across independent resources
 * 4. Frozen bounded 7-dimensional utility scoring in [0, 1] with preference weighting
 * 5. Explicit candidateGenerator discovery stage
 * 6. Pure determinism via explicit planId, timestamps, and versions
 * 7. Seasonal deadline urgency integration (farm-season-boundary.json)
 * 8. Epistemic preservation (inferred history never promoted to authoritative state)
 * 9. CalculationResult provenance and runtime Zod validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateFeasibility,
  calculateResourceCommitment,
  buildResourceLedger,
  checkImmediateActionPermitted,
  checkFutureActionPermitted,
  scoreCandidate,
  deriveScoreWeights,
  generateCandidates,
  generateRoadmap,
} from '../core/planner/index.js';

import { extractPlannerContext } from '../services/farm/plannerContextExtractors.js';
import { FarmNormalizer } from '../services/farm/FarmNormalizer.js';
import { RoadmapSchema } from '../schemas/roadmapSchema.js';
import { loadFixture } from '../fixtures/index.js';

import type {
  Goal,
  StrategyCandidate,
  NormalizedFarmState,
  GameTime,
  SeasonBoundary,
} from '../domain/index.js';

describe('Phase 5: Goal Engine & Hierarchical Strategic Planner', () => {
  const normalizer = new FarmNormalizer();

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment 1: Full Candidate Feasibility Gate
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment 1: Full StrategyCandidate Feasibility Gate', () => {
    const fixture = loadFixture<any>('farm-multi-objective-conflict');
    const goal: Goal = {
      goalId: 'goal-reach-level-80',
      farmId: 'farm-90005',
      status: 'ACTIVE',
      objective: fixture.goal.objective,
      target: fixture.goal.target,
      constraints: fixture.goal.constraints, // maxFlowerCost: 50000
      preferences: fixture.goal.preferences,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    it('rejects candidate strategy exceeding maxFlowerCost as INVALID prior to scoring', () => {
      const fastPush: StrategyCandidate = {
        candidateId: 'cand-fast-push',
        title: fixture.candidateStrategies[0].name,
        estimatedCostFlower: fixture.candidateStrategies[0].estimatedFlowerCost, // 55000
        estimatedDurationMinutes: fixture.candidateStrategies[0].daysToLevel * 1440,
        items: ['Wheat', 'Cabbage'],
        requiresMarketPurchase: true,
      };

      const assessment = evaluateFeasibility(fastPush, goal.constraints);
      assert.equal(assessment.isFeasible, false);
      assert.equal(assessment.status, 'INVALID');
      assert.ok(assessment.violations.length > 0);
      assert.match(assessment.violations[0], /exceeds maxFlowerCost 50000/);
    });

    it('permits candidate strategies satisfying maxFlowerCost as VALID', () => {
      const balancedPush: StrategyCandidate = {
        candidateId: 'cand-balanced-push',
        title: fixture.candidateStrategies[1].name,
        estimatedCostFlower: fixture.candidateStrategies[1].estimatedFlowerCost, // 35000
        estimatedDurationMinutes: fixture.candidateStrategies[1].daysToLevel * 1440,
        items: ['Wheat', 'Cabbage'],
        requiresMarketPurchase: true,
      };

      const assessment = evaluateFeasibility(balancedPush, goal.constraints);
      assert.equal(assessment.isFeasible, true);
      assert.equal(assessment.status, 'VALID');
      assert.equal(assessment.violations.length, 0);
    });

    it('evaluates deadlineTimestamp constraint against candidate completion timestamp', () => {
      const candidate: StrategyCandidate = {
        candidateId: 'cand-deadline-test',
        title: 'Overdue Strategy',
        estimatedCostFlower: 100,
        estimatedDurationMinutes: 120,
        estimatedCompletionAt: 1700010000000,
        items: ['Carrot'],
        requiresMarketPurchase: false,
      };

      const pass = evaluateFeasibility(candidate, { deadlineTimestamp: 1700020000000 });
      assert.equal(pass.isFeasible, true);

      const fail = evaluateFeasibility(candidate, { deadlineTimestamp: 1700005000000 });
      assert.equal(fail.isFeasible, false);
      assert.equal(fail.status, 'INVALID');
      assert.match(fail.violations[0], /exceeds deadline/);
    });

    it('evaluates blacklistedItems constraint', () => {
      const candidate: StrategyCandidate = {
        candidateId: 'cand-blacklist-test',
        title: 'Gold Crafting',
        estimatedCostFlower: 100,
        estimatedDurationMinutes: 60,
        items: ['Gold', 'Iron'],
        requiresMarketPurchase: false,
      };

      const assessment = evaluateFeasibility(candidate, { blacklistedItems: ['Gold'] });
      assert.equal(assessment.isFeasible, false);
      assert.match(assessment.violations[0], /item 'Gold' is blacklisted/);
    });

    it('evaluates disallowMarketPurchases constraint', () => {
      const candidate: StrategyCandidate = {
        candidateId: 'cand-market-test',
        title: 'Market Purchase Strategy',
        estimatedCostFlower: 500,
        estimatedDurationMinutes: 10,
        items: ['Wheat'],
        requiresMarketPurchase: true,
      };

      const assessment = evaluateFeasibility(candidate, { disallowMarketPurchases: true });
      assert.equal(assessment.isFeasible, false);
      assert.match(assessment.violations[0], /market purchases are disallowed/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment 2: Temporal Resource Separation (availableNow vs projectedAvailable)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment 2: Temporal Resource Separation', () => {
    it('correctly calculates availableNow vs projectedAvailable in single commitment', () => {
      const commitment = calculateResourceCommitment({
        owned: 100,
        inProduction: 500,
        reservedForTomorrow: 70,
        phaseReserve: 10,
      });

      // availableNow = max(0, 100 - 70 - 10) = 20
      assert.equal(commitment.availableNow, 20);
      assert.equal(commitment.discretionary, 20);

      // projectedAvailable = max(0, 100 + 500 - 70 - 10) = 520
      assert.equal(commitment.projectedAvailable, 520);
    });

    it('rejects immediate action violating tomorrow reserve (farm-reservation-conflict.json)', () => {
      const fixture = loadFixture<any>('farm-reservation-conflict');
      const commitment = calculateResourceCommitment({
        owned: parseFloat(fixture.farm.balance), // 100
        inProduction: 0,
        reservedForTomorrow: fixture.planningContext.tomorrowRequirement.reservedFlower, // 70
        phaseReserve: 0,
      });

      assert.equal(commitment.availableNow, 30);
      assert.equal(commitment.discretionary, fixture.planningContext.expectedDecision.discretionaryFlower);

      // Action requires 80 FLOWER
      const actionCost = fixture.planningContext.todayOpportunity.flowerCost; // 80
      const permission = checkImmediateActionPermitted(actionCost, commitment);

      assert.equal(permission.actionPermitted, false);
      assert.equal(permission.shortfall, 50);
      assert.match(permission.message!, /exceeds discretionary balance \(30 resource\)/);

      // Smaller action requiring 25 FLOWER is permitted
      const affordablePerm = checkImmediateActionPermitted(25, commitment);
      assert.equal(affordablePerm.actionPermitted, true);
    });

    it('permits future requirement satisfied by active production (farm-active-production.json)', () => {
      const fixture = loadFixture<any>('farm-active-production');
      const commitment = calculateResourceCommitment({
        owned: fixture.farm.inventory.Wheat, // 50
        inProduction: fixture.farm.crops.activePlots.expectedYield, // 500
        reservedForTomorrow: 0,
        phaseReserve: 0,
      });

      assert.equal(commitment.availableNow, 50);
      assert.equal(commitment.projectedAvailable, 550);

      const requiredQty = fixture.planningContext.requiredResource.quantity; // 400

      // Immediate action check fails (50 < 400)
      const immediatePerm = checkImmediateActionPermitted(requiredQty, commitment);
      assert.equal(immediatePerm.actionPermitted, false);
      assert.equal(immediatePerm.shortfall, 350);

      // Future action check succeeds (400 <= 550)
      const futurePerm = checkFutureActionPermitted(requiredQty, commitment);
      assert.equal(futurePerm.actionPermitted, true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment 3: Item-Specific ResourceLedger
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment 3: Item-Specific ResourceLedger Accounting', () => {
    it('maintains independent commitments per resource without cross-contamination', () => {
      const mockState: Partial<NormalizedFarmState> = {
        economy: { flowerApprox: 150, coins: 1000, flower: '150', sfl: 0 },
        inventory: {
          all: { Wood: 100, Stone: 50, Carrot: 300 },
          seeds: {},
          crops: {},
          food: {},
          resources: {},
          tools: {},
          collectibles: {},
          fishing: {},
          special: {},
        },
        production: { active: [] },
      };

      const ledger = buildResourceLedger({
        state: mockState as NormalizedFarmState,
        tomorrowRequirements: { Wood: 80, Stone: 40 },
        phaseRequirements: { Wood: 10 },
      });

      // Wood: 100 owned - 80 tomorrow - 10 phase = 10 availableNow
      assert.equal(ledger['Wood'].availableNow, 10);
      assert.equal(ledger['Wood'].projectedAvailable, 10);

      // Stone: 50 owned - 40 tomorrow - 0 phase = 10 availableNow
      assert.equal(ledger['Stone'].availableNow, 10);

      // Carrot: 300 owned - 0 reserved = 300 availableNow
      assert.equal(ledger['Carrot'].availableNow, 300);

      // FLOWER: 150 owned - 0 reserved = 150 availableNow
      assert.equal(ledger['FLOWER'].availableNow, 150);

      // Independent multi-resource check
      const woodCheck = checkImmediateActionPermitted('Wood', 50, ledger);
      assert.equal(woodCheck.actionPermitted, false);
      assert.equal(woodCheck.shortfall, 40);

      const carrotCheck = checkImmediateActionPermitted('Carrot', 50, ledger);
      assert.equal(carrotCheck.actionPermitted, true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment 4: Frozen 7-Dimensional Bounded Utility Scoring
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment 4: Frozen 7-Dimensional Scoring Contract', () => {
    const goal: Goal = {
      goalId: 'goal-xp-push',
      farmId: 'farm-1',
      status: 'ACTIVE',
      objective: 'REACH_LEVEL',
      target: { level: 50, xp: 5000 },
      constraints: { maxFlowerCost: 10000 },
      preferences: { primaryFocus: 'XP', riskTolerance: 'BALANCED' },
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    it('normalizes weights so that sum of weights strictly equals 1.0', () => {
      const xpWeights = deriveScoreWeights({ primaryFocus: 'XP', riskTolerance: 'LOW' });
      const sumXp = Object.values(xpWeights).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sumXp - 1.0) < 1e-9);

      const flowerWeights = deriveScoreWeights({ primaryFocus: 'FLOWER', riskTolerance: 'HIGH' });
      const sumFlower = Object.values(flowerWeights).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sumFlower - 1.0) < 1e-9);
    });

    it('guarantees every dimension and finalUtility is bounded within [0, 1]', () => {
      const candidate: StrategyCandidate = {
        candidateId: 'cand-cook-pancakes',
        title: 'Cook Pancakes',
        estimatedCostFlower: 80,
        estimatedDurationMinutes: 20,
        items: ['Wheat', 'Honey'],
        requiresMarketPurchase: false,
        targetActions: [
          {
            actionId: 'act-1',
            type: 'COOK',
            item: 'Pancakes',
            quantity: 1,
            estimatedXpGain: 4000,
            reasoning: 'Cook Pancakes',
          },
        ],
      };

      const score = scoreCandidate(candidate, goal);

      assert.ok(score.goalAlignment >= 0 && score.goalAlignment <= 1);
      assert.ok(score.xpImpact >= 0 && score.xpImpact <= 1);
      assert.ok(score.flowerImpact >= 0 && score.flowerImpact <= 1);
      assert.ok(score.futureImpact >= 0 && score.futureImpact <= 1);
      assert.ok(score.timeScore >= 0 && score.timeScore <= 1);
      assert.ok(score.riskScore >= 0 && score.riskScore <= 1);
      assert.ok(score.opportunityCostScore >= 0 && score.opportunityCostScore <= 1);
      assert.ok(score.finalUtility >= 0 && score.finalUtility <= 1);
    });

    it('alters ranking based on user preference (XP vs FLOWER focus)', () => {
      const fastXpStrategy: StrategyCandidate = {
        candidateId: 'cand-fast-xp',
        title: 'Fast High-XP Strategy',
        estimatedCostFlower: 5000,
        estimatedDurationMinutes: 100,
        items: ['Wheat'],
        requiresMarketPurchase: true,
        targetActions: [
          { actionId: 'a1', type: 'COOK', item: 'Pizza', quantity: 1, estimatedXpGain: 4500, reasoning: 'Cook' },
        ],
      };

      const cheapEcoStrategy: StrategyCandidate = {
        candidateId: 'cand-cheap-eco',
        title: 'Economical Low-Cost Strategy',
        estimatedCostFlower: 50,
        estimatedDurationMinutes: 300,
        items: ['Potato'],
        requiresMarketPurchase: false,
        targetActions: [
          { actionId: 'a2', type: 'COOK', item: 'Mashed Potato', quantity: 1, estimatedXpGain: 500, reasoning: 'Cook' },
        ],
      };

      // 1. Under XP focus
      const xpGoal: Goal = { ...goal, preferences: { primaryFocus: 'XP' } };
      const scoreFastXp = scoreCandidate(fastXpStrategy, xpGoal);
      const scoreEcoXp = scoreCandidate(cheapEcoStrategy, xpGoal);
      assert.ok(
        scoreFastXp.finalUtility > scoreEcoXp.finalUtility,
        'Under XP focus, high-XP strategy should have higher utility'
      );

      // 2. Under FLOWER focus
      const flowerGoal: Goal = { ...goal, preferences: { primaryFocus: 'FLOWER' } };
      const scoreFastFlower = scoreCandidate(fastXpStrategy, flowerGoal);
      const scoreEcoFlower = scoreCandidate(cheapEcoStrategy, flowerGoal);
      assert.ok(
        scoreEcoFlower.finalUtility > scoreFastFlower.finalUtility,
        'Under FLOWER focus, economical low-cost strategy should have higher utility'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment 5: Candidate Generator Stage
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment 5: Explicit Candidate Generator Stage', () => {
    it('discovers candidates from recipes and active crops', () => {
      const mockState: Partial<NormalizedFarmState> = {
        inventory: {
          all: { Potato: 20 },
          seeds: {},
          crops: {},
          food: {},
          resources: {},
          tools: {},
          collectibles: {},
          fishing: {},
          special: {},
        },
        economy: { flowerApprox: 10, coins: 500, flower: '10', sfl: 0 },
        production: {
          active: [
            {
              id: 'act-1',
              category: 'CROP',
              item: 'Sunflower',
              quantity: 10,
              status: 'PROJECTED',
              startedAt: 1700000000000,
              readyAt: 1700000060000,
              expectedOutput: 10,
            },
          ],
        },
      };

      const goal: Goal = {
        goalId: 'g1',
        farmId: 'f1',
        status: 'ACTIVE',
        objective: 'MAXIMIZE_XP',
        target: { xp: 1000 },
        constraints: {},
        preferences: {},
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const candidates = generateCandidates({
        goal,
        state: mockState as NormalizedFarmState,
      });

      assert.ok(candidates.length > 0);
      // Discovers harvest candidate for active Sunflower
      const harvestCandidate = candidates.find((c) => c.title === 'Harvest Sunflower');
      assert.ok(harvestCandidate);
      assert.equal(harvestCandidate.requiresMarketPurchase, false);

      // Discovers recipe candidate (e.g. Mashed Potato)
      const mashedPotatoCand = candidates.find((c) => c.title === 'Cook Mashed Potato');
      assert.ok(mashedPotatoCand);
      assert.equal(mashedPotatoCand.requiresMarketPurchase, false); // 20 Potato owned >= 8 required
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Amendment 6: Pure Clock Determinism & Explicit Inputs
  // ─────────────────────────────────────────────────────────────────────────
  describe('Amendment 6: Pure Clock Determinism & Explicit Inputs', () => {
    it('produces bit-for-bit identical Roadmap when provided identical explicit inputs', () => {
      const mockState: Partial<NormalizedFarmState> = {
        inventory: {
          all: { Wheat: 100, Potato: 50 },
          seeds: {},
          crops: {},
          food: {},
          resources: {},
          tools: {},
          collectibles: {},
          fishing: {},
          special: {},
        },
        economy: { flowerApprox: 50, coins: 1000, flower: '50', sfl: 0 },
        production: { active: [] },
      };

      const goal: Goal = {
        goalId: 'goal-det-test',
        farmId: 'farm-det-1',
        status: 'ACTIVE',
        objective: 'REACH_LEVEL',
        target: { level: 20 },
        constraints: { maxFlowerCost: 100 },
        preferences: { primaryFocus: 'XP' },
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const fixedParams = {
        state: mockState as NormalizedFarmState,
        goal,
        planId: 'plan-deterministic-1',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        plannerVersion: '1.0.0',
        roadmapVersion: 1,
      };

      const roadmap1 = generateRoadmap(fixedParams);
      const roadmap2 = generateRoadmap(fixedParams);

      assert.deepEqual(roadmap1, roadmap2);
      assert.equal(roadmap1.planId, 'plan-deterministic-1');
      assert.equal(roadmap1.createdAt, 1700000000000);
      assert.equal(roadmap1.version, 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Seasonal Urgency Integration
  // ─────────────────────────────────────────────────────────────────────────
  describe('Seasonal Urgency Integration (farm-season-boundary.json)', () => {
    it('generates SEASONAL_DEADLINE warning and prioritizes Artichoke harvest in Day 1', () => {
      const fixture = loadFixture<any>('farm-season-boundary');
      const normalizedState = normalizer.normalize(fixture.farm, {
        farmId: 'farm-season-boundary',
        snapshotVersion: 1,
        source: 'FIXTURE',
      }).normalizedState;

      const goal: Goal = {
        goalId: 'goal-season-prep',
        farmId: 'farm-season-boundary',
        status: 'ACTIVE',
        objective: 'STOCKPILE_RESOURCE',
        target: { items: fixture.planningContext.phaseRequires }, // Artichoke: 100
        constraints: {},
        preferences: { primaryFocus: 'TIME' },
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const seasonBoundary: SeasonBoundary = {
        currentSeason: fixture.temporalContext.currentSeason,
        nextSeason: fixture.temporalContext.nextSeason,
        daysRemaining: fixture.temporalContext.daysRemainingInSeason,
        remainingMs: fixture.temporalContext.daysRemainingInSeason * 86400000,
        seasonEndAt: 1700000000000 + fixture.temporalContext.daysRemainingInSeason * 86400000,
        urgency: 'WARNING',
        warnings: [
          {
            code: 'SEASONAL_DEADLINE',
            severity: 'WARNING',
            message: fixture.planningContext.expectedWarning.message,
            crop: 'Artichoke',
            daysRemaining: fixture.temporalContext.daysRemainingInSeason,
            currentSeason: fixture.temporalContext.currentSeason,
            nextSeason: fixture.temporalContext.nextSeason,
          },
        ],
      };

      const roadmap = generateRoadmap({
        state: normalizedState,
        goal,
        seasonBoundary,
        planId: 'plan-season-1',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      });

      // Day 1 objective has seasonal warning
      const day1 = roadmap.phases[0].dailyObjectives[0];
      const seasonalWarning = day1.warnings.find((w) => w.code === 'SEASONAL_DEADLINE');
      assert.ok(seasonalWarning);
      assert.equal(seasonalWarning.severity, 'WARNING');
      assert.match(seasonalWarning.message, /Artichoke is unavailable in WINTER/);

      // Prioritizes Artichoke harvest in Day 1 actions
      const seasonalAction = day1.targetActions.find((a) => a.item === 'Artichoke');
      assert.ok(seasonalAction);
      assert.match(seasonalAction.reasoning, /Seasonal urgency/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Epistemic Invariant: Soft Signals Never Mutate Authoritative State
  // ─────────────────────────────────────────────────────────────────────────
  describe('Epistemic Invariant Preservation', () => {
    it('consumes inferred history as soft planning signal without mutating authoritative inventory', () => {
      const rawFarm = {
        balance: '100.0',
        inventory: { Carrot: 10 },
      };
      const normalizedState = normalizer.normalize(rawFarm, {
        farmId: 'farm-epistemic',
        snapshotVersion: 1,
        source: 'FIXTURE',
      }).normalizedState;

      const goal: Goal = {
        goalId: 'goal-epistemic',
        farmId: 'farm-epistemic',
        status: 'ACTIVE',
        objective: 'STOCKPILE_RESOURCE',
        target: { items: { Carrot: 50 } },
        constraints: {},
        preferences: {},
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const inferredHistory = [
        {
          dateStr: '2026-09-11',
          source: 'inferred' as const,
          confidence: 'LOW' as const,
          events: [
            {
              type: 'HARVEST',
              item: 'Carrot',
              quantity: 18,
              confidence: 'LOW' as const,
            },
          ],
        },
      ];

      const calculationResult = extractPlannerContext(normalizedState, goal, {
        history: inferredHistory as any,
        farmId: 'farm-epistemic',
        snapshotVersion: 1,
      });

      // Assert authoritative state remains pristine
      assert.equal(normalizedState.inventory.all['Carrot'], 10);
      assert.notEqual(normalizedState.inventory.all['Carrot'], 28); // Never added inferred 18

      // Provenance envelope preserves plannerVersion
      assert.equal(calculationResult.provenance.plannerVersion, '1.0.0-phase5');
      assert.equal(calculationResult.provenance.farmId, 'farm-epistemic');

      // Validate runtime Zod schema compliance
      const validatedRoadmap = RoadmapSchema.parse(calculationResult.value);
      assert.ok(validatedRoadmap);
      assert.equal(validatedRoadmap.phases.length, 1);
    });
  });
});
