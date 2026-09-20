const { contentHash } = require("./knowledgeUnits");

// A handful of shapes recur constantly across these catalogs (an
// ingredients list, a sell price, a description). Handling them by name
// once, generically, beats writing a special case per catalog file —
// same principle as the table linearizer in the wiki pipeline.
function formatIngredients(ingredients) {
  if (!ingredients) return null;
  if (Array.isArray(ingredients)) {
    if (ingredients.length === 0) return null;
    return ingredients
      .map((ing) => {
        if (ing && typeof ing === "object" && "item" in ing) {
          return `${ing.amount ?? "?"} ${ing.item}`;
        }
        return JSON.stringify(ing);
      })
      .join(", ");
  }
  if (typeof ingredients === "object") {
    const entries = Object.entries(ingredients);
    if (entries.length === 0) return null;
    return entries.map(([item, amount]) => `${amount} ${item}`).join(", ");
  }
  return null;
}

// Turns one catalog entry's value into self-contained prose + a
// structured_data side-channel, without hardcoding per-catalog field
// names beyond the few that recur everywhere (name/description/price/
// sellPrice/ingredients). Anything else on the object is listed
// generically as "key: value" so nothing is silently dropped.
function factToContent(catalogName, itemKey, value) {
  const header = `${itemKey} (${catalogName})`;

  if (typeof value === "string") {
    return { content: `${header}: ${value}`, structured: { value } };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { content: `${header}: ${value}`, structured: { value } };
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const lines = [];
  const structured = {};

  if (value.description && typeof value.description === "string") {
    lines.push(value.description);
  }
  if (typeof value.price === "number") {
    lines.push(`Costs ${value.price} coins.`);
    structured.price = value.price;
  }
  if (typeof value.coins === "number" && value.coins > 0) {
    lines.push(`Costs ${value.coins} coins.`);
    structured.coins = value.coins;
  }
  if (typeof value.sellPrice === "number") {
    lines.push(`Sells for ${value.sellPrice} coins.`);
    structured.sellPrice = value.sellPrice;
  }
  if (value.unlocksAtLevel && typeof value.unlocksAtLevel === "object") {
    const lvl = value.unlocksAtLevel.level;
    if (typeof lvl === "number" && Number.isFinite(lvl)) {
      lines.push(`Unlocks at Bumpkin level ${lvl}.`);
      structured.unlocksAtLevel = lvl;
    }
  }
  const ingredientsText = formatIngredients(value.ingredients);
  if (ingredientsText) {
    lines.push(`Requires: ${ingredientsText}.`);
    structured.ingredients = value.ingredients;
  }

  const handledKeys = new Set([
    "name",
    "description",
    "price",
    "coins",
    "sellPrice",
    "ingredients",
    "unlocksAtLevel",
  ]);
  for (const [k, v] of Object.entries(value)) {
    if (handledKeys.has(k)) continue;
    if (v && typeof v === "object" && "$unparsed" in v) continue; // dynamic, not a fact
    if (v && typeof v === "object" && "$unresolvedIdentifier" in v) continue;
    if (typeof v === "object") {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
    structured[k] = v;
  }

  if (lines.length === 0) return null;

  return {
    content: `${header}\n\n${lines.join("\n")}`,
    structured,
  };
}

/**
 * Converts one extracted catalog file's parsed JSON (e.g. craftables.json,
 * with keys like TOOLS/FOODS/ANIMALS) into chunk records in the same
 * shape buildKnowledgeUnits() produces for wiki pages — so they can go
 * through the exact same embed + upsert path in db.js.
 *
 * `sourceFile` (e.g. "craftables.ts") becomes part of the document path,
 * so re-running the extractor and re-ingesting only touches chunks whose
 * content actually changed (same content_hash skip logic as the wiki).
 */
function buildGameDataChunks(sourceFile, catalogs) {
  const chunks = [];

  for (const [catalogName, entries] of Object.entries(catalogs)) {
    if (!entries || typeof entries !== "object") continue;

    for (const [itemKey, value] of Object.entries(entries)) {
      const result = factToContent(catalogName, itemKey, value);
      if (!result) continue;

      chunks.push({
        headingPath: [catalogName, itemKey],
        chunkIndex: 0,
        category: "game-data",
        type: catalogName,
        entity: itemKey,
        content: result.content,
        structuredData: result.structured,
        contentHash: contentHash(result.content),
      });
    }
  }

  return chunks;
}

module.exports = { buildGameDataChunks, factToContent };
