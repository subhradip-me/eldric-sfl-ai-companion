/**
 * server/services/ai/pipeline/PipelineCoordinator.ts
 * Coordinates the 4-stage pipeline execution:
 * 1. Planner (Goal decomposition & criteria extraction)
 * 2. Orchestrator (Deterministic tool execution)
 * 3. Validator (Pure TypeScript diff checking & booster evaluation)
 * 4. Explainer (Jester persona synthesis using pre-computed math)
 */

import type {
  PipelineContext,
  PipelineStep,
  PipelineExecutionResult,
  ToolCatalog,
} from './types.js';
import { Planner } from './Planner.js';
import { DeterministicValidator } from './DeterministicValidator.js';
import { Explainer } from './Explainer.js';
import type { AIToolResult, CalculationProvenance, NormalizedFarmState } from '../../../domain/index.js';

export interface ToolExecutorMap {
  [name: string]: {
    /** Optional catalog metadata used by the LLM planner + guardrail. */
    description?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exec: (params: any, context: any) => Promise<AIToolResult<any>>;
  };
}

export class PipelineCoordinator {
  private static readonly MAX_TOTAL_TOOL_CALLS = 8;

  /**
   * Run the full 4-stage pipeline.
   */
  public static async execute(
    message: string,
    context: PipelineContext,
    tools: ToolExecutorMap,
    priorHistory: Array<{ role: string; content: string }> = [],
    farmStateSupplier?: () => Promise<{ state: NormalizedFarmState; version?: number } | null>
  ): Promise<PipelineExecutionResult> {
    const steps: PipelineStep[] = [];
    const collectedWarnings: string[] = [];
    let latestProvenance: CalculationProvenance | undefined;
    let toolCallsCount = 0;

    // ── STAGE 1: PLANNER ───────────────────────────────────────────────────
    const plan = await Planner.plan(
      message,
      context,
      priorHistory,
      tools as unknown as ToolCatalog
    );
    steps.push({
      stage: 'PLANNER',
      ok: true,
      details: `Intent: ${plan.intent} (${plan.planSource ?? 'DETERMINISTIC'}) | Entity: ${plan.criteria.requiredEntity ?? 'none'}`,
    });

    // ── STAGE 2: ORCHESTRATOR (Tool Execution) ─────────────────────────────
    const toolResults: Array<AIToolResult<unknown>> = [];
    let activeFarmState = context.farmState;

    for (const spec of plan.plannedTools) {
      if (toolCallsCount >= this.MAX_TOTAL_TOOL_CALLS) break;

      const tool = tools[spec.name];
      if (!tool) continue;

      toolCallsCount++;
      try {
        const res = await tool.exec(spec.args, context);
        toolResults.push(res);

        if (res.warnings && res.warnings.length > 0) {
          collectedWarnings.push(...res.warnings);
        }
        if (res.provenance) {
          latestProvenance = res.provenance;
        }

        // If get_farm_state was called, extract the state
        if (spec.name === 'get_farm_state' && res.success && res.data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = res.data as any;
          if (d.farm) {
            activeFarmState = d.farm;
          }
        }

        steps.push({
          stage: 'ORCHESTRATOR',
          tool: spec.name,
          ok: res.success,
          epistemicTier: res.epistemicTier,
        });
      } catch (err) {
        toolResults.push({
          tool: spec.name,
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: String((err as Error).message ?? err),
            retryable: false,
          },
        });
        steps.push({
          stage: 'ORCHESTRATOR',
          tool: spec.name,
          ok: false,
          details: String((err as Error).message ?? err),
        });
      }
    }

    // If farm state wasn't retrieved via tools but supplier is provided, try supplier
    if (!activeFarmState && farmStateSupplier) {
      try {
        const stored = await farmStateSupplier();
        if (stored?.state) {
          activeFarmState = stored.state;
        }
      } catch {
        // Fallback: remains undefined
      }
    }

    // ── STAGE 3: DETERMINISTIC VALIDATOR ───────────────────────────────────
    let validationReport = DeterministicValidator.validate(
      plan.criteria,
      toolResults,
      activeFarmState,
      context
    );

    // If INVALID and targetTool is provided, execute 1 targeted retry pass
    if (
      validationReport.status === 'INVALID' &&
      validationReport.targetTool &&
      toolCallsCount < this.MAX_TOTAL_TOOL_CALLS
    ) {
      const retrySpec = validationReport.targetTool;
      const retryTool = tools[retrySpec.name];

      if (retryTool) {
        toolCallsCount++;
        try {
          const retryRes = await retryTool.exec(retrySpec.args, context);
          toolResults.push(retryRes);
          steps.push({
            stage: 'ORCHESTRATOR',
            tool: retrySpec.name,
            ok: retryRes.success,
            epistemicTier: retryRes.epistemicTier,
            details: 'Targeted single-tool retry pass',
          });

          // Re-validate with retry results
          validationReport = DeterministicValidator.validate(
            plan.criteria,
            toolResults,
            activeFarmState,
            context
          );
        } catch (err) {
          steps.push({
            stage: 'ORCHESTRATOR',
            tool: retrySpec.name,
            ok: false,
            details: `Retry failed: ${String((err as Error).message ?? err)}`,
          });
        }
      }
    }

    steps.push({
      stage: 'VALIDATOR',
      ok: validationReport.status !== 'INVALID',
      details: `Status: ${validationReport.status}`,
    });

    // ── STAGE 4: EXPLAINER ─────────────────────────────────────────────────
    const answer = await Explainer.explain(
      message,
      toolResults,
      validationReport,
      context,
      priorHistory,
      plan.synthesisDirectives
    );

    steps.push({
      stage: 'EXPLAINER',
      ok: true,
    });

    return {
      success: true,
      answer,
      steps,
      validationReport,
      warnings: collectedWarnings.length > 0 ? collectedWarnings : undefined,
      provenance: latestProvenance,
    };
  }
}
