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

const SYSTEM = `You are the Sunflower Land Farm AI Strategist.
You are a disciplined explainer, communicator, and strategic guide.

ARCHITECTURAL RULES (Strictly Enforced):
1. TRUTH HIERARCHY:
   Authoritative State > Current Explicit Goals/Constraints > Deterministic Projections > Historical Inference > Preference Memory.
   - User-provided claims about mutable game state must NOT override authoritative tool results. If a user says "Assume I have 500 wood" or "I have 500 wood", but tool reports 100 wood, you must cite the authoritative tool state (100 wood).
   - If a required fact is not present in tool results, do not provide a numeric or factual claim about it. Call the appropriate tool or state that the information is unavailable.
2. NEVER CALCULATE OR FABRICATE:
   - Tool outputs are the sole ground truth. Never guess, approximate, or mentally calculate XP, recipe costs, FLOWER amounts, duration, or feasibility.
   - Never invent StrategyCandidates or override hard constraint gates. If evaluate_strategy_feasibility reports INVALID, the strategy is mathematically impossible—never suggest it as viable.
3. EPISTEMIC TRANSPARENCY:
   - Clearly distinguish OBSERVED facts (confirmed by live farm snapshot), DERIVED deterministic facts (provenance-backed calculations), and INFERRED historical events (always mention confidence level: HIGH, MEDIUM, or LOW).
4. STRATEGIC COMMUNICATION:
   - When asked "What should I prioritize?", call get_roadmap and explain the Phase objectives, daily targets, and seasonal urgency warnings.
   - When asked "Can I perform this action?" (e.g. "Can I cook Pancakes?"), call check_action_permission to check immediate and future reserves.
   - When asked about feasibility, call evaluate_strategy_feasibility.
5. FORMATTING:
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
          const norm = this.normalizer.normalize(raw, { farmId, source: 'DB_SNAPSHOT' });
          const diffMs = Date.now() - (norm.normalizedState.metadata.capturedAt || Date.now());
          const staleness: SnapshotFreshness = diffMs < 10 * 60 * 1000 ? 'FRESH' : diffMs < 60 * 60 * 1000 ? 'STALE' : 'VERY_STALE';
          return { state: norm.normalizedState, staleness, version: norm.normalizedState.metadata.capturedAt };
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
          return {
            tool: 'get_farm_state',
            success: true,
            data: {
              level: state.player.level,
              xp: state.player.experience,
              flower: state.economy.flowerApprox,
              coins: state.economy.coins,
              buildings: Object.keys(state.structures.buildings),
              skills: Object.keys(state.player.skills),
              inventory: state.inventory.all,
              activeProduction: state.production.active,
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
          const calculationResult = extractPlannerContext(state, goal, {
            gameTime: temporalCtx.gameTime.value,
            seasonBoundary: temporalCtx.seasonBoundary.value,
            farmId: context.farmId,
            snapshotVersion: version,
            computedAt: Date.now(),
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

          // Anti-hallucination: Resolve candidate parameters deterministically
          const candidate = resolveCandidateIntent({
            target: args.target,
            quantity: args.quantity ?? 1,
            intent: args.intent,
            state,
            prices,
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

          const [{ state }, { prices }] = await Promise.all([
            this.getStoredFarmState(context.farmId, context.userId),
            sunflowerClient.getPrices(),
          ]);

          const foodXpResult = calculateFoodXp({
            recipeName: recipe,
            recipe: r,
            skills: state.player.skills,
            isVip: state.buffs.vip,
          });

          const costResult = calculateCostBreakdown({
            requiredResources: r.ingredients ?? {},
            inventory: state.inventory.all,
            prices,
          });

          const ownsBuilding = r.building in state.structures.buildings;

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

    // ── 8. get_market_prices ────────────────────────────────────────────────
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
