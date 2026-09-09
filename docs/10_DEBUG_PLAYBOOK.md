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
   Verifies that tables (`users`, `snapshots`, `chat_messages`) and the vector extension are created.

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

## 4. Groq Tool-Use Malformed JSON & Failure Recovery

### Symptoms
- Server logs output:
  `[groq] tool_use_failed — model emitted malformed tool-call JSON, will retry`
- LLM agent falls back to answering without calling remaining tools.

### Root Causes
- Upstream open-source LLM occasionally outputs invalid JSON escape sequences in tool arguments.

### Diagnostic & Remediation Steps
1. **Automatic Agent Recovery**: `Orchestrator.ts` tracks consecutive tool errors. If one occurs, it feeds a recovery prompt back to the model:
   ```typescript
   if (j._toolError) {
     messages.push({
       role: 'user',
       content: 'Your last tool call had invalid JSON arguments. Try again with valid JSON, or answer directly.',
     });
   }
   ```
2. **Test Model Connectivity**: Verify your Groq API key and rate limits:
   ```bash
   curl -X POST https://api.groq.com/openai/v1/chat/completions \
     -H "Authorization: Bearer $GROQ_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "llama-3.3-70b-versatile", "messages": [{"role": "user", "content": "ping"}]}'
   ```

---

## 5. TypeScript Compilation & Test Execution

### Verify Type Correctness
Run the TypeScript compiler without emitting JS files to check for any type mismatches:
```bash
npx tsc --noEmit
```

### Run Server Unit Tests
Execute the unit test suite via `tsx`:
```bash
npm test
# or directly:
npx tsx --test server/tests/xpEngine.test.js
```
All 8 unit tests validating skill boosts, batch yield multipliers, and intermediate craft expansions should pass with 0 failures.
