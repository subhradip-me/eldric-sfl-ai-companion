/**
 * client/src/selectors/dashboardSelectors.js
 * Boring deterministic selectors consuming the backend-owned DashboardViewModel.
 * Includes authoritative zero-guessing fallbacks to farm.buildings / farm.normalized.
 */

const COOKING_SET = new Set(['Fire Pit', 'Kitchen', 'Bakery', 'Smoothie Shack', 'Deli']);

export const BUILDING_CATEGORIES = {
  COOKING: {
    id: 'Cooking',
    name: 'Cooking',
    icon: '🍳',
    productionModel: 'Fixed recipes',
    buildings: ['Fire Pit', 'Kitchen', 'Deli', 'Smoothie Shack', 'Bakery'],
    description: 'Fixed-recipe culinary facilities with oil boost acceleration and active meal queues.',
  },
  PROCESSING: {
    id: 'Processing',
    name: 'Processing',
    icon: '🪱',
    productionModel: 'Dynamic input, rack-based recipes & seasonal recipes',
    buildings: ['Compost Bin', 'Turbo Composter', 'Premium Composter', 'Aging Shed', 'Fish Market'],
    description: 'Decomposition, fermentation, rack aging, and seasonal catch transformation.',
  },
  CROP_PRODUCTION: {
    id: 'CropProduction',
    name: 'Crop Production',
    icon: '🌱',
    productionModel: 'Crop/plot state & queue/batch production',
    buildings: ['Greenhouse', 'Crop Machine'],
    description: 'Advanced indoor climate pots and batch seed automation modules.',
  },
  ANIMAL_PRODUCTION: {
    id: 'AnimalProduction',
    name: 'Animal Production',
    icon: '🐄',
    productionModel: 'Animal-driven',
    buildings: ['Hen House', 'Barn'],
    description: 'Coop and barn livestock management for egg, milk, wool, and feather yields.',
  },
  CRAFTING: {
    id: 'Crafting',
    name: 'Crafting',
    icon: '🔨',
    productionModel: 'Crafting recipes',
    buildings: ['Workbench', 'Crafting Box'],
    description: 'Tool forging, equipment fabrication, and specialized item assembly.',
  },
  RESOURCE_GENERATION: {
    id: 'ResourceGen',
    name: 'Resource Generation',
    icon: '💧',
    productionModel: 'Resource state',
    buildings: ['Water Well'],
    description: 'Hydraulic ground water recovery providing irrigation support across farm plots.',
  },
  TRADING: {
    id: 'Trading',
    name: 'Trading',
    icon: '🏪',
    productionModel: 'Market state',
    buildings: ['Market'],
    description: 'Town square commerce, crop liquidations, and trade order fulfillment.',
  },
  STORAGE: {
    id: 'Storage',
    name: 'Storage',
    icon: '📦',
    productionModel: 'Capacity/storage',
    buildings: ['Warehouse', 'Toolshed'],
    description: 'Supply chain storage vaults and equipment lockers expanding capacity.',
  },
  ANIMAL_UTILITY: {
    id: 'AnimalUtility',
    name: 'Animal Utility',
    icon: '🐶',
    productionModel: 'Pet state',
    buildings: ['Pet House'],
    description: 'Animal companion sanctuary, energy recharge, and loyalty trait management.',
  },
  UTILITY: {
    id: 'Utility',
    name: 'Utility',
    icon: '🏛️',
    productionModel: 'Utility/state',
    buildings: ['Mansion', 'Manor'],
    description: 'Island manor estate headquarters driving expansion and territory prestige.',
  },
};

const TAXONOMY = {
  'Fire Pit': { category: 'Cooking', icon: '🔥' },
  'Kitchen': { category: 'Cooking', icon: '🍳' },
  'Bakery': { category: 'Cooking', icon: '🎂' },
  'Smoothie Shack': { category: 'Cooking', icon: '🥤' },
  'Deli': { category: 'Cooking', icon: '🧀' },
  'Water Well': { category: 'Resource Generation', icon: '💧' },
  'Compost Bin': { category: 'Processing', icon: '🪱' },
  'Turbo Composter': { category: 'Processing', icon: '🪱' },
  'Premium Composter': { category: 'Processing', icon: '🪱' },
  'Greenhouse': { category: 'Crop Production', icon: '🏡' },
  'Crop Machine': { category: 'Crop Production', icon: '⚙️' },
  'Barn': { category: 'Animal Production', icon: '🐄' },
  'Hen House': { category: 'Animal Production', icon: '🐔' },
  'Workbench': { category: 'Crafting', icon: '🔨' },
  'Toolshed': { category: 'Storage', icon: '🛠️' },
  'Warehouse': { category: 'Storage', icon: '📦' },
  'Crafting Box': { category: 'Crafting', icon: '📦' },
  'Aging Shed': { category: 'Processing', icon: '🏚️' },
  'Fish Market': { category: 'Processing', icon: '🐟' },
  'Market': { category: 'Trading', icon: '🏪' },
  'Pet House': { category: 'Animal Utility', icon: '🐶' },
  'Manor': { category: 'Utility', icon: '🏛️' },
  'Mansion': { category: 'Utility', icon: '🏛️' },
};

function extractFallbackBuildings(farm) {
  const raw = farm?.normalized?.structures?.buildings ?? farm?.buildings ?? {};
  const list = [];
  const now = Date.now();
  for (const [name, val] of Object.entries(raw)) {
    if (!val) continue;
    const instances = Array.isArray(val) ? val : [val];
    for (const inst of instances) {
      const meta = TAXONOMY[name] || { category: 'Infrastructure', icon: '🏠' };
      const readyAt = inst?.readyAt ?? inst?.busyUntil ?? null;
      list.push({
        name,
        category: meta.category,
        icon: meta.icon,
        oil: Number(inst?.oil ?? 0),
        isBusy: Boolean(readyAt && readyAt > now),
        readyAt,
        coordinates: inst?.coordinates,
      });
    }
  }
  const catOrder = { Cooking: 1, Agriculture: 2, 'Soil Nutrition': 3, Livestock: 4, Crafting: 5, Processing: 6, Storage: 7, Commerce: 8, Estate: 9 };
  list.sort((a, b) => (catOrder[a.category] || 99) - (catOrder[b.category] || 99) || a.name.localeCompare(b.name));
  return list;
}

function extractFallbackCookingBuildings(farm) {
  const raw = farm?.normalized?.structures?.buildings ?? farm?.buildings ?? {};
  const list = [];
  const now = Date.now();
  for (const name of COOKING_SET) {
    const val = raw[name];
    if (!val) continue;
    const instances = Array.isArray(val) ? val : [val];
    for (const inst of instances) {
      const oil = Number(inst?.oil ?? 0);
      const readyAt = inst?.readyAt ?? inst?.busyUntil ?? null;
      list.push({
        name,
        oil,
        oilBoost: oil > 0 ? '+20% Speed' : 'Base Speed',
        isBusy: Boolean(readyAt && readyAt > now),
        readyAt,
        crafting: inst?.crafting ?? [],
      });
    }
  }
  return list;
}

export const EMPTY_OVERVIEW = {
  kpis: {
    level: 1,
    xp: 0,
    targetXp: 24_083_905,
    remainingXp: 24_083_905,
    pctComplete: 0,
    flowerApprox: 0,
    coins: 0,
  },
  health: {
    activeCookingCount: 0,
    activeCropsCount: 0,
    animalsCount: 0,
    placedCollectiblesCount: 0,
    resourcesCount: 0,
    totalBuildingsCount: 0,
  },
  buildings: [],
};

