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

test("Pizza golden test: 63,524 XP and ~1.71255 FLOWER (design §19)", () => {
  const eff = effective("Pizza Margherita", recipes["Pizza Margherita"], farm, modifiers);
  assert.strictEqual(eff.output, 2); // Double Nom
  assert.strictEqual(eff.batchXp, 63524);
  const dep = expand("Pizza Margherita", recipes);
  assert.deepStrictEqual(dep.base, { Tomato: 60, Wheat: 40, Milk: 6 }); // Cheese -> 3 Milk each
  const c = cost(dep.base, SAMPLE_PRICES, items, {});
  assert.ok(Math.abs(c.flower - 1.7125548) < 1e-6);
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
