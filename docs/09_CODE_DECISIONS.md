# 09. Architectural Decisions & Technical Rationales (ADRs) ⚖️

This document details key architectural decisions, design trade-offs, and technical rationales made during the development of Sunflower AI.

---

## ADR 1: Adoption of Layered MVC Architecture

- **Status**: Accepted & Implemented
- **Context**: Early iterations consolidated routes, database queries, and game math inside `server/index.js`. As features expanded (multi-user auth, vector search, activity snapshots), the file grew unwieldy.
- **Decision**: Refactor the backend into a clean **Model-View-Controller (MVC)** structure:
  - `controllers/` for HTTP orchestration and parameter validation.
  - `models/` for PostgreSQL database queries.
  - `services/` for business logic (XP engine, planner, AI orchestrator).
  - `routes/` for declarative endpoint declarations.
- **Consequences**: Clear separation of concerns, simplified unit testing (`server/tests/*.test.ts` run via `tsx --test`), and isolated failure domains.

---

## ADR 2: PostgreSQL with `pgvector` vs. Standalone Vector Databases

- **Status**: Accepted & Implemented
- **Context**: Conversational memory for Dr. Bumpkin required vector storage and cosine similarity retrieval. Standard solutions involved hosting a separate vector database (e.g. Pinecone, Chroma, Qdrant).
- **Decision**: Deploy **PostgreSQL 16 with the `pgvector` extension** via the official Docker image (`pgvector/pgvector:pg16`).
- **Consequences**:
  - **Single Database Infrastructure**: Users, snapshots, and vector embeddings reside in one ACID-compliant database.
  - **Zero SaaS Dependencies**: Eliminates external API keys, subscription costs, and third-party downtime.
  - **Relational Filtering**: Allows performant combined queries (`WHERE user_id = $1 ORDER BY embedding <=> $2`).

---

## ADR 3: In-Memory TTL + Disk Cache with In-Flight Deduplication

- **Status**: Accepted & Implemented
- **Context**: The Sunflower Land Community API enforces strict rate limits. Concurrent user navigation or rapid page refreshing can easily trigger HTTP 429 errors.
- **Decision**: Implement a tiered caching system in `server/services/farm/SunflowerClient.ts`:
  1. **In-Memory Cache**: 5-minute TTL for farm states, 10-minute TTL for market orderbooks.
  2. **Atomic Disk Persistence**: Serializes memory cache to `server/data/.cache/api-cache.json` so cache persists across server reboots.
  3. **In-Flight Deduplication**: Tracks ongoing network requests in a `pending = new Map()`. If multiple requests for Farm `#29411` arrive simultaneously, all await the same Promise.
  4. **Stale-While-Revalidate Fallback**: If external API calls fail or return 429, the system returns stale cached data with `stale: true` rather than throwing errors.
- **Consequences**: Vastly reduced external network overhead, near-zero 429 errors, and instantaneous responses for cached entities.

---

## ADR 4: Dual-Pane Desktop UI with Discord-Style Mobile Slim Dock

- **Status**: Accepted & Implemented
- **Context**: The desktop interface combines an **Obsidian** ribbon/tabs aesthetic with **Notion** document canvas layouts. On mobile screens (`< 768px`), toggling the `w-60` Notion sidebar crushed the center canvas, causing unusable UI truncation.
- **Decision**:
  - **Desktop (>= 768px)**: Maintain the full desktop layout with the collapsible `w-60` Notion sidebar, folder toggle button, desktop window traffic lights, and verbose status bar.
  - **Mobile (< 768px)**: Disable the `w-60` drawer entirely. Provide a permanent `w-12` vertical Discord-style icon dock displaying all 7 tabs, with a bottom avatar button revealing a touch-friendly account popover.
- **Consequences**: Zero regression for desktop users, while delivering a fluid, squish-free experience on mobile devices.

---

## ADR 5: Groq Cloud LPU Inference Engine

- **Status**: Accepted & Implemented
- **Context**: Players querying Dr. Bumpkin during active gameplay need near-instant strategic feedback. Traditional cloud LLM endpoints often take 4–8 seconds to respond.
- **Decision**: Integrate the **Groq Cloud API** utilizing Language Processing Units (LPUs).
- **Consequences**: Sub-second time-to-first-token, streaming token generation speeds (>200 tokens/sec), and robust conversational reasoning.

---

## ADR 6: Local Text Embeddings via `@xenova/transformers`

