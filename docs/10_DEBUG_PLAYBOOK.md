# 10. Operational Diagnostics & Debugging Playbook 🛠️

This playbook provides actionable diagnostic steps and remediation procedures for common operational, database, API, and authentication issues.

---

## 1. Database Connectivity & Startup Failure

### Symptoms
- Server startup logs repeatedly output:
  `⚠️ DB not ready (attempt X/10): connect ECONNREFUSED. Retrying in Xs...`
- Server boots with:
  `🌻 Sunflower AI server running on port 3000 (limited mode)`
- Endpoints requiring persistence (`/api/auth/login`, `/api/activity`, `/api/sessions`) return HTTP 500.

### Root Causes
1. PostgreSQL Docker container is stopped or crashing.
2. Connection string (`DATABASE_URL`) in `.env` is incorrect.
3. The `pgvector` extension failed to compile or initialize.

### Diagnostic & Remediation Steps
1. **Check Docker Container Status**:
   ```bash
   docker ps -a
   ```
   Ensure `sunflower-ai-db` is in the `Up` state.
2. **Inspect Database Container Logs**:
   ```bash
   docker logs sunflower-ai-db
   ```
   Look for volume permission errors or port 5432 collisions.
3. **Restart the Database Container**:
   ```bash
   docker compose down
   docker compose up -d
   ```
4. **Re-run Initial Schema Migration**:
   ```bash
   npm run setup
   ```
   Table creation and the `vector` extension are provisioned idempotently on server startup by `database.ts init()` — including `users`, `snapshots`, `chat_messages` (with `embedding vector(384)`), and the knowledge-base tables `kb_documents` / `kb_chunks` (HNSW cosine index `kb_chunks_embedding_idx`). A `⚠️ Could not init knowledge base tables` warning in the logs indicates the KB migration failed.

---

## 2. Sunflower Land API Rate Limits (HTTP 429)

### Symptoms
- Server logs display:
  `⚠️ API error for "farm:29411", serving stale cache: 429 Too Many Requests`
- Client displays yellow "Cache Mode" indicator in status bar.

### Root Causes
- Sunflower Land Community API imposes rate limits on unauthenticated or high-frequency requests.
- Multiple clients querying from the same public IP address.

### Diagnostic & Remediation Steps
1. **Verify Stale Cache Operation**:
   Sunflower AI is engineered to gracefully return the latest valid snapshot during 429 events. The client will continue operating with `stale: true`.
2. **Inspect Cache Persistence**:
   Check if `server/data/.cache/api-cache.json` exists on disk. If absent, ensure directory permissions allow read/write:
   ```bash
   ls -la server/data/.cache/
   ```
3. **Adjust TTL Settings**:
   If hitting limits frequently during active development, increase cache lifetime in `server/services/farm/SunflowerClient.ts`:
   ```typescript
   const TTL = { farm: 10 * 60_000, prices: 15 * 60_000 };
   ```

---

## 3. JWT Authentication & Session Expiry

### Symptoms
- Client receives `401 Unauthorized` or `403 Forbidden` (`Invalid or expired token`).
- User is suddenly bounced to the AuthScreen.

### Root Causes
- 7-day token duration has expired.
- Server was restarted with a random fallback `JWT_SECRET` because `JWT_SECRET` was omitted from `.env`.

### Diagnostic & Remediation Steps
1. **Ensure Persistent `JWT_SECRET`**:
   Verify that your `.env` contains a dedicated secret:
   ```env
   JWT_SECRET=super_secure_random_string_here_32_bytes
   ```
2. **Clear Client Stale State**:
   In the browser developer tools (F12), open Console and run:
   ```javascript
   localStorage.removeItem('token');
   location.reload();
   ```
3. **Log In Again**: Re-authenticate to obtain a newly signed token.

---

## 4. AI Pipeline: Empty / Fallback Answers & Groq Outages

> **Architecture note**: The model no longer selects tools. `Planner` picks tools deterministically, `Orchestrator` executes them, `DeterministicValidator` verifies the results, and only `Explainer` makes a single Groq call. The old model-driven `tool_calls` JSON-recovery loop no longer exists, so malformed-tool-call errors are not a failure mode.

### Symptoms
- Dr. Bumpkin replies with a terse `⚠️ …` critique instead of a full answer.
- Answers arrive but read like a plain deterministic summary (no persona flourish).

### Root Causes & Remediation
1. **`GROQ_API_KEY` missing or Groq unreachable** → `Explainer` falls back to `deterministicFallback`, rendering directly from the validator's synthesis. This is a *graceful* degrade, not a crash. Verify connectivity:
   ```bash
   curl -X POST https://api.groq.com/openai/v1/chat/completions \
     -H "Authorization: Bearer $GROQ_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "llama-3.3-70b-versatile", "messages": [{"role": "user", "content": "ping"}]}'
   ```
2. **`ValidationReport.status === 'INVALID'`** → the answer is the validator's `critique` (e.g. *"Authoritative game data for 'Iron Pickaxe' was not found"*). This means a required entity or farm-state field was missing, not that the LLM failed. Check that the relevant tool returned data and that farm state resolved (see §2/§3 below). The coordinator already attempts one targeted retry on `targetTool`.
3. **Farm state unavailable (upstream 429 / offline)** → the validator emits `DATA_UNAVAILABLE`; the answer explains what could not be determined rather than fabricating numbers.

## 4.1 Knowledge Base (`search_knowledge`) Returns Nothing

### Symptoms
- `search_knowledge` tool steps show `ok: true` but with empty results; answers lack wiki/game-data grounding.

### Root Causes & Remediation
1. **Postgres unreachable** → `KnowledgeService.search/lookupEntity/getStats` graceful-degrade to empty defaults (`[]` / `0`) inside try/catch. The request still succeeds with "no extra context". Confirm the DB is up.
2. **Corpus not ingested** → the `kb_documents` / `kb_chunks` tables are empty. Run the ingest scripts:
   ```bash
   npm run kb:ingest        # both wiki + gamedata
   # or individually:
   npm run kb:ingest-wiki
   npm run kb:ingest-gamedata
   ```
   Then verify coverage via `KnowledgeService.getStats()` (`totalChunks` should be non-zero) or:
   ```sql
   SELECT count(*) FROM kb_chunks;  -- expect > 0
   ```
3. **Missing HNSW index** → cosine search is slow but not wrong. `database.ts init()` creates `kb_chunks_embedding_idx` automatically on startup; a warning `⚠️ Could not init knowledge base tables` in server logs indicates the migration failed (check the `vector` extension is installed).

---

## 5. TypeScript Compilation & Test Execution

### Verify Type Correctness
Run the TypeScript compiler without emitting JS files to check for any type mismatches:
```bash
npx tsc --noEmit
```

### Run Server Unit Tests
Execute the full suite (23 `node:test` suites under `server/tests/`) via `tsx`:
```bash
npm test
# or a single suite directly, e.g. the pipeline or validator coverage:
npx tsx --test server/tests/pipeline.test.ts
npx tsx --test server/tests/validatorFarmState.test.ts
npx tsx --test server/tests/knowledge.test.ts
```
Suites cover the four-stage pipeline (`pipeline.test.ts`), deterministic validation against a real `NormalizedFarmState` (`validator.test.ts`, `validatorFarmState.test.ts`), validation arithmetic (`mathHelper.test.ts`), the Explainer's critique-surfacing fallback (`explainerFallback.test.ts`), knowledge retrieval (`knowledge.test.ts`), plus the core calculation, effect, delivery, session, and security engines.
