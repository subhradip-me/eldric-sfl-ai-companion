import 'dotenv/config';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../db/database.js';
import { knowledgeService } from '../services/knowledge/index.js';

after(async () => {
  await pool.end().catch(() => {});
});

test('KnowledgeService - getStats returns valid structure', async () => {
  const stats = await knowledgeService.getStats();
  assert.ok(typeof stats.totalChunks === 'number', 'totalChunks is a number');
  assert.ok(Array.isArray(stats.documentsBySource), 'documentsBySource is an array');
  assert.ok(Array.isArray(stats.topCategories), 'topCategories is an array');
});

test('KnowledgeService - search handles empty query gracefully', async () => {
  const results = await knowledgeService.search({ query: '' });
  assert.deepEqual(results, []);
});

test('KnowledgeService - lookupEntity handles empty string gracefully', async () => {
  const results = await knowledgeService.lookupEntity('');
  assert.deepEqual(results, []);
});

test('Orchestrator - search_knowledge tool is registered and callable', async () => {
  const { orchestrator } = await import('../services/ai/Orchestrator.js');
  assert.ok(orchestrator.tools.search_knowledge, 'search_knowledge tool is defined');
  const res = await orchestrator.tools.search_knowledge.exec({ query: '' }, { farmId: '1', userId: 1 });
  assert.equal(res.tool, 'search_knowledge');
  assert.equal(res.success, true);
});

