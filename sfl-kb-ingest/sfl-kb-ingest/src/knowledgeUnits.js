const crypto = require("crypto");
const { extractTables } = require("./parse");

// Keep this small on purpose — per the "don't over-engineer yet" advice,
// this is a rough first pass. Expand it once real retrieval failures show
// which distinctions actually matter for Eldric's answers.
const TYPE_RULES = [
  [/require|cost|material|need to build/i, "base_requirement"],
  [/restrict|cannot|not allowed|limit/i, "restriction"],
  [/unlock/i, "unlock_rule"],
  [/prerequisite/i, "prerequisite"],
];

// A chunk's content is capped here mostly as a safety net for the rare
// huge table/section, not as the primary chunking strategy — most wiki
// sections are already a sensible size once split by heading.
const MAX_CHUNK_CHARS = 6000;

function contentHash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function classifyType(headingText) {
  if (!headingText) return "general_information";
  for (const [re, type] of TYPE_RULES) {
    if (re.test(headingText)) return type;
  }
  return "general_information";
}

// "/en/mechanics/animals/chicken" -> "mechanics"
// Coarse on purpose — a filterable dimension for hybrid retrieval, not a
// full taxonomy.
function deriveCategory(path) {
  const segments = path.split("/").filter(Boolean);
  return segments[1] || null;
}

function cleanProse(lines) {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Turn a parsed {headers, rows} table into:
//  - structured: an array of row objects (header -> cell value)
//  - linearized: the generic "Header: value" text block described in the
//    ingestion-strategy doc — written once, not per-table-shape, so new
//    tables never need a special case.
function linearizeTable({ headers, rows }) {
  const structured = rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h || `col${i}`] = row[i] ?? "";
    });
    return obj;
  });

  const linearized = rows
    .map((row) =>
      headers.map((h, i) => `${h || `col${i}`}: ${row[i] ?? ""}`).join("\n")
    )
    .join("\n\n");

  return { structured, linearized };
}

/**
 * Builds one or more knowledge-unit chunks for a single section.
 * Each chunk's `content` is self-contained: it's prefixed with the page
 * title + heading path so it makes sense in isolation, per the "every
 * chunk should be self-contained" rule.
 */
function buildChunksForSection(section, pageMeta) {
  const { proseLines, tables } = extractTables(section.bodyLines);
  const prose = cleanProse(proseLines);

  const contextHeader = [pageMeta.title, ...section.headingPath.slice(1)]
    .filter(Boolean)
    .join(" — ");

  const tableInfo = tables.map(linearizeTable);

  // Build an ordered list of blocks (prose first, then each table) and
  // pack them into chunks under MAX_CHUNK_CHARS. Tables are never split
  // mid-table — if one alone exceeds the cap, it just becomes an
  // oversized chunk on its own rather than being torn apart.
  const blocks = [];
  if (prose) blocks.push({ text: prose, structured: null });
  tableInfo.forEach(({ structured, linearized }) => {
    blocks.push({ text: linearized, structured });
  });

  if (blocks.length === 0) {
    blocks.push({ text: "(no content)", structured: null });
  }

  const chunks = [];
  let bufferText = "";
  let bufferStructured = [];

  const flush = () => {
    if (!bufferText.trim()) return;
    const content = [contextHeader, bufferText.trim()]
      .filter(Boolean)
      .join("\n\n");
    chunks.push({
      headingPath: section.headingPath,
      chunkIndex: chunks.length,
      content,
      structuredData: bufferStructured.length
        ? { tables: bufferStructured }
        : null,
      contentHash: contentHash(content),
    });
    bufferText = "";
    bufferStructured = [];
  };

  for (const block of blocks) {
    const candidateLength = bufferText.length + block.text.length + 2;
    if (bufferText && candidateLength > MAX_CHUNK_CHARS) {
      flush();
    }
    bufferText = bufferText ? `${bufferText}\n\n${block.text}` : block.text;
    if (block.structured) bufferStructured.push(block.structured);
  }
  flush();

  return chunks;
}

/**
 * Full pipeline for one crawled page record (as produced by the crawler's
 * wiki-dump.jsonl) -> an array of knowledge-unit chunks ready to embed.
 */
function buildKnowledgeUnits(pageRecord, sections) {
  const category = deriveCategory(pageRecord.path);
  const units = [];

  for (const section of sections) {
    const chunks = buildChunksForSection(section, pageRecord);
    const type = classifyType(section.heading);

    for (const chunk of chunks) {
      units.push({
        ...chunk,
        category,
        type,
        entity: pageRecord.title,
      });
    }
  }

  return units;
}

module.exports = {
  buildKnowledgeUnits,
  buildChunksForSection,
  linearizeTable,
  classifyType,
  deriveCategory,
  contentHash,
};
