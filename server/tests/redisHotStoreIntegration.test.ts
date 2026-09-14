/**
 * server/tests/redisHotStoreIntegration.test.ts
 * Integration test suite for Redis Hot Store live farm state management.
 *
 * Invariant:
 *  - Live farm state is managed in Redis Hot Store for sub-millisecond retrieval.
 *  - Raw JSON and normalized state are stored in Redis, decoupling live state from PostgreSQL.
 *  - System gracefully falls back to MemoryHotStore when Redis is offline.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { hotStore, createHotStore, MemoryHotStore } from '../storage/index.js';
import { farmNormalizer } from '../services/farm/index.js';
import { Orchestrator } from '../services/ai/index.js';
import type { NormalizedFarmState } from '../domain/index.js';

describe('Redis Hot Store: Live Farm State Integration', () => {
  const farmId = '346853928974080';

  const mockRawFarm = {
    farm: {
      coins: 998.52,
      balance: '1.9984',
      bumpkin: { id: 346853928974080, experience: 2495578 },
      inventory: {
        'Kernel Blend': '0.45',
        Hay: '1.6',
        NutriBarley: '0.65',
        Milk: '0',
      },
      buildings: {
        Barn: [{ id: '404e3fdd', coordinates: { x: 11, y: 1 } }],
      },
      barn: {
        level: 1,
        animals: {
          '0': { id: '0', type: 'Cow', experience: 4360, state: 'idle' },
          '1': { id: '1', type: 'Cow', experience: 4325, state: 'idle' },
        },
      },
    },
  };

  beforeEach(async () => {
    await hotStore.delete(farmId);
  });

  it('commits normalized state and raw JSON payload directly to hotStore', async () => {
    const norm = farmNormalizer.normalize(mockRawFarm, { farmId }).normalizedState;
    const now = Date.now();

    const commitResult = await hotStore.commit({
      farmId,
      snapshotVersion: now,
      state: norm,
      updatedAt: now,
      syncStatus: 'SUCCESS',
    });

    assert.equal(commitResult.committed, true);

    await hotStore.setRaw(farmId, mockRawFarm);

    // Retrieve from hotStore
    const cached = await hotStore.get(farmId);
    assert.ok(cached);
    assert.equal(cached.farmId, farmId);
    assert.equal(cached.snapshotVersion, now);
    assert.equal(cached.state.player.level, norm.player.level);
    assert.equal(Object.keys(cached.state.animals.animals).length, 2);
    assert.equal(cached.state.animals.animals['0'].level, 10);

    // Retrieve raw payload
    const rawCached = await hotStore.getRaw(farmId) as any;
    assert.ok(rawCached);
    assert.equal(rawCached.farm.coins, 998.52);
  });

  it('Orchestrator retrieves live farm state directly from hotStore', async () => {
    const norm = farmNormalizer.normalize(mockRawFarm, { farmId }).normalizedState;
    const now = Date.now();

    await hotStore.commit({
      farmId,
      snapshotVersion: now,
      state: norm,
      updatedAt: now,
      syncStatus: 'SUCCESS',
    });

    const orchestrator = new Orchestrator();
    // Do NOT register in memoryStates so it queries hotStore
    const { state, staleness, version } = await orchestrator.getStoredFarmState(farmId);

    assert.ok(state);
    assert.equal(staleness, 'FRESH');
    assert.equal(version, now);
    assert.equal(state.player.level, norm.player.level);
    assert.equal(state.animals.animals['0'].level, 10);
    assert.equal(state.structures.buildings.Barn[0].level, 1);
  });

  it('MemoryHotStore provides seamless hermetic fallback when Redis is unconfigured', async () => {
    const memoryStore = createHotStore(); // returns MemoryHotStore
    assert.ok(memoryStore instanceof MemoryHotStore);

    const norm = farmNormalizer.normalize(mockRawFarm, { farmId }).normalizedState;
    await memoryStore.commit({
      farmId,
      snapshotVersion: 100,
      state: norm,
      updatedAt: 100,
      syncStatus: 'SUCCESS',
    });

    const retrieved = await memoryStore.get(farmId);
    assert.ok(retrieved);
    assert.equal(retrieved.snapshotVersion, 100);
    assert.equal(retrieved.state.animals.animals['0'].level, 10);
  });
});
