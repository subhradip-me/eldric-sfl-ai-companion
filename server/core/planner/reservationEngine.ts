/**
 * server/core/planner/reservationEngine.ts
 * Pure deterministic resource reservation and temporal availability engine.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. availableNow is strictly separated from inProduction and projectedAvailable.
 * 2. ResourceLedger maintains independent per-resource accounting.
 * 3. checkImmediateActionPermitted protects current reserves.
 * 4. checkFutureActionPermitted validates pipeline satisfaction.
 */

import type {
  NormalizedFarmState,
  ResourceCommitment,
  ResourceLedger,
  ActionPermissionResult,
} from '../../domain/index.js';

export interface CalculateCommitmentParams {
  owned: number;
  inProduction?: number;
  reservedForTomorrow?: number;
  phaseReserve?: number;
}

export interface BuildResourceLedgerParams {
  state: NormalizedFarmState;
  tomorrowRequirements?: Record<string, number>;
  phaseRequirements?: Record<string, number>;
}

/**
 * Calculate a single resource commitment with strict temporal separation.
 */
export function calculateResourceCommitment(params: CalculateCommitmentParams): ResourceCommitment {
  const owned = Math.max(0, params.owned ?? 0);
  const inProduction = Math.max(0, params.inProduction ?? 0);
  const reservedForTomorrow = Math.max(0, params.reservedForTomorrow ?? 0);
  const phaseReserve = Math.max(0, params.phaseReserve ?? 0);

  const availableNow = Math.max(0, owned - reservedForTomorrow - phaseReserve);
  const projectedAvailable = Math.max(0, owned + inProduction - reservedForTomorrow - phaseReserve);

  return {
    owned,
    inProduction,
    reservedForTomorrow,
    phaseReserve,
    availableNow,
    projectedAvailable,
    discretionary: availableNow, // Backward compatible alias
  };
}

/**
 * Build a complete ResourceLedger for all inventory items, active production, and FLOWER balance.
 */
export function buildResourceLedger(params: BuildResourceLedgerParams): ResourceLedger {
  const { state, tomorrowRequirements = {}, phaseRequirements = {} } = params;
  const ledger: ResourceLedger = {};

  // 1. FLOWER commitment
  let flowerOwned = state.economy?.flowerApprox ?? 0;
  if (!flowerOwned && (state as any).farm?.balance) {
    flowerOwned = parseFloat((state as any).farm.balance) || 0;
  } else if (!flowerOwned && (state as any).balance) {
    flowerOwned = parseFloat((state as any).balance) || 0;
  }
  const flowerTomorrow = tomorrowRequirements['FLOWER'] ?? 0;
  const flowerPhase = phaseRequirements['FLOWER'] ?? 0;
  ledger['FLOWER'] = calculateResourceCommitment({
    owned: flowerOwned,
    inProduction: 0,
    reservedForTomorrow: flowerTomorrow,
    phaseReserve: flowerPhase,
  });

  // 2. Aggregate active production by item
  const productionYields: Record<string, number> = {};
  const activeProduction = state.production?.active ?? (state as any).activeProduction ?? [];
  for (const prod of activeProduction) {
    if (prod.status !== 'CANCELLED') {
      const yieldAmount = prod.expectedOutput ?? prod.quantity ?? 1;
      productionYields[prod.item] = (productionYields[prod.item] ?? 0) + yieldAmount;
    }
  }

  // Handle raw crop plot fixtures if present
  const rawPlots = (state as any).crops?.activePlots ?? (state as any).farm?.crops?.activePlots;
  if (rawPlots && rawPlots.crop) {
    const plotCrop = rawPlots.crop;
    const yieldAmount = rawPlots.expectedYield ?? rawPlots.count ?? 0;
    productionYields[plotCrop] = (productionYields[plotCrop] ?? 0) + yieldAmount;
  }

  // 3. Union of all item keys across inventory, production, and requirements
  const inventoryAll = state.inventory?.all ?? (state as any).farm?.inventory ?? (state as any).inventory ?? {};
  const allKeys = new Set<string>([
    ...Object.keys(inventoryAll),
    ...Object.keys(productionYields),
    ...Object.keys(tomorrowRequirements),
    ...Object.keys(phaseRequirements),
  ]);

  for (const item of allKeys) {
    if (item === 'FLOWER') continue;

    const owned = inventoryAll[item] ?? 0;
    const inProduction = productionYields[item] ?? 0;
    const reservedForTomorrow = tomorrowRequirements[item] ?? 0;
    const phaseReserve = phaseRequirements[item] ?? 0;

    if (owned === 0 && inProduction === 0 && reservedForTomorrow === 0 && phaseReserve === 0) {
      continue;
    }

    ledger[item] = calculateResourceCommitment({
      owned,
      inProduction,
      reservedForTomorrow,
      phaseReserve,
    });
  }

  return ledger;
}

/**
 * Check whether an immediate action is permitted given current availableNow reserves.
 * Supports:
 *   checkImmediateActionPermitted(quantity, commitment)
 *   checkImmediateActionPermitted(resource, quantity, ledger)
 */
export function checkImmediateActionPermitted(
  arg1: number | string,
  arg2: ResourceCommitment | number,
  arg3?: ResourceLedger
): ActionPermissionResult {
  let quantity: number;
  let commitment: ResourceCommitment;
  let resourceName = 'resource';

  if (typeof arg1 === 'number') {
    quantity = arg1;
    commitment = arg2 as ResourceCommitment;
  } else {
    resourceName = arg1;
    quantity = arg2 as number;
    const ledger = arg3 ?? {};
    commitment = ledger[resourceName] ?? calculateResourceCommitment({ owned: 0 });
  }

  if (quantity <= commitment.availableNow) {
    return {
      actionPermitted: true,
    };
  }

  const shortfall = quantity - commitment.availableNow;
  const reason = `Spending ${quantity} ${resourceName} exceeds discretionary balance (${commitment.availableNow} ${resourceName}) and consumes ${shortfall} ${resourceName} from tomorrow's required reserve (${commitment.reservedForTomorrow} ${resourceName}).`;

  return {
    actionPermitted: false,
    shortfall,
    message: reason,
  };
}

/**
 * Check whether a future action is permitted given projected pipeline availability.
 * Supports:
 *   checkFutureActionPermitted(quantity, commitment)
 *   checkFutureActionPermitted(resource, quantity, ledger)
 */
export function checkFutureActionPermitted(
  arg1: number | string,
  arg2: ResourceCommitment | number,
  arg3?: ResourceLedger
): ActionPermissionResult {
  let quantity: number;
  let commitment: ResourceCommitment;
  let resourceName = 'resource';

  if (typeof arg1 === 'number') {
    quantity = arg1;
    commitment = arg2 as ResourceCommitment;
  } else {
    resourceName = arg1;
    quantity = arg2 as number;
    const ledger = arg3 ?? {};
    commitment = ledger[resourceName] ?? calculateResourceCommitment({ owned: 0 });
  }

  if (quantity <= commitment.projectedAvailable) {
    return {
      actionPermitted: true,
    };
  }

  const shortfall = quantity - commitment.projectedAvailable;
  const reason = `Required ${quantity} ${resourceName} exceeds projected available (${commitment.projectedAvailable} ${resourceName}) by ${shortfall}.`;

  return {
    actionPermitted: false,
    shortfall,
    message: reason,
  };
}
