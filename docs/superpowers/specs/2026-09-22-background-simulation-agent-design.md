# Background Simulation Agent — 24/7 Forward-Model Planner

**Date:** 2026-09-22
**Status:** Design — awaiting review
**Scope:** Slice 3 of the AI strategist roadmap. Builds directly on Slices 1 + 2 (LLM Planner + Guardrail + Sell-Plan Resolver, see [2026-09-22-llm-planner-and-sell-resolver-design.md](./2026-09-22-llm-planner-and-sell-resolver-design.md)).

---

## 1. Motivation

Today the assistant is **reactive**: it answers a question by planning tools, running deterministic engines, and explaining the result for that one turn. It has no memory of *trajectory* and does no forward exploration — it can tell you the cost of a recipe, but not "here is the best 7-day path to Level 75, and here's what I simulated that you didn't try."

The project's north star (Slice 3 in the prior spec's §7) is a persistent agent that:

1. **Tracks gameplay 24/7** from the snapshot timeline, even while the player is offline.
2. **Analyses** real progression using the existing backward model (`inferEventsFromDelta` → `FarmDelta` → `aggregateDailyMetrics`).
3. **Simulates counterfactual futures** — outcomes of action branches the player never took — with a forward model.
4. **Plans the best strategy** toward a goal (or open-ended progression), caching a winning policy.
5. **Surfaces it proactively** — chat reads a precomputed optimal plan and can open with "your plan changed."

### Core invariant (inherited, must not be violated)

From the prior spec and `Orchestrator.ts`:

> **The LLM decides what *matters* (intent, preferences, constraints). The engine decides what's *true* (numbers, feasibility, candidates).**

The simulation engine is part of "the engine." It is pure and deterministic; it computes candidates, trajectories, and numbers. The LLM only **explains** the cached policy — it never runs the search or invents a projected number.

### The honesty discipline (the reason this is hard)

A 24/7 simulator that confidently lies is worse than no simulator. The design's central safeguard: the **forward model and the backward model share one `FarmDelta` representation**, so:

- Simulated futures are scored by the *same* valuation (`aggregateDailyMetrics`, XP/FLOWER-per-day) that scores real history — one objective function, no divergence between "what we measure" and "what we optimise."
- **Real observed deltas calibrate the forward model.** Every cycle, the model's prediction for the step the player actually took is compared against the newly observed delta; the error feeds a confidence tier. When the model drifts, the agent says so rather than hallucinating.

---

## 2. Architecture

```
                          ┌─ repeatable, every ~6h per bound farm
                          ▼
   [snapshot-poll queue] ────▶ SnapshotPollWorker
        (BullMQ repeatable)        └─ SunflowerClient.getFarm → SnapshotService.save() (SHA dedup)
                                       └─ on GENUINELY NEW snapshot ─▶ enqueue replan(farmId)
                                                                          │
   [replan queue] ◀── material market-move trigger (debounced) ──────────┘
        │
        ▼
   ReplanWorker  (dedicated `worker` container — heavy simulation OFF the API event loop)
        │  1. load snapshot timeline        → backward model (FarmDelta history + DailyMetrics)
        │  2. calibrate forward model        → predicted(lastStep) vs observed(lastDelta) → error, confidence
        │  3. beam-search counterfactual futures  → forward model + utility scorer, horizon N days
        │  4. persist StrategyPolicy         → Redis (hot) + Postgres strategy_plans (audit)
        ▼
   Redis StrategyPolicy cache ──read──▶ get_best_plan tool ──▶ Explainer (narrates; never computes)
        │                                                              ▲
        └─ planChangedAt flag ──▶ proactive surfacing ────────────────┘  (chat banner now; Web Push later)
```

**Key properties:**