- **Status**: Accepted & Implemented
- **Context**: Generating text embeddings for vector RAG usually requires calling external embedding APIs (e.g. OpenAI `text-embedding-ada-002`), adding network latency and ongoing per-token costs.
- **Decision**: Use `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`) running directly in Node.js.
- **Consequences**:
  - Pure JavaScript execution via ONNX runtime without native C++ compilation headaches.
  - 384-dimensional vector output perfectly optimized for pgvector.
  - One-time initial model download (~25MB), zero operational API costs thereafter.

---

## ADR 7: Migration to TypeScript, Class-Based Architecture & Modular Feature Services

- **Status**: Accepted & Implemented
- **Context**: The backend originally consisted of loose `.js` function files (`xpEngine.js`, `planner.js`, `sunflower.js`, `normalizer.js`) in a flat `server/services/` folder. As features expanded, lack of strict typing led to runtime shape mismatches with raw SFL API payloads and complex recipe trees.
- **Decision**:
  1. Migrate all controllers, models, and services to **TypeScript 5.9** running on Node.js ESM with **`tsx`**.
  2. Adopt **class-based services** with public method APIs and encapsulated private helpers (e.g. `SunflowerClient`, `FarmNormalizer`, `XpEngine`, `RecipeService`, `PlannerService`).
  3. Reorganize `server/services/` into domain subdirectories (`ai/`, `auth/`, `chat/`, `cooking/`, `farm/`) with clean barrel exports (`index.ts`).
  4. Preserve backward-compatible JavaScript shims for legacy importers.
- **Consequences**:
  - 0 compilation errors across frontend and backend.
  - Clear service boundaries and explicit dependency graphs.
  - Simplified mock injection in unit test suites (`tsx --test`).

---

## ADR 8: Autonomous Agentic Tool-Use Loop with Dedup Bypass (`force: true`)

- **Status**: Accepted & Implemented
- **Context**: Dr. Bumpkin previously operated as a one-shot prompt-engineering assistant with static context injection. When players asked complex, multi-step questions ("What is my bottleneck and how much FLOWER will Sauerkraut take?"), the model often hallucinated out-of-date numbers or generic advice.
- **Decision**:
  1. Implement a **PLAN → ACT → CHECK → FIX** agentic loop in `Orchestrator.ts` powered by Groq Cloud (`llama-3.3-70b-versatile`).
  2. Equip the agent with deterministic tools (`get_farm_state`, `get_roadmap`, `compute_recipe_cost`, `get_expansion_details`, `search_knowledge`, etc.).
  3. Enforce **building ownership validation** inside `compute_recipe_cost` so the agent warns the player when evaluating recipes for unowned buildings.
  4. Implement an in-turn tool execution deduplication cache to prevent redundant tool invocations, but allow `force: true` to bypass the cache when refreshed data is requested.
- **Consequences**:
  - 100% grounded answers verified against live farm data.
  - Zero hallucinated recipe ingredients or prices.
  - Rapid recovery from malformed model tool arguments without session crashes.

---

## ADR 10: Four-Stage Deterministic AI Pipeline (Plan → Act → Validate → Explain)

- **Status**: Accepted & Implemented
- **Context**: The bare agentic loop (ADR 8) could still let the LLM narrate numbers that its own tool calls never actually returned — e.g. answering a craft-feasibility question when the authoritative game data was missing from the tool results. We needed a hard guarantee that the natural-language answer is grounded in verified deterministic output, not model improvisation.
- **Decision**: Split the agent into an explicit four-stage pipeline under `server/services/ai/pipeline/`, coordinated by `PipelineCoordinator.execute()`:
  1. **Planner** (`Planner.ts`) — decides which deterministic tools to invoke for the user's intent.
  2. **Orchestrator** (`Orchestrator.ts`) — executes the tools against live farm state (the PLAN → ACT loop from ADR 8).
  3. **DeterministicValidator** (`DeterministicValidator.ts`) — checks tool results against the authoritative `NormalizedFarmState` (coins at `economy.coins`, stock at `inventory.all`), precomputes a synthesis, and emits a `ValidationReport` with a `critique` when data is missing or a requirement fails. `MathHelper.ts` centralizes the arithmetic.
  4. **Explainer** (`Explainer.ts`) — renders the Dr. Bumpkin persona answer from the validated synthesis. When the LLM key is absent or errors, `deterministicFallback` renders directly from the synthesis, and surfaces the validator's `critique` on `INVALID` reports rather than a generic error.
