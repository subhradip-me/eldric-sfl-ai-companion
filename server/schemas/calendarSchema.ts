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
  baseSeason: z.enum(['SPRING', 'SUMMER', 'AUTUMN', 'WINTER']).optional(),
  eventSeason: z.string().optional(),
  gameTimeSeconds: z.number().nonnegative(),
  nextResetAt: z.number().int().positive(),
  activeEvents: z.array(DayEventSchema).default([]),
});

export const SeasonalDeadlineWarningSchema = z.object({
  code: z.enum(['SEASONAL_DEADLINE', 'SEASON_EXPIRED']),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  message: z.string().min(1),
  crop: z.string().optional(),
  daysRemaining: z.number().int(),
  currentSeason: z.string().min(1),
  nextSeason: z.string().optional(),
});

export const SeasonBoundaryAssessmentSchema = z.object({
  currentSeason: z.string().min(1),
  nextSeason: z.string().optional(),
  seasonEndAt: z.number().int().positive(),
  remainingMs: z.number().int(),
  daysRemaining: z.number().int(),
  urgency: z.enum(['NORMAL', 'WARNING', 'CRITICAL', 'EXPIRED']),
  warnings: z.array(SeasonalDeadlineWarningSchema).default([]),
});

export type ValidatedGameTime = z.infer<typeof GameTimeSchema>;
export type ValidatedDayEvent = z.infer<typeof DayEventSchema>;
export type ValidatedSeasonalDeadlineWarning = z.infer<typeof SeasonalDeadlineWarningSchema>;
export type ValidatedSeasonBoundaryAssessment = z.infer<typeof SeasonBoundaryAssessmentSchema>;
