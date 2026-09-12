# 🌻 Sunflower Land AI Farm Strategist
## Implementation Guide — Game Data + UI + AI Copilot

**Version:** 1.0  
**Target:** Existing React/Vite + Node/Express application  
**Game data:** `sunflower_land_game_data_v1`  
**Architecture:** deterministic core + farm state + planner + AI orchestrator

---

# 1. Implementation Goal

The application should evolve into a **Farm Strategist**, not an LLM-powered calculator.

The runtime pipeline is:

```text
Community API
     ↓
Farm Sync
     ↓
PostgreSQL Snapshot Authority
     ↓
Redis Hot Farm State
     ↓
Farm Normalizer
     ↓
Effect Engine
     ↓
Deterministic Engines
     ↓
Planner
     ↓
AI Orchestrator
     ↓
AI Copilot UI
```

The central boundary remains:

```text
Game Data       → authoritative rules
Farm Snapshot   → observed state
Core Engines    → derived numbers
Planner         → strategy
LLM             → understanding + explanation
Memory          → goals/preferences/context
```

Do not move game calculations into the LLM.

---

# 2. Use the Dataset as the Runtime Foundation

Install the generated package under:

```text
server/data/game/
```

Recommended structure:

```text
server/
├── data/
│   └── game/
│       ├── game_metadata.json
│       ├── building_taxonomy.json
│       ├── cooking_rules_v0.9.8.json
│       ├── animal_rules.json
│       ├── pet_rules.json
│       ├── effect_rules.json
│       ├── market_stock_rules.json
│       └── sunflower_land_dataset_v1.json
│
├── domain/
│   ├── metadata.ts
│   ├── building.ts
│   ├── production.ts
│   ├── animal.ts
│   ├── pet.ts
│   ├── effects.ts
│   ├── farm.ts
│   └── ai.ts
│
├── core/
│   ├── xpEngine/
│   ├── productionEngine/
│   ├── recipeEngine/
│   ├── animalEngine/
│   ├── petEngine/
│   ├── effectEngine/
│   ├── economyEngine/
│   ├── temporalEngine/
│   ├── historyEngine/
│   └── planner/
│
├── services/
│   ├── farm/
│   ├── gameData/
│   └── ai/
│
├── api/
│   ├── farm/
│   ├── planner/
│   └── ai/
│
└── scripts/
    └── generateGameMetadata.ts
```

Keep `items.json` only as a generated legacy compatibility artifact.

---

# 3. Game Data Service

Create one immutable service responsible for loading static game data.

```ts
export interface GameDataService {
  getItem(name: string, kind?: ItemKind): ItemMetadata | undefined;

  getBuilding(name: string): BuildingDefinition | undefined;

  getAnimalRule(
    animalType: AnimalType,
    fromLevel: number,
    toLevel: number
  ): AnimalProductionRule | undefined;

  getCookingRecipe(name: string): CookingRecipe | undefined;

  getEffectDefinition(name: string): EffectDefinition | undefined;

  getPetRule(name: string): PetRule | undefined;

  getMarketRule(name: string): MarketRule | undefined;

  getManifest(): GameDataManifest;
}
```

Load once at process startup.

Do not read JSON from disk during every calculation.

Use:

```text
JSON → validated object → frozen in-memory catalog
```

Every result should carry:

```ts
{
  gameDataVersion,
  ruleVersion,
  source
}
```

This makes future rule changes reproducible.

---

# 4. Building Model

Do not make every building use one generic production structure.

Use four layers:

```text
BuildingState
    ↓
BuildingCapability
    ↓
BuildingOperationState
    ↓
ActiveProductionState
```

Example:

```ts
interface BuildingState {
  id: string;
  type: BuildingType;
  level: number;
  coordinates?: Coordinates;
}

interface BuildingCapability {
  category: BuildingCategory;
  productionModel: ProductionModel;
}

interface ActiveProductionState {
  id: string;
  operation: ProductionOperation;
  product?: string;
  input?: Record<string, number>;
  startedAt?: number;
  readyAt?: number;
}
```

Production models:

```ts
type ProductionModel =
  | "NONE"
  | "CRAFTING"
  | "COOKING"
  | "COMPOSTING"
  | "CROP_PLOT"
  | "CROP_PROCESSING"
  | "SEASONAL_RECIPE"
  | "RESOURCE_RECOVERY"
  | "ANIMAL_DRIVEN"
  | "PET_MANAGEMENT"
  | "TRADING"
  | "STORAGE"
  | "RACK_PROCESSING";
```

