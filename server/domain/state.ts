/**
 * server/domain/state.ts
 * Modular decomposed sub-states and NormalizedFarmState.
 * Prevents monolithic state coupling across calculation and planning engines.
 */

import type { TimestampMs, FreshnessStatus, FlowerString } from './types.js';
import type { ActiveProductionItem } from './production.js';

export type InventoryMap = Record<string, number>;
export type SkillMap = Record<string, number | boolean>;
export type WearablesMap = Record<string, string>;

export interface PlayerState {
  bumpkinId?: string | number;
  level: number;
  experience: number;
  skills: SkillMap;
  equipped: WearablesMap;
  achievements?: Record<string, number>;
}

export interface EconomyState {
  flower: FlowerString;
  flowerApprox: number;
  sfl: number;
  coins: number;
  tradePoints?: number;
  previousBalance?: FlowerString;
}

export interface InventoryState {
  all: InventoryMap;
  seeds: InventoryMap;
  crops: InventoryMap;
  food: InventoryMap;
  resources: InventoryMap;
  tools: InventoryMap;
  collectibles: InventoryMap;
  fishing: InventoryMap;
  special: InventoryMap;
}

export interface BuildingInstance {
  readyAt?: TimestampMs | null;
  coordinates?: { x: number; y: number };
  crafting?: Array<{
    name: string;
    readyAt: TimestampMs;
    amount?: number;
  }>;
  oil?: number;
}

export interface FarmStructureState {
  buildings: Record<string, BuildingInstance[]>;
  waterWells?: number;
  oilReserves?: number;
}

export interface ProductionState {
  active: ActiveProductionItem[];
  crops?: ActiveProductionItem[];
  cooking?: ActiveProductionItem[];
  greenhouse?: ActiveProductionItem[];
  fruit?: ActiveProductionItem[];
  mining?: ActiveProductionItem[];
}

export interface AnimalInstance {
  id: string;
  type: 'chicken' | 'cow' | 'sheep';
  level: number;
  fedAt?: TimestampMs;
  rewardReadyAt?: TimestampMs;
  multiplier?: number;
}

export interface AnimalState {
  animals: Record<string, AnimalInstance>;
}

export interface PetInstance {
  id: string;
  name: string;
  level: number;
  experience: number;
  energy?: number;
  traits?: string[];
}

export interface PetState {
  pets: Record<string, PetInstance>;
}

export interface ProgressionState {
  islandType: 'basic' | 'spring' | 'desert' | 'volcano' | 'spooky';
  expansions: number;
  ascensionLevel: number;
  sunstones: number;
  biome?: string;
}

export interface DeliveryItem {
  id: string;
  from?: string;
  items?: Record<string, number>;
  reward?: Record<string, unknown>;
  completedAt?: TimestampMs | null;
}

export interface DeliveryState {
  orders: DeliveryItem[];
  chores?: Record<string, unknown>;
  bounties?: {
    requests: unknown[];
    completed: unknown[];
  };
}

export interface BuffState {
  vip: boolean;
  vipExpiresAt?: TimestampMs | null;
  activeBuffNames: string[];
  wearableBoosts?: Record<string, number>;
  placedItemBoosts?: Record<string, number>;
}

export interface TemporalState {
  currentDay?: number;
  season?: string;
  nextResetAt?: TimestampMs;
}

export interface StateMetadata {
  capturedAt: TimestampMs;
  fetchedAt?: TimestampMs;
  normalizerVersion: string;
  source: string;
  freshness: FreshnessStatus;
  cached?: boolean;
}

/**
 * NormalizedFarmState — decomposed semantic representation.
 * Each subsystem can extract its required sub-context.
 */
export interface NormalizedFarmState {
  player: PlayerState;
  economy: EconomyState;
  inventory: InventoryState;
  structures: FarmStructureState;
  production: ProductionState;
  animals: AnimalState;
  pets: PetState;
  progression: ProgressionState;
  deliveries: DeliveryState;
  buffs: BuffState;
  temporal: TemporalState;
  metadata: StateMetadata;
}
