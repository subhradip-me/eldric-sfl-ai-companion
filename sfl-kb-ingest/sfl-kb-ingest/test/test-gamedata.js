const fs = require("fs");
const { buildGameDataChunks } = require("../src/gameDataUnits");

const path = require("path");
const craftablesPath = path.resolve(
  __dirname,
  "../../../knowledge-base/json/gamedata/craftables.json"
);
const craftables = JSON.parse(fs.readFileSync(craftablesPath, "utf8"));

const chunks = buildGameDataChunks("craftables.ts", {
  TOOLS: craftables.TOOLS,
});

const ironPickaxe = chunks.find((c) => c.entity === "Iron Pickaxe");
console.log(ironPickaxe.content);
console.log("---structured---");
console.log(JSON.stringify(ironPickaxe.structuredData, null, 2));
console.log(`\nTotal TOOLS chunks: ${chunks.length}`);
