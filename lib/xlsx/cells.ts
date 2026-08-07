/**
 * Cell-level surgery on worksheet XML.
 *
 * Two facts about the SF10 templates make this safe and simple:
 *
 *  1. Every cell in the used range already exists in the XML carrying its style attribute
 *     (e.g. `<c r="G7" s="50"/>`), because Excel persists styled-but-empty cells. So we
 *     only ever UPDATE cells - we never have to insert one in column order, and we never
 *     have to guess at formatting. Preserving `s=` preserves borders, font and alignment.
 *
 *  2. The templates are full of SHARED formulas (`<f t="shared" si="N"/>`), which break in
 *     confusing ways if their host cell is rewritten. We therefore refuse to write into any
 *     cell containing a formula. Final ratings, general averages and PASSED/FAILED are
 *     computed by the template itself - we supply only the inputs.
 *
 * Text is written as `t="inlineStr"` so sharedStrings.xml never has to be touched.
 */

export type CellValue = string | number | null;

/** Thrown when a write targets a formula cell - almost always a bad cell map. */
export class FormulaCellError extends Error {
  constructor(addr: string) {
    super(
      `refusing to write to ${addr}: it contains a formula. ` +
        `The template computes this value itself - write only its inputs.`,
    );
    this.name = "FormulaCellError";
  }
}

export class MissingCellError extends Error {
  constructor(addr: string) {
    super(
      `cell ${addr} does not exist in the sheet XML. ` +
        `The cell map is wrong, or the address is outside the template's used range.`,
    );
    this.name = "MissingCellError";
  }
}

function cellPattern(addr: string): RegExp {
  // Attributes are matched non-greedily as a group so we can recover `s=`.
  // `r="G7"` cannot partially match `r="AG7"`, so no extra anchoring is needed.
  return new RegExp(`<c r="${addr}"((?:\\s+[\\w:]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`);
}

/**
 * Write a value into an existing cell, preserving its style.
 * Returns the updated sheet XML.
 */
export function setCell(xml: string, addr: string, value: CellValue): string {
  const re = cellPattern(addr);
  const m = re.exec(xml);
  if (!m) throw new MissingCellError(addr);

  const [full, attrs = "", inner] = m;
  if (inner && /<f[\s/>]/.test(inner)) throw new FormulaCellError(addr);

  const style = /\ss="\d+"/.exec(attrs)?.[0] ?? "";
  const replacement = renderCell(addr, style, value);

  return xml.slice(0, m.index) + replacement + xml.slice(m.index + full.length);
}

/** Apply many writes in one pass. Skips undefined/empty values rather than blanking cells. */
export function setCells(xml: string, values: Record<string, CellValue | undefined>): string {
  let out = xml;
  for (const [addr, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    out = setCell(out, addr, value);
  }
  return out;
}

function renderCell(addr: string, style: string, value: CellValue): string {
  if (value === null || value === "") return `<c r="${addr}"${style}/>`;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot write non-finite number to ${addr}`);
    return `<c r="${addr}"${style}><v>${value}</v></c>`;
  }

  const text = escapeXml(value);
  // xml:space is required or Excel silently trims leading/trailing spaces.
  const space = value !== value.trim() ? ' xml:space="preserve"' : "";
  return `<c r="${addr}"${style} t="inlineStr"><is><t${space}>${text}</t></is></c>`;
}

/**
 * Read a cell's value. Handles inline strings, shared strings, numbers and the cached
 * result of a formula.
 *
 * Reading the cached result matters for import: in the school's real files most final
 * grades are literal values rather than formulas, because they were pasted in. We take
 * whatever the cell holds either way.
 */
export function getCell(
  xml: string,
  addr: string,
  sharedStrings: string[] = [],
): CellValue {
  const m = cellPattern(addr).exec(xml);
  if (!m) return null;

  const attrs = m[1] ?? "";
  const inner = m[2];
  if (!inner) return null;

  const type = /\st="(\w+)"/.exec(attrs)?.[1];

  if (type === "inlineStr") {
    const parts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
    return parts.length ? unescapeXml(parts.join("")) : null;
  }

  const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (raw === undefined) return null;

  if (type === "s") return sharedStrings[Number(raw)] ?? null;
  if (type === "e") return null; // cached formula error, e.g. #DIV/0! on an empty template
  if (type === "str") return unescapeXml(raw);

  const n = Number(raw);
  return Number.isNaN(n) ? unescapeXml(raw) : n;
}

/** Parse xl/sharedStrings.xml into an index-addressable array. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
    out.push(unescapeXml(parts.join("")));
  }
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