- **Consequences**:
  - The Explainer can only speak to what the validator confirmed — no ungrounded numbers.
  - The pipeline runs fully offline (deterministic fallback) with no LLM key.
  - Validation reads the canonical farm-state shape, so feasibility checks (craft/cook/build) are correct regardless of the raw payload variant.

---

## ADR 11: Consolidated `knowledge-base/` Corpus, Distinct from Live Runtime Data

- **Status**: Accepted & Implemented
- **Context**: Reference data was scattered across `metadata/` (hand-authored rules), a game-data extractor's `output/` (catalogs), and a crawled wiki `output/`, with duplicates and an accidental double-nested layout. Meanwhile the server imports a *separate* set of JSON at build time. Conflating the two risked breaking the live server during any reorganization.
- **Decision**: Consolidate all static reference data into a single top-level `knowledge-base/` folder split by file type, and keep it strictly separate from runtime imports:
  - `knowledge-base/json/rules/` — 11 hand-authored rule/taxonomy files.
  - `knowledge-base/json/gamedata/` — 39 extracted game catalogs.
  - `knowledge-base/json/wiki-dump.jsonl` — wiki crawl source.
  - `knowledge-base/md/GAME_RULES.md` + `md/wiki/` — 105 wiki pages, category hierarchy preserved.
  - `server/data/*.json` (recipes, items, modifiers, levels, skills, expansion, gameMetadata) remain the **authoritative build-time imports** for deterministic calculations and are never moved.
- **Consequences**:
  - `knowledge-base/` is the retrieval corpus (ingested into pgvector, see ADR 12); it is never imported by runtime code.
  - Reorganization is non-breaking — no live import paths change.
  - Ingestion scripts (`sfl-kb-ingest/`) read the consolidated paths via the `kb:ingest-wiki` / `kb:ingest-gamedata` npm scripts.

---

## ADR 12: Unified Knowledge Base (`kb_documents` / `kb_chunks`) with Graceful Degradation

- **Status**: Accepted & Implemented
- **Context**: Grounding natural-language answers in wiki lore and extracted game catalogs required a searchable store beyond the runtime JSON imports. It also had to survive a missing or unreachable database without crashing the request path.
- **Decision**:
  1. Add `kb_documents` and `kb_chunks` tables in `server/db/database.ts`, with an **HNSW cosine index** (`kb_chunks_embedding_idx`) plus `category` / `type` / `entity` indexes. `chat_messages` also gained an `embedding vector(384)` column.
  2. Expose retrieval through `server/services/knowledge/KnowledgeService.ts`: `search()` (semantic cosine search), `lookupEntity()` (targeted entity resolution for the `search_knowledge` tool), and `getStats()` (corpus coverage).
  3. Make **every DB-touching method graceful-degrade** to safe empty defaults inside try/catch, so an offline Postgres yields empty results instead of an exception.
- **Consequences**:
  - The `search_knowledge` tool augments deterministic answers with wiki/game-data context.
  - A KB or DB outage degrades to "no extra context" rather than a failed request.
  - Reuses the same pgvector infrastructure as chat memory (ADR 2) and the local ONNX embeddings (ADR 6).

---

## ADR 9: Disambiguation of Milestone Progression vs Daily Out-of-Pocket Costs

- **Status**: Accepted & Implemented
- **Context**: Players frequently confused the out-of-pocket cost for cooking *today's 1-batch plan* (e.g. 1.81 FLOWER to buy missing ingredients) with the *cumulative milestone cost* to reach Level 100 (e.g. 1,806.49 FLOWER across 419 batches). LLMs also struggled with mental multiplication across large batch counts.
- **Decision**:
  1. In `PlannerService.ts`, precompute exact milestone fields:
     ```typescript
     const batchesToLevel100 = Math.ceil(remaining / eff.batchXp);
     const totalMilestoneFlower = +(batchesToLevel100 * flowerCost).toFixed(2);
     ```
  2. Clearly separate `flowerToBuy` (today's missing buy requirement) from `flowerCost` (total recipe market value) and `totalMilestoneFlower` (cumulative journey cost).
  3. Instruct the LLM system prompt to quote these pre-computed numbers directly rather than performing arithmetic.
- **Consequences**: Completely eliminated arithmetic errors and player confusion regarding milestone token budgeting.

