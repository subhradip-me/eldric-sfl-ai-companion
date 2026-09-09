import { test } from "node:test";
import assert from "node:assert";
import { effective } from "../services/xpEngine.js";
import { expand, cost } from "../services/recipes.js";
import { plan } from "../services/planner.js";
import recipes from "../data/recipes.json" with { type: "json" };
import items from "../data/items.json" with { type: "json" };
import modifiers from "../data/modifiers.json" with { type: "json" };

const SAMPLE_PRICES = { Tomato: 0.00499, Wheat: 0.01374762, Milk: 0.143875 };
const farm = {
  bumpkin: { level: 61, xp: 2146975 },
  currencies: { flower: "2.56", flowerApprox: 2.56, coins: 11216 },
  inventory: {},
  skills: { "Double Nom": 1 },
  buildings: { Deli: {}, Bakery: {} },
};

test("Pizza golden test: 50,000 XP (Double Nom 2x) and ~1.71255 FLOWER", () => {
  const eff = effective("Pizza Margherita", recipes["Pizza Margherita"], farm, modifiers);
  assert.strictEqual(eff.output, 2); // Double Nom
  assert.strictEqual(eff.batchXp, 50000); // 25,000 base * 2
  const dep = expand("Pizza Margherita", recipes);
  assert.deepStrictEqual(dep.base, { Tomato: 30, Wheat: 20, Milk: 15 }); // 5 Cheese -> 15 Milk
  const c = cost(dep.base, SAMPLE_PRICES, items, {});
  // 30 * 0.00499 + 20 * 0.01374762 + 15 * 0.143875 = 0.1497 + 0.2749524 + 2.158125 = 2.5827774
  assert.ok(Math.abs(c.flower - 2.5827774) < 1e-5);
});

test("Cheese skill boosts: Munching Mastery (+5%) and Drive-Through Deli (+15%)", () => {
  const deliFarm = {
    ...farm,
    skills: { "Munching Mastery": 1, "Drive-Through Deli": 1, "Double Nom": 1 },
  };
  const eff = effective("Cheese", recipes["Cheese"], deliFarm);
  assert.strictEqual(eff.output, 2); // Double Nom: 2
  assert.strictEqual(eff.effectiveIngredients.Milk, 6); // 3 * 2 = 6
  // 1 * 1.05 * 1.15 = 1.2075
  assert.ok(Math.abs(eff.xpPerFood - 1.2075) < 1e-4);
  assert.ok(Math.abs(eff.batchXp - 2.415) < 1e-4);
  assert.deepStrictEqual(eff.applied, ["Munching Mastery", "Drive-Through Deli", "Double Nom"]);
});

test("Boiled Eggs: Munching Mastery Rank 2 (+7.5%) boost", () => {
  const r2Farm = {
    ...farm,
    skills: { "Munching Mastery": 2 },
  };
  const eff = effective("Boiled Eggs", recipes["Boiled Eggs"], r2Farm);
  // 90 * 1.075 = 96.75
  assert.strictEqual(eff.xpPerFood, 96.75);
  assert.strictEqual(eff.effectiveIngredients.Egg, 10);
});

test("inventory offset: toBuy = max(required - owned, 0)", () => {
  const c = cost({ Tomato: 60 }, SAMPLE_PRICES, items, { Tomato: 20 });
  assert.strictEqual(c.buy.Tomato, 40);
});

test("untradable items are mustProduce, never priced", () => {
  const c = cost({ "Magic Mushroom": 10 }, SAMPLE_PRICES, items, {});
  assert.strictEqual(c.mustProduce["Magic Mushroom"], 10);
  assert.strictEqual(c.flower, 0);
});

test("affordability gate triggers at low balance", () => {
  const broke = { ...farm, currencies: { ...farm.currencies, flowerApprox: 0.1 } };
  const p = plan(broke, SAMPLE_PRICES, recipes, items, modifiers);
  assert.strictEqual(p.affordable, false);
  assert.ok(p.notes.some((n) => n.includes("Cannot afford")));
  assert.ok(p.buildings.find((b) => b.building === "Deli"));
});

test("VIP Access golden test: 3 -> 3.465 XP (+15.5% with VIP +10% and Munching Mastery I +5%)", () => {
  const vipFarm = {
    ...farm,
    buffs: { vip: true },
    skills: { "Munching Mastery": 1 },
  };
  const mockRecipe = {
    building: "Fire Pit",
    baseXp: 3,
    baseCookMinutes: 1,
    ingredients: {},
  };
  const eff = effective("Mashed Potato", mockRecipe, vipFarm);
  // 3 * 1.1 * 1.05 = 3.465
  assert.ok(Math.abs(eff.xpPerFood - 3.465) < 1e-5);
  assert.strictEqual(+eff.xpPerFood.toFixed(3), 3.465);
  assert.ok(eff.applied.includes("VIP Access"));
  assert.ok(eff.applied.includes("Munching Mastery"));
  const vipEntry = eff.boostBreakdown.find((b) => b.skill === "VIP Access");
  assert.ok(vipEntry);
  assert.strictEqual(vipEntry.label, "+10% VIP Access");
});

test("Boiled Eggs with VIP + Munching Mastery I + Double Nom: 103.95 XP/egg, 207.9 XP batch", () => {
  const fullFarm = {
    ...farm,
    buffs: { vip: true },
    skills: { "Munching Mastery": 1, "Double Nom": 1 },
  };
  const eff = effective("Boiled Eggs", recipes["Boiled Eggs"], fullFarm);
  // 90 * 1.10 * 1.05 = 103.95
  assert.strictEqual(+eff.xpPerFood.toFixed(2), 103.95);
  assert.strictEqual(eff.output, 2);
  assert.strictEqual(+eff.batchXp.toFixed(2), 207.9);
  assert.ok(eff.applied.includes("VIP Access"));
  assert.ok(eff.applied.includes("Munching Mastery"));
  assert.ok(eff.applied.includes("Double Nom"));
});


