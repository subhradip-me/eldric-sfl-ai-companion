# 02. Modules & Component Catalog 📦

This document provides a comprehensive catalog of all modules, classes, and responsibilities across the backend and frontend codebases, complete with exact code snippets illustrating their internal mechanics.

---

## 1. Backend Modules (`server/`)

### 1.1 Core Bootstrap (`server/index.ts`)
The main server entry point. Boots the Express application, sets up global middlewares, handles connection retries, and mounts routes:

```typescript
// server/index.ts - Express Server Bootstrap
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pool } from './db/database.js';
import authRoutes from './routes/auth.js';
import farmRoutes from './routes/farm.js';
import chatRoutes from './routes/chat.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api', farmRoutes);
app.use('/api', chatRoutes);

// Database connection retry loop
async function connectWithRetry(attempts = 10, delay = 2000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT NOW()');
      console.log('✅ Connected to PostgreSQL database');
      return;
    } catch (err) {
      console.warn(`⚠️ DB connection attempt ${i}/${attempts} failed: ${(err as Error).message}`);
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

---

### 1.2 Class-Based Controllers (`server/controllers/`)

#### `AuthController.ts`
Manages user authentication lifecycle, registration, credentials validation, profile inspection, and farm binding:

```typescript
// server/controllers/AuthController.ts - Authentication controller
export class AuthController {
  async register(req: Request, res: Response) {
    const { username, email, password, farmId } = req.body;
    // Validates inputs, creates user via AuthService, issues JWT
    const { user, token } = await authService.register(username, email, password, farmId);
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    return res.json({ success: true, user, token });
  }

  async login(req: Request, res: Response) {
    const { username, password } = req.body;
    const { user, token } = await authService.login(username, password);
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    return res.json({ success: true, user, token });
  }

  async me(req: Request, res: Response) {
    const user = await User.findById(req.user!.userId);
    return res.json({ user });
  }

  async updateFarmId(req: Request, res: Response) {
    const { farmId } = req.body;
    await User.updateFarmId(req.user!.userId, farmId);
    return res.json({ success: true, farmId });
  }
}
```

#### `FarmController.ts`
Orchestrates game state retrieval, real-time market pricing, cooking optimization, and activity snapshots:

```typescript
// server/controllers/FarmController.ts - Farm operations controller
export class FarmController {
  async getFarmData(req: Request, res: Response) {
    const farmId = (req.query.farmId as string) || req.user?.farmId;
    const { canonical, stale, cached } = await sunflowerClient.getFarm(farmId);
    if (req.user?.userId) {
      snapshotService.save(canonical, req.user.userId).catch(() => {});
    }
    return res.json({ farm: canonical, stale, cached });
  }

  async getMarket(_req: Request, res: Response) {
    const { prices, updatedAt, stale, cached } = await sunflowerClient.getPrices();
    return res.json({ prices, updatedAt, stale, cached });
  }

  async getPlanner(req: Request, res: Response) {
    const farmId = (req.query.farmId as string) || req.user?.farmId;
    const [{ canonical }, { prices }] = await Promise.all([
      sunflowerClient.getFarm(farmId),
      sunflowerClient.getPrices(),
    ]);
    const plan = plannerService.plan(canonical, prices, recipes as any, items as any, modifiers as any);
    return res.json(plan);
  }

  async getActivity(req: Request, res: Response) {
    const snaps = await snapshotService.latest(req.user!.userId, 2);
    if (snaps.length < 2) return res.json({ observed: {}, inferred: {}, note: 'Need 2 snapshots' });
    const diff = activityService.diff(snaps[1], snaps[0]);
    return res.json(diff);
  }
}
```

#### `ChatController.ts`
Handles conversational assistant requests, thread retrieval, and session cleanup:

```typescript
// server/controllers/ChatController.ts - Conversational AI controller
export class ChatController {
  async sendMessage(req: Request, res: Response) {
    const { message, sessionId } = req.body;
    const { answer, steps } = await orchestrator.runAgent(
      message,
      sessionId,
      req.user!.userId,
      req.user!.farmId || process.env.SUNFLOWER_FARM_ID!
    );
    return res.json({ answer, steps });
  }

  async getSessions(req: Request, res: Response) {
    const sessions = await chatStoreService.getRecentSessions(req.user!.userId);
    return res.json({ sessions });
  }

