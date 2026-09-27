# LLM Planner + Deterministic Guardrail + Sell-Plan Resolver

**Date:** 2026-09-22
**Status:** Implemented (Slices 1 + 2) — 2026-09-22
**Scope:** Slices 1 + 2 (this spec). Slice 3 (background simulation workers) is captured as future work only.

> **Implementation notes (2026-09-22):**
> - Slice 1: `LlmPlanner.ts` (classifier + pure `parse()`), `PlanGuardrail.ts` (authoritative repair), `Planner.plan()` now tries LLM→guardrail then falls back to `deterministicPlan()`. New intents `MARKET_PRICES` / `SELL_ADVICE` added to `types.ts`, with keyword branches in the deterministic fallback so routing is correct even without a provider. `synthesisDirectives` thread Planner → `PipelineCoordinator` → `Explainer`.
> - Slice 2: `resolve_sell_plan` tool registered in `Orchestrator.ts`; `SellPlanResult`/`SellCandidate`/`SellExclusion` in `domain/market.ts`; `DeterministicValidator.synthesizeSellPlanResults()` renders the ranked table; the placed-node/sell-price guardrail was added to `JESTER_SYSTEM`.
> - Tests: `server/tests/llmPlannerAndSellPlan.test.ts` (22 tests). Existing AI/pipeline suites unchanged and green.

---

## 1. Motivation

The AI pipeline is `Planner → tool execution → DeterministicValidator → Explainer (Jester)`. Today the `Planner` ([server/services/ai/pipeline/Planner.ts](../../../server/services/ai/pipeline/Planner.ts)) routes by keyword matching. This produced two observed failures:

1. **"what should I sell to buy the missing ingredients"** and **"check the p2p market"** fell through every keyword branch to `GENERAL_QUERY → search_knowledge`, returning stale 2023 knowledge-base chunks instead of live market prices.
2. Lacking real market/sell data in context, the Explainer **hallucinated**: it recommended selling a **Crimstone Rock for 463.88 FLOWER** — a placed resource node that is not sellable, using a daily-production *valuation* figure as if it were a sell price.

Keyword routing has no branch for market/sell intents, and no deterministic engine computes "what to sell." This spec fixes both while preserving the pipeline's core invariant.

### Core invariant (must not be violated)

From [Orchestrator.ts](../../../server/services/ai/Orchestrator.ts): *"The orchestrator may decide which deterministic tool to invoke, but it may never supply an authoritative fact that the tool is supposed to determine. LLM explains; never calculates or fabricates candidates."*

The governing rule for this whole design:

> **The LLM decides what *matters* (intent, preferences, constraints). The engine decides what's *true* (numbers, feasibility, candidates).**

---

## 2. Architecture

```
message
  │
  ▼
Planner.plan()
  ├─ LlmPlanner.classify(message, history)      [1 LLM call, JSON-only, low temp]
  │     └─ returns { intent, criteria, goal?, plannedTools[], synthesisDirectives[] }
  │        (NEVER returns a number, candidate, or answer)
  │
  ├─ on failure/timeout/unparseable ──▶ deterministicPlan()   [today's keyword logic, kept as fallback]
  │
  ▼
PlanGuardrail.validate(plan, toolCatalog)         [deterministic, 0ms — cannot be bypassed]
  │     • whitelist every plannedTools[].name against Object.keys(orchestrator.tools); drop unknowns
  │     • coerce arg types against each tool's parameter schema (quantity→number, etc.)
  │     • force-inject baseline tools (get_farm_state, get_active_effects) if absent
  │     • clamp synthesisDirectives to an allowlist-safe list of strings
  │     • if nothing valid remains ──▶ deterministicPlan() fallback
  │
  ▼
ExecutionPlan  ──▶  tool execution (unchanged)  ──▶  DeterministicValidator (unchanged)
  │
  ▼
Explainer.explain(..., synthesisDirectives)       [Claude Opus primary, Groq fallback — unchanged chain]
        └─ directives steer PRESENTATION only; all numbers come from tool results
```

**Key properties:**

- The LLM planner output is **advisory**; `PlanGuardrail` is **authoritative**. The LLM can never invoke a tool that doesn't exist or smuggle a fabricated number, because it only emits tool *names* + typed *args*, and the guardrail re-derives everything against the real catalog.
- **The deterministic keyword `Planner` is not deleted.** It is renamed to `deterministicPlan()` and becomes the fallback path. A provider outage or malformed response degrades to *today's* behavior, never to broken routing.

---

## 3. Slice 1 — LLM Planner + Guardrail + Directives

### 3.1 New/changed components

