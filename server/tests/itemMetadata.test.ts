/**
 * server/tests/itemMetadata.test.ts
 * Comprehensive test suite for game metadata ingestion, ItemMetadataService,
 * AST integrity, 16-item collision gate, FarmNormalizer, and AI Orchestrator.
 *
 * ARCHITECTURAL INVARIANTS TESTED:
 * 1. Metadata vs Mechanics separation: metadata defines what an item is, not effect formulas.
 * 2. AST parsing fidelity: exact 1,409 collectibles + 581 wearables = 1,990 items.
 * 3. 16-item collision gate: explicit disambiguation between collectibles and wearables.
 * 4. Cryptographic provenance: SHA-256 manifest check.
 * 5. AUTHORITATIVE epistemic tier in AI Orchestration.
 * 6. Zero loss and correct categorization in FarmNormalizer.
 * 7. Backward compatibility for generated items.json.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  itemMetadataService,
  ItemMetadataService,
} from '../services/metadata/index.js';
import {
  EXPECTED_COLLECTIBLE_COUNT,
  EXPECTED_WEARABLE_COUNT,
  EXPECTED_TOTAL_COUNT,
  EXPECTED_COLLISION_COUNT,
  KNOWN_COLLISIONS,
} from '../scripts/generateGameMetadata.js';
import { farmNormalizer } from '../services/farm/index.js';
import { Orchestrator } from '../services/ai/Orchestrator.js';
import { AIToolResultSchema } from '../schemas/aiSchema.js';

import itemsCompatibility from '../data/items.json' with { type: 'json' };

describe('Game Metadata Ingestion & ItemMetadataService Suite', () => {
  const metadataPath = path.resolve(process.cwd(), 'metadata.ts');

  // ── 1. Manifest & Cryptographic Provenance ─────────────────────────────────
  describe('1. Manifest & Cryptographic Provenance', () => {
    it('verifies gameMetadata.json matches exact expected counts and 16 collisions', () => {
      const manifest = itemMetadataService.getManifest();

      assert.equal(manifest.collectibleCount, EXPECTED_COLLECTIBLE_COUNT, 'Collectible count must be 1409');
      assert.equal(manifest.wearableCount, EXPECTED_WEARABLE_COUNT, 'Wearable count must be 581');
      assert.equal(manifest.totalCount, EXPECTED_TOTAL_COUNT, 'Total count must be 1990');
      assert.equal(manifest.collisionCount, EXPECTED_COLLISION_COUNT, 'Collision count must be 16');
      assert.equal(manifest.sourceFile, 'metadata.ts');
      assert.ok(manifest.sourceSha256, 'SHA-256 hash must be populated');
    });

    it('verifies manifest sourceSha256 matches actual hash of metadata.ts', () => {
      const sourceText = fs.readFileSync(metadataPath, 'utf8');
      const expectedHash = crypto.createHash('sha256').update(sourceText).digest('hex');
      const manifest = itemMetadataService.getManifest();

      assert.equal(manifest.sourceSha256, expectedHash, 'Manifest hash must match live metadata.ts hash');
    });

    it('verifies the 16 collision items match the frozen known collisions set', () => {
      const collisions = itemMetadataService.getCollisions();
      assert.equal(collisions.length, 16);
      assert.deepEqual(collisions.sort(), KNOWN_COLLISIONS);

      for (const name of KNOWN_COLLISIONS) {
        assert.equal(itemMetadataService.hasCollision(name), true, `Item "${name}" must be recognized as collision`);
      }
    });
  });

  // ── 2. ItemMetadataService API ─────────────────────────────────────────────
  describe('2. ItemMetadataService API & Lookup Methods', () => {
    it('retrieves collectible items correctly with purpose and attributes', () => {
      const item = itemMetadataService.getCollectible('Diving Helmet');
      assert.ok(item, 'Diving Helmet must exist');
      assert.equal(item.name, 'Diving Helmet');
      assert.equal(item.kind, 'collectible');
      assert.equal(item.purpose, 'Decoration');
      assert.equal(item.tradable, true);

      const boostCol = itemMetadataService.getCollectible('Super Star');
      assert.ok(boostCol, 'Super Star must exist');
      assert.equal(boostCol.boost?.category, 'Fish');
    });

    it('retrieves wearable items correctly with part/slot', () => {
      const item = itemMetadataService.getWearable('Farmer Hat');
      assert.ok(item, 'Farmer Hat must exist');
      assert.equal(item.name, 'Farmer Hat');
      assert.equal(item.kind, 'wearable');
      assert.equal(item.part, 'Hat');
      assert.equal(itemMetadataService.getWearableSlot('Farmer Hat'), 'Hat');
    });

    it('handles collided items with explicit kind disambiguation', () => {
      const colName = 'Chef Apron';

      // Disambiguation: collectible
      const col = itemMetadataService.getItem(colName, 'collectible');
      assert.ok(col);
      assert.equal(col.kind, 'collectible');

      // Disambiguation: wearable
      const wear = itemMetadataService.getItem(colName, 'wearable');
      assert.ok(wear);
      assert.equal(wear.kind, 'wearable');
      assert.equal((wear as any).part, 'Coat');

      // Default precedence: returns collectible
      const def = itemMetadataService.getItem(colName);
      assert.ok(def);
      assert.equal(def.kind, 'collectible');
    });

    it('determines item kind classification accurately', () => {
      assert.equal(itemMetadataService.getItemKind('Chef Apron'), 'both');
      assert.equal(itemMetadataService.getItemKind('Diving Helmet'), 'collectible');
      assert.equal(itemMetadataService.getItemKind('Farmer Hat'), 'wearable');
      assert.equal(itemMetadataService.getItemKind('NonExistentItemXYZ'), null);
    });

    it('determines known vs unknown items correctly', () => {
      assert.equal(itemMetadataService.isKnownItem('Diving Helmet'), true);
      assert.equal(itemMetadataService.isKnownItem('Axe'), true);
      assert.equal(itemMetadataService.isKnownItem('TotallyBogusNonItem'), false);
    });

    it('queries descriptive boost categories', () => {
      const fishItems = itemMetadataService.getItemsByBoostCategory('Fish');
      assert.ok(fishItems.length > 0, 'Must find items with Fish boost category');
      const names = fishItems.map((i) => i.name);
      assert.ok(names.includes('Super Star'), 'Super Star must be in Fish boost category');
    });

    it('supports custom catalog injection for isolated testing', () => {
      const mockCatalog: any = {
        manifest: {
          schemaVersion: '1.0.0',
          gameDataVersion: 'mock-1',
          generatedAt: 12345,
          sourceFile: 'mock.ts',
          sourceSha256: 'mockhash',
          collectibleCount: 1,
          wearableCount: 1,
          totalCount: 2,
          collisionCount: 1,
          collisions: ['TestItem'],
        },
        collectibles: {
          TestItem: { name: 'TestItem', kind: 'collectible', purpose: 'Decoration' },
        },
        wearables: {
          TestItem: { name: 'TestItem', kind: 'wearable', part: 'Hat' },
        },
      };

      const customService = new ItemMetadataService(mockCatalog);
      assert.equal(customService.hasCollision('TestItem'), true);
      assert.equal(customService.getWearableSlot('TestItem'), 'Hat');
    });
  });

  // ── 3. FarmNormalizer Integration ──────────────────────────────────────────
  describe('3. FarmNormalizer Inventory Categorization Integration', () => {
    it('categorizes known collectibles from inventory without string regex heuristics', () => {
      const rawPayload = {
        id: '99999',
        bumpkin: { id: 1, experience: 5000 },
        balance: '10.0',
        inventory: {
          Sunflower: 100, // crop
          'Sunflower Seed': 50, // seed
          Wood: 200, // resource
          Axe: 5, // tool
          'Diving Helmet': 1, // collectible in metadata.ts
          'Giant Donut': 1, // collectible in metadata.ts
          'Ancient Unknown Alien Relic': 3, // unmapped/special
        },
      };

      const result = farmNormalizer.normalize(rawPayload, { farmId: '99999' });
      const inv = result.normalizedState.inventory;

      // Crop
      assert.equal(inv.crops['Sunflower'], 100);
      // Seed
      assert.equal(inv.seeds['Sunflower Seed'], 50);
      // Resource
      assert.equal(inv.resources['Wood'], 200);
      // Tool
      assert.equal(inv.tools['Axe'], 5);
      // Collectibles verified via itemMetadataService
      assert.equal(inv.collectibles['Diving Helmet'], 1);
      assert.equal(inv.collectibles['Giant Donut'], 1);
      // Unknown item preserved in special (zero loss)
      assert.equal(inv.special['Ancient Unknown Alien Relic'], 3);
      // All items in all
      assert.equal(inv.all['Ancient Unknown Alien Relic'], 3);
      assert.equal(inv.all['Diving Helmet'], 1);
    });

    it('respects crop precedence for collision items like Parsnip in inventory', () => {
      const rawPayload = {
        id: '99999',
        bumpkin: { id: 1, experience: 5000 },
        balance: '10.0',
        inventory: {
          Parsnip: 25,
        },
      };

      const result = farmNormalizer.normalize(rawPayload, { farmId: '99999' });
      const inv = result.normalizedState.inventory;

      // Parsnip in inventory is player's harvest crop
      assert.equal(inv.crops['Parsnip'], 25);
    });
  });

  // ── 4. AI Orchestrator get_item_metadata Tool ─────────────────────────────
  describe('4. AI Orchestrator get_item_metadata Tool & Epistemic Tier', () => {
    const orchestrator = new Orchestrator();

    it('returns AUTHORITATIVE epistemic tier for known collectible', async () => {
      const tool = orchestrator.tools.get_item_metadata;
      assert.ok(tool, 'get_item_metadata tool must be registered in Orchestrator');

      const res = await tool.exec({ itemName: 'Diving Helmet' }, { farmId: '10340', userId: 1 });

      assert.equal(res.success, true);
      assert.equal(res.epistemicTier, 'AUTHORITATIVE');
      assert.equal(res.data.item.name, 'Diving Helmet');
      assert.equal(res.data.item.kind, 'collectible');
      assert.equal(res.data.hasCollision, false);

      // Validate schema conformance
      const parseCheck = AIToolResultSchema.safeParse(res);
      assert.ok(parseCheck.success, `Schema validation failed: ${JSON.stringify(parseCheck.error)}`);
    });

    it('returns AUTHORITATIVE epistemic tier for known wearable', async () => {
      const tool = orchestrator.tools.get_item_metadata;
      const res = await tool.exec({ itemName: 'Farmer Hat' }, { farmId: '10340', userId: 1 });

      assert.equal(res.success, true);
      assert.equal(res.epistemicTier, 'AUTHORITATIVE');
      assert.equal(res.data.item.name, 'Farmer Hat');
      assert.equal(res.data.item.kind, 'wearable');
      assert.equal(res.data.item.part, 'Hat');

      const parseCheck = AIToolResultSchema.safeParse(res);
      assert.ok(parseCheck.success);
    });

    it('provides collision warning and disambiguation for collided items', async () => {
      const tool = orchestrator.tools.get_item_metadata;

      // Undisambiguated: returns collectible with note
      const resDefault = await tool.exec({ itemName: 'Chef Apron' }, { farmId: '10340', userId: 1 });
      assert.equal(resDefault.success, true);
      assert.equal(resDefault.data.hasCollision, true);
      assert.ok(resDefault.data.disambiguationNote?.includes('exists as both'));

      // Explicitly requested wearable
      const resWearable = await tool.exec({ itemName: 'Chef Apron', kind: 'wearable' }, { farmId: '10340', userId: 1 });
      assert.equal(resWearable.success, true);
      assert.equal(resWearable.data.item.kind, 'wearable');
      assert.equal(resWearable.data.item.part, 'Coat');
      assert.equal(resWearable.data.disambiguationNote, undefined);
    });

    it('returns structured INVALID_ARGUMENT error for non-existent item', async () => {
      const tool = orchestrator.tools.get_item_metadata;
      const res = await tool.exec({ itemName: 'NonExistentItem99' }, { farmId: '10340', userId: 1 });

      assert.equal(res.success, false);
      assert.equal(res.epistemicTier, 'AUTHORITATIVE');
      assert.equal(res.error?.code, 'INVALID_ARGUMENT');

      const parseCheck = AIToolResultSchema.safeParse(res);
      assert.ok(parseCheck.success);
    });
  });

  // ── 5. Compatibility items.json Artifact ───────────────────────────────────
  describe('5. Compatibility items.json Artifact', () => {
    it('preserves legacy baseline items with tradable and source properties', () => {
      const tomato = (itemsCompatibility as any)['Tomato'];
      assert.ok(tomato, 'Tomato must exist in items.json');
      assert.equal(tomato.tradable, true);
      assert.equal(tomato.source, 'crop');

      const cheese = (itemsCompatibility as any)['Cheese'];
      assert.ok(cheese, 'Cheese must exist in items.json');
      assert.equal(cheese.source, 'cooked');
      assert.equal(cheese.building, 'Deli');
    });

    it('includes metadata header declaring generated provenance', () => {
      const meta = (itemsCompatibility as any)['_meta'];
      assert.ok(meta, '_meta header must exist');
      assert.equal(meta.generated, true);
      assert.equal(meta.source, 'metadata.ts');
      assert.ok(meta.note.includes('GENERATED FILE'));
    });
  });
});
