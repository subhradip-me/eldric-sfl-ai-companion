/**
 * Splits a page's markdown into heading-based sections (preserving
 * heading_path), and extracts any pipe-tables out of each section's body
 * into structured {headers, rows} form — separately from the prose.
 *
 * Deliberately simple line-based parsing rather than a full AST (remark/
 * unified): the crawler's Markdown output is already clean and consistent
 * (ATX headings, standard pipe tables), so a full parser would be more
 * machinery than the input needs. Revisit if the wiki's formatting turns
 * out to be less uniform than it looks so far.
 */

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function isPipeRow(line) {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}

function isSeparatorRow(line) {
  const t = line.trim();
  return /^\|(\s*:?-+:?\s*\|)+$/.test(t);
}

// Split a pipe row into cells, respecting an escaped "\|" inside a cell
// (our table converter escapes literal pipes this way) and un-escaping it
// back to a literal "|" for storage.
function splitPipeRow(line) {
  const t = line.trim();
  const parts = t.split(/(?<!\\)\|/);
  // First and last parts are the text outside the leading/trailing pipes
  // (normally empty) — drop them.
  const cells = parts.slice(1, -1);
  return cells.map((c) => c.trim().replace(/\\\|/g, "|"));
}

/**
 * Scans a section's body lines for one or more pipe-table blocks. Returns
 * { proseLines, tables } where proseLines has the table lines removed
 * (nothing else is touched) and tables is an array of { headers, rows }
 * (rows is an array of arrays, in source order).
 */
function extractTables(bodyLines) {
  const proseLines = [];
  const tables = [];
  let i = 0;

  while (i < bodyLines.length) {
    const line = bodyLines[i];
    const next = bodyLines[i + 1];

    if (isPipeRow(line) && next !== undefined && isSeparatorRow(next)) {
      const headers = splitPipeRow(line);
      const rows = [];
      let j = i + 2;
      while (j < bodyLines.length && isPipeRow(bodyLines[j])) {
        rows.push(splitPipeRow(bodyLines[j]));
        j++;
      }
      tables.push({ headers, rows });
      i = j; // skip past the whole table block
      continue;
    }

    proseLines.push(line);
    i++;
  }

  return { proseLines, tables };
}

/**
 * Splits full page markdown into sections. Each section is:
 *   { level, heading, headingPath, bodyLines }
 * `headingPath` is the stack of ancestor headings down to and including
 * this one (e.g. ["Chickens", "Feeder machine"]).
 * Content before the first heading (if any) becomes a section with
 * level 0 and heading null.
 */
// Every wiki page ends with a "Contributors to this page" blockquote
// (author credits). It has nothing to do with game content, and because
// sectioning is heading-based, it silently glues onto whichever heading
// happens to be last on the page — polluting that one chunk. Since it's
// always the final thing on the page, we can just cut everything from
// that marker onward.
const CONTRIBUTORS_FOOTER_RE = /^>\s*\*\*Contributors to this page\*\*/im;

function stripTrailingContributorsFooter(markdown) {
  const match = markdown.match(CONTRIBUTORS_FOOTER_RE);
  if (!match) return markdown;
  return markdown.slice(0, match.index).trimEnd();
}

function splitIntoSections(rawMarkdown) {
  const markdown = stripTrailingContributorsFooter(rawMarkdown);
  const lines = markdown.split("\n");
  const sections = [];

  // Stack of {level, heading}, popped whenever a new heading is at the
  // same or shallower level. This — rather than indexing an array by
  // absolute heading level — is what lets us cope with the wiki skipping
  // levels (e.g. an <h2> followed directly by an <h6>, which shows up
  // more than once in the source): the <h6> just nests one level deeper
  // than whatever's currently on the stack, with no null gaps for the
  // unused h3/h4/h5 slots.
  const stack = [];

  let current = { level: 0, heading: null, headingPath: [], bodyLines: [] };
  sections.push(current);

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      const level = m[1].length;
      const heading = m[2].trim();

      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, heading });

      current = {
        level,
        heading,
        headingPath: stack.map((s) => s.heading),
        bodyLines: [],
      };
      sections.push(current);
    } else {
      current.bodyLines.push(line);
    }
  }

  // Drop the leading empty section if the page had no pre-heading content
  return sections.filter(
    (s) => s.heading !== null || s.bodyLines.some((l) => l.trim() !== "")
  );
}

module.exports = {
  splitIntoSections,
  extractTables,
  splitPipeRow,
  stripTrailingContributorsFooter,
};
