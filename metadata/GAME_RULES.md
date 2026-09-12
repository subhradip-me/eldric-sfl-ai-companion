# Sunflower Land — Game Rules Dataset v1.0.0

**Generated:** 2026-09-12  
**Source policy:** This package contains only information supplied by the user in this project/conversation. No external game facts were added.

## Epistemic hierarchy

1. **AUTHORITATIVE** — supplied game metadata/mechanics reference.
2. **OBSERVED** — actual farm/API snapshot state.
3. **DERIVED** — deterministic calculations from rules + state.
4. **INFERRED** — hypotheses/candidate history; never silently authoritative.

## 1. Static game metadata

The supplied generated metadata artifact is preserved as `game_metadata.json` and retains its original `_meta` manifest. It is generated from `metadata.ts` and marked as generated/do-not-edit.

## 2. Building taxonomy

| Building | Category | Production model |
|---|---|---|
| Workbench | CRAFTING | CRAFTING |
| Market | TRADING | TRADING |
| Fire Pit | COOKING | COOKING |
| Mansion | UTILITY | NONE |
| Water Well | RESOURCE_GENERATION | RESOURCE_RECOVERY |
| Kitchen | COOKING | COOKING |
| Toolshed | STORAGE | STORAGE |
| Bakery | COOKING | COOKING |
| Smoothie Shack | COOKING | COOKING |
| Barn | ANIMAL_PRODUCTION | ANIMAL_DRIVEN |
| Crafting Box | CRAFTING | CRAFTING |
| Deli | COOKING | COOKING |
| Hen House | ANIMAL_PRODUCTION | ANIMAL_DRIVEN |
| Premium Composter | PROCESSING | COMPOSTING |
| Greenhouse | GROWING | CROP_PLOT |
| Crop Machine | PROCESSING | CROP_PROCESSING |
| Warehouse | STORAGE | STORAGE |
| Compost Bin | PROCESSING | COMPOSTING |
| Turbo Composter | PROCESSING | COMPOSTING |
| Fish Market | PROCESSING | SEASONAL_RECIPE |
| Pet House | ANIMAL_UTILITY | PET_MANAGEMENT |
| Aging Shed | PROCESSING | RACK_PROCESSING |

**Important:** categories such as `CRAFTING`, `PROCESSING`, `UTILITY`, etc. are the project's normalization taxonomy, not claims that every hidden mechanic has been fully documented.

### Confirmed special building mechanics from supplied material
- **Toolshed:** tool storage; screenshot shows **+50% workbench tool stock**.
- **Warehouse:** seed storage; screenshot shows **+20% market seed stock**.
- **Pet House:** 3×3; base capacity 3 Common Pets + 1 NFT pet; upgradeable; no bonus/boost merely from being inside; only pets can be stored; cannot remove while occupied; disabled by Tornado/Tsunami.
- **Aging Shed:** three processing racks — Aging, Fermentation, Spice — with slot-based processing. The supplied farm snapshot showed six entries in each rack at level 6.
- **Greenhouse:** supplied source indicates 4 plots/slots.
- **Cooking:** recipe data is kept separately in `cooking_rules_v0.9.8.json`.

## 3. Animal rules

### Buildings
- Hen House unlock: level **6**.
- Barn unlock: level **30**.
- Capacity per building level: **10 / 15 / 20** at levels 1 / 2 / 3.
- Chicken Coop NFT: **+5 animals for each building level**.

### Animal purchase requirements
- Chicken: **50 Coins**, required level **6**.
- Cow: **100 Coins**, required level **14**.
- Sheep: **120 Coins**, required level **18**.

### Production
`animal_rules.json` contains every supplied level transition from 0→1 through 14→15, including outputs and XP for Chicken, Cow and Sheep.

### Health
- Health check once every **24 hours**.
- Sick animal resource output: **50%**.
- Sick animal exchange sale value: **75%**.
- Spread chance increases with the number of sick animals.

### Love tools
- Petting Hand: **+25 XP**
- Brush: **+40 XP**
- Music Box: **+50 XP**

The exact per-level love-request probabilities from the supplied animal page are stored in `animal_rules.json`.

## 4. Pet rules

