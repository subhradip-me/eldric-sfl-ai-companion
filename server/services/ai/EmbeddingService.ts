import os from 'os';
import path from 'path';

/**
 * EmbeddingService — local text embeddings via all-MiniLM-L6-v2 (384-d).
 * No API key needed; model downloads on first use (~25MB).
 */
export class EmbeddingService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractor: any = null;

  /** Generate a 384-dimensional embedding vector for up to 2000 chars of text. */
  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      const tf = await import('@xenova/transformers');
      // @xenova caches the model under its own node_modules dir by default, which
      // is root-owned and therefore unwritable under the container's non-root
      // `USER node` (EACCES: mkdir '/app/node_modules/@xenova/.../.cache').
      // Point it at a writable location instead.
      tf.env.cacheDir =
        process.env.TRANSFORMERS_CACHE || path.join(os.tmpdir(), 'xenova-cache');
      this.extractor = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    const out = await this.extractor(text.slice(0, 2000), { pooling: 'mean', normalize: true });
    return Array.from(out.data as number[]);
  }

  /** Format a float array as a pgvector literal string: [f1,f2,...] */
  toVec(arr: number[]): string {
    return `[${arr.join(',')}]`;
  }
}

export const embeddingService = new EmbeddingService();
