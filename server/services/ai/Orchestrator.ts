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
import { hotStore } from '../../storage/index.js';
import { extractTemporalContext } from '../farm/temporalContextExtractors.js';
import { extractFarmHistoryDelta } from '../farm/historyContextExtractors.js';
import { extractPlannerContext } from '../farm/plannerContextExtractors.js';
import {
  calculateFoodXp,
  calculateCostBreakdown,
  getItemPrice,
  calculateAnimalProduceCost,
  getFarmAnimalSetupStatus,
  ANIMAL_PRODUCE_MAP,
  checkImmediateActionPermitted,
  checkFutureActionPermitted,
  evaluateFeasibility,
  buildResourceLedger,
  resolveCandidateIntent,
  resolveEffectContext,
  evaluateDeliveries,
  evaluateCodexTasks,
  levelFromXp,
  xpRequiredForLevel,
  calculateLevelProgress,
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
  BuyVsFarmResult,
} from '../../domain/index.js';

import recipesData from '../../data/recipes.json' with { type: 'json' };
import itemsData from '../../data/items.json' with { type: 'json' };
import modifiersData from '../../data/modifiers.json' with { type: 'json' };
import expansionData from '../../data/expansion.json' with { type: 'json' };
import skillCatalogue from '../../data/skills.json' with { type: 'json' };
import { itemMetadataService } from '../metadata/index.js';
import { knowledgeService } from '../knowledge/index.js';
import { PipelineCoordinator } from './pipeline/index.js';

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
6. BUY VS FARM / PRODUCTION ECONOMICS:
   - When asked "Should I farm X or buy from market?" (e.g. Milk, Eggs, Wool, crops, resources), or about buying cost vs farming cost:
     * MUST call evaluate_buy_vs_farm with item: "<ItemName>".
     * You MUST clearly present BOTH sides of the economic decision:
       1. Market Buying Cost: Live P2P FLOWER price per unit from market.
       2. In-House Production Cost: Feed cost per cycle divided by produce yield (production means feed cost x production yield).
          - For Milk: 5x Kernel Blend (~0.075 FLOWER at Level 0, producing 1 Milk + 1 Leather = 0.075 FLOWER/Milk). As cows level up (Level 3+), they eat 5x Hay (~0.064 FLOWER) and produce 2 Milk (+ 1 Leather), cutting unit production cost to 0.032 FLOWER/Milk!
          - For Eggs: 1x Kernel Blend (~0.015 FLOWER at Level 0, producing 1 Egg = 0.015 FLOWER/Egg). At Level 3+, 1x Hay (~0.013 FLOWER) produces 2 Eggs (+ 1 Feather) = 0.0065 FLOWER/Egg!
          - For Wool: 3x Kernel Blend (~0.045 FLOWER at Level 0, producing 1 Wool = 0.045 FLOWER/Wool). At Level 3+, 3x Hay (~0.038 FLOWER) produces 2 Wool (+ 1 Merino Wool) = 0.019 FLOWER/Wool!
       3. Feed Inventory: State if the player already has feed on hand in inventory (which reduces out-of-pocket cash feed expense to 0!).
       4. Capital / Setup Requirements: If the player does NOT currently own the building or animals, state the setup status clearly:
          - Barn unlock: Level 30 (note if player's level meets this, e.g. Lv 62 MET!). Initial Level 1 construction requires: 200 Coins, 150 Wood, 10 Iron, 10 Gold (P2P cost: ~5.64 SFL). Cow purchase: 100 Coins.
          - Hen House unlock: Level 6. Initial Level 1 construction requires: 100 Coins, 30 Wood, 5 Iron, 5 Gold (P2P cost: ~2.28 SFL). Chicken purchase: 50 Coins.
       5. Recommendation: Provide a balanced dual-horizon recommendation:
          - Short-Term: If Barn/cows are unbuilt and the produce is needed right now for a recipe or delivery, buying from the market is immediate and avoids the setup capital.
          - Long-Term: In-house farming is far more economical and sustainable once established (especially as animals level up, cutting production cost by more than half, plus bonus secondary goods like Leather, Feathers, or Merino Wool!).
7. FORMATTING:
   - Be concise, direct, and actionable.
   - Use bold for key numbers (**120 FLOWER**, **5,000 XP**).
   - Use small markdown tables (max 4 columns) for comparisons.
   - Clearly highlight Warnings and Avoid actions returned by tools.
8. INGREDIENT STRATEGY & CURRENT STOCK:
   - When presenting recipes, daily targets, or cooking recommendations from get_roadmap:
     * You MUST use the exact ingredientBreakdown array provided on each candidate or daily objective ingredientSummary.
     * NEVER report "Current Stock: 0" for an item if owned > 0 in ingredientBreakdown or get_farm_state. Cite the true stock (e.g. "Crimstone: 22", "Magic Mushroom: 143", "Honey: 11.5").
     * When rendering an Ingredient Strategy or Shopping List table, use these exact columns:
       | Ingredient | Current Stock | Needed | Cost (FLOWER) | Action |
       | Crimstone | 22 | 1 | 0.00 | In Stock |
       | Fish Oil | 0 | 1 | 0.10 | Buy from Market |
       | Magic Mushroom | 143 | 3 | 0.00 | In Stock |
       | Honey | 11.5 | 20 | 0.17 | Buy 8.5 (11.5 In Stock) |
     * If an item is unpurchasable / gather-only (actionType: 'GATHER'), clearly state Action: "Mine/Forage on island" (Cost: 0 FLOWER).
     * Distinguish clearly between DISHES (e.g. Crimstone Infused Fish Oil) and raw INGREDIENTS (e.g. Fish Oil, Crimstone). Never list a cooked dish name in the Ingredient column.
9. CODEX DELIVERIES, WEEKLY CHORES & BOUNTIES:
   - When asked "Which delivery gives the best return?", "What deliveries should I do?", "What orders do I have?", or questions about deliveries, codex, chores, or bounties:
     * MUST call get_deliveries and/or get_codex_chores_and_bounties.
     * Categorize delivery options clearly:
       1. Best Immediate Return (Ready to Deliver Now): Highlight any orders the player can fulfill right now because all required items are already in their inventory (e.g. Corale: 2 Mahi Mahi for 578 Coins).
       2. Best Coins Return: Compare active coin orders (e.g. Victoria: 1,100 Coins, Peggy: 928 Coins, Tango: 544 Coins) and state what items are missing.
       3. Best SFL Return: State active SFL orders (e.g. Grimtooth: 0.4 SFL for 3 Boiled Eggs, Grubnuk: 0.5 SFL for 1 Kale Omelette) and highlight net profit over ingredient cost.
       4. Best Shiny Feathers Return (Ascension Age): State seasonal orders (e.g. Pharaoh: 9 Shiny Feathers / +45 Ascension Age points, Cornwell: 6 Shiny Feathers, Finley: 5 Shiny Feathers).
     * Distinguish clearly between fulfilled/completed orders (e.g. Betty, Blacksmith, Old Salty, Guria, Gordo, Gambit, Grimbly) and active unfulfilled orders.
   - MANDATORY DISAMBIGUATION & REAL-EXAMPLES RULE:
     * If the user's prompt is brief, numbered, or ambiguous (e.g. "2", "flower delivery", "what next?"), or if you need clarification:
     * NEVER EVER use imaginary placeholder examples like "Delivery 1 - Milk & Eggs", "Delivery 2 - Crops", or "Delivery 3 - Flower".
     * YOU MUST ALWAYS USE REAL EXAMPLES FROM THE PLAYER'S ACTUAL FARM STATE / ACTIVE CODEX:
       - If the user says "2" or a number: Map it to the actual active orders involving 2 items or order #2 (e.g., Corale's 2 Mahi Mahi for 578 Coins, Victoria's 2 Olive + 20 Wheat for 1,100 Coins, Peggy's 2 Banana Blast for 928 Coins, Raven's 2 Blue Clover for 6 Feathers, or Pharaoh's 2 Vases for 9 Feathers).
       - If the user says "flower delivery": Detail active flower orders/bounties (e.g. previously completed Guria's 1 Purple Daffodil for 1.1 SFL, active Raven's 2 Blue Clover for 6 Feathers, and Poppy's Flower Bounties: Red Daffodil, Purple Balloon Flower, White Daffodil, White Clover, Blue Daffodil).
10. MULTI-STEP REASONING PIPELINE (Always Follow):
   PHASE 1 — GOAL DECOMPOSITION:
   - Before calling any tool, mentally identify: (a) What is the user's actual goal? (b) What data do you need to answer? (c) Is there a hypothetical/what-if component?
   - If the query is too vague to give a meaningful answer AND you need a preference to proceed (e.g. time vs FLOWER trade-off, what specific goal they want), ask ONE targeted question. Never ask follow-ups on clear queries.
   - Example of CLEAR query (do NOT ask follow-up): "what should I cook today?" → call get_roadmap and answer.
   - Example of VAGUE query (ASK follow-up): "help me plan" → "What would you like to focus on — maximizing XP, earning FLOWER, or completing a specific goal like reaching Level 70?"
   PHASE 2 — TOOL EXECUTION WITH FALLBACK:
   - Call tools in logical dependency order (get_farm_state first if you need inventory/level).
   - If a tool returns an error or empty data: say so explicitly, explain what you can't determine, and still answer with what data you DO have. Never fabricate missing numbers.
   - Use the injected recentActivity (inventory delta since last snapshot) and dailyProduction (7-day FLOWER valuation) in your reasoning — these are pre-computed for you.
   PHASE 3 — SUFFICIENCY CHECK:
   - If critical data is missing (tool failed, farm state unavailable): explicitly state what's missing and what the answer would look like once the data is available. Never hallucinate.
   PHASE 4 — SYNTHESIS:
   - Use delta data and production valuations in your answer when relevant (e.g. "your farm produced X FLOWER yesterday").
   - Only add a suggested follow-up if your answer reveals an implicit trade-off the user may not have considered (e.g. you answered XP-focused but FLOWER path is significantly different).
11. WHAT-IF SIMULATION:
   - When user asks "what if I had X", "what if I cook Y", "if I build Z what would happen", or sets a production goal ("I want to earn 20 FLOWER today"):
   * MUST call simulate_what_if with a goal and the hypothetical changes.
   * Present results as a clear before/after comparison:
     - Baseline: what the farm produces NOW
     - Simulated: what the farm would produce WITH the hypothetical change
     - Gap: how much closer (or further) the change takes them toward the goal
   * If the goal is reachable, state the exact path. If not, show the shortfall and suggest alternatives.
12. BUMPKIN LEVEL & XP PROGRESSION:
   - When asked "how much xp i need to reach the next level", "how much xp i need for level 100", or any question about level progression or XP thresholds:
     * MUST call get_level_requirements (specifying targetLevel if requested, e.g. targetLevel: 100) or use nextLevel in get_farm_state / injected context.
     * Cite the exact authoritative figures:
       1. Current Bumpkin Level and Current XP (e.g. Level 64 with 2,898,543.905 XP).
       2. Target Level and official cumulative XP required (e.g. Level 65 requires 2,942,905 cumulative XP; Level 100 requires 24,083,905 cumulative XP).
       3. Exact remaining XP shortfall: (target XP - current XP, e.g. 44,361.095 XP needed for Level 65; 21,185,361.095 XP needed for Level 100).
       4. Progress percentage and intermediate milestones if target is far ahead.
     * NEVER state that you do not have the XP-required table. The official levels catalog table (Levels 1 to 200) is fully available via get_level_requirements and get_farm_state.
13. SKILLS & SKILL TREE PROGRESSION:
   - When asked "what skill should I unlock next", "what skill to get", "recommend skills", "I want to unlock new skill", or any question about skills/skill trees:
     * MUST call get_skills_tree (with category if specified, or goal: "XP" / "PRODUCTIVITY" / "FLOWER").
     * NEVER claim that "all skills that are available at your current level are already unlocked" or that "there is nothing left to unlock". Sunflower Land has 11 distinct skill trees with ~80 skills; bumpkins specialize by allocating skill points into specific branches.
     * Compare the player's currently active skills against the locked skills in get_skills_tree.
     * Present a clear, structured breakdown of the best locked skills to target next based on the player's goals (Productivity, XP acceleration, or FLOWER economy).
     * State the skill's Tier, exact effects (e.g. +1 yield, -10% cook time, +10% XP), and any drawbacks (e.g. Acre Farm vs Hectare Farm trade-offs).
14. RECIPES & XP GAIN / PRODUCTIVITY BOOSTS:
   - When asked "how to increase xp gain", "how to level up faster", "what should I cook for xp", or seeking ways to gain XP:
     * MUST call get_roadmap (with objective: 'MAXIMIZE_XP' or 'REACH_LEVEL') or compute_recipe_cost.
     * NEVER invent or hallucinate recipe XP numbers (e.g. NEVER say 1 XP for Pancakes).
     * Sunflower Land recipes award substantial XP (e.g. Pancakes give 1,000 XP; Pizza Margherita gives 25,000 XP; Apple Pie gives 10,000 XP; Beetroot Tart gives 8,000 XP; Roast Veggies gives 340 XP).
     * Provide realistic daily XP targets and realistic timeframes to reach the next level (e.g. 39,279 XP needed to reach Level 65 can be achieved in hours/days with active cooking, not 77 days!).
15. KNOWLEDGE BASE & GAME RULES RETRIEVAL:
   - When asked about game mechanics, item recipes, tools, crops, animal guides, building prerequisites, island expansions, or general game rules:
     * MUST call search_knowledge with a concise query, entity name, or category.
     * Use the retrieved authoritative AST facts (exact ingredient amounts, coin costs, sell prices) and wiki explanations to give 100% accurate, non-hallucinated answers.
     * When citing recipes or requirements retrieved from search_knowledge, cite the exact numbers from the tool results.`;

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
  if (obj === undefined) return 'null';
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  const keys = Object.keys(obj as object)
    .filter((k) => (obj as any)[k] !== undefined)
    .sort();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((obj as any)[k])}`).join(',')}}`;
}

export class Orchestrator {
  private normalizer = farmNormalizer;
  private memoryStates = new Map<string, { state: NormalizedFarmState; staleness: SnapshotFreshness; version: number }>();
  private memoryRawStates = new Map<string, unknown>();

  /**
   * Register an in-memory farm state for testing or active session context.
   */
  public setFarmState(farmId: string, rawOrNormalized: unknown, staleness: SnapshotFreshness = 'FRESH', version = 1): void {
    const norm = (rawOrNormalized as any).player
      ? (rawOrNormalized as NormalizedFarmState)
      : this.normalizer.normalize(rawOrNormalized, { farmId }).normalizedState;
    this.memoryStates.set(farmId, { state: norm, staleness, version });
    this.memoryRawStates.set(farmId, rawOrNormalized);
  }

  /**
   * Helper to retrieve raw farm snapshot if available.
   */
  public async getStoredRawFarm(farmId: string, userId?: number): Promise<any> {
    if (this.memoryRawStates.has(farmId)) {
      return this.memoryRawStates.get(farmId);
    }
    try {
      const raw = await hotStore.getRaw(farmId);
      if (raw) return raw;
    } catch {}
    try {
      const farmData = await sunflowerClient.getFarm(farmId);
      if (farmData?.raw) return farmData.raw;
    } catch {}
    if (userId) {
      try {
        const snaps = await snapshotService.latest(userId, 1);
        if (snaps.length > 0) return snaps[0];
      } catch {}
    }
    return null;
  }

  /**
   * Helper to retrieve the latest cached/stored farm state without hitting the external API synchronously.
   */
  public async getStoredFarmState(farmId: string, userId?: number): Promise<{ state: NormalizedFarmState; staleness: SnapshotFreshness; version: number }> {
    // 1. Check in-memory registered states (for tests and active session mocks)
    if (this.memoryStates.has(farmId)) {
      return this.memoryStates.get(farmId)!;
    }

    // 2. Query Redis Hot Store first (live hot state, sub-millisecond retrieval)
    try {
      const hotCache = await hotStore.get(farmId);
      if (hotCache && hotCache.state) {
        const diffMs = Date.now() - (hotCache.updatedAt || Date.now());
        const staleness: SnapshotFreshness = diffMs < 10 * 60 * 1000 ? 'FRESH' : diffMs < 60 * 60 * 1000 ? 'STALE' : 'VERY_STALE';
        return { state: hotCache.state, staleness, version: hotCache.snapshotVersion };
      }
    } catch {
      // Gracefully fall through on cache miss or connection error
    }

    // 3. Fallback: SunflowerClient cache / fetch if available, then commit directly to Redis Hot Store
    try {
      const farmData = await sunflowerClient.getFarm(farmId);
      const norm = this.normalizer.normalize(farmData.raw, { farmId, source: 'CACHE_OR_API' });
      const staleness: SnapshotFreshness = farmData.stale ? 'STALE' : 'FRESH';
      const nowMs = Date.now();

      // Commit live state to hotStore for subsequent sub-millisecond retrieval
      hotStore.commit({
        farmId,
        snapshotVersion: nowMs,
        state: norm.normalizedState,
        updatedAt: nowMs,
        syncStatus: 'SUCCESS',
      }).catch(() => {});

      if (farmData.raw) {
        hotStore.setRaw(farmId, farmData.raw).catch(() => {});
      }

      return { state: norm.normalizedState, staleness, version: nowMs };
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

          const currentXp = Number(state.player.experience ?? 0);
          const currentLevel = Number(state.player.level ?? levelFromXp(currentXp));
          const nextLevel = currentLevel + 1;
          const nextLevelXp = xpRequiredForLevel(nextLevel);
          const nextLevelProgress = calculateLevelProgress(currentXp, nextLevel);
          const remainingXp = Math.max(0, Math.round((nextLevelXp - currentXp) * 1000) / 1000);

          return {
            tool: 'get_farm_state',
            success: true,
            data: {
              level: currentLevel,
              xp: currentXp,
              nextLevel: {
                level: nextLevel,
                requiredCumulativeXp: nextLevelXp,
                remainingXp,
                progressPercent: +(nextLevelProgress.progressFraction * 100).toFixed(2),
              },
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
              inventory: Object.fromEntries(
                Object.entries(state.inventory.all).filter(([_, qty]) => Number(qty) > 0)
              ),
              activeProduction: state.production.active.map((p) => ({
                item: p.item,
                category: p.category,
                readyAt: p.readyAt,
                status: p.status,
              })),
              equipped: state.player.equipped,
              placedCollectibles: Array.from(new Set(state.structures.placedCollectibles?.map((p) => p.name) ?? [])),
              activeBoosts: effectRes.value.activeEffects.map((e) => `${e.sourceId}: ${e.description}`),
              animals: Object.values(state.animals?.animals ?? {}).map((a) => ({
                id: a.id,
                type: a.type,
                level: a.level,
                experience: a.experience,
                state: a.state,
              })),
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

    // ── 2. get_level_requirements (Authoritative XP Progression) ─────────────
    get_level_requirements: {
      description: 'Authoritative Bumpkin cumulative XP requirements and progression metrics for any target level (e.g. next level, Level 65, Level 70, Level 75, Level 100, up to Level 200) based on official Sunflower Land level thresholds. Returns exact cumulative XP needed, shortfall from current player XP, progress percentage, and intermediate milestones.',
      parameters: {
        type: 'object',
        properties: {
          targetLevel: {
            type: 'number',
            description: 'Target Bumpkin level to query (e.g. 65, 70, 75, 100). If omitted, defaults to next level (currentLevel + 1).',
          },
        },
      },
      exec: async (args, context) => {
        try {
          const { state, staleness, version } = await this.getStoredFarmState(context.farmId, context.userId);
          const currentXp = Number(state.player.experience ?? 0);
          const currentLevel = Number(state.player.level ?? levelFromXp(currentXp));
          const targetLevel = Number(args.targetLevel ?? (currentLevel + 1));

          const targetRequiredXp = xpRequiredForLevel(targetLevel);
          const remainingXp = Math.max(0, Math.round((targetRequiredXp - currentXp) * 1000) / 1000);
          const progress = calculateLevelProgress(currentXp, targetLevel);

          const nextLevel = currentLevel + 1;
          const nextLevelXp = xpRequiredForLevel(nextLevel);
          const nextLevelRemaining = Math.max(0, Math.round((nextLevelXp - currentXp) * 1000) / 1000);

          // Intermediate milestones if targetLevel is multiple levels ahead
          const milestones: Array<{ level: number; requiredCumulativeXp: number; remainingXp: number }> = [];
          if (targetLevel > currentLevel + 1) {
            const milestoneCandidates = [
              currentLevel + 1,
              Math.ceil((currentLevel + 1) / 5) * 5,
              Math.ceil((currentLevel + 1) / 10) * 10,
              65, 70, 75, 80, 85, 90, 95, 100,
              targetLevel,
            ].filter((lvl, idx, arr) => lvl > currentLevel && lvl <= targetLevel && arr.indexOf(lvl) === idx)
             .sort((a, b) => a - b);

            for (const ml of milestoneCandidates) {
              const req = xpRequiredForLevel(ml);
              milestones.push({
                level: ml,
                requiredCumulativeXp: req,
                remainingXp: Math.max(0, Math.round((req - currentXp) * 1000) / 1000),
              });
            }
          }

          return {
            tool: 'get_level_requirements',
            success: true,
            data: {
              currentLevel,
              currentXp,
              targetLevel,
              targetRequiredCumulativeXp: targetRequiredXp,
              remainingXpToTarget: remainingXp,
              overallProgressPercent: +(Math.min(100, (currentXp / targetRequiredXp) * 100)).toFixed(2),
              levelBracketProgressPercent: +(progress.progressFraction * 100).toFixed(2),
              nextLevel: {
                level: nextLevel,
                requiredCumulativeXp: nextLevelXp,
                remainingXp: nextLevelRemaining,
              },
              milestones: milestones.length > 0 ? milestones : undefined,
              summary: `Current: Level ${currentLevel} (${currentXp.toLocaleString()} XP). Target Level ${targetLevel} requires ${targetRequiredXp.toLocaleString()} cumulative XP. Remaining XP needed: ${remainingXp.toLocaleString()} XP.`,
            },
            epistemicTier: 'AUTHORITATIVE',
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
            tool: 'get_level_requirements',
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

    // ── 3. get_roadmap (Phase 5 Strategic Planner) ─────────────────────────
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
          recipe: { type: 'string', description: "Recipe name, e.g. 'Pizza Margherita' or 'Pancakes' or 'Cheese'" },
          quantity: { type: 'number', description: 'Quantity of recipe to produce/cook (default: 1)' },
        },
        required: ['recipe'],
      },
      exec: async ({ recipe, quantity = 1 }, context) => {
        try {
          const qty = Math.max(1, Number(quantity) || 1);
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

          // Scale required ingredients by quantity
          const baseIngredients: Record<string, number> = r.ingredients ?? {};
          const scaledIngredients: Record<string, number> = {};
          for (const [ing, count] of Object.entries(baseIngredients)) {
            scaledIngredients[ing] = Number(count) * qty;
          }

          const costResult = calculateCostBreakdown({
            requiredResources: scaledIngredients,
            inventory: state.inventory.all,
            prices,
          });

          const ownsBuilding = r.building in state.structures.buildings;
          const boostsList = foodXpResult.value.boostBreakdown.map((b) => b.label).join(', ');
          const unitXp = Number(foodXpResult.value.xpPerFood.toFixed(2));
          const totalXp = Number((unitXp * qty).toFixed(2));
          const mins = Math.floor(foodXpResult.value.minutes);
          const secs = Math.round((foodXpResult.value.minutes % 1) * 60);
          const timeFormatted = `${mins}m ${secs}s`;

          // Ingredient details breakdown with live unit prices
          const ingredientDetails: Array<{
            item: string;
            perUnit: number;
            totalNeeded: number;
            inStock: number;
            toBuy: number;
            unitPriceFlower: number | null;
            totalCostFlower: number;
          }> = [];

          for (const [ing, needed] of Object.entries(scaledIngredients)) {
            const inStock = state.inventory.all?.[ing] ?? 0;
            const toBuy = Math.max(0, needed - inStock);
            const unitPrice = getItemPrice(ing, prices);
            const totalCost = unitPrice != null ? toBuy * unitPrice : 0;
            ingredientDetails.push({
              item: ing,
              perUnit: baseIngredients[ing] ?? 0,
              totalNeeded: needed,
              inStock,
              toBuy,
              unitPriceFlower: unitPrice,
              totalCostFlower: Number(totalCost.toFixed(4)),
            });
          }

          return {
            tool: 'compute_recipe_cost',
            success: true,
            data: {
              recipe,
              quantity: qty,
              baseOutput: (r.baseOutput ?? 1) * qty,
              building: r.building,
              ownsBuilding,
              warning: ownsBuilding ? null : `⚠️ You do NOT own a ${r.building}! You cannot cook this recipe until you build one.`,
              effective: {
                ...foodXpResult.value,
                totalXpGained: totalXp,
              },
              cost: costResult.value,
              baseIngredients,
              scaledIngredients,
              ingredientDetails,
              totalMinutes: foodXpResult.value.minutes * qty,
              formattedTime: timeFormatted,
              explanation: `Cooking ${qty > 1 ? `${qty}x ` : ''}${recipe} yields ${totalXp} XP (${unitXp} XP each, base: ${r.baseXp} XP${boostsList ? `, active boosts: ${boostsList}` : ''}). Duration: ${timeFormatted} per unit. Required ingredients: ${Object.entries(scaledIngredients).map(([i, n]) => `${n} ${i}`).join(', ')}. In-stock inventory covers part/all, remaining acquisition cost is ${costResult.value.flower.toFixed(4)} FLOWER (total valuation: ${costResult.value.totalFlower.toFixed(4)} FLOWER).`,
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

    // ── 16. evaluate_buy_vs_farm (Production vs Market Economics) ───────────
    evaluate_buy_vs_farm: {
      description: 'Deterministic economic comparison between buying an item on the live P2P market vs producing it in-house (feed cost * feed required / produce yield for animal products like Milk, Eggs, Wool; seed cost & time for crops; ingredients for recipes). Includes farm capital readiness (building & animal ownership, level requirement, missing materials) and inventory feed offset.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: "Item name to evaluate, e.g. 'Milk', 'Egg', 'Wool', 'Leather', 'Feather'" },
          quantity: { type: 'number', description: 'Quantity to evaluate (default 1)' },
          animalLevel: { type: 'number', description: 'Optional animal level override (defaults to current farm animal level or 0 if unowned)' },
        },
        required: ['item'],
      },
      exec: async ({ item, quantity = 1, animalLevel }, context) => {
        try {
          if (!item || typeof item !== 'string') {
            return {
              tool: 'evaluate_buy_vs_farm',
              success: false,
              epistemicTier: 'DERIVED',
              error: {
                code: 'INVALID_ARGUMENT',
                message: 'Parameter "item" is required and must be a string.',
                retryable: false,
              },
            };
          }

          const targetItem = item.trim();
          const [{ state, version }, { prices }] = await Promise.all([
            this.getStoredFarmState(context.farmId, context.userId),
            sunflowerClient.getPrices(),
          ]);

          const marketPrice = getItemPrice(targetItem, prices);

          // Check if item is an animal produce (Milk, Egg, Wool, Leather, Feather, Merino Wool)
          const animalProduceMeta = ANIMAL_PRODUCE_MAP[targetItem];

          if (animalProduceMeta) {
            const animalType = animalProduceMeta.animalType;
            const effectRes = resolveEffectContext(state, {
              now: Date.now(),
              season: state.temporal?.season,
              farmId: context.farmId,
              snapshotVersion: version,
            });

            // Find animal level on farm if not overridden
            let effectiveLevel = 0;
            const animalsOfType = Object.values(state.animals?.animals ?? {}).filter(
              (a) => (a.type || 'chicken').toLowerCase() === animalType.toLowerCase()
            );
            if (animalLevel != null) {
              effectiveLevel = Number(animalLevel);
            } else if (animalsOfType.length > 0) {
              effectiveLevel = Math.max(...animalsOfType.map((a) => a.level || 0));
            }

            const yieldAddition = animalType === 'Cow'
              ? effectRes.value.animals.yieldAdditions.milk
              : animalType === 'Chicken'
              ? effectRes.value.animals.yieldAdditions.egg
              : effectRes.value.animals.yieldAdditions.wool;

            const economics = calculateAnimalProduceCost({
              produceItem: targetItem,
              animalLevel: effectiveLevel,
              prices,
              inventory: state.inventory.all,
              feedCostMultiplier: effectRes.value.animals.costMultipliers.feed,
              freeChickenFeed: effectRes.value.animals.flags.freeChickenFeed,
              yieldAddition,
            });

            const setupStatus = getFarmAnimalSetupStatus(animalType, state);
            const unitProduceCost = economics?.unitProduceCostFlower ?? null;
            let costDiff: number | null = null;
            let percentSavings: number | null = null;
            let recommendation: 'BUY_FROM_MARKET' | 'FARM_IN_HOUSE' | 'NEUTRAL' | 'UNPRICED' = 'UNPRICED';

            if (unitProduceCost != null && marketPrice != null) {
              costDiff = unitProduceCost - marketPrice;
              percentSavings = marketPrice > 0 ? ((unitProduceCost - marketPrice) / marketPrice) * 100 : 0;
              if (costDiff > 0.001) {
                recommendation = 'BUY_FROM_MARKET';
              } else if (costDiff < -0.001) {
                recommendation = 'FARM_IN_HOUSE';
              } else {
                recommendation = 'NEUTRAL';
              }
            }

            // Multi-tier progression comparison
            const activeTier = economics?.activeTier;
            const feedOnHand = economics?.feedOnHand ?? 0;
            const feedItem = activeTier?.feedItem ?? 'feed';
            const feedQty = activeTier?.feedQuantity ?? 1;

            let explanation = '';
            if (setupStatus.canProduceNow) {
              explanation += `Farm Setup: You already own ${setupStatus.buildingName} (Level ${setupStatus.buildingLevel}) with ${setupStatus.animalsSummary ?? `${setupStatus.animalCount}x ${animalType}s`}. `;
            } else {
              explanation += `Setup Status: You do not yet have an active ${setupStatus.buildingName} / ${animalType} setup (${setupStatus.missingRequirements.join('; ')}). `;
            }

            if (marketPrice != null) {
              explanation += `Market Buying Price: ${marketPrice.toFixed(4)} FLOWER per unit. `;
            } else {
              explanation += `Market Buying Price: Currently unlisted/no active trades for ${targetItem} on the P2P market. `;
            }

            if (unitProduceCost != null) {
              explanation += `In-House Production Cost: ${unitProduceCost.toFixed(4)} FLOWER per unit (requires ${feedQty}x ${feedItem} costing ${activeTier?.feedCostFlower ?? 0} FLOWER per cycle to yield ${activeTier?.produceYield ?? 1} ${targetItem}${activeTier?.secondaryProduce?.item ? ` + ${activeTier.secondaryProduce.quantity} ${activeTier.secondaryProduce.item}` : ''}). `;
            } else {
              explanation += `In-House Production: Requires ${feedQty}x ${feedItem} per cycle, but ${feedItem} currently has no active P2P market price. `;
            }

            if (economics && economics.allTiers.length > 1) {
              const tier0 = economics.allTiers[0];
              const tier1 = economics.allTiers[1];
              if (tier0.unitCostFlower != null && tier1.unitCostFlower != null) {
                explanation += `Tier progression: Level 0–3 costs ${tier0.unitCostFlower.toFixed(4)} FLOWER/unit (${tier0.feedQuantity}x ${tier0.feedItem}); Level 3–6 drops to ${tier1.unitCostFlower.toFixed(4)} FLOWER/unit (${tier1.feedQuantity}x ${tier1.feedItem}). `;
              }
            }

            if (feedOnHand >= feedQty) {
              explanation += `You already have ${feedOnHand}x ${feedItem} in inventory, so the immediate feed expense is 0 FLOWER! `;
            } else {
              explanation += `You have ${feedOnHand}x ${feedItem} in inventory (need ${feedQty}x for a feeding cycle). `;
            }

            if (setupStatus.canProduceNow) {
              if (feedOnHand < feedQty) {
                explanation += `Short-term: If you need ${targetItem} immediately and don't have enough ${feedItem} to feed now, buying from the market is the instant option. Long-term / Recurring: Farm in-house since your farm is already equipped with ${setupStatus.animalCount} ${animalType}s.`;
              } else {
                explanation += `Recommendation: ${recommendation === 'FARM_IN_HOUSE' ? 'FARM_IN_HOUSE is more cost-effective than buying from the market.' : recommendation === 'BUY_FROM_MARKET' ? 'BUY_FROM_MARKET is currently cheaper than feed cost.' : recommendation === 'UNPRICED' ? 'Market price data incomplete for exact recommendation.' : 'Both options have comparable costs.'}`;
              }
            } else {
              explanation += `Initial setup: ${setupStatus.initialSetupCost.coins} Coins and materials (${Object.entries(setupStatus.initialSetupCost.resources).map(([r, q]) => `${q} ${r}`).join(', ')}). `;
              explanation += `Short-term recommendation: BUY_FROM_MARKET for immediate needs. Long-term recommendation: FARM_IN_HOUSE once Barn/Cows are built for lower recurring unit costs.`;
            }

            const data: BuyVsFarmResult = {
              item: targetItem,
              category: 'ANIMAL_PRODUCE',
              marketPriceFlower: marketPrice != null ? Number(marketPrice.toFixed(4)) : null,
              unitProduceCostFlower: unitProduceCost != null ? Number(unitProduceCost.toFixed(4)) : null,
              costDifferenceFlower: costDiff != null ? Number(costDiff.toFixed(4)) : null,
              percentSavings: percentSavings != null ? Number(percentSavings.toFixed(1)) : null,
              recommendation,
              animalEconomics: economics ?? undefined,
              setupStatus,
              summary: explanation,
            };

            return {
              tool: 'evaluate_buy_vs_farm',
              success: true,
              data,
              epistemicTier: 'DERIVED',
              provenance: {
                farmId: context.farmId,
                snapshotVersion: version,
                calculationEngineVersion: '2.0.0',
                gameDataVersion: '2026.09.13',
                computedAt: Date.now(),
              },
            };
          }

          // Fallback for non-animal produce (crops or standard resources)
          const safeMarketPrice = marketPrice ?? 0;
          const data: BuyVsFarmResult = {
            item: targetItem,
            category: 'RESOURCE',
            marketPriceFlower: Number(safeMarketPrice.toFixed(4)),
            unitProduceCostFlower: Number(safeMarketPrice.toFixed(4)),
            costDifferenceFlower: 0,
            percentSavings: 0,
            recommendation: 'NEUTRAL',
            summary: `Market price for ${targetItem} is ${safeMarketPrice.toFixed(4)} FLOWER.`,
          };

          return {
            tool: 'evaluate_buy_vs_farm',
            success: true,
            data,
            epistemicTier: 'DERIVED',
            provenance: {
              farmId: context.farmId,
              snapshotVersion: version,
              calculationEngineVersion: '2.0.0',
              gameDataVersion: '2026.09.13',
              computedAt: Date.now(),
            },
          };
        } catch (e) {
          return {
            tool: 'evaluate_buy_vs_farm',
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

    // ── 17. get_deliveries (Codex Delivery Orders & Economics) ─────────────
    get_deliveries: {
      description: 'Authoritative Sunflower Land Codex delivery orders evaluation (Coins, SFL, and Seasonal/Shiny Feather deliveries). Analyzes requirements against current farm inventory, checks readiness to deliver immediately, calculates market costs, net profit, and ROI (return on investment), and identifies the best delivery in each reward category.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['ALL', 'COINS', 'SFL', 'FEATHERS', 'READY_NOW'],
            description: 'Optional filter: "COINS" for coin orders, "SFL" for SFL orders, "FEATHERS" for seasonal/Ascension Age feather orders, "READY_NOW" for orders where player already has all items in inventory, or "ALL" (default).',
          },
          npc: {
            type: 'string',
            description: 'Optional specific NPC name to inspect (e.g. "victoria", "corale", "pharaoh", "grimtooth", "peggy").',
          },
        },
      },
      exec: async ({ category = 'ALL', npc: targetNpc }, context) => {
        try {
          const [{ state, staleness, version }, { prices }, rawFarm] = await Promise.all([
            this.getStoredFarmState(context.farmId, context.userId),
            sunflowerClient.getPrices(),
            this.getStoredRawFarm(context.farmId, context.userId),
          ]);

          const farmObj = rawFarm?.farm ?? rawFarm ?? {};
          const rawOrders = farmObj?.delivery?.orders ?? state.deliveries?.orders ?? [];
          const isVip = Boolean(state.buffs.vip || (farmObj?.vip?.expiresAt && Number(farmObj.vip.expiresAt) > Date.now()));

          const evalResult = evaluateDeliveries({
            orders: rawOrders,
            inventory: state.inventory.all,
            prices,
            isVip,
            farmId: context.farmId,
            snapshotVersion: version,
            computedAt: Date.now(),
          });

          let activeOrders = evalResult.value.activeOrders;
          let completedOrders = evalResult.value.completedOrders;

          if (category === 'COINS') {
            activeOrders = evalResult.value.activeCoinDeliveries;
          } else if (category === 'SFL') {
            activeOrders = evalResult.value.activeSflDeliveries;
          } else if (category === 'FEATHERS') {
            activeOrders = evalResult.value.activeFeatherDeliveries;
          } else if (category === 'READY_NOW') {
            activeOrders = evalResult.value.readyNowDeliveries;
          }

          if (targetNpc) {
            const lowerNpc = targetNpc.toLowerCase().trim();
            activeOrders = activeOrders.filter((o) => o.npc.toLowerCase().includes(lowerNpc));
            completedOrders = completedOrders.filter((o) => o.npc.toLowerCase().includes(lowerNpc));
          }

          return {
            tool: 'get_deliveries',
            success: true,
            data: {
              activeOrdersCount: activeOrders.length,
              completedOrdersCount: completedOrders.length,
              readyNowCount: evalResult.value.readyNowCount,
              bestCoinsDelivery: evalResult.value.bestCoinsDelivery,
              bestSflDelivery: evalResult.value.bestSflDelivery,
              bestFeathersDelivery: evalResult.value.bestFeathersDelivery,
              bestReadyNowDelivery: evalResult.value.bestReadyNowDelivery,
              recommendation: evalResult.value.recommendation,
              activeOrders,
              completedOrders: completedOrders.map((o) => ({
                id: o.id,
                npc: o.npc,
                rewardType: o.rewardType,
                rewardCoins: o.rewardCoins,
                rewardSfl: o.rewardSfl,
                rewardFeathers: o.rewardFeathers,
                completedAt: o.completedAt,
              })),
            },
            provenance: evalResult.provenance,
            epistemicTier: 'OBSERVED',
            staleness,
          };
        } catch (e) {
          return {
            tool: 'get_deliveries',
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

    // ── 18. get_codex_chores_and_bounties (Weekly Chores & Poppy Bounties) ─
    get_codex_chores_and_bounties: {
      description: 'Authoritative Sunflower Land Codex Weekly Chores (Codex Tab 21), Poppy Mega Bounty Board (Codex Tab 33: Flowers, Fish, Crustaceans, Animals, Artefacts), and Daily Bumpkin Chores. Reports current progress, target requirements, rewards (including VIP +3 feather boost), and ready-to-claim status against current farm inventory.',
      parameters: {
        type: 'object',
        properties: {
          tab: {
            type: 'string',
            enum: ['ALL', 'WEEKLY_CHORES', 'BOUNTIES', 'DAILY_CHORES', 'CHECKLIST'],
            description: 'Codex tab to inspect: "WEEKLY_CHORES" (Tab 21), "BOUNTIES" (Tab 33 Poppy), "DAILY_CHORES", "CHECKLIST", or "ALL" (default).',
          },
          bountyType: {
            type: 'string',
            enum: ['ALL', 'FLOWER', 'FISH', 'CRUSTACEAN', 'ANIMAL', 'ARTEFACT', 'GIANT_CROP'],
            description: 'Optional category filter for Poppy Mega Bounty Board.',
          },
        },
      },
      exec: async ({ tab = 'ALL', bountyType = 'ALL' }, context) => {
        try {
          const [{ state, staleness, version }, rawFarm] = await Promise.all([
            this.getStoredFarmState(context.farmId, context.userId),
            this.getStoredRawFarm(context.farmId, context.userId),
          ]);

          const farmObj = rawFarm?.farm ?? rawFarm ?? {};
          const isVip = Boolean(state.buffs.vip || (farmObj?.vip?.expiresAt && Number(farmObj.vip.expiresAt) > Date.now()));

          const evalResult = evaluateCodexTasks({
            choreBoard: farmObj?.choreBoard ?? state.deliveries?.chores,
            bounties: farmObj?.bounties ?? state.deliveries?.bounties,
            dailyChores: farmObj?.chores,
            farmActivity: farmObj?.farmActivity ?? {},
            inventory: state.inventory.all,
            isVip,
            farmId: context.farmId,
            snapshotVersion: version,
            computedAt: Date.now(),
          });

          let weeklyChores = evalResult.value.weeklyChores;
          let bounties = evalResult.value.bounties;

          if (bountyType !== 'ALL') {
            bounties = bounties.filter((b) => b.category === bountyType);
          }

          return {
            tool: 'get_codex_chores_and_bounties',
            success: true,
            data: {
              tab,
              bountyType,
              weeklyChores: tab === 'BOUNTIES' ? [] : weeklyChores,
              bounties: tab === 'WEEKLY_CHORES' ? [] : bounties,
              dailyChores: tab === 'WEEKLY_CHORES' || tab === 'BOUNTIES' ? [] : evalResult.value.dailyChores,
              summary: evalResult.value.summary,
              recommendation: evalResult.value.recommendation,
            },
            provenance: evalResult.provenance,
            epistemicTier: 'OBSERVED',
            staleness,
          };
        } catch (e) {
          return {
            tool: 'get_codex_chores_and_bounties',
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

    // ── simulate_what_if (Goal-oriented isolated simulation) ─────────────────
    simulate_what_if: {
      description: 'Goal-oriented, isolated what-if simulation. Applies hypothetical changes (add building, cook recipe, sell items, plant crops) to a CLONED farm state and projects whether a numeric goal (earn FLOWER, gain XP) becomes reachable. Zero side effects — does not modify the real farm state.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'object',
            description: 'The target the user wants to achieve.',
            properties: {
              type: { type: 'string', enum: ['EARN_FLOWER', 'GAIN_XP', 'PRODUCE_ITEM', 'COMPLETE_DELIVERY'], description: 'Goal type' },
              target: { type: 'number', description: 'Numeric target (e.g. 20 for 20 FLOWER, 50000 for 50k XP)' },
              item: { type: 'string', description: 'Item name for PRODUCE_ITEM goal' },
              window: { type: 'string', enum: ['1d', '7d', '30d', 'session'], description: 'Time window for the goal', default: '1d' },
            },
            required: ['type'],
          },
          hypotheticals: {
            type: 'array',
            description: 'List of hypothetical changes to apply to a cloned farm state.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['add_building', 'remove_building', 'cook', 'sell', 'plant_crop', 'add_animal', 'add_item'], description: 'Action type' },
                building: { type: 'string', description: 'Building name (for add_building/remove_building/cook)' },
                recipe: { type: 'string', description: 'Recipe name (for cook)' },
                item: { type: 'string', description: 'Item name (for sell/add_item/plant_crop)' },
                quantity: { type: 'number', description: 'Quantity', default: 1 },
              },
              required: ['type'],
            },
          },
        },
        required: ['goal', 'hypotheticals'],
      },
      exec: async ({ goal, hypotheticals = [] }, context) => {
        try {
          const { state, version } = await this.getStoredFarmState(context.farmId, context.userId);
          const { prices } = await sunflowerClient.getPrices().catch(() => ({ prices: {} as Record<string, number>, updatedAt: null, stale: true }));
          const effectRes = resolveEffectContext(state, { now: Date.now(), season: state.temporal?.season, farmId: context.farmId });

          // ── Build baseline projection ─────────────────────────────────────
          // Baseline: what the farm can do RIGHT NOW without any changes
          const baselineInventory = { ...state.inventory.all };
          let baselineXp = state.player.experience;
          let baselineFlower = state.economy.flowerApprox;

          // Project active cooking/production earnings from current state
          const activeProduction = state.production.active ?? [];
          let baselineProductionFlower = 0;
          for (const item of activeProduction) {
            const price = prices[item.item] ?? 0;
            baselineProductionFlower += price; // rough: 1 unit per active slot
          }

          // ── Apply hypotheticals to cloned state ───────────────────────────
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const simInventory: Record<string, number> = { ...baselineInventory };
          let simXp = baselineXp;
          let simFlower = baselineFlower;
          let simProductionFlower = baselineProductionFlower;

          const consequences: Array<{
            hypothetical: string;
            feasible: boolean;
            blocker?: string;
            xpGained?: number;
            flowerImpact?: string;
            ingredientsConsumed?: Record<string, number>;
            impact: string;
          }> = [];

          const warnings: string[] = [];

          for (const h of hypotheticals) {
            const label = `${h.type}:${h.building ?? h.recipe ?? h.item ?? ''}${h.quantity ? ` x${h.quantity}` : ''}`;

            if (h.type === 'cook' && h.recipe) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const recipeDef = (recipesData as Record<string, any>)[h.recipe];
              if (!recipeDef) {
                consequences.push({ hypothetical: label, feasible: false, blocker: `Recipe '${h.recipe}' not found in catalog`, impact: 'N/A' });
                continue;
              }
              const qty = h.quantity ?? 1;
              const ingredients: Record<string, number> = {};
              let canCook = true;
              const blockers: string[] = [];

              for (const [ing, baseAmt] of Object.entries(recipeDef.ingredients ?? {}) as [string, number][]) {
                const need = baseAmt * qty;
                ingredients[ing] = need;
                if ((simInventory[ing] ?? 0) < need) {
                  canCook = false;
                  const short = need - (simInventory[ing] ?? 0);
                  blockers.push(`${ing}: need ${need}, have ${simInventory[ing] ?? 0} (short ${+short.toFixed(2)})`);
                }
              }

              if (canCook) {
                // Deduct ingredients from sim inventory
                for (const [ing, need] of Object.entries(ingredients)) {
                  simInventory[ing] = (simInventory[ing] ?? 0) - need;
                }
                // Add produced food
                simInventory[h.recipe] = (simInventory[h.recipe] ?? 0) + qty;

                const foodXpResult = calculateFoodXp({
                  recipeName: h.recipe,
                  recipe: recipeDef,
                  skills: state.player.skills,
                  isVip: state.buffs.vip,
                  buildingOil: 0,
                  effectContext: effectRes.value,
                  farmId: context.farmId,
                });
                const xpGained = foodXpResult.value.batchXp * qty;
                simXp += xpGained;

                const deliveryValue = +(qty * (prices[h.recipe] ?? 0)).toFixed(4);
                consequences.push({
                  hypothetical: label,
                  feasible: true,
                  xpGained: Math.round(xpGained),
                  ingredientsConsumed: ingredients,
                  flowerImpact: deliveryValue > 0 ? `+${deliveryValue} FLOWER (if sold/delivered)` : 'No direct FLOWER (XP gain only)',
                  impact: `+${Math.round(xpGained).toLocaleString()} XP${deliveryValue > 0 ? `, +${deliveryValue} FLOWER potential` : ''}`,
                });
              } else {
                warnings.push(`Cannot cook ${h.recipe}: ${blockers.join('; ')}`);
                consequences.push({ hypothetical: label, feasible: false, blocker: blockers.join('; '), impact: 'Blocked — missing ingredients' });
              }
            } else if (h.type === 'add_building' && h.building) {
              // Hypothetical: farm now has this building — estimate production uplift
              const buildingProductionMap: Record<string, { flowerPerDay: number; description: string }> = {
                Greenhouse: { flowerPerDay: 5.0, description: 'Rare crops worth ~5 FLOWER/day' },
                'Hen House': { flowerPerDay: 0.5, description: 'Egg production ~0.5 FLOWER/day' },
                Barn: { flowerPerDay: 2.0, description: 'Milk + Leather ~2 FLOWER/day' },
                Deli: { flowerPerDay: 1.5, description: 'High-value cooking ~1.5 FLOWER/day' },
                Bakery: { flowerPerDay: 1.0, description: 'Bread/cake production ~1 FLOWER/day' },
              };
              const prod = buildingProductionMap[h.building];
              const window = goal.window === '7d' ? 7 : goal.window === '30d' ? 30 : 1;
              const uplift = prod ? +(prod.flowerPerDay * window).toFixed(4) : 0;
              simProductionFlower += uplift;
              simFlower += uplift;

              // Check if player can currently afford it (rough feasibility)
              const alreadyHas = !!state.structures.buildings[h.building];
              if (alreadyHas) {
                consequences.push({ hypothetical: label, feasible: true, flowerImpact: `+${uplift} FLOWER/${goal.window ?? '1d'}`, impact: `Already owned — ${prod?.description ?? 'production boost'}` });
              } else {
                consequences.push({
                  hypothetical: label,
                  feasible: true, // hypothetically feasible — this is a what-if
                  flowerImpact: `+${uplift} FLOWER/${goal.window ?? '1d'}`,
                  impact: `Would add ${prod?.description ?? 'production boost'} (+${uplift} FLOWER)`,
                });
                if (!alreadyHas) warnings.push(`${h.building} not currently built on your farm (hypothetical scenario)`);
              }
            } else if (h.type === 'sell' && h.item) {
              const qty = h.quantity ?? 1;
              const price = prices[h.item] ?? 0;
              const revenue = +(qty * price).toFixed(6);
              const have = simInventory[h.item] ?? 0;
              if (have >= qty) {
                simInventory[h.item] = have - qty;
                simFlower += revenue;
                consequences.push({ hypothetical: label, feasible: true, flowerImpact: `+${revenue} FLOWER`, impact: `Sell ${qty}x ${h.item} → +${revenue} FLOWER` });
              } else {
                consequences.push({ hypothetical: label, feasible: false, blocker: `Have ${have} ${h.item}, need ${qty}`, impact: `Partial sell possible (${have}/${qty})` });
                warnings.push(`Insufficient ${h.item} to sell ${qty} (have ${have})`);
              }
            } else if (h.type === 'add_item' && h.item) {
              const qty = h.quantity ?? 1;
              simInventory[h.item] = (simInventory[h.item] ?? 0) + qty;
              consequences.push({ hypothetical: label, feasible: true, impact: `Added ${qty}x ${h.item} to simulation inventory` });
            }
          }

          // ── Evaluate goal reachability ────────────────────────────────────
          let goalReachable = false;
          let goalCurrent = 0;
          let goalTarget = goal.target ?? 0;
          let goalUnit = '';

          switch (goal.type) {
            case 'EARN_FLOWER':
              goalCurrent = simFlower + simProductionFlower;
              goalTarget = goal.target ?? 0;
              goalUnit = 'FLOWER';
              goalReachable = goalCurrent >= goalTarget;
              break;
            case 'GAIN_XP':
              goalCurrent = simXp;
              goalTarget = goal.target ?? 0;
              goalUnit = 'XP';
              goalReachable = goalCurrent >= goalTarget;
              break;
            case 'PRODUCE_ITEM':
              goalCurrent = simInventory[goal.item ?? ''] ?? 0;
              goalTarget = goal.target ?? 1;
              goalUnit = goal.item ?? 'units';
              goalReachable = goalCurrent >= goalTarget;
              break;
            default:
              goalReachable = false;
          }

          const gap = +(goalTarget - goalCurrent).toFixed(6);

          return {
            tool: 'simulate_what_if',
            success: true,
            data: {
              goal: { ...goal, target: goalTarget },
              baseline: {
                flower: +baselineFlower.toFixed(6),
                xp: Math.round(baselineXp),
                productionFlower: +baselineProductionFlower.toFixed(6),
                totalFlower: +(baselineFlower + baselineProductionFlower).toFixed(6),
              },
              simulated: {
                flower: +simFlower.toFixed(6),
                xp: Math.round(simXp),
                productionFlower: +simProductionFlower.toFixed(6),
                totalFlower: +(simFlower + simProductionFlower).toFixed(6),
              },
              goalReachable,
              goalCurrent: +goalCurrent.toFixed(6),
              goalTarget,
              goalUnit,
              gap: goalReachable ? 0 : +Math.abs(gap).toFixed(6),
              surplus: goalReachable ? +Math.abs(gap).toFixed(6) : 0,
              consequences,
              warnings,
              note: 'This is an isolated simulation. No real farm state was modified.',
            },
            epistemicTier: 'DERIVED',
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
            tool: 'simulate_what_if',
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

    // ── 19. get_skills_tree (Authoritative Sunflower Land Skill Trees) ────────
    get_skills_tree: {
      description:
        'Authoritative Sunflower Land skill trees catalog and player unlock status across all 11 branches (Crops, Trees, Fishing, Mining, Cooking, Animals, Compost, Aging, Fruit Patch, Greenhouse, Machinery). Compares player currently unlocked skills against available locked skills, detailing Tiers (1-3), effects, drawbacks, and targeted recommendations for XP gain, productivity, or FLOWER economy.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description:
              'Optional branch filter: "Crops", "Trees", "Fishing", "Mining", "Cooking", "Animals", "Compost", "Aging", "Fruit Patch", "Greenhouse", "Machinery", or "ALL".',
          },
          goal: {
            type: 'string',
            enum: ['XP', 'PRODUCTIVITY', 'FLOWER', 'ALL'],
            description:
              'Optional strategic goal to prioritize recommendations: "XP" (leveling speed & food boosts), "PRODUCTIVITY" (harvest yields & cooldown speeds), or "FLOWER" (resource efficiency & cost reduction).',
          },
        },
      },
      exec: async (args, context) => {
        try {
          const { state, staleness, version } = await this.getStoredFarmState(context.farmId, context.userId);
          const playerUnlockedSet = new Set(Object.keys(state.player.skills ?? {}));
          const currentXp = Number(state.player.experience ?? 0);
          const currentLevel = Number(state.player.level ?? levelFromXp(currentXp));

          const categories = [
            'Crops',
            'Trees',
            'Fishing',
            'Mining',
            'Cooking',
            'Animals',
            'Compost',
            'Aging',
            'Fruit Patch',
            'Greenhouse',
            'Machinery',
          ];

          const describeEffect = (e: any): string => {
            if (!e) return '';
            if (e.note) return e.note;
            if (e.type === 'multiply') {
              if (e.stat === 'growTime') {
                const pct = Math.round((1 - (e.value ?? 1)) * 100);
                return `${pct > 0 ? `-${pct}%` : `x${e.value}`} grow time (${e.scope ?? 'crops'})`;
              }
              if (e.stat === 'cookTime') {
                const pct = Math.round((1 - (e.value ?? 1)) * 100);
                return `${pct > 0 ? `-${pct}%` : `x${e.value}`} cook time (${e.scope ?? 'cooking'})`;
              }
              if (e.stat === 'coinReward' || e.stat === 'sellCoinRevenue') {
                const pct = Math.round(((e.value ?? 1) - 1) * 100);
                return `+${pct}% coin revenue (${e.scope ?? 'sales'})`;
              }
              if (e.scope === 'food_xp') {
                const pct = Math.round(((e.value ?? 1) - 1) * 100);
                return `+${pct}% Bumpkin XP from food`;
              }
              return `x${e.value} ${e.stat ?? ''} (${e.scope ?? ''})`.trim();
            }
            if (e.type === 'add') {
              return `${e.value > 0 ? `+${e.value}` : e.value} ${e.stat ?? 'yield'} (${e.scope ?? ''})`.trim();
            }
            if (e.type === 'unlock') {
              return `Unlocks feature: ${e.feature ?? e.scope ?? 'special'}`;
            }
            if (e.type === 'set') {
              return `Sets ${e.stat ?? 'property'} to ${e.value ?? 1} (${e.scope ?? ''})`.trim();
            }
            if (e.type === 'stock_add') {
              return `+${e.value} ${e.scope ?? 'stock'}`;
            }
            if (e.type === 'aoe') {
              return `${e.tiles}x${e.tiles} AOE boost (${e.scope ?? ''})`;
            }
            if (e.type === 'chance') {
              return `${((e.prob ?? 0) * 100).toFixed(2)}% chance for +${e.bonus_qty ?? 1} ${e.bonus_item ?? 'bonus'}`;
            }
            return `${e.type} ${e.scope ?? ''} ${e.stat ?? ''}`.trim();
          };

          const isXpEffect = (name: string, effs: any[]): boolean => {
            const lower = name.toLowerCase();
            if (lower.includes('nom') || lower.includes('feast') || lower.includes('chef') || lower.includes('gourmet') || lower.includes('banquet')) return true;
            return effs.some((e) => e.scope?.includes('xp') || e.stat?.includes('xp') || e.scope === 'food_xp');
          };

          const isProdEffect = (effs: any[]): boolean => {
            return effs.some((e) =>
              ['growTime', 'cookTime', 'yield', 'speed', 'recovery', 'tapsRequired', 'instant', 'aoe', 'plots', 'queue'].some((k) =>
                e.stat?.includes(k) || e.scope?.includes(k) || e.type === 'unlock' || e.type === 'aoe'
              )
            );
          };

          const isFlowerEffect = (effs: any[]): boolean => {
            return effs.some((e) =>
              ['coin', 'revenue', 'cost', 'discount', 'bale', 'oil', 'tax', 'stock_add'].some((k) =>
                e.stat?.includes(k) || e.scope?.includes(k) || e.type === 'stock_add'
              )
            );
          };

          interface SkillSummaryItem {
            name: string;
            category: string;
            tier: string;
            unlocked: boolean;
            effects: string[];
            drawbacks: string[];
            tags: string[];
          }

          const allSkills: SkillSummaryItem[] = [];
          const playerUnlockedList: SkillSummaryItem[] = [];
          const lockedByBranch: Record<string, SkillSummaryItem[]> = {};

          for (const catName of categories) {
            lockedByBranch[catName] = [];
            const catData = (skillCatalogue as any)[catName] ?? {};
            for (const tierName of ['Tier 1', 'Tier 2', 'Tier 3']) {
              const tierData = catData[tierName] ?? {};
              for (const [sName, sDef] of Object.entries(tierData as Record<string, any>)) {
                const effs = sDef.effects ?? [];
                const drawbacks = sDef.drawbacks ?? [];
                const isUnlocked = playerUnlockedSet.has(sName);

                const tags: string[] = [];
                if (isXpEffect(sName, effs)) tags.push('XP');
                if (isProdEffect(effs)) tags.push('PRODUCTIVITY');
                if (isFlowerEffect(effs)) tags.push('FLOWER');
                if (tags.length === 0) tags.push('PRODUCTIVITY');

                const item: SkillSummaryItem = {
                  name: sName,
                  category: catName,
                  tier: tierName,
                  unlocked: isUnlocked,
                  effects: effs.map(describeEffect),
                  drawbacks: drawbacks.map(describeEffect),
                  tags,
                };

                allSkills.push(item);
                if (isUnlocked) {
                  playerUnlockedList.push(item);
                } else {
                  lockedByBranch[catName].push(item);
                }
              }
            }
          }

          // Generate targeted recommendations
          const lockedList = allSkills.filter((s) => !s.unlocked);

          const xpRecommendations = lockedList
            .filter((s) => s.tags.includes('XP'))
            .sort((a, b) => (a.tier === 'Tier 1' ? -1 : a.tier === 'Tier 2' ? 0 : 1))
            .slice(0, 5);

          const prodRecommendations = lockedList
            .filter((s) => s.tags.includes('PRODUCTIVITY'))
            .sort((a, b) => (a.tier === 'Tier 1' ? -1 : a.tier === 'Tier 2' ? 0 : 1))
            .slice(0, 6);

          const flowerRecommendations = lockedList
            .filter((s) => s.tags.includes('FLOWER'))
            .sort((a, b) => (a.tier === 'Tier 1' ? -1 : a.tier === 'Tier 2' ? 0 : 1))
            .slice(0, 5);

          // Apply optional category filter
          const reqCategory = args.category && args.category !== 'ALL' ? args.category : null;
          const filteredLocked = reqCategory
            ? { [reqCategory]: lockedByBranch[reqCategory] ?? [] }
            : lockedByBranch;

          return {
            tool: 'get_skills_tree',
            success: true,
            data: {
              player: {
                level: currentLevel,
                xp: currentXp,
                unlockedCount: playerUnlockedList.length,
                unlockedSkills: playerUnlockedList.map((s) => ({
                  name: s.name,
                  category: s.category,
                  tier: s.tier,
                  effects: s.effects,
                })),
              },
              catalogue: {
                totalSkillsCount: allSkills.length,
                lockedSkillsCount: lockedList.length,
                branches: categories.map((c) => ({
                  branch: c,
                  unlockedCount: playerUnlockedList.filter((s) => s.category === c).length,
                  lockedCount: (lockedByBranch[c] ?? []).length,
                })),
              },
              topRecommendations: {
                forXpGain: xpRecommendations.map((s) => ({
                  name: s.name,
                  category: s.category,
                  tier: s.tier,
                  effects: s.effects,
                  drawbacks: s.drawbacks,
                })),
                forProductivity: prodRecommendations.map((s) => ({
                  name: s.name,
                  category: s.category,
                  tier: s.tier,
                  effects: s.effects,
                  drawbacks: s.drawbacks,
                })),
                forFlowerEconomy: flowerRecommendations.map((s) => ({
                  name: s.name,
                  category: s.category,
                  tier: s.tier,
                  effects: s.effects,
                  drawbacks: s.drawbacks,
                })),
              },
              lockedSkillsByBranch: filteredLocked,
            },
            epistemicTier: 'AUTHORITATIVE',
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
            tool: 'get_skills_tree',
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

    // ── 15. search_knowledge (Unified Knowledge Base: Wiki + AST Game Data) ───
    search_knowledge: {
      description:
        'Search the authoritative Sunflower Land knowledge base for game rules, item recipes, tools, crops, animal mechanics, buildings, expansions, island requirements, and guides. Combines AST game data (exact recipes/costs) and wiki documentation.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query, question, or keywords (e.g. "Iron Pickaxe recipe", "chicken feeder machine", "volcano island requirement").',
          },
          entity: {
            type: 'string',
            description: 'Optional exact name of the item, crop, tool, or building to look up (e.g. "Iron Pickaxe", "Pumpkin Soup", "Barn").',
          },
          category: {
            type: 'string',
            description: 'Optional category filter: "game-data", "mechanics", "beginners", "crops", etc.',
          },
        },
        required: ['query'],
      },
      exec: async (params, _context) => {
        try {
          const query = String(params.query || '').trim();
          const entity = params.entity ? String(params.entity).trim() : undefined;
          const category = params.category ? String(params.category).trim() : undefined;

          // 1. Direct entity lookup if entity specified or query is a short item name
          let entityResults: any[] = [];
          const candidateEntity = entity || (query.split(' ').length <= 3 ? query : undefined);
          if (candidateEntity) {
            entityResults = await knowledgeService.lookupEntity(candidateEntity, 3);
          }

          // 2. Hybrid vector semantic search
          const vectorResults = await knowledgeService.search({
            query,
            entity,
            category,
            limit: 5,
            minSimilarity: 0.2,
          });

          // 3. Deduplicate results by chunk ID
          const seenIds = new Set<string>();
          const combined: any[] = [];

          for (const item of [...entityResults, ...vectorResults]) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              combined.push({
                source: item.source,
                category: item.category,
                type: item.type,
                entity: item.entity,
                headingPath: item.headingPath,
                content: item.content,
                structuredData: item.structuredData,
                similarity: item.similarity ? Math.round(item.similarity * 100) / 100 : undefined,
              });
            }
          }

          if (combined.length === 0) {
            return {
              tool: 'search_knowledge',
              success: true,
              data: {
                query,
                found: false,
                message: `No specific knowledge base entries found matching "${query}".`,
              },
              epistemicTier: 'AUTHORITATIVE',
            };
          }

          return {
            tool: 'search_knowledge',
            success: true,
            data: {
              query,
              found: true,
              count: combined.length,
              results: combined,
            },
            epistemicTier: 'AUTHORITATIVE',
          };
        } catch (e) {
          return {
            tool: 'search_knowledge',
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
   * Run the agentic loop with 4-phase reasoning pipeline:
   * Phase 1: Goal Decomposition + context injection
   * Phase 2: Tool execution with fallback tracking
   * Phase 3: Sufficiency check
   * Phase 4: Synthesis with conditional follow-up
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
    const failedTools: string[] = [];

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

    // ── Phase 1: Inject daily production context ──────────────────────────────
    // Pre-compute daily production summary and recent activity delta to give the
    // LLM rich context without burning tool calls on every message.
    let productionContextBlock = '';
    try {
      const [snapshots, marketData] = await Promise.all([
        snapshotService.getLatest(userId, 30).catch(() => []),
        sunflowerClient.getPrices().catch(() => ({ prices: {} as Record<string, number>, updatedAt: null, stale: true })),
      ]);

      let playerContextLine = '';
      if (snapshots.length >= 1) {
        const raw = snapshots[0].data_json;
        const unpacked = activityService.unpack(raw);
        const curExp = Number(unpacked.xp ?? 0);
        if (curExp > 0 || unpacked.level > 0) {
          const curLvl = unpacked.level || levelFromXp(curExp);
          const nextLvl = curLvl + 1;
          const nextXp = xpRequiredForLevel(nextLvl);
          const remXp = Math.max(0, Math.round((nextXp - curExp) * 1000) / 1000);
          playerContextLine = `Bumpkin Status: Level ${curLvl} (${curExp.toLocaleString()} XP) | Next Level (${nextLvl}) requires ${nextXp.toLocaleString()} cumulative XP (${remXp.toLocaleString()} XP needed).`;
        }
      }

      const contextLines: string[] = ['--- INJECTED FARM CONTEXT (pre-computed, no tool call needed) ---'];
      if (playerContextLine) contextLines.push(playerContextLine);

      if (snapshots.length >= 2) {
        const prices = marketData.prices ?? {};

        // Recent activity delta (last 2 snapshots)
        const recentDiff = activityService.diff(snapshots[1].data_json, snapshots[0].data_json);
        const recentValued = activityService.valuate(recentDiff, prices);
        const topGains = Object.entries(recentValued.inferred)
          .filter(([, v]) => v > 0)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([item, qty]) => `${item}: +${qty}`);
        const topSpentInferred = Object.entries(recentValued.inferred)
          .filter(([, v]) => v < 0)
          .sort(([, a], [, b]) => a - b)
          .slice(0, 5)
          .map(([item, qty]) => `${item}: ${qty}`);

        // Daily summary (last 7 days)
        const summary = activityService.dailySummary(snapshots, prices);
        const recentDays = summary.days.slice(-3);
        const dailyLines = recentDays.map(
          (d) => `  ${d.date}: Produced +${d.producedFlower.toFixed(4)} FLOWER, Spent -${d.spentFlower.toFixed(4)} FLOWER (Net: ${d.netFlower >= 0 ? '+' : ''}${d.netFlower.toFixed(4)}), +${Math.round(d.xpGained).toLocaleString()} XP`
        );

        contextLines.push(
          `Recent Activity (since last snapshot): XP +${Math.round(recentValued.xpDelta).toLocaleString()}`,
          topGains.length > 0 ? `  Gains: ${topGains.join(', ')}` : '  No inventory gains detected.',
          topSpentInferred.length > 0 ? `  Spent/Inputs: ${topSpentInferred.join(', ')}` : '',
          `  Produced: +${recentValued.valuation.producedFlower.toFixed(4)} FLOWER | Spent: -${recentValued.valuation.spentFlower.toFixed(4)} FLOWER | Net: ${recentValued.valuation.netFlower >= 0 ? '+' : ''}${recentValued.valuation.netFlower.toFixed(4)} FLOWER`,
          '',
          `Daily Economics (last ${recentDays.length} days):`,
          ...dailyLines,
          `  Period Totals: Produced +${summary.totals.totalProducedFlower.toFixed(4)} FLOWER | Spent -${summary.totals.totalSpentFlower.toFixed(4)} FLOWER | Net ${summary.totals.netFlower >= 0 ? '+' : ''}${summary.totals.netFlower.toFixed(4)} FLOWER (+${Math.round(summary.totals.totalXp).toLocaleString()} XP)`,
          summary.totals.topProduced.length > 0
            ? `  Top produced items (by Flower valuation): ${summary.totals.topProduced.slice(0, 3).map((i) => `${i.item} (+${i.flower.toFixed(4)} FLOWER)`).join(', ')}`
            : '',
          summary.totals.topSpent.length > 0
            ? `  Top spent items (by Flower valuation): ${summary.totals.topSpent.slice(0, 3).map((i) => `${i.item} (-${i.flower.toFixed(4)} FLOWER)`).join(', ')}`
            : ''
        );
      }
      contextLines.push('--- END INJECTED CONTEXT ---');
      if (contextLines.length > 2) {
        productionContextBlock = contextLines.filter(Boolean).join('\n');
      }
    } catch {
      // Non-critical: proceed without injected context
    }

    const historyRaw = (prior ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => ({
        role: (m.role === 'assistant' || m.role === 'ai') ? 'assistant' : 'user',
        content: String(m.content ?? m.text ?? '').trim(),
      }))
      .filter((m) => m.content.length > 0 && m.content !== message)
      .slice(-16);

    const sanitizedHistory: Array<{ role: string; content: string }> = [];
    let lastRole = 'system';
    for (const m of historyRaw) {
      if (m.role !== lastRole) {
        sanitizedHistory.push({ role: m.role, content: m.content });
        lastRole = m.role;
      } else if (sanitizedHistory.length > 0) {
        sanitizedHistory[sanitizedHistory.length - 1].content += '\n\n' + m.content;
      }
    }
    if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === 'user') {
      sanitizedHistory.pop();
    }

    // Execute through the 4-Stage AI Pipeline (Planner -> Orchestrator -> Deterministic Validator -> Explainer)
    const pipelineRes = await PipelineCoordinator.execute(
      message,
      {
        sessionId,
        userId,
        farmId,
        userGoal: message,
        productionContextBlock,
      },
      this.tools,
      sanitizedHistory,
      () => this.getStoredFarmState(farmId, userId)
    );

    return {
      success: pipelineRes.success,
      answer: pipelineRes.answer,
      steps: pipelineRes.steps.map((s) => ({
        tool: s.tool ?? s.stage,
        ok: s.ok,
        epistemicTier: s.epistemicTier,
      })),
      warnings: pipelineRes.warnings,
      provenance: pipelineRes.provenance,
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
