# 08. Data Models & Entity Schema Mapping 🗺️

## 1. Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    USERS ||--o{ SNAPSHOTS : "owns"
    USERS ||--o{ CHAT_MESSAGES : "creates"
    USERS ||--o{ ACTIVE_SESSIONS : "authenticates"
    KB_DOCUMENTS ||--o{ KB_CHUNKS : "chunked into"

    USERS {
        int id PK
        string username UK
        string email UK
        string password_hash
        string farm_id
        string registration_ip
        string role
        int ai_credits
        int ai_credits_used
        timestamp created_at
        timestamp updated_at
        timestamp last_login
    }

    ACTIVE_SESSIONS {
        int id PK
        int user_id FK
        string device_type UK
        text refresh_token_hash
        timestamp created_at
        timestamp last_active_at
    }

    SNAPSHOTS {
        int id PK
        int user_id FK
        bigint created_at
        double xp
        string flower
        double coins
        string state_hash
        jsonb data_json
    }

    CHAT_MESSAGES {
        int id PK
        string session_id
        string role
        text content
        vector_384 embedding
        int user_id FK
        bigint created_at
    }

    KB_DOCUMENTS {
        uuid id PK
        string source
        string path UK
        string url
        string title
        string content_hash
        timestamptz wiki_updated_at
        timestamptz created_at
        timestamptz updated_at
    }

    KB_CHUNKS {
        uuid id PK
        uuid document_id FK
        string_array heading_path
        int chunk_index
        string category
        string type
        string entity
        text content
        jsonb structured_data
        string content_hash
        vector_384 embedding
        timestamptz created_at
        timestamptz updated_at
    }
```

---

## 2. Database Table Schemas

### 2.1 `users`
Represents registered user accounts, workspace owners, IP attribution, and AI credit quotas.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | Auto-incrementing unique user identifier |
| `username` | `VARCHAR(50)` | `UNIQUE NOT NULL` | Player handle for login |
| `email` | `VARCHAR(255)` | `UNIQUE NOT NULL` | Verified user email address |
| `password_hash` | `VARCHAR(255)` | `NOT NULL` | bcrypt hash (salt rounds = 10) |
| `farm_id` | `VARCHAR(100)` | `NULLABLE` | Sunflower Land on-chain Farm NFT ID |
| `registration_ip`| `VARCHAR(45)` | `NULLABLE` | IP address at registration (1-Account-Per-IP gate) |
| `role` | `VARCHAR(20)` | `DEFAULT 'USER'` | Authorization tier: `'USER'` or `'DEVELOPER'` |
| `ai_credits` | `INTEGER` | `DEFAULT 50` | Available AI invocation credits |
| `ai_credits_used`| `INTEGER` | `DEFAULT 0` | Cumulative AI credits consumed |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Account creation timestamp |
| `updated_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Last profile update timestamp |
| `last_login` | `TIMESTAMP` | `NULLABLE` | Timestamp of most recent successful login |

**Indexes**: `idx_users_username`, `idx_users_email`, `idx_users_farm_id`, `idx_users_registration_ip`.

### 2.2 `active_sessions`
Enforces the concurrent dual-device session limit (1 Desktop + 1 Mobile per user).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | Auto-incrementing session identifier |
| `user_id` | `INTEGER` | `REFERENCES users(id) ON DELETE CASCADE` | Associated workspace owner |
| `device_type` | `VARCHAR(10)` | `CHECK (device_type IN ('desktop', 'mobile'))` | Client device form factor |
| `refresh_token_hash` | `TEXT` | `NOT NULL` | SHA-256 hash of issued refresh token |
| `created_at` | `TIMESTAMP` | `DEFAULT now()` | Session initiation timestamp |
| `last_active_at` | `TIMESTAMP` | `DEFAULT now()` | Timestamp of most recent token refresh |

**Indexes**: `idx_one_session_per_device_type UNIQUE (user_id, device_type)`.

### 2.3 `snapshots`
Time-series log of farm state observations used for activity and progression analysis.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | Unique snapshot identifier |
| `user_id` | `INTEGER` | `REFERENCES users(id) ON DELETE CASCADE` | Associated workspace owner |
| `created_at` | `BIGINT` | `NOT NULL` | Epoch milliseconds when recorded |
| `xp` | `DOUBLE PRECISION` | `NULLABLE` | Bumpkin XP at time of snapshot |
| `flower` | `TEXT` | `NULLABLE` | FLOWER currency treasury balance (18-dp string) |
| `coins` | `DOUBLE PRECISION` | `NULLABLE` | Liquid Gold Coins balance |
| `state_hash` | `TEXT` | `NULLABLE` | SHA-1 hash of `[xp, farmActivity, inventory]` |
| `data_json` | `JSONB` | `NOT NULL` | Complete `CanonicalFarmState` JSON document |

**Indexes**: `idx_snapshots_user_created (user_id, created_at DESC)`, `idx_snapshots_created`.

### 2.4 `chat_messages`
Stores assistant conversation logs and vector embeddings for semantic search.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | Unique message identifier |
| `session_id` | `TEXT` | `NOT NULL` | UUID grouping conversational threads |
| `role` | `TEXT` | `NOT NULL` | Message author: `'user'`, `'assistant'`, or `'system'` |
| `content` | `TEXT` | `NOT NULL` | Message body (supports GitHub Flavored Markdown) |
| `embedding` | `vector(384)` | `NULLABLE` | Normalized text vector embedding (`all-MiniLM-L6-v2`) |
| `user_id` | `INTEGER` | `REFERENCES users(id) ON DELETE CASCADE` | Associated workspace owner |
| `created_at` | `BIGINT` | `NOT NULL` | Epoch milliseconds when sent |

**Indexes**: `idx_chat_session`, `idx_chat_user_session (user_id, session_id, created_at)`.

### 2.5 `kb_documents`
One row per ingested knowledge-base source document (a wiki page or an extracted game-data catalog), created by the `sfl-kb-ingest` scripts. Keyed by `content_hash` so unchanged documents are skipped on re-ingest.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique document identifier |
| `source` | `TEXT` | `NOT NULL DEFAULT 'sfl-wiki'` | Corpus origin (`sfl-wiki`, game data, etc.) |
| `path` | `TEXT` | `UNIQUE NOT NULL` | Source-relative document path |
| `url` | `TEXT` | `NULLABLE` | Canonical wiki URL (if applicable) |
| `title` | `TEXT` | `NULLABLE` | Document title |
| `description` | `TEXT` | `NULLABLE` | Short description / summary |
| `author_name` | `TEXT` | `NULLABLE` | Wiki author attribution |
| `wiki_updated_at` | `TIMESTAMPTZ` | `NULLABLE` | Upstream last-modified time |
| `content_hash` | `TEXT` | `NOT NULL` | Hash of source content (idempotent re-ingest) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Last update timestamp |

### 2.6 `kb_chunks`
Chunked, embedded segments of each `kb_documents` row — the vector-searchable unit queried by `KnowledgeService`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique chunk identifier |
| `document_id` | `UUID` | `REFERENCES kb_documents(id) ON DELETE CASCADE` | Parent document |
| `heading_path` | `TEXT[]` | `NOT NULL` | Heading breadcrumb within the document |
| `chunk_index` | `INT` | `NOT NULL DEFAULT 0` | Ordinal position within the document |
| `category` | `TEXT` | `NULLABLE` | Semantic category (indexed) |
| `type` | `TEXT` | `NULLABLE` | Entity/content type (indexed) |
| `entity` | `TEXT` | `NULLABLE` | Named entity the chunk resolves (indexed) |
| `content` | `TEXT` | `NOT NULL` | Chunk text |
| `structured_data` | `JSONB` | `NULLABLE` | Structured payload for game-data chunks |
| `content_hash` | `TEXT` | `NOT NULL` | Hash of chunk content (idempotent re-ingest) |
| `embedding` | `vector(384)` | `NULLABLE` | Chunk embedding (`all-MiniLM-L6-v2`) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Last update timestamp |

**Constraints**: `UNIQUE (document_id, heading_path, chunk_index)`.
**Indexes**: `kb_chunks_embedding_idx` (HNSW, `vector_cosine_ops`), `kb_chunks_category_idx`, `kb_chunks_type_idx`, `kb_chunks_entity_idx`.

---

## 3. TypeScript Domain Interfaces (`server/types/index.ts`)

### 3.1 Canonical Farm State & Bumpkin State
```typescript
export interface BumpkinState {
  level: number;
  xp: number;
}

export interface CurrencyState {
  flower: string;      // 18-decimal string — never convert to float for money
  flowerApprox: number;
  sfl: number;
  coins: number;
}

export interface BuildingState {
  busyUntil: number | null;
  oil: number;
}

export interface CanonicalFarmState {
  bumpkin: BumpkinState;
  currencies: CurrencyState;
  inventory: Record<string, number>;
  skills: Record<string, number | boolean>;
  wearables: Record<string, string>;
  buffs: { vip: boolean; active: string[] };
  buildings: Record<string, BuildingState>;
  farmActivity: Record<string, number>;
  deliveries: DeliveryOrder[];
  chores: Record<string, unknown>;
  bounties: { requests: unknown[]; completed: unknown[] };
  fetchedAt: number;
  stale?: boolean;
  cached?: boolean;
}
```

### 3.2 Recipe & Economic Modeling
```typescript
export interface RecipeDefinition {
  building: string;
  baseXp: number;
  baseCookMinutes: number;
  baseOutput?: number;
  instantGems?: number;
  ingredients: Record<string, number>;
  verified?: boolean;
  xpIncludesSkills?: boolean;
}

export interface EffectiveRecipe {
  recipe: string;
  output: number;
  xpPerFood: number;
  minutes: number;
  batchXp: number;
  ingredientMultiplier: number;
  effectiveIngredients: Record<string, number>;
  applied: string[];
  boostBreakdown: Array<{ skill: string; rank: number; label: string }>;
}

export interface CostResult {
  flower: number;       // Out-of-pocket FLOWER to buy missing items
  totalFlower: number;  // Full FLOWER market valuation
  buy: Record<string, number>;
  mustProduce: Record<string, number>;
  unpriced: string[];
}
```

### 3.3 Cooking Plan & Milestone Forecasting
```typescript
export interface CookingPlanCandidate {
  recipe: string;
  verified: boolean;
  batchXp: number;
  flowerCost: number;
  flowerToBuy: number;
  buy: Record<string, number>;
  mustProduce: Record<string, number>;
  totalMinutes: number;
  xpPerFlower: number;
  xpPerHour: number;
  modifiers: string[];
  batchesToLevel100: number;
  totalMilestoneFlower: number;
}

export interface CookingPlanBuilding extends CookingPlanCandidate {
  building: string;
}

export interface CookingPlan {
  target: { level: number; xp: number; remaining: number };
  affordable: boolean;
  budget: { flower: string; coins: number };
  buildings: CookingPlanBuilding[];
  farm: string[];
  buy: string[];
  estimate?: {
    batches: number;
    flower: number;
    recipe: string;
    building: string;
    totalMilestoneFlower: number;
  };
  notes: string[];
}
```

---

## 4. Class Method Signatures

### 4.1 Controllers
- `AuthController`:
  - `register(req: Request, res: Response): Promise<Response>`
  - `login(req: Request, res: Response): Promise<Response>`
  - `me(req: Request, res: Response): Promise<Response>`
  - `updateFarmId(req: Request, res: Response): Promise<Response>`
  - `changePassword(req: Request, res: Response): Promise<Response>`
- `FarmController`:
  - `getFarmData(req: Request, res: Response): Promise<Response>`
  - `getMarket(req: Request, res: Response): Promise<Response>`
  - `getPlanner(req: Request, res: Response): Promise<Response>`
  - `getActivity(req: Request, res: Response): Promise<Response>`
  - `getXpProgression(req: Request, res: Response): Promise<Response>`
  - `getRecipes(req: Request, res: Response): Promise<Response>`
- `ChatController`:
  - `sendMessage(req: Request, res: Response): Promise<Response>`
  - `getSessions(req: Request, res: Response): Promise<Response>`
  - `getSession(req: Request, res: Response): Promise<Response>`
  - `deleteSession(req: Request, res: Response): Promise<Response>`

### 4.2 Services
- `SunflowerClient`:
  - `getFarm(farmId?: string | null): Promise<RawFarmResponse & { stale: boolean; cached: boolean }>`
  - `getPrices(): Promise<MarketResponse & { stale: boolean; cached: boolean }>`
- `FarmNormalizer`:
  - `toCanonical(raw: unknown): CanonicalFarmState`
  - `levelFromXp(xp: number): number`
- `XpEngine`:
  - `effective(recipeName: string, recipe: RecipeDefinition, farm?: Partial<CanonicalFarmState>, customModifiers?: Record<string, unknown>): EffectiveRecipe`
- `RecipeService`:
  - `expand(recipeName: string, recipes: Record<string, any>, depth?: number, multiplier?: number): ExpandResult`
  - `cost(baseResources: Record<string, number>, prices?: MarketPrice, items?: Record<string, any>, inventory?: Record<string, number>): CostResult`
  - `listRecipes(allRecipes: Record<string, any>, activeBuildings: string[], inventory?: Record<string, number>): Array<RecipeListItem>`
- `PlannerService`:
  - `plan(farm: CanonicalFarmState, prices: MarketPrice, recipes: Record<string, unknown>, items: Record<string, unknown>, modifiers: Record<string, unknown>): CookingPlan`
- `SnapshotService`:
  - `save(canonical: CanonicalFarmState, userId: number): Promise<{ saved: boolean; reason?: string }>`
  - `latest(userId: number, n?: number): Promise<CanonicalFarmState[]>`
- `ActivityService`:
  - `diff(prev: CanonicalFarmState, curr: CanonicalFarmState): ActivityDiff`
- `Orchestrator`: owns the 19-tool registry (`tools`) and the conversational entry point. `runAgent` assembles farm context and delegates to `PipelineCoordinator.execute()`.
  - `runAgent(message: string, sessionId: string, userId: number, farmId: string, history?: any[] | null): Promise<AIChatResponse>` — `AIChatResponse` = `{ success: boolean; answer: string; steps: AIChatStep[]; warnings?: string[]; provenance?: CalculationProvenance }`.
- `PipelineCoordinator` (static): coordinates the four stages.
  - `static execute(message: string, context: PipelineContext, tools: ToolExecutorMap, priorHistory?: Array<{ role: string; content: string }>, farmStateSupplier?: () => Promise<{ state: NormalizedFarmState; version?: number } | null>): Promise<PipelineExecutionResult>` — `MAX_TOTAL_TOOL_CALLS = 8`, one targeted retry on `INVALID`.
- `Planner` (static): `plan(message: string, context: PipelineContext, priorHistory): Promise<PlanResult>` — deterministic tool selection (intent + criteria).
- `DeterministicValidator`: verifies tool results against `NormalizedFarmState`, precomputes a synthesis, returns a `ValidationReport` (`status`, `synthesis`, `critique`).
- `Explainer`: `explain(...)` makes the single Groq call from the validated synthesis; `deterministicFallback(...)` renders offline and surfaces the validator `critique` on `INVALID`.
- `KnowledgeService`:
  - `search(options: SearchKnowledgeOptions): Promise<KnowledgeChunkResult[]>`
  - `lookupEntity(entityName: string, limit?: number): Promise<KnowledgeChunkResult[]>`
  - `getStats(): Promise<{ totalChunks: number; documentsBySource: Array<{ source: string; count: number }>; topCategories: Array<{ category: string; count: number }> }>` — all methods graceful-degrade to safe defaults (`0` / `[]`) when Postgres is unreachable.

