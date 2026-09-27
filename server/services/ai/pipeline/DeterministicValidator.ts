/**
 * server/services/ai/pipeline/DeterministicValidator.ts
 * Stage 3: Pure TypeScript Validator (0 LLM Calls).
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Zero LLM calls in this stage. Diffs KB chunk structured data directly against NormalizedFarmState.
 * 2. Strict float-safe arithmetic via MathHelper.
 * 3. Factors in active boosters, skills, wearables, and collectibles via resolveEffectContext.
 * 4. First-class DATA_UNAVAILABLE handling for Community API 429s or connection timeouts.
 * 5. Synthesizes dedicated precomputed tables for Recipe XP, Buy vs Farm, Expansions, and Levels.
 */

import type {
  ValidationCriteria,
  ValidationReport,
  PrecomputedSynthesis,
  ResourceDiffRow,
  PipelineContext,
} from './types.js';
import type { AIToolResult, NormalizedFarmState } from '../../../domain/index.js';
import { MathHelper } from './MathHelper.js';
import { resolveEffectContext } from '../../../core/effectEngine/effectResolver.js';
import type { ActiveEffect } from '../../../core/effectEngine/effectTypes.js';
import recipesData from '../../../data/recipes.json' with { type: 'json' };
import itemsData from '../../../data/items.json' with { type: 'json' };

export class DeterministicValidator {
  /**
   * Validate tool execution results and farm state against typed ValidationCriteria.
   */
  public static validate(
    criteria: ValidationCriteria,
    toolResults: Array<AIToolResult<unknown>>,
    farmState?: NormalizedFarmState | null,
    context?: PipelineContext
  ): ValidationReport {
    // ── 1. Check for Rate Limiting / Farm State Unavailability ───────────────
    const farmStateResult = toolResults.find((r) => r.tool === 'get_farm_state');
    const isFarmStateUnavailable =
      !farmState ||
      (farmStateResult && (!farmStateResult.success || farmStateResult.staleness === 'VERY_STALE'));

    // ── 2. Specialized Synthesizers for Domain Tools ─────────────────────────

    // A. Recipe XP & Cooking Calculations
    const recipeCostResults = toolResults.filter(
      (r) => r.tool === 'compute_recipe_cost' && r.success && r.data
    );
    if (recipeCostResults.length > 0) {
      return this.synthesizeRecipeXpResults(recipeCostResults, farmState, criteria);
    }

    // B. Buy vs Farm Economics
    const buyVsFarmResult = toolResults.find(
      (r) => r.tool === 'evaluate_buy_vs_farm' && r.success && r.data
    );
    if (buyVsFarmResult) {
      return this.synthesizeBuyVsFarmResults(buyVsFarmResult.data, farmState);
    }

    // C. Land Expansion Details
    const expansionResult = toolResults.find(
      (r) => r.tool === 'get_expansion_details' && r.success && r.data
    );
    if (expansionResult) {
      return this.synthesizeExpansionResults(expansionResult.data, farmState);
    }

    // D. Strategic Roadmap & Cooking Recommendations
    const roadmapResult = toolResults.find(
      (r) => r.tool === 'get_roadmap' && r.success && r.data
    );
    if (roadmapResult) {
      return this.synthesizeRoadmapResults(roadmapResult.data, farmState);
    }

    // E. Level & XP Progression
    const levelResult = toolResults.find(
      (r) => r.tool === 'get_level_requirements' && r.success && r.data
    );
    if (levelResult) {
      return this.synthesizeLevelResults(levelResult.data, farmState);
    }

    // F. Sell-Plan Resolver (what to sell to raise FLOWER)
    const sellPlanResult = toolResults.find(
      (r) => r.tool === 'resolve_sell_plan' && r.success && r.data
    );
    if (sellPlanResult) {
      return this.synthesizeSellPlanResults(sellPlanResult.data);
    }

    // ── 3. Entity Validation (Recipe, Tool, Building, Item) ─────────────────
    if (criteria.requiredEntity) {
      return this.validateEntityRequirements(
        criteria,
        toolResults,
        farmState,
        isFarmStateUnavailable
      );
    }

    // ── 4. General Validation for Non-Entity Goals ───────────────────────────
    const missingKeys: string[] = [];

    if (criteria.requireFarmInventory && criteria.requireFarmInventory.length > 0 && isFarmStateUnavailable) {
      return {
        status: 'DATA_UNAVAILABLE',
        missingKeys: ['farmState'],
        critique: 'Farm inventory cannot be verified because live farm state is currently unavailable.',
        synthesis: {
          canAfford: false,
          rows: [],
          markdownTable: '',
          summaryText: '⚠️ Farm state unavailable.',
          activeBuffs: [],
          degradedMode: true,
          degradedReason: 'Farm state is currently unavailable due to API rate-limiting or network error.',
        },
      };
    }

    if (criteria.requireBuildingCheck && farmState) {
      const buildings = farmState.structures?.buildings ?? {};
      const hasBuilding = Object.keys(buildings).some(
        (b) => b.toLowerCase() === criteria.requireBuildingCheck?.toLowerCase()
      );
      if (!hasBuilding) {
        missingKeys.push(`building:${criteria.requireBuildingCheck}`);
      }
    }

    if (criteria.requireBumpkinLevel && farmState) {
      const currentLevel = farmState.player?.level ?? 1;
      if (currentLevel < criteria.requireBumpkinLevel) {
        missingKeys.push(`level:${criteria.requireBumpkinLevel}`);
      }
    }

    if (missingKeys.length > 0) {
      return {
        status: 'INVALID',
        missingKeys,
        critique: `Requirements not met: [${missingKeys.join(', ')}].`,
      };
    }

    return {
      status: 'VALID',
      missingKeys: [],
      synthesis: {
        canAfford: true,
        rows: [],
        markdownTable: '',
        summaryText: 'All general validation checks passed.',
        activeBuffs: [],
      },
    };
  }