| Component | File | Responsibility |
|-----------|------|----------------|
| `LlmPlanner` | `server/services/ai/pipeline/LlmPlanner.ts` (new) | Build the classifier prompt, call the LLM, parse strict JSON into a `ClassifiedPlan`. |
| `PlanGuardrail` | `server/services/ai/pipeline/PlanGuardrail.ts` (new) | Deterministically validate/repair a `ClassifiedPlan` into an `ExecutionPlan`. |
| `Planner` | `server/services/ai/pipeline/Planner.ts` (changed) | Orchestrate: try `LlmPlanner` → `PlanGuardrail`; on failure call existing keyword logic (now `deterministicPlan`). |
| Tool catalog | derived from `orchestrator.tools` | Name + description list handed to the LLM, always in sync with real tools. |

### 3.2 Classification contract

The LLM returns strict JSON only (no prose):

```json
{
  "intent": "MARKET_PRICES",
  "criteria": { "requiredEntity": "Crimstone", "checkBoosters": true },
  "plannedTools": [
    { "name": "get_market_prices", "args": {} },
    { "name": "get_farm_state", "args": {} }
  ],
  "synthesisDirectives": [
    "Cite live P2P prices from get_market_prices; never quote knowledge-base base values as current prices."
  ]
}
```

- `intent` — one of the `PipelineIntent` enum (existing values + new: `MARKET_PRICES`, `SELL_ADVICE`).
- `criteria` — fields from the existing `ValidationCriteria` type only.
- `plannedTools[].name` — must exist in the tool catalog (guardrail enforces).
- `synthesisDirectives` — presentation/guardrail hints for the Explainer. **Strings only, never numbers.**

### 3.3 Prompt inputs

The `LlmPlanner` system prompt is assembled from:
1. The `PipelineIntent` enum with a one-line description each.
2. The **auto-generated tool catalog** (`name: description` from `orchestrator.tools`) — stays in sync automatically.
3. The `ValidationCriteria` field list.
4. Hard rules: "Output JSON only. Never include numbers, prices, XP, or candidates. Choose tools that fetch the data needed; the application computes all facts."

Prior conversation history (last N turns) is included so follow-ups ("what about 24?", "sell those instead") classify with context.

### 3.4 Model choice (DECIDED)

**Decision: Claude Opus 4.8 primary, Groq fallback — the same provider chain as the Explainer.**

- The classifier reuses the exact primary→fallback pattern already implemented in `Explainer` (`tryClaude` → `tryGroq`): Claude Opus first, Groq (`llama-3.3-70b`) if Claude is unconfigured/errors/empty.
- Classifier call params: temp 0, `max_tokens` ~300, JSON-only.
- Consistent policy everywhere; resilient to a Claude outage. Cost: ~+4s/turn on the happy path (two sequential Claude calls: classify → explain).
- No new env: reuses existing `CLAUDE_*` and `GROQ_*`.

### 3.5 New intents fix the observed bug

| User query | Old routing | New routing |
|------------|-------------|-------------|
| "check the p2p market" | `GENERAL_QUERY → search_knowledge` (2023 junk) | `MARKET_PRICES → get_market_prices + get_farm_state` |
| "what should I sell to fill the FLOWER gap" | `GENERAL_QUERY → search_knowledge` | `SELL_ADVICE → resolve_sell_plan + get_market_prices + get_farm_state` (Slice 2) |

---

## 4. Slice 2 — `resolve_sell_plan` resolver + LLM constraint extraction (the blend)

This is the reference pattern for **every objective-driven decision**: LLM extracts *preferences/constraints*; deterministic resolver computes the *plan* over real data; directives steer presentation.

### 4.1 Why a resolver (not LLM synthesis)

"Decide what to sell / keep" is the step that produces numbers. If an LLM does it over raw data, that is exactly the Crimstone hallucination. So the math lives in a deterministic tool; the LLM only supplies the *inputs that vary by context*.

### 4.2 Split of responsibilities

| Concern | Source | Who |
|---------|--------|-----|
| The FLOWER gap to fill | set goal / follow-up / explicit ask | LLM extracts → typed arg |
| Soft preferences ("keep my Crimstone", "save for a Barn") | goal / history / follow-up | LLM extracts → `preserve[]`, `reserveForGoal` |
| Hard reserves (recipe ingredients, delivery items, tomorrow reserves) | deterministic | `buildResourceLedger` (existing) |
| Sellability (placed nodes NOT sellable; sell price per unit) | authoritative | item metadata + live prices |
| Ranked sell list, gap-fill math, shortfall | deterministic | `resolve_sell_plan` (new) |
| Presentation, "never suggest selling placed/reserved items" | directive | `synthesisDirectives` → Explainer |

### 4.3 New tool: `resolve_sell_plan`

Registered in `orchestrator.tools`, same `AIToolResult<T>` shape as every other tool.

