/**
 * FarmNormalizer — raw Community API response → Canonical Farm State (design §8).
 * Pure class, no side effects.
 */
import type { CanonicalFarmState, InventoryMap, SkillMap } from '../../types/index.js';
import levels from '../../data/levels.json' with { type: 'json' };

export class FarmNormalizer {
  /** Derive bumpkin level from cumulative XP using the levels table. */
  levelFromXp(xp: number): number {
    let lvl = 1;
    for (const [level, req] of Object.entries(levels as Record<string, number>)) {
      const l = Number(level);
      if (!Number.isNaN(l) && typeof req === 'number' && xp >= req) lvl = Math.max(lvl, l);
    }
    return lvl;
  }

  /** Convert string/null inventory values to numbers. */
  private num(v: unknown): number {
    return v == null ? 0 : Number(v);
  }

  private normalizeReward(reward: unknown): unknown {
    if (!reward || typeof reward !== 'object') return reward;
    const res = { ...(reward as Record<string, unknown>) };
    if (res['sfl'] != null && res['flower'] == null) {
      res['flower'] = res['sfl'];
    }
    return res;
  }

  /** Convert raw API response into canonical farm state. */
  toCanonical(raw: unknown): CanonicalFarmState {
    const farm = (raw as Record<string, unknown>)['farm'] ?? raw as Record<string, unknown>;
    const f = farm as Record<string, unknown>;
    const bumpkin = (f['bumpkin'] as Record<string, unknown>) ?? {};
    const inventory: InventoryMap = {};
    for (const [k, v] of Object.entries((f['inventory'] as Record<string, unknown>) ?? {})) {
      inventory[k] = this.num(v);
    }
    const buildings: Record<string, { busyUntil: number | null; oil: number }> = {};
    for (const [name, arr] of Object.entries((f['buildings'] as Record<string, unknown>) ?? {})) {
      const b = Array.isArray(arr) ? arr[0] as Record<string, unknown> : arr as Record<string, unknown>;
      const crafting = (b?.['crafting'] as Array<Record<string, number>>) ?? [];
      const busyUntil = crafting.length
        ? Math.max(...crafting.map((c) => c['readyAt'] ?? 0))
        : null;
      buildings[name] = { busyUntil, oil: (b?.['oil'] as number) ?? 0 };
    }
    const xp = this.num((bumpkin as Record<string, unknown>)['experience']);
    const vipObj = f['vip'] as Record<string, number> | boolean | undefined;
    const isVip =
      typeof vipObj === 'object' && vipObj !== null
        ? (vipObj['expiresAt'] ?? 0) > Date.now()
        : false;
    return {
      bumpkin: { level: this.levelFromXp(xp), xp },
      currencies: {
        flower: String(f['balance'] ?? '0'),
        flowerApprox: Number(f['balance'] ?? 0),
        sfl: Number(f['balance'] ?? 0),
        coins: this.num(f['coins']),
      },
      inventory,
      skills: ((bumpkin as Record<string, unknown>)['skills'] as SkillMap) ?? {},
      wearables: ((bumpkin as Record<string, unknown>)['equipped'] as Record<string, string>) ?? {},
      buffs: { vip: isVip, active: Object.keys((f['buffs'] as object) ?? {}) },
      buildings,
      farmActivity: ((f['farmActivity']) as Record<string, number>) ?? {},
      deliveries: ((f['delivery'] as Record<string, unknown>)?.['orders'] as unknown[] ?? []).map((d) => ({
        ...(d as Record<string, unknown>),
        reward: this.normalizeReward((d as Record<string, unknown>)['reward']),
      })) as import('../../types/index.js').DeliveryOrder[],
      chores: Object.fromEntries(
        Object.entries(((f['choreBoard'] as Record<string, unknown>)?.['chores'] as Record<string, unknown>) ?? {}).map(([npc, ch]) => [
          npc,
          { ...(ch as Record<string, unknown>), reward: this.normalizeReward((ch as Record<string, unknown>)['reward']) },
        ])
      ),
      bounties: {
        requests: ((f['bounties'] as Record<string, unknown>)?.['requests'] as unknown[]) ?? [],
        completed: ((f['bounties'] as Record<string, unknown>)?.['completed'] as unknown[]) ?? [],
      },
      fetchedAt: Date.now(),
    };
  }
}

export const farmNormalizer = new FarmNormalizer();
