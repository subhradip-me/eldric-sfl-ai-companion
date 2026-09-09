/**
 * server/types/index.ts
 * Shared domain interfaces for the Sunflower AI server.
 * All layers (controllers, services, models) import from here.
 */

import type { Request } from 'express';

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: number;
  username: string;
  iat?: number;
  exp?: number;
}

/** Express Request extended with decoded JWT fields */
export interface AuthenticatedRequest extends Request {
  userId: number;
  username: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  farmId?: string | null;
}

export interface UserRecord {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  farm_id: string | null;
  created_at: number;
  updated_at: number;
  last_login: number | null;
}

export interface AuthResult {
  success: boolean;
  user?: Partial<UserRecord>;
  token?: string;
  error?: string;
}

// ─── Farm State ───────────────────────────────────────────────────────────────

export type InventoryMap = Record<string, number>;
export type SkillMap = Record<string, number | boolean>;
export type WearablesMap = Record<string, string>;

export interface BumpkinState {
  level: number;
  xp: number;
}

export interface CurrencyState {
  flower: string;   // 18-dp string — never convert to float for money
  flowerApprox: number;
  sfl: number;
  coins: number;
}

export interface BuildingState {
  busyUntil: number | null;
  oil: number;
}

export interface DeliveryOrder {
  id: string;
  reward: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CanonicalFarmState {
  bumpkin: BumpkinState;
  currencies: CurrencyState;
  inventory: InventoryMap;
  skills: SkillMap;
  wearables: WearablesMap;
  buffs: { vip: boolean; active: string[] };
  buildings: Record<string, BuildingState>;
  farmActivity: Record<string, number>;
  deliveries: DeliveryOrder[];
  chores: Record<string, unknown>;
  bounties: { requests: unknown[]; completed: unknown[] };
  fetchedAt: number;
  stale?: boolean;
  cached?: boolean;
}

export interface RawFarmResponse {
  canonical: CanonicalFarmState;
  raw: unknown;
  stale: boolean;
  cached: boolean;
}

// ─── Market ───────────────────────────────────────────────────────────────────

export type MarketPrice = Record<string, number>;

export interface MarketResponse {
  prices: MarketPrice;
  updatedAt: string | null;
  stale: boolean;
}

// ─── Recipes & Cooking ────────────────────────────────────────────────────────

export interface RecipeDefinition {
  building: string;
  baseXp: number;
  baseCookMinutes: number;
  baseOutput?: number;
  instantGems?: number;
  ingredients: Record<string, number>;
  verified?: boolean;
  xpIncludesSkills?: boolean;
}

export interface BoostBreakdownEntry {
  skill: string;
  rank: number;
  label: string;
}

export interface EffectiveRecipe {
  recipe: string;
  output: number;
  xpPerFood: number;
  minutes: number;
  batchXp: number;
  ingredientMultiplier: number;
  effectiveIngredients: Record<string, number>;
  applied: string[];
  boostBreakdown: BoostBreakdownEntry[];
}

export interface CostResult {
  flower: number;       // out-of-pocket FLOWER to buy missing items
  totalFlower: number;  // full FLOWER market valuation
  buy: Record<string, number>;
  mustProduce: Record<string, number>;
  unpriced: string[];
}

export interface CookingPlanCandidate {
  recipe: string;
  verified: boolean;
  batchXp: number;
  flowerCost: number;
  flowerToBuy: number;
  buy: Record<string, number>;
  mustProduce: Record<string, number>;
  totalMinutes: number;
  xpPerFlower: number;
  xpPerHour: number;
  modifiers: string[];
  batchesToLevel100: number;
  totalMilestoneFlower: number;
}

export interface CookingPlanBuilding extends CookingPlanCandidate {
  building: string;
}

export interface CookingPlan {
  target: { level: number; xp: number; remaining: number };
  affordable: boolean;
  budget: { flower: string; coins: number };
  buildings: CookingPlanBuilding[];
  farm: string[];
  buy: string[];
  estimate?: {
    batches: number;
    flower: number;
    recipe: string;
    building: string;
    totalMilestoneFlower: number;
  };
  notes: string[];
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export interface CreateSnapshotInput {
  userId: number;
  createdAt: number;
  xp: number;
  flower: string;
  coins: number;
  stateHash: string;
  dataJson: CanonicalFarmState;
}

export interface SnapshotRecord {
  id: number;
  user_id: number;
  created_at: number;
  xp: number;
  flower: string;
  coins: number;
  state_hash: string;
  data_json: CanonicalFarmState;
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export interface ActivityDiff {
  observed: Record<string, number>;
  inferred: Record<string, number>;
  xpDelta: number;
  from: number;
  to: number;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface SaveMessageInput {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  userId: number;
  embedding?: string | null;
}

export interface ChatMessageRecord {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  user_id: number;
  created_at: number;
}

export interface SessionSummary {
  session_id: string;
  messages: number;
  started_at: number;
  last_at: number;
  first_message: string;
}

export interface SimilarMessage {
  role: string;
  content: string;
  score: number;
}