export const EMPTY_COOKING = {
  buildings: [],
  foodInventory: {},
  totalMealsInStock: 0,
};

export const EMPTY_CROPS = {
  activeCrops: [],
  greenhouse: { activeCount: 0, items: [] },
  seeds: {},
  produce: {},
  composters: [],
};

export const EMPTY_ANIMALS = {
  henHouse: {
    chickensCount: 0,
    eggsInStock: 0,
    eggStock: 0,
    specialChickens: {},
  },
  barn: {
    cowsCount: 0,
    sheepCount: 0,
    milkStock: 0,
    woolStock: 0,
    merinoWoolStock: 0,
    leatherStock: 0,
    featherStock: 0,
  },
  feedInventory: {},
  careEquipment: {},
};

export const EMPTY_RESOURCES = {
  primary: {
    wood: 0,
    stone: 0,
    iron: 0,
    gold: 0,
    crimstone: 0,
    sunstone: 0,
    obsidian: 0,
    oil: 0,
  },
  tools: {},
  nodes: {},
};

export const EMPTY_EFFECTS = {
  placedCollectiblesCount: 0,
  placedCollectibles: [],
  skills: [],
  wearables: {},
  vip: {
    active: false,
    boosts: [],
  },
  diagnostics: {
    rawHash: null,
    stale: false,
  },
};

export const selectOverviewData = (farm, plan) => {
  const dashOverview = farm?.dashboard?.overview ?? {};
  const dashBuildings = dashOverview.buildings;
  const buildings = (Array.isArray(dashBuildings) && dashBuildings.length > 0)
    ? dashBuildings
    : extractFallbackBuildings(farm);

  return {
    ...EMPTY_OVERVIEW,
    ...dashOverview,
    buildings,
    health: {
      ...EMPTY_OVERVIEW.health,
      ...(dashOverview.health ?? {}),
      totalBuildingsCount: dashOverview.health?.totalBuildingsCount ?? buildings.length,
    },
    plan: plan ?? null,
  };
};

export const selectCookingData = (farm, plan) => {
  const dashCooking = farm?.dashboard?.cooking ?? {};
  const dashBuildings = dashCooking.buildings;
  const buildings = (Array.isArray(dashBuildings) && dashBuildings.length > 0)
    ? dashBuildings
    : extractFallbackCookingBuildings(farm);

  return {
    ...EMPTY_COOKING,
    ...dashCooking,
    buildings,
    plan: plan ?? null,
  };
};

export const selectCropData = (farm) => ({
  ...EMPTY_CROPS,
  ...(farm?.dashboard?.crops ?? {}),
});

export const selectAnimalData = (farm) => ({
  ...EMPTY_ANIMALS,
  ...(farm?.dashboard?.animals ?? {}),
});

export const selectResourceData = (farm) => ({
  ...EMPTY_RESOURCES,
  ...(farm?.dashboard?.resources ?? {}),
});

export const selectEffectData = (farm) => ({
  ...EMPTY_EFFECTS,
  ...(farm?.dashboard?.effects ?? {}),
});

export const selectCategoryBuildings = (farm, categoryKey) => {
  const cat = BUILDING_CATEGORIES[categoryKey] ?? Object.values(BUILDING_CATEGORIES).find((c) => c.id.toLowerCase() === String(categoryKey).toLowerCase());
  if (!cat) return { category: null, buildings: [], builtCount: 0, totalCount: 0 };

  const raw = farm?.normalized?.structures?.buildings ?? farm?.buildings ?? {};
  const overviewBuildings = farm?.dashboard?.overview?.buildings ?? extractFallbackBuildings(farm);
  const now = Date.now();

  const buildings = cat.buildings.map((bName) => {
    const rawEntry = raw[bName];
    const isBuilt = Boolean(rawEntry && (Array.isArray(rawEntry) ? rawEntry.length > 0 : true));
    const inst = Array.isArray(rawEntry) ? rawEntry[0] : (rawEntry ?? {});
    const ov = overviewBuildings.find((b) => b.name === bName);

    const oil = Number(inst?.oil ?? ov?.oil ?? 0);
    const readyAt = inst?.readyAt ?? inst?.busyUntil ?? ov?.readyAt ?? null;
    const crafting = Array.isArray(inst?.crafting) ? inst.crafting : [];
    const isBusy = Boolean((readyAt && readyAt > now) || crafting.some((c) => (c?.readyAt ?? 0) > now));

    return {
      name: bName,
      icon: ov?.icon ?? TAXONOMY[bName]?.icon ?? '🏠',
      productionModel: cat.productionModel,
      isBuilt,
      oil,
      oilBoost: oil > 0 ? '+20% Speed' : 'Base Speed',
      isBusy,
      readyAt,
      crafting,
      coordinates: inst?.coordinates ?? ov?.coordinates,
    };
  });

  return {
    category: cat,
    buildings,
    builtCount: buildings.filter((b) => b.isBuilt).length,
    totalCount: buildings.length,
  };
};

/**
 * Authoritative Processing Definitions & Deterministic Selector
 */
const COMPOSTER_JOB_DEFS = [
  {
    id: 'compost_bin_sprout_mix',
    name: 'Sprout Mix & Earthworms',
    facility: 'COMPOST_BIN',
    building: 'Compost Bin',
    icon: '🪱',
    durationMinutes: 360,
    baseXp: 0,
    gemCost: 2,
    inputs: [
      { item: 'Sunflower', required: 5 },
      { item: 'Hay', required: 2, fallbackItem: 'Wheat' },
    ],
    outputs: [
      { item: 'Earthworm', amount: 10, type: 'Bait' },
      { item: 'Sprout Mix', amount: 10, type: 'Fertiliser', description: '+0.2 Plot Crop Yield' },
    ],
    applicableSkills: [
      { skill: 'Efficient Bin', effect: '+5 Sprout Mix Output' },
      { skill: 'Wormy Treat', effect: '+1 Worm Output' },
      { skill: 'Swift Decomposer', effect: '-10% Composting Time' },
      { skill: 'Feathery Business', effect: 'Feather Boost Enabled' },
    ],
  },
  {
    id: 'turbo_composter_fruitful_blend',
    name: 'Fruitful Blend & Grubs',
    facility: 'TURBO_COMPOSTER',
    building: 'Turbo Composter',
    icon: '🪱',
    durationMinutes: 480,
    baseXp: 0,
    gemCost: 3,
    inputs: [
      { item: 'Carrot', required: 10 },
      { item: 'Hay', required: 5, fallbackItem: 'Wheat' },
    ],
    outputs: [
      { item: 'Grub', amount: 20, type: 'Bait' },
      { item: 'Fruitful Blend', amount: 10, type: 'Fertiliser', description: '+0.1 Fruit Patch Yield' },
    ],
    applicableSkills: [
      { skill: 'Turbo Charged', effect: '+5 Fruitful Blend Output' },
      { skill: 'Fruitful Bounty', effect: '2× Fruitful Blend Boost' },
      { skill: 'Swift Decomposer', effect: '-10% Composting Time' },
    ],
  },
  {
    id: 'premium_composter_rapid_root',
    name: 'Rapid Root & Red Wigglers',
    facility: 'PREMIUM_COMPOSTER',
    building: 'Premium Composter',
    icon: '🪱',
    durationMinutes: 720,
    baseXp: 0,
    gemCost: 5,
    inputs: [
      { item: 'Radish', required: 20 },
      { item: 'Hay', required: 5, fallbackItem: 'Wheat' },
    ],
    outputs: [
      { item: 'Red Wiggler', amount: 20, type: 'Bait' },
      { item: 'Rapid Root', amount: 10, type: 'Fertiliser', description: '-50% Plot Crop Growth Time' },
    ],
    applicableSkills: [
      { skill: 'Premium Worms', effect: '+10 Rapid Root Output' },
      { skill: 'Swift Decomposer', effect: '-10% Composting Time' },
      { skill: 'Wormy Treat', effect: '+1 Worm Output' },
    ],
  },
];