  async getSession(req: Request, res: Response) {
    const messages = await chatStoreService.getSessionMessages(req.params.sessionId, req.user!.userId);
    return res.json({ messages });
  }
}
```

---

### 1.3 Modular Business Services (`server/services/`)

#### 1. Cooking Domain (`server/services/cooking/`)

##### `XpEngine.ts`
Pure computational class that calculates skill-adjusted and VIP-boosted recipe yields and cook times:

```typescript
// server/services/cooking/XpEngine.ts
export class XpEngine {
  effective(
    recipeName: string,
    recipe: RecipeDefinition,
    farm: Partial<CanonicalFarmState> = {},
    customModifiers: Record<string, unknown> = {}
  ): EffectiveRecipe {
    let output = recipe.baseOutput ?? 1;
    let xpPerFood = recipe.baseXp ?? 0;
    let minutes = recipe.baseCookMinutes ?? 0;
    let ingredientMultiplier = 1;
    const applied: string[] = [];

    // VIP Multiplier (+10% multiplicative boost)
    if (farm.buffs?.vip && !recipe.xpIncludesSkills) {
      xpPerFood *= 1.1;
      applied.push('VIP Access');
    }

    // Munching Mastery skill (+5% Rank 1, +2.5% per subsequent rank)
    if (farm.skills?.['Munching Mastery'] && !recipe.xpIncludesSkills) {
      const rank = Number(farm.skills['Munching Mastery']) || 1;
      const mult = 1 + 0.05 + (rank - 1) * 0.025;
      xpPerFood *= mult;
      applied.push('Munching Mastery');
    }

    // Drive-Through Deli (+15% Deli XP)
    if (recipe.building === 'Deli' && farm.skills?.['Drive-Through Deli'] && !recipe.xpIncludesSkills) {
      const rank = Number(farm.skills['Drive-Through Deli']) || 1;
      xpPerFood *= 1 + 0.15 + (rank - 1) * 0.05;
      applied.push('Drive-Through Deli');
    }

    // Cook Time reductions (Fast Feasts, Swift Sizzle with active oil burner)
    const oilActive = (farm.buildings?.[recipe.building]?.oil ?? 0) > 0;
    if (recipe.building === 'Fire Pit' && farm.skills?.['Swift Sizzle'] && oilActive) {
      minutes *= 0.6; // -40% cook time
      applied.push('Swift Sizzle');
    }

    // Double Nom (2x output and 2x ingredients)
    if (farm.skills?.['Double Nom']) {
      output *= 2;
      ingredientMultiplier *= 2;
      applied.push('Double Nom');
    }

    return {
      recipe: recipeName,
      output,
      xpPerFood,
      minutes,
      batchXp: output * xpPerFood,
      ingredientMultiplier,
      applied,
    };
  }
}
```

##### `RecipeService.ts`
Expands multi-tier recipes down to base commodities and determines out-of-pocket market costs:

```typescript
// server/services/cooking/RecipeService.ts
export class RecipeService {
  expand(recipeName: string, recipes: Record<string, any>, depth = 0, multiplier = 1) {
    if (depth > 10) throw new Error('dependency cycle: ' + recipeName);
    const recipe = recipes[recipeName];
    if (!recipe) return { base: {}, intermediateMinutes: 0, missing: [recipeName] };

    const base: Record<string, number> = {};
    let intermediateMinutes = 0;

    for (const [ing, baseQty] of Object.entries(recipe.ingredients)) {
      const qty = (baseQty as number) * multiplier;
      if (recipes[ing]) {
        // Recursively resolve intermediate dishes (e.g. Cheese)
        const sub = this.expand(ing, recipes, depth + 1, 1);
        const crafts = qty / (recipes[ing].baseOutput ?? 1);
        for (const [k, v] of Object.entries(sub.base)) base[k] = (base[k] ?? 0) + v * crafts;
        intermediateMinutes += crafts * (recipes[ing].baseCookMinutes ?? 0) + sub.intermediateMinutes * crafts;
      } else {
        base[ing] = (base[ing] ?? 0) + qty;
      }
    }
    return { base, intermediateMinutes };
  }

