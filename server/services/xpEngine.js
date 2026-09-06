// BASE -> EFFECTIVE (design §14). Pure module, no deps.
export function effective(recipeName, recipe, farm, modifiers) {
  let output = recipe.baseOutput;
  let xpPerFood = recipe.baseXp;
  let minutes = recipe.baseCookMinutes;
  const applied = [];
  for (const [name, mod] of Object.entries(modifiers)) {
    if (name.startsWith("_") || !farm.skills?.[name]) continue;
    const scope = mod.appliesTo;
    const inScope = scope === "food" || (Array.isArray(scope) && scope.includes(recipe.building));
    if (!inScope) continue;
    if (mod.effect === "outputMultiplier") output *= mod.value;
    else if (mod.effect === "cookTimeMultiplier") minutes *= mod.value;
    else if (mod.effect === "xpMultiplier" && !recipe.xpIncludesSkills) xpPerFood *= mod.value;
    else continue;
    applied.push(name);
  }
  return { recipe: recipeName, output, xpPerFood, minutes, batchXp: output * xpPerFood, applied };
}
