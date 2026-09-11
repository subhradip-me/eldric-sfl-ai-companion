/**
 * server/core/historyEngine/observedEventExtractor.ts
 * Extracts authoritative OBSERVED events directly supported by state structures.
 *
 * Invariant: Only directly evidenced state facts qualify as OBSERVED.
 * Never elevates an inferred action or heuristic guess to OBSERVED.
 */

import type { NormalizedFarmState } from '../../domain/state.js';
import type { ObservedEvent } from '../../domain/history.js';
import type { DerivedDelta } from './deltaCalculator.js';

/**
 * Extracts directly evidenced events from state transitions.
 */
export function extractObservedEvents(
  fromState: NormalizedFarmState,
  toState: NormalizedFarmState,
  delta: DerivedDelta
): ObservedEvent[] {
  const events: ObservedEvent[] = [];
  const timestamp = delta.toTimestamp;
  let eventCounter = 1;

  // 1. SKILL_UNLOCK (Direct state fact: new skill keys in player.skills)
  for (const skill of delta.newSkills) {
    events.push({
      kind: 'OBSERVED',
      id: `obs_skill_${delta.toVersion}_${eventCounter++}`,
      type: 'SKILL_UNLOCK',
      timestamp,
      item: skill,
      quantity: 1,
      metadata: {
        skillLevel: toState.player.skills?.[skill],
      },
    });
  }

  // 2. EXPAND (Direct state fact: expansion counter increment)
  if (delta.newExpansionsCount > 0) {
    events.push({
      kind: 'OBSERVED',
      id: `obs_expand_${delta.toVersion}_${eventCounter++}`,
      type: 'EXPAND',
      timestamp,
      quantity: delta.newExpansionsCount,
      metadata: {
        totalExpansions: toState.progression?.expansions,
      },
    });
  }

  // 3. DELIVERY_COMPLETE (Direct state fact: completed deliveries increment)
  const prevDeliveryCount = (fromState.deliveries?.orders ?? []).filter((o) => o.completedAt != null).length;
  const currDeliveryCount = (toState.deliveries?.orders ?? []).filter((o) => o.completedAt != null).length;
  if (currDeliveryCount > prevDeliveryCount) {
    const completedDiff = currDeliveryCount - prevDeliveryCount;
    events.push({
      kind: 'OBSERVED',
      id: `obs_delivery_${delta.toVersion}_${eventCounter++}`,
      type: 'DELIVERY_COMPLETE',
      timestamp,
      quantity: completedDiff,
      metadata: {
        totalCompleted: currDeliveryCount,
      },
    });
  }


  // 4. BUILD (Direct state fact: new buildings constructed)
  const prevBuildings = new Set(Object.keys(fromState.structures?.buildings ?? {}));
  const currBuildings = toState.structures?.buildings ?? {};
  for (const [buildingName, buildingData] of Object.entries(currBuildings)) {
    if (!prevBuildings.has(buildingName)) {
      events.push({
        kind: 'OBSERVED',
        id: `obs_build_${delta.toVersion}_${eventCounter++}`,
        type: 'BUILD',
        timestamp,
        item: buildingName,
        quantity: 1,
        metadata: {
          buildingData,
        },
      });
    }
  }

  return events;
}
