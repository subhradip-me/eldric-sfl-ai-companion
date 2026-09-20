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
  | 'GENERAL_QUERY';

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
}

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