  /**
   * Synthesize Recipe XP, Cook Time, and Ingredient / FLOWER Cost calculations into clean tables.
   */
  private static synthesizeRecipeXpResults(
    recipeResults: Array<AIToolResult<unknown>>,
    farmState?: NormalizedFarmState | null,
    criteria?: ValidationCriteria
  ): ValidationReport {
    const summaryItems: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allBuffs: any[] = [];
    const allRows: ResourceDiffRow[] = [];
    const sections: string[] = [];
    // Standalone ingredient breakdown tables (one per recipe) so the Explainer can
    // guarantee the full ingredient + market-price list always reaches the user.
    const ingredientTables: string[] = [];

    // Check if any recipe result has cost, quantity > 1, or ingredient details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasCostOrIngredients = recipeResults.some((res: any) => {
      const d = res.data;
      return (
        (d?.cost && (d.cost.flower > 0 || d.cost.totalFlower > 0)) ||
        (Array.isArray(d?.ingredientDetails) && d.ingredientDetails.length > 0) ||
        (d?.quantity && d.quantity > 1) ||
        criteria?.isCostQuery
      );
    });

    for (const res of recipeResults) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;
      const recipeName = data.recipe;
      const qty = data.quantity ?? criteria?.quantity ?? 1;
      const buildingName = data.building;
      const ownsBuilding = data.ownsBuilding ?? true;
      const effective = data.effective;
      const baseXp = effective?.baseXp ?? 0;
      const effectiveXp = effective?.xpPerFood ?? baseXp;
      const totalXp = data.effective?.totalXpGained ?? Math.round(effectiveXp * qty * 100) / 100;
      const formattedTime = data.formattedTime ?? `${effective?.minutes ?? 0}m`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const boostsList = effective?.boostBreakdown?.map((b: any) => b.label).join(', ') || 'Standard';

      if (hasCostOrIngredients && Array.isArray(data.ingredientDetails) && data.ingredientDetails.length > 0) {
        // 1. Overview Table
        const totalFlowerCost = data.cost?.flower ?? 0;
        const bldStatus = ownsBuilding ? '✅ Built' : '❌ Not Built';

        const overviewLines = [
          '| Metric | Value |',
          '| :--- | :--- |',
          `| **Target Dish** | **${qty > 1 ? `${qty}x ` : ''}${recipeName}** |`,
          `| **Building Required** | **${buildingName ?? 'Kitchen'}** (${bldStatus}) |`,
          `| **Total Output** | ${qty} ${recipeName} |`,
          `| **Total XP Gained** | **${MathHelper.formatNumber(totalXp)} XP** (${MathHelper.formatNumber(effectiveXp)} XP each) |`,
          `| **Cook Duration** | ${formattedTime} per unit |`,
          `| **FLOWER Acquisition Cost** | **${totalFlowerCost.toFixed(4)} FLOWER** (to buy missing ingredients) |`,
        ];

        // 2. Ingredient Breakdown Table
        const ingLines = [
          '| Ingredient | Per Unit | Total Needed | In Stock | To Buy | Market Price | Acquisition Cost |',
          '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
        ];

        for (const ing of data.ingredientDetails) {
          const unitPriceStr = ing.unitPriceFlower != null ? `${ing.unitPriceFlower.toFixed(4)} FLOWER` : 'Unpriced';
          const costStr = ing.unitPriceFlower != null ? `**${(ing.totalCostFlower ?? 0).toFixed(4)} FLOWER**` : 'Unpriced';
          ingLines.push(
            `| **${ing.item}** | ${ing.perUnit} | ${ing.totalNeeded} | ${ing.inStock} | ${ing.toBuy > 0 ? `**${ing.toBuy}**` : '0'} | ${unitPriceStr} | ${costStr} |`
          );

          allRows.push({
            item: ing.item,
            needed: ing.totalNeeded,
            stock: ing.inStock,
            shortfall: ing.toBuy,
            surplus: Math.max(0, ing.inStock - ing.totalNeeded),
            status: ing.toBuy === 0 ? 'MET' : 'SHORTFALL',
            note: ing.toBuy > 0 ? `Buy ${ing.toBuy} from Market (${ing.totalCostFlower.toFixed(4)} FLOWER)` : 'In stock',
          });
        }

        if (!ownsBuilding && buildingName) {
          allRows.unshift({
            item: `${buildingName} Building`,
            needed: 1,
            stock: 0,
            shortfall: 1,
            surplus: 0,
            status: 'MISSING_BUILDING',
            note: `Requires ${buildingName} to be constructed on farm`,
          });
        }

        sections.push(overviewLines.join('\n'));
        sections.push('');
        sections.push('### Required Ingredients & Market Acquisition Cost');
        sections.push(ingLines.join('\n'));

        // Intermediate production steps (e.g. produce Cheese from Milk).
        const intermediateSteps: string[] = Array.isArray(data.intermediateSteps) ? data.intermediateSteps : [];
        if (intermediateSteps.length > 0) {
          sections.push('');
          sections.push('**Intermediate steps:** ' + intermediateSteps.map((s: string) => `${s}`).join('; ') + '.');
        }

        // Capture the ingredient breakdown separately for guaranteed rendering.
        const ingHeading = recipeResults.length > 1
          ? `### ${qty > 1 ? `${qty}x ` : ''}${recipeName} — Ingredients & Market Cost`
          : '### Required Ingredients & Market Acquisition Cost';
        const intermediateNote = intermediateSteps.length > 0
          ? `\n\n_Intermediate steps: ${intermediateSteps.join('; ')}._`
          : '';
        ingredientTables.push(`${ingHeading}\n${ingLines.join('\n')}\n\n**Total FLOWER to buy missing ingredients: ${totalFlowerCost.toFixed(4)} FLOWER**${intermediateNote}`);

        // Detailed summary item
        const ingSummary = data.ingredientDetails.map((i: any) => `${i.totalNeeded} ${i.item} (${i.perUnit} per unit)`).join(', ');
        const missingDetails = data.ingredientDetails.filter((i: any) => i.toBuy > 0);
        let buySummary = 'All ingredients are already in your inventory';
        if (missingDetails.length > 0) {
          buySummary = `buying ${missingDetails.map((i: any) => `${i.toBuy} ${i.item}`).join(', ')} from the market will cost **${totalFlowerCost.toFixed(4)} FLOWER**`;
        }

        summaryItems.push(
          `Producing **${qty > 1 ? `${qty}x ` : ''}${recipeName}** requires **${ingSummary}** crafted at the **${buildingName ?? 'Kitchen'}** (${bldStatus}). ${buySummary}.`
        );
      } else {
        // Standard XP view
        const xpDisplay = effectiveXp > baseXp
          ? `**${MathHelper.formatNumber(effectiveXp)} XP** (+${Math.round(((effectiveXp - baseXp) / baseXp) * 100)}%)`
          : `**${MathHelper.formatNumber(effectiveXp)} XP**`;

        const xpLines = [
          '| Recipe | Base XP | Boosted XP | Cook Duration | Active Boosts |',
          '| :--- | :--- | :--- | :--- | :--- |',
          `| **${recipeName}** | ${MathHelper.formatNumber(baseXp)} XP | ${xpDisplay} | ${formattedTime} | ${boostsList} |`,
        ];
        sections.push(xpLines.join('\n'));

        summaryItems.push(`**${recipeName}** yields **${MathHelper.formatNumber(effectiveXp)} XP** (Cook time: ${formattedTime})`);
      }

      if (Array.isArray(effective?.boostBreakdown)) {
        for (const b of effective.boostBreakdown) {
          if (!allBuffs.some((existing) => existing.description === b.label)) {
            allBuffs.push({
              sourceId: b.label,
              sourceType: 'boost',
              description: b.label,
              effectText: b.label,
            });
          }
        }
      }
    }

    const markdownTable = sections.join('\n');
    const summaryText = summaryItems.join(' ');
    const canAfford = allRows.every((r) => r.status === 'MET');

    return {
      status: 'VALID',
      missingKeys: allRows.filter((r) => r.status === 'SHORTFALL' || r.status === 'MISSING_BUILDING').map((r) => r.item),
      synthesis: {
        entityName: criteria?.requiredEntity ?? (recipeResults[0]?.data as any)?.recipe,
        canAfford,
        rows: allRows,
        markdownTable,
        ingredientTable: ingredientTables.length > 0 ? ingredientTables.join('\n\n') : undefined,
        summaryText,
        activeBuffs: allBuffs,
        buffsImpactText: allBuffs.length > 0 ? `Active Boosters: ${allBuffs.map((b) => b.description).join(', ')}` : 'No active boosts applied.',
      },
    };
  }

  /**
   * Synthesize Buy vs Farm comparison into economics and setup tables.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static synthesizeBuyVsFarmResults(data: any, farmState?: NormalizedFarmState | null): ValidationReport {
    const item = data.item;
    const marketPrice = data.marketPriceFlower != null ? `${Number(data.marketPriceFlower).toFixed(4)} FLOWER` : 'Currently unlisted';
    const unitProduceCost = data.unitProduceCostFlower != null ? `${Number(data.unitProduceCostFlower).toFixed(4)} FLOWER` : 'Unpriced';
    const setup = data.setupStatus;

    const econLines = [
      '| Option | Unit Cost | Details |',
      '| :--- | :--- | :--- |',
      `| **Market Purchase** | **${marketPrice}** | Instant purchase via P2P market |`,
      `| **In-House Production** | **${unitProduceCost}** | Feed conversion cost per unit produced |`,
    ];

    if (setup) {
      econLines.push('');
      econLines.push('| Farm Setup Prerequisite | Required | Current Status |');
      econLines.push('| :--- | :--- | :--- |');
      econLines.push(`| **Bumpkin Level** | Level ${setup.buildingUnlockLevel} | ${setup.levelMet ? `✅ Met (Level ${setup.playerLevel})` : `❌ Shortfall (Level ${setup.playerLevel})`} |`);

      const bldCost = setup.initialSetupCost
        ? `${setup.initialSetupCost.coins} Coins, ${Object.entries(setup.initialSetupCost.resources).map(([r, q]) => `${q} ${r}`).join(', ')}`
        : 'Available';
      econLines.push(`| **${setup.buildingName} Building** | ${bldCost} | ${setup.buildingOwned ? `✅ Built (Level ${setup.buildingLevel})` : '❌ Not Built'} |`);
      econLines.push(`| **${setup.animalName} Purchase** | ${setup.animalPurchaseCoins} Coins each | ${setup.animalCount > 0 ? `✅ Owned (${setup.animalCount})` : '❌ 0 Owned'} |`);
    }

    const markdownTable = econLines.join('\n');

    let summaryText = '';
    if (setup?.canProduceNow) {
      summaryText = `Your farm is equipped to produce **${item}** in-house (${setup.animalsSummary}). In-house cost: **${unitProduceCost}** vs Market: **${marketPrice}**.`;
    } else {
      summaryText = `You do NOT yet own a ${setup?.buildingName ?? 'Barn'} or ${setup?.animalName ?? 'animal'}. Recommendation: **Buy from market** for immediate needs, while saving to construct the ${setup?.buildingName ?? 'Barn'} (${setup?.initialSetupCost?.coins ?? 200} Coins, 150 Wood, 10 Iron, 10 Gold) and buy cows (${setup?.animalPurchaseCoins ?? 100} Coins each) for sustainable long-term production.`;
    }

    return {
      status: 'VALID',
      missingKeys: setup?.canProduceNow ? [] : setup?.missingRequirements ?? [],
      synthesis: {
        entityName: item,
        canAfford: Boolean(setup?.canProduceNow),
        rows: [],
        markdownTable,
        summaryText,
        activeBuffs: [],
      },
    };
  }

  /**
   * Synthesize Land Expansion details.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static synthesizeExpansionResults(data: any, farmState?: NormalizedFarmState | null): ValidationReport {
    if (!data) return { status: 'VALID', missingKeys: [] };

    const tableLines = [
      '| Requirement | Required | In Stock | Shortfall | Status |',
      '| :--- | :--- | :--- | :--- | :--- |',
    ];

    if (Array.isArray(data.requirementsTable)) {
      for (const r of data.requirementsTable) {
        const icon = r.status === 'MET' ? '✅ MET' : '❌ SHORTFALL';
        tableLines.push(`| **${r.item}** | ${r.needed} | ${r.stock} | ${r.shortfall > 0 ? `**${r.shortfall}**` : '0'} | ${icon} |`);
      }
    }

    return {
      status: 'VALID',
      missingKeys: [],
      synthesis: {
        canAfford: Boolean(data.canExpand),
        rows: [],
        markdownTable: tableLines.length > 2 ? tableLines.join('\n') : '',
        summaryText: data.summary ?? 'Expansion requirements loaded.',
        activeBuffs: [],
      },
    };
  }

  /**
   * Synthesize Strategic Roadmap & Cooking Recommendations.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static synthesizeRoadmapResults(data: any, farmState?: NormalizedFarmState | null): ValidationReport {
    if (!data || !Array.isArray(data.phases) || data.phases.length === 0) {
      return { status: 'VALID', missingKeys: [] };
    }

    const day1 = data.phases[0]?.dailyObjectives?.[0];
    if (!day1) return { status: 'VALID', missingKeys: [] };

    // 1. Recommended cooking actions
    const cookingActions = (day1.targetActions ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) => a.type === 'COOK' || a.expectedXp
    );

    const actionLines = [
      '| Recommended Dish | Projected XP | Duration | Est. Flower Cost | Reasoning |',
      '| :--- | :--- | :--- | :--- | :--- |',
    ];

    for (const act of cookingActions) {
      const xp = act.expectedXp ? `**${MathHelper.formatNumber(act.expectedXp)} XP**` : 'XP gain';
      const dur = act.durationMinutes ? `${act.durationMinutes}m` : 'Instant';
      const cost = act.estimatedCostFlower != null ? `${act.estimatedCostFlower.toFixed(4)} FLOWER` : '0 FLOWER';
      actionLines.push(`| **${act.item}** | ${xp} | ${dur} | ${cost} | ${act.reasoning ?? 'High XP efficiency'} |`);
    }

    // 2. Ingredient Breakdown / Inventory status
    const ingredientLines = [
      '| Ingredient | In Stock | Needed | Shortfall | Est. Cost (FLOWER) | Action |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ];

    if (Array.isArray(day1.ingredientSummary)) {
      for (const ing of day1.ingredientSummary) {
        const actionStr = ing.status === 'OWNED' ? 'In Stock' : ing.actionType === 'BUY' ? 'Buy from Market' : 'Mine/Forage/Craft';
        ingredientLines.push(
          `| **${ing.item}** | ${ing.owned ?? 0} | ${ing.needed ?? 0} | ${ing.missing > 0 ? `**${ing.missing}**` : '0'} | ${(ing.totalCostFlower ?? 0).toFixed(4)} | ${actionStr} |`
        );
      }
    }

    const combinedTables = [
      actionLines.length > 2 ? actionLines.join('\n') : '',
      '',
      ingredientLines.length > 2 ? '### Required Ingredients & Inventory Status\n' + ingredientLines.join('\n') : '',
    ].filter(Boolean).join('\n');

    const projXp = Math.round(day1.projectedXpGained ?? 0);
    const projCost = (day1.projectedFlowerSpent ?? 0).toFixed(4);
    const summaryText = `Your optimal daily cooking roadmap targets **${projXp.toLocaleString()} XP** for ~**${projCost} FLOWER** in ingredient expenses. Cooking foods and fishing are your only sources of Bumpkin XP.`;

    return {
      status: 'VALID',
      missingKeys: [],
      synthesis: {
        canAfford: true,
        rows: [],
        markdownTable: combinedTables,
        summaryText,
        activeBuffs: [],
      },
    };
  }

  /**
   * Synthesize Bumpkin Level progression requirements.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static synthesizeLevelResults(data: any, farmState?: NormalizedFarmState | null): ValidationReport {
    if (!data) return { status: 'VALID', missingKeys: [] };

    const currentLevel = data.currentLevel ?? farmState?.player?.level ?? 1;
    const currentXp = data.currentXp ?? farmState?.player?.experience ?? 0;
    const targetLevel = data.targetLevel ?? (currentLevel + 1);
    const targetLevelXp = data.targetRequiredCumulativeXp ?? data.targetLevelXp ?? 0;
    const xpRemaining = data.remainingXpToTarget ?? data.xpRemaining ?? Math.max(0, targetLevelXp - currentXp);
    const progressPercent = data.overallProgressPercent ?? data.levelBracketProgressPercent ?? data.progressPercent ?? 0;

    const tableLines = [
      '| Metric | Value |',
      '| :--- | :--- |',
      `| **Current Bumpkin Level** | Level ${currentLevel} |`,
      `| **Current XP** | ${MathHelper.formatNumber(currentXp)} XP |`,
      `| **Target Level** | Level ${targetLevel} |`,
      `| **Cumulative XP Required** | ${MathHelper.formatNumber(targetLevelXp)} XP |`,
      `| **XP Shortfall** | **${MathHelper.formatNumber(xpRemaining)} XP** |`,
      `| **Progress to Next Level** | ${progressPercent.toFixed(2)}% |`,
    ];

    return {
      status: 'VALID',
      missingKeys: xpRemaining > 0 ? [`xp:${xpRemaining}`] : [],
      synthesis: {
        canAfford: xpRemaining === 0,
        requiredLevel: targetLevel,
        currentLevel,
        rows: [],
        markdownTable: tableLines.join('\n'),
        summaryText: xpRemaining === 0
          ? `You have reached Level ${targetLevel}!`
          : `You are Level ${currentLevel} with ${MathHelper.formatNumber(currentXp)} XP. You need **${MathHelper.formatNumber(xpRemaining)} more XP** to reach Level ${targetLevel}.`,
        activeBuffs: [],
      },
    };
  }

  /**
   * Synthesize the deterministic sell plan into a ranked table + exclusions.
   * Every figure here originates from resolve_sell_plan (live prices + inventory);
   * the Explainer must cite these exact numbers and never propose an excluded item.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static synthesizeSellPlanResults(data: any): ValidationReport {
    if (!data) return { status: 'VALID', missingKeys: [] };

    const candidates: any[] = Array.isArray(data.candidates) ? data.candidates : [];
    const excluded: any[] = Array.isArray(data.excluded) ? data.excluded : [];
    const gap = Number(data.gapFlower ?? 0);
    const proceeds = Number(data.proceedsFlower ?? 0);
    const shortfall = Number(data.shortfallFlower ?? 0);
    const gapFilled = Boolean(data.gapFilled);

    const sections: string[] = [];

    if (candidates.length > 0) {
      const rows = [
        '| Item | Qty to Sell | Unit Price (FLOWER) | Total (FLOWER) |',
        '| :--- | :--- | :--- | :--- |',
      ];
      for (const c of candidates) {
        rows.push(
          `| **${c.item}** | ${c.qtyToSell} | ${Number(c.unitPriceFlower ?? 0).toFixed(4)} | **${Number(c.totalFlower ?? 0).toFixed(4)}** |`
        );
      }
      rows.push(`| | | **Total** | **${proceeds.toFixed(4)}** |`);
      sections.push('### Recommended Sell Plan (live P2P prices)');
      sections.push(rows.join('\n'));
    } else {
      sections.push('_No sellable inventory available to raise FLOWER._');
    }

    if (excluded.length > 0) {
      const exRows = [
        '',
        '### Excluded (not offered for sale)',
        '| Item | Reason |',
        '| :--- | :--- |',
      ];
      // Cap to keep the table readable; the tool result carries the full list.
      for (const e of excluded.slice(0, 12)) {
        exRows.push(`| **${e.item}** | ${e.detail ?? e.reason} |`);
      }
      if (excluded.length > 12) exRows.push(`| … | ${excluded.length - 12} more excluded |`);
      sections.push(exRows.join('\n'));
    }

    let summaryText = String(data.summary ?? '');
    if (!summaryText) {
      summaryText = gap > 0
        ? gapFilled
          ? `Selling the ranked items raises ${proceeds.toFixed(4)} FLOWER, covering the ${gap} FLOWER gap.`
          : `Sellable inventory raises at most ${proceeds.toFixed(4)} FLOWER — short ${shortfall.toFixed(4)} FLOWER.`
        : `Sellable inventory is worth ${proceeds.toFixed(4)} FLOWER at live prices.`;
    }

    return {
      status: 'VALID',
      missingKeys: gap > 0 && !gapFilled ? [`flower:${shortfall}`] : [],
      synthesis: {
        canAfford: gapFilled,
        rows: [],
        markdownTable: sections.join('\n'),
        summaryText,
        activeBuffs: [],
      },
    };
  }

  /**
   * Deep validation for specific entity requirements (Crafting, Cooking, Building).
   */
  private static validateEntityRequirements(
    criteria: ValidationCriteria,
    toolResults: Array<AIToolResult<unknown>>,
    farmState?: NormalizedFarmState | null,
    isFarmStateUnavailable?: boolean
  ): ValidationReport {
    const entityName = criteria.requiredEntity!;

    // 1. Locate entity structured data from tool results
    const { entityData, catalogName } = this.extractEntityDataFromTools(entityName, toolResults);

    // If entity not found in tools, trigger targeted retry pass
    if (!entityData) {
      return {
        status: 'INVALID',
        missingKeys: [`entity:${entityName}`],
        critique: `Authoritative game data for '${entityName}' was not found in tool results.`,
        targetTool: {
          name: 'search_knowledge',
          args: { query: entityName },
        },
      };
    }

    // 2. Normalize requirements (Ingredients, Coins, Level, Building)
    const requirements: Record<string, number> = {};
    let requiredCoins = 0;
    let requiredLevel: number | undefined = criteria.requireBumpkinLevel;
    let requiredBuilding: string | undefined = criteria.requireBuildingCheck;

    // Extract coins / price
    if (entityData.price !== undefined && entityData.price > 0) {
      requiredCoins = Number(entityData.price);
      requirements['Coins'] = requiredCoins;
    } else if (entityData.sfl !== undefined && entityData.sfl > 0) {
      requiredCoins = Number(entityData.sfl);
      requirements['Coins'] = requiredCoins;
    }

    // Extract ingredients
    if (entityData.ingredients) {
      if (Array.isArray(entityData.ingredients)) {
        for (const ing of entityData.ingredients) {
          if (ing.item && ing.amount) {
            requirements[ing.item] = Number(ing.amount);
          }
        }
      } else if (typeof entityData.ingredients === 'object') {
        for (const [k, v] of Object.entries(entityData.ingredients)) {
          requirements[k] = Number(v);
        }
      }
    }

    // Extract level requirement
    if (entityData.unlocksAtLevel !== undefined) {
      requiredLevel = Number(entityData.unlocksAtLevel);
    } else if (entityData.level !== undefined) {
      requiredLevel = Number(entityData.level);
    }

    // Extract building / craft source requirement
    if (entityData.building) {
      requiredBuilding = String(entityData.building);
    } else if (catalogName === 'TOOLS') {
      requiredBuilding = 'Blacksmith';
    }

    // ── 3. Handle DATA_UNAVAILABLE (Farm state unavailable) ────────────────
    if (isFarmStateUnavailable) {
      const rows: ResourceDiffRow[] = Object.entries(requirements).map(([item, needed]) => ({
        item,
        needed: MathHelper.roundFloat(needed, 3),
        stock: 0,
        shortfall: MathHelper.roundFloat(needed, 3),
        surplus: 0,
        status: 'SHORTFALL',
        note: 'Stock unknown (Farm state offline)',
      }));

      const markdownTable = MathHelper.formatDiffTable(rows);

      return {
        status: 'DATA_UNAVAILABLE',
        missingKeys: ['farmState'],
        critique: 'Farm state is offline; recipe facts retrieved from KB, but inventory cannot be verified.',
        synthesis: {
          entityName,
          canAfford: false,
          requiredLevel,
          requiredBuilding,
          rows,
          markdownTable,
          summaryText: `Official recipe for ${entityName} requires: ${Object.entries(requirements).map(([i, n]) => `${n} ${i}`).join(', ')}. In-game stock could not be verified.`,
          activeBuffs: [],
          degradedMode: true,
          degradedReason: 'Live farm snapshot is temporarily unavailable. Please check your inventory in-game.',
        },
      };
    }

    // ── 4. Evaluate against Authoritative Farm State ───────────────────────
    // Read from the canonical NormalizedFarmState shape (inventory.all,
    // economy.coins). Fall back to flattened shapes for resilience.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fs = farmState as any;
    const currentInventory: Record<string, number> =
      fs?.inventory?.all ?? (fs?.inventory as Record<string, number>) ?? {};
    const currentCoins =
      fs?.economy?.coins ?? fs?.player?.coins ?? fs?.coins ?? 0;
    const currentLevel = fs?.player?.level ?? 1;

    // MathHelper float-safe diff calculation
    const { rows, canAfford: inventoryMet } = MathHelper.computeResourceDiffs(
      requirements,
      currentInventory,
      currentCoins
    );

    // Level check
    let levelMet = true;
    if (requiredLevel !== undefined && currentLevel < requiredLevel) {
      levelMet = false;
      rows.unshift({
        item: `Bumpkin Level ${requiredLevel}`,
        needed: requiredLevel,
        stock: currentLevel,
        shortfall: requiredLevel - currentLevel,
        surplus: 0,
        status: 'LOCKED_LEVEL',
        note: `Requires Level ${requiredLevel} (Current: ${currentLevel})`,
      });
    }

    // Building check
    let buildingMet = true;
    let buildingStatus = 'Built';
    if (requiredBuilding) {
      const buildings = farmState?.structures?.buildings ?? {};
      const foundBuilding = Object.keys(buildings).find(
        (b) => b.toLowerCase() === requiredBuilding!.toLowerCase()
      );
      if (!foundBuilding) {
        buildingMet = false;
        buildingStatus = 'Missing';
        rows.unshift({
          item: `${requiredBuilding} Building`,
          needed: 1,
          stock: 0,
          shortfall: 1,
          surplus: 0,
          status: 'MISSING_BUILDING',
          note: `Requires ${requiredBuilding} to be constructed on farm`,
        });
      }
    }

    // ── 5. Boosters / Buffs Resolution ─────────────────────────────────────
    let activeEffects: ActiveEffect[] = [];
    try {
      if (farmState) {
        const effectRes = resolveEffectContext(farmState, {
          now: Date.now(),
          season: farmState.temporal?.season,
        });
        activeEffects = effectRes.value.activeEffects ?? [];
      }
    } catch {
      // Fallback: empty effects if resolution fails
    }

    const baseValues = {
      xp: typeof entityData.xp === 'number' ? entityData.xp : undefined,
      cookTime: typeof entityData.cookingSeconds === 'number' ? entityData.cookingSeconds : undefined,
      cost: requiredCoins > 0 ? requiredCoins : undefined,
    };

    const { boostedValues, activeBuffs, buffsImpactText } = MathHelper.applyBoosters(
      entityName,
      baseValues,
      activeEffects,
      requiredBuilding
    );

    // ── 6. Assemble Final Synthesis ─────────────────────────────────────────
    const canAfford = inventoryMet && levelMet && buildingMet;
    const markdownTable = MathHelper.formatDiffTable(rows);

    const shortfalls = rows.filter((r) => r.status !== 'MET');
    let summaryText = '';
    if (canAfford) {
      summaryText = `✅ You have all required ingredients and prerequisites to craft/build **${entityName}**!`;
    } else {
      const missingDetails = shortfalls.map((s) => `${s.item}: need ${MathHelper.formatNumber(s.shortfall || s.needed)}`).join(', ');
      summaryText = `❌ Cannot proceed with **${entityName}**. Shortfalls: ${missingDetails}.`;
    }

    return {
      status: 'VALID',
      missingKeys: shortfalls.map((s) => s.item),
      synthesis: {
        entityName,
        canAfford,
        levelMet,
        requiredLevel,
        currentLevel,
        buildingMet,
        requiredBuilding,
        buildingStatus,
        rows,
        markdownTable,
        summaryText,
        activeBuffs,
        buffsImpactText,
        boostedValues,
        degradedMode: false,
      },
    };
  }

  /**
   * Helper to inspect tool results for entity catalog data.
   */
  private static extractEntityDataFromTools(
    entityName: string,
    toolResults: Array<AIToolResult<unknown>>
  ): { entityData?: any; catalogName?: string } {
    const lowerName = entityName.toLowerCase();

    for (const res of toolResults) {
      if (!res.success || !res.data) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;

      if (res.tool === 'search_knowledge' && Array.isArray(data.results)) {
        for (const item of data.results) {
          if (item.entity && item.entity.toLowerCase() === lowerName && item.structuredData) {
            return { entityData: item.structuredData, catalogName: item.type };
          }
        }
      }

      if (res.tool === 'get_item_metadata' && data.name && data.name.toLowerCase() === lowerName) {
        return { entityData: data, catalogName: data.type };
      }

      if (res.tool === 'compute_recipe_cost' && data.recipe && data.recipe.toLowerCase() === lowerName) {
        return { entityData: data, catalogName: 'RECIPES' };
      }
    }

    return {};
  }
}
