# Sunflower AI 🌻 — Farm Command Center (V1.1)

Decision-support tool for reaching Bumpkin Level 100 with multi-user authentication and MVC architecture.

## Architecture

**MVC Structure:**
- `server/models/` - Database models (User, ChatMessage, Snapshot)
- `server/controllers/` - Request handlers (authController, farmController, chatController)
- `server/routes/` - Route definitions (auth, farm, chat)
- `server/middleware/` - Authentication middleware
- `server/services/` - Business logic (AI orchestrator, planner, recipes, etc.)

**User-Scoped Data:**
- Each user has their own farm_id, chat history, and snapshots
- JWT-based authentication with 7-day token expiry
- All data is isolated by user_id

## Run

```bash
# 1. Database
docker compose up -d

# 2. Setup (first time only - creates tables and demo user)
cp .env.example .env        # fill SUNFLOWER_API_KEY + GROQ_API_KEY + JWT_SECRET
npm install
npm run setup              # Creates users, snapshots, chat_messages tables + demo user

# 3. Server
npm start                   # http://localhost:3000

# 4. Client (separate terminal)
cd client && npm install && npm run dev   # http://localhost:5173

# Demo credentials: username=demo, password=demo123

# Tests (incl. Pizza golden test)
npm test
```

## Authentication Flow

1. **Register** - `POST /api/auth/register` with username, email, password (optional farmId)
2. **Login** - `POST /api/auth/login` returns JWT token
3. **Set Farm ID** - `PUT /api/auth/farm` with farmId (Sunflower Land farm ID)
4. **Access Protected Routes** - Include `Authorization: Bearer <token>` header

## Endpoints

**Auth:**
- `POST /api/auth/register` - Create new user account
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/me` - Get current user info (protected)
- `PUT /api/auth/farm` - Update farm ID (protected)
- `PUT /api/auth/password` - Change password (protected)

**Farm Data (requires auth + farm_id):**
- `GET /api/farm` - Get farm state for authenticated user
- `GET /api/planner` - Get optimized recipe plan
- `GET /api/activity` - Get activity delta between snapshots
- `GET /api/xp-progression?days=7` - Get XP progression chart

**Chat (requires auth + farm_id):**
- `POST /api/chat` - Send message to AI assistant
- `GET /api/sessions` - List all chat sessions
- `GET /api/sessions/:id` - Get messages for a session
- `DELETE /api/sessions/:id` - Delete a chat session

**Public:**
- `GET /api/health` - Health check
- `GET /api/market` - Market prices (no auth needed)

## Notes / TODO before trusting numbers

- `server/data/levels.json` has **placeholder** level anchors — paste the verified level table.
- All recipes are `verified: false`; ingredient lists for Lemon Cheesecake, Honey Cheddar, Shroom Syrup and Cheese cook times are guesses — confirm in-game.
- `modifiers.json` values (except Double Nom) are placeholders; EFFECTIVE vs OBSERVED mismatches will reveal wrong ones.
- Routes are consolidated in `server/index.js` (small app); split into `routes/` files when they grow.
- Snapshots require Postgres; the server still runs without it (snapshots/activity/history disabled).
- DB image is now `pgvector/pgvector:pg16` (chat memory + history). If you had the old volume: `docker compose down -v && docker compose up -d`, then `npm install` (new dep: @xenova/transformers — embedding model ~25MB downloads on first chat).
