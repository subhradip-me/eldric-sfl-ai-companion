/**
 * server/schemas/farmSchema.ts
 * Runtime Zod validation schemas for external Community API payloads.
 * Protects system boundaries against unexpected API shape mutations.
 */

import { z } from 'zod';

/** String or number coerced to number */
const CoercedNumber = z.union([z.number(), z.string()]).transform((val) => {
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
});

/** Bumpkin schema from API */
export const BumpkinApiSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  experience: CoercedNumber.default(0),
  skills: z.record(z.string(), z.union([z.number(), z.boolean()])).default({}),
  equipped: z.record(z.string(), z.string()).default({}),
  achievements: z.record(z.string(), CoercedNumber).optional(),
}).passthrough();

/** Building crafting entry */
export const BuildingCraftingSchema = z.object({
  name: z.string().optional(),
  readyAt: CoercedNumber.default(0),
  amount: CoercedNumber.optional(),
}).passthrough();

/** Building instance from API */
export const BuildingInstanceSchema = z.object({
  readyAt: CoercedNumber.optional(),
  coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
  crafting: z.array(BuildingCraftingSchema).optional(),
  oil: CoercedNumber.optional(),
}).passthrough();

/** Island details */
export const IslandApiSchema = z.object({
  type: z.string().default('basic'),
  previousExpansions: CoercedNumber.default(0),
  ascensionLevel: CoercedNumber.default(0),
  sunstones: CoercedNumber.default(0),
  biome: z.string().optional(),
}).passthrough();

/** Root Community API Farm Object schema */
export const CommunityFarmDataSchema = z.object({
  coins: CoercedNumber.default(0),
  balance: z.union([z.string(), z.number()]).transform(String).default('0'),
  previousBalance: z.union([z.string(), z.number()]).transform(String).optional(),
  inventory: z.record(z.string(), CoercedNumber).default({}),
  previousInventory: z.record(z.string(), CoercedNumber).optional(),
  bumpkin: BumpkinApiSchema.optional(),
  buildings: z.record(z.string(), z.union([z.array(BuildingInstanceSchema), BuildingInstanceSchema])).default({}),
  island: IslandApiSchema.optional(),
  vip: z.union([
    z.boolean(),
    z.object({ expiresAt: CoercedNumber.optional() }).passthrough(),
  ]).optional(),
  crops: z.record(z.string(), z.any()).optional(),
  plots: z.record(z.string(), z.any()).optional(),
  greenhouse: z.record(z.string(), z.any()).optional(),
  delivery: z.record(z.string(), z.any()).optional(),
  choreBoard: z.record(z.string(), z.any()).optional(),
  bounties: z.record(z.string(), z.any()).optional(),
  farmHands: z.record(z.string(), z.any()).optional(),
}).passthrough();

/** Complete API response wrapper envelope */
export const CommunityApiResponseSchema = z.union([
  z.object({
    farm: CommunityFarmDataSchema,
  }).passthrough(),
  CommunityFarmDataSchema,
]);

export type ValidatedCommunityFarm = z.infer<typeof CommunityFarmDataSchema>;
