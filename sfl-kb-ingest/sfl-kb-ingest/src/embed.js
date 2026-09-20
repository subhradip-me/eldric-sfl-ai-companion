/**
 * Local MiniLM (384-d) text embeddings via @xenova/transformers.
 * 100% local, free, offline — matches sunflower-ai server EmbeddingService.
 */
let extractor = null;

async function getExtractor() {
  if (!extractor) {
    const { pipeline } = await import("@xenova/transformers");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

/**
 * Embeds an array of texts using all-MiniLM-L6-v2.
 * Returns an array of number[384], normalized for cosine similarity.
 */
async function embedBatch(texts) {
  if (!texts || texts.length === 0) return [];
  const ext = await getExtractor();
  const results = [];

  for (const text of texts) {
    const cleanText = (text || "").slice(0, 2000);
    const out = await ext(cleanText, { pooling: "mean", normalize: true });
    results.push(Array.from(out.data));
  }

  return results;
}

// Postgres/pgvector expects a string literal like "[0.1,0.2,...]" cast to ::vector
function toVectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

module.exports = { embedBatch, toVectorLiteral };

