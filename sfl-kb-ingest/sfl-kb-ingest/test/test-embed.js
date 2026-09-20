const { embedBatch, toVectorLiteral } = require("../src/embed");

async function test() {
  console.log("Loading local MiniLM model...");
  const embeddings = await embedBatch(["Iron Pickaxe requires 5 Wood and 3 Iron"]);
  console.log("Vector length:", embeddings[0].length);
  console.log("Vector preview:", embeddings[0].slice(0, 5));
  console.log("toVectorLiteral preview:", toVectorLiteral(embeddings[0]).slice(0, 30));
}

test().catch(console.error);
