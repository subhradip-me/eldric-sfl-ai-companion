/**
 * server/core/effectEngine/effectRegistry.ts
 * Versioned, source-backed registry of official game effect definitions.
 *
 * ARCHITECTURAL INVARIANT:
 * Every effect definition contains explicit domain, operation, target, value, ruleVersion, and sourceRef.
 * No engine guesses or hardcodes boost mechanics.
 */

import type { EffectDefinition } from './effectTypes.js';

export const CURRENT_RULE_VERSION = 'sfl-rules-v1.0.0';

export const EFFECT_REGISTRY: Record<string, EffectDefinition> = {
  // ── Wearables ────────────────────────────────────────────────────────────
  'Blossombeard': {
    id: 'Blossombeard',
    sourceType: 'wearable',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'food',
        value: 1.10,
        description: '+10% Bumpkin XP from all food',
      },
    ],
  },
  'Chef Hat': {
    id: 'Chef Hat',
    sourceType: 'wearable',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'Bakery',
        value: 0.90,
        description: '-10% Bakery cook time',
      },
    ],
  },
  'Lumberjack Overalls': {
    id: 'Lumberjack Overalls',
    sourceType: 'wearable',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'wood',
        value: 1.10,
        description: '+10% Wood drops from trees',
      },
    ],
  },
  'Parsnip Horns': {
    id: 'Parsnip Horns',
    sourceType: 'wearable',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'Parsnip',
        value: 1.20,
        description: '+20% Parsnip yield',
      },
    ],
  },
  'Sunflower Amulet': {
    id: 'Sunflower Amulet',
    sourceType: 'wearable',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'Sunflower',
        value: 1.10,
        description: '+10% Sunflower yield',
      },
    ],
  },
  'Carrot Amulet': {
    id: 'Carrot Amulet',
    sourceType: 'wearable',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'CarrotGrowth',
        value: 0.80,
        description: '-20% Carrot growth time',
      },
    ],
  },
  'Beetroot Amulet': {
    id: 'Beetroot Amulet',
    sourceType: 'wearable',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'Beetroot',
        value: 1.20,
        description: '+20% Beetroot yield',
      },
    ],
  },

  // ── Collectibles (Placed on Island or in Interior) ────────────────────────
  'Desert Gnome': {
    id: 'Desert Gnome',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'global',
        value: 0.90,
        description: '-10% Cooking time across all buildings',
      },
    ],
  },
  'Scarecrow': {
    id: 'Scarecrow',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'growthTime',
        value: 0.85,
        description: '-15% Crop growth time',
      },
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'yield',
        value: 1.20,
        description: '+20% Crop yield',
      },
    ],
  },
  'Basic Scarecrow': {
    id: 'Basic Scarecrow',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'growthTime',
        value: 0.85,
        description: '-15% Crop growth time',
      },
    ],
  },
  'Nancy': {
    id: 'Nancy',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'growthTime',
        value: 0.85,
        description: '-15% Crop growth time',
      },
    ],
  },
  'Kuebiko': {
    id: 'Kuebiko',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'growthTime',
        value: 0.85,
        description: '-15% Crop growth time',
      },
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'yield',
        value: 1.20,
        description: '+20% Crop yield',
      },
      {
        domain: 'crops',
        operation: 'flag',
        target: 'freeSeeds',
        value: true,
        description: 'All seeds are free from the market',
      },
    ],
  },
  'Lunar Calendar': {
    id: 'Lunar Calendar',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'growthTime',
        value: 0.90,
        description: '-10% Crop growth time',
      },
    ],
  },
  'Golden Cauliflower': {
    id: 'Golden Cauliflower',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'Cauliflower',
        value: 2.00,
        description: '+100% (2x) Cauliflower yield',
      },
    ],
  },
  'Victoria Sisters': {
    id: 'Victoria Sisters',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'Pumpkin',
        value: 1.20,
        description: '+20% Pumpkin yield',
      },
    ],
  },
  'Cabbage Boy': {
    id: 'Cabbage Boy',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'add',
        target: 'Cabbage',
        value: 0.25,
        description: '+0.25 Cabbage yield per harvest',
      },
    ],
  },
  'Cabbage Girl': {
    id: 'Cabbage Girl',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'CabbageGrowth',
        value: 0.50,
        description: '-50% Cabbage growth time',
      },
    ],
  },
  'Karkinos': {
    id: 'Karkinos',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'add',
        target: 'Cabbage',
        value: 0.10,
        description: '+0.10 Cabbage yield per harvest',
      },
    ],
  },
  'Pablo The Bunny': {
    id: 'Pablo The Bunny',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'add',
        target: 'Carrot',
        value: 0.10,
        description: '+0.10 Carrot yield per harvest',
      },
    ],
  },
  'Easter Bunny': {
    id: 'Easter Bunny',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'Carrot',
        value: 1.20,
        description: '+20% Carrot yield',
      },
    ],
  },
  'Mysterious Parsnip': {
    id: 'Mysterious Parsnip',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'ParsnipGrowth',
        value: 0.50,
        description: '-50% Parsnip growth time',
      },
    ],
  },
  'Foliant': {
    id: 'Foliant',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'add',
        target: 'Kale',
        value: 0.20,
        description: '+0.20 Kale yield per harvest',
      },
    ],
  },
  'Carrot Sword': {
    id: 'Carrot Sword',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'crops',
        operation: 'flag',
        target: 'mutantChanceMultiplier',
        value: 4.0,
        description: '+300% (4x) chance of mutant crop',
      },
    ],
  },

  // Resources
  'Woody the Beaver': {
    id: 'Woody the Beaver',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'wood',
        value: 1.20,
        description: '+20% Wood drops from trees',
      },
    ],
  },
  'Apprentice Beaver': {
    id: 'Apprentice Beaver',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'wood',
        value: 1.20,
        description: '+20% Wood drops from trees',
      },
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'treeRegen',
        value: 0.50,
        description: '-50% Tree regeneration time',
      },
    ],
  },
  'Foreman Beaver': {
    id: 'Foreman Beaver',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'wood',
        value: 1.20,
        description: '+20% Wood drops from trees',
      },
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'treeRegen',
        value: 0.50,
        description: '-50% Tree regeneration time',
      },
      {
        domain: 'resources',
        operation: 'flag',
        target: 'freeAxe',
        value: true,
        description: 'Chop trees without axes',
      },
    ],
  },
  'Tiki Totem': {
    id: 'Tiki Totem',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'add',
        target: 'wood',
        value: 0.10,
        description: '+0.10 Wood to every tree chopped',
      },
    ],
  },
  'Wood Nymph Wendy': {
    id: 'Wood Nymph Wendy',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'add',
        target: 'wood',
        value: 0.20,
        description: '+0.20 Wood to every tree chopped',
      },
    ],
  },
  'Tunnel Mole': {
    id: 'Tunnel Mole',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'add',
        target: 'stone',
        value: 0.25,
        description: '+0.25 Stone drops from stone mines',
      },
    ],
  },
  'Rocky the Mole': {
    id: 'Rocky the Mole',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'add',
        target: 'iron',
        value: 0.25,
        description: '+0.25 Iron drops from iron mines',
      },
    ],
  },
  'Iron Idol': {
    id: 'Iron Idol',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'add',
        target: 'iron',
        value: 1.00,
        description: '+1 Iron every time you mine iron',
      },
    ],
  },
  'Nugget': {
    id: 'Nugget',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'resources',
        operation: 'add',
        target: 'gold',
        value: 0.25,
        description: '+0.25 Gold drops from gold mines',
      },
    ],
  },

  // Animals
  'Chicken Coop': {
    id: 'Chicken Coop',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'add',
        target: 'egg',
        value: 1.00,
        description: '+1 Egg yield per harvest',
      },
    ],
  },
  'Gold Egg': {
    id: 'Gold Egg',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'flag',
        target: 'freeChickenFeed',
        value: true,
        description: 'Feed chickens without wheat/food',
      },
    ],
  },
  'Speed Chicken': {
    id: 'Speed Chicken',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'multiply',
        target: 'produceTime',
        value: 0.90,
        description: '-10% Egg production time',
      },
    ],
  },
  'Fat Chicken': {
    id: 'Fat Chicken',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'multiply',
        target: 'feedCost',
        value: 0.90,
        description: '-10% Chicken feed required',
      },
    ],
  },
  'Rich Chicken': {
    id: 'Rich Chicken',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'add',
        target: 'egg',
        value: 0.10,
        description: '+0.10 Egg yield per harvest',
      },
    ],
  },
  'Ayam Cemani': {
    id: 'Ayam Cemani',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'add',
        target: 'egg',
        value: 0.20,
        description: '+0.20 Egg yield per harvest',
      },
    ],
  },
  'Undead Rooster': {
    id: 'Undead Rooster',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'add',
        target: 'egg',
        value: 0.10,
        description: '+0.10 Egg yield per harvest',
      },
    ],
  },
  'Astronaut Sheep': {
    id: 'Astronaut Sheep',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'animals',
        operation: 'add',
        target: 'wool',
        value: 0.10,
        description: '+0.10 Wool yield per harvest',
      },
    ],
  },
  'Baby Cow': {
    id: 'Baby Cow',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'xp',
        operation: 'add',
        target: 'animalAffection',
        value: 10,
        description: '+10 Cow XP from affection tools',
      },
    ],
  },

  // Seasonal Fishing Collectibles
  'Super Star': {
    id: 'Super Star',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'fishing',
        operation: 'add',
        target: 'catch',
        value: 1,
        condition: 'Winter',
        description: '+1 Fish catch during Winter months',
      },
    ],
  },
  'Jellyfish': {
    id: 'Jellyfish',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'fishing',
        operation: 'add',
        target: 'catch',
        value: 1,
        condition: 'Summer',
        description: '+1 Fish catch during Summer months',
      },
    ],
  },
  'Pink Dolphin': {
    id: 'Pink Dolphin',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'fishing',
        operation: 'add',
        target: 'catch',
        value: 1,
        condition: 'Spring',
        description: '+1 Fish catch during Spring months',
      },
    ],
  },
  'Observatory': {
    id: 'Observatory',
    sourceType: 'collectible',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'global',
        value: 1.05,
        description: '+5% Global Bumpkin XP',
      },
    ],
  },

  // ── Skills (Passive) ─────────────────────────────────────────────────────
  'Munching Mastery': {
    id: 'Munching Mastery',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'food',
        value: 1.05,
        description: '+5% XP from all food (+2.5% per rank)',
      },
    ],
  },
  'Drive-Through Deli': {
    id: 'Drive-Through Deli',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'Deli',
        value: 1.15,
        description: '+15% XP from Deli food (+5% per rank)',
      },
    ],
  },
  'Juicy Boost': {
    id: 'Juicy Boost',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'Smoothie Shack',
        value: 1.10,
        description: '+10% XP from Smoothie Shack drinks (+5% per rank)',
      },
    ],
  },
  'Fishy Feast': {
    id: 'Fishy Feast',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'fishFood',
        value: 1.20,
        description: '+20% XP from fish-ingredient foods',
      },
    ],
  },
  'Buzzworthy Treats': {
    id: 'Buzzworthy Treats',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'honeyFood',
        value: 1.10,
        description: '+10% XP from honey-ingredient foods',
      },
    ],
  },
  'Fast Feasts': {
    id: 'Fast Feasts',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'Fire Pit',
        value: 0.90,
        description: '-10% Fire Pit cook time',
      },
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'Kitchen',
        value: 0.90,
        description: '-10% Kitchen cook time',
      },
    ],
  },
  'Frosted Cakes': {
    id: 'Frosted Cakes',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'Bakery',
        value: 0.90,
        description: '-10% Bakery cook time',
      },
    ],
  },
  'Swift Sizzle': {
    id: 'Swift Sizzle',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'Fire Pit',
        value: 0.60,
        condition: 'oilActive',
        description: '-40% Fire Pit cook time with oil',
      },
    ],
  },
  'Turbo Fry': {
    id: 'Turbo Fry',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'Kitchen',
        value: 0.50,
        condition: 'oilActive',
        description: '-50% Kitchen cook time with oil',
      },
    ],
  },
  'Fry Frenzy': {
    id: 'Fry Frenzy',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'Deli',
        value: 0.40,
        condition: 'oilActive',
        description: '-60% Deli cook time with oil',
      },
    ],
  },
  'Double Nom': {
    id: 'Double Nom',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'output',
        value: 2.00,
        description: '2x Food cooked output',
      },
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'cost',
        value: 2.00,
        description: '2x Food ingredients required',
      },
    ],
  },
  'Green Thumb': {
    id: 'Green Thumb',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'crops',
        operation: 'multiply',
        target: 'growthTime',
        value: 0.95,
        description: '-5% Crop growth time',
      },
    ],
  },
  'Young Farmer': {
    id: 'Young Farmer',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'crops',
        operation: 'add',
        target: 'basicTier',
        value: 0.10,
        description: '+0.10 Basic crop yield (Sunflower, Potato, Pumpkin)',
      },
    ],
  },
  'Lumberjack': {
    id: 'Lumberjack',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'wood',
        value: 1.10,
        description: '+10% Wood drops from trees',
      },
    ],
  },
  'Prospector': {
    id: 'Prospector',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'stone',
        value: 1.20,
        description: '+20% Stone drops from stone rocks',
      },
    ],
  },
  'Gold Rush': {
    id: 'Gold Rush',
    sourceType: 'passive_skill',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'skills.json',
    effects: [
      {
        domain: 'resources',
        operation: 'multiply',
        target: 'gold',
        value: 1.50,
        description: '+50% Gold drops from gold rocks',
      },
    ],
  },

  // ── Buffs & VIP ──────────────────────────────────────────────────────────
  'VIP': {
    id: 'VIP',
    sourceType: 'vip',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'xp',
        operation: 'multiply',
        target: 'food',
        value: 1.10,
        description: '+10% Bumpkin XP from all food',
      },
    ],
  },
  'Power hour': {
    id: 'Power hour',
    sourceType: 'temporary_buff',
    ruleVersion: CURRENT_RULE_VERSION,
    sourceRef: 'https://docs.sunflower-land.com/getting-started/about',
    effects: [
      {
        domain: 'cooking',
        operation: 'multiply',
        target: 'global',
        value: 0.50,
        description: '-50% Cooking time during active Power Hour',
      },
    ],
  },
};
