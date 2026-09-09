/**
 * XpEngine — base → effective recipe stats (design §14).
 * Applies bumpkin skills, VIP boost, oil multipliers, and custom modifiers.
 * Pure class, no I/O.
 */
import type {
  RecipeDefinition,
  EffectiveRecipe,
  CanonicalFarmState,
} from '../../types/index.js';
import skillsCatalogue from '../../data/skills.json' with { type: 'json' };

const FISH_ITEMS = new Set([
  'Anchovy', 'Tuna', 'Clownfish', 'Blowfish', 'Sea Bass', 'Halibut', 'Porgy',
  'Muskellunge', 'Trout', 'Napoleanfish', 'Tilapia', 'Surgeonfish', 'Walleye',
  'Rock Blackfish', 'Saw Shark', 'Hammerhead shark', 'Angelfish', 'Ray', 'Sunfish',
  'Blue Marlin', 'Olive Flounder', 'Fish Stick', 'Fish Flake', 'Fish Oil', 'Crab Stick', 'Crab',
]);

export class XpEngine {
  /**
   * Compute effective (skill-adjusted) stats for a single recipe.
   * @param recipeName  - recipe key in recipes.json
   * @param recipe      - RecipeDefinition from recipes.json
   * @param farm        - canonical farm state (for skills, buildings, VIP)
   * @param customModifiers - optional extra modifiers from modifiers.json
   */
  effective(
    recipeName: string,
    recipe: RecipeDefinition,
    farm: Partial<CanonicalFarmState> = {},
    customModifiers: Record<string, unknown> = {}
  ): EffectiveRecipe {
    let output = recipe.baseOutput ?? 1;
    let xpPerFood = recipe.baseXp ?? 0;
    let minutes = recipe.baseCookMinutes ?? 0;
    let ingredientMultiplier = 1;
    const applied: string[] = [];
    const boostBreakdown: EffectiveRecipe['boostBreakdown'] = [];

    const farmSkills = (farm.skills ?? {}) as Record<string, number | boolean>;
    const hasSkill = (name: string) => !!farmSkills[name];
    const getRank = (name: string) =>
      typeof farmSkills[name] === 'number' ? (farmSkills[name] as number) : 1;

    const hasFish = Object.keys(recipe.ingredients ?? {}).some((ing) => FISH_ITEMS.has(ing));
    const hasHoney = !!(recipe.ingredients?.['Honey']);
    const bldOil = (farm.buildings?.[recipe.building]?.oil ?? 0);
    const oilActive = bldOil > 0;

    // ── 1. XP Multipliers ──────────────────────────────────────────────────
    const vipObj = farm.buffs;
    const isVip = vipObj?.vip === true;

    if (isVip && !recipe.xpIncludesSkills) {
      xpPerFood *= 1.1;
      applied.push('VIP Access');
      boostBreakdown.push({ skill: 'VIP Access', rank: 1, label: '+10% VIP Access' });
    }

    if (hasSkill('Munching Mastery') && !recipe.xpIncludesSkills) {
      const rank = getRank('Munching Mastery');
      const mult = 1 + 0.05 + (rank - 1) * 0.025;
      xpPerFood *= mult;
      applied.push('Munching Mastery');
      boostBreakdown.push({ skill: 'Munching Mastery', rank, label: `+${((mult - 1) * 100).toFixed(1).replace(/\.0$/, '')}% XP` });
    }

    if (recipe.building === 'Deli' && hasSkill('Drive-Through Deli') && !recipe.xpIncludesSkills) {
      const rank = getRank('Drive-Through Deli');
      const mult = 1 + 0.15 + (rank - 1) * 0.05;
      xpPerFood *= mult;
      applied.push('Drive-Through Deli');
      boostBreakdown.push({ skill: 'Drive-Through Deli', rank, label: `+${((mult - 1) * 100).toFixed(0)}% Deli XP` });
    }

    if (recipe.building === 'Smoothie Shack' && hasSkill('Juicy Boost') && !recipe.xpIncludesSkills) {
      const rank = getRank('Juicy Boost');
      const mult = 1 + 0.10 + (rank - 1) * 0.05;
      xpPerFood *= mult;
      applied.push('Juicy Boost');
      boostBreakdown.push({ skill: 'Juicy Boost', rank, label: `+${((mult - 1) * 100).toFixed(0)}% Smoothie XP` });
    }

    if (hasFish && hasSkill('Fishy Feast') && !recipe.xpIncludesSkills) {
      xpPerFood *= 1.2;
      applied.push('Fishy Feast');
      boostBreakdown.push({ skill: 'Fishy Feast', rank: 1, label: '+20% Fish Food XP' });
    }

    if (hasHoney && hasSkill('Buzzworthy Treats') && !recipe.xpIncludesSkills) {
      xpPerFood *= 1.1;
      applied.push('Buzzworthy Treats');
      boostBreakdown.push({ skill: 'Buzzworthy Treats', rank: 1, label: '+10% Honey Food XP' });
    }

    // ── 2. Cook Time Multipliers ───────────────────────────────────────────
    if (['Fire Pit', 'Kitchen'].includes(recipe.building) && hasSkill('Fast Feasts')) {
      const rank = getRank('Fast Feasts');
      const mult = 1 - (0.10 + (rank - 1) * 0.05);
      minutes *= mult;
      applied.push('Fast Feasts');
      boostBreakdown.push({ skill: 'Fast Feasts', rank, label: `-${((1 - mult) * 100).toFixed(0)}% Cook Time` });
    }

    if (recipe.building === 'Bakery' && hasSkill('Frosted Cakes')) {
      const rank = getRank('Frosted Cakes');
      const mult = 1 - (0.10 + (rank - 1) * 0.05);
      minutes *= mult;
      applied.push('Frosted Cakes');
      boostBreakdown.push({ skill: 'Frosted Cakes', rank, label: `-${((1 - mult) * 100).toFixed(0)}% Cook Time` });
    }

    if (recipe.building === 'Fire Pit' && hasSkill('Swift Sizzle') && oilActive) {
      minutes *= 0.6;
      applied.push('Swift Sizzle');
      boostBreakdown.push({ skill: 'Swift Sizzle', rank: 1, label: '-40% Oil Cook Time' });
    }

    if (recipe.building === 'Kitchen' && hasSkill('Turbo Fry') && oilActive) {
      minutes *= 0.5;
      applied.push('Turbo Fry');
      boostBreakdown.push({ skill: 'Turbo Fry', rank: 1, label: '-50% Oil Cook Time' });
    }

    if (recipe.building === 'Deli' && hasSkill('Fry Frenzy') && oilActive) {
      minutes *= 0.4;
      applied.push('Fry Frenzy');
      boostBreakdown.push({ skill: 'Fry Frenzy', rank: 1, label: '-60% Oil Cook Time' });
    }

    // ── 3. Output & Ingredient Multipliers ────────────────────────────────
    if (hasSkill('Double Nom')) {
      output *= 2;
      ingredientMultiplier *= 2;
      applied.push('Double Nom');
      boostBreakdown.push({ skill: 'Double Nom', rank: 1, label: '2x Output & Ingredients' });
    }

    // ── 4. Custom Modifiers fallback ──────────────────────────────────────
    if (customModifiers && typeof customModifiers === 'object') {
      for (const [name, mod] of Object.entries(customModifiers)) {
        if (name.startsWith('_') || !farmSkills[name] || applied.includes(name)) continue;
        const m = mod as Record<string, unknown>;
        const scope = m['appliesTo'];
        const inScope = scope === 'food' || (Array.isArray(scope) && scope.includes(recipe.building));
        if (!inScope) continue;
        if (m['condition'] === 'fishIngredient' && !hasFish) continue;
        if (m['condition'] === 'honeyIngredient' && !hasHoney) continue;
        if (m['condition'] === 'oilActive' && !oilActive) continue;

        let matched = false;
        if (m['effect'] === 'outputMultiplier') { output *= m['value'] as number; matched = true; }
        if (m['effect'] === 'cookTimeMultiplier') { minutes *= m['value'] as number; matched = true; }
        if (m['effect'] === 'xpMultiplier' && !recipe.xpIncludesSkills) { xpPerFood *= m['value'] as number; matched = true; }
        if (m['ingredientCostMultiplier']) { ingredientMultiplier *= m['ingredientCostMultiplier'] as number; matched = true; }
        if (matched && !applied.includes(name)) {
          applied.push(name);
          boostBreakdown.push({ skill: name, rank: getRank(name), label: (m['label'] as string) ?? name });
        }
      }
    }

    const effectiveIngredients: Record<string, number> = {};
    for (const [ing, qty] of Object.entries(recipe.ingredients ?? {})) {
      effectiveIngredients[ing] = qty * ingredientMultiplier;
    }

    return {
      recipe: recipeName,
      output,
      xpPerFood,
      minutes,
      batchXp: output * xpPerFood,
      ingredientMultiplier,
      effectiveIngredients,
      applied,
      boostBreakdown,
    };
  }
}

// Suppress unused import warning for skillsCatalogue (used by orchestrator at runtime)
void (skillsCatalogue as unknown);

export const xpEngine = new XpEngine();