- **Determinism.** The simulation core (`applyAction`, beam search, objective) is pure, seedless, and reproducible: identical inputs always yield the identical policy. This makes it testable, provenance-stampable, and calibratable.
- **Separation of poll vs plan.** The poller keeps the timeline fresh (and delivers the "scheduled background snapshots" backlog item); the planner does the thinking. They are independent BullMQ jobs so a slow simulation never blocks snapshot capture.
- **Heavy work off the API.** Simulation runs in a dedicated worker container, so chat latency is unaffected.
- **Graceful read path.** Chat reads a *cached* policy; if none exists yet it degrades to the existing live `get_roadmap`.

---

## 3. The shared forward / backward model (§ honesty foundation)

### 3.1 One `FarmDelta`, two directions

| Model | Direction | Function | Existing? |
|-------|-----------|----------|-----------|
| Backward (history) | `diff(stateₜ, stateₜ₊₁) → FarmDelta` | `calculateStateDelta` / `inferEventsFromDelta` in `historyContextExtractors.ts` | ✅ exists |
| Forward (simulator) | `apply(state, action) → { state', FarmDelta }` | `applyAction` in `core/simulation/` | ❌ new |

Both produce the same `FarmDelta` (`server/domain/history.ts`) and roll up through the same `aggregateDailyMetrics`. A simulated day and a real day are therefore **the same kind of object**, scored by the same code.

### 3.2 `applyAction` (new, pure)

```
applyAction(state: NormalizedFarmState, action: SimAction, ctx: SimContext)
  → { nextState: NormalizedFarmState, delta: FarmDelta, feasible: boolean, blocker?: string }
```

