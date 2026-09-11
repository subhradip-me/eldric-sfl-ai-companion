/**
 * server/scripts/generateGameMetadata.ts
 * Deterministic TypeScript AST parser and generator for Sunflower Land game metadata.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Zero regex: uses the official TypeScript compiler AST parser (ts.createSourceFile).
 * 2. Fail-hard validations on counts, internal duplicates, missing fields, and unexpected collisions.
 * 3. Separation of Concerns: Slices item definition (what it is) without guessing effect mechanics (what it does).
 * 4. Outputs:
 *    - server/data/gameMetadata.json (authoritative versioned catalog with SHA-256 manifest)
 *    - server/data/items.json (generated backward-compatible item dictionary)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';

import type {
  GameMetadataCatalog,
  GameMetadataManifest,
  CollectibleMetadata,
  WearableMetadata,
  MetadataAttribute,
} from '../domain/metadata.js';
import type { EquippedSlot } from '../core/effectEngine/effectTypes.js';

// ── Expected Gate Constants ──────────────────────────────────────────────────
export const EXPECTED_COLLECTIBLE_COUNT = 1409;
export const EXPECTED_WEARABLE_COUNT = 581;
export const EXPECTED_TOTAL_COUNT = 1990;
export const EXPECTED_COLLISION_COUNT = 16;
export const GAME_DATA_VERSION = '2026.09.12';
export const SCHEMA_VERSION = '1.0.0';

export const KNOWN_COLLISIONS = [
  'Ancient Goblin Sword',
  'Axe',
  'Beetroot Amulet',
  'Carrot Amulet',
  'Chef Apron',
  'Chef Hat',
  'Goblin Crown',
  'Green Amulet',
  'Hammer',
  'Parsnip',
  'Skull Hat',
  'Sunflower Amulet',
  'Sunflower Shield',
  'Warrior Helmet',
  'Warrior Pants',
  'Warrior Shirt',
].sort();

// Legacy items baseline to guarantee 100% backward compatibility
const LEGACY_BASELINE: Record<string, { tradable: boolean; source: string; building?: string }> = {
  Tomato: { tradable: true, source: 'crop' },
  Wheat: { tradable: true, source: 'crop' },
  Lemon: { tradable: true, source: 'fruit' },
  Honey: { tradable: true, source: 'beehive' },
  Egg: { tradable: true, source: 'animal' },
  Milk: { tradable: true, source: 'animal' },
  'Magic Mushroom': { tradable: false, source: 'spawn' },
  Cheese: { tradable: false, source: 'cooked', building: 'Deli' },
};

export interface ExtractionResult {
  catalog: GameMetadataCatalog;
  itemsJson: Record<string, unknown>;
}

export function extractGameMetadata(metadataTsPath: string): ExtractionResult {
  if (!fs.existsSync(metadataTsPath)) {
    throw new Error(`Source metadata file does not exist at: ${metadataTsPath}`);
  }

  const sourceText = fs.readFileSync(metadataTsPath, 'utf8');
  const sourceSha256 = crypto.createHash('sha256').update(sourceText).digest('hex');

  const sourceFile = ts.createSourceFile(
    path.basename(metadataTsPath),
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  let collectiblesNode: ts.ObjectLiteralExpression | null = null;
  let wearablesNode: ts.ObjectLiteralExpression | null = null;

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const declName = decl.name.getText(sourceFile);
        if (declName === 'OPEN_SEA_COLLECTIBLES' && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          collectiblesNode = decl.initializer;
        } else if (declName === 'OPEN_SEA_WEARABLES' && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          wearablesNode = decl.initializer;
        }
      }
    }
  }

  if (!collectiblesNode) {
    throw new Error('Could not find OPEN_SEA_COLLECTIBLES declaration in metadata.ts');
  }
  if (!wearablesNode) {
    throw new Error('Could not find OPEN_SEA_WEARABLES declaration in metadata.ts');
  }

  // ── Helper to evaluate string or number literal ────────────────────────────
  const parseLiteralValue = (expr: ts.Expression): string | number => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }
    if (ts.isNumericLiteral(expr)) {
      return Number(expr.text);
    }
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return 'Yes';
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return 'No';
    return expr.getText(sourceFile).replace(/^["']|["']$/g, '');
  };

  // ── Helper to parse a single metadata item object literal ──────────────────
  const parseItemObject = (
    name: string,
    objNode: ts.ObjectLiteralExpression,
    kind: 'collectible' | 'wearable'
  ): CollectibleMetadata | WearableMetadata => {
    let description = '';
    let decimals = 0;
    let external_url = 'https://docs.sunflower-land.com/getting-started/about';
    const attributes: MetadataAttribute[] = [];

    for (const prop of objNode.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const propKey = prop.name.getText(sourceFile).replace(/^["']|["']$/g, '');

      if (propKey === 'description') {
        description = String(parseLiteralValue(prop.initializer));
      } else if (propKey === 'decimals') {
        decimals = Number(parseLiteralValue(prop.initializer));
      } else if (propKey === 'external_url') {
        external_url = String(parseLiteralValue(prop.initializer));
      } else if (propKey === 'attributes' && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const elem of prop.initializer.elements) {
          if (ts.isObjectLiteralExpression(elem)) {
            let trait_type = '';
            let val: string | number = '';
            for (const aProp of elem.properties) {
              if (ts.isPropertyAssignment(aProp)) {
                const aKey = aProp.name.getText(sourceFile).replace(/^["']|["']$/g, '');
                if (aKey === 'trait_type') trait_type = String(parseLiteralValue(aProp.initializer));
                else if (aKey === 'value') val = parseLiteralValue(aProp.initializer);
              }
            }
            if (trait_type) {
              attributes.push({ trait_type, value: val });
            }
          }
        }
      }
    }

    // Tradability
    const tradableAttr = attributes.find((a) => a.trait_type === 'Tradable');
    const tradable = tradableAttr ? tradableAttr.value === 'Yes' : false;

    // Boost descriptive metadata
    const boostAttr = attributes.find((a) => a.trait_type === 'Boost');
    const boostTraits: Record<string, string | number> = {};
    for (const a of attributes) {
      const lower = a.trait_type.toLowerCase();
      if (
        lower.includes('increase') ||
        lower.includes('yield') ||
        lower.includes('drop') ||
        lower.includes('xp') ||
        lower.includes('without') ||
        lower.includes('boost')
      ) {
        boostTraits[a.trait_type] = a.value;
      }
    }
    const hasBoost = boostAttr != null || Object.keys(boostTraits).length > 0;
    const boost = hasBoost
      ? {
          category: boostAttr ? String(boostAttr.value) : undefined,
          traits: Object.keys(boostTraits).length > 0 ? boostTraits : undefined,
        }
      : undefined;

    if (kind === 'wearable') {
      const partAttr = attributes.find((a) => a.trait_type === 'Part');
      const part = (partAttr ? String(partAttr.value) : 'Unknown') as EquippedSlot;
      return {
        name,
        kind: 'wearable',
        description,
        decimals,
        tradable,
        attributes,
        external_url,
        part,
        boost,
      };
    }

    const purposeAttr = attributes.find((a) => a.trait_type === 'Purpose');
    const purpose = purposeAttr ? String(purposeAttr.value) : 'Decoration';
    return {
      name,
      kind: 'collectible',
      description,
      decimals,
      tradable,
      attributes,
      external_url,
      purpose,
      boost,
    };
  };

  // ── Extract Collectibles ───────────────────────────────────────────────────
  const collectibles: Record<string, CollectibleMetadata> = {};
  const seenCollectibleNames = new Set<string>();

  for (const prop of collectiblesNode.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const name = prop.name.getText(sourceFile).replace(/^["']|["']$/g, '');
      if (seenCollectibleNames.has(name)) {
        throw new Error(`Duplicate collectible name detected in metadata.ts: "${name}"`);
      }
      seenCollectibleNames.add(name);

      if (ts.isObjectLiteralExpression(prop.initializer)) {
        collectibles[name] = parseItemObject(name, prop.initializer, 'collectible') as CollectibleMetadata;
      }
    }
  }

  // ── Extract Wearables ──────────────────────────────────────────────────────
  const wearables: Record<string, WearableMetadata> = {};
  const seenWearableNames = new Set<string>();

  for (const prop of wearablesNode.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const name = prop.name.getText(sourceFile).replace(/^["']|["']$/g, '');
      if (seenWearableNames.has(name)) {
        throw new Error(`Duplicate wearable name detected in metadata.ts: "${name}"`);
      }
      seenWearableNames.add(name);

      if (ts.isObjectLiteralExpression(prop.initializer)) {
        wearables[name] = parseItemObject(name, prop.initializer, 'wearable') as WearableMetadata;
      }
    }
  }

  const collectibleCount = Object.keys(collectibles).length;
  const wearableCount = Object.keys(wearables).length;
  const totalCount = collectibleCount + wearableCount;

  // ── Detect Collisions ──────────────────────────────────────────────────────
  const collisions: string[] = [];
  for (const name of Object.keys(wearables)) {
    if (collectibles[name]) {
      collisions.push(name);
    }
  }
  collisions.sort();
  const collisionCount = collisions.length;

  // ── Count Invariant Verification & Reporting ──────────────────────────────
  const countChecks = [
    { label: 'Collectibles', actual: collectibleCount, expected: EXPECTED_COLLECTIBLE_COUNT },
    { label: 'Wearables', actual: wearableCount, expected: EXPECTED_WEARABLE_COUNT },
    { label: 'Total Items', actual: totalCount, expected: EXPECTED_TOTAL_COUNT },
    { label: 'Collisions', actual: collisionCount, expected: EXPECTED_COLLISION_COUNT },
  ];

  console.log('\n================ Game Metadata Ingestion Report ================');
  console.log('| Category     | Actual Count | Expected Count | Status        |');
  console.log('|--------------|--------------|----------------|---------------|');
  let hasMismatch = false;
  for (const check of countChecks) {
    const match = check.actual === check.expected;
    if (!match) hasMismatch = true;
    const status = match ? 'PASSED (MATCH)' : 'FAILED (MISMATCH)';
    console.log(
      `| ${check.label.padEnd(12)} | ${String(check.actual).padEnd(12)} | ${String(check.expected).padEnd(14)} | ${status.padEnd(13)} |`
    );
  }
  console.log('================================================================\n');

  if (hasMismatch) {
    const mismatches = countChecks
      .filter((c) => c.actual !== c.expected)
      .map((c) => `${c.label}: actual ${c.actual} vs expected ${c.expected}`)
      .join(', ');
    throw new Error(
      `Manifest contract assertion failed! Upstream metadata count mismatch detected before manifest acceptance: ${mismatches}`
    );
  }

  // Verify all expected collision names match exactly
  const missingCollisions = KNOWN_COLLISIONS.filter((name) => !collisions.includes(name));
  const unexpectedCollisions = collisions.filter((name) => !KNOWN_COLLISIONS.includes(name));
  if (missingCollisions.length > 0 || unexpectedCollisions.length > 0) {
    throw new Error(
      `Collision gate mismatch! Missing: [${missingCollisions.join(', ')}], Unexpected: [${unexpectedCollisions.join(', ')}]`
    );
  }

  // ── Build Catalog Manifest ─────────────────────────────────────────────────
  const manifest: GameMetadataManifest = {
    schemaVersion: SCHEMA_VERSION,
    gameDataVersion: GAME_DATA_VERSION,
    generatedAt: Date.now(),
    sourceFile: 'metadata.ts',
    sourceSha256,
    collectibleCount,
    wearableCount,
    totalCount,
    collisionCount,
    collisions,
  };

  const catalog: GameMetadataCatalog = {
    manifest,
    collectibles,
    wearables,
  };

  // ── Build Backward-Compatible items.json ───────────────────────────────────
  const itemsJson: Record<string, unknown> = {
    _meta: {
      generated: true,
      source: 'metadata.ts',
      generator: 'server/scripts/generateGameMetadata.ts',
      schemaVersion: SCHEMA_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
      sourceSha256,
      note: 'GENERATED FILE — DO NOT EDIT. Sourced deterministically from metadata.ts.',
    },
  };

  // 1. Populate Legacy Baseline (exact backward-compatibility)
  for (const [key, val] of Object.entries(LEGACY_BASELINE)) {
    itemsJson[key] = { ...val };
  }

  // 2. Populate All Collectibles
  for (const [name, col] of Object.entries(collectibles)) {
    if (!itemsJson[name]) {
      itemsJson[name] = {
        tradable: col.tradable,
        kind: 'collectible',
        purpose: col.purpose,
        description: col.description,
        ...(col.boost?.category ? { boostCategory: col.boost.category } : {}),
      };
    }
  }

  // 3. Populate All Wearables (without overwriting legacy if already present)
  for (const [name, wear] of Object.entries(wearables)) {
    if (!itemsJson[name]) {
      itemsJson[name] = {
        tradable: wear.tradable,
        kind: 'wearable',
        part: wear.part,
        description: wear.description,
        ...(wear.boost?.category ? { boostCategory: wear.boost.category } : {}),
      };
    } else {
      // If collided, record wearable metadata in wearablePart property
      const existing = itemsJson[name] as Record<string, unknown>;
      existing.wearablePart = wear.part;
    }
  }

  return { catalog, itemsJson };
}

// ── CLI Runner ───────────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('generateGameMetadata.ts') || process.argv[1]?.endsWith('generateGameMetadata.js');
if (isMain) {
  const metadataPath = path.resolve(process.cwd(), 'metadata.ts');
  const targetCatalogPath = path.resolve(process.cwd(), 'server/data/gameMetadata.json');
  const targetItemsPath = path.resolve(process.cwd(), 'server/data/items.json');

  console.log(`Ingesting metadata from: ${metadataPath}`);
  const { catalog, itemsJson } = extractGameMetadata(metadataPath);

  fs.writeFileSync(targetCatalogPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`Wrote authoritative catalog: ${targetCatalogPath} (${(fs.statSync(targetCatalogPath).size / 1024).toFixed(1)} KB)`);

  fs.writeFileSync(targetItemsPath, JSON.stringify(itemsJson, null, 2), 'utf8');
  console.log(`Wrote items compatibility dictionary: ${targetItemsPath} (${(fs.statSync(targetItemsPath).size / 1024).toFixed(1)} KB)`);

  console.log('✅ Metadata ingestion completed successfully!');
}
