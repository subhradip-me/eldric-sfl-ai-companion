// BASE -> EFFECTIVE (design §14). Pure module.
import skillsCatalogue from "../data/skills.json" with { type: "json" };

const FISH_ITEMS = new Set([
  "Anchovy", "Tuna", "Clownfish", "Blowfish", "Sea Bass", "Halibut", "Porgy",
  "Muskellunge", "Trout", "Napoleanfish", "Tilapia", "Surgeonfish", "Walleye",
  "Rock Blackfish", "Saw Shark", "Hammerhead shark", "Angelfish", "Ray", "Sunfish",
  "Blue Marlin", "Olive Flounder", "Fish Stick", "Fish Flake", "Fish Oil", "Crab Stick", "Crab"
]);

export function effective(recipeName, recipe, farm = {}, customModifiers = {}) {
  let output = recipe.baseOutput ?? 1;
  let xpPerFood = recipe.baseXp ?? 0;
  let minutes = recipe.baseCookMinutes ?? 0;
  let ingredientMultiplier = 1;
  const applied = [];
  const boostBreakdown = [];

  const farmSkills = farm.skills ?? {};
  const hasSkill = (name) => !!farmSkills[name];
  const getRank = (name) => (typeof farmSkills[name] === "number" ? farmSkills[name] : 1);

  const hasFish = Object.keys(recipe.ingredients ?? {}).some((ing) => FISH_ITEMS.has(ing));
  const hasHoney = !!recipe.ingredients?.["Honey"];
  const bldOil = farm.buildings?.[recipe.building]?.oil ?? 0;
  const oilActive = bldOil > 0;

  // ── 1. XP Multipliers ──────────────────────────────────────────────────────────
  // VIP Access: +10% bumpkin XP on each consumable (all cooking buildings + fish) (multiplicative)
  const isVip =
    farm.buffs?.vip === true ||
    farm.vip === true ||
    farm.isVip === true ||
    (typeof farm.vip === "object" && (farm.vip?.expiresAt ?? 0) > Date.now());

  if (isVip && !recipe.xpIncludesSkills) {
    xpPerFood *= 1.1;
    applied.push("VIP Access");
    boostBreakdown.push({ skill: "VIP Access", rank: 1, label: "+10% VIP Access" });
  }

  // Munching Mastery: +5% (Rank 1), +7.5% (Rank 2), +10% (Rank 3) on ALL food XP
  if (hasSkill("Munching Mastery") && !recipe.xpIncludesSkills) {
    const rank = getRank("Munching Mastery");
    const mult = 1 + 0.05 + (rank - 1) * 0.025;
    xpPerFood *= mult;
    applied.push("Munching Mastery");
    boostBreakdown.push({ skill: "Munching Mastery", rank, label: `+${((mult - 1) * 100).toFixed(1).replace(/\.0$/, "")}% XP` });
  }

  // Drive-Through Deli: +15% (Rank 1), +20% (Rank 2), +25% (Rank 3) on Deli food XP
  if (recipe.building === "Deli" && hasSkill("Drive-Through Deli") && !recipe.xpIncludesSkills) {
    const rank = getRank("Drive-Through Deli");
    const mult = 1 + 0.15 + (rank - 1) * 0.05;
    xpPerFood *= mult;
    applied.push("Drive-Through Deli");
    boostBreakdown.push({ skill: "Drive-Through Deli", rank, label: `+${((mult - 1) * 100).toFixed(0)}% Deli XP` });
  }

  // Juicy Boost: +10% (Rank 1), +15% (Rank 2), +20% (Rank 3) on Smoothie Shack drinks XP
  if (recipe.building === "Smoothie Shack" && hasSkill("Juicy Boost") && !recipe.xpIncludesSkills) {
    const rank = getRank("Juicy Boost");
    const mult = 1 + 0.10 + (rank - 1) * 0.05;
    xpPerFood *= mult;
    applied.push("Juicy Boost");
    boostBreakdown.push({ skill: "Juicy Boost", rank, label: `+${((mult - 1) * 100).toFixed(0)}% Smoothie XP` });
  }

  // Fishy Feast: +20% XP on fish-ingredient food
  if (hasFish && hasSkill("Fishy Feast") && !recipe.xpIncludesSkills) {
    xpPerFood *= 1.2;
    applied.push("Fishy Feast");
    boostBreakdown.push({ skill: "Fishy Feast", rank: 1, label: "+20% Fish Food XP" });
  }

  // Buzzworthy Treats: +10% XP on honey-ingredient food
  if (hasHoney && hasSkill("Buzzworthy Treats") && !recipe.xpIncludesSkills) {
    xpPerFood *= 1.1;
    applied.push("Buzzworthy Treats");
    boostBreakdown.push({ skill: "Buzzworthy Treats", rank: 1, label: "+10% Honey Food XP" });
  }

  // ── 2. Cook Time Multipliers ──────────────────────────────────────────────────
  // Fast Feasts: -10% (Rank 1), -15% (Rank 2), -20% (Rank 3) cook time on Fire Pit & Kitchen
  if (["Fire Pit", "Kitchen"].includes(recipe.building) && hasSkill("Fast Feasts")) {
    const rank = getRank("Fast Feasts");
    const mult = 1 - (0.10 + (rank - 1) * 0.05);
    minutes *= mult;
    applied.push("Fast Feasts");
    boostBreakdown.push({ skill: "Fast Feasts", rank, label: `-${((1 - mult) * 100).toFixed(0)}% Cook Time` });
  }

  // Frosted Cakes: -10% (Rank 1), -15% (Rank 2), -20% (Rank 3) cook time on Bakery
  if (recipe.building === "Bakery" && hasSkill("Frosted Cakes")) {
    const rank = getRank("Frosted Cakes");
    const mult = 1 - (0.10 + (rank - 1) * 0.05);
    minutes *= mult;
    applied.push("Frosted Cakes");
    boostBreakdown.push({ skill: "Frosted Cakes", rank, label: `-${((1 - mult) * 100).toFixed(0)}% Cook Time` });
  }

  // Swift Sizzle: -40% cook time on Fire Pit (when oil active)
  if (recipe.building === "Fire Pit" && hasSkill("Swift Sizzle") && oilActive) {
    minutes *= 0.6;
    applied.push("Swift Sizzle");
    boostBreakdown.push({ skill: "Swift Sizzle", rank: 1, label: "-40% Oil Cook Time" });
  }

  // Turbo Fry: -50% cook time on Kitchen (when oil active)
  if (recipe.building === "Kitchen" && hasSkill("Turbo Fry") && oilActive) {
    minutes *= 0.5;
    applied.push("Turbo Fry");
    boostBreakdown.push({ skill: "Turbo Fry", rank: 1, label: "-50% Oil Cook Time" });
  }

  // Fry Frenzy: -60% cook time on Deli (when oil active)
  if (recipe.building === "Deli" && hasSkill("Fry Frenzy") && oilActive) {
    minutes *= 0.4;
    applied.push("Fry Frenzy");
    boostBreakdown.push({ skill: "Fry Frenzy", rank: 1, label: "-60% Oil Cook Time" });
  }

  // ── 3. Output & Ingredient Multipliers ────────────────────────────────────────
  // Double Nom: 2x food output, 2x ingredients required across all cooking buildings
  if (hasSkill("Double Nom")) {
    output *= 2;
    ingredientMultiplier *= 2;
    applied.push("Double Nom");
    boostBreakdown.push({ skill: "Double Nom", rank: 1, label: "2x Output & Ingredients" });
  }

  // ── 4. Custom Modifiers fallback (for tests and extra mod overrides) ───────────
  if (customModifiers && typeof customModifiers === "object") {
    for (const [name, mod] of Object.entries(customModifiers)) {
      if (name.startsWith("_") || !farmSkills[name] || applied.includes(name)) continue;
      const scope = mod.appliesTo;
      const inScope = scope === "food" || (Array.isArray(scope) && scope.includes(recipe.building));
      if (!inScope) continue;
      if (mod.condition === "fishIngredient" && !hasFish) continue;
      if (mod.condition === "honeyIngredient" && !hasHoney) continue;
      if (mod.condition === "oilActive" && !oilActive) continue;

      let matched = false;
      if (mod.effect === "outputMultiplier") { output *= mod.value; matched = true; }
      if (mod.effect === "cookTimeMultiplier") { minutes *= mod.value; matched = true; }
      if (mod.effect === "xpMultiplier" && !recipe.xpIncludesSkills) { xpPerFood *= mod.value; matched = true; }
      if (mod.ingredientCostMultiplier) { ingredientMultiplier *= mod.ingredientCostMultiplier; matched = true; }
      if (matched && !applied.includes(name)) {
        applied.push(name);
        boostBreakdown.push({ skill: name, rank: getRank(name), label: mod.label ?? name });
      }
    }
  }

  // Compute effective ingredient quantities after skill multipliers
  const effectiveIngredients = {};
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
