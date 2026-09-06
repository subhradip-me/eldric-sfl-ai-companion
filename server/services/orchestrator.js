// Goal-oriented AI orchestrator: PLAN -> ACT (tools) -> CHECK -> FIX loop.
// The LLM decides which data it needs; tools are deterministic app code.
import { getFarm, getPrices } from "./sunflower.js";
import { plan } from "./planner.js";
import { diffActivity } from "./activity.js";
import { save, latest } from "./snapshots.js";
import { similar } from "./chatStore.js";
import { expand, cost } from "./recipes.js";
import { effective } from "./xpEngine.js";
import recipes from "../data/recipes.json" with { type: "json" };
import items from "../data/items.json" with { type: "json" };
import modifiers from "../data/modifiers.json" with { type: "json" };
import expansion from "../data/expansion .json" with { type: "json" };

const SYSTEM = `You are the Sunflower Land farm orchestrator. You are GOAL-ORIENTED:
1. PLAN: break the user's goal into steps and decide which tools you need.
2. ACT: call tools to gather live data (never guess prices, inventory, XP — fetch them).
3. CHECK: verify the result answers the goal; if numbers are missing or inconsistent, call more tools or recompute.
4. ANSWER: concise markdown; small tables (max 4 cols) for comparisons; **bold** key numbers; bullet action steps.
Rules: tool outputs are the source of truth. Never invent prices, recipes, XP values or mechanics.
get_farm_state returns the COMPLETE inventory — an item missing from it means quantity 0, but never claim the
inventory is empty if the tool returned items. For anything not covered by a tool (greenhouse, calendar, NPCs,
animals, trades, stock, faction, fishing...), call get_farm_section with the right path instead of guessing.
If an item has no market price, say "must farm/produce" — do not estimate. Use recall_memory to learn from past
conversations when the question relates to earlier plans or decisions. Distinguish observed/inferred/estimated.
For ANY question about land expansion, plot unlocks, island progression, prestige, node counts, or expansion
affordability — call get_expansion_guide. It AUTO-DETECTS the player's current island (from farm.island.type)
and expansion progress (by counting live crop plots, trees, stones, etc.), then returns ONLY the upcoming
(not yet completed) expansion rows with live affordability checks. Never assume the player is on Basic Island
— always trust the tool's detected_island. The tool also returns live_node_counts so you can reason about
the player's actual farm state.`;