The 22 building types are already represented in `building_taxonomy.json`.

---

# 5. Special Building Models

## Aging Shed

Do not represent it as one production queue.

Use:

```ts
type AgingRackType =
  | "AGING"
  | "FERMENTATION"
  | "SPICE";

interface AgingRack {
  rackType: AgingRackType;
  slots: ActiveProductionState[];
}
```

Runtime:

```text
Aging Shed
 ├── Aging
 │    ├── Slot 1
 │    ├── Slot 2
 │    └── ...
 ├── Fermentation
 └── Spice
```

The supplied farm snapshot demonstrates six active entries per rack at level 6.

## Greenhouse

Model it as crop plots:

```ts
interface GreenhousePlot {
  id: string;
  crop?: string;
  plantedAt?: number;
  readyAt?: number;
  state: "EMPTY" | "GROWING" | "READY";
}
```

The supplied source indicates four plots.

## Hen House / Barn

These are animal-driven production buildings.

```ts
interface AnimalBuildingState {
  buildingType: "Hen House" | "Barn";
  level: number;
  animals: AnimalState[];
}
```

Never convert animal production into a fake recipe.

---

# 6. Animal Engine

Create:

```text
server/core/animalEngine/
├── animalProduction.ts
├── animalHealth.ts
├── animalLove.ts
└── index.ts
```

Production calculation:

```text
Animal Rule
   +
Animal Level
   +
Animal State
   +
Feed Buff
   +
Love / interaction state
   +
EffectContext
   ↓
Animal Production Result
```

Example:

```ts
calculateAnimalProduction({
  animal,
  building,
  rules,
  effectContext,
  now
})
```

The supplied rules include Chicken, Cow and Sheep level transitions from 0→1 through 14→15.

Do not infer sickness from missing fields.

Only activate the sickness modifier when the normalized farm state explicitly establishes sickness.

---

# 7. Effect Engine

This is one of the most important pieces.

Create:

```text
server/core/effectEngine/
├── resolveEffectContext.ts
├── effectRegistry.ts
├── effectMath.ts
└── index.ts
```

The architecture requires a first-class `EffectContext`, resolved per farm and snapshot.

```ts
interface EffectContext {
  farmId: string;
  snapshotVersion: number;

  xp: {
    food?: ModifierSet;
    farming?: ModifierSet;
    global?: ModifierSet;
  };

  cooking: {
    time?: ModifierSet;
    xp?: ModifierSet;
  };

  crops: ModifierSet;
  resources: ModifierSet;
  animals: ModifierSet;
  fishing: ModifierSet;

  activeEffects: ActiveEffect[];

  provenance: CalculationProvenance;
}
```

Important:

```text
Inventory possession ≠ active effect
```

Examples:

```text
Blossombeard in inventory
    → inactive

Blossombeard equipped
    → active

Collectible owned but not placed
    → inactive

Collectible placed on farm
    → active
```

The supplied effect data includes Blossombeard (+10% XP), Desert Gnome (-10% cooking time), and the supplied shrine effects.

Do not hard-code:

```ts
if (boosts.includes("Blossombeard"))
```

Instead:

```ts
const effects = resolveEffectContext(farmState);
calculateFoodXp(input, effects);
```

The canonical stacking/rounding order is **not frozen yet**. Keep it configurable until verified.

---

# 8. Deterministic Calculation Contract

Every engine should look conceptually like:

```ts
calculateX(input): CalculationResult<X>
```

Never:

```ts
calculateX()
```

where the function silently reads Redis, current time, global state, or the network.

Example:

```ts
const result = calculateAnimalProduction({
  animal,
  building,
  gameRules,
  effectContext,
  now
});
```

Result:

```ts
{
  value: {
    outputs: [...],
    xp: 120,
    readyAt: 123456789
  },

  epistemicTier: "DERIVED",

  provenance: {
    calculationType: "animal-production",
    engineVersion: "1.0.0",
    gameDataVersion: "0.9.8",
    snapshotVersion: 123,
    calculatedAt: now
  }
}
```

---

# 9. Farm Runtime State

Keep PostgreSQL and Redis responsibilities separate.

```text
PostgreSQL
    ↓
durable snapshot authority

Redis
    ↓
hot current-state projection
```