```
resolve_sell_plan({
  gapFlower: number,
  preserve?: string[],           // soft, from LLM (player preference)
  reserveForGoal?: string,       // soft, from LLM (e.g. "Pizza Margherita x10")
}) → {
  candidates: Array<{ item, qtyToSell, unitPriceFlower, totalFlower }>,  // ranked by value, real prices
  excluded:   Array<{ item, reason }>,   // "placed node — not sellable", "reserved for recipe", "preserved by request"
  gapFilled:  boolean,
  shortfallFlower: number,               // > 0 if inventory can't cover the gap
}
```

**Determinism guarantees:**
- Only items with a real market price and a `sellable` metadata flag are candidates.
- Placed resource nodes (e.g. Crimstone Rock) are always in `excluded`, never `candidates`.
- Hard reserves from `buildResourceLedger` are excluded with a reason; soft `preserve[]` items too (distinct reason).
- No number originates in the LLM — every figure traces to live prices + inventory.

Mirrors the existing `evaluate_strategy_feasibility` shape: `resolveCandidateIntent()` (params) → `evaluateFeasibility(candidate, constraints)` with `blacklistedItems` / `disallowMarketPurchases` / `maxFlowerCost`.

### 4.4 Explainer guardrail (fast-follow within this slice)

Add to `JESTER_SYSTEM`: "Placed resource nodes (Rocks, Trees, etc.) are NOT sellable. A daily-production FLOWER *valuation* is an accounting figure, not a sell price. Only present sell suggestions from `resolve_sell_plan` output." This closes the specific hallucination even if a future query reaches the Explainer with raw inventory.

---

## 5. Error handling & fallback

| Failure | Behavior |
|---------|----------|
| LLM classify call errors / times out | `deterministicPlan()` (today's keyword logic) |
| LLM returns non-JSON / schema-invalid | `deterministicPlan()` |
| LLM picks a tool not in catalog | guardrail drops it; keeps valid ones |
| Guardrail leaves no valid tools | `deterministicPlan()` |
| `resolve_sell_plan` can't fill gap | returns `gapFilled:false` + `shortfallFlower`; Explainer states the shortfall honestly |
| Market prices unavailable | tool returns `DEPENDENCY_UNAVAILABLE` (existing pattern); Explainer says prices are unavailable |

The system never hard-fails on planning: worst case is today's behavior.

---

## 6. Testing

- **LlmPlanner (unit, mocked LLM):** given a canned JSON response, produces the expected `ClassifiedPlan`; malformed JSON → throws/returns null so caller falls back.
- **PlanGuardrail (unit, no LLM):** unknown tool dropped; missing baseline tools injected; bad arg types coerced/rejected; empty result triggers fallback signal. Pure/deterministic.
- **Planner (integration):** LLM failure path falls back to `deterministicPlan`; known intents still route correctly.
- **resolve_sell_plan (unit):** placed nodes always excluded; reserved items (via ledger) excluded with reason; `preserve[]` honored; gap-fill math correct; shortfall reported when inventory insufficient. Follows existing `orchestrator.test.ts` tool-test style.
- **Regression:** the exact screenshot queries ("check the p2p market", "what should I sell to fill the FLOWER gap") route to market/sell intents, and no response ever proposes selling a placed node.

New env, if the Groq-classifier split is approved: `CLAUDE_*` already present; classifier reuses existing `GROQ_*`. No new secrets.

---

## 7. Out of scope — future work

### Slice 3 — Background simulation workers ("simulate the whole game, find the best path")

The project's north star: simulate gameplay over raw data to find the best way to level up / earn FLOWER. Architecture seed already exists in `simulate_what_if` (goal against a *cloned* farm state, zero side effects).

**Foundation reuse — [server/services/farm/historyContextExtractors.ts](../../../server/services/farm/historyContextExtractors.ts):** the history engine is the *backward* model (`inferEventsFromDelta`: `diff(stateₜ, stateₜ₊₁) → action`); the simulator is the *forward* model (`apply(state, action) → state'`). They should **share one `FarmDelta` representation** so:
- simulated futures are scored by the **same valuation** that scores real history (`aggregateDailyMetrics` / `extractDailyMetrics` already yield FLOWER- and XP-per-day — the objective function);
- **real observed deltas calibrate/validate the forward model** — predictions are checked against what actually happened, keeping the simulator honest rather than hallucinating.

Background workers run this pattern at scale offline, caching a winning policy; chat then *reads* a precomputed optimal plan. Slices 1–2 are its foundation: workers reuse the same **typed-goal + constraints → deterministic resolver** contract. Slice 3 gets its own spec.

---

## 8. Decisions (resolved)

1. **Classifier model (§3.4):** Claude Opus 4.8 primary, Groq fallback — same provider chain as the Explainer. ✅
2. **Intent name:** `SELL_ADVICE`. ✅
3. **Scope:** Slices 1+2 now; Slice 3 (simulation workers) deferred to its own spec. ✅
