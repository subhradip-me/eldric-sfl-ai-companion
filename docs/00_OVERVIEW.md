# 00. System Overview 🌻

## 1. Introduction

**Sunflower AI** is an advanced operational command center, economic modeling engine, and autonomous decision-support platform designed for players of **Sunflower Land (SFL)**—a Web3 farming, gathering, crafting, and trading simulation on the Polygon blockchain.

The primary objective of Sunflower AI is to solve the multi-variable mathematical, temporal, and capital allocation challenge of progressing an on-chain **Bumpkin to Level 100 Mastery** while maximizing resource efficiency (FLOWER currency, crops, animal products, and cooking building uptime).

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                   SUNFLOWER AI                                   │
│                    Bumpkin Level 100 Autonomous Command Center                   │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────────┐
│   Cooking Planner    │      │  Market & Inventory  │      │   Dr. Bumpkin Copilot    │
│  XP/FLOWER & XP/Hour │      │ Real-time P2P orders │      │ Plan→Act→Validate→Explain│
│  Building pipelines  │      │ Valuation & Deficits │      │ RAG + Live Farm State    │
└──────────────────────┘      └──────────────────────┘      └──────────────────────────┘
        │                                │                                │
        ▼                                ▼                                ▼
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────────┐
│ Codex Deliveries &   │      │ Security & Sessions  │      │    Credit Quota Engine   │
│ Chores & Mega Bounty │      │ 1-Account/IP + Dual  │      │ Atomic Reservation &     │
│ VIP Shiny Feathers   │      │ Desktop/Mobile Limit │      │ Live UI Credit Balance   │
└──────────────────────┘      └──────────────────────┘      └──────────────────────────┘
```

---

## 2. Core Value Pillars

### 2.1 Optimal Cooking & XP Progression Engine
Cooking food is the primary mechanism for gaining Bumpkin XP in Sunflower Land. Recipes require diverse ingredients (crops, fruits, milk, eggs, honey, fish) produced across multiple specialized buildings:
- **Fire Pit** (basic foods: Mashed Potato, Boiled Chestnuts, Roast Veggies)
- **Kitchen** (intermediate dishes: Chowder, Pancakes, Fruit Salad)
- **Bakery** (advanced pastries and cakes: Apple Pie, Orange Cake, Honey Cake)
- **Deli** (sandwiches and luxury dishes: Fermented Carrots, Sauerkraut, Pizza Margherita)
- **Smoothie Shack** (fruit smoothies: Banana Smoothie, Power Smoothie)

Sunflower AI dynamically models:
- **Base XP vs. Effective XP**: Multiplicative factoring of active skill tree masteries (e.g., *Munching Mastery*, *Drive-Through Deli*, *Juicy Boost*, *Fishy Feast*, *Buzzworthy Treats*) and active VIP Membership (+10% multiplicative boost).
- **Cook Time Reductions**: Applies building-level oil burners and skill masteries (*Fast Feasts*, *Frosted Cakes*, *Swift Sizzle*, *Turbo Fry*, *Fry Frenzy*).
- **Batch Output & Yield**: Considers *Double Nom* (2× output and 2× ingredient requirement).
- **XP per FLOWER Cost**: Identifies the cheapest routes to Level 100 in terms of liquid token expenditure.
- **XP per Production Hour**: Identifies the fastest routes to Level 100 in terms of real-world cooking time.
- **Total Milestone Forecast**: Pre-calculates exact batches and total FLOWER needed to reach Level 100 from current XP.

### 2.2 Inventory & Real-Time Market Valuation
- Synchronizes with community P2P orderbooks to establish live market prices for all tradable crops, animal goods, and consumables.
- Computes total farm liquid inventory value in FLOWER.
- Automatically calculates ingredient deficits: whether items should be purchased from the marketplace (`buy`) or must be produced directly on the farm (`mustProduce` for untradable or unpriced items).

### 2.3 Activity & Snapshot Delta Engine
- Persists canonical farm state snapshots in PostgreSQL with SHA-1 deduplication.
- Calculates exact observation windows and computes:
  - **Observed activity counters** (crops planted/harvested, trees chopped, iron mined).
  - **Inferred activity** (XP deltas, net currency changes, items consumed/sold) with confidence ratings and gap detection.

### 2.4 Codex Deliveries, Weekly Chores & Poppy Mega Bounty Board
- **Deliveries Engine (`evaluateDeliveries`)**: Evaluates NPC delivery orders across Coins, SFL, and seasonal Shiny Feathers.
  - Computes ingredient readiness (`readyNow`), market ingredient FLOWER costs, net SFL profit, and return on investment.
  - Dynamically calculates Shiny Feathers for seasonal deliveries based on NPC tier:
    - **Elite NPCs** (Pharaoh, Tywin): 6 base Shiny Feathers.
    - **Medium NPCs** (Cornwell, Bert, Raven, Jester): 3 base Shiny Feathers.
    - **Standard NPCs** (Finley, Miranda, etc.): 2 base Shiny Feathers.
  - Active VIP Membership boost: deterministically adds `+3 Shiny Feathers` to all seasonal orders (Pharaoh: 9 Feathers / +45 Ascension points; Cornwell: 6 Feathers / +30 pts; Finley/Miranda: 5 Feathers / +25 pts).
  - Highlights top recommendations: `bestCoinsDelivery` (e.g. Victoria: 1,100 Coins), `bestReadyNowDelivery` (e.g. Corale: 2 Mahi Mahi -> 578 Coins instantly with zero extra investment), `bestSflDelivery` (e.g. Grimtooth: 0.4 SFL), and `bestFeathersDelivery` (e.g. Pharaoh: 9 Feathers).
- **Weekly Chores & Bounties (`evaluateCodexTasks`)**:
  - **Weekly Chores (Tab 21)**: Maps chore requirements against live `farmActivity` counters (`currentProgress = farmActivity[activityName] - initialProgress`), e.g. Pumpkin' Pete at 199/200 pumpkins with 4 Shiny Feathers under VIP.
  - **Poppy Mega Bounty Board (Tab 33)**: Evaluates bounties across 6 categories (Flowers, Fish, Crustaceans, Animals, Artefacts, Giant Crops) and computes claim readiness.

### 2.5 Security, Sybil Protection & Concurrent Session Governance
- **1-Account-Per-IP Registration Gate**: Intercepts registration requests via `ipGate.ts` and `AuthService.ts`, recording `users.registration_ip` and restricting public users to 1 account per IP address to curb Sybil farm spam (developer accounts cleanly exempted).
- **Dual-Device Concurrent Session Management**: Tracks sessions via `active_sessions` with SHA-256 hashed refresh tokens. Enforces a strict limit of **1 Desktop + 1 Mobile** session per user. Concurrent logins on the same device type yield a `409 SESSION_CONFLICT` or permit `forceDisconnect: true` to invalidate previous refresh tokens.

### 2.6 Atomic AI Credit Quota & Usage Ledger
- **Atomic Credit Reservation**: Protects against race conditions by reserving credits via atomic PostgreSQL SQL (`UPDATE users SET ai_credits = ai_credits - $2 WHERE id = $1 AND ai_credits >= $2 RETURNING ai_credits, ai_credits_used`).
- **Automated Failure Refund**: If the AI model inference fails or throws an exception, reserved credits are immediately credited back to the user account.
- **Developer Bypass & Real-Time UI Counter**: Developers have 999,999 credits and bypass deduction. The client UI displays real-time remaining credits in the workspace header and chat modal.

### 2.7 Autonomous AI Copilot ("Dr. Bumpkin")
- Conversational farm strategist powered by **Groq Cloud LLMs** (`llama-3.3-70b-versatile`), with a fully deterministic offline fallback when no API key is present.
- Runs a **four-stage deterministic pipeline** (`server/services/ai/pipeline/`) coordinated by `PipelineCoordinator.execute()`, realizing a **PLAN → ACT → CHECK → FIX** flow:
  1. **Planner** (PLAN) — deterministically decides which tools to invoke for the player's intent (the LLM no longer selects tools mid-conversation).
  2. **Orchestrator** (ACT) — executes the planned tools against live farm state, capped at 8 total tool calls.
  3. **DeterministicValidator** (CHECK) — verifies tool results against the canonical `NormalizedFarmState` (coins at `economy.coins`, stock at `inventory.all`), precomputes a synthesis, and emits a `ValidationReport` with an actionable `critique`; on an `INVALID` report it can trigger one targeted retry (FIX).
  4. **Explainer** — makes the single Groq call to render the Dr. Bumpkin persona answer strictly from the validated synthesis (falling back to a fully deterministic render when no API key is present), so the natural-language reply can only speak to numbers the validator confirmed.
- The pipeline draws on a suite of **19 specialized deterministic tools**, including a `search_knowledge` tool that queries the pgvector-backed `knowledge-base/` corpus (see §2.8):
  1. `get_farm_state`: Complete normalized inventory, level, XP, currencies, buildings, skills from durable snapshots or hot cache.
  2. `get_roadmap`: Hierarchical multi-phase tactical roadmap with daily objectives and resource commitments.
  3. `check_action_permission`: Authoritative discretionary balance and hard reserve constraint validator.
  4. `evaluate_strategy_feasibility`: Evaluates proposed recipe or crafting batches against budgets and deadlines.
  5. `get_temporal_context`: In-game Sunflower clock, day boundary, and seasonal urgency index.
  6. `get_history_metrics`: Aggregated historical deltas with strict observed vs inferred separation.
  7. `compute_recipe_cost`: Effective recipe economics with building ownership verification gates.
  8. `get_active_effects`: Authoritative resolution of placed collectibles, equipped wearables, and timed buffs.
  9. `get_market_prices`: Live P2P community market orderbook prices in FLOWER.
  10. `recall_memory`: Semantic vector search across past archived conversational sessions (`pgvector`).
  11. `get_item_metadata`: Static game metadata lookup with collision disambiguation.
  12. `get_expansion_details`: Multi-island progression requirements (Desert, Volcano, etc.).
  13. `evaluate_buy_vs_farm`: Feed vs market ROI breakdown for animal produce (Milk, Eggs, Wool).
  14. `get_deliveries`: Evaluates NPC delivery orders sorted by profit, Coins, SFL, and `readyNow` status.
  15. `get_codex_chores_and_bounties`: Evaluates Weekly Chores and Poppy Mega Bounties with live progress.
  16. `get_level_requirements`: Authoritative cumulative XP requirements and progression metrics for any target Bumpkin level (shortfall, progress %, intermediate milestones).
  17. `simulate_what_if`: Goal-oriented what-if simulation on a *cloned* farm state (add building, cook, sell, plant) with zero side effects.
  18. `get_skills_tree`: Skill-tree catalog and player unlock status across all 11 branches, with tiered effects and targeted recommendations.
  19. `search_knowledge`: Semantic + entity retrieval over the embedded `knowledge-base/` corpus (wiki lore and extracted game catalogs) via `KnowledgeService`, graceful-degrading to no extra context when the vector store is unreachable.
- **Anti-Hallucination Real-Examples Disambiguation (Rule 9)**: When player intent is ambiguous, Dr. Bumpkin is strictly forbidden from using fake system placeholders (e.g. `"Delivery 1 - Milk & Eggs"`). It MUST always cite real, active orders and chores directly from the player's Codex board with NPC names, exact ingredients, and actual rewards.

### 2.8 Knowledge Base Corpus & Vector Retrieval
- **Consolidated corpus (`knowledge-base/`)**: All static reference data lives under one top-level folder split by file type — `json/rules/` (hand-authored rules & taxonomies), `json/gamedata/` (extracted game catalogs), `json/wiki-dump.jsonl` (wiki crawl source), and `md/` (`GAME_RULES.md` plus 105 wiki pages with category hierarchy preserved). This is distinct from `server/data/*.json`, which the server imports directly at build time as the authoritative source for deterministic calculations.
- **Ingestion (`sfl-kb-ingest/`)**: The `kb:ingest-wiki` and `kb:ingest-gamedata` npm scripts chunk and embed the corpus into the `kb_documents` / `kb_chunks` tables using local ONNX embeddings, keyed by content hash so unchanged content is skipped.
- **Retrieval (`KnowledgeService.ts`)**: `search()` (cosine-similarity semantic search), `lookupEntity()` (targeted entity resolution), and `getStats()` (corpus coverage) back the `search_knowledge` tool. Every DB-touching method graceful-degrades to safe empty defaults when Postgres is unreachable, so a KB outage degrades to "no extra context" rather than a failed request.

---

## 3. Technology Stack

| Domain | Technology | Implementation Detail |
|---|---|---|
| **Backend Runtime** | Node.js (v20+) ESM with `tsx` | TypeScript execution with zero separate compile step for rapid development |
| **Language** | TypeScript 5.9 | Full strict type checking across all controllers, models, and modular services |
| **Backend Framework** | Express 4.21 | Modular router with class-based controllers and middleware |
| **Relational Database** | PostgreSQL 16 | ACID transaction storage for users, snapshots, sessions, and credits |
| **Vector Database** | `pgvector` Extension | 384-dimensional vector cosine similarity retrieval (`<=>`) |
| **Hot State Cache** | Redis 7 Alpine / In-Memory | Fast monotonic farm state projection with seamless hermetic fallback |
| **Local AI Embeddings** | `@xenova/transformers` (`all-MiniLM-L6-v2`) | Pure JavaScript vector generation without external SaaS costs |
| **LLM Inference** | Groq Cloud API (`llama-3.3-70b-versatile`) | Ultra-low latency chat completions with tool-calling execution |
| **Containerization** | Docker & Docker Compose | Multi-stage build packaging React SPA and Node.js TS backend |
| **Frontend Framework** | React 19 & Vite 6 | High-performance single page application (SPA) |
| **Styling & Design System** | TailwindCSS + Obsidian/Notion Tokens | Hybrid dual-pane document workspace and responsive mobile dock |
| **Web3 Data Ingestion** | SFL Community API & Polygon RPC | Live on-chain farm state retrieval with memory + atomic disk TTL cache |

---

## 4. Key Directories & Workspace Layout

```
sunflower-ai/
├── client/                           # React 19 + Vite Frontend SPA
│   ├── public/                       # Pixel-art sprites & WebP chibis
│   ├── src/
│   │   ├── App.jsx                   # Main workspace shell (Ribbon, Sidebar, Canvas, Copilot)
│   │   ├── Auth.jsx                  # Authentication modal & registration
│   │   ├── authContext.jsx           # Global JWT & user state provider (credit balance)
│   │   ├── api.js                    # Fetch client with automatic Bearer token injection
│   │   └── index.css                 # Design system tokens and custom scroll utilities
│   ├── package.json
│   └── vite.config.js
├── server/                           # Class-Based TypeScript Backend
│   ├── controllers/                  # Class-based HTTP controllers
│   │   ├── AuthController.ts         # User auth, registration, IP gating, session cap
│   │   ├── FarmController.ts         # Farm state, market prices, planner, quests
│   │   └── ChatController.ts         # Agent conversation, credit reservation, memory
│   ├── core/                         # Pure deterministic calculation engines
│   │   ├── economyEngine/            # Cost, expansion, ROI, and deliveries
│   │   │   └── deliveries.ts         # Pure deterministic Codex deliveries & chores engine
│   │   ├── productionEngine/         # Animal feeds, crop progression, processing
│   │   └── effectEngine/             # Collectible boosts, wearables, timed buffs
│   ├── services/                     # Modular business services
│   │   ├── ai/                       # AI Agent & Reasoning
│   │   │   ├── pipeline/             # Four-stage deterministic pipeline (Plan→Act→Validate→Explain)
│   │   │   │   ├── PipelineCoordinator.ts # Static execute() coordinating all 4 stages
│   │   │   │   ├── Planner.ts        # Deterministically selects tools for intent
│   │   │   │   ├── DeterministicValidator.ts # Verifies results vs NormalizedFarmState
│   │   │   │   ├── MathHelper.ts     # Centralized validation arithmetic
│   │   │   │   └── Explainer.ts      # Dr. Bumpkin persona (single Groq call) + fallback
│   │   │   ├── Orchestrator.ts       # 19-tool registry + runAgent() pipeline entry
│   │   │   └── GroqClient.ts         # Groq LLM API wrapper
│   │   ├── knowledge/                # Vector retrieval over knowledge-base/
│   │   │   └── KnowledgeService.ts   # search / lookupEntity / getStats (pgvector)
│   │   ├── cooking/                  # Cooking, Economics & XP
│   │   │   ├── PlannerService.ts     # Building optimizer & milestone calculator
│   │   │   ├── RecipeService.ts      # Ingredient tree expander & market cost
│   │   │   └── XpEngine.ts           # Skill masteries, VIP & cook time logic
│   │   ├── farm/                     # Farm State & Blockchain Ingestion
│   │   │   ├── SunflowerClient.ts    # Community API client (TTL + disk cache)
│   │   │   ├── FarmNormalizer.ts     # Raw SFL JSON -> CanonicalFarmState
│   │   │   ├── SnapshotService.ts    # PostgreSQL snapshot persistence & hash
│   │   │   └── ActivityService.ts    # Observed & inferred activity diffs
│   │   ├── auth/                     # Authentication & session governance
│   │   │   └── AuthService.ts        # Password hashing, JWT creation/validation, IP gate
│   │   └── chat/                     # Conversational memory
│   │       └── ChatStoreService.ts   # Local ONNX vector embedding & pgvector
│   ├── models/                       # Database models
│   │   ├── User.ts                   # User entity & SQL queries
│   │   ├── UserModel.ts              # Credit deduction, refund, and registration IP
│   │   ├── SessionModel.ts           # Active sessions table & concurrent device caps
│   │   ├── Snapshot.ts               # Snapshot record model
│   │   └── ChatMessage.ts            # Chat message & vector search model
│   ├── types/                        # Core TypeScript interfaces
│   │   └── index.ts                  # CanonicalFarmState, CookingPlan, AIToolResult, etc.
│   ├── middleware/                   # Express middlewares
│   │   ├── auth.ts                   # JWT verification & farm ID guard
│   │   └── ipGate.ts                 # 1-Account-Per-IP registration gate
│   ├── db/                           # Database connection & schema
│   │   ├── database.ts               # pg.Pool connection, auto-migrations (incl. kb tables) & retry logic
│   │   └── schema.sql                # DDL with pgvector extension
│   ├── data/                         # Static game configuration (authoritative build-time imports)
│   │   ├── recipes.json              # Full cooking recipe definitions
│   │   ├── items.json                # Item metadata & tradability flags
│   │   ├── skills.json               # Skill tree catalogue & tiers
│   │   ├── modifiers.json            # Collectible & custom boost overrides
│   │   ├── levels.json               # Bumpkin XP level requirements table
│   │   ├── expansion.json            # Land plot, island requirements & costs
│   │   ├── gameMetadata.json         # Static game metadata lookup
│   │   ├── fish_market_recipes.json  # Fishing/market recipe definitions
│   │   └── aging_shed_recipes.json   # Aging shed recipe definitions
│   └── index.ts                      # Server bootstrap & route mounting
├── knowledge-base/                   # Consolidated retrieval corpus (ingested into pgvector)
│   ├── json/
│   │   ├── rules/                    # Hand-authored rules & taxonomies
│   │   ├── gamedata/                 # Extracted game catalogs (39 files)
│   │   └── wiki-dump.jsonl           # Wiki crawl source
│   └── md/
│       ├── GAME_RULES.md             # Canonical rules reference
│       └── wiki/                     # 105 wiki pages, category hierarchy preserved
├── sfl-kb-ingest/                    # KB ingestion scripts (chunk + embed corpus)
├── Dockerfile                        # Multi-stage production container build
├── docker-compose.yml                # Node.js + PostgreSQL 16 + Redis 7 stack
├── docs/                             # In-depth technical documentation
├── package.json                      # Root configuration with tsx scripts
└── tsconfig.json                     # TypeScript strict configuration
```

---

## 5. How the System Works — High-Level Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant UI as React SPA (App.jsx)
    participant API as Express Router (server/index.ts)
    participant AuthCtrl as AuthController
    participant FarmCtrl as FarmController
    participant ChatCtrl as ChatController
    participant SFL as SunflowerClient (TTL Cache)
    participant CoreDeliv as DeliveriesEngine
    participant UserMdl as UserModel (PostgreSQL)
    participant AI as AI Pipeline (Plan→Act→Validate→Explain)
    participant Groq as Groq Cloud LLM

    Player->>UI: Open Sunflower AI Command Center
    UI->>API: GET /api/farm (Authorization: Bearer <token>)
    API->>FarmCtrl: getFarmData(req, res)
    FarmCtrl->>SFL: getFarm(farmId)
    SFL-->>FarmCtrl: { canonical, raw, stale, cached }
    FarmCtrl-->>UI: 200 OK (Canonical Farm State)

    Player->>UI: Ask Dr. Bumpkin: "Which delivery should I do first?"
    UI->>API: POST /api/chat { message, sessionId }
    API->>ChatCtrl: sendMessage(req, res)
    ChatCtrl->>UserMdl: deductAiCredit(userId, 1) [Atomic SQL]
    UserMdl-->>ChatCtrl: { ai_credits: 49, ai_credits_used: 1 }
    ChatCtrl->>AI: runAgent(message, sessionId, userId, farmId)
    Note over AI: Stage 1 (PLAN) — Planner deterministically selects tools for the intent
    loop Stage 2 (ACT) — Orchestrator Tool Execution (≤ 8 calls, no LLM)
        AI->>CoreDeliv: evaluateDeliveries(canonical, prices)
        CoreDeliv-->>AI: Deliveries evaluation (Corale readyNow, Victoria top coin, Pharaoh 9 Feathers)
    end
    Note over AI: Stage 3 (CHECK) — DeterministicValidator verifies vs NormalizedFarmState + precomputes synthesis (1 targeted retry on INVALID = FIX)
    AI->>Groq: Stage 4 — Explainer: single call with validated synthesis + persona
    Groq-->>AI: Final tactical advice with real order citations
    AI-->>ChatCtrl: Answer + Execution Steps
    ChatCtrl-->>UI: 200 OK { answer, steps, creditsRemaining: 49 }
    UI-->>Player: Render tactical guidance & update live credit pill
```

### Core Execution Flow:
1. **Client Bootstrap**: The player logs into the frontend SPA. React loads core datasets in parallel using `Promise.all([api.farm(), api.planner(), api.market(), api.recipes()])`.
2. **Ingestion & Caching**: Requests hit `FarmController.ts`. The controller queries `SunflowerClient.ts`, which checks its 5-minute memory cache, Redis hot cache, and atomic disk cache before calling the external SFL Community API. In-flight duplicate requests for the same farm are merged into a single Promise.
3. **Normalization**: Raw SFL blockchain JSON is parsed by `FarmNormalizer.ts` into a strictly typed `CanonicalFarmState`, resolving bumpkin levels, liquid currency balances, item inventory counts, building busy timers, skills, and quest deliveries.
4. **Deterministic Calculation Engines**: Specialized engines under `server/core/` (`economyEngine/deliveries.ts`, `productionEngine/`, `effectEngine/`) calculate exact recipe economics, animal feed vs market trade-offs, and Codex delivery rewards with VIP Shiny Feather bonuses.
5. **Atomic Credit & Deterministic AI Pipeline**: When the player chats with Dr. Bumpkin, `ChatController.ts` atomically reserves 1 credit via `UserModel.ts`. Then `orchestrator.runAgent()` assembles farm context and delegates to `PipelineCoordinator.execute()`, which runs the four stages — Planner deterministically selects tools, `Orchestrator.ts` executes them against live state (≤ 8 calls, no LLM), `DeterministicValidator.ts` verifies the results against the canonical farm state and precomputes a synthesis, and `Explainer.ts` makes the single Groq call to render the grounded answer (falling back to a fully deterministic render when no key is present). Real-example citations are enforced so advice never hallucinates.