Redis should contain the latest farm state needed for interactive requests.

Example:

```text
farm:{farmId}:state
farm:{farmId}:version
farm:{farmId}:sync
```

Every update must be monotonic:

```text
incoming snapshot 1002
        ↓
Redis currently 1003
        ↓
reject 1002
```

Never allow an older API response to overwrite newer state.

---

# 10. Backend API

Recommended REST endpoints:

```http
GET /api/farms
GET /api/farms/:farmId
GET /api/farms/:farmId/production
GET /api/farms/:farmId/effects
GET /api/farms/:farmId/animals
GET /api/farms/:farmId/pets
GET /api/farms/:farmId/roadmap
GET /api/farms/:farmId/history
GET /api/farms/:farmId/temporal
```

AI endpoint:

```http
POST /api/ai/chat
```

Request:

```json
{
  "farmId": "farm_123",
  "conversationId": "conv_456",
  "message": "What should I do next?"
}
```

The server resolves:

```text
farmId
 ↓
Redis state
 ↓
EffectContext
 ↓
planner context
 ↓
AI tools
 ↓
LLM
```

The browser should never call the Community API directly.

The browser should also never receive the Community API key.

---

# 11. AI Copilot Architecture

Use the existing `Orchestrator`.

```text
React Copilot
      ↓
POST /api/ai/chat
      ↓
Orchestrator
      ↓
Tool Loop
      ↓
Deterministic Tools
      ↓
LLM
      ↓
Structured response
      ↓
React Copilot
```

Tools:

```text
get_farm_state
get_temporal_context
get_history_metrics
get_roadmap
check_action_permission
evaluate_strategy_feasibility
compute_recipe_cost
get_market_prices
get_item_metadata
recall_memory
```

The metadata tool should return:

```ts
{
  epistemicTier: "AUTHORITATIVE",
  sourceType: "GAME_METADATA",
  gameDataVersion,
  sourceSha256,
  metadata
}
```

Farm state remains:

```text
OBSERVED
```

Calculations:

```text
DERIVED
```

Historical hypotheses:

```text
INFERRED
```

---

# 12. AI Tool Loop

Keep the existing bounded tool loop.

```ts
const MAX_TOOL_CALLS = 10;
const MAX_REPEATED_CALLS = 2;
```

Deduplicate using:

```text
toolName + stableStringify(arguments)
```

The LLM can request:

```text
get_farm_state
```

then:

```text
get_roadmap
```

then:

```text
check_action_permission
```

but it cannot invent numerical outputs.

Example:

User:

> Can I cook Pancakes right now?

LLM:

```json
{
  "tool": "check_action_permission",
  "arguments": {
    "farmId": "farm_123",
    "action": {
      "type": "COOK",
      "item": "Pancakes"
    }
  }
}
```

Deterministic tool:

```json
{
  "allowed": true,
  "requirements": [...],
  "effectsApplied": [...],
  "provenance": {...}
}
```

LLM:

> Yes. You have the required ingredients, and your active cooking effects reduce the expected cook time to X minutes.

The LLM explains the result; it does not calculate X.

---

# 13. AI Provider Connection

Create a provider abstraction.

```ts
interface AIProvider {
  stream(request: AIRequest): AsyncIterable<AIEvent>;
}
```

Then:

```text
AIProvider
 ├── GroqProvider
 ├── OpenAIProvider
 └── MockAIProvider
```

Do not couple `Orchestrator` directly to one vendor SDK.

Environment:

```env
AI_PROVIDER=groq
AI_MODEL=your-model
AI_API_KEY=...
```

The exact model can remain configuration.

This gives you:

```text
Orchestrator
     ↓
AIProvider
     ↓
Groq / OpenAI / another provider
```

without changing planner or deterministic code.

---

# 14. Streaming to the Copilot UI

Use **SSE** for the first implementation.

Endpoint:

```http
POST /api/ai/chat/stream
```

The server emits events such as:

```text
event: message_start

event: tool_start
data: {"tool":"get_farm_state"}

event: tool_result
data: {"tool":"get_farm_state","status":"success"}

event: tool_start
data: {"tool":"get_roadmap"}

event: tool_result
data: {"tool":"get_roadmap","status":"success"}

event: token
data: {"text":"Based on your current farm..."}

event: message_end
```

Why SSE first:

