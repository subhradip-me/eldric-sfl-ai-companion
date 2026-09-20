/**
 * server/services/ai/pipeline/Explainer.ts
 * Stage 4: Persona Synthesis & Strategic Explanation (Dr. Bumpkin).
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Explainer explains; NEVER calculates or fabricates numbers.
 * 2. Uses pre-computed synthesis, numbers, diff tables, and booster impacts directly.
 * 3. Degraded mode handling: warns user clearly when farm state was unavailable.
 * 4. Dr. Bumpkin Persona: practical, encouraging, strategic, and concise.
 */

import type { ValidationReport, PipelineContext } from './types.js';
import type { AIToolResult } from '../../../domain/index.js';

const DR_BUMPKIN_SYSTEM = `You are Dr. Bumpkin, the Sunflower Land AI Strategist and Chief Farming Advisor.
Your persona is practical, encouraging, and strategic.

CRITICAL SUNFLOWER LAND GAME RULES (STRICTLY ENFORCED):
1. CROPS DO NOT AWARD BUMPKIN XP!
   - In Sunflower Land, harvesting plot crops (Sunflower, Potato, Pumpkin, Wheat, Kale, etc.) yields ZERO Bumpkin XP.
   - The ONLY sources of Bumpkin XP are: COOKING FOOD at cooking buildings (Fire Pit, Kitchen, Bakery, Deli, Smoothie Shack) and FISHING!
   - NEVER tell the user to "grow crops for XP" or "harvest crops for Bumpkin XP".
2. NON-CROP ITEMS:
   - Goblin Emblem, Obsidian, Gold, Crimstone, Sunstone, Wood, Stone, Oil are minerals, collectibles, or craft resources — they are NOT crops! NEVER refer to them as crops.
3. NEVER INVENT FAKE DISHES OR RECIPES:
   - Only recommend real dishes present in the precomputed synthesis or tool results (e.g. Pizza Margherita, Pancakes, Boiled Eggs, Roast Veggies, Apple Pie, Beetroot Tart, Rapid Roast, Antipasto).
   - NEVER invent fictional dish names like "Creamy Crab Bite", "Small Fishy Feast", or "Tiny Fishy Feast".
4. COOKING AWARDS XP, NOT FLOWER:
   - Players SPEND ingredients or FLOWER to cook food; cooking yields Bumpkin XP, NEVER FLOWER.
5. NEVER INVENT OR CALCULATE NUMBERS:
   - All XP amounts, level thresholds, shortfalls, durations, and ingredient costs are PRE-COMPUTED in the supplied context. You must cite these exact numbers.
6. IF A PRECOMPUTED TABLE IS PROVIDED: You MUST embed it cleanly in your response.
7. FORMATTING:
   - Lead with the direct answer in 1-2 sentences.
   - Use small markdown tables (max 5 columns).
   - Use short bullet points for next steps; **bold** key numbers.
8. RELEVANCE & ANTI-CONFABULATION RULE:
   - Only cite prices, items, and figures that the user asked about or that are direct ingredients/outputs for the recipe in question.
   - NEVER cite unrelated items (such as Paella, random fish, or irrelevant coin prices) from general knowledge chunks.
   - When asked about recipe or crafting costs (e.g. 24 Cheese):
     * State the exact ingredient conversion formula (e.g. 1 Cheese requires 3 Milk, so 24 Cheese requires 72 Milk).
     * Cite the exact live market price of the ingredients (e.g. Milk at 0.1387 FLOWER each).
     * Cite the exact total FLOWER cost from the precomputed synthesis table (e.g. 72 * 0.1387 = 9.9864 FLOWER).
     * State the required cooking building (e.g. Deli) and whether the player has built it.`;

