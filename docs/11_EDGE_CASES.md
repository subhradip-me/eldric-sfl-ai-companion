# 11. Edge Cases & Boundary Handling Matrix 🛡️

This document outlines edge cases, boundary conditions, failure modes, and automated defensive mitigations across the Sunflower AI platform.

---

## 1. Edge Case Matrix

| Domain | Edge Case Scenario | Potential Impact | Implemented Mitigation |
|---|---|---|---|
| **Auth** | User accesses protected route before linking a Farm ID | `NullPointerException` on unlinked state | `requireFarmId` middleware intercepts request and returns `400 Bad Request`. Client conditionally mounts `FarmSetup` instead of canvas. |
| **Auth** | Tampered or expired JWT token | Unauthorized access or silent state failure | `jwt.verify` fails with `JsonWebTokenError` / `TokenExpiredError`. Returns HTTP 403; client clears `localStorage` and redirects to login. |
| **Game Math** | Recipe requires 0 FLOWER cost (all ingredients owned in bag) | Division by zero: `batchXp / flowerCost` returns `Infinity` | `isFinite(b.xpPerFlower) && b.xpPerFlower > 0 ? fmt(b.xpPerFlower) : "—"` guard displays clean infinity-safe dash. |
| **Game Math** | New farm with Level 1 Bumpkin (0 XP) | Progress bar NaN or zero-division | Safe calculation: `Math.min((farm.bumpkin.xp / 24_083_905) * 100, 100).toFixed(1)` defaulting nulls to 0. |
| **Game Math** | Untradable ingredient deficit (e.g. Milk, Eggs, Honey) | Player cannot purchase missing items on market | Planner separates required items into `mustProduce` vs `buy`. Renders a high-priority "Resource Deficit Warning" callout. |
| **Game Math** | Intermediate craftables (e.g. Cheese used in Honey Cheddar) | Circular dependency or infinite cost recursion | `isIntermediate` flag tags intermediate foods. Recursion depth is capped at 10 and ingredients evaluated hierarchically. |
| **Cooking** | LLM evaluates recipe for a building the player does not own | Misleading advice recommending uncookable dishes | `compute_recipe_cost` checks `r.building in canonical.buildings` and attaches `ownsBuilding: false` and a prominent warning. |
| **Progression** | Player asks to unlock a future island (e.g. Volcano Island) | Showing only initial target plot ignores mandatory progression | `get_expansion_guide` calculates full journey: remaining current island plots + moving fee + target island initial plot. |
| **API / Network** | SFL Community API returns HTTP 429 during cold start | No in-memory or disk cache available to serve | `SunflowerClient.ts` catches error and returns stale disk cache. Frontend renders graceful cache-mode pill. |
| **API / Network** | Concurrent identical requests for same Farm ID | Redundant outbound network calls, rate limits | `pending = new Map()` in-flight deduplication shares single outbound Promise across all concurrent callers. |
| **AI / Agent** | Groq LLM emits malformed JSON in tool call arguments | Agent crashes or hangs | Caught by 400 handler (`_toolError`). Model is prompted with recovery instructions up to 2 retry attempts. |
| **AI / Agent** | User supplies new constraints in turn 2 ("I don't have X") | Agent reuses stale tool cache | Tools accept `force: true` to bypass the in-turn `seen` cache and re-fetch fresh state. |
| **Database** | PostgreSQL container starts slower than Express | Backend container crash loop | Exponential backoff retry loop (`connectWithRetry`) attempts connection 10 times with up to 32s delays. |
| **Database** | SQL injection attempt in username or session ID | Data leakage or database corruption | 100% of queries use parameterized prepared statements (`$1, $2, ...`). Zero raw string interpolation. |

---

## 2. Code Mitigations in Detail

### 2.1 Building Ownership Gate (`Orchestrator.ts`)
```typescript
// server/services/ai/Orchestrator.ts - Building ownership verification
const ownsBuilding = r.building in canonical.buildings;
return {
  recipe,
  verified: !!r.verified,
  ownsBuilding,
  warning: ownsBuilding ? null : `⚠️ You do NOT own a ${r.building}! You cannot cook this recipe until you build one.`,
  effective: eff,
  baseResources: dep.base,
  cost: c,
  totalMinutes: eff.minutes + dep.intermediateMinutes,
};
```

---

### 2.2 Full Island Journey Prerequisite Calculation (`Orchestrator.ts`)
```typescript
// Enforce full sequence: current island remaining -> moving fee -> first destination plot
journeyToTarget = {
  from_island: detectedIsland,
  to_island: destIslandObj.name,
  current_plot: currentPlot,
  remaining_plots_count: remainingCurrentPlots.length,
  current_island_remaining_cost_flower: currentIslandRemainingFlower,
  moving_costs: movingSteps,
  target_island_initial_plot: { plot: firstDestPlot?.unlock_land_plot, level_required: firstDestPlot?.bumpkin_level },
  grand_total_cost_flower: +totalCostFlower.toFixed(2),
};
```

---

### 2.3 Tool Call Deduplication Bypass (`force: true`)
```typescript
// server/services/ai/Orchestrator.ts - Tool Dedup Bypass
const parsedArgs = this.safeParseArgs(tc.function?.arguments);
const forceRefresh = !!parsedArgs?.force;
if (forceRefresh) delete parsedArgs.force;
const key = `${name}:${JSON.stringify(parsedArgs)}`;

if (!forceRefresh && seen.has(key)) {
  result = { note: 'Duplicate call — using cached data.', ...seen.get(key) };
  steps.push({ tool: name, ok: true, cached: true });
} else {
  result = await tool.exec(parsedArgs, context);
  seen.set(key, result);
}
```

---

### 2.4 Groq Tool-Use JSON Recovery Loop
```typescript
if (j._toolError) {
  toolErrors++;
  if (toolErrors >= 2) {
    messages.push({
      role: 'user',
      content: 'IMPORTANT: Your tool calls had malformed JSON. STOP calling tools and answer directly now.',
    });
    const recovery = await this.groq(messages, 'none');
    return { answer: this.textOf(recovery.choices?.[0]?.message), steps };
  }
}
```