- simple browser integration
- server → client streaming
- no WebSocket lifecycle complexity
- perfect for LLM token streams
- easy to reconnect

WebSockets can be introduced later if the application needs bidirectional live events.

---

# 15. Copilot UI

The copilot should not look like a generic ChatGPT clone.

It should feel like a **farm control center**.

Recommended desktop layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ 🌻 Farm Strategist                         Farm A   ● Live │
├───────────────────────────────────────┬─────────────────────┤
│                                       │                     │
│             FARM VIEW                 │    AI COPILOT       │
│                                       │                     │
│   buildings / crops / animals         │  "What should I    │
│   production status                   │   do next?"         │
│                                       │                     │
│                                       │  ┌───────────────┐  │
│                                       │  │ Chat message  │  │
│                                       │  └───────────────┘  │
│                                       │                     │
├───────────────────────────────────────┤                     │
│ Production | Animals | Effects        │ Suggested actions   │
├───────────────────────────────────────┴─────────────────────┤
│ Roadmap                                                     │
└─────────────────────────────────────────────────────────────┘
```

On mobile:

```text
Farm
 ↓
Production
 ↓
Roadmap
 ↓
Copilot
```

Use a bottom-sheet or full-screen copilot rather than permanently shrinking the farm view.

---

# 16. Copilot Message Components

Do not render every response as plain text.

Support structured cards.

### Recommendation card

```text
┌─────────────────────────────────┐
│ 🌾 Recommended                  │
│                                 │
│ Harvest Wheat                   │
│                                 │
│ +120 XP                         │
│ Ready now                       │
│                                 │
│ [Why?]       [Check]            │
└─────────────────────────────────┘
```

### Production card

```text
┌─────────────────────────────────┐
│ 🍳 Pancakes                     │
│                                 │
│ Base time       20 min          │
│ Active effects  -10%            │
│ Expected time   18 min          │
│ XP              4,400           │
│                                 │
│ [View calculation]              │
└─────────────────────────────────┘
```

### Warning card

```text
⚠️ Chicken health check

3 animals require attention.

[View Animals]
```

### Roadmap card

```text
TODAY

1. Collect ready production
2. Feed animals
3. Cook Pancakes
4. Prepare ingredients for tomorrow

██████████░░ 72%
```

---

# 17. Provenance UI

Every important calculated number should be inspectable.

Use a small:

```text
ⓘ Calculation
```

drawer.

Example:

```text
Pancakes XP: 4,400

Base XP:             4,000
Blossombeard:        +10%
Result:              4,400

Source:
  Game rules: v0.9.8
  Farm snapshot: #18427
  Effect context: #18427
  Engine: foodXp@1.0.0
```

This is especially important because the product makes strategic recommendations.

---

# 18. Farm Dashboard

The first screen should answer:

```text
What is happening?
What needs attention?
What should I do next?
```

Recommended cards:

```text
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 🌾 Production│ │ 🐄 Animals   │ │ ⚡ Effects   │
│ 12 active    │ │ 18 animals   │ │ 5 active     │
└──────────────┘ └──────────────┘ └──────────────┘

┌───────────────────────────────────────────────────┐
│ 🎯 Today's Strategy                               │
│                                                   │
│ 1. Harvest ready crops                            │
│ 2. Collect animal resources                       │
│ 3. Start Pancakes                                 │
│ 4. Refill Aging Shed                              │
└───────────────────────────────────────────────────┘
```

Avoid showing 50 statistics on the home page.

---

# 19. Production Screen

Group production by semantic operation:

```text
All
Cooking
Crafting
Processing
Growing
Animals
Resources
```

Each card:

```text
Building
Status
Current item
Started
Ready
Remaining
Effect modifiers
```

Example:

```text
AGING SHED
Level 6

AGING
6 / 6 active

Napoleanfish
████████░░
Ready in 12m

FERMENTATION
6 / 6 active

Pickled Zucchini
██████░░░░
Ready in 31m

SPICE
6 / 6 active
```

This maps directly to the normalized production model.

---

# 20. Animals Screen

Use:

```text
Hen House
Barn
```

Animal cards:

```text
Chicken #1
Level 8
XP 840
Status: Awake
Love: Music Box
Feed: Salt Lick ×3
Health: Checked
```

Summary:

```text
Capacity
18 / 20

