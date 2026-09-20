/**
 * Ingests the crawler's wiki-dump.jsonl into kb_documents / kb_chunks.
 *
 * Skip logic (two levels):
 *   - Whole page: if the page's raw markdown hash matches what's already
 *     stored, skip it entirely — nothing to re-parse or re-embed.
 *   - Per chunk: if a page DID change, only the sections whose own
 *     content_hash changed get re-embedded. Unchanged sections are just
 *     "touched" (updated_at bumped) so the stale-cleanup pass below
 *     doesn't delete them. Removed sections get deleted.
 *
 * Usage:
 *   cp .env.example .env   # fill in DATABASE_URL and OPENAI_API_KEY
 *   npm install
 *   node scripts/ingest.js /path/to/wiki-dump.jsonl
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });
require("dotenv").config();
const fs = require("fs");
const readline = require("readline");
const { Pool } = require("pg");

const { splitIntoSections } = require("../src/parse");
const { buildKnowledgeUnits, contentHash } = require("../src/knowledgeUnits");
const { embedBatch } = require("../src/embed");
const db = require("../src/db");

const EMBED_BATCH_SIZE = 64;

async function processPage(pool, pageRecord) {
  const pageHash = contentHash(pageRecord.markdown);
  const existingDoc = await db.getDocumentByPath(pool, pageRecord.path);

  if (existingDoc && existingDoc.content_hash === pageHash) {
    console.log(`SKIP  ${pageRecord.path} (unchanged)`);
    return { skipped: true };
  }

  const runStartedAt = new Date();

  const documentId = await db.upsertDocument(pool, {
    path: pageRecord.path,
    url: pageRecord.url,
    title: pageRecord.title,
    description: pageRecord.description,
    authorName: pageRecord.authorName,
    wikiUpdatedAt: pageRecord.updatedAt,
    contentHash: pageHash,
  });

  const sections = splitIntoSections(pageRecord.markdown);
  const units = buildKnowledgeUnits(pageRecord, sections);

  const existingChunks = await db.getChunksForDocument(pool, documentId);
  const existingByKey = new Map(
    existingChunks.map((c) => [
      db.chunkKey(c.heading_path, c.chunk_index),
      c,
    ])
  );

  // Figure out which units actually need a fresh embedding.
  const toEmbed = [];
  const alreadyCurrent = [];
  for (const unit of units) {
    const key = db.chunkKey(unit.headingPath, unit.chunkIndex);
    const existing = existingByKey.get(key);
    if (existing && existing.content_hash === unit.contentHash) {
      alreadyCurrent.push({ unit, id: existing.id });
    } else {
      toEmbed.push(unit);
    }
  }

  // Touch unchanged chunks so they survive the stale-cleanup pass below.
  for (const { id } of alreadyCurrent) {
    await db.touchChunk(pool, id);
  }

  // Embed + upsert whatever's new or changed, in batches.
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
    `OK    ${pageRecord.path}  (${units.length} sections, ${toEmbed.length} embedded, ` +
      `${alreadyCurrent.length} unchanged, ${deleted} stale removed)`
  );

  return { skipped: false, embedded: toEmbed.length };
}

async function main() {
  const jsonlPath = process.argv[2];
  if (!jsonlPath) {
    console.error("Usage: node scripts/ingest.js <path-to-wiki-dump.jsonl>");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (see .env.example)");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const rl = readline.createInterface({
    input: fs.createReadStream(jsonlPath),
    crlfDelay: Infinity,
  });

  let pagesSeen = 0;
  let pagesSkipped = 0;
  let chunksEmbedded = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const pageRecord = JSON.parse(line);
    pagesSeen++;
    try {
      const result = await processPage(pool, pageRecord);
      if (result.skipped) pagesSkipped++;
      else chunksEmbedded += result.embedded;
    } catch (err) {
      console.error(`FAILED ${pageRecord.path}:`, err.message);
    }
  }

  console.log("\n--- Ingest complete ---");
  console.log(`Pages seen: ${pagesSeen}`);
  console.log(`Pages skipped (unchanged): ${pagesSkipped}`);
  console.log(`Chunks embedded/updated: ${chunksEmbedded}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Ingest crashed:", err);
  process.exit(1);
});