  cost(baseResources: Record<string, number>, prices: MarketPrice, items: Record<string, any>, inventory: Record<string, number>) {
    let flower = 0;
    let totalFlower = 0;
    const buy: Record<string, number> = {};
    const mustProduce: Record<string, number> = {};

    for (const [item, qty] of Object.entries(baseResources)) {
      const price = this.getItemPrice(item, prices);
      if (price != null) totalFlower += qty * price;

      const toBuy = Math.max(qty - (inventory[item] ?? 0), 0);
      if (toBuy === 0) continue;

      if (items[item]?.tradable === false || price == null) {
        mustProduce[item] = toBuy;
      } else {
        buy[item] = toBuy;
        flower += toBuy * price;
      }
    }
    return { flower, totalFlower, buy, mustProduce };
  }
}
```

##### `PlannerService.ts`
Evaluates all recipes across owned buildings, optimizing for XP/FLOWER and milestone estimates to Level 100 (`L100 = 24_083_905 XP`):

```typescript
// server/services/cooking/PlannerService.ts
export class PlannerService {
  plan(farm: CanonicalFarmState, prices: MarketPrice, recipes: Record<string, unknown>, items: Record<string, unknown>, modifiers: Record<string, unknown>): CookingPlan {
    const remaining = Math.max(L100 - farm.bumpkin.xp, 0);
    const perBuilding: Record<string, CookingPlanCandidate> = {};

    for (const [name, recipe] of Object.entries(recipes)) {
      if (name.startsWith('_')) continue;
      const r = recipe as RecipeDefinition;
      if (!(r.building in farm.buildings)) continue; // Gated strictly on owned buildings

      const eff = xpEngine.effective(name, r, farm, modifiers);
      const dep = recipeService.expand(name, recipes, 0, eff.ingredientMultiplier ?? 1);
      const c = recipeService.cost(dep.base, prices, items, farm.inventory);
      const totalMinutes = eff.minutes + dep.intermediateMinutes;
      const flowerCost = +(c.totalFlower > 0 ? c.totalFlower : c.flower > 0 ? c.flower : 0.0001).toFixed(5);
      const batchesToLevel100 = Math.ceil(remaining / eff.batchXp);
      const totalMilestoneFlower = +(batchesToLevel100 * flowerCost).toFixed(2);

      const cand = {
        recipe: name,
        batchXp: eff.batchXp,
        flowerCost,
        flowerToBuy: +c.flower.toFixed(5),
        xpPerFlower: Math.round(eff.batchXp / flowerCost),
        xpPerHour: Math.round(eff.batchXp / (totalMinutes / 60)),
        batchesToLevel100,
        totalMilestoneFlower,
        totalMinutes,
        buy: c.buy,
        mustProduce: c.mustProduce,
      };

      const cur = perBuilding[r.building];
      if (!cur || cand.xpPerFlower > cur.xpPerFlower) perBuilding[r.building] = cand;
    }
    // Return structured CookingPlan
  }
}
```

---

#### 2. Farm Domain (`server/services/farm/`)

##### `SunflowerClient.ts`
Resilient HTTP client with tiered caching (Memory + Disk) and in-flight request deduplication:

```typescript
// server/services/farm/SunflowerClient.ts
export class SunflowerClient {
  private memCache: Record<string, CacheEntry> = {};
  private pending = new Map<string, Promise<unknown>>();

  async getFarm(farmId?: string | null) {
    const targetId = farmId || process.env.SUNFLOWER_FARM_ID;
    return this.cached(`farm:${targetId}`, 5 * 60_000, async () => {
      const raw = await this.get(`${process.env.SUNFLOWER_API_URL}/community/farms/${targetId}`);
      return { canonical: farmNormalizer.toCanonical(raw), raw };
    });
  }

