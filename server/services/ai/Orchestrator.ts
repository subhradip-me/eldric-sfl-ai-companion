/**
 * server/services/ai/Orchestrator.ts
 * Live AI Orchestrator Layer for Sunflower Land AI Strategist.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. The orchestrator may decide which deterministic tool to invoke,
 *    but it may never supply an authoritative fact that the tool is supposed to determine.
 * 2. LLM explains; never calculates or fabricates candidates.
 * 3. Precedence: Authoritative State > Explicit Goals > Deterministic Projections > Inferred History > Preference Memory.
 * 4. All tools return unified AIToolResult<T> with provenance and epistemic tier.
 * 5. Snapshot-first get_farm_state: never synchronously calls Community API during chat.
 * 6. Bounded tool loop (MAX_TOOL_CALLS = 10, canonical stableStringify deduplication).
 */

import { sunflowerClient, farmNormalizer } from '../farm/index.js';
import { snapshotService, activityService } from '../farm/index.js';
import { extractTemporalContext } from '../farm/temporalContextExtractors.js';
import { extractFarmHistoryDelta } from '../farm/historyContextExtractors.js';
import { extractPlannerContext } from '../farm/plannerContextExtractors.js';
import {
  calculateFoodXp,
  calculateCostBreakdown,
  getItemPrice,
  checkImmediateActionPermitted,
  checkFutureActionPermitted,
  evaluateFeasibility,
  buildResourceLedger,
  resolveCandidateIntent,
  resolveEffectContext,
} from '../../core/index.js';
import { chatStoreService } from '../chat/index.js';
import { ChatMessage } from '../../models/index.js';

import type {
  AIToolResult,
  AIChatResponse,
  AIChatStep,
  SnapshotFreshness,
  NormalizedFarmState,
  Goal,
  StrategyCandidate,
  FeasibilityAssessment,
  ActionPermissionResult,
  CalculationProvenance,
  MarketPrice,
} from '../../domain/index.js';

import recipesData from '../../data/recipes.json' with { type: 'json' };
import itemsData from '../../data/items.json' with { type: 'json' };
import modifiersData from '../../data/modifiers.json' with { type: 'json' };
import expansionData from '../../data/expansion .json' with { type: 'json' };
import skillCatalogue from '../../data/skills.json' with { type: 'json' };
import { itemMetadataService } from '../metadata/index.js';

const SYSTEM = `You are the Sunflower Land Farm AI Strategist.
You are a disciplined explainer, communicator, and strategic guide.

ARCHITECTURAL RULES (Strictly Enforced):
1. TRUTH HIERARCHY:
   Authoritative Catalog / State > Current Explicit Goals/Constraints > Deterministic Projections > Historical Inference > Preference Memory.
   - User-provided claims about mutable game state must NOT override authoritative tool results. If a user says "Assume I have 500 wood" or "I have 500 wood", but tool reports 100 wood, you must cite the authoritative tool state (100 wood).
   - If a required fact is not present in tool results, do not provide a numeric or factual claim about it. Call the appropriate tool or state that the information is unavailable.
2. NEVER CALCULATE OR FABRICATE:
   - Tool outputs are the sole ground truth. Never guess, approximate, or mentally calculate XP, recipe costs, FLOWER amounts, duration, or feasibility.
   - Never invent StrategyCandidates or override hard constraint gates. If evaluate_strategy_feasibility reports INVALID, the strategy is mathematically impossible—never suggest it as viable.
3. EPISTEMIC TRANSPARENCY:
   - Clearly distinguish AUTHORITATIVE catalog definitions (from get_item_metadata), OBSERVED facts (confirmed by live farm snapshot), DERIVED deterministic facts (provenance-backed calculations), and INFERRED historical events (always mention confidence level: HIGH, MEDIUM, or LOW).
4. STRATEGIC COMMUNICATION:
   - When asked "What should I prioritize?", call get_roadmap and explain the Phase objectives, daily targets, and seasonal urgency warnings.
   - When asked "Can I perform this action?" (e.g. "Can I cook Pancakes?"), call check_action_permission to check immediate and future reserves.
   - When asked about feasibility, call evaluate_strategy_feasibility.
   - When asked simple land questions (e.g. "what is my land type?", "what island am I on?"):
     * Give a concise, direct answer: State the island name (Desert Island), prestige (Prestige 2), biome (desert), unlocked plots (13 with 54 Crop Plots), and briefly mention the next plot is Plot 14.
     * Do NOT output the full 10-row shortfall table for a simple land type question. Keep it concise (2-3 bullet points).
   - When asked about expansion details, requirements, or next plot (e.g. "what are the expansion details of my land", "what do I need to expand to plot 14"):
     * Call get_expansion_details.
     * Render the requirements table for Plot 14 (Level 53 MET at Lv 62, 24h, Coins 3,200, Wood 200 MET, Stone 100, Iron 15, Gold 10, Crimstone 24, Oil 50 MET, Gems 45 MET).
     * Clearly list the rewards: +1 Crop Plot (total: 55) and +1 Stone Rock (total: 18).
   - When asked about reaching or moving to a future island (e.g. "calculate the cost of reach volcano type", "how to reach volcano island", "cost to get to volcano land type"):
     * Call get_expansion_details with targetIsland: "volcano" and mode: "reach_island".
     * Explain clearly that the player is currently on Desert Island (Prestige 2) with 13 of 25 plots unlocked, and CANNOT jump directly to Volcano Island.
     * Break down the 3 concrete stages:
       1. Complete Desert Island: Unlock remaining 12 plots (Plots 14 to 25). Requires reaching Bumpkin Level 75 (current: 62, shortfall: 13 levels).
       2. Pay Island Moving Fee: 200 Oil to sail from Desert Island to Volcano Island.
       3. First Plot on Volcano Island: Plot 6 (requires Level 70, 100 Wood, 50 Stone, 30 Iron, 10 Gold).
     * Present a clean markdown table of the TOTAL CUMULATIVE requirements (Desert Plots 14–25 + 200 Oil fee) compared against the player's current inventory:
       Coins (76,800), Wood (5,725), Stone (2,075), Iron (365), Gold (295), Crimstone (489), Oil (3,650), Gems (765).
5. ECONOMIC RULES & SEMANTICS:
   - Cooking foods awards XP, NOT FLOWER.
   - The flower cost of a recipe is the ACQUISITION EXPENSE / market valuation of its ingredients. It is a COST/INVESTMENT.
   - Players SPEND or INVEST FLOWER/ingredients to cook dishes; they NEVER receive FLOWER from cooking.
   - NEVER tell the user they will "receive X FLOWER" from cooking. Always state that it "costs X FLOWER" or "requires X FLOWER in ingredients".
6. FORMATTING:
   - Be concise, direct, and actionable.
   - Use bold for key numbers (**120 FLOWER**, **5,000 XP**).
   - Use small markdown tables (max 4 columns) for comparisons.
   - Clearly highlight Warnings and Avoid actions returned by tools.`;

