/**
 * server/services/ai/pipeline/Planner.ts
 * Stage 1: Goal Decomposition, Typed Criteria & Execution Planning.
 *
 * ARCHITECTURAL INVARIANT:
 * Breaks user query into concrete execution plan with typed ValidationCriteria.
 * Fast-paths deterministic patterns (recipe XP, buy vs farm, entity recipes, expansions, level XP, skills)
 * to save latency and guarantee the correct tools are invoked.
 */

import type { ExecutionPlan, PipelineIntent, ValidationCriteria, ToolCallSpec, PipelineContext } from './types.js';
import recipesData from '../../../data/recipes.json' with { type: 'json' };

const ALL_GAME_RECIPES = Object.keys(recipesData as Record<string, unknown>).filter(
  (k) => !k.startsWith('_')
);

const KNOWN_RECIPES = Array.from(
  new Set([
    ...ALL_GAME_RECIPES,
    'Boiled Eggs', 'Pancakes', 'Pizza Margherita', 'Apple Pie', 'Beetroot Tart',
    'Sunflower Cake', 'Roast Veggies', 'Club Sandwich', 'Mashed Potato', 'Bumpkin Salad',
    'Rapid Roast', 'Popcorn', 'Antipasto', 'Rice Bun', 'Fruit Salad', 'Orange Squeeze',
    'Apple Juice', 'Purple Smoothie', 'Power Smoothie', 'Bumpkin Broth', 'Pumpkin Soup',
    'Reeling Coleslaw', 'Mushroom Soup', 'Roast Dinner', 'Fish and Chips',
    'Crimstone Infused Fish Oil', 'Steamed Red Rice', 'Fried Calamari', 'Chowder',
    'Cheese', 'Fancy Fries', "Goblin's Treat",
  ])
);

const KNOWN_ANIMAL_PRODUCE: Record<string, string> = {
  milk: 'Milk',
  egg: 'Egg',
  eggs: 'Egg',
  wool: 'Wool',
  leather: 'Leather',
  feather: 'Feather',
  feathers: 'Feather',
  'merino wool': 'Merino Wool',
};

const KNOWN_ENTITIES = [
  ...KNOWN_RECIPES,
  'Iron Pickaxe', 'Stone Pickaxe', 'Gold Pickaxe', 'Wood Pickaxe', 'Axe',
  'Barn', 'Hen House', 'Water Well', 'Bakery', 'Kitchen', 'Deli', 'Smoothie Shack',
  'Milk', 'Egg', 'Wool', 'Honey', 'Wood', 'Stone', 'Iron', 'Gold', 'Crimstone', 'Sunstone',
  'Sunflower', 'Potato', 'Pumpkin', 'Carrot', 'Cabbage', 'Beetroot', 'Cauliflower',
  'Parsnip', 'Eggplant', 'Corn', 'Radish', 'Wheat', 'Kale', 'Soybean',
  'Apple', 'Orange', 'Blueberry', 'Banana', 'Tomato', 'Lemon',
  'Oil', 'Fishing Rod',
];

