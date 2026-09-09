/**
 * Orchestrator — Goal-oriented AI orchestrator: PLAN -> ACT (tools) -> CHECK -> FIX loop.
 * Class-based TypeScript service composing modular services.
 */
import { sunflowerClient } from '../farm/index.js';
import { plannerService, recipeService, xpEngine } from '../cooking/index.js';
import { snapshotService, activityService } from '../farm/index.js';
import { chatStoreService } from '../chat/index.js';
import { ChatMessage } from '../../models/index.js';

import recipes from '../../data/recipes.json' with { type: 'json' };
import items from '../../data/items.json' with { type: 'json' };
import modifiers from '../../data/modifiers.json' with { type: 'json' };
import expansion from '../../data/expansion .json' with { type: 'json' };
import skillCatalogue from '../../data/skills.json' with { type: 'json' };

const SYSTEM = `You are the Sunflower Land farm orchestrator. You are GOAL-ORIENTED:
1. PLAN: break the user's goal into steps and decide which tools you need.
2. ACT: call tools to gather live data (never guess prices, inventory, XP — fetch them).
3. CHECK: verify the result answers the goal; if numbers are missing or inconsistent, call more tools or recompute.
4. ANSWER: concise markdown; small tables (max 4 cols) for comparisons; **bold** key numbers; bullet action steps.
Rules: tool outputs are the source of truth. Never invent prices, recipes, XP values or mechanics.
Maintain conversation continuity. User messages are often follow-ups, adjustments, or questions about the topic just discussed (e.g., 'what about with VIP?', 'and how many eggs do I need?', 'what if I cook 5 batches?'). ALWAYS resolve references against the conversation history in this session rather than treating the message in isolation. DO NOT call recall_memory for follow-ups within the current session — recall_memory is only for searching old archived sessions.
VIP Membership grants an active +10% multiplicative bumpkin XP boost on all consumables (all cooking buildings + fish). Both compute_recipe_cost and get_farm_state account for live VIP status and skills (like Munching Mastery, Double Nom).
When quoting or calculating milestone totals (e.g., total batches or FLOWER to reach Level 100), ALWAYS use the exact pre-computed fields returned by get_planner: estimate.totalMilestoneFlower (or building.totalMilestoneFlower). NEVER perform mental multiplication or guess numbers. NEVER confuse today's 1-batch out-of-pocket cost (flowerToBuy / dailyCost, e.g. ~1.81 FLOWER) with the cumulative milestone total (e.g. 419 batches × 4.31144 FLOWER = 1,806.49 FLOWER total). Always write out the full number (e.g., **1,806.49 FLOWER**), never drop thousand multipliers or write 1.81 instead of 1,806.49.
get_farm_state returns the COMPLETE inventory — an item missing from it means quantity 0, but never claim the inventory is empty if the tool returned items. For anything not covered by a tool (greenhouse, calendar, NPCs, animals, trades, stock, faction, fishing...), call get_farm_section with the right path instead of guessing.
If an item has no market price, say "must farm/produce" — do not estimate. Distinguish observed/inferred/estimated.
For ANY question about land expansion, plot unlocks, island progression, prestige, node counts, or expansion affordability — call get_expansion_guide. It AUTO-DETECTS the player's current island and expansion progress (e.g. Desert Island at Plot 13).
CRITICAL — ISLAND PROGRESSION & JOURNEY TO FUTURE ISLANDS:
- When the player asks how to reach, unlock, or activate a future island (e.g. 'how to activate volcano land', 'cost to reach volcano island'):
  - In Sunflower Land, you CANNOT skip directly to a new island. The player MUST complete ALL remaining plot expansions on their current island first (e.g. Desert Island Plots 14 through 25), pay the moving fee (e.g. 200 Oil), and then unlock the first plot on the target island (e.g. Volcano Island Plot 6 at Bumpkin Level 70).
  - ALWAYS call get_expansion_guide with target_island: "Volcano Island" (or the requested island name).
  - ALL expansion costs are denominated in FLOWER (the in-game market currency), NOT USD! Always state costs in FLOWER (e.g. 1,098.56 FLOWER), NEVER USD ($). ALWAYS quote the exact pre-computed figures from the tool's journey_to_target_island object:
    1. Current island remaining: EXACTLY journey_to_target_island.remaining_plots_count plots (Plots 14 through 25) totaling ~journey_to_target_island.current_island_remaining_cost_flower FLOWER (~1,090.87 FLOWER).
    2. Moving fee: EXACTLY the moving fee from journey_to_target_island.moving_costs (e.g. 200 Oil).
    3. Target island activation: Initial plot on target island (Plot 6 requiring Level 70, 7.69 FLOWER). Do NOT include subsequent plots (Plots 7, 8) as part of activating the island — those are future expansions after activation.
    4. Grand total: EXACTLY journey_to_target_island.grand_total_cost_flower (~1,098.56 FLOWER) and grand_total_resources_needed (76,800 coins, 5,825 wood, 2,125 stone, 395 iron, 305 gold, 489 crimstone, 3,650 oil, 765 gem).
    5. Inventory comparison: quote journey_to_target_island.inventory_comparison for exact current vs needed vs shortfall.
    6. Bumpkin level requirements: current level 61, needs level 70 (+9 levels needed).
  - NEVER show only the target island's first plot (e.g. Volcano Plot 6) in isolation when the user asks about activating or reaching it from their current state!`;

