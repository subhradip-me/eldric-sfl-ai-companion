# Sunflower AI 🌻 — Farm Command Center (V1.2)

Decision-support platform and autonomous AI strategist for reaching Bumpkin Level 100 in **Sunflower Land (SFL)**. Built with deterministic core economic engines, multi-user authentication, concurrent session management, credit-gated conversational AI, and containerized deployment.

## Architecture

**Pure Deterministic Core (`server/core/`):**
- Zero framework or database dependencies; all calculations are pure functions with cryptographic provenance.
- `economyEngine/`: FLOWER valuations, Buy vs Farm animal economics, and **Codex Deliveries & Tasks Engine** (`evaluateDeliveries`, `evaluateCodexTasks`).
- `effectEngine/`: Deterministic boost resolution with placed collectibles coordinates/interior gates, equipped wearables gates, timed buffs, and seasonal filters.
- `xpEngine/`, `productionEngine/`, `temporalEngine/` (Sunflower Clock & UTC resets), `historyEngine/` (Observed facts vs Inferred movements), and `planner/` (Hierarchical multi-phase roadmap).

**MVC & Service Layer (`server/`):**
- `server/models/`: Database models (`User`, `ChatMessage`, `Snapshot`, `UserSession`, `AiCreditLedger`).
- `server/controllers/`: Request handlers (`AuthController`, `FarmController`, `ChatController`).
- `server/services/`: AI Orchestrator (`Orchestrator.ts` with 15 deterministic tools), Redis Hot Store (`redisHotStore.ts`), and Auth services.
- `server/middleware/`: JWT verification, One-Account-Per-IP registration gate (`ipGate.ts`), and concurrent session guard.

**Security & Resource Governance:**
- **One Account Per IP Registration Gate**: Prevents multi-account abuse by enforcing 1 registration per IP (developers exempted).
- **AI Credit Quota Model**: New users receive 50 free credits. Each AI prompt consumes 1 credit with atomic reservation and automatic refund on failure. Developer accounts have unmetered access.
- **Concurrent Session Management**: Enforces a strict limit of 1 active desktop + 1 active mobile session per user. Conflicts trigger HTTP 409 with an interactive resolution modal and refresh token revocation.

## Deployment & Run

### A. One-Command Docker Deployment (Recommended)
```bash
# 1. Configure environment
cp .env.example .env        # Set SUNFLOWER_API_KEY, GROQ_API_KEY, JWT_SECRET

# 2. Start full container stack (App, PostgreSQL 16 + pgvector, Redis)
docker compose up -d

# Sunflower AI is live at http://localhost:3000 (served via production bundle)
```

### B. Local Development Run
```bash
# 1. Database & Cache
docker compose up -d postgres redis

# 2. Setup (creates tables, vector extensions, and demo user)
npm install
npm run setup

# 3. Backend Server
npm start                   # http://localhost:3000

# 4. Frontend Client (separate terminal)
cd client && npm install && npm run dev   # http://localhost:5173

# Demo credentials: username=demo, password=demo123
# Tests: 186 / 186 unit tests passing
npm test
```

## Dr. Bumpkin AI Copilot (15 Specialized Tools)

Operates on an agentic loop powered by Groq (`llama-3.3-70b-versatile`):
1. `get_farm_state`: Snapshot-first normalized farm inventory, level, currencies, buildings, skills, and data freshness.
2. `get_deliveries`: **Codex Delivery Orders evaluation** (Coins, SFL, and Ascension Age Shiny Feathers). Compares against live inventory, flags orders ready to deliver right now, and calculates net profit and ROI.
3. `get_codex_chores_and_bounties`: **Weekly Chores** (Codex Tab 21) with real-time `farmActivity` progress tracking, **Poppy Mega Bounty Board** (Tab 33), and daily tasks.
4. `evaluate_buy_vs_farm`: Live market price vs in-house animal feeding cost comparison (Milk, Eggs, Wool) with Barn/Hen House capital setup status.
5. `get_expansion_details`: Current island status, Plot requirements, node additions, and multi-stage roadmap to future islands (Desert → Volcano).
6. `compute_recipe_cost`: Effective recipe economics, XP boosts, cooking time, and building ownership verification.
7. `get_roadmap`: Multi-phase strategic roadmap, daily objectives, and seasonal deadline urgency warnings.
8. `check_action_permission`: Discretionary reserve checks preventing commitment violations against tomorrow's goals.
9. `evaluate_strategy_feasibility`: Deterministic feasibility evaluation against hard constraints (budget, blacklists, deadlines).
10. `get_active_effects`: Authoritative active boost proof (equipped wearables, placed collectibles, skills, timed buffs, VIP).
11. `get_temporal_context`: Sunflower Clock, UTC daily reset countdown, season boundaries, and weather events.
12. `get_history_metrics`: Historical progression deltas separating directly proven OBSERVED facts from INFERRED events.
13. `get_item_metadata`: Authoritative official game catalog definitions, slot/part classifications, and collision disambiguation.
14. `get_market_prices`: Live P2P market prices in FLOWER.
15. `recall_memory`: Semantic vector search across past chat sessions using `pgvector`.

> **Anti-Hallucination Disambiguation Rule**: Dr. Bumpkin is strictly prohibited from inventing fake "system examples" like `"Delivery 1 - Milk & Eggs"`. When clarifying brief or numbered prompts (e.g. "2" or "flower delivery"), the AI always cites real active orders and tasks from the player's Codex.

## Key Endpoints

**Auth & Governance:**
- `POST /api/auth/register` - Create account (enforces 1-per-IP limit)
- `POST /api/auth/login` - Login with device detection (desktop/mobile) and session conflict check
- `POST /api/auth/session/resolve` - Force-disconnect an existing session and claim new session
- `GET /api/auth/me` - Get current user info, session state, and AI credit balance
- `PUT /api/auth/farm` - Update linked Sunflower Land farm ID

**Farm Data (User-Scoped):**
- `GET /api/farm` - Normalized farm state, active production yields, and hotStore sync
- `GET /api/planner` - Optimized cooking roadmap and Level 100 forecasts
- `GET /api/activity` - Historical activity deltas between snapshots
- `GET /api/xp-progression?days=7` - XP progression time-series

**AI & Chat:**
- `POST /api/chat` - Multi-turn conversational agent (credit-metered, 1 credit/prompt)
- `GET /api/sessions` - List chat sessions
- `GET /api/sessions/:id` - Fetch chat history for session
- `DELETE /api/sessions/:id` - Delete chat session

**Public:**
- `GET /api/health` - Health check (DB, Redis, API connectivity)
- `GET /api/market` - Live P2P market prices
