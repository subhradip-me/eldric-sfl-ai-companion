/**
 * server/tests/gateA.test.ts
 * Gate A Acceptance Test Suite.
 *
 * Verifies all 6 Phase 2 Acceptance Criteria:
 *  - A1: State Correctness (Valid raw fixture -> valid complete normalized state)
 *  - A2: No Silent Data Loss (Path-level unmapped tracking, raw data preservation)
 *  - A3: Durable Authority & Monotonic Sequencing (PostgreSQL sequence -> Redis projection)
 *  - A4: Dual-Level Integrity Recovery (Redis flush -> SHA-256 raw + structural normalized recovery)
 *  - A5: Deterministic Integration (Normalized state -> context extraction -> Phase 1 core engines)
 *  - A6: Stale-Write Protection (Rejection of out-of-order/stale versions)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { farmNormalizer } from '../services/farm/index.js';
import {
  extractFoodXpContext,
  extractProductionContext,
  extractDependencyContext,
  extractCostContext,
} from '../services/farm/contextExtractors.js';
import {
  MemoryHotStore,
  MemorySnapshotStore,
  recoverHotStoreFromDb,
} from '../storage/index.js';
import {
  calculateFoodXp,
  summarizeActiveProduction,
  resolveDependencies,
  calculateCostBreakdown,
} from '../core/index.js';

import { loadFixture } from '../fixtures/index.js';
import recipesData from '../data/recipes.json' with { type: 'json' };

describe('Gate A: Farm State, Normalization & Hot Store Acceptance Suite', () => {

  describe('A1: State Correctness & Schema Invariants', () => {
    it('normalizes real observed farm-high-level-spooky.json into complete NormalizedFarmState', () => {
      const rawPayload = loadFixture<any>('farm-high-level-spooky');
      const fixedNow = 1730000000000;
      const result = farmNormalizer.normalize(rawPayload, { now: fixedNow, farmId: '10340' });

      assert.ok(result.normalizedState);
      const state = result.normalizedState;

      // 1. Player Sub-state
      assert.ok(state.player.level >= 80, `Expected high level Bumpkin, got ${state.player.level}`);
      assert.ok(state.player.experience > 10000000);
      assert.ok(typeof state.player.skills === 'object');
      assert.ok(typeof state.player.equipped === 'object');

      // 2. Economy Sub-state
      assert.ok(typeof state.economy.flower === 'string');
      assert.ok(state.economy.flowerApprox >= 0);
      assert.ok(state.economy.coins >= 0);

      // 3. Inventory Sub-state categorization
      assert.ok(Object.keys(state.inventory.all).length > 0);
      assert.ok(typeof state.inventory.crops === 'object');
      assert.ok(typeof state.inventory.food === 'object');
      assert.ok(typeof state.inventory.resources === 'object');

      // 4. Structures Sub-state
      assert.ok(typeof state.structures.buildings === 'object');

      // 5. Progression Sub-state
      assert.equal(state.progression.islandType, 'spooky');
      assert.equal(state.progression.ascensionLevel, 2);
      assert.ok(state.progression.expansions >= 0);

      // 6. Metadata Sub-state
      assert.equal(state.metadata.capturedAt, fixedNow);
      assert.equal(state.metadata.normalizerVersion, '1.0.0-phase2');
      assert.equal(state.metadata.freshness, 'FRESH');
      assert.ok(result.rawHash.length === 64);
    });

    it('successfully extracts active production items into production state', () => {
      const activeFixture = loadFixture<any>('farm-active-production');
      const result = farmNormalizer.normalize(activeFixture);

      assert.ok(result.normalizedState.production);
      assert.ok(result.normalizedState.production.active.length > 0);
      const firstItem = result.normalizedState.production.active[0];
      assert.ok(firstItem.id);
      assert.ok(firstItem.category);
      assert.ok(firstItem.readyAt > 0);
      assert.equal(firstItem.status, 'OBSERVED');
    });
  });

  describe('A2: No Silent Data Loss & Path-Level Unmapped Tracking', () => {
    it('detects and reports unknown upstream fields with hierarchical paths without dropping rawData', () => {
      const rawWithUnknowns = {
        farm: {
          balance: '150.5',
          coins: 500,
          inventory: { Sunflower: 20 },
          bumpkin: {
            experience: 5000,
            skills: {},
            telepathySkill: 3, // Unknown bumpkin key
          },
          alienArtifactStation: { level: 2 }, // Unknown farm key
        },
        experimentalSeasonFlag: 'nebula', // Unknown root key
      };

      const result = farmNormalizer.normalize(rawWithUnknowns);

      // Check hierarchical path reporting
      assert.ok(result.diagnostics.unmappedFields.includes('experimentalSeasonFlag'));
      assert.ok(result.diagnostics.unmappedFields.includes('farm.alienArtifactStation'));
      assert.ok(result.diagnostics.unmappedFields.includes('bumpkin.telepathySkill'));

      // Verify rawData is 100% preserved
      assert.deepEqual(result.rawData, rawWithUnknowns);

      // Verify rawHash corresponds exactly to full payload
      const expectedHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(rawWithUnknowns))
        .digest('hex');
      assert.equal(result.rawHash, expectedHash);
    });
  });

  describe('A3: Durable Authority & Monotonic Sequencing', () => {
    it('enforces PostgreSQL snapshot sequence and mirrors version to Redis projection', async () => {
      const snapshotStore = new MemorySnapshotStore();
      const hotStore = new MemoryHotStore();
      const farmId = 'farm_seq_test';

      const fixture = loadFixture<any>('farm-full-buffs');
      const norm1 = farmNormalizer.normalize(fixture).normalizedState;

      // 1. First snapshot committed to durable authority
      const snap1 = await snapshotStore.saveSnapshot(farmId, fixture, norm1);
      assert.equal(snap1.snapshotVersion, 1);

      // 2. Project to hot store
      const hotCommit1 = await hotStore.commit({
        farmId,
        snapshotVersion: snap1.snapshotVersion,
        state: norm1,
        updatedAt: snap1.capturedAt,
        syncStatus: 'SUCCESS',
      });
      assert.equal(hotCommit1.committed, true);

      // Invariant: state.version == version
      const v1 = await hotStore.getVersion(farmId);
      assert.equal(v1, 1);
      const hotState1 = await hotStore.get(farmId);
      assert.equal(hotState1?.snapshotVersion, 1);

      // 3. Second snapshot committed to durable authority
      const snap2 = await snapshotStore.saveSnapshot(farmId, fixture, norm1);
      assert.equal(snap2.snapshotVersion, 2);

      // 4. Mirror update to hot store
      const hotCommit2 = await hotStore.commit({
        farmId,
        snapshotVersion: snap2.snapshotVersion,
        state: norm1,
        updatedAt: snap2.capturedAt,
        syncStatus: 'SUCCESS',
      });
      assert.equal(hotCommit2.committed, true);

      const v2 = await hotStore.getVersion(farmId);
      assert.equal(v2, 2);
      const hotState2 = await hotStore.get(farmId);
      assert.equal(hotState2?.snapshotVersion, 2);

      // 5. Third snapshot committed to durable authority (1 -> 2 -> 3)
      const snap3 = await snapshotStore.saveSnapshot(farmId, fixture, norm1);
      assert.equal(snap3.snapshotVersion, 3);

      // 6. Mirror update to hot store
      const hotCommit3 = await hotStore.commit({
        farmId,
        snapshotVersion: snap3.snapshotVersion,
        state: norm1,
        updatedAt: snap3.capturedAt,
        syncStatus: 'SUCCESS',
      });
      assert.equal(hotCommit3.committed, true);

      const v3 = await hotStore.getVersion(farmId);
      assert.equal(v3, 3);
      const hotState3 = await hotStore.get(farmId);
      assert.equal(hotState3?.snapshotVersion, 3);
    });
  });

  describe('A4: Redis Failure Recovery & Dual-Level Integrity', () => {
    it('reconstructs hot cache from durable store with SHA-256 raw equality and structural normalized equality', async () => {
      const snapshotStore = new MemorySnapshotStore();
      const hotStore = new MemoryHotStore();
      const farmId = 'farm_recovery_test';

      const rawFixture = loadFixture<any>('farm-high-level-spooky');
      const normResult = farmNormalizer.normalize(rawFixture);

      // 1. Save durable snapshot in PostgreSQL
      const savedSnapshot = await snapshotStore.saveSnapshot(
        farmId,
        rawFixture,
        normResult.normalizedState
      );

      // 2. Initial hot store projection
      await hotStore.commit({
        farmId,
        snapshotVersion: savedSnapshot.snapshotVersion,
        state: normResult.normalizedState,
        updatedAt: savedSnapshot.capturedAt,
        syncStatus: 'SUCCESS',
      });

      // 3. SIMULATE REDIS OUTAGE / FLUSH
      await hotStore.flush();
      assert.equal(await hotStore.get(farmId), null);
      assert.equal(await hotStore.getVersion(farmId), null);

      // 4. RECOVERY SERVICE from durable PostgreSQL snapshot
      const recoveryResult = await recoverHotStoreFromDb(farmId, snapshotStore, hotStore);
      assert.equal(recoveryResult.recovered, true);
      assert.equal(recoveryResult.snapshotVersion, savedSnapshot.snapshotVersion);

      // 5. Dual-Level Integrity Assertions:
      // (a) Raw payload integrity: SHA-256 equality
      const recoveredSnapshot = await snapshotStore.getLatestSnapshot(farmId);
      assert.ok(recoveredSnapshot);
      const originalRawHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(rawFixture))
        .digest('hex');
      const recoveredRawHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(recoveredSnapshot.rawData))
        .digest('hex');
      assert.equal(recoveredRawHash, originalRawHash);

      // (b) Normalized state integrity: structural deep equality
      const recoveredHot = await hotStore.get(farmId);
      assert.ok(recoveredHot);
      assert.deepEqual(recoveredHot.state, normResult.normalizedState);
    });
  });

  describe('A5: Deterministic Integration via Context Extractors', () => {
    it('extracts explicit inputs from NormalizedFarmState and executes Phase 1 engines identically across iterations', () => {
      const rawFixture = loadFixture<any>('farm-high-level-spooky');
      const normResult = farmNormalizer.normalize(rawFixture);
      const state = normResult.normalizedState;

      const farmId = 'spooky_10340';
      const snapshotVersion = 1001;

      // Extract explicit inputs (keeping core engines ignorant of NormalizedFarmState)
      const foodRecipeDef = (recipesData as any)['Pumpkin Soup'];
      assert.ok(foodRecipeDef);

      const foodXpInput = extractFoodXpContext(state, 'Pumpkin Soup', foodRecipeDef, {
        farmId,
        snapshotVersion,
      });

      const prodInput = extractProductionContext(state, 1730000000000, {
        farmId,
        snapshotVersion,
      });

      const costInput = extractCostContext(
        state,
        { Pumpkin: 50 },
        { Pumpkin: 0.002 },
        {},
        { farmId, snapshotVersion }
      );

      // Run N iterations and verify bit-for-bit mathematical and provenance reproducibility
      const firstFoodResult = calculateFoodXp(foodXpInput);
      const firstProdResult = summarizeActiveProduction(prodInput);
      const firstCostResult = calculateCostBreakdown(costInput);

      for (let i = 0; i < 10; i++) {
        const iterFoodResult = calculateFoodXp(foodXpInput);
        const iterProdResult = summarizeActiveProduction(prodInput);
        const iterCostResult = calculateCostBreakdown(costInput);

        assert.deepEqual(iterFoodResult.value, firstFoodResult.value);
        assert.equal(iterFoodResult.provenance.farmId, farmId);
        assert.equal(iterFoodResult.provenance.snapshotVersion, snapshotVersion);

        assert.deepEqual(iterProdResult.value, firstProdResult.value);
        assert.equal(iterProdResult.provenance.farmId, farmId);

        assert.deepEqual(iterCostResult.value, firstCostResult.value);
        assert.equal(iterCostResult.provenance.farmId, farmId);
      }
    });
  });

  describe('A6: Stale-Write Protection', () => {
    it('rejects out-of-order or stale snapshot commits to Redis hot store', async () => {
      const hotStore = new MemoryHotStore();
      const farmId = 'farm_stale_test';
      const fixture = loadFixture<any>('farm-multi-objective-conflict');
      const normState = farmNormalizer.normalize(fixture).normalizedState;

      // 1. Worker A commits snapshot version 1003
      const commit1003 = await hotStore.commit({
        farmId,
        snapshotVersion: 1003,
        state: normState,
        updatedAt: 3000,
        syncStatus: 'SUCCESS',
      });
      assert.equal(commit1003.committed, true);
      assert.equal(await hotStore.getVersion(farmId), 1003);

      // 2. Worker B attempts to commit stale snapshot version 1002
      const commit1002 = await hotStore.commit({
        farmId,
        snapshotVersion: 1002,
        state: normState,
        updatedAt: 2000,
        syncStatus: 'SUCCESS',
      });

      // Assert stale commit is rejected
      assert.equal(commit1002.committed, false);
      assert.ok(commit1002.reason?.includes('STALE_VERSION'));

      // 3. Worker C attempts duplicate version 1003
      const commitDup1003 = await hotStore.commit({
        farmId,
        snapshotVersion: 1003,
        state: normState,
        updatedAt: 3000,
        syncStatus: 'SUCCESS',
      });
      assert.equal(commitDup1003.committed, false);

      // Invariant: Version in hot store remains strictly 1003
      assert.equal(await hotStore.getVersion(farmId), 1003);
    });
  });

});
