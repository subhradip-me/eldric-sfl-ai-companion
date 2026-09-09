# 12. Project Roadmap & Technical TODO Tracker 📋

This tracker details prioritized backlog items, verification tasks, and architectural enhancements planned for Sunflower AI.

---

## 1. High-Priority Verification Items

| Item | Component | Current State | Action Required | Priority |
|---|---|---|---|---|
| **Level XP Anchors** | `server/data/levels.json` | Contains placeholder interpolation for levels 50–100 | Extract and replace with exact verified XP requirements from the Sunflower Land on-chain Bumpkin smart contract. | `P0 - High` |
| **Unverified Recipes** | `server/data/recipes.json` | Several recipes flagged as `verified: false` | Confirm in-game ingredient quantities and cooking times for Lemon Cheesecake, Honey Cheddar, Shroom Syrup, and Cheese. | `P0 - High` |
| **Modifier Precision** | `server/data/modifiers.json` | Experimental modifier ratios | Compare observed vs effective recipe outcomes to validate exact percentages for all active NFT collectible boosts. | `P1 - Medium` |

---

## 2. Core Engine & Backend Enhancements

### 2.1 Multi-Farm Switching
- **Current Limitation**: Each user account binds a single `farm_id`.
- **Target**: Allow a single user account to associate multiple Sunflower Land farm IDs (e.g. personal farm, guild farm, alt farm) and switch between them dynamically in the top workspace selector.

### 2.2 Scheduled Background Snapshots
- **Current Limitation**: Snapshots are recorded on-demand when the player opens the app or calls `GET /api/farm`.
- **Target**: Add an optional Node-cron job that periodically snapshots bound farms (e.g. every 6 hours), ensuring an uninterrupted progression timeline even when the player is offline.

### 2.3 Skill Tree Simulator
- **Target**: Provide a predictive sandbox where players can simulate allocating skill points (e.g. *Munching Mastery II*, *Drive-Through Deli*) to forecast immediate XP/FLOWER efficiency gains before committing skill points in-game.

---

## 3. Conversational AI & Copilot Upgrades

### 3.1 Streaming Chat Responses (SSE)
- **Current State**: Dr. Bumpkin returns the full AI response in a single JSON payload upon completion.
- **Target**: Implement **Server-Sent Events (SSE)** streaming (`res.writeHead(200, { 'Content-Type': 'text/event-stream' })`), rendering tokens in real-time within the `AntigravityChatModal`.

### 3.2 Tool-Calling & Autonomous Planning
- **Target**: Equip Dr. Bumpkin with function-calling capabilities:
  - `query_market_price(item_name)`
  - `calculate_optimal_batch(food_name, count)`
  - `filter_recipes_by_ingredient(ingredient)`

---

## 4. Frontend & Mobile Enhancements

### 4.1 Progressive Web App (PWA) Support
- **Target**: Add `manifest.json` and a lightweight service worker to enable "Add to Home Screen" on iOS Safari and Android Chrome, caching the static assets for instant mobile launches.

### 4.2 Blueprint Exporting
- **Target**: Allow players to export "Today's Action Blueprint" to a clean Markdown checklist or CSV spreadsheet for guild coordination.

### 4.3 Push Notifications
- **Target**: Web Push notifications alerting players when active cooking recipes finish or when market price thresholds are crossed.

---

## 5. Completed Milestones (Archive)

- [x] Multi-user authentication system with bcrypt & JWT.
- [x] PostgreSQL 16 schema with `pgvector` semantic vector store.
- [x] Dual-pane Obsidian + Notion hybrid workspace desktop design.
- [x] Discord-style permanent mobile dock (`w-12`) with disabled squish drawer and user popover.
- [x] Bottom overlap buffer fix (`pb-28`) and compact mobile launcher button.
- [x] In-flight request deduplication map and disk persistence caching.
- [x] Snapshot delta tracking engine (observed counters vs inferred movements).
- [x] Groq LLM integration with local 384-dimensional ONNX vector embeddings.
