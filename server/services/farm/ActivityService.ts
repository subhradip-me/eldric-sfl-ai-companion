/**
 * ActivityService — farm activity deltas between two canonical states (design §12).
 * Observed = exact farmActivity counter changes; Inferred = inventory movements.
 */
import type { CanonicalFarmState, ActivityDiff } from '../../types/index.js';

export class ActivityService {
  /** Compute the diff between two consecutive farm snapshots or canonical states. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diff(prevInput: CanonicalFarmState | any, currInput: CanonicalFarmState | any): ActivityDiff {
    const prev: CanonicalFarmState = (prevInput?.data_json ?? prevInput) as CanonicalFarmState;
    const curr: CanonicalFarmState = (currInput?.data_json ?? currInput) as CanonicalFarmState;

    const observed: Record<string, number> = {};
    for (const [k, v] of Object.entries(curr.farmActivity ?? {})) {
      const d = v - (prev.farmActivity?.[k] ?? 0);
      if (d !== 0) observed[k] = d;
    }

    const inferred: Record<string, number> = {};
    const keys = new Set([
      ...Object.keys(prev.inventory ?? {}),
      ...Object.keys(curr.inventory ?? {}),
    ]);
    for (const k of keys) {
      const d = (curr.inventory?.[k] ?? 0) - (prev.inventory?.[k] ?? 0);
      if (Math.abs(d) > 1e-9) inferred[k] = +d.toFixed(4);
    }

    return {
      observed,
      inferred,
      xpDelta: (curr.bumpkin?.xp ?? 0) - (prev.bumpkin?.xp ?? 0),
      from: prev.fetchedAt,
      to: curr.fetchedAt,
    };
  }

  /** Alias for backward compatibility */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diffActivity(prev: any, curr: any): ActivityDiff {
    return this.diff(prev, curr);
  }
}

export const activityService = new ActivityService();
export const diffActivity = (prev: any, curr: any) => activityService.diff(prev, curr);
