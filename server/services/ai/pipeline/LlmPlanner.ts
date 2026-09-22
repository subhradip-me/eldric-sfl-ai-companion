/**
 * server/services/ai/pipeline/LlmPlanner.ts
 * Stage 1a: LLM Intent Classifier (advisory).
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. The LLM decides what MATTERS — intent, criteria, which tools to fetch, and
 *    presentation directives. It NEVER emits a number, candidate, price, XP, or
 *    an answer. PlanGuardrail re-derives everything against the real tool catalog.
 * 2. Output is strict JSON only (no prose). Anything unparseable / schema-invalid
 *    returns `null` so the caller falls back to the deterministic keyword planner.
 * 3. Same primary→fallback provider chain as the Explainer: Claude Opus first,
 *    Groq (`llama-3.3-70b`) if Claude is unconfigured / errors / empty.
 *
 * See docs/superpowers/specs/2026-09-22-llm-planner-and-sell-resolver-design.md §3.
 */

import type {
  ClassifiedPlan,
  PipelineIntent,
  ToolCallSpec,
  ToolCatalog,
} from './types.js';
import {
  PIPELINE_INTENTS,
  PIPELINE_INTENT_DESCRIPTIONS,
} from './types.js';
import { claudeClient } from '../ClaudeClient.js';

/** Fields the LLM is allowed to populate in `criteria` (from ValidationCriteria). */
const CRITERIA_FIELDS = [
  'requiredEntity',
  'requiredCatalog',
  'requireFarmInventory',
  'requireBuildingCheck',
  'requireBumpkinLevel',
  'checkBoosters',
  'actionType',
  'quantity',
  'isCostQuery',
] as const;

export class LlmPlanner {
  /** Max turns of prior conversation to include for follow-up context. */
  private static readonly HISTORY_TURNS = 8;

  /**
   * Classify a message into an advisory ClassifiedPlan, or return null on any
   * failure (unconfigured provider, timeout, network error, unparseable JSON,
   * schema-invalid) so the caller degrades to the deterministic planner.
   */
  public static async classify(
    message: string,
    catalog: ToolCatalog,
    priorHistory: Array<{ role: string; content: string }> = []
  ): Promise<ClassifiedPlan | null> {
    const systemPrompt = this.buildSystemPrompt(catalog);

    const history = (priorHistory ?? [])
      .slice(-this.HISTORY_TURNS)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      {
        role: 'user',
        content: `Classify this message and respond with JSON only:\n\n"${message}"`,
      },
    ];

    const raw = (await this.tryClaude(messages)) ?? (await this.tryGroq(messages));
    if (!raw) return null;