Ready output
Egg ×12
Feather ×7
```

Do not display calculated output as authoritative farm state.

Label it:

```text
Expected production
```

with a calculation/provenance indicator.

---

# 21. Effects Screen

This screen is extremely valuable.

Separate:

```text
ACTIVE
INACTIVE
```

Example:

```text
ACTIVE EFFECTS

🌸 Blossombeard
XP +10%
Source: Equipped

🏜 Desert Gnome
Cooking time -10%
Source: Placed

🐢 Tortoise Shrine
Greenhouse growth -33%
Source: Active shrine
```

Then:

```text
INVENTORY ONLY

Goblin Crown
Not equipped

Some Collectible
Not placed
```

This makes the activation model visible and prevents user confusion.

---

# 22. Planner Screen

Use a roadmap rather than a giant task list.

```text
Goal:
Reach Level 30

PHASE 1
Prepare resources
████████████ 100%

PHASE 2
Upgrade Barn
████████░░░░ 67%

PHASE 3
Unlock next progression
███░░░░░░░░░ 25%
```

Each objective:

```text
┌──────────────────────────────────┐
│ Collect Milk                     │
│                                  │
│ Needed for: Barn upgrade         │
│ Available: 18                    │
│ Required: 25                     │
│                                  │
│ ETA: 4h 20m                      │
│                                  │
│ [Why this?]                      │
└──────────────────────────────────┘
```

---

# 23. Copilot Suggested Prompts

Show context-aware prompts:

```text
"What should I do next?"
"Why is my XP lower than expected?"
"Which production should I start?"
"How can I reach my goal faster?"
"What is blocking my roadmap?"
"What effects are active?"
"What should I collect now?"
"Compare today's plan with yesterday."
```

Do not generate suggestions unrelated to current farm state.

---

# 24. AI Context Envelope

Do not send the entire raw farm snapshot to the LLM.

Build:

```ts
interface AIContext {
  farm: FarmSummary;
  temporal: TemporalContext;
  production: ProductionSummary;
  effects: EffectSummary;
  goals: GoalSummary[];
  roadmap?: Roadmap;
  warnings: Warning[];
  opportunities: Opportunity[];
  provenance: ProvenanceSummary;
}
```

The LLM receives only what it needs.

Example:

```json
{
  "farm": {
    "farmId": "farm_123",
    "level": 29,
    "coins": 1200
  },
  "production": {
    "readyCount": 4,
    "activeCount": 12
  },
  "effects": {
    "foodXpMultiplier": 1.1
  },
  "goal": {
    "type": "REACH_LEVEL",
    "target": 30
  }
}
```

This dramatically reduces hallucination opportunities.

---

# 25. Copilot Conversation Flow

Example:

```text
USER
"What should I do now?"

        ↓

ORCHESTRATOR

        ↓

get_farm_state()
        ↓

get_temporal_context()
        ↓

get_roadmap()
        ↓

check_action_permission()
        ↓

LLM explanation

        ↓

COPILOT
```

Response:

> You have four production items ready. I would collect the animal resources first because they are blocking your current Barn-upgrade goal. After that, start Pancakes while your Blossombeard XP bonus is active.

The recommendation must be backed by planner/tool results.

---

# 26. Action Confirmation

The AI should initially be **advisory**, not autonomous.

For actions that could eventually mutate the game:

```text
AI recommendation
       ↓
Explain
       ↓
User confirms
       ↓
Authorized action endpoint
```

Do not allow:

```text
LLM → game API
```

directly.

Future action architecture:

```text
AI
 ↓
Action Proposal
 ↓
Permission Engine
 ↓
User Confirmation
 ↓
Authorized Adapter
```

This also makes auditing much easier.

---

# 27. State Freshness

Expose synchronization status in the UI.

```text
● Live
```

means:

```text
FRESH
```

Other states:

```text
◐ Updating
STALE

⚠ Sync delayed
VERY_STALE

? No current snapshot
UNKNOWN
```

Suggested UI:

```text
Farm data updated 4s ago
```

Never silently present stale farm data as live.

---

# 28. Multi-Farm UI

Farm selector:

```text
🌻 Farm A        ▼
```

Dropdown:

```text
Farm A
Level 29
● Live

Farm B
Level 18
● Live

