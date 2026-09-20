/**
 * server/tests/explainerFallback.test.ts
 * The deterministic fallback (used when no LLM key is set, or the LLM errors)
 * must surface the validator's critique instead of a generic message when a
 * report is INVALID and carries no synthesis.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Explainer } from '../services/ai/pipeline/Explainer.js';
import type { ValidationReport } from '../services/ai/pipeline/types.js';

describe('Explainer.deterministicFallback', () => {
  it('surfaces the validator critique when the report is INVALID with no synthesis', () => {
    const report: ValidationReport = {
      status: 'INVALID',
      missingKeys: ['entity:Iron Pickaxe'],
      critique: "Authoritative game data for 'Iron Pickaxe' was not found in tool results.",
    };

    const out = Explainer.deterministicFallback('Can I craft an Iron Pickaxe?', report, []);

    assert.match(out, /Iron Pickaxe/);
    assert.doesNotMatch(out, /could not format explanation/);
  });

  it('still returns a usable message when there is neither synthesis nor critique', () => {
    const out = Explainer.deterministicFallback('hello', { status: 'INVALID', missingKeys: [] }, []);
    assert.ok(out.length > 0);
  });

  it('uses synthesis summary/table when synthesis is present', () => {
    const report: ValidationReport = {
      status: 'VALID',
      missingKeys: [],
      synthesis: {
        canAfford: true,
        rows: [],
        markdownTable: '| A | B |',
        summaryText: 'Everything checks out.',
        activeBuffs: [],
      },
    };
    const out = Explainer.deterministicFallback('q', report, []);
    assert.match(out, /Everything checks out/);
    assert.match(out, /A \| B/);
  });
});
