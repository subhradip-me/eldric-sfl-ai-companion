/**
 * server/services/metadata/ItemMetadataService.ts
 * Authoritative item metadata service providing typed access to official game catalog.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Read-only authoritative catalog sourced deterministically from metadata.ts.
 * 2. Separation of Concerns: Slices item definition (what it is) without calculating
 *    effect mechanics or multipliers (what it does).
 * 3. Explicit collision handling for items existing as both collectibles and wearables.
 * 4. Zero runtime regex parsing: operates over pre-verified structured catalog.
 */

import type {
  GameMetadataCatalog,
  GameMetadataManifest,
  CollectibleMetadata,
  WearableMetadata,
  ItemMetadata,
  ItemKind,
} from '../../domain/metadata.js';
import type { EquippedSlot } from '../../core/effectEngine/effectTypes.js';

import defaultCatalog from '../../data/gameMetadata.json' with { type: 'json' };

export class ItemMetadataService {
  private readonly catalog: GameMetadataCatalog;
  private readonly collisionSet: Set<string>;

  constructor(customCatalog?: GameMetadataCatalog) {
    this.catalog = customCatalog ?? (defaultCatalog as unknown as GameMetadataCatalog);
    this.collisionSet = new Set(this.catalog.manifest?.collisions ?? []);
  }

  /**
   * Returns the cryptographic and version provenance manifest.
   */
  public getManifest(): GameMetadataManifest {
    return this.catalog.manifest;
  }

  /**
   * Returns collectible metadata by name, or null if not found.
   */
  public getCollectible(name: string): CollectibleMetadata | null {
    return this.catalog.collectibles[name] ?? null;
  }

  /**
   * Returns wearable metadata by name, or null if not found.
   */
  public getWearable(name: string): WearableMetadata | null {
    return this.catalog.wearables[name] ?? null;
  }

  /**
   * Returns item metadata by name with optional kind discriminator.
   * If kind is not specified and the item is in both categories (collision),
   * the collectible definition is returned by default.
   */
  public getItem(name: string, kind?: ItemKind): ItemMetadata | null {
    if (kind === 'collectible') {
      return this.getCollectible(name);
    }
    if (kind === 'wearable') {
      return this.getWearable(name);
    }

    // Default lookup precedence: collectible first, then wearable
    return this.catalog.collectibles[name] ?? this.catalog.wearables[name] ?? null;
  }

  /**
   * Checks if an item exists as both a collectible and a wearable.
   */
  public hasCollision(name: string): boolean {
    return this.collisionSet.has(name);
  }

  /**
   * Returns all item names that exist in both collectibles and wearables.
   */
  public getCollisions(): string[] {
    return [...(this.catalog.manifest?.collisions ?? [])];
  }

  /**
   * Returns the wearable equipment slot for an item, or null if not a wearable.
   */
  public getWearableSlot(name: string): EquippedSlot | null {
    return this.catalog.wearables[name]?.part ?? null;
  }

  /**
   * Returns the collectible purpose for an item, or null if not a collectible.
   */
  public getPurpose(name: string): string | null {
    return this.catalog.collectibles[name]?.purpose ?? null;
  }

  /**
   * Returns the classification of an item.
   */
  public getItemKind(name: string): 'collectible' | 'wearable' | 'both' | null {
    const isCol = Boolean(this.catalog.collectibles[name]);
    const isWear = Boolean(this.catalog.wearables[name]);

    if (isCol && isWear) return 'both';
    if (isCol) return 'collectible';
    if (isWear) return 'wearable';
    return null;
  }

  /**
   * Returns whether the item is known in the authoritative catalog.
   */
  public isKnownItem(name: string): boolean {
    return Boolean(this.catalog.collectibles[name] || this.catalog.wearables[name]);
  }

  /**
   * Returns all items matching a descriptive boost category (case-insensitive).
   * Note: This searches descriptive metadata, NOT effect engine mechanics.
   */
  public getItemsByBoostCategory(category: string): ItemMetadata[] {
    const lower = category.toLowerCase();
    const results: ItemMetadata[] = [];

    for (const item of Object.values(this.catalog.collectibles)) {
      if (item.boost?.category?.toLowerCase() === lower) {
        results.push(item);
      }
    }

    for (const item of Object.values(this.catalog.wearables)) {
      if (item.boost?.category?.toLowerCase() === lower) {
        // Only avoid duplicate reference if collided item was already added
        results.push(item);
      }
    }

    return results;
  }

  /**
   * Returns all collectibles in the catalog.
   */
  public getAllCollectibles(): CollectibleMetadata[] {
    return Object.values(this.catalog.collectibles);
  }

  /**
   * Returns all wearables in the catalog.
   */
  public getAllWearables(): WearableMetadata[] {
    return Object.values(this.catalog.wearables);
  }

  /**
   * Returns all items in the catalog (total items).
   */
  public getAllItems(): ItemMetadata[] {
    return [...this.getAllCollectibles(), ...this.getAllWearables()];
  }
}

/**
 * Singleton instance of the authoritative ItemMetadataService.
 */
export const itemMetadataService = new ItemMetadataService();
