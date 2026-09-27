/**
 * server/services/ai/pipeline/PlanGuardrail.ts
 * Stage 1b: Deterministic Plan Guardrail (authoritative, 0ms, cannot be bypassed).
 *
 * The LLM planner output is ADVISORY. This guardrail is AUTHORITATIVE: it re-derives
 * a safe ExecutionPlan from the (untrusted) ClassifiedPlan against the REAL tool
 * catalog. Because the LLM only emits tool NAMES + typed ARGS, it can never invoke a
 * tool that doesn't exist nor smuggle a fabricated number into a result.
 *
 * Guarantees (design §2):
 *   • whitelist every plannedTools[].name against the real catalog; drop unknowns
 *   • coerce arg types against each tool's parameter schema (quantity→number, etc.)
 *   • force-inject baseline tools (get_farm_state, get_active_effects) if absent
 *   • clamp synthesisDirectives to a bounded list of plain strings
 *   • if nothing valid remains ──▶ return null so the caller falls back to deterministicPlan()
 */

import type {
  ClassifiedPlan,
  ExecutionPlan,
  ToolCallSpec,
  ToolCatalog,
  ValidationCriteria,
} from './types.js';

export class PlanGuardrail {
  /** Baseline tools every plan should carry so the answer has player context. */
  private static readonly BASELINE_TOOLS = ['get_farm_state', 'get_active_effects'];

  /** Bound directive count/length so a runaway LLM can't bloat the prompt. */
  private static readonly MAX_DIRECTIVES = 8;
  private static readonly MAX_DIRECTIVE_LEN = 400;
  private static readonly MAX_TOOLS = 8;

  /**
   * Validate & repair a ClassifiedPlan into a safe ExecutionPlan.
   * Returns null when no valid tool survives (caller must fall back).
   */
  public static validate(
    plan: ClassifiedPlan,
    catalog: ToolCatalog,
    userGoal: string
  ): ExecutionPlan | null {
    // 1. Whitelist tool names against the real catalog; coerce args; dedupe by name.
    const seen = new Set<string>();
    const safeTools: ToolCallSpec[] = [];
    for (const spec of plan.plannedTools ?? []) {
      if (!spec || typeof spec.name !== 'string') continue;
      const def = catalog[spec.name];
      if (!def) continue; // unknown tool — drop
      if (seen.has(spec.name)) continue; // duplicate — drop
      seen.add(spec.name);
      safeTools.push({
        name: spec.name,
        args: this.coerceArgs(spec.args, def),
      });
      if (safeTools.length >= this.MAX_TOOLS) break;
    }

    // 2. If nothing valid remains, signal fallback.
    if (safeTools.length === 0) return null;

    // 3. Force-inject baseline tools if absent and available in the catalog.
    for (const baseline of this.BASELINE_TOOLS) {
      if (!seen.has(baseline) && catalog[baseline] && safeTools.length < this.MAX_TOOLS) {
        seen.add(baseline);
        safeTools.push({ name: baseline, args: {} });
      }
    }

    // 4. Clamp synthesis directives to plain, bounded strings.
    const directives = (plan.synthesisDirectives ?? [])
      .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
      .map((d) => d.trim().slice(0, this.MAX_DIRECTIVE_LEN))
      .slice(0, this.MAX_DIRECTIVES);

    // 5. Sanitize criteria: strip any numeric answer smuggled beyond allowed fields.
    const criteria = this.sanitizeCriteria(plan.criteria);
    criteria.checkBoosters = criteria.checkBoosters ?? true;

    return {
      userGoal,
      intent: plan.intent,
      criteria,
      plannedTools: safeTools,
      synthesisDirectives: directives.length > 0 ? directives : undefined,
      planSource: 'LLM',
    };
  }

  /**
   * Coerce an args object against a tool's JSON-schema parameter definition.
   * Unknown properties are dropped; known properties are coerced to their
   * declared type. Never throws.
   */
  private static coerceArgs(
    args: Record<string, unknown> | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    def: ToolCatalog[string]
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!args || typeof args !== 'object') return out;

    const props = def.parameters?.properties;
    // No schema → pass through only primitive/array/object values verbatim.
    if (!props) {
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null) out[k] = v;
      }
      return out;
    }

    for (const [key, schema] of Object.entries(props)) {
      if (args[key] === undefined || args[key] === null) continue;
      const coerced = this.coerceValue(args[key], schema?.type);
      if (coerced !== undefined) out[key] = coerced;
    }
    return out;
  }

  /** Coerce a single value to the schema-declared primitive type. */
  private static coerceValue(value: unknown, type?: string): unknown {
    switch (type) {
      case 'number':
      case 'integer': {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? (type === 'integer' ? Math.trunc(n) : n) : undefined;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        return undefined;
      case 'string':
        return typeof value === 'string' ? value : String(value);
      case 'array':
        return Array.isArray(value)
          ? value.filter((v) => v !== undefined && v !== null)
          : undefined;
      case 'object':
        return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
      default:
        // Unknown/unspecified type — pass through as-is.
        return value;
    }
  }

  /** Keep only recognized ValidationCriteria keys, with light type coercion. */
  private static sanitizeCriteria(criteria: ValidationCriteria | undefined): ValidationCriteria {
    const c = (criteria ?? {}) as Record<string, unknown>;
    const out: ValidationCriteria = {};

    if (typeof c.requiredEntity === 'string') out.requiredEntity = c.requiredEntity;
    if (typeof c.requiredCatalog === 'string') out.requiredCatalog = c.requiredCatalog;
    if (Array.isArray(c.requireFarmInventory)) {
      out.requireFarmInventory = c.requireFarmInventory.filter((x): x is string => typeof x === 'string');
    }
    if (typeof c.requireBuildingCheck === 'string') out.requireBuildingCheck = c.requireBuildingCheck;
    if (c.requireBumpkinLevel !== undefined) {
      const n = Number(c.requireBumpkinLevel);
      if (Number.isFinite(n)) out.requireBumpkinLevel = n;
    }
    if (typeof c.checkBoosters === 'boolean') out.checkBoosters = c.checkBoosters;
    if (['CRAFT', 'BUILD', 'COOK', 'EXPAND', 'GENERAL'].includes(c.actionType as string)) {
      out.actionType = c.actionType as ValidationCriteria['actionType'];
    }
    if (c.quantity !== undefined) {
      const n = Number(c.quantity);
      if (Number.isFinite(n) && n > 0) out.quantity = Math.trunc(n);
    }
    if (typeof c.isCostQuery === 'boolean') out.isCostQuery = c.isCostQuery;

    return out;
  }
}