- Clones state (zero side effects — same discipline as today's `simulate_what_if`).
- Applies the action's exact game mechanics: ingredient/resource consumption, yield, XP award, cook/grow timers, FLOWER in/out, boosts via `resolveEffectContext`.
- Emits a `FarmDelta` describing the transition, so the result is directly comparable to observed history.
- Returns `feasible:false` + `blocker` when prerequisites aren't met (missing building, insufficient stock) instead of throwing.

### 3.3 Source of truth for mechanics

Exact yields, cook times, costs, and boost math are encoded from the **open-source game repository** (`https://github.com/sunflower-land/sunflower-land`) and cross-checked against the repo's existing `server/data/*.json` and `core/` engines (`calculateFoodXp`, `recipeService`, `effectResolver`). Where an existing core function already computes a mechanic (e.g. `calculateFoodXp` for cooking), `applyAction` **reuses it** rather than re-deriving — guaranteeing sim numbers match dashboard numbers.

### 3.4 `SimAction` types (first cut)

`cook` · `sell` · `buy` · `harvest` · `plant` · `feed_animal` · `gather` (mine/chop/forage). Building construction and land expansion are represented as discrete **milestone actions** (a cost/time/level gate that flips a capability on), not tile-level simulation. Fishing and greenhouse are deferred.

---

## 4. The search — deterministic beam + counterfactuals

### 4.1 Loop

```
frontier = [ initialTrajectory(currentState) ]
for day in 1..HORIZON (default 7 in-game days):
    next = []
    for traj in frontier:
        candidates = generateCandidates(traj.state, goal, ctx)      // reuse Phase-5 planner
        for c in top-K candidates:
            { nextState, delta, feasible } = applyAction(traj.state, c.action, ctx)
            if not feasible: continue
            next.push(traj.extend(c.action, nextState, delta))
    frontier = topK(next, by = utility(trajectory))                 // beam width K
best = argmax(frontier, utility)
counterfactuals = topM(rejected trajectories that diverged from best)
```

- **`generateCandidates`, `scoreCandidate`, `deriveScoreWeights`, `evaluateFeasibility`** already exist in `server/core/planner/` and are reused — the search is a new *driver* over existing candidate/scoring primitives, not a new scorer.
- **Beam width `K`** and **horizon `N`** are config constants (defaults K≈5, N=7 in-game days) tuned for per-farm cost.

### 4.2 Objective

- **Default (open-ended maximizer):** balanced XP/FLOWER-per-day utility with default weights.
- **Goal-directed (when the player sets a target):** weights shift toward fastest/cheapest path to the target (reach Level N, afford Island X, complete deliveries, earn F FLOWER). Goal → weights via `deriveScoreWeights`.
- Utility is evaluated over the **trajectory's `DailyMetrics`**, i.e. the same valuation as real history.

### 4.3 Counterfactuals

The search retains the top few *rejected* trajectories that meaningfully diverge from the winner. The policy stores them so the proactive output can explain **why the chosen path wins** over alternatives the player might actually attempt ("selling on day 2 → −1,200 XP but +8 FLOWER; rejected because your goal weights XP").

---

## 5. Runtime — BullMQ workers

New dependency: **BullMQ** (on the Redis already in the stack). New `worker` service in `docker-compose.yml` (same image, different entrypoint).

| Job | Trigger | Responsibility |
|-----|---------|----------------|
| `snapshot-poll` | Repeatable, ~6h per bound farm | `getFarm` → `SnapshotService.save` (SHA dedup). Enqueue `replan` only if the snapshot is genuinely new. Delivers the "scheduled background snapshots" backlog item. |
| `replan` | New snapshot **or** material market-price delta (debounced) | Run the full timeline→calibrate→search→persist pipeline for one farm. Idempotent, deduped per farm, retried with backoff. |

- **Concurrency-capped** so many farms don't stampede the Community API; reuses `SunflowerClient`'s in-flight dedup + TTL cache.
- Queues, workers, and their config live under **`server/workers/`**; the worker entrypoint boots only the queue consumers (no Express).

---

## 6. Storage & consumption

### 6.1 `StrategyPolicy` (Redis hot cache)

Keyed `strategy:{farmId}:{goalId|DEFAULT}`:

```
{
  farmId, goalId, computedAt, planChangedAt,
  horizonDays, objective,
  plan: Array<{ day, actions[], projectedXp, projectedNetFlower, reasoning }>,
  projected: { totalXp, totalNetFlower, goalReached?, etaDays? },
  counterfactuals: Array<{ label, deltaXp, deltaFlower, whyRejected }>,
  calibration: { confidence: 'HIGH'|'MEDIUM'|'LOW', recentErrorPct },
  provenance
}
```

### 6.2 `strategy_plans` (Postgres audit)

One row per re-plan: `(id, user_id, farm_id, goal_id, computed_at, policy_json, confidence)`. Powers the "plan changed since last cycle" diff and later analytics. Indexed `(farm_id, computed_at DESC)`.

### 6.3 Chat read path

- New deterministic tool **`get_best_plan`** returns the cached policy for the farm+goal. It **never runs the search inline** — worst case it reports "no plan computed yet" and the Planner falls back to a live `get_roadmap`.
- The **Planner** (LLM classifier + deterministic fallback from Slice 1) routes intents like "what's my best path", "plan my week", "what should I focus on to reach level 75" to `get_best_plan`.
- The **Explainer** narrates the cached plan and its counterfactuals under the core invariant, citing the policy's exact numbers and stating the confidence tier.

### 6.4 Proactive surfacing

`planChangedAt` lets a chat session open with "Your optimal plan changed since yesterday — want the update?" Web Push delivery (an existing backlog item) is the eventual channel and is **out of scope** here.

---

## 7. Calibration & honesty

Each `replan` cycle:

1. Take the step the player **actually** took since the last cycle (from the newest `FarmDelta`).
2. Run `applyAction` on the *previous* state for the closest matching action → predicted delta.
3. Compare predicted vs observed (XP, FLOWER, key inventory) → `recentErrorPct`.
4. Derive a **confidence tier** (`HIGH`/`MEDIUM`/`LOW`) from a rolling window of recent error.

The policy carries this tier; the Explainer states low confidence plainly ("market moved more than the model expected — treat FLOWER projections as rough"). This is the mechanism that keeps the agent honest instead of confidently wrong.

---

## 8. Error handling & fallback

| Failure | Behaviour |
|---------|-----------|
| Community API down during poll | Serve stale, skip `replan` enqueue; timeline simply gets no new point. |
| `replan` worker error / crash | BullMQ retry with backoff; last good policy stays cached. |
| No policy cached yet (cold farm) | `get_best_plan` reports "not computed yet"; Planner falls back to live `get_roadmap`. |
| Forward model low confidence | Policy still served, tagged `LOW`; Explainer states the caveat. |
| Redis unavailable | `get_best_plan` degrades to `get_roadmap`; poller/worker retry. |

Nothing hard-fails; worst case is today's reactive behaviour.

---

## 9. Determinism & the core invariant

- `core/simulation/` is pure: no Express, Redis, BullMQ, Postgres, or LLM imports (same rule as `core/`). Seedless beam search → reproducible.
- The worker/service layer does the I/O; the LLM only explains the cached, provenance-stamped policy.
- Every projected number traces to `applyAction` + live prices + the shared valuation — no number originates in the LLM.

---

## 10. Components summary

| Component | File(s) | Layer | Responsibility |
|-----------|---------|-------|----------------|
| `applyAction` + `SimAction` | `server/core/simulation/forwardModel.ts` (new) | pure core | `apply(state, action) → { state', FarmDelta }`, reusing existing mechanic engines. |
| Beam search + objective | `server/core/simulation/search.ts` (new) | pure core | Deterministic trajectory search over `generateCandidates` + utility. |
| `SimulationService` | `server/services/simulation/SimulationService.ts` (new) | service | Timeline → calibrate → search → build `StrategyPolicy`. |
| `CalibrationService` | `server/services/simulation/CalibrationService.ts` (new) | service | Predicted-vs-observed error, confidence tier. |
| Queues + workers | `server/workers/` (new) + `docker-compose.yml` | infra | `snapshot-poll` + `replan` (BullMQ), worker entrypoint. |
| `StrategyPolicy` store | Redis (hot store extension) + `strategy_plans` (Postgres) | storage | Cached policy + audit history. |
| `get_best_plan` tool | `server/services/ai/Orchestrator.ts` | AI | Read-only cached-policy tool; Planner routes to it; Explainer narrates. |

---

## 11. Testing

- **Forward model (unit):** `applyAction` produces the exact delta for a known action; infeasible actions return `feasible:false` not a throw; sim XP matches `calculateFoodXp` for the same cook.
- **Objective parity (unit):** a simulated day and a replayed real day with identical deltas score identically under `aggregateDailyMetrics`.
- **Calibration (unit):** replaying a real timeline, predicted deltas match observed within tolerance; injected drift lowers the confidence tier.
- **Search determinism (unit):** identical inputs → identical policy; horizon/beam bounds respected.
- **Worker/queue (integration):** `snapshot-poll` dedups and only enqueues `replan` on a new snapshot; `replan` is idempotent per farm. In-memory Redis.
- **Tool (integration):** `get_best_plan` returns the cached policy; cold farm degrades to `get_roadmap`. Follows existing `orchestrator.test.ts` style.
- **Regression:** a projected number never appears without a matching `applyAction` provenance trail.

---

## 12. Out of scope — future work

- **MCTS / uncertainty modelling** (market-swing distributions, RNG drops) — deterministic beam search first; upgrade once trusted.
- **Web Push proactive delivery** — chat banner now; push is its own backlog item.
- **Tile-level building & land-expansion simulation** — milestone-level only for now.
- **Multi-farm switching** — one bound farm per user for this slice.
- **Fishing & greenhouse action modelling** — deferred to a later action-set expansion.

---

## 13. Decisions (resolved)

1. **Objective (§4.2):** open-ended maximizer by default, goal-directed when a target is set (layered). ✅
2. **Search (§4):** deterministic beam search as the engine; explicit counterfactuals as the presentation layer. MCTS deferred. ✅
3. **Runtime (§5):** BullMQ + dedicated worker container; ~6h poll + re-plan on new snapshot / material market move. ✅
4. **Scope:** forward model, search, workers, policy cache/audit, `get_best_plan`, calibration — this spec. Items in §12 deferred to their own specs. ✅
