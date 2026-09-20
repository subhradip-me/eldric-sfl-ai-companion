/**
 * Statically extracts `export const X = {...}` / `export const X = [...]`
 * catalogs out of Sunflower Land's game-data TypeScript files, WITHOUT
 * executing any of the code (these files import dozens of things —
 * webpack/vite path aliases, asset files, React — that don't resolve in
 * a bare Node script). Instead we walk the TS AST and evaluate just the
 * subset of syntax these data files actually use:
 *
 *   - string / numeric / boolean literals
 *   - array and object literals
 *   - `new Decimal(n)`              -> plain number n
 *   - `translate("some.key")`       -> resolved English string, via en.json
 *   - `() => ({ ... })`             -> unwrapped to the object literal itself
 *                                      (a few catalogs are thunks so they're
 *                                      re-created per game session)
 *
 * Anything outside that subset (spreads, conditionals, references to other
 * constants, real function calls) is left as `{ "$unparsed": "<source text>" }`
 * rather than guessed at — better to see exactly what wasn't captured than
 * to silently fabricate a value.
 *
 * Usage:
 *   node extract.js <path-to-sfl-repo> <output-dir>
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const TYPE_FILES = [
  "achievements.ts",
  "animals.ts",
  "banners.ts",
  "beans.ts",
  "buds.ts",
  "buildings.ts",
  "bumpkinSkills.ts",
  "chapters.ts",
  "chests.ts",
  "collectibles.ts",
  "craftables.ts",
  "crops.ts",
  "crustaceans.ts",
  "decorations.ts",
  "desert.ts",
  "expansions.ts",
  "factionShop.ts",
  "fishing.ts",
  "flowers.ts",
  "fruits.ts",
  "garbage.ts",
  "gifts.ts",
  "megastore.ts",
  "milestones.ts",
  "monuments.ts",
  "oilDrill.ts",
  "petShop.ts",
  "pets.ts",
  "quests.ts",
  "resources.ts",
  "rewardBoxes.ts",
  "saltSculpture.ts",
  "seeds.ts",
  "skills.ts",
  "spiceRack.ts",
  "spiceRackProducts.ts",
  "stylist.ts",
  "tools.ts",
  "treasure.ts",
  "withdrawables.ts",
];

function loadDictionary(repoRoot) {
  const p = path.join(
    repoRoot,
    "src/lib/i18n/dictionaries/en.json"
  );
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function unparsed(node) {
  return { $unparsed: node.getText() };
}

function evalExpr(node, ctx) {
  if (!node) return undefined;
  const { dict } = ctx;

  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return node.text;

    case ts.SyntaxKind.NumericLiteral:
      return Number(node.text);

    case ts.SyntaxKind.TrueKeyword:
      return true;
    case ts.SyntaxKind.FalseKeyword:
      return false;
    case ts.SyntaxKind.NullKeyword:
      return null;

    // A bare reference to another top-level const in the same file (e.g.
    // `"New Years Crown": CAN_WITHDRAW_AND_TRADE`). Resolved lazily
    // against the file's own declaration table, memoized, with cycle
    // protection in case two consts reference each other.
    case ts.SyntaxKind.Identifier:
      return resolveIdentifier(node.text, ctx);

    case ts.SyntaxKind.PrefixUnaryExpression:
      if (
        node.operator === ts.SyntaxKind.MinusToken &&
        node.operand.kind === ts.SyntaxKind.NumericLiteral
      ) {
        return -Number(node.operand.text);
      }
      return unparsed(node);

    case ts.SyntaxKind.ArrayLiteralExpression:
      return node.elements.map((el) => evalExpr(el, ctx));

    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = propName(prop.name);
          obj[key] = evalExpr(prop.initializer, ctx);
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          // e.g. `{ item, amount }` — the name IS the identifier to
          // resolve, same as the Identifier case above.
          obj[prop.name.text] = resolveIdentifier(prop.name.text, ctx);
        } else if (ts.isSpreadAssignment(prop)) {
          const spreadValue = evalExpr(prop.expression, ctx);
          if (spreadValue && typeof spreadValue === "object") {
            Object.assign(obj, spreadValue);
          } else {
            obj.$spread = unparsed(prop.expression);
          }
        }
      }
      return obj;
    }

    case ts.SyntaxKind.NewExpression: {
      const calleeName = node.expression.getText();
      if (calleeName === "Decimal" && node.arguments && node.arguments[0]) {
        const arg = evalExpr(node.arguments[0], ctx);
        return typeof arg === "number" ? arg : unparsed(node);
      }
      if (calleeName === "Date" && node.arguments && node.arguments[0]) {
        const arg = evalExpr(node.arguments[0], ctx);
        if (typeof arg === "string") return arg; // keep as ISO date string
      }
      return unparsed(node);
    }

    case ts.SyntaxKind.CallExpression: {
      const calleeName = node.expression.getText();
      if (calleeName === "translate" && node.arguments[0]) {
        const key = evalExpr(node.arguments[0], ctx);
        if (typeof key === "string") {
          return dict[key] !== undefined ? dict[key] : { $missingTranslation: key };
        }
      }
      return unparsed(node);
    }

    case ts.SyntaxKind.ParenthesizedExpression:
      return evalExpr(node.expression, ctx);

    case ts.SyntaxKind.BinaryExpression: {
      const left = evalExpr(node.left, ctx);
      const right = evalExpr(node.right, ctx);
      if (typeof left === "number" && typeof right === "number") {
        switch (node.operatorToken.kind) {
          case ts.SyntaxKind.AsteriskToken:
            return left * right;
          case ts.SyntaxKind.SlashToken:
            return left / right;
          case ts.SyntaxKind.PlusToken:
            return left + right;
          case ts.SyntaxKind.MinusToken:
            return left - right;
        }
      }
      return unparsed(node);
    }

    case ts.SyntaxKind.ArrowFunction:
      return evalExpr(node.body, ctx);

    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.TypeAssertionExpression:
      return evalExpr(node.expression, ctx);

    default:
      return unparsed(node);
  }
}

// Resolves a bare identifier against the file's own top-level const/let
// declarations, memoized and cycle-guarded. Falls through to a marker
// (rather than throwing or guessing) for anything genuinely external —
// an import, a function, a value from another module.
function resolveIdentifier(name, ctx) {
  if (ctx.resolved.has(name)) return ctx.resolved.get(name);
  if (!ctx.declMap.has(name)) return { $unresolvedIdentifier: name };
  if (ctx.resolving.has(name)) return { $circularReference: name };

  ctx.resolving.add(name);
  const value = evalExpr(ctx.declMap.get(name), ctx);
  ctx.resolving.delete(name);
  ctx.resolved.set(name, value);
  return value;
}

function propName(nameNode) {
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode)) return nameNode.text;
  if (ts.isComputedPropertyName(nameNode)) return nameNode.getText();
  return nameNode.getText();
}

// Pass 1 for one file: index its top-level const/let declarations by
// name into a shared, cross-file map (declMap/exportedNames are shared
// across every file processed this run — see main()). Many of these
// data files import a constant from a sibling file (e.g. banners.ts
// uses `CHAPTER_BANNERS` from chapters.ts); a single global map lets
// the identifier resolver find those without caring which file they
// came from. Name collisions across files are assumed rare enough for
// this data set to not bother namespacing — true so far in practice.
function indexFile(filePath, declMap, exportedNames) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    path.basename(filePath),
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const namesInThisFile = [];

  sourceFile.statements.forEach((stmt) => {
    if (!ts.isVariableStatement(stmt)) return;
    const isExported =
      stmt.modifiers &&
      stmt.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      declMap.set(decl.name.text, decl.initializer);
      namesInThisFile.push(decl.name.text);
      if (isExported) exportedNames.add(decl.name.text);
    }
  });

  return namesInThisFile;
}

function extractCatalogsForNames(names, ctx) {
  const catalogs = {};
  for (const name of names) {
    const value = resolveIdentifier(name, ctx);
    const isUseful =
      value &&
      typeof value === "object" &&
      !(
        Object.keys(value).length === 1 &&
        ("$unparsed" in value ||
          "$unresolvedIdentifier" in value ||
          "$circularReference" in value)
      );
    if (isUseful) catalogs[name] = value;
  }
  return catalogs;
}

function countUnparsed(value, counts = { unparsed: 0, total: 0 }) {
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const isPureMarker =
      keys.length === 1 &&
      ("$unparsed" in value ||
        "$unresolvedIdentifier" in value ||
        "$circularReference" in value ||
        "$missingTranslation" in value);
    if (isPureMarker) {
      counts.unparsed++;
      counts.total++;
      return counts;
    }
    for (const v of Object.values(value)) countUnparsed(v, counts);
  } else {
    counts.total++;
  }
  return counts;
}

function main() {
  const [, , repoRoot, outDir] = process.argv;
  if (!repoRoot || !outDir) {
    console.error("Usage: node extract.js <path-to-sfl-repo> <output-dir>");
    process.exit(1);
  }

  const typesDir = path.join(repoRoot, "src/features/game/types");
  const dict = loadDictionary(repoRoot);
  fs.mkdirSync(outDir, { recursive: true });

  // Pass 1: index every file's top-level declarations into ONE shared
  // map, so identifiers can resolve across files (e.g. banners.ts's
  // `...CHAPTER_BANNERS` spread, which is actually declared in
  // chapters.ts).
  const declMap = new Map();
  const exportedNames = new Set();
  const namesByFile = new Map();

  for (const file of TYPE_FILES) {
    const filePath = path.join(typesDir, file);
    if (!fs.existsSync(filePath)) continue;
    const names = indexFile(filePath, declMap, exportedNames);
    namesByFile.set(file, names);
  }

  const ctx = { dict, declMap, resolved: new Map(), resolving: new Set() };

  // Pass 2: evaluate and write output per file, using the shared context
  // (so a name resolved while processing one file is memoized for every
  // other file that also references it).
  const summary = [];

  for (const file of TYPE_FILES) {
    const names = namesByFile.get(file);
    if (!names) {
      console.log(`SKIP  ${file} (not found)`);
      continue;
    }

    const catalogs = extractCatalogsForNames(names, ctx);
    const catalogNames = Object.keys(catalogs);
    if (catalogNames.length === 0) {
      console.log(`EMPTY ${file} (no useful object/array catalogs found)`);
      continue;
    }

    const outPath = path.join(outDir, file.replace(/\.ts$/, ".json"));
    fs.writeFileSync(outPath, JSON.stringify(catalogs, null, 2));

    const counts = countUnparsed(catalogs);
    const pct = ((counts.unparsed / counts.total) * 100).toFixed(1);
    summary.push({ file, catalogs: catalogNames, unparsedPct: pct });
    console.log(
      `OK    ${file} -> ${catalogNames.join(", ")}  (${pct}% leaves unparsed)`
    );
  }

  fs.writeFileSync(
    path.join(outDir, "_summary.json"),
    JSON.stringify(summary, null, 2)
  );
}

main();