    return this.parse(raw, catalog);
  }

  /**
   * Assemble the classifier system prompt from the intent enum, the auto-generated
   * tool catalog (always in sync with real tools), the criteria field list, and
   * the hard anti-fabrication rules.
   */
  public static buildSystemPrompt(catalog: ToolCatalog): string {
    const intentLines = PIPELINE_INTENTS.map(
      (i) => `- ${i}: ${PIPELINE_INTENT_DESCRIPTIONS[i]}`
    ).join('\n');

    const toolLines = Object.entries(catalog)
      .map(([name, def]) => `- ${name}: ${def.description ?? ''}`.trim())
      .join('\n');

    return `You are the intent classifier for a Sunflower Land farming assistant pipeline.
Your ONLY job is to decide what the user WANTS and which deterministic tools should
fetch the data to answer it. The application computes every fact; you never do.

Respond with STRICT JSON only — no prose, no markdown, no code fences. Shape:
{
  "intent": "<one of the intents below>",
  "criteria": { <optional subset of the criteria fields below> },
  "goal": "<short restatement of the user's goal, optional>",
  "plannedTools": [ { "name": "<tool name>", "args": { ... } } ],
  "synthesisDirectives": [ "<presentation/guardrail hint string>", ... ]
}

INTENTS (pick exactly one):
${intentLines}

AVAILABLE TOOLS (choose the ones that fetch the data needed; use exact names):
${toolLines}

CRITERIA FIELDS (only these keys are allowed in "criteria"):
${CRITERIA_FIELDS.join(', ')}

HARD RULES:
- Output JSON only. No text before or after.
- NEVER include a number that is an answer: no prices, XP, FLOWER amounts, shortfalls,
  or candidate item lists. "quantity" and "requireBumpkinLevel" (a level the USER named)
  are the ONLY numbers allowed, and only when the user stated them.
- Choose tools that FETCH the data needed; the application computes all facts.
- Always prefer live tools over search_knowledge for market/sell/price questions.
- For MARKET_PRICES: plan get_market_prices (+ get_farm_state).
- For SELL_ADVICE: plan resolve_sell_plan (+ get_market_prices + get_farm_state). Put the
  FLOWER gap the user wants to fill in resolve_sell_plan.args.gapFlower when they named one,
  and any items they want to keep in resolve_sell_plan.args.preserve.
- synthesisDirectives are PRESENTATION hints for the writer. Strings only, never numbers.
  Example: "Cite live P2P prices; never quote knowledge-base base values as current prices."
  Example: "Placed resource nodes (Rocks, Trees) are not sellable — only present resolve_sell_plan output."`;
  }

  /**
   * Pure parser: extract and validate strict JSON into a ClassifiedPlan.
   * Returns null for anything unparseable or schema-invalid. No side effects,
   * no network — this is the unit-testable core.
   */
  public static parse(raw: string, catalog?: ToolCatalog): ClassifiedPlan | null {
    const json = this.extractJson(raw);
    if (!json) return null;

    let obj: unknown;
    try {
      obj = JSON.parse(json);
    } catch {
      return null;
    }

    if (!obj || typeof obj !== 'object') return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = obj as any;

    // intent must be a known enum value
    const intent = o.intent as PipelineIntent;
    if (!PIPELINE_INTENTS.includes(intent)) return null;

    // plannedTools must be a non-empty array of { name, args } with known-string names
    if (!Array.isArray(o.plannedTools) || o.plannedTools.length === 0) return null;
    const plannedTools: ToolCallSpec[] = [];
    for (const t of o.plannedTools) {
      if (!t || typeof t !== 'object' || typeof t.name !== 'string') continue;
      // If a catalog is provided, drop unknown tool names here too (guardrail re-checks).
      if (catalog && !catalog[t.name]) continue;
      plannedTools.push({
        name: t.name,
        args: t.args && typeof t.args === 'object' && !Array.isArray(t.args) ? t.args : {},
      });
    }
    if (plannedTools.length === 0) return null;

    // criteria: keep only allowed keys
    const criteria: Record<string, unknown> = {};
    if (o.criteria && typeof o.criteria === 'object') {
      for (const key of CRITERIA_FIELDS) {
        if (o.criteria[key] !== undefined) criteria[key] = o.criteria[key];
      }
    }

    // synthesisDirectives: strings only
    const synthesisDirectives: string[] = Array.isArray(o.synthesisDirectives)
      ? o.synthesisDirectives.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];

    return {
      intent,
      criteria: criteria as ClassifiedPlan['criteria'],
      goal: typeof o.goal === 'string' ? o.goal : undefined,
      plannedTools,
      synthesisDirectives,
    };
  }

  /**
   * Extract the first balanced JSON object from a possibly-noisy LLM response
   * (strips code fences, leading prose). Returns null if no object is found.
   */
  private static extractJson(raw: string): string | null {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return cleaned.slice(start, i + 1);
      }
    }
    return null;
  }

  /**
   * Primary provider: Claude Opus 4.8, temp 0, JSON-only, small budget.
   * Returns raw text, or null if unconfigured / errored / empty.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async tryClaude(messages: any[]): Promise<string | null> {
    if (!process.env.CLAUDE_API_KEY) return null;
    try {
      const answer = await claudeClient.completeText(messages, {
        temperature: 0,
        maxTokens: 400,
      });
      return answer || null;
    } catch {
      return null;
    }
  }

  /**
   * Fallback provider: Groq (llama-3.3-70b), temp 0, JSON-only.
   * Returns raw text, or null if unconfigured / errored / empty.
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
          temperature: 0,
          max_completion_tokens: 400,
          response_format: { type: 'json_object' },
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
}