export class Planner {
  /**
   * Plan execution steps and typed criteria for a user message.
   */
  public static async plan(
    message: string,
    context: PipelineContext,
    priorHistory: Array<{ role: string; content: string }> = []
  ): Promise<ExecutionPlan> {
    const text = message.trim();
    const lower = text.toLowerCase();

    // Context coreference: extract recipe and quantity from prior user messages
    let contextRecipe: string | null = null;
    let contextQuantity: number | null = null;
    if (priorHistory && priorHistory.length > 0) {
      for (let i = priorHistory.length - 1; i >= 0; i--) {
        const h = priorHistory[i];
        if (h.role === 'user') {
          const prevRecipes = this.extractRecipes(h.content);
          if (prevRecipes.length > 0 && !contextRecipe) {
            contextRecipe = prevRecipes[0];
          }
          const prevQty = this.extractQuantity(h.content);
          if (prevQty && prevQty > 1 && !contextQuantity) {
            contextQuantity = prevQty;
          }
        }
      }
    }

    // ── 1. Recipe / Food Cooking, XP & Economics ───────────────────────────
    // Handles:
    // - "how much cost will be for 24 cheese"
    // - "one cheese takes 3 milk" (follow-up specification)
    // - "How much XP will I get from Boiled Eggs or Pancakes with my current buffs and skills?"
    // - "cost to cook 10 pancakes"
    const mentionedRecipes = this.extractRecipes(text);
    const targetRecipe = mentionedRecipes[0] || (
      (lower.includes('cheese') || lower.includes('milk') || lower.includes('take') || lower.includes('cost') || lower.includes('cook') || lower.includes('make') || lower.includes('recipe'))
        ? contextRecipe
        : null
    );

    const isCostOrCraftQuery =
      lower.includes('cost') ||
      lower.includes('price') ||
      lower.includes('ingredient') ||
      lower.includes('ingredients') ||
      lower.includes('take') ||
      lower.includes('takes') ||
      lower.includes('need') ||
      lower.includes('needs') ||
      lower.includes('make') ||
      lower.includes('cook') ||
      lower.includes('produce') ||
      lower.includes('craft') ||
      lower.includes('buy') ||
      lower.includes('flower') ||
      lower.includes('how much') ||
      lower.includes('how many');

    const isXpOrBuffQuery =
      lower.includes('xp') ||
      lower.includes('exp') ||
      lower.includes('buff') ||
      lower.includes('boost') ||
      lower.includes('yield');

    if (targetRecipe && (isXpOrBuffQuery || isCostOrCraftQuery || lower.includes('recipe') || lower.includes('dish') || targetRecipe.toLowerCase() === 'cheese')) {
      const explicitQty = this.extractQuantity(text, targetRecipe);
      const targetQty = (explicitQty && explicitQty > 1)
        ? explicitQty
        : (contextQuantity && contextQuantity > 1 ? contextQuantity : (explicitQty ?? 1));

      const recipesToPlan = mentionedRecipes.length > 0 ? mentionedRecipes : [targetRecipe];
      const plannedTools: ToolCallSpec[] = recipesToPlan.map((rec) => ({
        name: 'compute_recipe_cost',
        args: { recipe: rec, quantity: targetQty },
      }));

      plannedTools.push(
        { name: 'get_market_prices', args: {} },
        { name: 'get_farm_state', args: {} },
        { name: 'get_active_effects', args: {} }
      );

      return {
        userGoal: text,
        intent: 'RECIPE_OR_CRAFT',
        criteria: {
          requiredEntity: targetRecipe,
          quantity: targetQty,
          isCostQuery: isCostOrCraftQuery,
          checkBoosters: true,
          actionType: 'COOK',
        },
        plannedTools,
      };
    }

    // ── 2. Buy vs Farm / Production Economics ───────────────────────────────
    // E.g. "Should I buy Milk from the market or produce it myself with cows?"
    const isBuyQuery =
      lower.includes('buy vs farm') ||
      lower.includes('buy or farm') ||
      lower.includes('farm or buy') ||
      lower.includes('buy vs produce') ||
      lower.includes('produce vs buy') ||
      lower.includes('buy or produce') ||
      lower.includes('produce or buy') ||
      lower.includes('should i buy') ||
      lower.includes('produce it myself') ||
      lower.includes('farm it myself') ||
      (lower.includes('buy') && (lower.includes('market') || lower.includes('produce') || lower.includes('cows') || lower.includes('cow') || lower.includes('chicken') || lower.includes('sheep')));

    const matchedProduce = this.extractAnimalProduce(text);
    if (isBuyQuery || (matchedProduce && (lower.includes('buy') || lower.includes('produce') || lower.includes('cost')))) {
      const targetItem = matchedProduce ?? 'Milk';
      return {
        userGoal: text,
        intent: 'BUY_VS_FARM',
        criteria: {
          requiredEntity: targetItem,
          checkBoosters: true,
        },
        plannedTools: [
          { name: 'evaluate_buy_vs_farm', args: { item: targetItem } },
          { name: 'get_market_prices', args: {} },
          { name: 'get_farm_state', args: {} },
          { name: 'get_active_effects', args: {} },
        ],
      };
    }

    // ── 3. Land Expansion & Island Travel ───────────────────────────────────
    if (
      lower.includes('expansion') ||
      lower.includes('expand') ||
      lower.includes('next plot') ||
      lower.includes('plot 14') ||
      lower.includes('volcano') ||
      lower.includes('desert island')
    ) {
      const isVolcano = lower.includes('volcano');
      return {
        userGoal: text,
        intent: 'EXPANSION',
        criteria: {
          actionType: 'EXPAND',
          checkBoosters: true,
        },
        plannedTools: [
          {
            name: 'get_expansion_details',
            args: isVolcano
              ? { targetIsland: 'volcano', mode: 'reach_island' }
              : {},
          },
          { name: 'get_farm_state', args: {} },
        ],
      };
    }

    // ── 4. Bumpkin Level & Progression XP Requirements ───────────────────────
    // Only triggers for account/bumpkin level XP (e.g. "how much xp i need for level 70")
    if (
      lower.includes('xp i need') ||
      lower.includes('xp needed') ||
      lower.includes('how much xp') ||
      lower.includes('level up') ||
      lower.includes('reach level')
    ) {
      const levelMatch = text.match(/level\s*(\d+)/i);
      const targetLevel = levelMatch ? parseInt(levelMatch[1], 10) : undefined;
      return {
        userGoal: text,
        intent: 'LEVEL_XP',
        criteria: {
          requireBumpkinLevel: targetLevel,
          checkBoosters: true,
        },
        plannedTools: [
          {
            name: 'get_level_requirements',
            args: targetLevel ? { targetLevel } : {},
          },
          { name: 'get_farm_state', args: {} },
        ],
      };
    }

    // ── 5. Skills & Skill Tree Progression ───────────────────────────────────
    if (
      lower.includes('what skill') ||
      lower.includes('which skill') ||
      lower.includes('recommend skill') ||
      lower.includes('unlock skill') ||
      lower.includes('skills')
    ) {
      return {
        userGoal: text,
        intent: 'SKILLS',
        criteria: {
          checkBoosters: true,
        },
        plannedTools: [
          { name: 'get_skills_tree', args: {} },
          { name: 'get_farm_state', args: {} },
        ],
      };
    }

    // ── 6. Codex Deliveries, Chores & Bounties ───────────────────────────────
    if (
      lower.includes('delivery') ||
      lower.includes('deliveries') ||
      lower.includes('codex') ||
      lower.includes('chores') ||
      lower.includes('bounties') ||
      lower.includes('orders')
    ) {
      return {
        userGoal: text,
        intent: 'DELIVERIES',
        criteria: {
          checkBoosters: true,
        },
        plannedTools: [
          { name: 'get_deliveries', args: {} },
          { name: 'get_codex_chores_and_bounties', args: {} },
          { name: 'get_farm_state', args: {} },
        ],
      };
    }

    // ── 7. Roadmap & Strategic Priorities / Cooking Plans ───────────────────
    if (
      lower.includes('prioritize') ||
      lower.includes('what to cook') ||
      lower.includes('what should i cook') ||
      lower.includes('what can i cook') ||
      lower.includes('what should i do') ||
      lower.includes('how can i get the remaining xp') ||
      lower.includes('get the remaining xp') ||
      lower.includes('remaining xp in a day') ||
      lower.includes('remaining xp') ||
      lower.includes('how to get the xp') ||
      lower.includes('try something else') ||
      lower.includes('according to my inventory') ||
      lower.includes('low flower cost') ||
      lower.includes('best dish') ||
      lower.includes('roadmap')
    ) {
      return {
        userGoal: text,
        intent: 'ROADMAP',
        criteria: {
          checkBoosters: true,
        },
        plannedTools: [
          { name: 'get_roadmap', args: { objective: 'MAXIMIZE_XP' } },
          { name: 'get_farm_state', args: {} },
          { name: 'get_active_effects', args: {} },
        ],
      };
    }

    // ── 8. Entity Crafting / Cooking / Building / KB Inquiries ───────────────
    const extractedEntity = this.extractSingleEntity(text);
    if (extractedEntity) {
      const isBuilding = ['barn', 'hen house', 'bakery', 'kitchen', 'deli', 'smoothie shack', 'water well', 'composter'].some(
        (b) => extractedEntity.toLowerCase().includes(b)
      );

      return {
        userGoal: text,
        intent: isBuilding ? 'BUILDING' : 'RECIPE_OR_CRAFT',
        criteria: {
          requiredEntity: extractedEntity,
          checkBoosters: true,
          actionType: isBuilding ? 'BUILD' : 'CRAFT',
        },
        plannedTools: [
          { name: 'search_knowledge', args: { query: extractedEntity } },
          { name: 'get_farm_state', args: {} },
          { name: 'get_active_effects', args: {} },
        ],
      };
    }

    // ── 9. Default General Query ─────────────────────────────────────────────
    return {
      userGoal: text,
      intent: 'GENERAL_QUERY',
      criteria: {
        checkBoosters: true,
      },
      plannedTools: [
        { name: 'search_knowledge', args: { query: text } },
        { name: 'get_farm_state', args: {} },
      ],
    };
  }