- 20 Common Pet types across 7 categories.
- Common pets are not tradeable.
- One pet per type; maximum 7 NFT pets.
- Acorn is available to every pet.
- Categories: Guardian → Chewed Bone; Hunter → Ribbon; Voyager → Ruffroot; Beast → Wild Grass; Moonkin → Heart Leaf; Snowkin → Frost Pebble; Forager → Dewberry.
- Fetch energy is stored and does not expire; fetching has no timer/cooldown.
- Standard fetch costs shown: 100 / 200 / 300 Energy depending on resource tier.
- Fossil Shell is a whole-number reward.
- Pet requests use 3 ordered slots: Easy, Medium, Hard; generated at daily reset.
- One food fulfills a normal request.
- Requests can be reset for Gems; reset cost increases with use.
- Failing to feed for 3 consecutive days causes a one-time **500 XP loss**.
- Pets do not request fish products or mushroom ingredients and only request foods that can be made from Marketplace-bought resources.
- Nap mode grants **+10 XP every 2 hours**.
- Social petting grants **+1 to +5 XP**, capped at **50 XP per pet per day**.

Pet progression and NFT-specific rules are fully structured in `pet_rules.json`.

## 5. Pet House

`Pet House` is **ANIMAL_UTILITY**, not an animal production building. It manages/stores pets and supplies no production boost by itself.

## 6. Pet Shrines

The supplied screenshots document 16 shrine rules. They are preserved verbatim in structured form in `effect_rules.json`, including:

- Boar: -20% Cooking Time
- Hound: +100 Pet XP per food request
- Sparrow: -25% Crop Growth Time
- Fox: -25% Crafting Box Time; 10% instant-craft chance
- Toucan: -25% Fruit Growth Time
- Collie: -25% Cow Sleep Time; -25% Sheep Sleep Time; -5% feed to animals
- Moth: -25% Flower Growth Time; +20% chance for +1 Flower
- Badger: -25% Tree Recovery Time; -25% Stone Recovery Time
- Mole: -25% Iron / Gold / Crimstone Recovery Time
- Tortoise: -33% Greenhouse Growth Time; -10% Crop Machine Growth Time
- Stag: -25% Oil Recovery Time; +15 Oil every 3rd drill
- Bear: +0.5 Honey Production Speed; +20% bee-swarm chance
- Bantam: -25% Chicken Sleep Time; -5% feed to feed chickens
- Legendary: +1 Crop Yield; +1 Fruit Patch Yield; +1 Wood; +1 Stone; +1 Flower; -50% Cooking Time
- Trading: -2.5% resource tax
- Obsidian: bulk harvest ready crops and plant seeds

## 7. Known item effects

- **Blossombeard:** +10% XP.
- **Desert Gnome:** -10% cooking time.

Activation must come from authoritative farm state (equipped/placed/unlocked/timed), not merely inventory ownership.

The architecture proposed a canonical addition/multiplier order, but that order was explicitly marked for verification before freezing as game math. Therefore this package does **not** pretend that unverified stacking/rounding rules are final.

## 8. Market / Stock

- Market Restock: **15 Gems**; replenishes crop, fruit, flower and greenhouse-good stock.
- Workbench Restock: **10 Gems**; replenishes tools.
- Digging Restock: **5 Gems**; gives **50 Sand Shovels + 10 Sand Drills**.
- Full Restock: **20 Gems**; restocks seeds, workbench and digging categories.
- Seed inventory limit: **2.5× stock amount**.
- Tool inventory limits vary by tool.

## 9. Cooking

Cooking rules are kept separate from the broader building taxonomy. `cooking_rules_v0.9.8.json` is the supplied dataset from `sfl.world/info/cooking`, game version **Sunflower Land World v0.9.8**, containing base XP, base cook minutes, instant-gem costs and ingredients.

Dynamic market cost, XP-per-SFL and XP-per-day are intentionally not stored as static rules.

## 10. Observed farm reference

`observed_farm_reference.json` summarizes the latest supplied farm snapshot. It is **not** game-rule data. It is useful for validating normalization and activation logic against real farm state.

## 11. Known gaps / do not invent

- Exact Water Well recovery formula.
- Complete upgrade costs/levels for every building.
- Complete Fish Market recipe catalog.
- Complete Greenhouse upgrade/effect catalog.
- Complete non-cooking recipes for every processing/crafting building.
- Canonical global effect stacking/rounding order.
- Full pet-request food catalog from the UI page.

These are intentionally left as gaps rather than filled from generic knowledge.
