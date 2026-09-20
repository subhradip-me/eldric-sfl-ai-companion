const { toVectorLiteral } = require("./embed");

async function getDocumentByPath(pool, path) {
  const res = await pool.query(
    `SELECT id, content_hash FROM kb_documents WHERE path = $1`,
    [path]
  );
  return res.rows[0] || null;
}

async function upsertDocument(pool, doc) {
  const res = await pool.query(
    `INSERT INTO kb_documents
       (source, path, url, title, description, author_name, wiki_updated_at, content_hash, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (path) DO UPDATE SET
       url = EXCLUDED.url,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       author_name = EXCLUDED.author_name,
       wiki_updated_at = EXCLUDED.wiki_updated_at,
       content_hash = EXCLUDED.content_hash,
       updated_at = now()
     RETURNING id`,
    [
      doc.source || "sfl-wiki",
      doc.path,
      doc.url,
      doc.title,
      doc.description,
      doc.authorName,
      doc.wikiUpdatedAt,
      doc.contentHash,
    ]
  );
  return res.rows[0].id;
}

async function getChunksForDocument(pool, documentId) {
  const res = await pool.query(
    `SELECT id, heading_path, chunk_index, content_hash
     FROM kb_chunks WHERE document_id = $1`,
    [documentId]
  );
  return res.rows;
}

function chunkKey(headingPath, chunkIndex) {
  return `${headingPath.join(" > ")}::${chunkIndex}`;
}

// Bumps updated_at only — used for a chunk whose content_hash matches
// what's already stored, so we skip re-embedding it but still mark it as
// "seen this run" for the stale-chunk cleanup below.
async function touchChunk(pool, id) {
  await pool.query(`UPDATE kb_chunks SET updated_at = now() WHERE id = $1`, [id]);
}

async function upsertChunk(pool, chunk) {
  await pool.query(
    `INSERT INTO kb_chunks
       (document_id, heading_path, chunk_index, category, type, entity,
        content, structured_data, content_hash, embedding, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, now())
     ON CONFLICT (document_id, heading_path, chunk_index) DO UPDATE SET
       category = EXCLUDED.category,
       type = EXCLUDED.type,
       entity = EXCLUDED.entity,
       content = EXCLUDED.content,
       structured_data = EXCLUDED.structured_data,
       content_hash = EXCLUDED.content_hash,
       embedding = EXCLUDED.embedding,
       updated_at = now()`,
    [
      chunk.documentId,
      chunk.headingPath,
      chunk.chunkIndex,
      chunk.category,
      chunk.type,
      chunk.entity,
      chunk.content,
      chunk.structuredData ? JSON.stringify(chunk.structuredData) : null,
      chunk.contentHash,
      toVectorLiteral(chunk.embedding),
    ]
  );
}

// Deletes chunks belonging to a document that weren't touched in this
// ingestion run — i.e. sections that existed in a previous crawl but are
// gone from the current markdown (renamed/removed heading, etc).
async function deleteStaleChunks(pool, documentId, runStartedAt) {
  const res = await pool.query(
    `DELETE FROM kb_chunks WHERE document_id = $1 AND updated_at < $2`,
    [documentId, runStartedAt]
  );
  return res.rowCount;
}

module.exports = {
  getDocumentByPath,
  upsertDocument,
  getChunksForDocument,
  chunkKey,
  touchChunk,
  upsertChunk,
  deleteStaleChunks,
};