Farm C
Level 7
◐ Updating
```

Every request must carry `farmId`.

Never keep farm state in one global singleton.

---

# 29. Frontend State

Recommended stores:

```text
farmStore
productionStore
plannerStore
copilotStore
uiStore
```

Copilot state:

```ts
interface CopilotState {
  conversationId: string;
  messages: CopilotMessage[];
  streaming: boolean;
  activeTool?: string;
  error?: string;
}
```

Use server data as the source of truth.

Do not make frontend calculations authoritative.

---

# 30. UI Component Tree

Recommended:

```text
<App>
 ├── AppShell
 │    ├── Sidebar
 │    ├── TopBar
 │    │    ├── FarmSelector
 │    │    └── SyncStatus
 │    │
 │    └── Main
 │         ├── DashboardPage
 │         ├── ProductionPage
 │         ├── AnimalsPage
 │         ├── EffectsPage
 │         ├── PlannerPage
 │         └── HistoryPage
 │
 └── Copilot
      ├── CopilotButton
      ├── CopilotPanel
      │    ├── Conversation
      │    ├── ToolActivity
      │    ├── RecommendationCard
      │    ├── CalculationCard
      │    └── MessageComposer
      └── CopilotMobileSheet
```

---

# 31. Visual Design Direction

Keep the interface:

```text
modern
minimal
clean
data-dense
soft fantasy
```

Avoid:

```text
overly game-like dashboards
neon gradients everywhere
huge decorative panels
too many borders
too many colors
```

Use the Sunflower Land visual identity as an accent, while keeping the application closer to a modern productivity/strategy dashboard.

Recommended hierarchy:

```text
Background
  ↓
Cards
  ↓
Primary information
  ↓
Secondary metadata
  ↓
Provenance / technical detail
```

Use color primarily for semantic status:

```text
success
warning
critical
inactive
```

not decoration.

---

# 32. Implementation Order

Do this in this exact order.

## Step 1 — Data foundation

```text
GameDataService
MetadataService
BuildingService
AnimalRulesService
EffectRegistry
```

Tests first.

---

## Step 2 — Building normalization

Update `FarmNormalizer` to create:

```text
buildings
production
animals
pets
placedCollectibles
timedBuffs
```

Do not throw away unknown raw fields.

---

## Step 3 — Effect Engine

Implement:

```text
resolveEffectContext()
```

Then test:

```text
inventory only → inactive
placed → active
wardrobe only → inactive
equipped → active
expired buff → inactive
multi-farm → different contexts
```

---

## Step 4 — Production Engine

Implement adapters:

```text
Cooking
Crafting
Composting
Growing
Crop processing
Seasonal processing
Rack processing
Resource recovery
Animal production
```

Every adapter consumes `EffectContext`.

---

## Step 5 — Planner integration

Pipeline:

```text
Generate candidates
      ↓
Hard feasibility
      ↓
Resource permission
      ↓
Apply effects
      ↓
Score
      ↓
Rank
      ↓
Roadmap
      ↓
Daily objectives
```

---

## Step 6 — REST API

Expose farm data and planner results.

---

## Step 7 — Dashboard UI

Build:

```text
Dashboard
Production
Animals
Effects
Planner
```

before the copilot.

This gives the AI somewhere meaningful to send users.

---

## Step 8 — Copilot

Implement:

```text
POST /api/ai/chat
POST /api/ai/chat/stream
```

Connect:

```text
Copilot UI
 → Orchestrator
 → Tools
 → Deterministic Core
 → AI Provider