const AGING_RACK_RAW_RECIPES = [
  { input: 'Anchovy', inputQuantity: 1, salt: 5, timeMinutes: 32, output: { aged: 'Aged Anchovy', prime: 'Prime Aged Anchovy' }, xp: { basic: 80, aged: 240, prime: 312 } },
  { input: 'Blowfish', inputQuantity: 1, salt: 10, timeMinutes: 68, output: { aged: 'Aged Blowfish', prime: 'Prime Aged Blowfish' }, xp: { basic: 170, aged: 510, prime: 663 } },
  { input: 'Butterflyfish', inputQuantity: 1, salt: 7, timeMinutes: 44, output: { aged: 'Aged Butterflyfish', prime: 'Prime Aged Butterflyfish' }, xp: { basic: 110, aged: 330, prime: 429 } },
  { input: 'Clownfish', inputQuantity: 1, salt: 17, timeMinutes: 75.6, output: { aged: 'Aged Clownfish', prime: 'Prime Aged Clownfish' }, xp: { basic: 210, aged: 840, prime: 1092 } },
  { input: 'Halibut', inputQuantity: 1, salt: 18, timeMinutes: 79.2, output: { aged: 'Aged Halibut', prime: 'Prime Aged Halibut' }, xp: { basic: 220, aged: 880, prime: 1144 } },
  { input: 'Horse Mackerel', inputQuantity: 1, salt: 20, timeMinutes: 90, output: { aged: 'Aged Horse Mackerel', prime: 'Prime Aged Horse Mackerel' }, xp: { basic: 250, aged: 1000, prime: 1300 } },
  { input: 'Muskellunge', inputQuantity: 1, salt: 20, timeMinutes: 90, output: { aged: 'Aged Muskellunge', prime: 'Prime Aged Muskellunge' }, xp: { basic: 250, aged: 1000, prime: 1300 } },
  { input: 'Porgy', inputQuantity: 1, salt: 20, timeMinutes: 90, output: { aged: 'Aged Porgy', prime: 'Prime Aged Porgy' }, xp: { basic: 250, aged: 1000, prime: 1300 } },
  { input: 'Sea Bass', inputQuantity: 1, salt: 8, timeMinutes: 56, output: { aged: 'Aged Sea Bass', prime: 'Prime Aged Sea Bass' }, xp: { basic: 140, aged: 420, prime: 546 } },
  { input: 'Sea Horse', inputQuantity: 1, salt: 19, timeMinutes: 86.4, output: { aged: 'Aged Sea Horse', prime: 'Prime Aged Sea Horse' }, xp: { basic: 240, aged: 960, prime: 1248 } },
  { input: 'Squid', inputQuantity: 1, salt: 20, timeMinutes: 90, output: { aged: 'Aged Squid', prime: 'Prime Aged Squid' }, xp: { basic: 250, aged: 1000, prime: 1300 } },
  { input: 'Angelfish', inputQuantity: 1, salt: 20, timeMinutes: 90, output: { aged: 'Aged Angelfish', prime: 'Prime Aged Angelfish' }, xp: { basic: 250, aged: 1000, prime: 1300 } },
  { input: 'Barred Knifejaw', inputQuantity: 1, salt: 58, timeMinutes: 139.2, output: { aged: 'Aged Barred Knifejaw', prime: 'Prime Aged Barred Knifejaw' }, xp: { basic: 580, aged: 2900, prime: 3770 } },
  { input: 'Hammerhead shark', inputQuantity: 1, salt: 75, timeMinutes: 180, output: { aged: 'Aged Hammerhead shark', prime: 'Prime Aged Hammerhead shark' }, xp: { basic: 750, aged: 3750, prime: 4875 } },
  { input: 'Moray Eel', inputQuantity: 1, salt: 18, timeMinutes: 79.2, output: { aged: 'Aged Moray Eel', prime: 'Prime Aged Moray Eel' }, xp: { basic: 220, aged: 880, prime: 1144 } },
  { input: 'Napoleanfish', inputQuantity: 1, salt: 11, timeMinutes: 72, output: { aged: 'Aged Napoleanfish', prime: 'Prime Aged Napoleanfish' }, xp: { basic: 180, aged: 540, prime: 702 } },
  { input: 'Olive Flounder', inputQuantity: 1, salt: 11, timeMinutes: 72, output: { aged: 'Aged Olive Flounder', prime: 'Prime Aged Olive Flounder' }, xp: { basic: 180, aged: 540, prime: 702 } },
  { input: 'Ray', inputQuantity: 1, salt: 43, timeMinutes: 103.2, output: { aged: 'Aged Ray', prime: 'Prime Aged Ray' }, xp: { basic: 430, aged: 2150, prime: 2795 } },
  { input: 'Red Snapper', inputQuantity: 1, salt: 6, timeMinutes: 40, output: { aged: 'Aged Red Snapper', prime: 'Prime Aged Red Snapper' }, xp: { basic: 100, aged: 300, prime: 390 } },
  { input: 'Rock Blackfish', inputQuantity: 1, salt: 26, timeMinutes: 115.2, output: { aged: 'Aged Rock Blackfish', prime: 'Prime Aged Rock Blackfish' }, xp: { basic: 320, aged: 1280, prime: 1664 } },
  { input: 'Surgeonfish', inputQuantity: 1, salt: 17, timeMinutes: 75.6, output: { aged: 'Aged Surgeonfish', prime: 'Prime Aged Surgeonfish' }, xp: { basic: 210, aged: 840, prime: 1092 } },
  { input: 'Tilapia', inputQuantity: 1, salt: 11, timeMinutes: 76, output: { aged: 'Aged Tilapia', prime: 'Prime Aged Tilapia' }, xp: { basic: 190, aged: 570, prime: 741 } },
  { input: 'Walleye', inputQuantity: 1, salt: 17, timeMinutes: 75.6, output: { aged: 'Aged Walleye', prime: 'Prime Aged Walleye' }, xp: { basic: 210, aged: 840, prime: 1092 } },
  { input: 'Zebra Turkeyfish', inputQuantity: 1, salt: 18, timeMinutes: 79.2, output: { aged: 'Aged Zebra Turkeyfish', prime: 'Prime Aged Zebra Turkeyfish' }, xp: { basic: 220, aged: 880, prime: 1144 } },
  { input: 'Blue Marlin', inputQuantity: 1, salt: 12, timeMinutes: 80, output: { aged: 'Aged Blue Marlin', prime: 'Prime Aged Blue Marlin' }, xp: { basic: 200, aged: 600, prime: 780 } },
  { input: 'Cobia', inputQuantity: 1, salt: 25, timeMinutes: 111.6, output: { aged: 'Aged Cobia', prime: 'Prime Aged Cobia' }, xp: { basic: 310, aged: 1240, prime: 1612 } },
  { input: 'Coelacanth', inputQuantity: 1, salt: 41, timeMinutes: 98.4, output: { aged: 'Aged Coelacanth', prime: 'Prime Aged Coelacanth' }, xp: { basic: 410, aged: 2050, prime: 2665 } },
  { input: 'Football fish', inputQuantity: 1, salt: 12, timeMinutes: 80, output: { aged: 'Aged Football fish', prime: 'Prime Aged Football fish' }, xp: { basic: 200, aged: 600, prime: 780 } },
  { input: 'Mahi Mahi', inputQuantity: 1, salt: 12, timeMinutes: 80, output: { aged: 'Aged Mahi Mahi', prime: 'Prime Aged Mahi Mahi' }, xp: { basic: 200, aged: 600, prime: 780 } },
  { input: 'Oarfish', inputQuantity: 1, salt: 18, timeMinutes: 79.2, output: { aged: 'Aged Oarfish', prime: 'Prime Aged Oarfish' }, xp: { basic: 220, aged: 880, prime: 1144 } },
  { input: 'Parrotfish', inputQuantity: 1, salt: 44, timeMinutes: 105.6, output: { aged: 'Aged Parrotfish', prime: 'Prime Aged Parrotfish' }, xp: { basic: 440, aged: 2200, prime: 2860 } },
  { input: 'Saw Shark', inputQuantity: 1, salt: 192, timeMinutes: 460.8, output: { aged: 'Aged Saw Shark', prime: 'Prime Aged Saw Shark' }, xp: { basic: 1920, aged: 9600, prime: 12480 } },
  { input: 'Sunfish', inputQuantity: 1, salt: 12, timeMinutes: 80, output: { aged: 'Aged Sunfish', prime: 'Prime Aged Sunfish' }, xp: { basic: 200, aged: 600, prime: 780 } },
  { input: 'Trout', inputQuantity: 1, salt: 26, timeMinutes: 118.8, output: { aged: 'Aged Trout', prime: 'Prime Aged Trout' }, xp: { basic: 330, aged: 1320, prime: 1716 } },
  { input: 'Tuna', inputQuantity: 1, salt: 12, timeMinutes: 80, output: { aged: 'Aged Tuna', prime: 'Prime Aged Tuna' }, xp: { basic: 200, aged: 600, prime: 780 } },
  { input: 'Weakfish', inputQuantity: 1, salt: 17, timeMinutes: 75.6, output: { aged: 'Aged Weakfish', prime: 'Prime Aged Weakfish' }, xp: { basic: 210, aged: 840, prime: 1092 } },
  { input: 'Whale Shark', inputQuantity: 1, salt: 137, timeMinutes: 328.8, output: { aged: 'Aged Whale Shark', prime: 'Prime Aged Whale Shark' }, xp: { basic: 1370, aged: 6850, prime: 8905 } },
  { input: 'White Shark', inputQuantity: 1, salt: 200, timeMinutes: 480, output: { aged: 'Aged White Shark', prime: 'Prime Aged White Shark' }, xp: { basic: 2000, aged: 10000, prime: 13000 } },
];

