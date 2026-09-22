/**
 * server/services/ai/pipeline/Explainer.ts
 * Stage 4: Persona Synthesis & Strategic Explanation (the Jester).
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Explainer explains; NEVER calculates or fabricates numbers.
 * 2. Uses pre-computed synthesis, numbers, diff tables, and booster impacts directly.
 * 3. Degraded mode handling: warns user clearly when farm state was unavailable.
 * 4. Jester Persona: playful and witty on the surface, strategically sharp underneath.
 */

import type { ValidationReport, PipelineContext, PrecomputedSynthesis } from './types.js';
import type { AIToolResult } from '../../../domain/index.js';
import { claudeClient } from '../ClaudeClient.js';

const JESTER_SYSTEM = `You are the Jester, Sunflower Land's court fool turned farming advisor.
Your persona is playful, witty, and mischievous — you crack light jokes, tease gently, and
sprinkle in wordplay and theatrical flair. But beneath the jokes you are genuinely sharp: your
strategic advice is always correct and grounded in the data. Entertain first, then deliver the
truth. Never let a joke distort a number or a fact.

DATA PRECEDENCE (HIGHEST PRIORITY — READ FIRST):
- This player's LIVE farm data ALWAYS wins. When a number appears in more than one place, trust it
  in this strict order: (1) the AUTHORITATIVE PRECOMPUTED SYNTHESIS block, (2) live tool results
  (farm state, active effects/boosts, market prices), (3) the INJECTED FARM CONTEXT block, and
  ONLY LAST (4) general knowledge-base / wiki reference chunks.
- Knowledge-base and wiki chunks describe BASE, UN-BOOSTED, generic game values. They are reference
  background ONLY. NEVER quote a KB base number (XP, yield, cost, duration) when the synthesis or a
  live tool already computed the real value for THIS player — the live value already accounts for
  the player's skills, wearables, collectibles, timed buffs, and VIP status.
- If the synthesis shows active boosts/buffs, the boosted numbers are the real answer. Say so, and
  briefly name which buff/skill changed it. Do not present the base value as the answer.

CONVERSATION CONTINUITY:
- You are in an ongoing conversation. READ the prior messages. Follow-ups like "what about 24?",
  "and with my buffs?", "one cheese takes 3 milk", or "try something else" refer to the recipe,
  quantity, goal, or constraint already established earlier — carry that context forward instead of
  restarting. Honor corrections and facts the user stated earlier in the session.

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
6. ADAPTIVE FORMATTING — MATCH THE FORMAT TO THE QUESTION:
   First decide which kind of question this is, then format accordingly.

   (A) CASUAL / CONVERSATIONAL MODE — greetings, chit-chat, opinions, "what should I do?",
       yes/no questions, single simple facts, encouragement.
       → Answer in lively, witty prose. Lead with the direct answer plus a little flourish.
       → Short bullet points are fine for a few quick tips; **bold** key numbers.
       → DO NOT render a markdown table. Weave any numbers naturally into your sentences.

   (B) STRUCTURED MODE — plans, calculations, cost breakdowns, recipe/crafting economics,
       "how much / how many", comparisons of multiple options, roadmaps, diffs, feasibility checks,
       or any request where a precomputed diff/synthesis table is supplied.
       → Lead with a 1-2 sentence direct answer (a dash of Jester wit is still welcome).
       → Then present the details in a clean markdown table (max 5 columns). If a precomputed table
         is provided in the context, embed it cleanly rather than rewriting it.
       → Follow with short bullet points for next steps; **bold** all key numbers.

   When in doubt between the two, lean structured only if the answer genuinely involves multiple
   numbers, steps, or options; otherwise stay conversational. Keep the Jester voice in both modes.
7. RELEVANCE & ANTI-CONFABULATION RULE:
   - Only cite prices, items, and figures that the user asked about or that are direct ingredients/outputs for the recipe in question.
   - NEVER cite unrelated items (such as Paella, random fish, or irrelevant coin prices) from general knowledge chunks.
   - When asked about recipe or crafting costs (e.g. 24 Cheese):
     * State the exact ingredient conversion formula (e.g. 1 Cheese requires 3 Milk, so 24 Cheese requires 72 Milk).
     * Cite the exact live market price of the ingredients (e.g. Milk at 0.1387 FLOWER each).
     * Cite the exact total FLOWER cost from the precomputed synthesis table (e.g. 72 * 0.1387 = 9.9864 FLOWER).
     * State the required cooking building (e.g. Deli) and whether the player has built it.
8. SELLING & MARKET-PRICE INTEGRITY (STRICTLY ENFORCED):
   - Placed resource NODES (Crimstone Rock, Stone Rock, Iron Rock, Gold Rock, Sunstone Rock, Trees, Boulders) are NOT sellable. They are infrastructure that produces resources, not inventory you can trade.
   - A daily-production FLOWER *valuation* (e.g. "your farm produced 463 FLOWER") is an ACCOUNTING figure describing output value over time — it is NEVER a sell price for a single item.
   - ONLY present sell suggestions that come from the resolve_sell_plan tool output. Cite its exact candidates (item, qtyToSell, unitPriceFlower, totalFlower), its excluded list (with reasons), and its shortfall honestly.
   - If resolve_sell_plan reports gapFilled:false, state the exact shortfallFlower — never pad the list with items it excluded.
   - For market-price questions, cite live P2P prices from get_market_prices. NEVER quote a knowledge-base BASE value as a current market price.`;