  async getPrices() {
    return this.cached('prices', 10 * 60_000, async () => {
      const res = await this.get(process.env.PRICES_API_URL!);
      return { prices: res?.data?.p2p ?? {}, updatedAt: res?.updatedAt ?? null };
    });
  }
}
```

##### `FarmNormalizer.ts`
Transforms polymorphic raw SFL blockchain payloads into standard `CanonicalFarmState`:

```typescript
// server/services/farm/FarmNormalizer.ts
export class FarmNormalizer {
  toCanonical(raw: unknown): CanonicalFarmState {
    const f = ((raw as any).farm ?? raw) as Record<string, any>;
    const bumpkin = f.bumpkin ?? {};
    const xp = Number(bumpkin.experience ?? 0);
    const buildings: Record<string, { busyUntil: number | null; oil: number }> = {};

    for (const [name, arr] of Object.entries(f.buildings ?? {})) {
      const b = Array.isArray(arr) ? arr[0] : arr;
      const crafting = (b?.crafting ?? []) as Array<{ readyAt?: number }>;
      const busyUntil = crafting.length ? Math.max(...crafting.map((c) => c.readyAt ?? 0)) : null;
      buildings[name] = { busyUntil, oil: Number(b?.oil ?? 0) };
    }

    return {
      bumpkin: { level: this.levelFromXp(xp), xp },
      currencies: {
        flower: String(f.balance ?? '0'),
        flowerApprox: Number(f.balance ?? 0),
        coins: Number(f.coins ?? 0),
      },
      inventory: this.normalizeInventory(f.inventory),
      skills: bumpkin.skills ?? {},
      buildings,
      buffs: { vip: (f.vip?.expiresAt ?? 0) > Date.now() },
      fetchedAt: Date.now(),
    };
  }
}
```

##### `SnapshotService.ts` & `ActivityService.ts`
Maintains historical time-series logs and deduces observed vs inferred delta activities:

```typescript
// server/services/farm/SnapshotService.ts
export class SnapshotService {
  private hash(c: CanonicalFarmState): string {
    return crypto.createHash('sha1').update(JSON.stringify([c.bumpkin.xp, c.farmActivity, c.inventory])).digest('hex');
  }

  async save(canonical: CanonicalFarmState, userId: number) {
    const h = this.hash(canonical);
    const last = await pool.query('SELECT state_hash FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
    if (last.rows[0]?.state_hash === h) return { saved: false, reason: 'unchanged' };

    await pool.query(
      'INSERT INTO snapshots (user_id, created_at, xp, flower, coins, state_hash, data_json) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, Date.now(), canonical.bumpkin.xp, canonical.currencies.flower, canonical.currencies.coins, h, canonical]
    );
    return { saved: true };
  }

  async latest(userId: number, n = 2): Promise<CanonicalFarmState[]> {
    const r = await pool.query('SELECT data_json FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, n]);
    return r.rows.map((row) => row.data_json);
  }
}
```

---

#### 3. AI Agent Domain (`server/services/ai/`)

##### `Orchestrator.ts`
Autonomous agent running a multi-turn tool execution loop using Groq Cloud LLM. Features deduplication bypass via `force: true` and building ownership verification:

```typescript
// server/services/ai/Orchestrator.ts - Tool Execution Engine
export class Orchestrator {
  public readonly tools: Record<string, ToolDef> = {
    get_farm_state: { /* ... */ },
    compute_recipe_cost: {
      description: 'Deterministic recipe economics. Warns if the player lacks the required building.',
      parameters: { type: 'object', properties: { recipe: { type: 'string' } }, required: ['recipe'] },
      exec: async ({ recipe }, context) => {
        const [{ canonical }, { prices }] = await Promise.all([sunflowerClient.getFarm(context.farmId), sunflowerClient.getPrices()]);
        const r = recipes[recipe];
        const ownsBuilding = r.building in canonical.buildings;
        const eff = xpEngine.effective(recipe, r, canonical, modifiers);
        const dep = recipeService.expand(recipe, recipes, 0, eff.ingredientMultiplier ?? 1);
        const c = recipeService.cost(dep.base, prices, items, canonical.inventory);
        return {
          recipe,
          ownsBuilding,
          warning: ownsBuilding ? null : `⚠️ You do NOT own a ${r.building}!`,
          effective: eff,
          cost: c,
        };
      },
    },
    // 10 other tools: get_planner, get_cooking_board, get_expansion_guide, etc.
  };

  async runAgent(message: string, sessionId: string, userId: number, farmId: string) {
    // 8-round iterative loop with tool execution, dedup bypass, and fallback recovery
  }
}
```

---

## 2. Frontend Modules (`client/src/`)

### 2.1 Workspace & Views (`client/src/App.jsx`)
Main workspace shell implementing the hybrid Obsidian + Notion layout:
- **`Dashboard`**: Bumpkin Level 100 progress gauge, treasury stats, active cooking overviews.
- **`Planner`**: Full per-building recipe comparison table, XP/FLOWER vs XP/Hour toggles, and daily blueprints.
- **`Recipes`**: Building-by-building catalogue with `Ready` and `Missing` filters.
- **`Market`**: Orderbook valuation, inventory stock filters, and deficit alerts.
- **`Activity`**: Observed on-chain counters vs inferred inventory movements.
- **`Quests`**: Deliveries, chore board, and animal bounties.
- **`AntigravityChatModal`**: Floating Dr. Bumpkin copilot with markdown formatting and tool inspection.