const TOOLS = {
  get_farm_state: {
    description: "Fresh canonical farm state: level, xp, FLOWER, coins, buildings, skills, and the COMPLETE inventory (every item and quantity).",
    parameters: { type: "object", properties: {} },
    exec: async () => {
      const { canonical: c, stale } = await getFarm();
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
    exec: async ({ path }) => {
      const { raw } = await getFarm();
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
    exec: async ({ recipe }) => {
      const r = recipes[recipe];
      if (!r) return { error: `Unknown recipe. Known: ${Object.keys(recipes).filter((k) => !k.startsWith("_")).join(", ")}` };
      const [{ canonical }, { prices }] = await Promise.all([getFarm(), getPrices()]);
      const eff = effective(recipe, r, canonical, modifiers);
      const dep = expand(recipe, recipes);
      const c = cost(dep.base, prices, items, canonical.inventory);
      return { recipe, verified: !!r.verified, effective: eff, baseResources: dep.base, cost: c, totalMinutes: eff.minutes + dep.intermediateMinutes };
    },
  },
  get_planner: {
    description: "Run the deterministic per-building planner: best recipe per building, affordability, Level-100 estimate.",
    parameters: { type: "object", properties: {} },
    exec: async () => {
      const [{ canonical }, { prices }] = await Promise.all([getFarm(), getPrices()]);
      return plan(canonical, prices, recipes, items, modifiers);
    },
  },
  take_snapshot: {
    description: "Save a snapshot of the current farm state now (for later activity comparison).",
    parameters: { type: "object", properties: {} },
    exec: async () => { const { canonical } = await getFarm(); return await save(canonical); },
  },
  get_activity_delta: {
    description: "Observed farmActivity deltas + inventory movement + XP gained between the last two snapshots.",
    parameters: { type: "object", properties: {} },
    exec: async () => {
      const snaps = await latest(2);
      if (snaps.length < 2) return { note: "Need at least 2 snapshots — call take_snapshot now and again later." };
      return diffActivity(snaps[1], snaps[0]);
    },
  },
  get_quests: {
    description: "Current chore board, delivery orders and bounties: NPC, requested items, rewards, completion status. Use for any question about chores, deliveries, quests or bounty profit.",
    parameters: { type: "object", properties: {} },
    exec: async () => {
      const { canonical: c } = await getFarm();
      return {
        chores: Object.fromEntries(Object.entries(c.chores).map(([npc, ch]) => [npc, { task: ch.name, reward: ch.reward, done: !!ch.completedAt }])),
        deliveries: c.deliveries.map((d) => ({ from: d.from, items: d.items, reward: d.reward, done: !!d.completedAt })),
        bounties: c.bounties.requests.slice(0, 40).map((b) => ({ name: b.name, level: b.level, coins: b.coins, items: b.items,
          claimed: c.bounties.completed.some((x) => x.id === b.id) })),
      };
    },
  },
  recall_memory: {
    description: "Semantic search over past conversations (pgvector) — use to learn from earlier plans and decisions.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    exec: async ({ query }, sessionId) => ({ matches: await similar(query, sessionId, 5) }),
  },
  get_expansion_guide: {
    description: "Land expansion roadmap. AUTO-DETECTS the player's current island and expansion progress from live farm data, then returns ONLY upcoming (not yet completed) expansion rows with affordability checks against live inventory. Defaults to the current island unless overridden. Use for ANY question about land expansion, plot unlocks, island progression, prestige, node counts, or expansion costs.",
    parameters: {
      type: "object",
      properties: {
        island: {
          type: "string",
          description: "Override: show a specific island — 'Basic Island', 'Petal Paradise', 'Desert Island', or 'Volcano Island'. If omitted, auto-detects the player's current island."
        },
        next_n: {
          type: "number",
          description: "How many upcoming expansion rows to return (default 3)."
        },
        show_all_islands: {
          type: "boolean",
          description: "If true, return data for ALL islands instead of just the current one. Default false."
        }
      }
    },
    exec: async ({ island, next_n = 3, show_all_islands = false }) => {
      const { canonical: c, raw } = await getFarm();
      const inv = c.inventory;
      const bumpkinLevel = c.bumpkin.level;
      const farm = raw.farm ?? raw;

      // ── 1. Auto-detect current island from farm state ──
      const islandType = farm.island?.type;
      const TYPE_MAP = { basic: "Basic Island", spring: "Petal Paradise", desert: "Desert Island", volcano: "Volcano Island" };
      const detectedIsland = TYPE_MAP[islandType] ?? null;

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

      // ── 4. Determine which islands to show ──
      const targetIsland = island ?? (show_all_islands ? null : detectedIsland);
      const islandsToShow = targetIsland
        ? expansion.islands.filter((i) => i.name.toLowerCase() === targetIsland.toLowerCase())
        : expansion.islands;
      if (!islandsToShow.length)
        return { error: `Unknown island '${island}'. Valid: ${expansion.islands.map((i) => i.name).join(", ")}` };

      // ── 5. Build result — only upcoming (not-yet-completed) rows ──
      const result = [];
      for (const isl of islandsToShow) {
        const currentPlot = progressPerIsland[isl.name];
        const upcoming = [];
        for (const row of isl.rows) {
          if (upcoming.length >= next_n) break;
          if (row.unlock_land_plot <= currentPlot) continue; // already done
          if (bumpkinLevel < row.bumpkin_level) {
            upcoming.push({
              unlock_land_plot: row.unlock_land_plot, bumpkin_level: row.bumpkin_level,
              time: row.time, resources: row.resources, nodes: row.nodes,
              p2p_cost_usd: row.p2p_cost_usd, affordable: false, missing: {},
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
            p2p_cost_usd: row.p2p_cost_usd,
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
          total_time: isl.total_time, total_cost_usd: isl.total_cost_usd,
          moving_cost_to_next: isl.moving_cost_to_next,
          next_expansions: upcoming,
        });
      }

      return {
        bumpkin_level: bumpkinLevel,
        detected_island: detectedIsland,
        live_node_counts: nodeCounts,
        pricing_notes: expansion.pricing_notes,
        islands: result,
      };
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

export async function runAgent(message, sessionId) {
  const steps = [];
  const seen = new Map(); // dedupe repeated identical tool calls
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: message }];
  const MAX_ROUNDS = 8;
  let toolErrors = 0; // track consecutive tool-parse failures
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
          result = await (TOOLS[name]?.exec ?? (() => ({ error: `unknown tool ${name}` })))(safeParseArgs(tc.function.arguments), sessionId);
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
