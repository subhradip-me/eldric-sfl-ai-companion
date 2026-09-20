import { pool } from '../../db/database.js';
import { embeddingService } from '../ai/EmbeddingService.js';

export interface KnowledgeChunkResult {
  id: string;
  source: string;
  category: string | null;
  type: string | null;
  entity: string | null;
  headingPath: string[];
  content: string;
  structuredData: any;
  similarity?: number;
}

export interface SearchKnowledgeOptions {
  query: string;
  category?: string;
  type?: string;
  entity?: string;
  limit?: number;
  minSimilarity?: number;
}

export class KnowledgeService {
  /**
   * Hybrid search combining semantic vector similarity and optional entity/category filters.
   */
  async search(options: SearchKnowledgeOptions): Promise<KnowledgeChunkResult[]> {
    const { query, category, type, entity, limit = 5, minSimilarity = 0.25 } = options;

    if (!query || !query.trim()) {
      return [];
    }

    try {
      const queryVec = await embeddingService.embed(query);
      const vecLiteral = embeddingService.toVec(queryVec);

      const conditions: string[] = ['c.embedding IS NOT NULL'];
      const params: any[] = [vecLiteral, minSimilarity, limit];

      if (category) {
        params.push(category);
        conditions.push(`c.category = $${params.length}`);
      }

      if (type) {
        params.push(type);
        conditions.push(`c.type = $${params.length}`);
      }

      if (entity) {
        params.push(`%${entity.toLowerCase()}%`);
        conditions.push(`LOWER(c.entity) LIKE $${params.length}`);
      }

      const sql = `
        SELECT 
          c.id,
          d.source,
          c.category,
          c.type,
          c.entity,
          c.heading_path AS "headingPath",
          c.content,
          c.structured_data AS "structuredData",
          (1 - (c.embedding <=> $1::vector)) AS similarity
        FROM kb_chunks c
        JOIN kb_documents d ON c.document_id = d.id
        WHERE ${conditions.join(' AND ')}
          AND (1 - (c.embedding <=> $1::vector)) >= $2
        ORDER BY similarity DESC
        LIMIT $3
      `;

      const { rows } = await pool.query(sql, params);
      return rows;
    } catch (err: any) {
      console.error('KnowledgeService.search error:', err.message);
      return [];
    }
  }

  /**
   * Direct entity / item lookup for exact game facts (e.g. "Iron Pickaxe", "Sunflower").
   */
  async lookupEntity(entityName: string, limit = 5): Promise<KnowledgeChunkResult[]> {
    if (!entityName || !entityName.trim()) return [];

    try {
      const sql = `
        SELECT 
          c.id,
          d.source,
          c.category,
          c.type,
          c.entity,
          c.heading_path AS "headingPath",
          c.content,
          c.structured_data AS "structuredData"
        FROM kb_chunks c
        JOIN kb_documents d ON c.document_id = d.id
        WHERE LOWER(c.entity) = LOWER($1)
           OR LOWER(c.heading_path[array_length(c.heading_path, 1)]) = LOWER($1)
        LIMIT $2
      `;

      const { rows } = await pool.query(sql, [entityName.trim(), limit]);
      return rows;
    } catch (err: any) {
      console.error('KnowledgeService.lookupEntity error:', err.message);
      return [];
    }
  }

  /**
   * Get overall knowledge base statistics.
   *
   * Degrades gracefully (matching search / lookupEntity) so callers always
   * receive a valid structure even when the database is unreachable.
   */
  async getStats() {
    try {
      const docsRes = await pool.query(`SELECT source, count(*) as count FROM kb_documents GROUP BY source`);
      const chunksRes = await pool.query(`SELECT count(*) as total FROM kb_chunks`);
      const categoriesRes = await pool.query(
        `SELECT category, count(*) as count FROM kb_chunks GROUP BY category ORDER BY count DESC LIMIT 10`
      );

      return {
        totalChunks: parseInt(chunksRes.rows[0]?.total || '0', 10),
        documentsBySource: docsRes.rows,
        topCategories: categoriesRes.rows,
      };
    } catch (err: any) {
      console.error('KnowledgeService.getStats error:', err.message);
      return {
        totalChunks: 0,
        documentsBySource: [],
        topCategories: [],
      };
    }
  }
}

export const knowledgeService = new KnowledgeService();