export class Explainer {
  /**
   * Synthesize final user response using precomputed numbers and the Jester persona.
   */
  public static async explain(
    message: string,
    toolResults: Array<AIToolResult<unknown>>,
    validationReport?: ValidationReport,
    context?: PipelineContext,
    priorHistory: Array<{ role: string; content: string }> = [],
    synthesisDirectives: string[] = []
  ): Promise<string> {
    const synthesis = validationReport?.synthesis;

    // Compose explicit context block for LLM
    const contextLines: string[] = [];

    if (context?.productionContextBlock) {
      contextLines.push(context.productionContextBlock);
    }

    // Presentation/guardrail directives from the planner. Advisory: they steer HOW
    // the answer reads. All authoritative numbers still come from tool results below.
    if (synthesisDirectives && synthesisDirectives.length > 0) {
      contextLines.push('=== PRESENTATION DIRECTIVES (how to frame the answer — never a source of numbers) ===');
      for (const d of synthesisDirectives) contextLines.push(`- ${d}`);
      contextLines.push('=== END PRESENTATION DIRECTIVES ===\n');
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
      if (synthesis.ingredientTable) {
        contextLines.push('\nMANDATORY Ingredient Breakdown (reproduce this table IN FULL — every ingredient row and market price):\n' + synthesis.ingredientTable);
      }
      contextLines.push('=== END PRECOMPUTED SYNTHESIS ===\n');
    }

    // Split tool results: live authoritative farm/market/effect data vs. generic
    // KB/wiki reference chunks. The model must prefer live data over KB base values.
    const REFERENCE_TOOLS = new Set(['search_knowledge', 'recall_memory']);
    const liveResults = toolResults.filter((r) => r.success && r.data && !REFERENCE_TOOLS.has(r.tool));
    const referenceResults = toolResults.filter((r) => r.success && r.data && REFERENCE_TOOLS.has(r.tool));

    const summarizeResult = (res: AIToolResult<unknown>): string => {
      const str = JSON.stringify(res.data);
      const snippet = str.length > 2000 ? str.slice(0, 2000) + '... [truncated]' : str;
      return `Tool [${res.tool}]: ${snippet}`;
    };

    // Live tool results = authoritative, player-specific, already boosted.
    contextLines.push('=== LIVE AUTHORITATIVE DATA (this player — already reflects skills/buffs/boosters) ===');
    for (const res of liveResults) {
      contextLines.push(summarizeResult(res));
    }
    contextLines.push('=== END LIVE DATA ===\n');

    // Reference chunks = generic BASE values. Background only; never overrides live data.
    if (referenceResults.length > 0) {
      contextLines.push('=== KNOWLEDGE-BASE REFERENCE (generic BASE values — background only, does NOT override live data above) ===');
      for (const res of referenceResults) {
        contextLines.push(summarizeResult(res));
      }
      contextLines.push('=== END KNOWLEDGE-BASE REFERENCE ===\n');
    }

    const promptContext = contextLines.join('\n');

    // Build messages payload for Groq
    const sanitizedHistory = (priorHistory ?? [])
      .slice(-12)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const messages = [
      { role: 'system', content: JESTER_SYSTEM },
      ...sanitizedHistory,
      {
        role: 'user',
        content: `DATA CONTEXT:\n${promptContext}\n\nUSER QUESTION: ${message}\n\nAnswer with the Jester's playful wit, but keep the strategy sharp. Remember: USE THE PRECOMPUTED NUMBERS and the LIVE AUTHORITATIVE DATA (which already reflects this player's skills/buffs/boosters). NEVER invent numbers, and NEVER quote a knowledge-base BASE value over a live/synthesis number. Use the conversation history above to resolve follow-ups. Pick the format per rule 6: casual questions get witty prose; plans, calculations, comparisons, or any answer with a precomputed table get the structured table + bullets layout.`,
      },
    ];

    // Primary LLM: Claude Opus 4.8. Fallback: Groq. Last resort: deterministic.
    const claudeAnswer = await this.tryClaude(messages);
    if (claudeAnswer) {
      return this.ensureIngredientTable(claudeAnswer, synthesis);
    }

    const groqAnswer = await this.tryGroq(messages);
    if (groqAnswer) {
      return this.ensureIngredientTable(groqAnswer, synthesis);
    }

    return this.deterministicFallback(message, validationReport, toolResults);
  }

  /**
   * Primary provider: Claude Opus 4.8 via the configured proxy.
   * Returns the cleaned answer, or null if unconfigured / errored / empty
   * (so the caller can fall back to Groq).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async tryClaude(messages: any[]): Promise<string | null> {
    if (!process.env.CLAUDE_API_KEY) return null;
    try {
      const answer = await claudeClient.completeText(messages, {
        temperature: 0.3,
        maxTokens: 2048,
      });
      return answer || null;
    } catch {
      return null;
    }
  }

  /**
   * Fallback provider: Groq. Returns the cleaned answer, or null if
   * unconfigured / errored / empty (so the caller can fall back to deterministic).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async tryGroq(messages: any[]): Promise<string | null> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return null;
    try {
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

      if (!res.ok) return null;

      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const answer = (j.choices?.[0]?.message?.content ?? '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      return answer || null;
    } catch {
      return null;
    }
  }

  /**
   * Deterministic guarantee: for cost/ingredient queries, the full ingredient
   * breakdown with market prices MUST reach the user. If the LLM summarized it
   * away (dropped the ingredient rows / market-price column), append the
   * precomputed table verbatim so the data is never lost.
   */
  private static ensureIngredientTable(answer: string, synthesis?: PrecomputedSynthesis): string {
    const table = synthesis?.ingredientTable;
    if (!table) return answer;

    // Heuristic: the answer already shows the breakdown if it references the
    // market-price / acquisition columns or lists per-ingredient FLOWER costs.
    const hasBreakdown = /market price|acquisition cost|to buy/i.test(answer);
    if (hasBreakdown) return answer;

    return `${answer}\n\n${table}`;
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
