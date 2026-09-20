const fs = require("fs");
const path = require("path");
const { splitIntoSections } = require("../src/parse");
const {
  buildKnowledgeUnits,
  deriveCategory,
  classifyType,
} = require("../src/knowledgeUnits");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

const markdown = fs.readFileSync(
  path.join(__dirname, "fixture-chickens.md"),
  "utf8"
);

const pageRecord = {
  path: "/en/mechanics/animals/chicken",
  title: "Chickens",
  url: "https://wiki.sfl.world/en/mechanics/animals/chicken",
};

console.log("=== Sections ===\n");
const sections = splitIntoSections(markdown);
for (const s of sections) {
  console.log(`Level ${s.level} | headingPath: ${JSON.stringify(s.headingPath)}`);
}

assert(
  sections.some((s) => JSON.stringify(s.headingPath) === JSON.stringify(["Chickens"])),
  "top-level H1 section captured with headingPath ['Chickens']"
);
assert(
  sections.some(
    (s) =>
      JSON.stringify(s.headingPath) === JSON.stringify(["Chickens", "Feeder machine"])
  ),
  "H2 section nested correctly under H1 in headingPath"
);
assert(
  sections.some(
    (s) =>
      JSON.stringify(s.headingPath) ===
      JSON.stringify(["Chickens", "Feeder machine", "Food"])
  ),
  "H6 section correctly nests three levels deep under H1 > H2, with no null gaps for skipped h3-h5"
);

console.log("\n=== Knowledge units ===\n");
const units = buildKnowledgeUnits(pageRecord, sections);

for (const u of units) {
  console.log("-----");
  console.log("headingPath:", u.headingPath);
  console.log("category:", u.category, "| type:", u.type, "| entity:", u.entity);
  console.log("structuredData:", u.structuredData ? JSON.stringify(u.structuredData).slice(0, 200) + "..." : null);
  console.log("content:\n" + u.content);
}

// The actual table lives one level deeper than "Feeder machine" itself —
// under its "Food" sub-heading — since sections split strictly at heading
// boundaries.
const foodUnit = units.find(
  (u) =>
    JSON.stringify(u.headingPath) ===
    JSON.stringify(["Chickens", "Feeder machine", "Food"])
);
assert(!!foodUnit, "Feeder machine > Food section produced a knowledge unit");
assert(
  foodUnit.content.startsWith("Chickens — Feeder machine — Food"),
  "chunk content is self-contained: prefixed with full page title + heading path"
);
assert(
  foodUnit.content.includes("Level: 0 → 1") && foodUnit.content.includes("XP: 60"),
  "table linearized into generic 'Header: value' lines, not left as a raw pipe table"
);
assert(
  foodUnit.structuredData &&
    foodUnit.structuredData.tables[0][0].Level === "0 → 1" &&
    foodUnit.structuredData.tables[0][0].XP === "60",
  "structured_data preserves the table as row objects keyed by header"
);
assert(
  !foodUnit.content.includes("| ---"),
  "raw pipe-table syntax removed from prose (table lives only in structured/linearized form)"
);

assert(deriveCategory("/en/mechanics/animals/chicken") === "mechanics", "deriveCategory pulls the top segment");
assert(classifyType("Restrictions") === "restriction", "heading heuristic classifies 'Restrictions'");
assert(classifyType("Something else") === "general_information", "unmatched heading falls back to general_information");

const lastUnit = units[units.length - 1];
assert(
  !lastUnit.content.includes("Contributors to this page") &&
    !lastUnit.content.includes("Thebyber"),
  "contributors footer stripped, not glued onto the last section's chunk"
);
