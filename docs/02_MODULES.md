# 02. Modules & Component Catalog 📦

This document provides a comprehensive catalog of all modules, components, and responsibilities across the backend and frontend codebases.

---

## 1. Backend Modules (`server/`)

### 1.1 Core & Entry Point
- **`server/index.js`**: Application bootstrap file. Configures Express server, middleware (CORS, body parser, cookie parser), mounts `/api` routes, sets up global error and 404 handlers, and runs the `connectWithRetry` loop for database initialization.

### 1.2 Controllers (`server/controllers/`)
Controllers handle incoming HTTP requests, validate parameters, invoke services/models, and return formatted JSON responses.
- **`authController.js`**:
  - `register(req, res)`: Validates input, checks for existing username/email, hashes passwords via bcrypt, generates JWT, and sets cookie.
  - `login(req, res)`: Verifies user credentials, updates `last_login`, returns user record and signed JWT token.
  - `me(req, res)`: Returns the authenticated user's profile and farm ID.
  - `updateFarmId(req, res)`: Validates and binds a numeric Sunflower Land Farm ID to the user account.
  - `changePassword(req, res)`: Verifies existing password and updates to a newly hashed password.
- **`farmController.js`**:
  - `getFarmData(req, res)`: Fetches live farm data via `sunflower.js`, triggers a snapshot record, and returns canonical farm state.
  - `getMarket(req, res)`: Returns real-time market prices for tradable commodities.
  - `getPlanner(req, res)`: Computes and returns the optimal cooking pipeline for each production building.
  - `getActivity(req, res)`: Compares the two most recent snapshots to return observed and inferred farm activity deltas.
  - `getXpProgression(req, res)`: Returns historical XP progression data points for charting.
  - `getRecipes(req, res)`: Returns full recipe catalog grouped by building, with readiness states and active boosts.
- **`chatController.js`**:
  - `sendMessage(req, res)`: Dispatches prompt, session ID, and user context to `orchestrator.js`.
  - `getSessions(req, res)`: Lists past conversation sessions for the authenticated user.
  - `getSession(req, res)`: Retrieves complete message history for a specific session ID.
  - `deleteSession(req, res)`: Clears all chat messages for a specific session.

### 1.3 Data Models (`server/models/`)
Direct database abstraction layer executing parameterized SQL queries via `pg.Pool`.
- **`User.js`**: Methods `findByUsername`, `findByEmail`, `findById`, `create`, `updateFarmId`, `updatePassword`, `updateLastLogin`, `verifyPassword`.
- **`Snapshot.js`**: Methods `save`, `getRecent`, `getByRange`, `getProgression`, `deleteByUser`.
- **`ChatMessage.js`**: Methods `saveMessage`, `getSessionMessages`, `findSimilarMessages` (cosine distance search on `embedding <=> $1`), `getRecentSessions`, `deleteSession`.

### 1.4 Middleware (`server/middleware/`)
- **`auth.js`**:
  - `authenticateToken(req, res, next)`: Extracts JWT from `Authorization: Bearer <token>` or cookies, validates signature with `JWT_SECRET`, and populates `req.user`.
  - `requireFarmId(req, res, next)`: Ensures the authenticated user has bound an on-chain `farm_id`.
  - `optionalAuth(req, res, next)`: Attaches user if valid token exists, but does not block unauthenticated access.

### 1.5 Business Services (`server/services/`)
- **`orchestrator.js`**:
  - Implements the AI reasoning loop with Groq.
  - Generates 384-dimensional text embeddings locally using `@xenova/transformers`.
  - Performs RAG retrieval using pgvector cosine distance.
  - Formats system instructions with live farm metrics, inventory deficits, and cooking priorities.
- **`xpEngine.js`**:
  - `effective(name, recipe, farm)`: Computes modified recipe stats, applying skill boosts (e.g. *Munching Mastery* +5%/+7.5%, *Drive-Through Deli* +15%) and batch multipliers (*Double Nom*).
  - `cost(ingredients, prices, inventory, owned)`: Calculates FLOWER expenditure required to purchase missing ingredients.
  - Number formatting helpers: `fmt()`, `fmtXp()`, `fmtFlower()`, `hrs()`.
- **`planner.js`**:
  - `generatePlan(farm, recipes, prices)`: Evaluates all recipes per building to find the optimal XP/FLOWER and XP/Hour candidate. Determines total FLOWER affordability and identifies untradable bottleneck items.
- **`sunflower.js`**:
  - Community API client with in-memory TTL caching, atomic disk persistence (`.cache/api-cache.json`), and in-flight request deduplication via `Map` to prevent duplicate fetches under concurrent load.
- **`normalizer.js`**:
  - `toCanonical(raw)`: Standardizes polymorphic SFL payloads into a clean schema containing bumpkin levels, current/target XP, liquid FLOWER/coins, buildings, skills, inventory counts, and pending deliveries.
- **`snapshots.js`**:
  - Manages farm snapshot storage in PostgreSQL and calculates observed action counters and inferred inventory/XP movements between consecutive snapshots.
- **`recipes.js`**:
  - Loads and caches static game rules from `server/data/recipes.json` and `server/data/skills.json`.

---

## 2. Frontend Modules (`client/src/`)

### 2.1 Workspace Views & Components (`client/src/App.jsx`)
The central component containing the multi-tab Obsidian & Notion workspace:
- **`App()`**: Root UI container managing active tab selection, sidebar visibility, theme, farm data fetching, and keyboard shortcuts (`Ctrl+J` / `⌘J` for AI Copilot).
- **Navigation Tabs**:
  - `Dashboard`: Bumpkin Level, XP target progress bar, treasury counters, and active building cooking summaries.
  - `Planner`: Full optimization database table comparing building recipes, XP/batch, FLOWER costs, and daily farm blueprints.
  - `Recipes`: Complete cooking catalogue with readiness badges, missing ingredient counters, building filters, and skill boost indicators.
  - `Market`: Real-time orderbook valuation, inventory stock toggles ("Show All" / "In Stock Only"), and sortable valuation cards.
  - `Activity`: Snapshot delta tracker displaying observed game events and inferred resource changes.
  - `Quests`: NPC chore board, island deliveries pipeline, and animal/feather bounties.
  - `History`: Archived assistant conversation sessions with one-click session resumption.
- **Reusable UI Primitives**:
  - `Tag`: Color-coded Notion-style inline tag (`green`, `amber`, `blue`, `purple`, `red`, `gray`).
  - `PropertyItem`: Frontmatter metadata row with responsive label widths (`w-24 md:w-36`).
  - `BlockCard`: Modular Notion block container with header, icon, and actions.
  - `MetricStat`: KPI stat card with hover micro-animations, value formatting, and trend tags.
  - `PageIcon`: Universal pixel-art image and emoji renderer supporting animated WebP sprites.
  - `AntigravityChatModal`: Dr. Bumpkin floating chat interface with traffic lights, markdown rendering, quick prompts, and maximize/minimize window states.

### 2.2 Authentication & State Management
- **`Auth.jsx`**: Modal dialog for user sign-in and registration with tabbed switching, form validation, error callouts, and direct theme toggling.
- **`authContext.jsx`**:
  - Provides `useAuth()` hook.
  - Handles token storage in `localStorage`, auto-login on initial app load, and state broadcasting (`user`, `token`, `isAuthenticated`, `login`, `logout`, `updateFarmId`).
- **`api.js`**: Centralized HTTP client. Automatically attaches Bearer tokens from `localStorage`, sets `credentials: 'include'`, handles JSON serialization, and provides typed helper methods (`api.farm()`, `api.planner()`, `api.chat()`, etc.).
