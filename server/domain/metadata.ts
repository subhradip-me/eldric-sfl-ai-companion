/**
 * server/domain/metadata.ts
 * Authoritative item and collectible/wearable metadata domain contracts.
 *
 * ARCHITECTURAL INVARIANT:
 * Strict separation of concerns:
 * - Metadata defines WHAT the item is (name, description, tradable, slot/part, attributes).
 * - Effect Registry defines WHAT the item does (domain, operation, value, conditions).
 * - Farm State defines WHETHER it is active on this farm (equipped, placed, unlocked, timed).
 */

import type { EquippedSlot } from '../core/effectEngine/effectTypes.js';

export interface MetadataAttribute {
  trait_type: string;
  value: string | number;
}

export type ItemKind = 'collectible' | 'wearable';

export interface BaseItemMetadata {
  name: string;
  kind: ItemKind;
  description: string;
  decimals: number;
  tradable: boolean;
  attributes: MetadataAttribute[];
  external_url: string;
  purpose?: string;
  part?: EquippedSlot;
  boost?: {
    category?: string;
    traits?: Record<string, string | number>;
  };
}

export interface CollectibleMetadata extends BaseItemMetadata {
  kind: 'collectible';
  purpose: string;
}

export interface WearableMetadata extends BaseItemMetadata {
  kind: 'wearable';
  part: EquippedSlot;
}

export type ItemMetadata = CollectibleMetadata | WearableMetadata;

export interface GameMetadataManifest {
  schemaVersion: string;
  gameDataVersion: string;
  generatedAt: number;
  sourceFile: string;
  sourceSha256: string;
  collectibleCount: number;
  wearableCount: number;
  totalCount: number;
  collisionCount: number;
  collisions: string[];
}

export interface GameMetadataCatalog {
  manifest: GameMetadataManifest;
  collectibles: Record<string, CollectibleMetadata>;
  wearables: Record<string, WearableMetadata>;
}