```

---

## Step 9 — Provenance UI

Add:

```text
Why?
Calculation
Source
Updated
```

to important results.

---

## Step 10 — Regression

Run:

```bash
npm run typecheck
npm run build
npx tsx --test server/tests/*.test.ts
```

Target:

```text
0 failures
0 type errors
0 build errors
```

---

# 33. Testing Matrix

### Game data

```text
metadata loads
counts valid
collision index valid
manifest hash valid
```

### Buildings

```text
22 building types recognized
unknown building preserved
production model resolved
```

### Animals

```text
Chicken 0→1
Chicken 14→15
Cow 0→1
Cow 14→15
Sheep 0→1
Sheep 14→15
capacity
health
love tools
```

### Effects

```text
equipped
placed
unlocked
timed
expired
multi-farm divergence
```

### AI

```text
tool schema
tool permission
tool deduplication
max 10 calls
stale data
provider failure
malformed model output
```

### UI

```text
farm switching
stale state
stream interruption
tool activity
recommendation rendering
provenance drawer
mobile copilot
```

---

# 34. Error Handling

AI errors should be understandable.

Instead of:

```text
INTERNAL_ERROR
```

show:

```text
I couldn't get a fresh farm snapshot right now.
Your last synchronized state is 48 seconds old.
```

Tool failures remain structured:

```ts
{
  ok: false,
  error: {
    code: "STALE_DATA",
    message: "...",
    retryable: true
  }
}
```

The LLM may explain the error but cannot override it.

---

# 35. Security Boundaries

Never expose:

```text
Community API key
AI provider key
database credentials
Redis credentials
```

to React.

Architecture:

```text
Browser
   ↓
Your API
   ↓
Services
   ↓
External APIs / AI Provider
```

Also validate:

```text
user owns farmId
conversation belongs to user
tool arguments match schema
action is permitted
```

---

# 36. What NOT to Build Yet

Do not add:

```text
microservices
Kubernetes
autonomous gameplay
automatic trading
LLM-generated game rules
LLM numerical calculations
WebSocket infrastructure unless needed
vector database for farm state
queue for every chat message
```

Keep the existing architecture simple.

BullMQ remains for:

```text
sync
history
weekly plans
reports
market refresh
expensive simulations
```

Interactive chat stays synchronous/streaming.

---

# 37. Final Runtime Architecture

```text
                       ┌──────────────────────┐
                       │   Sunflower Land     │
                       │   Community API      │
                       └──────────┬───────────┘
                                  ↓
                         ┌─────────────────┐
                         │   Farm Sync     │
                         └────────┬────────┘
                                  ↓
                    ┌───────────────────────────┐
                    │ PostgreSQL + Redis        │
                    │ Snapshot / Hot State      │
                    └────────────┬──────────────┘
                                 ↓
                       ┌──────────────────┐
                       │ Farm Normalizer  │
                       └────────┬─────────┘
                                ↓
                 ┌──────────────────────────────┐
                 │ Effect Context Resolver      │
                 └──────────────┬───────────────┘
                                ↓
              ┌────────────────────────────────────┐
              │       Deterministic Core            │
              │ XP | Production | Animals | Pets   │
              │ Cooking | Economy | Temporal       │
              └────────────────┬───────────────────┘
                               ↓
                       ┌─────────────────┐
                       │     Planner     │
                       └────────┬────────┘
                                ↓
                       ┌─────────────────┐
                       │ AI Orchestrator │
                       └────────┬────────┘
                                ↓
                    ┌──────────────────────┐
                    │    AI Provider      │
                    │ Groq / OpenAI / ... │
                    └──────────┬───────────┘
                               ↓
                  ┌─────────────────────────┐
                  │      AI Copilot UI      │
                  │                         │
                  │ Chat + Recommendations  │
                  │ Roadmap + Calculations  │
                  │ Warnings + Provenance   │
                  └─────────────────────────┘
```

---

# 38. Definition of Done

The implementation is ready for the next product stage when:

- [ ] Game dataset loads through one `GameDataService`
- [ ] Metadata is authoritative and versioned
- [ ] 22 building types normalize correctly
- [ ] Cooking remains a separate rule dataset
- [ ] Animal production is deterministic
- [ ] Aging Shed uses rack/slot processing
- [ ] Greenhouse uses plot state
- [ ] Pet House is modeled as utility/pet management
- [ ] EffectContext is resolved per farm
- [ ] Effects are never inferred from inventory ownership
- [ ] Every calculation receives EffectContext explicitly
- [ ] Planner consumes deterministic results
- [ ] AI receives structured context
- [ ] AI cannot invent game rules or numbers
- [ ] Copilot streams through SSE
- [ ] Farm switching works
- [ ] Sync freshness is visible
- [ ] Provenance is inspectable
- [ ] User confirmation exists before future game-mutating actions
- [ ] Full regression suite passes

---

# 39. The Key Product Principle

The final system should make this distinction obvious:

```text
                    AI COPILOT
                        │
             "What should I do?"
                        │
                        ▼
                    PLANNER
                        │
             "These are the best
              available actions."
                        │
                        ▼
              DETERMINISTIC CORE
                        │
          "These are the actual numbers."
                        │
                        ▼
                 GAME DATA
                        │
          "These are the actual rules."
                        │
                        ▼
                  FARM STATE
                        │
          "This is what the farm
              currently has."
```

That is the architecture that keeps the strategist trustworthy while still making the AI feel intelligent.
