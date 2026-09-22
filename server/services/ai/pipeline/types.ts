/**
 * server/services/ai/pipeline/types.ts
 * Type definitions for the 4-Stage AI Pipeline:
 * Stage 1: Planner
 * Stage 2: Orchestrator (Tool Execution)
 * Stage 3: Deterministic Validator
 * Stage 4: Explainer
 */

import type { AIToolResult, CalculationProvenance, NormalizedFarmState } from '../../../domain/index.js';

export type PipelineIntent =
  | 'RECIPE_OR_CRAFT'
  | 'BUILDING'
  | 'EXPANSION'
  | 'LEVEL_XP'
  | 'SKILLS'
  | 'DELIVERIES'
  | 'BUY_VS_FARM'
  | 'ROADMAP'
  | 'MARKET_PRICES'
  | 'SELL_ADVICE'
  | 'GENERAL_QUERY';

/** The complete set of valid intents, for guardrail whitelisting. */
export const PIPELINE_INTENTS: readonly PipelineIntent[] = [
  'RECIPE_OR_CRAFT',
  'BUILDING',
  'EXPANSION',
  'LEVEL_XP',
  'SKILLS',
  'DELIVERIES',
  'BUY_VS_FARM',
  'ROADMAP',
  'MARKET_PRICES',
  'SELL_ADVICE',
  'GENERAL_QUERY',
] as const;

/** One-line description of each intent, used to prompt the LLM classifier. */
export const PIPELINE_INTENT_DESCRIPTIONS: Record<PipelineIntent, string> = {
  RECIPE_OR_CRAFT: 'Cooking/crafting economics — recipe XP, ingredient cost, time for a named dish or item.',
  BUILDING: 'Requirements/cost to construct or upgrade a building (Barn, Bakery, Deli, etc.).',
  EXPANSION: 'Land expansion or island travel — next plot, reaching a future island.',
  LEVEL_XP: 'Bumpkin level progression — XP thresholds, XP needed to reach a level.',
  SKILLS: 'Skill tree progression — which skill to unlock next.',
  DELIVERIES: 'Codex deliveries, weekly chores, and Poppy bounties.',
  BUY_VS_FARM: 'Whether to buy an item on the market vs produce it in-house.',
  ROADMAP: 'Strategic priorities / daily cooking plan / "what should I do".',
  MARKET_PRICES: 'Live P2P market prices — "check the p2p market", "what are current prices".',
  SELL_ADVICE: 'What to sell to raise FLOWER / fill a FLOWER gap, ranked by value.',
  GENERAL_QUERY: 'General game-knowledge questions not covered by another intent.',
};

export interface ValidationCriteria {
  requiredEntity?: string;              // e.g. "Iron Pickaxe", "Barn", "Pancakes"
  requiredCatalog?: string;             // e.g. "TOOLS", "BUILDINGS", "RECIPES"
  requireFarmInventory?: string[];      // e.g. ["Wood", "Iron", "Coins"]
  requireBuildingCheck?: string;        // e.g. "Blacksmith", "Fire Pit"
  requireBumpkinLevel?: number;         // e.g. 30
  checkBoosters?: boolean;              // e.g. true to factor in active buffs/skills
  actionType?: 'CRAFT' | 'BUILD' | 'COOK' | 'EXPAND' | 'GENERAL';
  quantity?: number;                    // e.g. 24 for "24 cheese"
  isCostQuery?: boolean;                // e.g. true if query asks about cost/ingredients/price
}

export interface ResourceDiffRow {
  item: string;
  needed: number;
  stock: number;
  shortfall: number;                    // Math.max(0, needed - stock)
  surplus: number;                      // Math.max(0, stock - needed)
  status: 'MET' | 'SHORTFALL' | 'MISSING_BUILDING' | 'LOCKED_LEVEL';
  note?: string;
}

export interface ActiveBuffSummary {
  sourceId: string;
  sourceType: string;
  description: string;
  effectText: string;
}

export interface PrecomputedSynthesis {
  entityName?: string;
  canAfford: boolean;
  levelMet?: boolean;
  requiredLevel?: number;
  currentLevel?: number;
  buildingMet?: boolean;
  requiredBuilding?: string;
  buildingStatus?: string;
  rows: ResourceDiffRow[];
  markdownTable: string;
  ingredientTable?: string;             // Standalone ingredient breakdown w/ market prices (cost queries)
  summaryText: string;
  activeBuffs: ActiveBuffSummary[];
  buffsImpactText?: string;
  boostedValues?: {
    effectiveCookTime?: number;
    effectiveFoodXp?: number;
    effectiveYield?: number;
    effectiveCost?: number;
    [key: string]: number | undefined;
  };
  degradedMode?: boolean;
  degradedReason?: string;
}

export interface ValidationReport {
  status: 'VALID' | 'INVALID' | 'DATA_UNAVAILABLE';
  missingKeys: string[];
  critique?: string;
  targetTool?: { name: string; args: Record<string, unknown> };
  synthesis?: PrecomputedSynthesis;
}

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
}

export interface ExecutionPlan {
  userGoal: string;
  intent: PipelineIntent;
  criteria: ValidationCriteria;
  plannedTools: ToolCallSpec[];
  clarificationQuestion?: string;
  /**
   * Presentation/guardrail hints for the Explainer. Strings only — NEVER numbers.
   * Advisory: the LLM planner emits these to steer how the answer is framed;
   * all authoritative numbers still come from tool results.
   */
  synthesisDirectives?: string[];
  /** How this plan was produced. Advisory only; the guardrail is authoritative. */
  planSource?: 'LLM' | 'DETERMINISTIC';
}

/**
 * The advisory output of the LLM classifier (LlmPlanner). It decides what MATTERS
 * (intent, preferences, constraints, which tools to fetch). It NEVER emits a number,
 * candidate, or answer — PlanGuardrail re-derives everything against the real catalog.
 */
export interface ClassifiedPlan {
  intent: PipelineIntent;
  criteria: ValidationCriteria;
  goal?: string;
  plannedTools: ToolCallSpec[];
  synthesisDirectives: string[];
}

/**
 * Minimal shape of a registered tool needed to build the LLM catalog and to
 * type-coerce args deterministically in the guardrail.
 */
export interface ToolCatalogEntry {
  description?: string;
  parameters?: {
    type?: string;
    properties?: Record<string, { type?: string; enum?: unknown[]; [k: string]: unknown }>;
    required?: string[];
    [k: string]: unknown;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: (params: any, context: any) => Promise<unknown>;
}

export type ToolCatalog = Record<string, ToolCatalogEntry>;

export interface PipelineStep {
  stage: 'PLANNER' | 'ORCHESTRATOR' | 'VALIDATOR' | 'EXPLAINER';
  tool?: string;
  ok: boolean;
  epistemicTier?: 'AUTHORITATIVE' | 'OBSERVED' | 'DERIVED' | 'INFERRED';
  cached?: boolean;
  details?: string;
}

export interface PipelineExecutionResult {
  success: boolean;
  answer: string;
  steps: PipelineStep[];
  validationReport?: ValidationReport;
  warnings?: string[];
  provenance?: CalculationProvenance;
}

export interface PipelineContext {
  sessionId: string;
  userId: number;
  farmId: string;
  userGoal: string;
  farmState?: NormalizedFarmState;
  rawFarm?: unknown;
  productionContextBlock?: string;
}