function resolveIslandName(input?: string | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  for (const isl of (expansion as { islands: Array<{ name: string }> }).islands) {
    if (isl.name.toLowerCase() === s) return isl.name;
  }
  if (s.includes('volcano')) return 'Volcano Island';
  if (s.includes('desert')) return 'Desert Island';
  if (s.includes('spring') || s.includes('petal')) return 'Petal Paradise';
  if (s.includes('basic')) return 'Basic Island';
  return null;
}

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
  exec: (params: any, context: ToolContext) => Promise<any>;
}

export class Orchestrator {
  public readonly tools: Record<string, ToolDef> = {
    get_farm_state: {
      description: 'Fresh canonical farm state: level, xp, FLOWER, coins, buildings, skills, and the COMPLETE inventory (every item and quantity).',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        const { canonical: c, stale } = await sunflowerClient.getFarm(context.farmId);
        return {
          stale,
          level: c.bumpkin.level,
          xp: c.bumpkin.xp,
          flower: c.currencies.flower,
          coins: c.currencies.coins,
          buildings: Object.keys(c.buildings),
          skills: Object.keys(c.skills),
          vip: c.buffs.vip,
          inventory: c.inventory,
        };
      },
    },
    get_farm_section: {
      description: "Read ANY section of the raw farm JSON by dot-path. Top-level keys include: inventory, previousInventory, greenhouse, calendar, crops, fruitPatches, flowers, beehives, henHouse, barn, trades, stock, npcs, delivery, choreBoard, bounties, farmActivity, buildings, collectibles, bumpkin (skills/equipped/achievements), wardrobe, vip, island, fishing, desert, faction, saltFarm, oilReserves, sunstones, crimstones, minigames, dailyRewards, floatingIsland, socialFarming. Example paths: 'greenhouse', 'npcs.betty', 'bumpkin.skills', 'calendar.dates'.",
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'dot-path into the farm object' } }, required: ['path'] },
      exec: async ({ path }: { path: string }, context) => {
        const { raw } = await sunflowerClient.getFarm(context.farmId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const farm = (raw as any).farm ?? raw;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const val = path.split('.').reduce((o: any, k: string) => (o == null ? undefined : o[k]), farm);
        if (val === undefined) {
          return { error: `No data at '${path}'. Top-level keys: ${Object.keys(farm).join(', ')}` };
        }
        return { path, data: val };
      },
    },
    get_market_prices: {
      description: 'Live P2P market prices (FLOWER per unit) for all tradable base resources.',
      parameters: { type: 'object', properties: {} },
      exec: async () => {
        const { prices, updatedAt } = await sunflowerClient.getPrices();
        return { updatedAt, prices };
      },
    },
    compute_recipe_cost: {
      description: 'Deterministic recipe economics: effective XP/output, base-resource expansion, live-market cost after inventory offset.',
      parameters: { type: 'object', properties: { recipe: { type: 'string', description: "recipe name, e.g. 'Pizza Margherita'" } }, required: ['recipe'] },
      exec: async ({ recipe }: { recipe: string }, context) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = (recipes as Record<string, any>)[recipe];
        if (!r) {
          return { error: `Unknown recipe. Known: ${Object.keys(recipes).filter((k) => !k.startsWith('_')).join(', ')}` };
        }
        const [{ canonical }, { prices }] = await Promise.all([
          sunflowerClient.getFarm(context.farmId),
          sunflowerClient.getPrices(),
        ]);
        const eff = xpEngine.effective(recipe, r, canonical, modifiers);
        const dep = recipeService.expand(recipe, recipes as unknown as Parameters<typeof recipeService.expand>[1], 0, eff.ingredientMultiplier ?? 1);
        const c = recipeService.cost(dep.base, prices, items as Parameters<typeof recipeService.cost>[2], canonical.inventory);
        return { recipe, verified: !!r.verified, effective: eff, baseResources: dep.base, cost: c, totalMinutes: eff.minutes + dep.intermediateMinutes };
      },
    },
    get_cooking_board: {
      description: 'Lists ALL recipes for the player active buildings, each annotated with canCook and missingIngredients. Returns recipes grouped by building.',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        const { canonical: c } = await sunflowerClient.getFarm(context.farmId);
        const activeBuildings = Object.keys(c.buildings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listed = recipeService.listRecipes(recipes as any, activeBuildings, c.inventory);
        const byBuilding: Record<string, { canCook: typeof listed; missing: typeof listed }> = {};
        for (const r of listed) {
          if (!byBuilding[r.building]) byBuilding[r.building] = { canCook: [], missing: [] };
          if (r.canCook) byBuilding[r.building].canCook.push(r);
          else byBuilding[r.building].missing.push(r);
        }
        return { activeBuildings, byBuilding, totalRecipes: listed.length };
      },
    },
    get_planner: {
      description: 'Run the deterministic per-building planner: best recipe per building, affordability, Level-100 estimate.',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        const [{ canonical }, { prices }] = await Promise.all([
          sunflowerClient.getFarm(context.farmId),
          sunflowerClient.getPrices(),
        ]);
        return plannerService.plan(canonical, prices, recipes as Parameters<typeof plannerService.plan>[2], items as Parameters<typeof plannerService.plan>[3], modifiers);
      },
    },
    take_snapshot: {
      description: 'Save a snapshot of the current farm state now (for later activity comparison).',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        const { canonical } = await sunflowerClient.getFarm(context.farmId);
        return await snapshotService.save(canonical, context.userId);
      },
    },
    get_activity_delta: {
      description: 'Observed farmActivity deltas + inventory movement + XP gained between the last two snapshots.',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        const snaps = await snapshotService.latest(2, context.userId);
        if (snaps.length < 2) return { note: 'Need at least 2 snapshots — call take_snapshot now and again later.' };
        return activityService.diffActivity(snaps[1], snaps[0]);
      },
    },
    get_quests: {
      description: 'Current chore board, delivery orders and bounties: NPC, requested items, rewards, completion status.',
      parameters: { type: 'object', properties: {} },
      exec: async (_params, context) => {
        const { canonical: c } = await sunflowerClient.getFarm(context.farmId);
        const chores = (c.chores ?? {}) as Record<string, { name?: string; reward?: unknown; completedAt?: unknown }>;
        const deliveries = c.deliveries ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bountiesRequests: any[] = c.bounties?.requests ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bountiesCompleted: any[] = c.bounties?.completed ?? [];
        return {
          chores: Object.fromEntries(Object.entries(chores).map(([npc, ch]) => [npc, { task: ch?.name, reward: ch?.reward, done: !!ch?.completedAt }])),
          deliveries: deliveries.map((d) => ({ from: d.from, items: d.items, reward: d.reward, done: !!d.completedAt })),
          bounties: bountiesRequests.slice(0, 40).map((b) => ({
            name: b.name,
            level: b.level,
            coins: b.coins,
            items: b.items,
            claimed: bountiesCompleted.some((x) => x.id === b.id),
          })),
        };
      },
    },
    get_skill_info: {
      description: 'Look up machine-readable effect definitions for any skill or skill group from the full catalogue.',
      parameters: {
        type: 'object',
        properties: {
          group: { type: 'string', description: "Skill group name, e.g. 'Cooking', 'Crops', 'Mining'." },
          skill: { type: 'string', description: "Specific skill name to look up, e.g. 'Fast Feasts'." },
          active_only: { type: 'boolean', description: 'If true, only return skills where selected_land22 is true.' },
        },
      },
      exec: async ({ group, skill, active_only = false }: { group?: string; skill?: string; active_only?: boolean }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const catalogue = skillCatalogue as Record<string, any>;
        const groups = group
          ? { [group]: catalogue[group] }
          : Object.fromEntries(Object.entries(catalogue).filter(([k]) => !k.startsWith('_')));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: Record<string, any> = {};
        for (const [gName, tiers] of Object.entries(groups)) {
          if (!tiers || typeof tiers !== 'object') continue;
          result[gName] = {};
          for (const [tier, skills] of Object.entries(tiers as Record<string, Record<string, { selected_land22?: boolean }>>)) {
            result[gName][tier] = {};
            for (const [sName, sData] of Object.entries(skills)) {
              if (skill && sName.toLowerCase() !== skill.toLowerCase()) continue;
              if (active_only && !sData.selected_land22) continue;
              result[gName][tier][sName] = sData;
            }
            if (!Object.keys(result[gName][tier]).length) delete result[gName][tier];
          }
          if (!Object.keys(result[gName]).length) delete result[gName];
        }
        return { note: 'selected_land22 is a snapshot — always verify against live farm.skills from get_farm_state', skills: result };
      },
    },
    recall_memory: {
      description: 'Semantic search over past conversations from previous sessions (pgvector).',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      exec: async ({ query }: { query: string }, context) => ({
        matches: await chatStoreService.similar(query, context.sessionId || '', context.userId, 5),
      }),
    },
    get_expansion_guide: {
      description: 'Land expansion roadmap and progression guide. AUTO-DETECTS current island and expansion progress.',
      parameters: {
        type: 'object',
        properties: {
          island: { type: 'string', description: "Specific island to view, e.g. 'Volcano Island', 'Desert Island'." },
          target_island: { type: 'string', description: 'Destination island to calculate the full journey to.' },
          next_n: { type: 'number', description: 'How many upcoming expansion rows to return (default 5).' },
          show_all_islands: { type: 'boolean', description: 'If true, return data for ALL islands. Default false.' },
        },
      },
      exec: async ({ island, target_island, next_n = 5, show_all_islands = false }: { island?: string; target_island?: string; next_n?: number; show_all_islands?: boolean }, context) => {
        const { canonical: c, raw } = await sunflowerClient.getFarm(context.farmId);
        const inv = c.inventory;
        const bumpkinLevel = c.bumpkin.level;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const farm = (raw as any).farm ?? raw;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exp = expansion as any;

        const islandType = farm.island?.type;
        const TYPE_MAP: Record<string, string> = { basic: 'Basic Island', spring: 'Petal Paradise', desert: 'Desert Island', volcano: 'Volcano Island' };
        const detectedIsland = TYPE_MAP[islandType] ?? 'Desert Island';

        const nodeCounts: Record<string, number> = {
          'Crop Plot': Object.keys(farm.crops ?? {}).length,
          'Tree': Object.keys(farm.trees ?? {}).length,
          'Stone Rock': Object.keys(farm.stones ?? {}).length,
          'Iron Rock': Object.keys(farm.iron ?? {}).length,
          'Gold Rock': Object.keys(farm.gold ?? {}).length,
          'Fruit Patch': Object.keys(farm.fruitPatches ?? {}).length,
          'Crimstone Rock': Object.keys(farm.crimstones ?? {}).length,
          'Sunstone Rock': Object.keys(farm.sunstones ?? {}).length,
          'Oil Reserve': Object.keys(farm.oilReserves ?? {}).length,
          'Beehive': Object.keys(farm.beehives ?? {}).length,
          'Flower Bed': Object.keys(farm.flowers?.flowerBeds ?? {}).length,
        };

        const progressPerIsland: Record<string, number> = {};
        for (const isl of exp.islands) {
          let lastPlot = isl.rows[0].unlock_land_plot - 1;
          for (const row of isl.rows) {
            if (row.nodes.length === 0) continue;
            const done = row.nodes.every((n: { type: string; total_after: number }) => (nodeCounts[n.type] ?? 0) >= n.total_after);
            if (done) lastPlot = row.unlock_land_plot;
            else break;
          }
          progressPerIsland[isl.name] = lastPlot;
        }

        const have = (res: string) => {
          if (res === 'coins') return c.currencies.coins;
          if (inv[res] != null) return Number(inv[res]);
          const cap = res.charAt(0).toUpperCase() + res.slice(1);
          if (inv[cap] != null) return Number(inv[cap]);
          return 0;
        };

        const resolvedTarget = resolveIslandName(target_island);
        const resolvedIsland = resolveIslandName(island);
        let destinationCandidate = resolvedTarget ?? (resolvedIsland && resolvedIsland !== detectedIsland ? resolvedIsland : null);

        if (!destinationCandidate && context?.userGoal) {
          const goalIsland = resolveIslandName(context.userGoal);
          if (goalIsland && goalIsland !== detectedIsland) {
            destinationCandidate = goalIsland;
          }
        }

        const currentIslandIdx = exp.islands.findIndex((i: { name: string }) => i.name === detectedIsland);
        const destIslandIdx = destinationCandidate
          ? exp.islands.findIndex((i: { name: string }) => i.name === destinationCandidate)
          : -1;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let journeyToTarget: any = null;
        if (destIslandIdx > currentIslandIdx && currentIslandIdx >= 0) {
          const destIslandObj = exp.islands[destIslandIdx];
          const currentIslandObj = exp.islands[currentIslandIdx];
          const currentPlot = progressPerIsland[detectedIsland];

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const remainingCurrentPlots = currentIslandObj.rows.filter((r: any) => r.unlock_land_plot > currentPlot);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const movingSteps: any[] = [];
          for (let idx = currentIslandIdx; idx < destIslandIdx; idx++) {
            const moveCost = exp.islands[idx].moving_cost_to_next;
            if (moveCost) movingSteps.push(moveCost);
          }

          const firstDestPlot = destIslandObj.rows[0];
          const totalResources: Record<string, number> = {};
          let totalCostFlower = 0;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const row of remainingCurrentPlots as any[]) {
            totalCostFlower += row.p2p_cost_usd ?? 0;
            for (const [res, qty] of Object.entries((row.resources ?? {}) as Record<string, number>)) {
              totalResources[res] = (totalResources[res] ?? 0) + qty;
            }
          }

          for (let idx = currentIslandIdx + 1; idx < destIslandIdx; idx++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const row of exp.islands[idx].rows as any[]) {
              totalCostFlower += row.p2p_cost_usd ?? 0;
              for (const [res, qty] of Object.entries((row.resources ?? {}) as Record<string, number>)) {
                totalResources[res] = (totalResources[res] ?? 0) + qty;
              }
            }
          }

          for (const move of movingSteps) {
            if (move && move.resource && move.amount) {
              totalResources[move.resource] = (totalResources[move.resource] ?? 0) + move.amount;
            }
          }

          if (firstDestPlot) {
            totalCostFlower += firstDestPlot.p2p_cost_usd ?? 0;
            for (const [res, qty] of Object.entries((firstDestPlot.resources ?? {}) as Record<string, number>)) {
              totalResources[res] = (totalResources[res] ?? 0) + qty;
            }
          }

          const inventoryComparison: Record<string, { need: number; have: number; short: number }> = {};
          for (const [res, need] of Object.entries(totalResources)) {
            const owned = have(res);
            inventoryComparison[res] = {
              need,
              have: +owned.toFixed(2),
              short: Math.max(0, +(need - owned).toFixed(2)),
            };
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const currentIslandRemainingFlower = +(remainingCurrentPlots.reduce((s: number, r: any) => s + (r.p2p_cost_usd ?? 0), 0)).toFixed(2);
          const targetPlotFlower = firstDestPlot?.p2p_cost_usd ?? 0;

          journeyToTarget = {
            from_island: detectedIsland,
            to_island: destIslandObj.name,
            current_plot: currentPlot,
            remaining_plots_count: remainingCurrentPlots.length,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            remaining_plots_list: remainingCurrentPlots.map((r: any) => ({
              plot: r.unlock_land_plot,
              level: r.bumpkin_level,
              resources: r.resources,
              cost_flower: r.p2p_cost_usd,
            })),
            current_island_remaining_cost_flower: currentIslandRemainingFlower,
            moving_costs: movingSteps,
            target_island_initial_plot: {
              plot: firstDestPlot?.unlock_land_plot,
              level_required: firstDestPlot?.bumpkin_level,
              resources: firstDestPlot?.resources,
              cost_flower: targetPlotFlower,
            },
            target_level_required: firstDestPlot?.bumpkin_level,
            current_level: bumpkinLevel,
            levels_needed: Math.max(0, (firstDestPlot?.bumpkin_level ?? 0) - bumpkinLevel),
            grand_total_resources_needed: totalResources,
            inventory_comparison: inventoryComparison,
            grand_total_cost_flower: +totalCostFlower.toFixed(2),
            summary: `To reach and activate ${destIslandObj.name} from ${detectedIsland} (Plot ${currentPlot}): You must complete ${remainingCurrentPlots.length} remaining ${detectedIsland} plots (Plots ${remainingCurrentPlots.map((p: { unlock_land_plot: number }) => p.unlock_land_plot).join(', ')}, costing ~${currentIslandRemainingFlower} FLOWER) + pay moving fee (${movingSteps.map((m: { amount: number; resource: string }) => `${m.amount} ${m.resource}`).join(', ')}) + unlock first ${destIslandObj.name} plot (Plot ${firstDestPlot?.unlock_land_plot} requiring Level ${firstDestPlot?.bumpkin_level}, costing ${targetPlotFlower} FLOWER). Grand total: ~${totalCostFlower.toFixed(2)} FLOWER in resources.`,
          };
        }

        const targetIsland = destinationCandidate ? null : (resolvedIsland ?? (show_all_islands ? null : detectedIsland));
        const islandsToShow = targetIsland
          ? exp.islands.filter((i: { name: string }) => i.name.toLowerCase() === targetIsland.toLowerCase())
          : (destinationCandidate ? [exp.islands[currentIslandIdx], exp.islands[destIslandIdx]].filter(Boolean) : exp.islands);
        if (!islandsToShow.length) {
          return { error: `Unknown island '${island}'. Valid: ${exp.islands.map((i: { name: string }) => i.name).join(', ')}` };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any[] = [];
        for (const isl of islandsToShow) {
          const currentPlot = progressPerIsland[isl.name];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const upcoming: any[] = [];
          const upcomingLimit = (journeyToTarget && isl.name === journeyToTarget.to_island) ? 1 : next_n;
          for (const row of isl.rows) {
            if (upcoming.length >= upcomingLimit) break;
            if (row.unlock_land_plot <= currentPlot) continue;
            if (bumpkinLevel < row.bumpkin_level) {
              upcoming.push({
                unlock_land_plot: row.unlock_land_plot,
                bumpkin_level: row.bumpkin_level,
                time: row.time,
                resources: row.resources,
                nodes: row.nodes,
                p2p_cost_flower: row.p2p_cost_usd,
                affordable: false,
                missing: {},
                blocked: `Need bumpkin level ${row.bumpkin_level} (you are ${bumpkinLevel})`,
              });
              continue;
            }
            const missing: Record<string, { need: number; have: number; short: number }> = {};
            for (const [res, qty] of Object.entries((row.resources ?? {}) as Record<string, number>)) {
              const h = have(res);
              if (h < qty) missing[res] = { need: qty, have: +(h).toFixed(2), short: +(qty - h).toFixed(2) };
            }
            upcoming.push({
              unlock_land_plot: row.unlock_land_plot,
              bumpkin_level: row.bumpkin_level,
              time: row.time,
              resources: row.resources,
              nodes: row.nodes,
              p2p_cost_flower: row.p2p_cost_usd,
              affordable: Object.keys(missing).length === 0,
              missing,
            });
          }
          const completedRows = isl.rows.filter((r: { unlock_land_plot: number }) => r.unlock_land_plot <= currentPlot).length;
          result.push({
            island: isl.name,
            prestige: isl.prestige,
            biome: isl.biome ?? null,
            is_current_island: isl.name === detectedIsland,
            progress: `${completedRows}/${isl.rows.length} expansions done (at plot ${currentPlot})`,
            current_plot: currentPlot,
            max_nodes: isl.max_nodes,
            total_time: isl.total_time,
            total_cost_flower: isl.total_cost_usd,
            moving_cost_to_next: isl.moving_cost_to_next,
            next_expansions: upcoming,
          });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: Record<string, any> = {
          bumpkin_level: bumpkinLevel,
          detected_island: detectedIsland,
          live_node_counts: nodeCounts,
          pricing_notes: exp.pricing_notes,
        };

        if (journeyToTarget) {
          response.JOURNEY_ROADMAP_MANDATORY = `CRITICAL: The player is currently on ${detectedIsland} (at Plot ${journeyToTarget.current_plot}) and wants to reach ${journeyToTarget.to_island}. All expansion costs are denominated in FLOWER, NOT USD! You MUST present the complete journey to the user:
1. Remaining ${journeyToTarget.remaining_plots_count} plots on ${detectedIsland} (Plots ${journeyToTarget.remaining_plots_list.map((p: { plot: number }) => p.plot).join(', ')}) costing ~${journeyToTarget.current_island_remaining_cost_flower} FLOWER.
2. Moving fee to next island: ${journeyToTarget.moving_costs.map((m: { amount: number; resource: string }) => `${m.amount} ${m.resource}`).join(', ')}.
3. Initial plot unlock on ${journeyToTarget.to_island}: Plot ${journeyToTarget.target_island_initial_plot.plot} requiring Bumpkin Level ${journeyToTarget.target_island_initial_plot.level_required}, costing ${journeyToTarget.target_island_initial_plot.cost_flower} FLOWER.
4. GRAND TOTAL: ~${journeyToTarget.grand_total_cost_flower} FLOWER across all resources (${Object.entries(journeyToTarget.grand_total_resources_needed).map(([k, v]) => `${v} ${k}`).join(', ')}).
5. Compare against the player's live inventory (show what they have vs missing shortfalls).
6. Bumpkin level requirements (currently Level ${bumpkinLevel}, need Level ${journeyToTarget.target_level_required}, so +${journeyToTarget.levels_needed} levels needed).`;
          response.journey_to_target_island = journeyToTarget;
        }

        response.islands = result;
        return response;
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
      temperature: 0.3,
      max_completion_tokens: 4096,
    };
    if (/qwen|deepseek|r1/i.test(model)) body.reasoning_format = 'hidden';
    if (/gpt-oss/i.test(model)) body.reasoning_effort = 'low';

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
        console.warn('[groq] tool_use_failed — model emitted malformed tool-call JSON, will retry');
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
   * Run the agentic loop with goal, tools, reflection and recovery.
   */
  async runAgent(
    message: string,
    sessionId: string,
    userId: number,
    farmId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    history: any[] | null = null
  ): Promise<{ answer: string; steps: Array<{ tool: string; ok: boolean; cached?: boolean }> }> {
    const steps: Array<{ tool: string; ok: boolean; cached?: boolean }> = [];
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
    const MAX_ROUNDS = 8;
    let toolErrors = 0;

    const context: ToolContext = { sessionId, userId, farmId, userGoal: message };

    for (let i = 0; i < MAX_ROUNDS; i++) {
      const j = await this.groq(messages);

      if (j._toolError) {
        toolErrors++;
        console.log(`[agent] round ${i}: tool_use_failed (#${toolErrors})`);
        if (toolErrors >= 2) {
          messages.push({
            role: 'user',
            content: 'IMPORTANT: Your last two tool calls had malformed JSON and failed. STOP calling tools. Answer the question NOW using whatever data you already have. If you have no data yet, give your best general advice.',
          });
          const recovery = await this.groq(messages, 'none');
          const answer = this.textOf(recovery.choices?.[0]?.message) || '⚠️ I had trouble calling my tools. Please try rephrasing your question.';
          return { answer, steps };
        }
        messages.push({
          role: 'user',
          content: 'Your last tool call had invalid JSON arguments and was rejected. Try again — call the tool with correct JSON, or answer directly if you already have enough data.',
        });
        continue;
      }
      toolErrors = 0;

      const m = j.choices?.[0]?.message ?? {};
      console.log(`[agent] round ${i}: finish=${j.choices?.[0]?.finish_reason} tools=${m.tool_calls?.length ?? 0} contentLen=${(typeof m.content === 'string' ? m.content : '').length}`);
      messages.push({ role: 'assistant', content: typeof m.content === 'string' ? m.content : '', tool_calls: m.tool_calls });
      if (!m.tool_calls?.length) {
        const answer = this.textOf(m);
        if (answer) return { answer, steps };
        messages.push({
          role: 'user',
          content: 'Your last message was empty. Answer the question now using the tool results so far (or call a tool if you still need data).',
        });
        continue;
      }
      for (const tc of m.tool_calls) {
        const name = tc.function?.name;
        const key = `${name}:${tc.function?.arguments ?? ''}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let result: any;
        if (seen.has(key)) {
          result = { note: 'Duplicate call — identical result as before. Do NOT call this again; use the data you already have.', ...seen.get(key) };
          steps.push({ tool: name, ok: true, cached: true });
        } else {
          try {
            const tool = this.tools[name];
            if (!tool) {
              result = { error: `unknown tool ${name}` };
              steps.push({ tool: name, ok: false });
            } else {
              result = await tool.exec(this.safeParseArgs(tc.function.arguments), context);
              steps.push({ tool: name, ok: !result?.error });
            }
          } catch (e: unknown) {
            result = { error: String((e as Error)?.message ?? e) };
            steps.push({ tool: name, ok: false });
          }
          seen.set(key, result);
        }
        let payload = JSON.stringify(result);
        if (payload.length > 15000) payload = payload.slice(0, 15000) + '"...TRUNCATED (${payload.length} chars total) — request a narrower path/section"';
        messages.push({ role: 'tool', tool_call_id: tc.id, content: payload });
      }
    }

    messages.push({
      role: 'user',
      content: 'STOP gathering. Using ONLY the tool results above, give your best final answer now. State any remaining unknowns explicitly.',
    });
    const j = await this.groq(messages, 'none');
    console.log(`[agent] final: finish=${j.choices?.[0]?.finish_reason}`);
    const answer = this.textOf(j.choices?.[0]?.message) || '⚠️ Could not produce an answer — try a narrower question.';
    return { answer, steps };
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
