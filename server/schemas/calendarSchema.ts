/**
 * server/schemas/calendarSchema.ts
 * Runtime Zod validation for temporal engine and calendar structures.
 */

import { z } from 'zod';

export const DayEventSchema = z.object({
  dayNumber: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().optional(),
  modifiers: z.record(z.string(), z.number()).default({}),
});

export const GameTimeSchema = z.object({
  currentDay: z.number().int().nonnegative(),
  season: z.string().min(1),
  gameTimeSeconds: z.number().nonnegative(),
  nextResetAt: z.number().int().positive(),
  activeEvents: z.array(DayEventSchema).default([]),
});

export type ValidatedGameTime = z.infer<typeof GameTimeSchema>;
export type ValidatedDayEvent = z.infer<typeof DayEventSchema>;
