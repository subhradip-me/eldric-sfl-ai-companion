# 📝 Sunflower AI Engineering Changelog

## 🚀 Release: `v1.2.0` — Codex Deliveries Engine, Security Gates & Containerization (2026-09-13 / 2026-09-14)

### 🎯 Objective
Empower Sunflower AI with deterministic Codex Deliveries, Weekly Chores & Poppy Bounty economic evaluation, expand Dr. Bumpkin's autonomous tool catalog to 15 tools with anti-hallucination real-example disambiguation, enforce Sybil-resistant registration (1 account per IP), manage concurrent device sessions (1 desktop + 1 mobile), implement an atomic AI credit quota model with real-time UI display, and containerize the stack with Docker & Redis hot store.

---

### 1. Pure Deterministic Codex Deliveries, Weekly Chores & Poppy Bounty Engine
- **Engine File**: [`server/core/economyEngine/deliveries.ts`](file:///d:/System33/User/SUBHRADIP/Sunflower%20Land%20HQ/sunflower-ai/server/core/economyEngine/deliveries.ts).
- **Deliveries Evaluation (`evaluateDeliveries`)**:
  - Automatically evaluates active NPC delivery orders across Coins, SFL, and Ascension Age seasonal Shiny Feathers.
  - Computes ingredient readiness (`readyNow`), market ingredient FLOWER costs, net SFL profit, and return on investment.
  - Dynamic Shiny Feather rewards based on NPC tier:
    - **Elite NPCs** (Pharaoh, Tywin): 6 base Shiny Feathers.
    - **Medium NPCs** (Cornwell, Bert, Raven, Jester): 3 base Shiny Feathers.
    - **Standard NPCs** (Finley, Miranda, etc.): 2 base Shiny Feathers.
  - Active VIP Membership boost: deterministically adds `+3 Shiny Feathers` to all seasonal orders (Pharaoh: 6 + 3 = 9 Feathers / +45 Ascension points; Cornwell: 3 + 3 = 6 Feathers / +30 pts; Finley/Miranda: 2 + 3 = 5 Feathers / +25 pts).
  - Highlights top recommendations: `bestCoinsDelivery` (Victoria: 1,100 Coins), `bestReadyNowDelivery` (Corale: 2 Mahi Mahi -> 578 Coins instantly with zero extra investment), `bestSflDelivery` (Grimtooth: 0.4 SFL), and `bestFeathersDelivery` (Pharaoh: 9 Feathers).
- **Weekly Chores & Bounties (`evaluateCodexTasks`)**:
  - Tab 21: Maps active chore requirements against live `farmActivity` counters (`currentProgress = farmActivity[activityName] - initialProgress`), e.g., Pumpkin' Pete at 199/200 pumpkins with 4 Shiny Feathers under VIP.
  - Tab 33: Categorizes Poppy Mega Bounty Board across 6 distinct domains (Flowers, Fish, Crustaceans, Animals, Artefacts, Giant Crops) and computes claim readiness.
- **Cryptographic Provenance**:
  - Wraps results in an authoritative `CalculationResult` envelope with SHA-256 state provenance.

---

### 2. Autonomous AI Orchestrator Expansion (15 Tools & Anti-Hallucination Disambiguation)
- **Tools Added**:
  - `get_deliveries`: Evaluates Coin, SFL, and seasonal delivery orders with net profit calculations and `readyNow` sorting.
  - `get_codex_chores_and_bounties`: Evaluates Weekly Chores with live `farmActivity` progress and the Poppy Mega Bounty board.
- **Anti-Hallucination Real-Examples Disambiguation (Rule 9)**:
  - If player intent is ambiguous or the AI must ask clarifying questions, the AI is strictly prohibited from inventing fake placeholder examples like `"Delivery 1 - Milk & Eggs"`. It MUST always cite real, active orders and chores directly from the player's Codex board with NPC names, exact ingredients, and actual rewards.

---

### 3. Security, Sybil Protection & Concurrent Session Governance
- **1-Account-Per-IP Registration Gate**:
  - Extracted client IP using reverse proxy trust (`req.headers['x-forwarded-for']` or `req.ip`) stored in `users.registration_ip`.
  - Blocks automated bot and sybil multi-account creation on public networks.
  - Developer accounts (`username === 'dev'` or `role === 'DEVELOPER'`) are cleanly exempted.
- **Concurrent Session Management (1 Desktop + 1 Mobile)**:
  - Device-specific session tracking via `active_sessions` table (`user_id`, `device_type`, `refresh_token_hash`, `last_active_at`).
  - Strict 1 Desktop + 1 Mobile concurrent limit: a new login on the same device type detects conflict, returns a 409 session conflict handshake, or supports `forceDisconnect: true` to invalidate previous refresh tokens.
  - Dual-token lifecycle: short-lived 15m `accessToken` + 30d `refreshToken` hashed with SHA-256.

---

### 4. Atomic AI Credit Quota & Usage Ledger
- **Atomic Credit Reservation**:
  - Database schema adds `ai_credits` (default: 50) and `ai_credits_used` (default: 0).
  - Pre-allocates/deducts 1 credit before calling LLM providers using atomic SQL:
    `UPDATE users SET ai_credits = ai_credits - $2, ai_credits_used = ai_credits_used + $2 WHERE id = $1 AND ai_credits >= $2 RETURNING ai_credits, ai_credits_used`.
  - Prevents race conditions and negative balances under concurrent requests.
  - Automatic refund on provider failure (`addAiCredits(userId, 1)`).
  - Developer accounts granted 999,999 credits and exempt from deduction.
- **Live UI Display**:
  - Displays remaining AI credits and usage in real-time in the application header and chat modal.

---

### 5. Multi-Stage Docker Containerization & Redis Hot Store
- **Production Containerization**:
  - Multi-stage `Dockerfile` optimizing build caching: Stage 1 builds React 19 / Vite SPA, Stage 2 packages Node.js 20 ESM TypeScript runtime.
  - `docker-compose.yml` orchestrates Node server, PostgreSQL 16 + pgvector, and Redis 7 Alpine hot cache with health checks and persistent volumes.
- **Hermetic Fallback**:
  - Seamless in-memory hot store fallback when Redis is offline or running locally without Docker.

---

### 6. Automated Testing & Verification
- **186 / 186 Automated Unit Tests Passing** (`npm test`):
  - Deliveries & Codex suite (`server/tests/deliveries.test.ts`).
  - Concurrent Sessions suite (`server/tests/sessions.test.ts`).
  - Security & AI Credit suite (`server/tests/securityAndCredits.test.ts`).
  - Deterministic Calculation Core & Effect Engine (`server/tests/phase7Effects.test.ts`).
  - Animal Produce & Feed Production Engine (`server/tests/animalEconomics.test.ts`).
- **Production Frontend Bundle**:
  - Clean Vite build in ~1.0s without warnings or type errors.

---

## 🚀 Branch: `refactor/js-to-ts-migration` (2026-09-09 / 2026-09-10)

### 🎯 Objective
Migrate the entire backend codebase from untyped JavaScript CommonJS/ESM to strongly-typed **TypeScript 5.9**, convert all functional controllers and services into **class-based object-oriented architectures**, modularize services into feature domains (`ai/`, `auth/`, `chat/`, `cooking/`, `farm/`), and fix critical AI pipeline calculation gaps.

---

### 1. TypeScript & Class-Based Architecture Migration
- **Runtime**: Switched server runtime to `tsx` for direct ESM TypeScript execution (`npm start`, `npm run dev`, and `npm test`).
- **Class-Based Controllers**:
  - `AuthController.ts`: Manages user credentials, registration, session rehydration, and farm linking.
  - `FarmController.ts`: Orchestrates farm state, market orderbooks, cooking pipelines, and snapshots.
  - `ChatController.ts`: Dispatches multi-turn conversational agent sessions.
- **Class-Based Modular Services (`server/services/`)**:
  - `farm/`: `SunflowerClient.ts` (tiered cache + in-flight deduplication), `FarmNormalizer.ts`, `SnapshotService.ts`, `ActivityService.ts`.
  - `cooking/`: `PlannerService.ts`, `RecipeService.ts`, `XpEngine.ts`.
  - `ai/`: `Orchestrator.ts` (12-tool autonomous agent loop), `GroqClient.ts`.
  - `auth/`: `AuthService.ts` (bcrypt hashing + JWT generation/verification).
  - `chat/`: `ChatStoreService.ts` (local ONNX vector embeddings + pgvector).
- **Type Safety**:
  - Created `server/types/index.ts` defining `CanonicalFarmState`, `CookingPlan`, `CookingPlanCandidate`, `RecipeDefinition`, `EffectiveRecipe`, `CostResult`, `SnapshotRecord`, `ChatMessageRecord`, `MarketPrice`, etc.
  - Resolved all TypeScript compiler errors (`npx tsc --noEmit` passes with 0 errors).
- **Backward Compatibility**:
  - Implemented legacy shims forwarding old file paths (`server/controllers/farmController.js`, `server/services/planner.js`, `server/services/xpEngine.js`, etc.) to the new modular TypeScript services.

---

### 2. AI Pipeline Bug Fixes & Validation
- **Swapped Snapshot Arguments (P0 Fix)**:
  - Fixed `snapshotService.latest(2, context.userId)` -> `snapshotService.latest(context.userId, 2)` in `Orchestrator.ts`. Previously, snapshots were queried for literal user #2 rather than the requesting user.
- **Building Ownership Verification Gate (P1 Fix)**:
  - Updated `compute_recipe_cost` in `Orchestrator.ts` to check `r.building in canonical.buildings`, returning `ownsBuilding: false` and a warning banner when the player lacks the required building.
- **In-Turn Tool Call Dedup Bypass (P1 Fix)**:
  - Added `force: true` support to tool arguments in `Orchestrator.ts`, allowing the agent to bypass the in-turn `seen` cache when new player constraints are introduced.

---

### 3. Documentation Overhaul
- Thoroughly updated `docs/` (`00_OVERVIEW.md` through `12_TODO_TRACKER.md`) with in-depth architecture diagrams, TypeScript domain contracts, and realistic code snippets illustrating end-to-end system mechanics.

---

## 📝 Historic Changes: `feature/public-auth` Branch

This branch transformed the Sunflower AI project from a personal tool to a public, multi-user application with authentication.

## 🎯 Main Goal
Enable multiple users to use Sunflower AI with their own accounts and farm data.

## ✨ New Features

### 🔐 Authentication System
- **User Registration**: Create accounts with username, email, and password
- **Login System**: Secure JWT-based authentication
- **Password Security**: Bcrypt hashing with 10 salt rounds
- **Token Management**: 7-day JWT tokens with auto-refresh
- **User Sessions**: Persistent login across browser sessions

### 👤 User Management
- **User Profiles**: Each user has their own profile and farm ID
- **Farm Linking**: Optional farm ID association during registration
- **Password Changes**: Users can update their passwords
- **User Menu**: Profile dropdown in sidebar with logout functionality

### 🗄️ Database Changes
- **Users Table**: Store user credentials and profile data
- **User Relationships**: Link chat history and farm snapshots to users
- **Database Schema**: Automated setup with `npm run setup`
- **Demo User**: Pre-configured demo account for testing

### 🎨 UI Improvements
- **Auth Screens**: Beautiful login and registration pages
- **Loading States**: Proper loading indicators during auth checks
- **User Avatar**: Initial-based avatar in sidebar
- **Dark Mode Support**: Full dark mode for auth screens
- **Error Handling**: Clear error messages for auth failures

### 🔒 Security Features
- **JWT Tokens**: Stateless authentication
- **Password Hashing**: bcrypt with salt rounds
- **Protected Routes**: Middleware for authenticated endpoints
- **Optional Auth**: Some endpoints work with or without auth
- **CORS Configuration**: Secure cross-origin requests

### 📚 Documentation
- **README_PUBLIC.md**: Comprehensive public documentation
- **DEPLOYMENT.md**: Detailed deployment guide for various platforms
- **setup.js**: Automated database setup script
- **Environment Variables**: Updated .env.example with JWT_SECRET

## 🔧 Technical Changes

### Backend (`server/`)
1. **New Files**:
   - `services/auth.js` - Authentication service
   - `db/schema.sql` - Database schema with users table
   
2. **Modified Files**:
   - `index.js` - Added auth routes and middleware
   - Updated all API endpoints to support optional authentication

3. **New Dependencies**:
   - `bcryptjs` - Password hashing
   - `jsonwebtoken` - JWT token generation
   - `express-session` - Session management
   - `cookie-parser` - Cookie handling

### Frontend (`client/`)
1. **New Files**:
   - `src/authContext.jsx` - Auth context provider
   - `src/Auth.jsx` - Login/register components
   
2. **Modified Files**:
   - `src/main.jsx` - Wrapped app in AuthProvider
   - `src/App.jsx` - Added auth checks and user menu
   - `src/api.js` - Include auth tokens in requests

### Configuration
1. **Environment Variables**:
   - Added `JWT_SECRET` for token signing
   - Updated `.env.example`

2. **Scripts**:
   - Added `npm run setup` for database initialization

## 📊 Database Schema

### New Tables

#### `users`
```sql
- id (SERIAL PRIMARY KEY)
- username (VARCHAR, UNIQUE)
- email (VARCHAR, UNIQUE)
- password_hash (VARCHAR)
- farm_id (VARCHAR, NULLABLE)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- last_login (TIMESTAMP)
```

#### `sessions` (optional)
```sql
- sid (VARCHAR PRIMARY KEY)
- sess (JSON)
- expire (TIMESTAMP)
```

### Modified Tables
- `chat_history` - Added `user_id` foreign key
- `farm_snapshots` - Added `user_id` foreign key

## 🚀 API Changes

### New Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user (protected)
- `PUT /api/auth/farm` - Update farm ID (protected)
- `PUT /api/auth/password` - Change password (protected)

### Modified Endpoints
All existing endpoints now support optional authentication:
- Farm data is user-specific if authenticated
- Chat history is user-specific if authenticated
- Snapshots are user-specific if authenticated

## 🔄 Migration Path

### From Single User to Multi-User

1. **Backup existing data**
   ```bash
   pg_dump $DATABASE_URL > backup.sql
   ```

2. **Run setup script**
   ```bash
   npm run setup
   ```

3. **Create your user account**
   - Use the registration screen
   - Or create via database

4. **Link existing data** (optional)
   ```sql
   UPDATE chat_history SET user_id = 1 WHERE user_id IS NULL;
   UPDATE farm_snapshots SET user_id = 1 WHERE user_id IS NULL;
   ```

## 📦 Installation for New Users

1. **Clone and install**
   ```bash
   git clone <repo>
   cd sunflower-ai
   git checkout feature/public-auth
   npm install
   cd client && npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Setup database**
   ```bash
   npm run setup
   ```

4. **Start application**
   ```bash
   # Terminal 1
   npm run dev
   
   # Terminal 2
   cd client && npm run dev
   ```

5. **Access application**
   - Open http://localhost:5173
   - Use demo/demo123 or create new account

## 🎓 Demo Account

For testing purposes, the setup script creates:
- **Username**: demo
- **Password**: demo123
- **Email**: demo@sunflower-ai.local

## 🔜 Future Enhancements

Potential additions for future releases:
- [ ] Email verification
- [ ] Password reset via email
- [ ] Social auth (Google, Discord)
- [ ] Two-factor authentication
- [ ] User settings page
- [ ] Admin dashboard
- [ ] User roles and permissions
- [ ] API rate limiting per user
- [ ] User activity logs
- [ ] Account deletion

## 📋 Testing Checklist

Before merging to main:
- [x] Registration works
- [x] Login works
- [x] Protected routes check auth
- [x] User menu displays correctly
- [x] Logout clears session
- [x] API includes auth headers
- [x] Dark mode works on auth screens
- [x] Setup script creates demo user
- [x] Database schema applies correctly
- [x] Error messages are user-friendly

## 🔗 Related Documentation

- [README_PUBLIC.md](./README_PUBLIC.md) - User-facing documentation
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment instructions
- [.env.example](./.env.example) - Environment configuration

## 🤝 Contributing

When contributing to this branch:
1. Follow existing auth patterns
2. Test with both authenticated and anonymous users
3. Update documentation for new features
4. Maintain backward compatibility where possible

---

**Branch**: `feature/public-auth`  
**Base**: `master`  
**Status**: ✅ Ready for review/merge  
**Created**: 2026-09-07
