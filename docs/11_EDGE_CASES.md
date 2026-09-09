# 11. Edge Cases & Boundary Handling Matrix 🛡️

This document outlines edge cases, boundary conditions, failure modes, and automated defensive mitigations across the Sunflower AI platform.

---

## 1. Edge Case Matrix

| Domain | Edge Case Scenario | Potential Impact | Implemented Mitigation |
|---|---|---|---|
| **Auth** | User accesses protected route before linking a Farm ID | `NullPointerException` on unlinked state | `requireFarmId` middleware intercepts request and returns `400 Bad Request`. Client conditionally mounts `FarmSetup` instead of canvas. |
| **Auth** | Tampered or expired JWT token | Unauthorized access or silent state failure | `jwt.verify` fails with `JsonWebTokenError` / `TokenExpiredError`. Returns HTTP 403; client clears `localStorage` and redirects to login. |
| **Game Math** | Recipe requires 0 FLOWER cost (all ingredients owned in bag) | Division by zero: `batchXp / flowerCost` returns `Infinity` | `isFinite(b.xpPerFlower) && b.xpPerFlower > 0 ? fmt(b.xpPerFlower) : "—"` guard displays clean infinity-safe dash. |
| **Game Math** | New farm with Level 1 Bumpkin (0 XP) | Progress bar NaN or zero-division | Safe calculation: `Math.min((farm.bumpkin.xp / farm.target.xp) * 100, 100).toFixed(1)` defaulting nulls to 0. |
| **Game Math** | Untradable ingredient deficit (e.g. Milk, Eggs, Honey) | Player cannot purchase missing items on market | Planner separates required items into `mustProduce` vs `buy`. Renders a high-priority "Resource Deficit Warning" callout. |
| **Game Math** | Intermediate craftables (e.g. Cheese used in Honey Cheddar) | Circular dependency or infinite cost recursion | `isIntermediate` flag tags intermediate foods. Recursion depth is capped and ingredients evaluated hierarchically. |
| **API / Network** | SFL Community API returns HTTP 429 during cold start | No in-memory or disk cache available to serve | `sunflower.js` catches error and returns `null`. Frontend renders graceful skeleton loader with retry pill. |
| **API / Network** | Concurrent identical requests for same Farm ID | Redundant outbound network calls, rate limits | `pending = new Map()` in-flight deduplication shares single outbound Promise across all concurrent callers. |
| **AI / RAG** | Chat history exceeds LLM context token window | LLM provider throws context limit error | Orchestrator does not dump raw session history; retrieves top 4 vector-matched turns via cosine similarity + latest 2 turns. |
| **AI / RAG** | First-time vector model download timeout | Chat freezes indefinitely | Local embedder download is wrapped in try/catch; if model fails, system falls back to keyword-based context injection. |
| **Database** | PostgreSQL container starts slower than Express | Backend container crash loop | Exponential backoff retry loop (`connectWithRetry`) attempts connection 10 times with up to 32s delays before entering limited mode. |
| **Database** | SQL injection attempt in username or session ID | Data leakage or database corruption | 100% of queries use parameterized prepared statements (`$1, $2, ...`). Zero raw string interpolation. |

---

## 2. Code Mitigations in Detail

### 2.1 Division-by-Zero and Number Sanitization
```javascript
// server/services/xpEngine.js
export function fmt(n, decimals = 0) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
```

### 2.2 Ingredient Deficit Partitioning
```javascript
// server/services/planner.js
const missing = r.missingIngredients || {};
const mustProduce = {};
const canBuy = {};

for (const [item, qty] of Object.entries(missing)) {
  if (TRADABLE_ITEMS.has(item)) {
    canBuy[item] = qty;
  } else {
    mustProduce[item] = qty;
  }
}
```
If `Object.keys(mustProduce).length > 0`, the planner flags the blueprint as `affordable = false` and alerts the player to active farming requirements.
