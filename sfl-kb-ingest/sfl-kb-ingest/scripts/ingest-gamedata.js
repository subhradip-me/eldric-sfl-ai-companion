/**
 * Ingests the output of sfl-gamedata-extract (one JSON file per source
 * .ts file, e.g. craftables.json, resources.json) into kb_documents /
 * kb_chunks — the exact same tables and skip-if-unchanged logic as
 * scripts/ingest.js uses for the wiki. Run the extractor first:
 *
 *   node /path/to/sfl-gamedata-extract/extract.js /path/to/sfl-repo ./gamedata-output
 *
 * Then:
 *   node scripts/ingest-gamedata.js ./gamedata-output
 *
 * Each source file becomes one kb_documents row (path like
 * "/gamedata/craftables.ts"), so re-running the extractor after a game
 * update and re-ingesting only re-embeds catalogs whose content actually
 * changed — same content_hash mechanism as the wiki pages.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });
require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

const { buildGameDataChunks } = require("../src/gameDataUnits");
const { contentHash } = require("../src/knowledgeUnits");
const { embedBatch } = require("../src/embed");
const db = require("../src/db");

const EMBED_BATCH_SIZE = 64;

const FORCE = process.argv.includes("--force");

async function processCatalogFile(pool, filePath) {
  const fileName = path.basename(filePath);
  const docPath = `/gamedata/${fileName}`;

  const raw = fs.readFileSync(filePath, "utf8");
  const fileHash = contentHash(raw);

  const existingDoc = await db.getDocumentByPath(pool, docPath);
  if (!FORCE && existingDoc && existingDoc.content_hash === fileHash) {
    console.log(`SKIP  ${docPath} (unchanged)`);
    return { skipped: true, embedded: 0 };
  }

  const runStartedAt = new Date();
  const catalogs = JSON.parse(raw);

  const documentId = await db.upsertDocument(pool, {
    source: "sfl-gamedata",
    path: docPath,
    url: null,
    title: fileName.replace(/\.json$/, ""),
    description: `Extracted game-data catalogs from ${fileName.replace(/\.json$/, ".ts")}`,
    authorName: null,
    wikiUpdatedAt: null,
    contentHash: fileHash,
  });

  const units = buildGameDataChunks(fileName, catalogs);

  const existingChunks = await db.getChunksForDocument(pool, documentId);
  const existingByKey = new Map(
    existingChunks.map((c) => [db.chunkKey(c.heading_path, c.chunk_index), c])
  );

  const toEmbed = [];
  const alreadyCurrent = [];
  for (const unit of units) {
    const key = db.chunkKey(unit.headingPath, unit.chunkIndex);
    const existing = existingByKey.get(key);
    if (existing && existing.content_hash === unit.contentHash) {
      alreadyCurrent.push({ id: existing.id });
    } else {
      toEmbed.push(unit);
    }
  }

  for (const { id } of alreadyCurrent) {
    await db.touchChunk(pool, id);
  }

  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((u) => u.content));
    for (let j = 0; j < batch.length; j++) {
      await db.upsertChunk(pool, {
        documentId,
        headingPath: batch[j].headingPath,
        chunkIndex: batch[j].chunkIndex,
        category: batch[j].category,
        type: batch[j].type,
        entity: batch[j].entity,
        content: batch[j].content,
        structuredData: batch[j].structuredData,
        contentHash: batch[j].contentHash,
        embedding: embeddings[j],
      });
    }
  }

  const deleted = await db.deleteStaleChunks(pool, documentId, runStartedAt);

  console.log(
    `OK    ${docPath}  (${units.length} facts, ${toEmbed.length} embedded, ` +
      `${alreadyCurrent.length} unchanged, ${deleted} stale removed)`
  );

  return { skipped: false, embedded: toEmbed.length };
}

async function main() {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error("Usage: node scripts/ingest-gamedata.js <extractor-output-dir>");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (see .env.example)");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith(".json") && f !== "_summary.json");

  let skipped = 0;
  let embedded = 0;

  for (const file of files) {
    try {
      const result = await processCatalogFile(pool, path.join(outputDir, file));
      if (result.skipped) skipped++;
      embedded += result.embedded;
    } catch (err) {
      console.error(`FAILED ${file}:`, err.message);
    }
  }

  console.log("\n--- Game-data ingest complete ---");
  console.log(`Files seen: ${files.length}`);
  console.log(`Files skipped (unchanged): ${skipped}`);
  console.log(`Chunks embedded/updated: ${embedded}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Ingest crashed:", err);
  process.exit(1);
});