export class Explainer {
  /**
   * Synthesize final user response using precomputed numbers and Dr. Bumpkin persona.
   */
  public static async explain(
    message: string,
    toolResults: Array<AIToolResult<unknown>>,
    validationReport?: ValidationReport,
    context?: PipelineContext,
    priorHistory: Array<{ role: string; content: string }> = []
  ): Promise<string> {
    const synthesis = validationReport?.synthesis;

    // Compose explicit context block for LLM
    const contextLines: string[] = [];

    if (context?.productionContextBlock) {
      contextLines.push(context.productionContextBlock);
    }

    if (synthesis) {
      contextLines.push('=== AUTHORITATIVE PRECOMPUTED SYNTHESIS ===');
      if (synthesis.entityName) contextLines.push(`Entity: ${synthesis.entityName}`);
      contextLines.push(`Can Afford / Met: ${synthesis.canAfford ? 'YES' : 'NO'}`);
      contextLines.push(`Summary: ${synthesis.summaryText}`);

      if (synthesis.degradedMode) {
        contextLines.push(`⚠️ DEGRADED MODE: ${synthesis.degradedReason}`);
      }

      if (synthesis.levelMet !== undefined) {
        contextLines.push(`Level Check: ${synthesis.levelMet ? 'MET' : 'SHORTFALL'} (Required: ${synthesis.requiredLevel}, Current: ${synthesis.currentLevel})`);
      }

      if (synthesis.buildingMet !== undefined) {
        contextLines.push(`Building Check: ${synthesis.buildingMet ? 'MET' : 'MISSING'} (${synthesis.requiredBuilding} status: ${synthesis.buildingStatus})`);
      }

      if (synthesis.activeBuffs && synthesis.activeBuffs.length > 0) {
        contextLines.push(`Active Boosters/Buffs: ${synthesis.buffsImpactText}`);
        for (const buff of synthesis.activeBuffs) {
          contextLines.push(`  - ${buff.sourceId} (${buff.sourceType}): ${buff.description}`);
        }
      }

      if (synthesis.boostedValues) {
        contextLines.push(`Boosted Values: ${JSON.stringify(synthesis.boostedValues)}`);
      }

      if (synthesis.markdownTable) {
        contextLines.push('\nPrecomputed Diff Table:\n' + synthesis.markdownTable);
      }
      contextLines.push('=== END PRECOMPUTED SYNTHESIS ===\n');
    }

    // Add relevant tool results summaries
    contextLines.push('=== AUTHORITATIVE TOOL RESULTS ===');
    for (const res of toolResults) {
      if (res.success && res.data) {
        const str = JSON.stringify(res.data);
        const snippet = str.length > 2000 ? str.slice(0, 2000) + '... [truncated]' : str;
        contextLines.push(`Tool [${res.tool}]: ${snippet}`);
      }
    }
    contextLines.push('=== END TOOL RESULTS ===\n');

    const promptContext = contextLines.join('\n');

    // Build messages payload for Groq
    const sanitizedHistory = (priorHistory ?? [])
      .slice(-6)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const messages = [
      { role: 'system', content: DR_BUMPKIN_SYSTEM },
      ...sanitizedHistory,
      {
        role: 'user',
        content: `DATA CONTEXT:\n${promptContext}\n\nUSER QUESTION: ${message}\n\nExplain strategically as Dr. Bumpkin. Remember: USE THE PRECOMPUTED NUMBERS AND TABLE. NEVER invent numbers.`,
      },
    ];

    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        return this.deterministicFallback(message, validationReport, toolResults);
      }

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
          messages,
          temperature: 0.3,
          max_completion_tokens: 2048,
        }),
      });

      if (!res.ok) {
        return this.deterministicFallback(message, validationReport, toolResults);
      }

      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      let answer = j.choices?.[0]?.message?.content ?? '';
      answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      if (!answer) {
        return this.deterministicFallback(message, validationReport, toolResults);
      }

      return answer;
    } catch {
      return this.deterministicFallback(message, validationReport, toolResults);
    }
  }

  /**
   * Deterministic fallback when LLM API is unavailable.
   */
  public static deterministicFallback(
    message: string,
    validationReport?: ValidationReport,
    toolResults: Array<AIToolResult<unknown>> = []
  ): string {
    const synth = validationReport?.synthesis;
    if (synth) {
      const lines: string[] = [];
      lines.push(synth.summaryText);

      if (synth.degradedMode) {
        lines.push(`\n> ⚠️ **Note**: ${synth.degradedReason}`);
      }

      if (synth.markdownTable) {
        lines.push('\n' + synth.markdownTable);
      }

      if (synth.buffsImpactText && synth.activeBuffs.length > 0) {
        lines.push(`\n**Boosters**: ${synth.buffsImpactText}`);
      }

      return lines.join('\n');
    }

    // No synthesis available. If the validator produced a critique
    // (e.g. an unresolved entity, or authoritative data missing from tool
    // results) surface it — it's far more actionable than a generic error.
    if (validationReport?.critique) {
      return `⚠️ ${validationReport.critique}`;
    }

    return '⚠️ Received tool results, but could not format explanation. Please check your farm dashboard.';
  }
}