  /**
   * Extract quantity from text (e.g. "24 cheese", "cost for 24", "one", "two").
   * Ignores ingredient ratios in formula expressions like "takes 3 milk".
   */
  public static extractQuantity(text: string, targetRecipe?: string | null): number | null {
    const lower = text.toLowerCase();

    // 1. If targetRecipe is known, check for direct prefix e.g. "24 cheese", "24x cheese", "24 of cheese"
    if (targetRecipe) {
      const escaped = targetRecipe.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const recipeMatch = lower.match(new RegExp(`\\b(\\d+)\\s*(?:x\\s*|units?\\s+of\\s+|of\\s+)?${escaped}\\b`, 'i'));
      if (recipeMatch && recipeMatch[1]) {
        const parsed = parseInt(recipeMatch[1], 10);
        if (parsed > 0 && parsed <= 100000) return parsed;
      }
    }

    // 2. Verbs like "for 24", "cook 24", "make 24", "buy 24"
    const verbMatch = text.match(/(?:for|cook|make|craft|buy|produce)\s+(\d+)\b/i);
    if (verbMatch && verbMatch[1]) {
      const parsed = parseInt(verbMatch[1], 10);
      if (parsed > 0 && parsed <= 100000) return parsed;
    }

    // 3. General pattern: number followed by word (excluding ingredient phrases after "takes")
    const cleanedText = text.replace(/\btakes?\s+\d+\s+[a-zA-Z]+/gi, '');
    const numMatch = cleanedText.match(/\b(\d+)\b/);
    if (numMatch && numMatch[1]) {
      const parsed = parseInt(numMatch[1], 10);
      if (parsed > 0 && parsed <= 100000) return parsed;
    }

    // 4. Word numbers for the recipe (e.g. "one cheese")
    const wordNums: Record<string, number> = {
      one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const wordMatch = cleanedText.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
    if (wordMatch && wordMatch[1]) {
      return wordNums[wordMatch[1].toLowerCase()] ?? null;
    }

    return null;
  }

  /**
   * Extract all known recipes mentioned in the input text.
   */
  public static extractRecipes(text: string): string[] {
    const lower = text.toLowerCase();
    const matches: string[] = [];

    // Sort recipes by length descending so multi-word recipes match before single words
    const sortedRecipes = [...KNOWN_RECIPES].sort((a, b) => b.length - a.length);

    for (const recipe of sortedRecipes) {
      const escaped = recipe.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(lower)) {
        if (!matches.includes(recipe)) {
          matches.push(recipe);
        }
      }
    }

    return matches;
  }

  /**
   * Extract animal produce item name from input text.
   */
  public static extractAnimalProduce(text: string): string | null {
    const lower = text.toLowerCase();
    for (const [kw, name] of Object.entries(KNOWN_ANIMAL_PRODUCE)) {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(lower)) {
        return name;
      }
    }
    return null;
  }

  /**
   * Extract single item/building entity for lookup.
   */
  public static extractSingleEntity(text: string): string | null {
    const lower = text.toLowerCase();
    for (const item of KNOWN_ENTITIES) {
      if (lower.includes(item.toLowerCase())) {
        return item;
      }
    }

    // Regex for craft/cook/build X
    const match = text.match(/(?:craft|cook|build|make|buy|recipe for)\s+([a-zA-Z\s]+?)(?:\?|\.|$|for|today|now)/i);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length > 2 && candidate.length < 30) {
        return candidate;
      }
    }

    return null;
  }
}
