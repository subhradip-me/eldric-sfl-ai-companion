// Goal-oriented AI orchestrator: PLAN -> ACT (tools) -> CHECK -> FIX loop.
// The LLM decides which data it needs; tools are deterministic app code.
import { getFarm, getPrices } from "./sunflower.js";
import { plan } from "./planner.js";
import { diffActivity } from "./activity.js";
import { save, latest } from "./snapshots.js";
import { similar } from "./chatStore.js";
import { expand, cost, list_recipes } from "./recipes.js";
import { effective } from "./xpEngine.js";
import recipes from "../data/recipes.json" with { type: "json" };
import items from "../data/items.json" with { type: "json" };
import modifiers from "../data/modifiers.json" with { type: "json" };
import expansion from "../data/expansion .json" with { type: "json" };
import skillCatalogue from "../data/skills.json" with { type: "json" };

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

function resolveIslandName(input) {
  if (!input || typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  for (const isl of expansion.islands) {
    if (isl.name.toLowerCase() === s) return isl.name;
  }
  if (s.includes("volcano")) return "Volcano Island";
  if (s.includes("desert")) return "Desert Island";
  if (s.includes("spring") || s.includes("petal")) return "Petal Paradise";
  if (s.includes("basic")) return "Basic Island";
  return null;
}

export const TOOLS = {
  get_farm_state: {
    description: "Fresh canonical farm state: level, xp, FLOWER, coins, buildings, skills, and the COMPLETE inventory (every item and quantity).",
    parameters: { type: "object", properties: {} },
    exec: async (params, context) => {
      const { canonical: c, stale } = await getFarm(context.farmId);
      return {
        stale, level: c.bumpkin.level, xp: c.bumpkin.xp, flower: c.currencies.flower, coins: c.currencies.coins,
        buildings: Object.keys(c.buildings), skills: Object.keys(c.skills), vip: c.buffs.vip,
        inventory: c.inventory, // full inventory — never assume it is empty
      };
    },
  },
  get_farm_section: {
    description: "Read ANY section of the raw farm JSON by dot-path. Use when other tools don't cover it. Top-level keys include: inventory, previousInventory, greenhouse, calendar, crops, fruitPatches, flowers, beehives, henHouse, barn, trades, stock, npcs, delivery, choreBoard, bounties, farmActivity, buildings, collectibles, bumpkin (skills/equipped/achievements), wardrobe, vip, island, fishing, desert, faction, saltFarm, oilReserves, sunstones, crimstones, minigames, dailyRewards, floatingIsland, socialFarming. Example paths: 'greenhouse', 'npcs.betty', 'bumpkin.skills', 'calendar.dates'.",
    parameters: { type: "object", properties: { path: { type: "string", description: "dot-path into the farm object" } }, required: ["path"] },
    exec: async ({ path }, context) => {
      const { raw } = await getFarm(context.farmId);
      const farm = raw.farm ?? raw;
      const val = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), farm);
      if (val === undefined) return { error: `No data at '${path}'. Top-level keys: ${Object.keys(farm).join(", ")}` };
      return { path, data: val };
    },
  },
  get_market_prices: {
    description: "Live P2P market prices (FLOWER per unit) for all tradable base resources.",
    parameters: { type: "object", properties: {} },
    exec: async () => { const { prices, updatedAt } = await getPrices(); return { updatedAt, prices }; },
  },
  compute_recipe_cost: {
    description: "Deterministic recipe economics: effective XP/output, base-resource expansion, live-market cost after inventory offset.",
    parameters: { type: "object", properties: { recipe: { type: "string", description: "recipe name, e.g. 'Pizza Margherita'" } }, required: ["recipe"] },
    exec: async ({ recipe }, context) => {
      const r = recipes[recipe];
      if (!r) return { error: `Unknown recipe. Known: ${Object.keys(recipes).filter((k) => !k.startsWith("_")).join(", ")}` };
      const [{ canonical }, { prices }] = await Promise.all([getFarm(context.farmId), getPrices()]);
      const eff = effective(recipe, r, canonical, modifiers);
      const dep = expand(recipe, recipes, 0, eff.ingredientMultiplier ?? 1);
      const c = cost(dep.base, prices, items, canonical.inventory);
      return { recipe, verified: !!r.verified, effective: eff, baseResources: dep.base, cost: c, totalMinutes: eff.minutes + dep.intermediateMinutes };
    },
  },
  get_cooking_board: {
    description: "Lists ALL recipes for the player's active buildings, each annotated with canCook (true/false based on current inventory) and missingIngredients. Use for any question about what recipes are available, what can be cooked right now, or what ingredients are missing. Returns recipes grouped by building.",
    parameters: { type: "object", properties: {} },
    exec: async (params, context) => {
      const { canonical: c } = await getFarm(context.farmId);
      const activeBuildings = Object.keys(c.buildings);
      const allRecipes = (await import("../data/recipes.json", { with: { type: "json" } })).default;
      const listed = list_recipes(allRecipes, activeBuildings, c.inventory);
      // Group by building for readability
      const byBuilding = {};
      for (const r of listed) {
        if (!byBuilding[r.building]) byBuilding[r.building] = { canCook: [], missing: [] };
        if (r.canCook) byBuilding[r.building].canCook.push(r);
        else byBuilding[r.building].missing.push(r);
      }
      return { activeBuildings, byBuilding, totalRecipes: listed.length };
    },
  },
  get_planner: {
    description: "Run the deterministic per-building planner: best recipe per building, affordability, Level-100 estimate.",
    parameters: { type: "object", properties: {} },
    exec: async (params, context) => {
      const [{ canonical }, { prices }] = await Promise.all([getFarm(context.farmId), getPrices()]);
      return plan(canonical, prices, recipes, items, modifiers);
    },
  },
  take_snapshot: {
    description: "Save a snapshot of the current farm state now (for later activity comparison).",
    parameters: { type: "object", properties: {} },
    exec: async (params, context) => {
      const { canonical } = await getFarm(context.farmId);
      return await save(canonical, context.userId);
    },
  },
  get_activity_delta: {
    description: "Observed farmActivity deltas + inventory movement + XP gained between the last two snapshots.",
    parameters: { type: "object", properties: {} },
    exec: async (params, context) => {
      const snaps = await latest(2, context.userId);
      if (snaps.length < 2) return { note: "Need at least 2 snapshots — call take_snapshot now and again later." };
      return diffActivity(snaps[1], snaps[0]);
    },
  },
  get_quests: {
    description: "Current chore board, delivery orders and bounties: NPC, requested items, rewards, completion status. Use for any question about chores, deliveries, quests or bounty profit.",
    parameters: { type: "object", properties: {} },
    exec: async (params, context) => {
      const { canonical: c } = await getFarm(context.farmId);
      return {
        chores: Object.fromEntries(Object.entries(c.chores).map(([npc, ch]) => [npc, { task: ch.name, reward: ch.reward, done: !!ch.completedAt }])),
        deliveries: c.deliveries.map((d) => ({ from: d.from, items: d.items, reward: d.reward, done: !!d.completedAt })),
        bounties: c.bounties.requests.slice(0, 40).map((b) => ({ name: b.name, level: b.level, coins: b.coins, items: b.items,
          claimed: c.bounties.completed.some((x) => x.id === b.id) })),
      };
    },
  },
  get_skill_info: {
    description: "Look up machine-readable effect definitions for any skill or skill group from the full catalogue (all 12 groups: Crops, Trees, Fishing, Mining, Cooking, Compost, Aging, Fruit Patch, Animals, Bees & Flowers, Greenhouse, Machinery). Returns the skill's effects and drawbacks so the AI can compute modified yields, cook times, XP etc. Cross-reference with the live farm's active skills (from get_farm_state) to know which are actually active on this farm.",
    parameters: {
      type: "object",
      properties: {
        group: { type: "string", description: "Skill group name, e.g. 'Cooking', 'Crops', 'Mining'. If omitted, returns all groups." },
        skill: { type: "string", description: "Specific skill name to look up, e.g. 'Fast Feasts'. If omitted, returns all skills in the group." },
        active_only: { type: "boolean", description: "If true, only return skills where selected_land22 is true (useful as a default snapshot; always cross-check against live farm.skills)." }
      }
    },
    exec: async ({ group, skill, active_only = false }) => {
      const groups = group
        ? { [group]: skillCatalogue[group] }
        : Object.fromEntries(Object.entries(skillCatalogue).filter(([k]) => !k.startsWith("_")));
      const result = {};
      for (const [gName, tiers] of Object.entries(groups)) {
        if (!tiers || typeof tiers !== "object") continue;
        result[gName] = {};
        for (const [tier, skills] of Object.entries(tiers)) {
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
      return { note: "selected_land22 is a snapshot — always verify against live farm.skills from get_farm_state", skills: result };
    },
  },
  recall_memory: {
    description: "Semantic search over past conversations from previous sessions (pgvector) — use ONLY when the user explicitly asks about historical plans or past decisions from previous sessions. Do NOT use for follow-ups in the ongoing conversation.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    exec: async ({ query }, context) => ({ matches: await similar(query, context.sessionId, context.userId, 5) }),
  },
  get_expansion_guide: {
    description: "Land expansion roadmap and progression guide. AUTO-DETECTS the player's current island and expansion progress from live farm data. When the user asks about reaching or activating a future island (e.g. 'Volcano Island'), ALWAYS pass target_island: 'Volcano Island' (or the requested island name) to get the complete cumulative progression path: all remaining plots on current island + moving fees + first plot on target island with full resource and USD grand totals.",
    parameters: {
      type: "object",
      properties: {
        island: {
          type: "string",
          description: "Specific island to view or target island to reach — e.g. 'Volcano Island', 'Desert Island', 'Petal Paradise', 'Basic Island'."
        },
        target_island: {
          type: "string",
          description: "Destination island to calculate the full journey to (e.g. 'Volcano Island'). Computes all intermediate plot expansions from current state to destination."
        },
        next_n: {
          type: "number",
          description: "How many upcoming expansion rows to return (default 5)."
        },
        show_all_islands: {
          type: "boolean",
          description: "If true, return data for ALL islands instead of just the current one. Default false."
        }
      }
    },
    exec: async ({ island, target_island, next_n = 5, show_all_islands = false }, context) => {
      const { canonical: c, raw } = await getFarm(context.farmId);
      const inv = c.inventory;
      const bumpkinLevel = c.bumpkin.level;
      const farm = raw.farm ?? raw;

      // ── 1. Auto-detect current island from farm state ──
      const islandType = farm.island?.type;
      const TYPE_MAP = { basic: "Basic Island", spring: "Petal Paradise", desert: "Desert Island", volcano: "Volcano Island" };
      const detectedIsland = TYPE_MAP[islandType] ?? "Desert Island";

      // ── 2. Count live nodes to detect expansion progress ──
      const nodeCounts = {
        "Crop Plot":     Object.keys(farm.crops ?? {}).length,
        "Tree":          Object.keys(farm.trees ?? {}).length,
        "Stone Rock":    Object.keys(farm.stones ?? {}).length,
        "Iron Rock":     Object.keys(farm.iron ?? {}).length,
        "Gold Rock":     Object.keys(farm.gold ?? {}).length,
        "Fruit Patch":   Object.keys(farm.fruitPatches ?? {}).length,
        "Crimstone Rock":Object.keys(farm.crimstones ?? {}).length,
        "Sunstone Rock": Object.keys(farm.sunstones ?? {}).length,
        "Oil Reserve":   Object.keys(farm.oilReserves ?? {}).length,
        "Beehive":       Object.keys(farm.beehives ?? {}).length,
        "Flower Bed":    Object.keys(farm.flowers?.flowerBeds ?? {}).length,
      };

      // Find the last completed row per island by matching actual node counts
      // against the expansion table's total_after values (sequential, so break on first miss)
      const progressPerIsland = {};
      for (const isl of expansion.islands) {
        let lastPlot = isl.rows[0].unlock_land_plot - 1;
        for (const row of isl.rows) {
          if (row.nodes.length === 0) continue; // empty-node rows: carry forward
          const done = row.nodes.every((n) => (nodeCounts[n.type] ?? 0) >= n.total_after);
          if (done) lastPlot = row.unlock_land_plot;
          else break;
        }
        progressPerIsland[isl.name] = lastPlot;
      }

      // ── 3. Resource lookup (handles case + coins in currencies) ──
      const have = (res) => {
        if (res === "coins") return c.currencies.coins;
        if (inv[res] != null) return Number(inv[res]);
        const cap = res.charAt(0).toUpperCase() + res.slice(1);
        if (inv[cap] != null) return Number(inv[cap]);
        return 0;
      };

      // ── 4. Target / Destination Island Journey Calculation ──
      const resolvedTarget = resolveIslandName(target_island);
      const resolvedIsland = resolveIslandName(island);
      let destinationCandidate = resolvedTarget ?? (resolvedIsland && resolvedIsland !== detectedIsland ? resolvedIsland : null);

      // Auto-detect future island from user's message/goal if model passed empty/no target
      if (!destinationCandidate && context?.userGoal) {
        const goalIsland = resolveIslandName(context.userGoal);
        if (goalIsland && goalIsland !== detectedIsland) {
          destinationCandidate = goalIsland;
        }
      }

      const currentIslandIdx = expansion.islands.findIndex((i) => i.name === detectedIsland);
      const destIslandIdx = destinationCandidate
        ? expansion.islands.findIndex((i) => i.name === destinationCandidate)
        : -1;

      let journeyToTarget = null;
      if (destIslandIdx > currentIslandIdx && currentIslandIdx >= 0) {
        const destIslandObj = expansion.islands[destIslandIdx];
        const currentIslandObj = expansion.islands[currentIslandIdx];
        const currentPlot = progressPerIsland[detectedIsland];

        // 1. Remaining plots on current island
        const remainingCurrentPlots = currentIslandObj.rows.filter((r) => r.unlock_land_plot > currentPlot);

        // 2. Moving costs along the journey
        const movingSteps = [];
        for (let idx = currentIslandIdx; idx < destIslandIdx; idx++) {
          const moveCost = expansion.islands[idx].moving_cost_to_next;
          if (moveCost) movingSteps.push(moveCost);
        }

        // 3. First plot on target island
        const firstDestPlot = destIslandObj.rows[0];

        // 4. Sum up all resources & FLOWER cost
        const totalResources = {};
        let totalCostFlower = 0;

        for (const row of remainingCurrentPlots) {
          totalCostFlower += row.p2p_cost_usd ?? 0;
          for (const [res, qty] of Object.entries(row.resources ?? {})) {
            totalResources[res] = (totalResources[res] ?? 0) + qty;
          }
        }

        for (let idx = currentIslandIdx + 1; idx < destIslandIdx; idx++) {
          for (const row of expansion.islands[idx].rows) {
            totalCostFlower += row.p2p_cost_usd ?? 0;
            for (const [res, qty] of Object.entries(row.resources ?? {})) {
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
          for (const [res, qty] of Object.entries(firstDestPlot.resources ?? {})) {
            totalResources[res] = (totalResources[res] ?? 0) + qty;
          }
        }

        const inventoryComparison = {};
        for (const [res, need] of Object.entries(totalResources)) {
          const owned = have(res);
          inventoryComparison[res] = {
            need,
            have: +owned.toFixed(2),
            short: Math.max(0, +(need - owned).toFixed(2)),
          };
        }

        const currentIslandRemainingFlower = +(remainingCurrentPlots.reduce((s, r) => s + (r.p2p_cost_usd ?? 0), 0)).toFixed(2);
        const targetPlotFlower = firstDestPlot?.p2p_cost_usd ?? 0;

        journeyToTarget = {
          from_island: detectedIsland,
          to_island: destIslandObj.name,
          current_plot: currentPlot,
          remaining_plots_count: remainingCurrentPlots.length,
          remaining_plots_list: remainingCurrentPlots.map((r) => ({
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
          summary: `To reach and activate ${destIslandObj.name} from ${detectedIsland} (Plot ${currentPlot}): You must complete ${remainingCurrentPlots.length} remaining ${detectedIsland} plots (Plots ${remainingCurrentPlots.map(p => p.unlock_land_plot).join(", ")}, costing ~${currentIslandRemainingFlower} FLOWER) + pay moving fee (${movingSteps.map(m => `${m.amount} ${m.resource}`).join(", ")}) + unlock first ${destIslandObj.name} plot (Plot ${firstDestPlot?.unlock_land_plot} requiring Level ${firstDestPlot?.bumpkin_level}, costing ${targetPlotFlower} FLOWER). Grand total: ~${totalCostFlower.toFixed(2)} FLOWER in resources.`,
        };
      }

      // ── 5. Determine which islands to show in detailed breakdown ──
      const targetIsland = destinationCandidate ? null : (resolvedIsland ?? (show_all_islands ? null : detectedIsland));
      const islandsToShow = targetIsland
        ? expansion.islands.filter((i) => i.name.toLowerCase() === targetIsland.toLowerCase())
        : (destinationCandidate ? [expansion.islands[currentIslandIdx], expansion.islands[destIslandIdx]].filter(Boolean) : expansion.islands);
      if (!islandsToShow.length)
        return { error: `Unknown island '${island}'. Valid: ${expansion.islands.map((i) => i.name).join(", ")}` };

      // ── 6. Build result — upcoming rows ──
      const result = [];
      for (const isl of islandsToShow) {
        const currentPlot = progressPerIsland[isl.name];
        const upcoming = [];
        const upcomingLimit = (journeyToTarget && isl.name === journeyToTarget.to_island) ? 1 : next_n;
        for (const row of isl.rows) {
          if (upcoming.length >= upcomingLimit) break;
          if (row.unlock_land_plot <= currentPlot) continue; // already done
          if (bumpkinLevel < row.bumpkin_level) {
            upcoming.push({
              unlock_land_plot: row.unlock_land_plot, bumpkin_level: row.bumpkin_level,
              time: row.time, resources: row.resources, nodes: row.nodes,
              p2p_cost_flower: row.p2p_cost_usd, affordable: false, missing: {},
              blocked: `Need bumpkin level ${row.bumpkin_level} (you are ${bumpkinLevel})`,
            });
            continue;
          }
          const missing = {};
          for (const [res, qty] of Object.entries(row.resources)) {
            const h = have(res);
            if (h < qty) missing[res] = { need: qty, have: +(h).toFixed(2), short: +(qty - h).toFixed(2) };
          }
          upcoming.push({
            unlock_land_plot: row.unlock_land_plot, bumpkin_level: row.bumpkin_level,
            time: row.time, resources: row.resources, nodes: row.nodes,
            p2p_cost_flower: row.p2p_cost_usd,
            affordable: Object.keys(missing).length === 0, missing,
          });
        }
        const completedRows = isl.rows.filter((r) => r.unlock_land_plot <= currentPlot).length;
        result.push({
          island: isl.name, prestige: isl.prestige, biome: isl.biome ?? null,
          is_current_island: isl.name === detectedIsland,
          progress: `${completedRows}/${isl.rows.length} expansions done (at plot ${currentPlot})`,
          current_plot: currentPlot,
          max_nodes: isl.max_nodes,
          total_time: isl.total_time, total_cost_flower: isl.total_cost_usd,
          moving_cost_to_next: isl.moving_cost_to_next,
          next_expansions: upcoming,
        });
      }

      const response = {
        bumpkin_level: bumpkinLevel,
        detected_island: detectedIsland,
        live_node_counts: nodeCounts,
        pricing_notes: expansion.pricing_notes,
      };

      if (journeyToTarget) {
        response.JOURNEY_ROADMAP_MANDATORY = `CRITICAL: The player is currently on ${detectedIsland} (at Plot ${journeyToTarget.current_plot}) and wants to reach ${journeyToTarget.to_island}. All expansion costs are denominated in FLOWER, NOT USD! You MUST present the complete journey to the user:
1. Remaining ${journeyToTarget.remaining_plots_count} plots on ${detectedIsland} (Plots ${journeyToTarget.remaining_plots_list.map(p => p.plot).join(", ")}) costing ~${journeyToTarget.current_island_remaining_cost_flower} FLOWER.
2. Moving fee to next island: ${journeyToTarget.moving_costs.map(m => `${m.amount} ${m.resource}`).join(", ")}.
3. Initial plot unlock on ${journeyToTarget.to_island}: Plot ${journeyToTarget.target_island_initial_plot.plot} requiring Bumpkin Level ${journeyToTarget.target_island_initial_plot.level_required}, costing ${journeyToTarget.target_island_initial_plot.cost_flower} FLOWER.
4. GRAND TOTAL: ~${journeyToTarget.grand_total_cost_flower} FLOWER across all resources (${Object.entries(journeyToTarget.grand_total_resources_needed).map(([k, v]) => `${v} ${k}`).join(", ")}).
5. Compare against the player's live inventory (show what they have vs missing shortfalls).
6. Bumpkin level requirements (currently Level ${bumpkinLevel}, need Level ${journeyToTarget.target_level_required}, so +${journeyToTarget.levels_needed} levels needed).`;
        response.journey_to_target_island = journeyToTarget;
      }

      response.islands = result;
      return response;
    },
  },
};

const toolDefs = Object.entries(TOOLS).map(([name, t]) => ({
  type: "function", function: { name, description: t.description, parameters: t.parameters },
}));

async function groq(messages, toolChoice = "auto") {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const body = { model, messages, tools: toolDefs, tool_choice: toolChoice, temperature: 0.3, max_completion_tokens: 4096 };
  // reasoning models: keep chain-of-thought out of content and short
  if (/qwen|deepseek|r1/i.test(model)) body.reasoning_format = "hidden";
  if (/gpt-oss/i.test(model)) body.reasoning_effort = "low";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Handle Groq 400 "tool_use_failed" — model generated malformed JSON for tool call args.
    // Return a recoverable marker instead of crashing the entire request.
    if (res.status === 400 && text.includes("tool_use_failed")) {
      console.warn(`[groq] tool_use_failed — model emitted malformed tool-call JSON, will retry`);
      return { choices: [{ message: { content: null }, finish_reason: "error" }], _toolError: text.slice(0, 300) };
    }
    throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

const clean = (s) => (s ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();

// extract answer text (string content or content parts). NEVER return raw reasoning/chain-of-thought.
const textOf = (m = {}) => {
  let c = m.content;
  if (Array.isArray(c)) c = c.map((p) => p?.text ?? "").join("");
  return clean(c);
};

// Safely parse tool-call arguments — some models emit malformed JSON.
function safeParseArgs(raw) {
  if (!raw || raw === "{}") return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function runAgent(message, sessionId, userId, farmId, history = null) {
  const steps = [];
  const seen = new Map(); // dedupe repeated identical tool calls

  // Load prior messages if not explicitly provided
  let prior = history;
  if (!prior && sessionId && userId) {
    try {
      const { ChatMessage } = await import("../models/ChatMessage.js");
      prior = await ChatMessage.findBySession(sessionId, userId);
    } catch {
      prior = [];
    }
  }

  // Format prior messages (last 16 messages = 8 turns max to protect token limit)
  const historyRaw = (prior ?? [])
    .filter((m) => m && m.content && String(m.content).trim() && m.content !== message)
    .slice(-16);

  // Sanitize history so roles strictly alternate (preventing LLM API errors)
  const sanitizedHistory = [];
  let lastRole = "system";
  for (const m of historyRaw) {
    const role = m.role === "assistant" || m.role === "ai" ? "assistant" : "user";
    const content = String(m.content).trim();
    if (!content) continue;
    if (role !== lastRole) {
      sanitizedHistory.push({ role, content });
      lastRole = role;
    } else if (sanitizedHistory.length > 0) {
      sanitizedHistory[sanitizedHistory.length - 1].content += "\n\n" + content;
    }
  }
  // Ensure the last history message is 'assistant' before appending the current 'user' message
  if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === "user") {
    sanitizedHistory.pop();
  }

  const messages = [
    { role: "system", content: SYSTEM },
    ...sanitizedHistory,
    { role: "user", content: message },
  ];
  const MAX_ROUNDS = 8;
  let toolErrors = 0; // track consecutive tool-parse failures
  
  // Context object passed to all tool executions
  const context = { sessionId, userId, farmId, userGoal: message };
  
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const j = await groq(messages);

    // ── Recover from Groq tool_use_failed (malformed tool-call JSON) ──
    if (j._toolError) {
      toolErrors++;
      console.log(`[agent] round ${i}: tool_use_failed (#${toolErrors})`);
      if (toolErrors >= 2) {
        // Two consecutive failures — force answer without tools
        messages.push({ role: "user", content: "IMPORTANT: Your last two tool calls had malformed JSON and failed. STOP calling tools. Answer the question NOW using whatever data you already have. If you have no data yet, give your best general advice." });
        const recovery = await groq(messages, "none");
        const answer = textOf(recovery.choices?.[0]?.message) || "⚠️ I had trouble calling my tools. Please try rephrasing your question.";
        return { answer, steps };
      }
      messages.push({ role: "user", content: "Your last tool call had invalid JSON arguments and was rejected. Try again — call the tool with correct JSON, or answer directly if you already have enough data." });
      continue;
    }
    toolErrors = 0; // reset on success

    const m = j.choices?.[0]?.message ?? {};
    console.log(`[agent] round ${i}: finish=${j.choices?.[0]?.finish_reason} tools=${m.tool_calls?.length ?? 0} contentLen=${(typeof m.content === "string" ? m.content : "").length}`);
    messages.push({ role: "assistant", content: typeof m.content === "string" ? m.content : "", tool_calls: m.tool_calls });
    if (!m.tool_calls?.length) {
      const answer = textOf(m);
      if (answer) return { answer, steps };
      // blank reply: nudge and retry instead of failing
      messages.push({ role: "user", content: "Your last message was empty. Answer the question now using the tool results so far (or call a tool if you still need data)." });
      continue;
    }
    for (const tc of m.tool_calls) {
      const name = tc.function?.name;
      const key = `${name}:${tc.function?.arguments ?? ""}`;
      let result;
      if (seen.has(key)) {
        result = { note: "Duplicate call — identical result as before. Do NOT call this again; use the data you already have.", ...seen.get(key) };
        steps.push({ tool: name, ok: true, cached: true });
      } else {
        try {
          result = await (TOOLS[name]?.exec ?? (() => ({ error: `unknown tool ${name}` })))(safeParseArgs(tc.function.arguments), context);
          steps.push({ tool: name, ok: !result?.error });
        } catch (e) {
          result = { error: String(e.message ?? e) };
          steps.push({ tool: name, ok: false });
        }
        seen.set(key, result);
      }
      let payload = JSON.stringify(result);
      if (payload.length > 15000) payload = payload.slice(0, 15000) + `"...TRUNCATED (${payload.length} chars total) — request a narrower path/section"`;
      messages.push({ role: "tool", tool_call_id: tc.id, content: payload });
    }
  }
  // Out of rounds: force a final answer from gathered data instead of giving up.
  messages.push({ role: "user", content: "STOP gathering. Using ONLY the tool results above, give your best final answer now. State any remaining unknowns explicitly." });
  const j = await groq(messages, "none");
  console.log(`[agent] final: finish=${j.choices?.[0]?.finish_reason}`);
  const answer = textOf(j.choices?.[0]?.message) || "⚠️ Could not produce an answer — try a narrower question.";
  return { answer, steps };
}
