/**
 * server/core/temporalEngine/seasonRules.ts
 * Versioned seasonal rules, crop availability matrices, and schedules.
 *
 * Invariant: Rules are encapsulated in versioned datasets (SeasonalRuleDataset)
 * rather than an immutable, permanently hardcoded table.
 */

import type { SeasonalRuleDataset } from '../../domain/calendar.js';

/**
 * Standard Season Rules Version 1.0.0
 */
export const DEFAULT_SEASON_RULES_V1: SeasonalRuleDataset = {
  ruleVersion: 'season-rules-v1.0.0',
  seasons: {
    SPRING: {
      season: 'SPRING',
      availableCrops: [
        'Sunflower',
        'Potato',
        'Rhubarb',
        'Carrot',
        'Cabbage',
        'Beetroot',
        'Cauliflower',
        'Parsnip',
        'Radish',
        'Wheat',
        'Kale',
        'Corn',
        'Onion',
      ],
      unavailableCrops: ['Artichoke', 'Yam', 'Broccoli', 'Pepper'],
      growthModifiers: {
        Rhubarb: 1.0,
        Carrot: 1.0,
      },
      yieldModifiers: {},
    },
    SUMMER: {
      season: 'SUMMER',
      availableCrops: [
        'Sunflower',
        'Potato',
        'Pepper',
        'Cauliflower',
        'Beetroot',
        'Radish',
        'Eggplant',
        'Corn',
        'Wheat',
        'Kale',
        'Onion',
      ],
      unavailableCrops: ['Artichoke', 'Yam', 'Broccoli', 'Rhubarb', 'Cabbage'],
      growthModifiers: {
        Pepper: 1.0,
      },
      yieldModifiers: {},
    },
    AUTUMN: {
      season: 'AUTUMN',
      availableCrops: [
        'Sunflower',
        'Potato',
        'Carrot',
        'Cabbage',
        'Beetroot',
        'Cauliflower',
        'Parsnip',
        'Radish',
        'Wheat',
        'Kale',
        'Corn',
        'Eggplant',
        'Artichoke',
        'Yam',
        'Broccoli',
      ],
      unavailableCrops: ['Rhubarb', 'Pepper'],
      growthModifiers: {
        Artichoke: 1.0,
        Yam: 1.0,
      },
      yieldModifiers: {},
    },
    WINTER: {
      season: 'WINTER',
      availableCrops: [
        'Sunflower',
        'Potato',
        'Radish',
        'Wheat',
        'Kale',
        'Onion',
        'Barley',
      ],
      unavailableCrops: [
        'Artichoke',
        'Yam',
        'Broccoli',
        'Rhubarb',
        'Cabbage',
        'Carrot',
        'Beetroot',
        'Cauliflower',
        'Parsnip',
        'Corn',
        'Eggplant',
      ],
      growthModifiers: {},
      yieldModifiers: {},
    },
  },
  schedules: [
    // Standard Autumn -> Winter transition example
    {
      season: 'AUTUMN',
      startAt: 1725148800000, // 2024-09-01 00:00:00 UTC
      endAt: 1733011200000,   // 2024-12-01 00:00:00 UTC
      nextSeason: 'WINTER',
    },
    {
      season: 'WINTER',
      startAt: 1733011200000, // 2024-12-01 00:00:00 UTC
      endAt: 1740787200000,   // 2025-03-01 00:00:00 UTC
      nextSeason: 'SPRING',
    },
    {
      season: 'SPRING',
      startAt: 1740787200000, // 2025-03-01 00:00:00 UTC
      endAt: 1748736000000,   // 2025-06-01 00:00:00 UTC
      nextSeason: 'SUMMER',
    },
    {
      season: 'SUMMER',
      startAt: 1748736000000, // 2025-06-01 00:00:00 UTC
      endAt: 1756684800000,   // 2025-09-01 00:00:00 UTC
      nextSeason: 'AUTUMN',
    },
    {
      season: 'AUTUMN',
      startAt: 1756684800000, // 2025-09-01 00:00:00 UTC
      endAt: 1764547200000,   // 2025-12-01 00:00:00 UTC
      nextSeason: 'WINTER',
    },
    {
      season: 'WINTER',
      startAt: 1764547200000, // 2025-12-01 00:00:00 UTC
      endAt: 1772323200000,   // 2026-03-01 00:00:00 UTC
      nextSeason: 'SPRING',
    },
    {
      season: 'SPRING',
      startAt: 1772323200000, // 2026-03-01 00:00:00 UTC
      endAt: 1780272000000,   // 2026-06-01 00:00:00 UTC
      nextSeason: 'SUMMER',
    },
    {
      season: 'SUMMER',
      startAt: 1780272000000, // 2026-06-01 00:00:00 UTC
      endAt: 1788220800000,   // 2026-09-01 00:00:00 UTC
      nextSeason: 'AUTUMN',
    },
    {
      season: 'AUTUMN',
      startAt: 1788220800000, // 2026-09-01 00:00:00 UTC
      endAt: 1796083200000,   // 2026-12-01 00:00:00 UTC
      nextSeason: 'WINTER',
    },
    {
      season: 'WINTER',
      startAt: 1796083200000, // 2026-12-01 00:00:00 UTC
      endAt: 1803772800000,   // 2027-03-01 00:00:00 UTC
      nextSeason: 'SPRING',
    },
  ],
};

/**
 * Standard seasonal transition order
 */
export const BASE_SEASON_ROTATION: Record<string, string> = {
  SPRING: 'SUMMER',
  SUMMER: 'AUTUMN',
  AUTUMN: 'WINTER',
  WINTER: 'SPRING',
};
