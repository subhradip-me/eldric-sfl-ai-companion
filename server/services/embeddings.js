// Local embeddings via all-MiniLM-L6-v2 (384-d). No API key; model downloads on first use (~25MB).
let extractor = null;

export async function embed(text) {
  if (!extractor) {
    const { pipeline } = await import("@xenova/transformers");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  const out = await extractor(text.slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(out.data); // 384 floats
}

export const toVec = (arr) => `[${arr.join(",")}]`; // pgvector literal
