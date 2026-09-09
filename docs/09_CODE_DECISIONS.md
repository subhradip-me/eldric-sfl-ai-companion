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
- **Consequences**: Clear separation of concerns, simplified unit testing (`xpEngine.test.js`), and isolated failure domains.

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
- **Decision**: Implement a tiered caching system in `server/services/sunflower.js`:
  1. **In-Memory Cache**: 5-minute TTL for farm states, 10-minute TTL for market orderbooks.
  2. **Atomic Disk Persistence**: Serializes memory cache to `data/.cache/api-cache.json` so cache persists across server reboots.
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
  2. Equip the agent with 12 deterministic tools (`get_farm_state`, `get_planner`, `compute_recipe_cost`, `get_expansion_guide`, etc.).
  3. Enforce **building ownership validation** inside `compute_recipe_cost` so the agent warns the player when evaluating recipes for unowned buildings.
  4. Implement an in-turn tool execution deduplication cache to prevent redundant tool invocations, but allow `force: true` to bypass the cache when refreshed data is requested.
- **Consequences**:
  - 100% grounded answers verified against live farm data.
  - Zero hallucinated recipe ingredients or prices.
  - Rapid recovery from malformed model tool arguments without session crashes.

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