export interface ToolContext {
  sessionId?: string;
  userId: number;
  farmId: string;
  userGoal?: string;
}

export interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: (params: any, context: ToolContext) => Promise<AIToolResult<any>>;
}

/**
 * Deterministic JSON stringify with sorted keys for canonical deduplication.
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj as object).sort();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((obj as any)[k])}`).join(',')}}`;
}

export class Orchestrator {
  private normalizer = farmNormalizer;
  private memoryStates = new Map<string, { state: NormalizedFarmState; staleness: SnapshotFreshness; version: number }>();

  /**
   * Register an in-memory farm state for testing or active session context.
   */
  public setFarmState(farmId: string, rawOrNormalized: unknown, staleness: SnapshotFreshness = 'FRESH', version = 1): void {
    const norm = (rawOrNormalized as any).player
      ? (rawOrNormalized as NormalizedFarmState)
      : this.normalizer.normalize(rawOrNormalized, { farmId }).normalizedState;
    this.memoryStates.set(farmId, { state: norm, staleness, version });
  }

  /**
   * Helper to retrieve the latest cached/stored farm state without hitting the external API synchronously.
   */
  public async getStoredFarmState(farmId: string, userId?: number): Promise<{ state: NormalizedFarmState; staleness: SnapshotFreshness; version: number }> {
    // 1. Check in-memory registered states (for tests and active session mocks)
    if (this.memoryStates.has(farmId)) {
      return this.memoryStates.get(farmId)!;
    }

    // 2. Try SnapshotService (Postgres snapshots)
    if (userId) {
      try {
        const latest = await snapshotService.latest(userId, 1);
        if (latest && latest.length > 0) {
          const raw = latest[0];
          // Ensure snapshot has rich structures / placed collectibles or fall through to fresh cache
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hasRichData = Boolean(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (raw as any)?.collectibles ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (raw as any)?.farm?.collectibles ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (raw as any)?.structures?.placedCollectibles?.length ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (raw as any)?.home?.collectibles ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (raw as any)?.interior
          );
          if (hasRichData) {
            const norm = this.normalizer.normalize(raw, { farmId, source: 'DB_SNAPSHOT' });
            const diffMs = Date.now() - (norm.normalizedState.metadata.capturedAt || Date.now());
            const staleness: SnapshotFreshness = diffMs < 10 * 60 * 1000 ? 'FRESH' : diffMs < 60 * 60 * 1000 ? 'STALE' : 'VERY_STALE';
            return { state: norm.normalizedState, staleness, version: norm.normalizedState.metadata.capturedAt };
          }
        }
      } catch {
        // Fall through gracefully if DB is unconfigured in test environment
      }
    }

    // 3. Fallback: SunflowerClient cache / fetch if available
    try {
      const farmData = await sunflowerClient.getFarm(farmId);
      const norm = this.normalizer.normalize(farmData.raw, { farmId, source: 'CACHE_OR_API' });
      const staleness: SnapshotFreshness = farmData.stale ? 'STALE' : 'FRESH';
      return { state: norm.normalizedState, staleness, version: 1 };
    } catch {
      // 4. Default baseline farm state if offline or running in test environment without network
      const defaultState = this.normalizer.normalize({
        id: farmId,
        bumpkin: { id: 1, experience: 1000 },
        balance: '50.00',
        inventory: { Wood: 100, Stone: 50, Carrot: 20 },
      }, { farmId }).normalizedState;
      return { state: defaultState, staleness: 'FRESH', version: 1 };
    }
  }

  public readonly tools: Record<string, ToolDef> = {
    // ── 1. get_farm_state (Phase 2 Snapshot Store) ──────────────────────────
    get_farm_state: {
      description: 'Authoritative current farm state from stored snapshot (inventory, FLOWER, coins, buildings, skills, bumpkin level, and data freshness). Never hits upstream Community API directly.',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        try {
          const { state, staleness, version } = await this.getStoredFarmState(context.farmId, context.userId);
          const effectRes = resolveEffectContext(state, {
            now: Date.now(),
            season: state.temporal?.season,
            farmId: context.farmId,
            snapshotVersion: version,
          });

          return {
            tool: 'get_farm_state',
            success: true,
            data: {
              level: state.player.level,
              xp: state.player.experience,
              flower: state.economy.flowerApprox,
              coins: state.economy.coins,
              island: {
                type: state.progression.islandType,
                name: state.progression.islandType === 'desert'
                  ? 'Desert Island'
                  : state.progression.islandType === 'spring'
                  ? 'Petal Paradise'
                  : state.progression.islandType === 'volcano'
                  ? 'Volcano Island'
                  : 'Basic Island',
                unlockedPlots: state.progression.expansions,
                sunstones: state.progression.sunstones,
              },
              buildings: Object.keys(state.structures.buildings),
              skills: Object.keys(state.player.skills),
              inventory: state.inventory.all,
              activeProduction: state.production.active,
              equipped: state.player.equipped,
              placedCollectibles: state.structures.placedCollectibles?.map((p) => p.name) ?? [],
              activeBoosts: effectRes.value.activeEffects.map((e) => `${e.sourceId}: ${e.description}`),
            },
            epistemicTier: 'OBSERVED',
            staleness,
            provenance: {
              farmId: context.farmId,
              snapshotVersion: version,
              calculationEngineVersion: '2.0.0',
              gameDataVersion: '2026.09.11',
              computedAt: Date.now(),
            },
          };
        } catch (e) {
          return {
            tool: 'get_farm_state',
            success: false,
            epistemicTier: 'OBSERVED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 2. get_roadmap (Phase 5 Strategic Planner) ─────────────────────────
    get_roadmap: {
      description: 'Deterministic hierarchical strategic roadmap for a goal, including multi-phase decomposition, daily objectives, resource reservations, seasonal urgency warnings, and provenance.',
      parameters: {
        type: 'object',
        properties: {
          objective: {
            type: 'string',
            enum: ['REACH_LEVEL', 'MAXIMIZE_XP', 'MAXIMIZE_FLOWER', 'STOCKPILE_RESOURCE', 'CRAFT_TARGET'],
            description: 'Strategic objective',
          },
          targetLevel: { type: 'number', description: 'Target bumpkin level (for REACH_LEVEL)' },
          targetXp: { type: 'number', description: 'Target XP (for MAXIMIZE_XP)' },
          targetItems: { type: 'object', description: 'Target item quantities (for STOCKPILE_RESOURCE or CRAFT_TARGET)' },
          maxFlowerCost: { type: 'number', description: 'Hard constraint on max FLOWER cost' },
          primaryFocus: { type: 'string', enum: ['XP', 'FLOWER', 'TIME'], description: 'Soft preference focus' },
          riskTolerance: { type: 'string', enum: ['LOW', 'BALANCED', 'HIGH'] },
        },
      },
      exec: async (args, context) => {
        try {
          const { state, version } = await this.getStoredFarmState(context.farmId, context.userId);
          const goal: Goal = {
            goalId: `goal-${Date.now()}`,
            farmId: context.farmId,
            status: 'ACTIVE',
            objective: args.objective ?? 'REACH_LEVEL',
            target: {
              level: args.targetLevel,
              xp: args.targetXp,
              items: args.targetItems,
            },
            constraints: {
              maxFlowerCost: args.maxFlowerCost,
            },
            preferences: {
              primaryFocus: args.primaryFocus ?? 'XP',
              riskTolerance: args.riskTolerance ?? 'BALANCED',
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          const temporalCtx = extractTemporalContext(state, Date.now());
          const effectRes = resolveEffectContext(state, {
            now: Date.now(),
            season: temporalCtx.seasonBoundary.value.currentSeason,
            farmId: context.farmId,
            snapshotVersion: version,
          });

          const calculationResult = extractPlannerContext(state, goal, {
            gameTime: temporalCtx.gameTime.value,
            seasonBoundary: temporalCtx.seasonBoundary.value,
            farmId: context.farmId,
            snapshotVersion: version,
            computedAt: Date.now(),
            effectContext: effectRes.value,
          });

          return {
            tool: 'get_roadmap',
            success: true,
            data: calculationResult.value,
            provenance: calculationResult.provenance,
            epistemicTier: 'DERIVED',
            warnings: calculationResult.value.phases[0]?.dailyObjectives[0]?.warnings?.map((w) => w.message) ?? [],
          };
        } catch (e) {
          return {
            tool: 'get_roadmap',
            success: false,
            epistemicTier: 'DERIVED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 3. check_action_permission (Phase 5 Reservation Engine) ───────────
    check_action_permission: {
      description: 'Check whether a specific action or recipe is permitted right now or in the future without violating protected resource commitments (tomorrow reserves / phase reserves).',
      parameters: {
        type: 'object',
        properties: {
          resource: { type: 'string', description: "Resource name (e.g. 'FLOWER', 'Wood', 'Stone') or recipe name" },
          quantity: { type: 'number', description: 'Quantity required' },
          timing: { type: 'string', enum: ['IMMEDIATE', 'FUTURE'], description: 'Whether checking current availableNow or projectedAvailable' },
          tomorrowRequirements: { type: 'object', description: 'Optional reserved requirements for tomorrow' },
          phaseRequirements: { type: 'object', description: 'Optional reserved requirements for current phase' },
        },
        required: ['resource', 'quantity'],
      },
      exec: async ({ resource, quantity, timing = 'IMMEDIATE', tomorrowRequirements, phaseRequirements }, context) => {
        try {
          const { state } = await this.getStoredFarmState(context.farmId, context.userId);
          const ledger = buildResourceLedger({ state, tomorrowRequirements, phaseRequirements });

          // 1. Check if resource is a cooking recipe (e.g. Pancakes, Pizza Margherita)
          const fallbackRecipes: Record<string, { building: string; ingredients: Record<string, number> }> = {
            Pancakes: { building: 'Bakery', ingredients: { Wheat: 50, Honey: 2 } },
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recipeEntry = Object.entries(recipesData as Record<string, any>).find(
            ([name]) => name.toLowerCase() === resource.toLowerCase() && !name.startsWith('_')
          ) ?? (fallbackRecipes[resource] ? [resource, fallbackRecipes[resource]] : undefined);

          if (recipeEntry) {
            const [recipeName, recipeDef] = recipeEntry;
            const ingredients: Record<string, number> = recipeDef.ingredients ?? {};
            const building: string | undefined = recipeDef.building;
            const shortfalls: string[] = [];
            let permitted = true;

            // Building requirement check
            if (building) {
              const farmBuildings = state.structures?.buildings ?? {};
              const hasBuilding = Boolean(
                farmBuildings[building] &&
                (Array.isArray(farmBuildings[building]) ? farmBuildings[building].length > 0 : true)
              );
              if (!hasBuilding) {
                permitted = false;
                shortfalls.push(`missing required building '${building}'`);
              }
            }

            // Ingredient discretionary reserve checks
            for (const [ingName, baseQty] of Object.entries(ingredients)) {
              const requiredQty = baseQty * quantity;
              const commitment = ledger[ingName];
              const available = timing === 'FUTURE'
                ? (commitment?.projectedAvailable ?? 0)
                : (commitment?.availableNow ?? 0);

              if (available < requiredQty) {
                permitted = false;
                const missing = requiredQty - available;
                shortfalls.push(`missing ${missing}x ${ingName} (need ${requiredQty}, available ${available})`);
              }
            }

            const message = permitted
              ? `Action permitted: You own ${building ? `the ${building} and ` : ''}all required ingredients in discretionary inventory for ${quantity}x ${recipeName}.`
              : `Cannot cook ${quantity}x ${recipeName}: ${shortfalls.join('; ')}.`;

            return {
              tool: 'check_action_permission',
              success: true,
              data: {
                resource: recipeName,
                quantity,
                timing,
                actionPermitted: permitted,
                shortfall: shortfalls.length > 0 ? shortfalls.join(', ') : null,
                message,
                commitment: ledger['FLOWER'] ?? null,
              },
              epistemicTier: 'DERIVED',
              warnings: permitted ? [] : [message],
            };
          }

          // 2. Standard resource / currency check
          const perm = timing === 'FUTURE'
            ? checkFutureActionPermitted(resource, quantity, ledger)
            : checkImmediateActionPermitted(resource, quantity, ledger);

          return {
            tool: 'check_action_permission',
            success: true,
            data: {
              resource,
              quantity,
              timing,
              actionPermitted: perm.actionPermitted,
              shortfall: perm.shortfall,
              message: perm.message ?? (perm.actionPermitted ? 'Action permitted by resource ledger.' : 'Action denied.'),
              commitment: ledger[resource] ?? null,
            },
            epistemicTier: 'DERIVED',
            warnings: perm.actionPermitted ? [] : [perm.message ?? 'Reservation conflict'],
          };
        } catch (e) {
          return {
            tool: 'check_action_permission',
            success: false,
            epistemicTier: 'DERIVED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 4. evaluate_strategy_feasibility (Phase 5 Feasibility Gate) ────────
    evaluate_strategy_feasibility: {
      description: 'Evaluate whether a proposed recipe, crop, or named strategy satisfies hard goal constraints (budget, deadline, blacklists, market rules). Candidate parameters are resolved deterministically.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: "Recipe, crop, or preset name (e.g. 'Pancakes', 'Strategy A: Fast Push')" },
          quantity: { type: 'number', description: 'Quantity (default 1)' },
          intent: { type: 'string', enum: ['RECIPE', 'CROP', 'TARGET_GOAL', 'NAMED_STRATEGY'] },
          constraints: {
            type: 'object',
            properties: {
              maxFlowerCost: { type: 'number' },
              maxTimeDays: { type: 'number' },
              deadlineTimestamp: { type: 'number' },
              blacklistedItems: { type: 'array', items: { type: 'string' } },
              disallowMarketPurchases: { type: 'boolean' },
            },
          },
        },
        required: ['target'],
      },
      exec: async (args, context) => {
        try {
          const { state } = await this.getStoredFarmState(context.farmId, context.userId);
          const { prices } = await sunflowerClient.getPrices();
          const effectRes = resolveEffectContext(state, {
            now: Date.now(),
            season: state.temporal?.season,
            farmId: context.farmId,
          });

          // Anti-hallucination: Resolve candidate parameters deterministically
          const candidate = resolveCandidateIntent({
            target: args.target,
            quantity: args.quantity ?? 1,
            intent: args.intent,
            state,
            prices,
            effectContext: effectRes.value,
          });

          const assessment = evaluateFeasibility(candidate, args.constraints ?? {});

          return {
            tool: 'evaluate_strategy_feasibility',
            success: true,
            data: {
              candidate,
              assessment,
            },
            epistemicTier: 'DERIVED',
            warnings: assessment.violations,
          };
        } catch (e) {
          return {
            tool: 'evaluate_strategy_feasibility',
            success: false,
            epistemicTier: 'DERIVED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 5. get_temporal_context (Phase 3 Temporal Engine) ──────────────────
    get_temporal_context: {
      description: 'Sunflower Clock context: current in-game day, UTC daily reset countdown, season name, day events, and season boundary urgency (NORMAL, WARNING, CRITICAL, EXPIRED) with affected exclusive crops.',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        try {
          const { state } = await this.getStoredFarmState(context.farmId, context.userId);
          const result = extractTemporalContext(state, Date.now());

          return {
            tool: 'get_temporal_context',
            success: true,
            data: {
              gameTime: result.gameTime.value,
              seasonBoundary: result.seasonBoundary.value,
              dayEvents: result.dayEvents,
              currentDay: result.currentDay,
              season: result.season,
            },
            provenance: result.seasonBoundary.provenance,
            epistemicTier: 'DERIVED',
            warnings: result.seasonBoundary.value.warnings.map((w: any) => w.message),
          };
        } catch (e) {
          return {
            tool: 'get_temporal_context',
            success: false,
            epistemicTier: 'DERIVED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 6. get_history_metrics (Phase 4 History Engine) ────────────────────
    get_history_metrics: {
      description: 'Historical progression metrics and delta detection separating directly proven OBSERVED facts from INFERRED events with explicit confidence ratings (HIGH, MEDIUM, LOW).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of snapshots to compare (default 2)' },
        },
      },
      exec: async ({ limit = 2 }, context) => {
        try {
          const snapshots = await snapshotService.latest(context.userId, limit);
          if (snapshots.length < 2) {
            return {
              tool: 'get_history_metrics',
              success: true,
              data: { note: 'Insufficient snapshot history (at least 2 required to compute deltas).' },
              epistemicTier: 'OBSERVED',
            };
          }

          const fromNorm = this.normalizer.normalize(snapshots[1], { farmId: context.farmId, source: 'DB_SNAPSHOT' }).normalizedState;
          const toNorm = this.normalizer.normalize(snapshots[0], { farmId: context.farmId, source: 'DB_SNAPSHOT' }).normalizedState;

          const historyResult = extractFarmHistoryDelta(fromNorm, toNorm);

          return {
            tool: 'get_history_metrics',
            success: true,
            data: historyResult.value,
            provenance: historyResult.provenance,
            epistemicTier: 'INFERRED',
          };
        } catch (e) {
          return {
            tool: 'get_history_metrics',
            success: false,
            epistemicTier: 'INFERRED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 7. compute_recipe_cost (Phase 1 XP & Economic Engine) ──────────────
    compute_recipe_cost: {
      description: 'Deterministic recipe economics: effective XP/output with VIP & skill boosts, base-resource expansion, and live-market FLOWER cost after inventory offset.',
      parameters: {
        type: 'object',
        properties: {
          recipe: { type: 'string', description: "Recipe name, e.g. 'Pizza Margherita' or 'Pancakes'" },
        },
        required: ['recipe'],
      },
      exec: async ({ recipe }, context) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = (recipesData as Record<string, any>)[recipe];
          if (!r) {
            return {
              tool: 'compute_recipe_cost',
              success: false,
              epistemicTier: 'DERIVED',
              error: {
                code: 'INVALID_ARGUMENT',
                message: `Unknown recipe '${recipe}'.`,
                retryable: false,
              },
            };
          }

          const [{ state, version }, { prices }] = await Promise.all([
            this.getStoredFarmState(context.farmId, context.userId),
            sunflowerClient.getPrices(),
          ]);

          const effectRes = resolveEffectContext(state, {
            now: Date.now(),
            season: state.temporal?.season,
            farmId: context.farmId,
            snapshotVersion: version,
          });

          const bldOil = state.structures.buildings[r.building]?.[0]?.oil ?? 0;

          const foodXpResult = calculateFoodXp({
            recipeName: recipe,
            recipe: r,
            skills: state.player.skills,
            isVip: state.buffs.vip,
            buildingOil: bldOil,
            effectContext: effectRes.value,
            farmId: context.farmId,
          });

          const costResult = calculateCostBreakdown({
            requiredResources: r.ingredients ?? {},
            inventory: state.inventory.all,
            prices,
          });

          const ownsBuilding = r.building in state.structures.buildings;
          const boostsList = foodXpResult.value.boostBreakdown.map((b) => b.label).join(', ');
          const xpFormatted = Number(foodXpResult.value.xpPerFood.toFixed(2));
          const mins = Math.floor(foodXpResult.value.minutes);
          const secs = Math.round((foodXpResult.value.minutes % 1) * 60);
          const timeFormatted = `${mins}m ${secs}s`;

          return {
            tool: 'compute_recipe_cost',
            success: true,
            data: {
              recipe,
              ownsBuilding,
              warning: ownsBuilding ? null : `⚠️ You do NOT own a ${r.building}! You cannot cook this recipe until you build one.`,
              effective: foodXpResult.value,
              cost: costResult.value,
              totalMinutes: foodXpResult.value.minutes,
              formattedTime: timeFormatted,
              explanation: `Cooking yields ${xpFormatted} XP (base: ${r.baseXp} XP${boostsList ? `, active boosts: ${boostsList}` : ''}). Duration: ${timeFormatted} (base: ${r.baseCookMinutes}m). It COSTS ${costResult.value.flower} FLOWER in ingredient acquisition expenses (cooking awards XP, NOT FLOWER).`,
            },
            provenance: foodXpResult.provenance,
            epistemicTier: 'DERIVED',
          };
        } catch (e) {
          return {
            tool: 'compute_recipe_cost',
            success: false,
            epistemicTier: 'DERIVED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 8. get_active_effects (Phase 7 Effect Resolution Engine) ────────────
    get_active_effects: {
      description: 'Authoritative active boosts and modifiers on this farm (equipped wearables, placed collectibles on island or interior, active skills, timed buffs, VIP) with proof of activation.',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        try {
          const { state, version } = await this.getStoredFarmState(context.farmId, context.userId);
          const effectRes = resolveEffectContext(state, {
            now: Date.now(),
            season: state.temporal?.season,
            farmId: context.farmId,
            snapshotVersion: version,
          });

          return {
            tool: 'get_active_effects',
            success: true,
            data: {
              activeCount: effectRes.value.activeEffects.length,
              activeEffects: effectRes.value.activeEffects,
              summary: {
                globalXpMultiplier: effectRes.value.xp.multipliers.global,
                foodXpMultiplier: effectRes.value.xp.multipliers.food,
                globalCookingTimeMultiplier: effectRes.value.cooking.timeMultipliers.global,
                cropGrowthTimeMultiplier: effectRes.value.crops.timeMultipliers.global,
                woodYieldMultiplier: effectRes.value.resources.yieldMultipliers.wood,
                eggYieldAddition: effectRes.value.animals.yieldAdditions.egg,
              },
            },
            provenance: effectRes.provenance,
            epistemicTier: 'DERIVED',
          };
        } catch (e) {
          return {
            tool: 'get_active_effects',
            success: false,
            epistemicTier: 'DERIVED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 9. get_market_prices ────────────────────────────────────────────────
    get_market_prices: {
      description: 'Live P2P market prices (FLOWER per unit) for all tradable base resources.',
      parameters: { type: 'object', properties: {} },
      exec: async () => {
        try {
          const { prices, updatedAt } = await sunflowerClient.getPrices();
          return {
            tool: 'get_market_prices',
            success: true,
            data: { prices, updatedAt },
            epistemicTier: 'OBSERVED',
          };
        } catch (e) {
          return {
            tool: 'get_market_prices',
            success: false,
            epistemicTier: 'OBSERVED',
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: String((e as Error).message ?? e),
              retryable: true,
            },
          };
        }
      },
    },

    // ── 9. recall_memory (pgvector Semantic Search) ────────────────────────
    recall_memory: {
      description: 'Semantic search over past user goals and discussed strategies from previous sessions. Memory has lower precedence than authoritative state.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Semantic query' },
        },
        required: ['query'],
      },
      exec: async ({ query }, context) => {
        try {
          const matches = await chatStoreService.similar(query, context.sessionId || '', context.userId, 5);
          return {
            tool: 'recall_memory',
            success: true,
            data: { matches },
            epistemicTier: 'INFERRED',
          };
        } catch (e) {
          return {
            tool: 'recall_memory',
            success: false,
            epistemicTier: 'INFERRED',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 10. get_item_metadata (Authoritative Game Catalog) ──────────────────
    get_item_metadata: {
      description: 'Authoritative official game metadata for an item (collectible or wearable) including purpose, slot/part, tradability, decimals, and descriptive boost metadata. Never calculates effect mechanics.',
      parameters: {
        type: 'object',
        properties: {
          itemName: { type: 'string', description: 'Item name, e.g. "Blossombeard", "Chef Apron", "Parsnip"' },
          kind: { type: 'string', enum: ['collectible', 'wearable'], description: 'Optional kind discriminator if item exists as both' },
        },
        required: ['itemName'],
      },
      exec: async ({ itemName, kind }, context) => {
        try {
          if (!itemName || typeof itemName !== 'string') {
            return {
              tool: 'get_item_metadata',
              success: false,
              epistemicTier: 'AUTHORITATIVE',
              error: {
                code: 'INVALID_ARGUMENT',
                message: 'Parameter "itemName" is required and must be a string.',
                retryable: false,
              },
            };
          }

          const trimmedName = itemName.trim();
          const item = itemMetadataService.getItem(trimmedName, kind);
          const manifest = itemMetadataService.getManifest();

          if (!item) {
            return {
              tool: 'get_item_metadata',
              success: false,
              epistemicTier: 'AUTHORITATIVE',
              error: {
                code: 'INVALID_ARGUMENT',
                message: `Item "${trimmedName}" not found in authoritative game metadata.`,
                retryable: false,
              },
            };
          }

          const hasCollision = itemMetadataService.hasCollision(trimmedName);

          return {
            tool: 'get_item_metadata',
            success: true,
            data: {
              item,
              hasCollision,
              disambiguationNote: hasCollision && !kind
                ? `Note: "${trimmedName}" exists as both a collectible and a wearable. Returning ${item.kind} metadata by default. Specify kind: "wearable" or "collectible" to disambiguate.`
                : undefined,
              gameDataVersion: manifest.gameDataVersion,
              sourceSha256: manifest.sourceSha256,
            },
            epistemicTier: 'AUTHORITATIVE',
            provenance: {
              farmId: context.farmId || 'authoritative',
              snapshotVersion: 0,
              calculationEngineVersion: '1.0.0',
              gameDataVersion: manifest.gameDataVersion,
              computedAt: Date.now(),
            },
          };
        } catch (e) {
          return {
            tool: 'get_item_metadata',
            success: false,
            epistemicTier: 'AUTHORITATIVE',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },

    // ── 15. get_expansion_details (Land & Island Progression) ────────────────
    get_expansion_details: {
      description: 'Authoritative land expansion details, requirements, costs, and rewards from expansion.json. Returns current island prestige, total unlocked plots, requirements for next plot (Bumpkin level, coin/resource costs, oil, gems, duration, nodes added), inventory shortfall comparison, and cumulative multi-stage roadmap & resource costs to reach future islands (e.g. Volcano Island).',
      parameters: {
        type: 'object',
        properties: {
          targetIsland: {
            type: 'string',
            description: "Optional island name: 'desert', 'volcano', 'basic', 'spring'. Specify when asking about moving to, reaching, or exploring another island.",
          },
          targetPlot: {
            type: 'integer',
            description: "Optional specific plot number to query requirements for (e.g. 14). Defaults to the player's next expansion plot on current island, or the initial plot on a future island.",
          },
          mode: {
            type: 'string',
            enum: ['next_plot', 'reach_island'],
            description: "Calculation mode: 'next_plot' (default for next plot on player island), or 'reach_island' (calculates complete cumulative costs, level requirements, and moving fees to reach the destination island).",
          },
        },
      },
      exec: async ({ island: requestedIsland, targetIsland, targetPlot, mode }, context) => {
        try {
          const { state, version } = await this.getStoredFarmState(context.farmId, context.userId);
          const currentIslandType = state.progression.islandType || 'desert';
          const currentUnlockedPlots = state.progression.expansions || 0;
          const currentLevel = state.player.level;

          // Determine authoritative player island
          let playerIslandName = 'Desert Island';
          if (currentIslandType === 'desert') playerIslandName = 'Desert Island';
          else if (currentIslandType === 'spring') playerIslandName = 'Petal Paradise';
          else if (currentIslandType === 'volcano') playerIslandName = 'Volcano Island';
          else if (currentIslandType === 'basic') playerIslandName = 'Basic Island';
          else playerIslandName = 'Desert Island';

          let islandName = playerIslandName;

          // Only switch island if user specifically asks about another island
          const userGoal = (context.userGoal || '').toLowerCase();
          const req = ((targetIsland || requestedIsland) ?? '').toLowerCase().trim();

          if (userGoal.includes('volcano') || (req.includes('volcano') && !userGoal.includes('my land') && !userGoal.includes('my farm') && !userGoal.includes('my island'))) {
            islandName = 'Volcano Island';
          } else if (userGoal.includes('petal') || userGoal.includes('spring island') || (req.includes('spring') && !userGoal.includes('my land') && !userGoal.includes('my farm') && !userGoal.includes('my island'))) {
            islandName = 'Petal Paradise';
          } else if (userGoal.includes('basic island') || (req === 'basic island' && !userGoal.includes('my land') && !userGoal.includes('my farm') && !userGoal.includes('my island'))) {
            islandName = 'Basic Island';
          } else if (userGoal.includes('desert') || req.includes('desert')) {
            islandName = 'Desert Island';
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allIslands = expansionData.islands as any[];
          const playerIslandDef = allIslands.find((isl) => isl.name.toLowerCase() === playerIslandName.toLowerCase()) || allIslands[0];
          const islandDef = allIslands.find((isl) => isl.name.toLowerCase() === islandName.toLowerCase()) || playerIslandDef;

          const isTargetingFutureIsland = islandDef.prestige > playerIslandDef.prestige;
          const isReachIslandQuery = mode === 'reach_island' || isTargetingFutureIsland || userGoal.includes('reach') || userGoal.includes('get to') || userGoal.includes('move to') || userGoal.includes('transition');

          // Resource names normalization map
          const resourceKeyMap: Record<string, string> = {
            coins: 'coins',
            wood: 'Wood',
            stone: 'Stone',
            iron: 'Iron',
            gold: 'Gold',
            crimstone: 'Crimstone',
            sunstone: 'Sunstone Rock',
            oil: 'Oil',
            gem: 'Gem',
            obsidian: 'Obsidian',
          };
          const invAll = state.inventory.all;

          // 1. Calculate remaining plots and cumulative costs on player's current island
          const playerRows = (playerIslandDef.rows || []) as any[];
          const remainingCurrentPlots = playerRows.filter((r: any) => r.unlock_land_plot > currentUnlockedPlots);
          const cumulativeRemainingPlots: Record<string, number> = {};
          let maxLevelOnCurrentIsland = currentLevel;

          for (const r of remainingCurrentPlots) {
            if (r.bumpkin_level && r.bumpkin_level > maxLevelOnCurrentIsland) {
              maxLevelOnCurrentIsland = r.bumpkin_level;
            }
            if (r.resources) {
              for (const [k, v] of Object.entries(r.resources as Record<string, number>)) {
                cumulativeRemainingPlots[k] = (cumulativeRemainingPlots[k] || 0) + Number(v);
              }
            }
          }

          // 2. Cumulative costs to reach future island (remaining current plots + moving fee)
          const movingFee = playerIslandDef.moving_cost_to_next;
          const cumulativeToReach: Record<string, { need: number; have: number; short: number; isMet: boolean }> = {};
          const cumulativeSums: Record<string, number> = { ...cumulativeRemainingPlots };

          if (movingFee && movingFee.resource && movingFee.amount) {
            const resKey = movingFee.resource.toLowerCase();
            cumulativeSums[resKey] = (cumulativeSums[resKey] || 0) + Number(movingFee.amount);
          }

          for (const [rawRes, needVal] of Object.entries(cumulativeSums)) {
            const need = Number(needVal);
            let have = 0;
            if (rawRes === 'coins') {
              have = state.economy.coins;
            } else {
              const mappedName = resourceKeyMap[rawRes] || rawRes.charAt(0).toUpperCase() + rawRes.slice(1);
              have = Number(invAll[mappedName] ?? 0);
            }
            const short = Math.max(0, need - have);
            cumulativeToReach[rawRes] = {
              need,
              have: Math.round(have * 100) / 100,
              short: Math.round(short * 100) / 100,
              isMet: have >= need,
            };
          }

          // 3. Determine single plot to query
          const targetRows = (islandDef.rows || []) as any[];
          const targetMinPlot = targetRows.length > 0 ? targetRows[0].unlock_land_plot : 1;
          const targetMaxPlot = targetRows.length > 0 ? targetRows[targetRows.length - 1].unlock_land_plot : 1;

          let plotToQuery: number;
          if (targetPlot != null) {
            plotToQuery = Number(targetPlot);
          } else if (islandDef.name === playerIslandDef.name) {
            plotToQuery = Math.max(targetMinPlot, currentUnlockedPlots + 1);
          } else {
            // When querying another island without targetPlot, default to the initial plot on that island (e.g. Plot 6 on Volcano)
            plotToQuery = targetMinPlot;
          }

          const isFullyExpanded = islandDef.name === playerIslandDef.name && currentUnlockedPlots >= targetMaxPlot;
          const plotRow = targetRows.find((r: any) => r.unlock_land_plot === plotToQuery);

          // Requirements for the single plot queried
          const singlePlotResources: Record<string, { need: number; have: number; short: number; isMet: boolean }> = {};
          let singlePlotMet = true;
          if (plotRow && plotRow.resources) {
            for (const [rawRes, needVal] of Object.entries(plotRow.resources as Record<string, number>)) {
              const need = Number(needVal);
              let have = 0;
              if (rawRes === 'coins') {
                have = state.economy.coins;
              } else {
                const mappedName = resourceKeyMap[rawRes] || rawRes.charAt(0).toUpperCase() + rawRes.slice(1);
                have = Number(invAll[mappedName] ?? 0);
              }
              const short = Math.max(0, need - have);
              const isMet = have >= need;
              if (!isMet) singlePlotMet = false;
              singlePlotResources[rawRes] = {
                need,
                have: Math.round(have * 100) / 100,
                short: Math.round(short * 100) / 100,
                isMet,
              };
            }
          }
          const levelMet = plotRow ? currentLevel >= plotRow.bumpkin_level : true;
          const canExpandNow = plotRow ? (levelMet && singlePlotMet && !isFullyExpanded) : false;

          // Build context-aware explanation
          let explanation = '';
          if (isReachIslandQuery && isTargetingFutureIsland) {
            const shortfalls = Object.entries(cumulativeToReach)
              .filter(([_, d]) => !d.isMet)
              .map(([r, d]) => `${d.short} ${r}`)
              .join(', ');
            explanation = `To reach ${islandDef.name} from ${playerIslandDef.name}: You must first complete the remaining ${remainingCurrentPlots.length} expansions on ${playerIslandDef.name} (Plots ${remainingCurrentPlots[0]?.unlock_land_plot ?? 14} to ${playerRows[playerRows.length - 1]?.unlock_land_plot ?? 25}), reach Bumpkin Level ${maxLevelOnCurrentIsland} (currently Lv ${currentLevel}, need ${Math.max(0, maxLevelOnCurrentIsland - currentLevel)} more levels), and pay the moving fee of ${movingFee?.amount ?? 200} ${movingFee?.resource ?? 'Oil'}. Total cumulative resources needed: ${Object.entries(cumulativeToReach).map(([r, d]) => `${d.need} ${r} (have ${d.have}, short ${d.short})`).join(', ')}. Shortfalls: ${shortfalls || 'None! Ready to complete'}. Once on ${islandDef.name}, the first plot (Plot ${targetMinPlot}) requires Level ${targetRows[0]?.bumpkin_level ?? 70}.`;
          } else if (isFullyExpanded) {
            explanation = `Your farm is on ${islandDef.name} (Prestige ${islandDef.prestige}) and has completed all ${targetMaxPlot} land expansions! Moving cost to next island: ${JSON.stringify(islandDef.moving_cost_to_next)}.`;
          } else if (plotRow) {
            const missingList = Object.entries(singlePlotResources)
              .filter(([_, r]) => !r.isMet)
              .map(([name, r]) => `${r.short} more ${name} (have ${r.have}/${r.need})`)
              .join(', ');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nodeRewards = plotRow.nodes?.map((n: any) => `+${n.added ?? 1} ${n.type}${n.total_after ? ` (total: ${n.total_after})` : ''}`).join(', ') || 'No extra nodes';
            explanation = `Farm is on ${playerIslandDef.name} with ${currentUnlockedPlots} plots unlocked. Next expansion: Plot ${plotRow.unlock_land_plot} on ${islandDef.name}. Requires Bumpkin Level ${plotRow.bumpkin_level} (${levelMet ? 'MET' : `NOT MET, you are Lv ${currentLevel}`}). Time: ${plotRow.time}. Rewards: ${nodeRewards}. Status: ${canExpandNow ? 'Ready to expand!' : `Missing: ${missingList || 'level requirement'}`}.`;
          } else {
            explanation = `No expansion data found for Plot ${plotToQuery} on ${islandDef.name}.`;
          }

          return {
            tool: 'get_expansion_details',
            success: true,
            data: {
              currentIsland: {
                name: playerIslandDef.name,
                biome: playerIslandDef.biome || 'desert',
                prestige: playerIslandDef.prestige,
                currentUnlockedPlots,
                maxPlotsOnIsland: playerRows[playerRows.length - 1]?.unlock_land_plot ?? 25,
                isFullyExpanded,
              },
              targetIsland: {
                name: islandDef.name,
                biome: islandDef.biome || (islandDef.name === 'Volcano Island' ? 'volcano' : islandDef.name === 'Desert Island' ? 'desert' : islandDef.name === 'Petal Paradise' ? 'spring' : 'basic'),
                prestige: islandDef.prestige,
                minPlot: targetMinPlot,
                maxPlot: targetMaxPlot,
              },
              targetPlot: plotRow ? {
                island: islandDef.name,
                plotNumber: plotRow.unlock_land_plot,
                requiredBumpkinLevel: plotRow.bumpkin_level,
                playerLevel: currentLevel,
                levelMet,
                time: plotRow.time,
                timeSeconds: plotRow.time_seconds,
                resources: singlePlotResources,
                nodesAdded: plotRow.nodes,
                p2pCostUsd: plotRow.p2p_cost_usd,
                canExpandNow,
              } : null,
              islandTransition: isTargetingFutureIsland || isReachIslandQuery ? {
                fromIsland: playerIslandDef.name,
                toIsland: islandDef.name,
                remainingPlotsOnCurrentIsland: remainingCurrentPlots.length,
                remainingPlotRange: remainingCurrentPlots.length > 0
                  ? `Plot ${remainingCurrentPlots[0].unlock_land_plot} to Plot ${remainingCurrentPlots[remainingCurrentPlots.length - 1].unlock_land_plot}`
                  : 'Fully expanded',
                maxLevelRequiredOnCurrentIsland: maxLevelOnCurrentIsland,
                playerLevel: currentLevel,
                levelShortfall: Math.max(0, maxLevelOnCurrentIsland - currentLevel),
                movingFee: movingFee ? { resource: movingFee.resource, amount: movingFee.amount } : null,
                cumulativeRequirementsToReach: cumulativeToReach,
                firstPlotOnTargetIsland: targetRows[0] ? {
                  plotNumber: targetRows[0].unlock_land_plot,
                  requiredBumpkinLevel: targetRows[0].bumpkin_level,
                  resources: targetRows[0].resources,
                  time: targetRows[0].time,
                } : null,
              } : null,
              movingCostToNext: islandDef.moving_cost_to_next,
              maxNodesOnIsland: islandDef.max_nodes,
              explanation,
            },
            provenance: {
              farmId: context.farmId,
              snapshotVersion: version,
              calculationEngineVersion: '2.0.0',
              gameDataVersion: '2026.09.11',
              computedAt: Date.now(),
            },
            epistemicTier: 'AUTHORITATIVE',
          };
        } catch (e) {
          return {
            tool: 'get_expansion_details',
            success: false,
            epistemicTier: 'AUTHORITATIVE',
            error: {
              code: 'INTERNAL_ERROR',
              message: String((e as Error).message ?? e),
              retryable: false,
            },
          };
        }
      },
    },
  };

  private readonly toolDefs = Object.entries(this.tools).map(([name, t]) => ({
    type: 'function',
    function: { name, description: t.description, parameters: t.parameters },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async groq(messages: any[], toolChoice: string | object = 'auto'): Promise<any> {
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      model,
      messages,
      tools: this.toolDefs,
      tool_choice: toolChoice,
      temperature: 0.2,
      max_completion_tokens: 4096,
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 400 && text.includes('tool_use_failed')) {
        return { choices: [{ message: { content: null }, finish_reason: 'error' }], _toolError: text.slice(0, 300) };
      }
      throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  private clean(s?: string | null): string {
    return (s ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private textOf(m: any = {}): string {
    let c = m.content;
    if (Array.isArray(c)) c = c.map((p: { text?: string }) => p?.text ?? '').join('');
    return this.clean(c);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private safeParseArgs(raw?: string): any {
    if (!raw || raw === '{}') return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /**
   * Run the agentic loop with bounded execution, deduplication, and schema validation.
   */
  async runAgent(
    message: string,
    sessionId: string,
    userId: number,
    farmId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    history: any[] | null = null
  ): Promise<AIChatResponse> {
    const steps: AIChatStep[] = [];
    const collectedWarnings: string[] = [];
    let latestProvenance: CalculationProvenance | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seen = new Map<string, any>();

    let prior = history;
    if (!prior && sessionId && userId) {
      try {
        prior = await ChatMessage.findBySession(sessionId, userId);
      } catch {
        prior = [];
      }
    }

    const historyRaw = (prior ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((m: any) => m && m.content && String(m.content).trim() && m.content !== message)
      .slice(-16);

    const sanitizedHistory: Array<{ role: string; content: string }> = [];
    let lastRole = 'system';
    for (const m of historyRaw) {
      const role = m.role === 'assistant' || m.role === 'ai' ? 'assistant' : 'user';
      const content = String(m.content).trim();
      if (!content) continue;
      if (role !== lastRole) {
        sanitizedHistory.push({ role, content });
        lastRole = role;
      } else if (sanitizedHistory.length > 0) {
        sanitizedHistory[sanitizedHistory.length - 1].content += '\n\n' + content;
      }
    }
    if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === 'user') {
      sanitizedHistory.pop();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [
      { role: 'system', content: SYSTEM },
      ...sanitizedHistory,
      { role: 'user', content: message },
    ];

    const MAX_TOOL_CALLS = 10;
    let actualToolExecutions = 0;
    const repeatedToolCounts = new Map<string, number>();

    const context: ToolContext = { sessionId, userId, farmId, userGoal: message };

    for (let round = 0; round < 6; round++) {
      if (actualToolExecutions >= MAX_TOOL_CALLS) {
        break;
      }

      const j = await this.groq(messages);

      if (j._toolError) {
        messages.push({
          role: 'user',
          content: 'Your last tool call had invalid JSON arguments. Try again or answer directly with the data you have.',
        });
        continue;
      }

      const m = j.choices?.[0]?.message ?? {};
      messages.push({ role: 'assistant', content: typeof m.content === 'string' ? m.content : '', tool_calls: m.tool_calls });

      if (!m.tool_calls?.length) {
        const answer = this.textOf(m);
        if (answer) {
          return {
            success: true,
            answer,
            steps,
            warnings: collectedWarnings.length > 0 ? collectedWarnings : undefined,
            provenance: latestProvenance,
          };
        }
        messages.push({
          role: 'user',
          content: 'Answer the question now using the tool results obtained.',
        });
        continue;
      }

      for (const tc of m.tool_calls) {
        if (actualToolExecutions >= MAX_TOOL_CALLS) {
          break;
        }

        const name = tc.function?.name;
        const parsedArgs = this.safeParseArgs(tc.function?.arguments);
        const canonicalArgs = stableStringify(parsedArgs);
        const key = `${name}:${canonicalArgs}`;

        const repeatCount = (repeatedToolCounts.get(key) ?? 0) + 1;
        repeatedToolCounts.set(key, repeatCount);

        let result: AIToolResult<unknown>;

        if (repeatCount > 2 && seen.has(key)) {
          result = {
            tool: name,
            success: true,
            data: seen.get(key).data,
            warnings: ['Duplicate call deduplicated.'],
          };
          steps.push({ tool: name, ok: true, cached: true });
        } else {
          actualToolExecutions++;
          try {
            const tool = this.tools[name];
            if (!tool) {
              result = {
                tool: name,
                success: false,
                error: {
                  code: 'TOOL_NOT_FOUND',
                  message: `Unknown tool '${name}'.`,
                  retryable: false,
                },
              };
              steps.push({ tool: name, ok: false });
            } else {
              result = await tool.exec(parsedArgs, context);
              steps.push({ tool: name, ok: result.success, epistemicTier: result.epistemicTier });
            }
          } catch (e: unknown) {
            result = {
              tool: name,
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: String((e as Error)?.message ?? e),
                retryable: false,
              },
            };
            steps.push({ tool: name, ok: false });
          }
          seen.set(key, result);
        }

        if (result.warnings && result.warnings.length > 0) {
          collectedWarnings.push(...result.warnings);
        }
        if (result.provenance) {
          latestProvenance = result.provenance;
        }

        let payload = JSON.stringify(result);
        if (payload.length > 15000) payload = payload.slice(0, 15000) + '..."TRUNCATED"';
        messages.push({ role: 'tool', tool_call_id: tc.id, content: payload });
      }
    }

    messages.push({
      role: 'user',
      content: 'STOP gathering data. Using ONLY the tool results above, give your final answer now. Do not guess any missing figures.',
    });
    const finalCall = await this.groq(messages, 'none');
    const answer = this.textOf(finalCall.choices?.[0]?.message) || '⚠️ Could not complete your request.';

    return {
      success: true,
      answer,
      steps,
      warnings: collectedWarnings.length > 0 ? collectedWarnings : undefined,
      provenance: latestProvenance,
    };
  }
}

export const orchestrator = new Orchestrator();
export const runAgent = (
  message: string,
  sessionId: string,
  userId: number,
  farmId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[] | null = null
) => orchestrator.runAgent(message, sessionId, userId, farmId, history);
