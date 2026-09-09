# 00. System Overview 🌻

## 1. Introduction

**Sunflower AI** is an advanced operational command center and decision-support intelligence platform designed for players of **Sunflower Land (SFL)**—a Web3 farming, gathering, and crafting simulation on the Polygon blockchain.

The primary objective of Sunflower AI is to solve the complex mathematical, temporal, and economic challenge of progressing an on-chain **Bumpkin to Level 100 Mastery** while maximizing resource efficiency (FLOWER currency, crops, animal products, and cooking building uptime).

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              SUNFLOWER AI                                  │
│                 Bumpkin Level 100 Autonomous Command Center                │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│   Cooking Planner    │   │  Market & Arbitrage  │   │  Dr. Bumpkin Copilot │
│  XP/FLOWER & XP/Hour │   │ Real-time orderbooks │   │ RAG-backed reasoning │
│  Building pipelines  │   │ Inventory valuation  │   │  On-chain contextual │
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

---

## 2. Core Value Pillars

### 2.1 Optimal Cooking & XP Progression Pipeline
Cooking food is the primary mechanism for gaining Bumpkin XP in Sunflower Land. However, food recipes require diverse ingredients (crops, fruit, milk, eggs, honey, fish) across multiple production buildings:
- **Fire Pit** (basic foods)
- **Kitchen** (intermediate dishes)
- **Bakery** (advanced pastries and cakes)
- **Deli** (sandwiches and luxury foods)
- **Smoothie Shack** (liquid XP boosters)

Sunflower AI dynamically models:
- **Base XP vs. Effective XP**: Factors in skill tree masteries (e.g., *Munching Mastery*, *Drive-Through Deli*) and active collectible NFT boosts.
- **Batch Output & Boosts**: Considers *Double Nom* and batch yield multipliers.
- **XP per FLOWER Cost**: Identifies the cheapest routes to Level 100 in terms of liquid token expenditure.
- **XP per Production Hour**: Identifies the fastest routes to Level 100 in terms of real-world cooking time.

### 2.2 Inventory & Real-Time Market Valuation
- Synchronizes with community orderbooks to establish live market prices for all tradable crops, animal goods, and consumables.
- Computes total farm liquid inventory value in FLOWER.
- Automatically calculates ingredient deficits: whether items should be produced directly on the farm or purchased from the marketplace.

### 2.3 Activity & Snapshot Delta Engine
- Stores historical point-in-time state snapshots in PostgreSQL.
- Calculates exact observation windows and computes:
  - **Observed activity counters** (crops planted/harvested, trees chopped, iron mined).
  - **Inferred activity** (XP deltas, net currency changes, items consumed/sold).

### 2.4 Context-Aware AI Copilot ("Dr. Bumpkin")
- Conversational farm strategist powered by **Groq Cloud LLMs**.
- Uses **Retrieval-Augmented Generation (RAG)**:
  - Embeds conversation history into 384-dimensional vector spaces using `@xenova/transformers`.
  - Performs cosine-similarity retrieval via **PostgreSQL `pgvector`**.
  - Automatically injects live farm state, bumpkin tier, and current deficits into the system prompt.

### 2.5 Multi-Tenant Architecture & Data Isolation
- Robust user authentication system powered by bcrypt password hashing and JWT authorization.
- Strict isolation of Farm IDs, historical snapshots, and assistant conversation sessions by `user_id`.

---

## 3. Technology Stack

| Domain | Technology | Purpose |
|---|---|---|
| **Backend Runtime** | Node.js (v18+) & Express | Asynchronous REST API, routing, and controller layer |
| **Relational Database** | PostgreSQL 16 | ACID transaction storage for users, snapshots, sessions |
| **Vector Database** | `pgvector` Extension | Vector storage and high-speed cosine similarity retrieval |
| **Local AI Embeddings** | `@xenova/transformers` (`all-MiniLM-L6-v2`) | Pure JavaScript vector generation without external API dependencies |
| **LLM Inference** | Groq Cloud API | Ultra-low latency chat completions for farm strategy |
| **Frontend Framework** | React 19 & Vite | High-performance single page application (SPA) |
| **Styling & Design System** | TailwindCSS + Obsidian/Notion Tokens | Hybrid dual-pane document workspace and responsive mobile dock |
| **Web3 Data Ingestion** | SFL Community API & Polygon RPC | Live on-chain farm state retrieval with TTL disk cache |

---

## 4. Key Directories & Workspace Layout

```
sunflower-ai/
├── client/                     # React 19 + Vite Frontend SPA
│   ├── public/                 # Pixel-art sprites & WebP chibis
│   ├── src/
│   │   ├── App.jsx             # Main workspace shell (Ribbon, Sidebar, Canvas, Copilot)
│   │   ├── Auth.jsx            # Authentication modal & registration
│   │   ├── authContext.jsx     # Global JWT & user state provider
│   │   ├── api.js              # Fetch client with automatic Bearer token injection
│   │   └── index.css           # Design system tokens and custom scroll utilities
├── server/                     # Node.js Express Backend
│   ├── controllers/            # Request handlers (auth, farm, chat)
│   ├── models/                 # Database abstraction layer (User, Snapshot, ChatMessage)
│   ├── routes/                 # Express route definitions
│   ├── middleware/             # JWT authentication gatekeeper
│   ├── services/               # Core business logic (orchestrator, xpEngine, planner)
│   ├── db/                     # Database connection pool and schema definitions
│   └── data/                   # Game rules, skills, recipes, and levels JSON
├── docs/                       # Comprehensive documentation suite
├── docker-compose.yml          # PostgreSQL 16 + pgvector container orchestration
├── README.md                   # Repository entry point
└── DEPLOYMENT.md               # Production deployment guide
```
