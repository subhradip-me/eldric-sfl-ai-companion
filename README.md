# Sunflower AI 🌻 — Farm Command Center (V1.1)

Decision-support tool for reaching Bumpkin Level 100. See `design-v1.1.md` for the full design.

## Run

```bash
# 1. Database
docker compose up -d

# 2. Server
cp .env.example .env        # fill SUNFLOWER_API_KEY + GROQ_API_KEY
npm install
npm start                   # http://localhost:3000

# 3. Client (separate terminal)
cd client && npm install && npm run dev   # http://localhost:5173

# Tests (incl. Pizza golden test)
npm test
```

## Endpoints

`GET /api/health · /api/farm · /api/market · /api/planner · /api/activity` · `POST /api/chat`

## Notes / TODO before trusting numbers

- `server/data/levels.json` has **placeholder** level anchors — paste the verified level table.
- All recipes are `verified: false`; ingredient lists for Lemon Cheesecake, Honey Cheddar, Shroom Syrup and Cheese cook times are guesses — confirm in-game.
- `modifiers.json` values (except Double Nom) are placeholders; EFFECTIVE vs OBSERVED mismatches will reveal wrong ones.
- Routes are consolidated in `server/index.js` (small app); split into `routes/` files when they grow.
- Snapshots require Postgres; the server still runs without it (snapshots/activity/history disabled).
- DB image is now `pgvector/pgvector:pg16` (chat memory + history). If you had the old volume: `docker compose down -v && docker compose up -d`, then `npm install` (new dep: @xenova/transformers — embedding model ~25MB downloads on first chat).
