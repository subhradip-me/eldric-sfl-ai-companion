/**
 * server/services/ai/pipeline/MathHelper.ts
 * Pure deterministic arithmetic and formatting helper for the AI Pipeline.
 *
 * ARCHITECTURAL INVARIANT:
 * Zero arithmetic in LLM tokens. All diffs, shortfalls, surpluses,
 * percentages, and boost-multiplied values are calculated in TypeScript
 * using float-safe rounding.
 */

import type { ResourceDiffRow, ActiveBuffSummary } from './types.js';
import type { ActiveEffect, EffectContext } from '../../../core/effectEngine/effectTypes.js';

export class MathHelper {
  /**
   * Float-safe rounding to specified decimal places (default 4).
   * Prevents IEEE 754 float drift like 129.20000000000005.
   */
  public static roundFloat(val: number, decimals: number = 4): number {
    if (!Number.isFinite(val)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }

  /**
   * Format numbers with clean thousand separators and up to 3 decimals.
   */
  public static formatNumber(val: number): string {
    if (!Number.isFinite(val)) return '0';
    const rounded = this.roundFloat(val, 3);
    return rounded.toLocaleString('en-US', {
      maximumFractionDigits: 3,
      minimumFractionDigits: 0,
    });
  }

  /**
   * Calculate exact resource diffs comparing required amounts against current inventory/coins.
   */
  public static computeResourceDiffs(
    requirements: Record<string, number>,
    inventory: Record<string, number> = {},
    coins: number = 0
  ): { rows: ResourceDiffRow[]; canAfford: boolean } {
    const rows: ResourceDiffRow[] = [];
    let canAfford = true;

    for (const [rawKey, rawNeeded] of Object.entries(requirements)) {
      if (rawNeeded <= 0) continue;
      const keyLower = rawKey.toLowerCase();
      const isCoin = ['coins', 'coin', 'sfl', 'price', 'cost'].includes(keyLower);
      const itemName = isCoin ? 'Coins' : rawKey;
      const needed = this.roundFloat(Number(rawNeeded), 3);

      let stock = 0;
      if (isCoin) {
        stock = this.roundFloat(Number(coins ?? 0), 3);
      } else {
        // Case-insensitive inventory lookup
        const foundKey = Object.keys(inventory).find((k) => k.toLowerCase() === keyLower);
        stock = this.roundFloat(Number(foundKey ? inventory[foundKey] : 0), 3);
      }

      const shortfall = this.roundFloat(Math.max(0, needed - stock), 3);
      const surplus = this.roundFloat(Math.max(0, stock - needed), 3);
      const status = shortfall === 0 ? 'MET' : 'SHORTFALL';

      if (status === 'SHORTFALL') {
        canAfford = false;
      }

      rows.push({
        item: itemName,
        needed,
        stock,
        shortfall,
        surplus,
        status,
        note: shortfall > 0 ? `Need ${this.formatNumber(shortfall)} more` : 'In stock',
      });
    }

    return { rows, canAfford };
  }

  /**
   * Renders a clean, compact markdown table for resource comparisons.
   */
  public static formatDiffTable(rows: ResourceDiffRow[]): string {
    if (!rows || rows.length === 0) return '';

    const lines = [
      '| Requirement | Needed | In Stock | Shortfall | Status |',
      '| :--- | :--- | :--- | :--- | :--- |',
    ];

    for (const r of rows) {
      const statusIcon = r.status === 'MET' ? '✅ MET' : '❌ SHORTFALL';
      lines.push(
        `| **${r.item}** | ${this.formatNumber(r.needed)} | ${this.formatNumber(r.stock)} | ${r.shortfall > 0 ? `**${this.formatNumber(r.shortfall)}**` : '0'} | ${statusIcon} |`
      );
    }

    return lines.join('\n');
  }

  /**
   * Factor in active boosters, skills, wearables, and collectibles.
   * Modifies base values (xp, cookTime, yield, cost) deterministically.
   */
  public static applyBoosters(
    itemName: string,
    baseValues: { xp?: number; cookTime?: number; yield?: number; cost?: number },
    activeEffects: ActiveEffect[] = [],
    buildingName?: string
  ): {
    boostedValues: {
      effectiveCookTime?: number;
      effectiveFoodXp?: number;
      effectiveYield?: number;
      effectiveCost?: number;
    };
    activeBuffs: ActiveBuffSummary[];
    buffsImpactText: string;
  } {
    const activeBuffs: ActiveBuffSummary[] = [];
    const lowerItem = itemName.toLowerCase();
    const lowerBuilding = (buildingName ?? '').toLowerCase();

    let xpMultiplier = 1.0;
    let flatXp = 0;
    let cookTimeMultiplier = 1.0;
    let yieldMultiplier = 1.0;
    let yieldAddition = 0;
    let costMultiplier = 1.0;

    for (const eff of activeEffects) {
      if (!eff.active) continue;

      let applies = false;
      let effectDescription = eff.description;

      // 1. XP Domain
      if (eff.domain === 'xp') {
        if (eff.target === 'global' || eff.target === 'food') {
          applies = true;
          if (eff.operation === 'multiply' && typeof eff.value === 'number') {
            xpMultiplier *= eff.value;
          } else if (eff.operation === 'add' && typeof eff.value === 'number') {
            flatXp += eff.value;
          }
        } else if (lowerBuilding && eff.target.toLowerCase() === lowerBuilding) {
          applies = true;
          if (eff.operation === 'multiply' && typeof eff.value === 'number') {
            xpMultiplier *= eff.value;
          }
        }
      }

      // 2. Cooking Domain
      if (eff.domain === 'cooking') {
        if (eff.target === 'global') {
          applies = true;
          if (eff.operation === 'multiply' && typeof eff.value === 'number') {
            cookTimeMultiplier *= eff.value;
          }
        } else if (eff.target === 'output' && eff.operation === 'multiply' && typeof eff.value === 'number') {
          applies = true;
          yieldMultiplier *= eff.value;
        } else if (eff.target === 'cost' && eff.operation === 'multiply' && typeof eff.value === 'number') {
          applies = true;
          costMultiplier *= eff.value;
        } else if (lowerBuilding && eff.target.toLowerCase() === lowerBuilding) {
          applies = true;
          if (eff.operation === 'multiply' && typeof eff.value === 'number') {
            cookTimeMultiplier *= eff.value;
          }
        }
      }

      // 3. Crops & Resources Domain
      if (eff.domain === 'crops' || eff.domain === 'resources') {
        if (eff.target.toLowerCase() === lowerItem || eff.target === 'global') {
          applies = true;
          if (eff.operation === 'multiply' && typeof eff.value === 'number') {
            yieldMultiplier *= eff.value;
          } else if (eff.operation === 'add' && typeof eff.value === 'number') {
            yieldAddition += eff.value;
          }
        }
      }

      if (applies) {
        activeBuffs.push({
          sourceId: eff.sourceId,
          sourceType: eff.sourceType,
          description: eff.description,
          effectText: `${eff.operation === 'multiply' ? `${eff.value}x` : `+${eff.value}`} (${eff.domain}.${eff.target})`,
        });
      }
    }

    const boostedValues: {
      effectiveCookTime?: number;
      effectiveFoodXp?: number;
      effectiveYield?: number;
      effectiveCost?: number;
    } = {};

    if (baseValues.cookTime !== undefined) {
      boostedValues.effectiveCookTime = this.roundFloat(baseValues.cookTime * cookTimeMultiplier, 2);
    }

    if (baseValues.xp !== undefined) {
      boostedValues.effectiveFoodXp = this.roundFloat(baseValues.xp * xpMultiplier + flatXp, 2);
    }

    if (baseValues.yield !== undefined) {
      boostedValues.effectiveYield = this.roundFloat(baseValues.yield * yieldMultiplier + yieldAddition, 2);
    }

    if (baseValues.cost !== undefined) {
      boostedValues.effectiveCost = this.roundFloat(baseValues.cost * costMultiplier, 3);
    }

    const impactSnippets: string[] = [];
    if (xpMultiplier > 1.0 || flatXp > 0) {
      const pct = Math.round((xpMultiplier - 1) * 100);
      impactSnippets.push(`XP Boost: +${pct}%${flatXp > 0 ? ` +${flatXp} flat XP` : ''}`);
    }
    if (cookTimeMultiplier < 1.0) {
      const pct = Math.round((1 - cookTimeMultiplier) * 100);
      impactSnippets.push(`Cook Speed: -${pct}% time`);
    }
    if (yieldMultiplier > 1.0 || yieldAddition > 0) {
      impactSnippets.push(`Yield: ${yieldMultiplier}x ${yieldAddition > 0 ? `+${yieldAddition}` : ''}`);
    }

    const buffsImpactText = impactSnippets.length > 0
      ? `Active Boosters Applied: ${impactSnippets.join(', ')} (Sources: ${activeBuffs.map((b) => b.sourceId).join(', ')})`
      : 'No active boosters affecting this action.';

    return {
      boostedValues,
      activeBuffs,
      buffsImpactText,
    };
  }
}
