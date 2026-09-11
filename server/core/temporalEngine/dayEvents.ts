/**
 * server/core/temporalEngine/dayEvents.ts
 * Authoritative day events, calendar schedules, and weather modifiers.
 *
 * Invariant: Zero invented pseudo-random weather algorithms.
 * Events strictly originate from authoritative calendar schedules or explicit game state.
 * If no event is scheduled for a day, the day operates under standard baseline conditions.
 */

import type { DayEvent, SeasonName } from '../../domain/calendar.js';
import { DayEventSchema } from '../../schemas/calendarSchema.js';

export type WeatherType = 'SUNNY' | 'RAINY' | 'STORMY' | 'HEATWAVE' | 'WINDY';

/**
 * Standard known weather modifiers
 */
export const WEATHER_MODIFIERS: Record<WeatherType, Record<string, number>> = {
  SUNNY: {
    cropGrowthSpeed: 1.0,
    waterUsage: 1.0,
  },
  RAINY: {
    cropGrowthSpeed: 1.2,
    waterUsage: 0.0,
  },
  STORMY: {
    cropGrowthSpeed: 1.0,
    fishingLuck: 1.3,
    animalProductivity: 0.85,
  },
  HEATWAVE: {
    cropGrowthSpeed: 0.9,
    waterUsage: 1.5,
  },
  WINDY: {
    cropGrowthSpeed: 1.0,
    windMillEfficiency: 1.25,
  },
};

/**
 * Authoritative Day Event Schedule type: Map of in-game day number -> DayEvent[]
 */
export type DayEventSchedule = Record<number, DayEvent[]>;

/**
 * Resolves active day events from an authoritative schedule for a given in-game day.
 * If no events are scheduled for that day, returns an empty array (standard conditions).
 * No pseudo-random weather is generated.
 */
export function resolveDayEvents(
  dayNumber: number,
  _season?: SeasonName,
  schedule: DayEventSchedule = {}
): DayEvent[] {
  const events = schedule[dayNumber] ?? [];
  return events.map((event) => DayEventSchema.parse(event));
}

/**
 * Helper to construct a validated DayEvent with known weather modifiers.
 */
export function createWeatherDayEvent(
  dayNumber: number,
  weather: WeatherType,
  description?: string
): DayEvent {
  const modifiers = WEATHER_MODIFIERS[weather] ?? {};
  return DayEventSchema.parse({
    dayNumber,
    name: `WEATHER_${weather}`,
    description: description ?? `${weather} conditions active on day ${dayNumber}`,
    modifiers,
  });
}