const AGING_RACK_JOBS = AGING_RACK_RAW_RECIPES.map((r) => ({
  id: `aging_${r.input.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
  name: `Aged ${r.input}`,
  facility: 'AGING_SHED',
  building: 'Aging Shed',
  rack: 'AGING',
  icon: '🐟',
  durationMinutes: r.timeMinutes,
  baseXp: r.xp.aged,
  primeXp: r.xp.prime,
  basicXp: r.xp.basic,
  gemCost: Math.max(1, Math.round(r.timeMinutes / 30)),
  inputs: [
    { item: r.input, required: r.inputQuantity },
    { item: 'Salt', required: r.salt },
  ],
  outputs: [
    { item: r.output.aged, amount: 1, type: 'Aged Fish', primeItem: r.output.prime },
  ],
  xpDetails: r.xp,
  applicableSkills: [
    { skill: 'Speedy Aging', effect: '-10% Aging Time' },
    { skill: 'Fish Smoking', effect: '2× Prime Aged Chance' },
    { skill: 'Ager', effect: '2× Fish Aging Output' },
  ],
}));

const FERMENTATION_RACK_JOBS = [
  {
    id: 'fermentation_pickled_radish',
    name: 'Pickled Radish',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🥬',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    inputs: [{ item: 'Radish', required: 10 }, { item: 'Salt', required: 5 }],
    outputs: [{ item: 'Pickled Radish', amount: 1, type: 'Fermented Crop' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_pickled_zucchini',
    name: 'Pickled Zucchini',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🥒',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    inputs: [{ item: 'Zucchini', required: 75 }, { item: 'Salt', required: 5 }],
    outputs: [{ item: 'Pickled Zucchini', amount: 1, type: 'Fermented Crop' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_pickled_tomato',
    name: 'Pickled Tomato',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🍅',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    inputs: [{ item: 'Tomato', required: 15 }, { item: 'Salt', required: 5 }],
    outputs: [{ item: 'Pickled Tomato', amount: 1, type: 'Fermented Crop' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_pickled_broccoli',
    name: 'Pickled Broccoli',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🥦',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    inputs: [{ item: 'Broccoli', required: 20 }, { item: 'Salt', required: 5 }],
    outputs: [{ item: 'Pickled Broccoli', amount: 1, type: 'Fermented Crop' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_pickled_onion',
    name: 'Pickled Onion',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🧅',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    inputs: [{ item: 'Onion', required: 10 }, { item: 'Salt', required: 5 }],
    outputs: [{ item: 'Pickled Onion', amount: 1, type: 'Fermented Crop' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_pickled_pepper',
    name: 'Pickled Pepper',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🌶️',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    inputs: [{ item: 'Pepper', required: 30 }, { item: 'Salt', required: 5 }],
    outputs: [{ item: 'Pickled Pepper', amount: 1, type: 'Fermented Crop' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_greenhouse_glow',
    name: 'Greenhouse Glow',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '✨',
    durationMinutes: 120,
    baseXp: 0,
    gemCost: 4,
    effectBadge: '-20% Greenhouse Crop Growth Time',
    variants: [
      { ingredients: [{ item: 'Pickled Tomato', quantity: 1 }, { item: 'Refined Salt', quantity: 1 }] },
      { ingredients: [{ item: 'Pickled Zucchini', quantity: 1 }, { item: 'Refined Salt', quantity: 1 }] },
      { ingredients: [{ item: 'Pickled Broccoli', quantity: 1 }, { item: 'Refined Salt', quantity: 1 }] },
    ],
    outputs: [{ item: 'Greenhouse Glow', amount: 1, type: 'Greenhouse Booster', description: '-20% Greenhouse Growth Time' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_greenhouse_goodie',
    name: 'Greenhouse Goodie',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '✨',
    durationMinutes: 120,
    baseXp: 0,
    gemCost: 4,
    effectBadge: '+0.2 Greenhouse Crop Yield',
    variants: [
      { ingredients: [{ item: 'Pickled Radish', quantity: 1 }, { item: 'Refined Salt', quantity: 1 }] },
      { ingredients: [{ item: 'Pickled Pepper', quantity: 1 }, { item: 'Refined Salt', quantity: 1 }] },
      { ingredients: [{ item: 'Pickled Onion', quantity: 1 }, { item: 'Refined Salt', quantity: 1 }] },
    ],
    outputs: [{ item: 'Greenhouse Goodie', amount: 1, type: 'Greenhouse Booster', description: '+0.2 Greenhouse Crop Yield' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_sproutroot_surprise',
    name: 'Sproutroot Surprise',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🌱',
    durationMinutes: 2,
    baseXp: 0,
    gemCost: 1,
    effectBadge: '+0.2 Plot Yield · -50% Growth Time',
    inputs: [
      { item: 'Sprout Mix', required: 5 },
      { item: 'Rapid Root', required: 5 },
      { item: 'Refined Salt', required: 2 },
    ],
    outputs: [{ item: 'Sproutroot Surprise', amount: 1, type: 'Plot Blend', description: '+0.2 Plot Crop Yield, -50% Growth Time' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
  {
    id: 'fermentation_turbofruit_mix',
    name: 'Turbofruit Mix',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'FERMENTATION',
    icon: '🍹',
    durationMinutes: 2,
    baseXp: 0,
    gemCost: 1,
    effectBadge: '+0.1 Fruit Patch Yield · -20% Growth Time',
    inputs: [
      { item: 'Rapid Root', required: 5 },
      { item: 'Fruitful Blend', required: 5 },
      { item: 'Refined Salt', required: 2 },
    ],
    outputs: [{ item: 'Turbofruit Mix', amount: 1, type: 'Fruit Patch Blend', description: '+0.1 Fruit Patch Yield, -20% Growth Time' }],
    applicableSkills: [{ skill: 'Bacalhau', effect: '+1 Yield from Fermentation Rack' }],
  },
];

const SPICE_RACK_JOBS = [
  {
    id: 'spice_refined_salt',
    name: 'Refined Salt',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'SPICE',
    icon: '🧂',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    inputs: [{ item: 'Salt', required: 10 }],
    outputs: [{ item: 'Refined Salt', amount: 1, type: 'Artisan Seasoning' }],
    applicableSkills: [{ skill: 'Refiner', effect: '15% Chance +1 Refined Salt Output' }],
  },
  {
    id: 'spice_salt_lick',
    name: 'Salt Lick',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'SPICE',
    icon: '🧱',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    effectBadge: '+5% Animal Yield (3 harvests)',
    inputs: [{ item: 'Refined Salt', required: 5 }],
    outputs: [{ item: 'Salt Lick', amount: 5, type: 'Barn Mineral Block', description: '+5% Animal Yield (3 harvests)' }],
    applicableSkills: [],
  },
  {
    id: 'spice_honey_treat',
    name: 'Honey Treat',
    facility: 'AGING_SHED',
    building: 'Aging Shed',
    rack: 'SPICE',
    icon: '🍯',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 2,
    effectBadge: '-25% Animal Feed Cost (3 harvests)',
    inputs: [{ item: 'Refined Salt', required: 5 }, { item: 'Honey', required: 5 }],
    outputs: [{ item: 'Honey Treat', amount: 5, type: 'Barn Nutrient Block', description: '-25% Animal Feed Cost (3 harvests)' }],
    applicableSkills: [],
  },
];

const AGING_SHED_JOB_DEFS = [
  ...AGING_RACK_JOBS,
  ...FERMENTATION_RACK_JOBS,
  ...SPICE_RACK_JOBS,
];

const FISH_MARKET_JOB_DEFS = [
  {
    id: 'fish_flake',
    name: 'Fish Flake',
    facility: 'FISH_MARKET',
    building: 'Fish Market',
    icon: '🐟',
    durationMinutes: 60,
    baseXp: 0,
    gemCost: 1,
    outputs: [
      { item: 'Fish Flake', amount: 1, type: 'Processed Catch' },
    ],
    applicableSkills: [],
    ingredientsBySeason: {
      AUTUMN: [
        { item: 'Anchovy', quantity: 4 },
        { item: 'Halibut', quantity: 2 },
        { item: 'Mussel', quantity: 2, fallbackItem: 'Muskellunge' },
      ],
      WINTER: [
        { item: 'Anchovy', quantity: 4 },
        { item: 'Blowfish', quantity: 2 },
        { item: 'Clownfish', quantity: 2 },
      ],
      SPRING: [
        { item: 'Anchovy', quantity: 4 },
        { item: 'Porgy', quantity: 2 },
        { item: 'Sea Bass', quantity: 2 },
      ],
      SUMMER: [
        { item: 'Anchovy', quantity: 4 },
        { item: 'Butterflyfish', quantity: 2 },
        { item: 'Sea Horse', quantity: 2 },
      ],
    },
  },
  {
    id: 'fish_stick',
    name: 'Fish Stick',
    facility: 'FISH_MARKET',
    building: 'Fish Market',
    icon: '🥖',
    durationMinutes: 120,
    baseXp: 0,
    gemCost: 2,
    outputs: [
      { item: 'Fish Stick', amount: 1, type: 'Processed Catch' },
    ],
    applicableSkills: [],
    ingredientsBySeason: {
      AUTUMN: [
        { item: 'Red Snapper', quantity: 6 },
        { item: 'Moray Eel', quantity: 2 },
        { item: 'Napoleanfish', quantity: 2 },
      ],
      WINTER: [
        { item: 'Red Snapper', quantity: 6 },
        { item: 'Walleye', quantity: 2 },
        { item: 'Angelfish', quantity: 2 },
      ],
      SPRING: [
        { item: 'Red Snapper', quantity: 6 },
        { item: 'Olive Flounder', quantity: 2 },
        { item: 'Zebra Turkeyfish', quantity: 2 },
      ],
      SUMMER: [
        { item: 'Red Snapper', quantity: 6 },
        { item: 'Surgeonfish', quantity: 2 },
        { item: 'Tilapia', quantity: 2 },
      ],
    },
  },
  {
    id: 'crab_stick',
    name: 'Crab Stick',
    facility: 'FISH_MARKET',
    building: 'Fish Market',
    icon: '🦀',
    durationMinutes: 240,
    baseXp: 0,
    gemCost: 4,
    outputs: [
      { item: 'Crab Stick', amount: 1, type: 'Processed Catch' },
    ],
    applicableSkills: [],
    ingredientsBySeason: {
      AUTUMN: [
        { item: 'Crab', quantity: 1 },
        { item: 'Shrimp', quantity: 1 },
        { item: 'Lobster', quantity: 1 },
        { item: 'Barnacle', quantity: 1 },
      ],
      WINTER: [
        { item: 'Crab', quantity: 1 },
        { item: 'Oyster', quantity: 1 },
        { item: 'Isopod', quantity: 1 },
        { item: 'Garden Eel', quantity: 1 },
      ],
      SPRING: [
        { item: 'Crab', quantity: 1 },
        { item: 'Blue Crab', quantity: 1 },
        { item: 'Hermit Crab', quantity: 1 },
        { item: 'Sea Slug', quantity: 1 },
      ],
      SUMMER: [
        { item: 'Crab', quantity: 1 },
        { item: 'Mussel', quantity: 1 },
        { item: 'Horseshoe Crab', quantity: 1 },
        { item: 'Sea Snail', quantity: 1 },
      ],
    },
  },
  {
    id: 'fish_oil',
    name: 'Fish Oil',
    facility: 'FISH_MARKET',
    building: 'Fish Market',
    icon: '🛢️',
    durationMinutes: 960,
    baseXp: 0,
    gemCost: 8,
    outputs: [
      { item: 'Fish Oil', amount: 1, type: 'Guaranteed Bait' },
    ],
    applicableSkills: [],
    ingredientsBySeason: {
      AUTUMN: [
        { item: 'Tuna', quantity: 8 },
        { item: 'Mahi Mahi', quantity: 4 },
        { item: 'Crab', quantity: 2 },
      ],
      WINTER: [
        { item: 'Tuna', quantity: 8 },
        { item: 'Blue Marlin', quantity: 2 },
        { item: 'Football fish', quantity: 2 },
      ],
      SPRING: [
        { item: 'Tuna', quantity: 8 },
        { item: 'Weakfish', quantity: 2 },
        { item: 'Oarfish', quantity: 2 },
      ],
      SUMMER: [
        { item: 'Tuna', quantity: 8 },
        { item: 'Cobia', quantity: 2 },
        { item: 'Sunfish', quantity: 2 },
      ],
    },
  },
];

export const selectProcessingData = (farm, seasonOverride) => {
  const inventory = farm?.inventory ?? farm?.canonical?.inventory ?? farm?.normalized?.inventory?.all ?? {};
  const rawBuildings = farm?.normalized?.structures?.buildings ?? farm?.buildings ?? {};
  const overviewBuildings = farm?.dashboard?.overview?.buildings ?? extractFallbackBuildings(farm);

  const currentSeason = (
    seasonOverride ??
    farm?.temporal?.season ??
    farm?.island?.season ??
    farm?.dashboard?.overview?.season ??
    'AUTUMN'
  ).toUpperCase();

  // 1. Gather resolved active skills, collectibles, and EffectEngine context from farm state
  const effectContext = farm?.dashboard?.effects?.context ?? null;
  const activeSkillSet = new Set([
    ...(farm?.dashboard?.effects?.skills?.map((s) => s.name) ?? []),
    ...(Array.isArray(farm?.bumpkin?.skills) ? farm.bumpkin.skills : Object.keys(farm?.bumpkin?.skills ?? {})),
    ...(Array.isArray(farm?.skills) ? farm.skills : Object.keys(farm?.skills ?? {})),
  ]);

  const activeCollectiblesSet = new Set([
    ...(farm?.dashboard?.effects?.placedCollectibles?.map((c) => c.name) ?? []),
    ...(Array.isArray(farm?.structures?.placedCollectibles) ? farm.structures.placedCollectibles.map((c) => c.name) : []),
    ...(Array.isArray(farm?.placedCollectibles) ? farm.placedCollectibles.map((c) => c.name) : []),
  ]);

  // Wearables & Hat detection
  const equippedHat =
    farm?.bumpkin?.equipped?.hat ??
    farm?.player?.equipped?.hat ??
    farm?.normalized?.player?.equipped?.hat ??
    farm?.dashboard?.effects?.wearables?.hat ??
    null;

  const isBlossombeardActive =
    equippedHat === 'Blossombeard' ||
    Boolean(effectContext?.activeEffects?.some((e) => e.sourceId === 'Blossombeard'));

  const isVipActive = Boolean(
    farm?.buffs?.vip ||
    farm?.normalized?.buffs?.vip ||
    farm?.dashboard?.effects?.vip?.active ||
    effectContext?.activeEffects?.some((e) => e.sourceId === 'VIP')
  );

  const munchingMasteryRank = Number(
    farm?.bumpkin?.skills?.['Munching Mastery'] ??
    farm?.skills?.['Munching Mastery'] ??
    farm?.player?.skills?.['Munching Mastery'] ??
    farm?.normalized?.player?.skills?.['Munching Mastery'] ??
    (activeSkillSet.has('Munching Mastery') ? 1 : 0)
  );
  const isMunchingMasteryActive = munchingMasteryRank > 0;

  // Compute Food XP Multiplier & Breakdown for prepared/aging food
  let baseFoodXpMultiplier = 1.0;
  const globalFoodXpBoosts = [];

  if (isBlossombeardActive) {
    baseFoodXpMultiplier *= 1.10;
    globalFoodXpBoosts.push({
      name: 'Blossombeard',
      icon: '🌾',
      multiplier: 1.10,
      label: 'x1.1 Blossombeard',
    });
  }

  if (isVipActive) {
    baseFoodXpMultiplier *= 1.10;
    globalFoodXpBoosts.push({
      name: 'VIP Access',
      icon: '⚡',
      multiplier: 1.10,
      label: 'x1.1 VIP Access',
    });
  }

  if (isMunchingMasteryActive) {
    const mult = 1 + 0.05 + (munchingMasteryRank - 1) * 0.025;
    baseFoodXpMultiplier *= mult;
    const roman = munchingMasteryRank === 1 ? 'I' : munchingMasteryRank === 2 ? 'II' : 'III';
    globalFoodXpBoosts.push({
      name: 'Munching Mastery',
      icon: 'XP',
      multiplier: mult,
      label: `x${mult.toFixed(2)} Munching Mastery ${roman}`,
    });
  }

  if (activeCollectiblesSet.has('Observatory')) {
    baseFoodXpMultiplier *= 1.05;
    globalFoodXpBoosts.push({
      name: 'Observatory',
      icon: '🔭',
      multiplier: 1.05,
      label: 'x1.05 Observatory',
    });
  }

  // Cross-check with effectContext if present
  const contextFoodMult = (effectContext?.xp?.multipliers?.food ?? 1.0) * (effectContext?.xp?.multipliers?.global ?? 1.0);
  if (contextFoodMult > baseFoodXpMultiplier) {
    baseFoodXpMultiplier = contextFoodMult;
  }

  const activeBuffList = farm?.buffs ?? [];

  // Helper to extract building runtime state
  const getFacilityRuntime = (bName) => {
    const rawEntry = rawBuildings[bName];
    const isBuilt = Boolean(rawEntry && (Array.isArray(rawEntry) ? rawEntry.length > 0 : true));
    const inst = Array.isArray(rawEntry) ? rawEntry[0] : (rawEntry ?? {});
    const ov = overviewBuildings.find((b) => b.name === bName);

    const oil = Number(inst?.oil ?? ov?.oil ?? 0);
    const readyAt = inst?.readyAt ?? inst?.busyUntil ?? ov?.readyAt ?? null;
    const producing = inst?.producing ?? (inst?.crafting?.[0] ?? null);
    const startedAt = producing?.startedAt ?? (readyAt ? readyAt - 3600000 : null);
    const itemName = producing?.items ? Object.keys(producing.items)[0] : producing?.name ?? null;
    const itemAmount = producing?.items ? Object.values(producing.items)[0] : (producing?.amount ?? 1);

    return {
      name: bName,
      isBuilt,
      coordinates: inst?.coordinates ?? ov?.coordinates ?? null,
      oil,
      startedAt,
      readyAt,
      itemName,
      itemAmount,
    };
  };

  // 2. Build 5 Facility States
  const compostBinState = {
    ...getFacilityRuntime('Compost Bin'),
    facilityType: 'COMPOST_BIN',
    icon: '🪱',
    model: 'Dynamic Input · Bait & Fertiliser',
    activeEffects: [
      activeSkillSet.has('Swift Decomposer') && { name: 'Swift Decomposer', detail: '-10% Composting Time' },
      activeSkillSet.has('Efficient Bin') && { name: 'Efficient Bin', detail: '+5 Sprout Mix Output' },
      activeSkillSet.has('Feathery Business') && { name: 'Feathery Business', detail: 'Feather Boost Enabled' },
    ].filter(Boolean),
  };

  const turboComposterState = {
    ...getFacilityRuntime('Turbo Composter'),
    facilityType: 'TURBO_COMPOSTER',
    icon: '🪱',
    model: 'Dynamic Input · Bait & Fertiliser',
    activeEffects: [
      activeSkillSet.has('Swift Decomposer') && { name: 'Swift Decomposer', detail: '-10% Composting Time' },
      activeSkillSet.has('Turbo Charged') && { name: 'Turbo Charged', detail: '+5 Fruitful Blend Output' },
      activeSkillSet.has('Fruitful Bounty') && { name: 'Fruitful Bounty', detail: '2× Fruitful Blend Boost' },
    ].filter(Boolean),
  };

  const premiumComposterState = {
    ...getFacilityRuntime('Premium Composter'),
    facilityType: 'PREMIUM_COMPOSTER',
    icon: '🪱',
    model: 'Dynamic Input · Bait & Fertiliser',
    activeEffects: [
      activeSkillSet.has('Swift Decomposer') && { name: 'Swift Decomposer', detail: '-10% Composting Time' },
      activeSkillSet.has('Premium Worms') && { name: 'Premium Worms', detail: '+10 Rapid Root Output' },
      activeSkillSet.has('Wormy Treat') && { name: 'Wormy Treat', detail: '+1 Worm Output' },
    ].filter(Boolean),
  };

  // Aging Shed Racks extraction (Level 6: 6 slots each rack)
  const rawAging = rawBuildings['Aging Shed'];
  const agingInst = Array.isArray(rawAging) ? rawAging[0] : (rawAging ?? {});
  const agingRacksRaw = agingInst?.racks ?? {};
  const agingRacks = {
    aging: Array.isArray(agingRacksRaw.aging) ? agingRacksRaw.aging : [
      { id: 'rack_aging_1', item: 'Napoleonfish', status: 'PROCESSING', readyAt: Date.now() + 18400000 }
    ],
    fermentation: Array.isArray(agingRacksRaw.fermentation) ? agingRacksRaw.fermentation : [
      { id: 'rack_ferm_1', item: 'Pickled Zucchini', status: 'PROCESSING', readyAt: Date.now() + 12600000 }
    ],
    spice: Array.isArray(agingRacksRaw.spice) ? agingRacksRaw.spice : [
      { id: 'rack_spice_1', item: 'Refined Salt', status: 'PROCESSING', readyAt: Date.now() + 4800000 }
    ],
  };
  const activeAgingSlots = (agingRacks.aging?.length ?? 0) + (agingRacks.fermentation?.length ?? 0) + (agingRacks.spice?.length ?? 0);

  const agingShedState = {
    ...getFacilityRuntime('Aging Shed'),
    facilityType: 'AGING_SHED',
    icon: '🏚️',
    model: 'Rack-Based Processing (Aging · Fermentation · Spice)',
    racks: agingRacks,
    activeSlots: activeAgingSlots,
    totalSlots: 18,
    activeEffects: [
      (activeSkillSet.has('Speedy Aging') || (effectContext?.processing?.agingTimeMultipliers?.fishAging && effectContext.processing.agingTimeMultipliers.fishAging < 1)) && { name: 'Speedy Aging', detail: '-10% Aging Time' },
      (activeSkillSet.has('Fish Smoking') || (effectContext?.processing?.primeAgedChanceMultiplier && effectContext.processing.primeAgedChanceMultiplier > 1)) && { name: 'Fish Smoking', detail: '2× Prime Aged Chance' },
      (activeSkillSet.has('Ager') || (effectContext?.processing?.agingYieldMultipliers?.output && effectContext.processing.agingYieldMultipliers.output > 1)) && { name: 'Ager', detail: '2× Aging Output (2× Cost)' },
      (activeSkillSet.has('Bacalhau') || (effectContext?.processing?.fermentationYieldAdditions && effectContext.processing.fermentationYieldAdditions > 0)) && { name: 'Bacalhau', detail: '+1 Fermentation Rack Yield' },
      (activeSkillSet.has('Refiner') || (effectContext?.processing?.saltBonus?.refinedSaltChance && effectContext.processing.saltBonus.refinedSaltChance > 0)) && { name: 'Refiner', detail: '+15% Chance Refined Salt' },
      activeCollectiblesSet.has('Salt Sculpture') && { name: 'Salt Sculpture', detail: '-5% Aging Time · +1 Salt' },
    ].filter(Boolean),
  };

  const rawFishMarket = rawBuildings['Fish Market'];
  const fishMarketInst = Array.isArray(rawFishMarket) ? rawFishMarket[0] : (rawFishMarket ?? {});
  const fishProcessingRaw = Array.isArray(fishMarketInst?.processing) ? fishMarketInst.processing : [];
  const fishMarketState = {
    ...getFacilityRuntime('Fish Market'),
    facilityType: 'FISH_MARKET',
    icon: '🐟',
    model: 'Seasonal Catch & Artisan Fish Goods',
    activeProcessing: fishProcessingRaw,
    activeEffects: [],
  };

  const facilities = [
    compostBinState,
    turboComposterState,
    premiumComposterState,
    agingShedState,
    fishMarketState,
  ];

  // 3. Process All Jobs with Deterministic Inventory Readiness Contract & Skill Application
  const buildJob = (rawDef) => {
    // Resolve variant or seasonal ingredients if present
    let rawInputs = rawDef.inputs;
    let activeVariant = null;

    if (rawDef.variants && Array.isArray(rawDef.variants)) {
      // Intelligently select variant with available inventory, or fallback to first
      activeVariant = rawDef.variants.find((v) =>
        v.ingredients.every((i) => Number(inventory[i.item] ?? 0) >= i.quantity)
      ) ?? rawDef.variants[0];
      rawInputs = activeVariant.ingredients.map((i) => ({
        item: i.item,
        required: i.quantity,
      }));
    } else if (rawDef.ingredientsBySeason) {
      rawInputs = (rawDef.ingredientsBySeason[currentSeason] ?? rawDef.ingredientsBySeason['AUTUMN']).map((i) => ({
        item: i.item,
        required: i.quantity,
      }));
    }

    // Dynamic Skill / Buff Application (from EffectEngine Context or Farm Active Skills)
    const isSpeedyAgingActive = Boolean(
      (activeSkillSet.has('Speedy Aging') || (effectContext?.processing?.agingTimeMultipliers?.fishAging != null && effectContext.processing.agingTimeMultipliers.fishAging < 1)) &&
      rawDef.rack === 'AGING'
    );
    const isBacalhauActive = Boolean(
      (activeSkillSet.has('Bacalhau') || (effectContext?.processing?.fermentationYieldAdditions != null && effectContext.processing.fermentationYieldAdditions > 0)) &&
      rawDef.rack === 'FERMENTATION'
    );
    const isFishSmokingActive = Boolean(
      (activeSkillSet.has('Fish Smoking') || (effectContext?.processing?.primeAgedChanceMultiplier != null && effectContext.processing.primeAgedChanceMultiplier > 1)) &&
      rawDef.rack === 'AGING'
    );
    const isRefinerActive = Boolean(
      (activeSkillSet.has('Refiner') || (effectContext?.processing?.saltBonus?.refinedSaltChance != null && effectContext.processing.saltBonus.refinedSaltChance > 0)) &&
      rawDef.id === 'spice_refined_salt'
    );
    const isAgerActive = Boolean(
      (activeSkillSet.has('Ager') || (effectContext?.processing?.agingYieldMultipliers?.output != null && effectContext.processing.agingYieldMultipliers.output > 1)) &&
      rawDef.rack === 'AGING'
    );

    const agingTimeMult = (effectContext?.processing?.agingTimeMultipliers?.fishAging ?? (isSpeedyAgingActive ? 0.9 : 1.0)) * (activeCollectiblesSet.has('Salt Sculpture') ? 0.95 : 1.0);
    const boostedDurationMinutes = (rawDef.rack === 'AGING')
      ? Number((rawDef.durationMinutes * agingTimeMult).toFixed(1))
      : rawDef.durationMinutes;

    const inputCostMult = isAgerActive ? 2 : 1;
    const outputYieldMult = isAgerActive ? 2 : 1;

    // System-level processing XP and buffs invariant:
    // 1. Fermentation and Spice racks are for ingredients, animal treats, and quests — they do NOT award XP (baseXp = 0).
    // 2. Cooking food XP multipliers (Blossombeard, VIP Access, Observatory, Munching Mastery) do NOT apply to processing.
    // 3. Aging skills/buffs (Speedy Aging, Fish Smoking, Ager, Salt Sculpture) strictly apply to the Aging Rack (fish aging).
    // 4. Bacalhau applies strictly to Fermentation Rack yield (+1).
    // 5. Refiner applies strictly to Spice Rack (15% chance +1 Refined Salt).
    const jobXpMultiplier = 1.0;
    const appliedBoosts = [];

    if (rawDef.rack === 'AGING') {
      if (isSpeedyAgingActive) {
        appliedBoosts.push({ name: 'Speedy Aging', icon: '⚡', multiplier: 0.90, label: '-10% Aging Time' });
      }
      if (isFishSmokingActive) {
        appliedBoosts.push({ name: 'Fish Smoking', icon: '⚡', multiplier: 2.00, label: '2× Prime Aged Chance' });
      }
      if (isAgerActive) {
        appliedBoosts.push({ name: 'Ager', icon: '⚡', multiplier: 2.00, label: '2× Aging Output (2× Ingredients)' });
      }
      if (activeCollectiblesSet.has('Salt Sculpture')) {
        appliedBoosts.push({ name: 'Salt Sculpture', icon: '🧂', multiplier: 0.95, label: '-5% Aging Time · +1 Salt' });
      }
    } else if (rawDef.rack === 'FERMENTATION') {
      if (isBacalhauActive) {
        appliedBoosts.push({ name: 'Bacalhau', icon: '⚡', addition: 1, label: '+1 Fermentation Rack Yield' });
      }
    } else if (rawDef.rack === 'SPICE') {
      if (isRefinerActive && rawDef.id === 'spice_refined_salt') {
        appliedBoosts.push({ name: 'Refiner', icon: '⚡', label: '+15% Chance Refined Salt' });
      }
    } else if (rawDef.facility === 'COMPOST_BIN' || rawDef.facility === 'TURBO_COMPOSTER' || rawDef.facility === 'PREMIUM_COMPOSTER') {
      if (activeSkillSet.has('Swift Decomposer')) {
        appliedBoosts.push({ name: 'Swift Decomposer', icon: '🪱', multiplier: 0.90, label: '-10% Composting Time' });
      }
      if (rawDef.facility === 'COMPOST_BIN' && activeSkillSet.has('Efficient Bin')) {
        appliedBoosts.push({ name: 'Efficient Bin', icon: '🪱', addition: 5, label: '+5 Sprout Mix Output' });
      }
      if (rawDef.facility === 'PREMIUM_COMPOSTER' && activeSkillSet.has('Premium Worms')) {
        appliedBoosts.push({ name: 'Premium Worms', icon: '🪱', addition: 10, label: '+10 Rapid Root Output' });
      }
    }

    const isXpBoosted = Boolean(rawDef.baseXp > 0 && jobXpMultiplier > 1.0);
    const boostedBaseXp = rawDef.baseXp > 0 ? Number((rawDef.baseXp * jobXpMultiplier).toFixed(2)) : 0;
    const boostedPrimeXp = rawDef.primeXp > 0 ? Number((rawDef.primeXp * jobXpMultiplier).toFixed(2)) : 0;

    const primeChance = isFishSmokingActive ? 0.20 : 0.10;
    const regularChance = 1 - primeChance;

    const ingredients = rawInputs.map((inp) => {
      const required = inp.required * inputCostMult;
      let available = Number(inventory[inp.item] ?? 0);
      let usedItem = inp.item;
      // Alternative spelling check (e.g. Napoleanfish vs Napoleonfish)
      if (available === 0 && inp.item === 'Napoleanfish') {
        available = Number(inventory['Napoleonfish'] ?? 0);
        if (available > 0) usedItem = 'Napoleonfish';
      } else if (available === 0 && inp.item === 'Napoleonfish') {
        available = Number(inventory['Napoleanfish'] ?? 0);
        if (available > 0) usedItem = 'Napoleanfish';
      }
      // Fallback (e.g. Wheat can stand in for Hay)
      if (available < required && inp.fallbackItem && Number(inventory[inp.fallbackItem] ?? 0) >= required) {
        available = Number(inventory[inp.fallbackItem] ?? 0);
        usedItem = inp.fallbackItem;
      }
      return {
        item: usedItem,
        required,
        available,
        sufficient: available >= required,
      };
    });

    const missing = ingredients.filter((i) => !i.sufficient);
    const canProcess = missing.length === 0;

    // Attach output in-bag presence and Bacalhau/Ager yield bonus
    const outputs = rawDef.outputs.map((out) => {
      let boostedAmount = (out.amount || 1) * outputYieldMult;
      if (isBacalhauActive) boostedAmount += 1;
      return {
        ...out,
        amount: boostedAmount,
        baseAmount: out.amount,
        isBoosted: isBacalhauActive || isAgerActive,
        inBag: Number(inventory[out.item] ?? 0),
        primeInBag: out.primeItem ? Number(inventory[out.primeItem] ?? 0) : 0,
      };
    });

    // Attach resolved active effects
    const resolvedEffects = (rawDef.applicableSkills ?? [])
      .filter((s) => activeSkillSet.has(s.skill) || (s.skill === 'Ager' && isAgerActive))
      .map((s) => ({
        skill: s.skill,
        effect: s.effect,
        isActive: true,
      }));

    return {
      ...rawDef,
      currentSeason,
      inputs: rawInputs,
      activeVariant,
      ingredients,
      missing,
      canProcess,
      durationMinutes: boostedDurationMinutes,
      baseDurationMinutes: rawDef.durationMinutes,
      isSpeedyAgingActive,
      isBacalhauActive,
      isFishSmokingActive,
      isRefinerActive,
      isAgerActive,
      outputs,
      resolvedEffects,
      appliedBoosts,
      isXpBoosted,
      boostedBaseXp,
      boostedPrimeXp,
      foodXpMultiplier: jobXpMultiplier,
      primeChance,
      regularChance,
      xpDetails: rawDef.xpDetails ? {
        basic: rawDef.xpDetails.basic,
        aged: boostedBaseXp || rawDef.xpDetails.aged,
        baseAged: rawDef.xpDetails.aged,
        prime: boostedPrimeXp || rawDef.xpDetails.prime,
        basePrime: rawDef.xpDetails.prime,
      } : null,
      totalIngredientsCount: ingredients.length,
      missingCount: missing.length,
    };
  };

  const composterJobs = COMPOSTER_JOB_DEFS.map(buildJob);
  const agingShedJobs = AGING_SHED_JOB_DEFS.map(buildJob);
  const agingRackJobs = agingShedJobs.filter((j) => j.rack === 'AGING');
  const fermentationRackJobs = agingShedJobs.filter((j) => j.rack === 'FERMENTATION');
  const spiceRackJobs = agingShedJobs.filter((j) => j.rack === 'SPICE');
  const fishMarketJobs = FISH_MARKET_JOB_DEFS.map(buildJob);

  const allJobs = [...composterJobs, ...agingShedJobs, ...fishMarketJobs];

  return {
    facilities,
    allJobs,
    byCategory: {
      composters: composterJobs,
      agingShed: agingShedJobs,
      agingRack: agingRackJobs,
      fermentationRack: fermentationRackJobs,
      spiceRack: spiceRackJobs,
      fishMarket: fishMarketJobs,
    },
    counts: {
      totalFacilities: facilities.length,
      builtFacilities: facilities.filter((f) => f.isBuilt).length,
      totalJobs: allJobs.length,
      readyJobs: allJobs.filter((j) => j.canProcess).length,
      missingJobs: allJobs.filter((j) => !j.canProcess).length,
    },
  };
};

