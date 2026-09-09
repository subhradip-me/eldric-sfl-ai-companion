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
   If hitting limits frequently during active development, increase cache lifetime in `server/services/sunflower.js`:
   ```javascript
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

## 4. Local Vector Embedder (@xenova/transformers) Delays

### Symptoms
- The first AI chat query to Dr. Bumpkin takes 10–15 seconds to respond.
- Subsequent queries respond in under 1 second.

### Root Causes
- On the very first run, `@xenova/transformers` downloads the ONNX weights for `Xenova/all-MiniLM-L6-v2` (~25MB) and caches them locally.

### Diagnostic & Remediation Steps
1. **Verify Internet Access**: Ensure your server environment can connect to Hugging Face CDN.
2. **Verify Local Cache**: The model files are cached in Node's cache directory or user profile. Do not purge this cache.
3. **Pre-warm the Embedder**: During server startup or smoke tests, invoke a dummy embedding calculation so user requests never experience download latency.

---

## 5. Client HMR & Vite Dev Server Glitches

### Symptoms
- Vite displays stale CSS rules or fails to reflect recent changes in `App.jsx`.
- Console shows `[vite] connecting...` without completing WebSocket handshake.

### Remediation
1. Stop the Vite dev server (Ctrl+C in terminal).
2. Clear the Vite pre-bundling cache:
   ```bash
   rm -rf client/node_modules/.vite
   ```
3. Restart the client:
   ```bash
   cd client && npm run dev
   ```
