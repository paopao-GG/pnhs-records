/**
 * Minimal .docx reader — just enough of WordprocessingML to read Form 137.
 *
 * A .docx is a zip whose `word/document.xml` holds the body. We need five element types:
 * paragraphs (`w:p`), tables (`w:tbl`), rows (`w:tr`), cells (`w:tc`) and text runs (`w:t`).
 *
 * ## Why a scanner rather than regular expressions
 *
 * Word splits a single visible word across several runs whenever formatting changes, so text
 * must be joined per paragraph before it means anything: `FEM ALE`, `Year: 19 82`,
 * `Gen. Av e: 80` are all one field in the document. A regex pass over `<w:t>` during
 * investigation also leaked raw markup into the extracted text, because `<w:t>` and
 * `<w:t xml:space="preserve">` interleave with `<w:tab/>` and nested run properties.
 *
 * This walks tags in order and tracks depth instead, which is both correct and dependency-free.
 * It is deliberately not a general XML parser — it understands only the elements above.
 */

import { unzipSync, strFromU8 } from "fflate";
import { readFileSync } from "node:fs";

export interface DocxTable {
  /** Row-major cell text, already joined and whitespace-collapsed. */
  rows: string[][];
  /** Position among all tables in the document, in reading order. */
  index: number;
}

export interface DocxDocument {
  /** Paragraph text outside tables, in reading order, runs joined. */
  paragraphs: string[];
  tables: DocxTable[];
  /** Complete `word/embeddings/*.xlsx` parts, in name order. */
  embeddings: { name: string; bytes: Uint8Array }[];
}

export class NotADocxError extends Error {
  constructor(reason: string) {
    super(`Not a readable .docx: ${reason}`);
    this.name = "NotADocxError";
  }
}

export function readDocx(path: string): DocxDocument {
  return readDocxBytes(readFileSync(path));
}

export function readDocxBytes(bytes: Uint8Array): DocxDocument {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new NotADocxError("the file is not a zip archive");
  }

  const body = entries["word/document.xml"];
  if (!body) throw new NotADocxError("no word/document.xml inside");

  const embeddings = Object.keys(entries)
    .filter((k) => k.startsWith("word/embeddings/") && k.toLowerCase().endsWith(".xlsx"))
    .sort()
    .map((name) => ({ name, bytes: entries[name] }));

  return { ...parseBody(strFromU8(body)), embeddings };
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
}

/** Next tag at or after `from`, or null at end of input. */
function nextTag(xml: string, from: number): { start: number; tag: Tag } | null {
  const start = xml.indexOf("<", from);
  if (start === -1) return null;
  const end = xml.indexOf(">", start);
  if (end === -1) return null;

  const raw = xml.slice(start + 1, end);
  const closing = raw.startsWith("/");
  const selfClosing = raw.endsWith("/");
  const name = raw
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split(/[\s>]/)[0];

  return { start, tag: { name, closing, selfClosing, end } };
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * Walk the body once, accumulating text into whichever container is currently open.
 *
 * Depth counters rather than a tree: tables never nest in these documents, and a paragraph
 * inside a table cell belongs to the cell, not to the body.
 */
function parseBody(xml: string): { paragraphs: string[]; tables: DocxTable[] } {
  const paragraphs: string[] = [];
  const tables: DocxTable[] = [];

  let tableDepth = 0;
  let currentTable: string[][] | null = null;
  let currentRow: string[] | null = null;
  let cellText: string | null = null;
  let paraText: string | null = null;

  let inText = false;
  let textStart = 0;
  let cursor = 0;

  for (;;) {
    const found = nextTag(xml, cursor);
    if (!found) break;
    const { start, tag } = found;

    if (inText && tag.name === "w:t" && tag.closing) {
      const chunk = unescapeXml(xml.slice(textStart, start));
      if (cellText !== null) cellText += chunk;
      else if (paraText !== null) paraText += chunk;
      inText = false;
    } else if (tag.name === "w:t" && !tag.closing && !tag.selfClosing) {
      inText = true;
      textStart = tag.end + 1;
    } else if (tag.name === "w:tab" || tag.name === "w:br") {
      // Layout separators carry meaning here: fields sit in tab-separated columns.
      if (cellText !== null) cellText += " ";
      else if (paraText !== null) paraText += " ";
    } else if (tag.name === "w:tbl" && !tag.closing && !tag.selfClosing) {
      tableDepth++;
      if (tableDepth === 1) currentTable = [];
    } else if (tag.name === "w:tbl" && tag.closing) {
      tableDepth--;
      if (tableDepth === 0 && currentTable) {
        tables.push({ rows: currentTable, index: tables.length });
        currentTable = null;
      }
    } else if (tag.name === "w:tr" && !tag.closing && !tag.selfClosing && tableDepth === 1) {
      currentRow = [];
    } else if (tag.name === "w:tr" && tag.closing && tableDepth === 1) {
      if (currentTable && currentRow) currentTable.push(currentRow);
      currentRow = null;
    } else if (tag.name === "w:tc" && !tag.closing && !tag.selfClosing && tableDepth === 1) {
      cellText = "";
    } else if (tag.name === "w:tc" && tag.closing && tableDepth === 1) {
      if (currentRow && cellText !== null) currentRow.push(collapse(cellText));
      cellText = null;
    } else if (tag.name === "w:p" && !tag.closing && !tag.selfClosing) {
      // Paragraphs inside a cell contribute to the cell, not to the body.
      if (tableDepth === 0) paraText = "";
      else if (cellText !== null && cellText !== "") cellText += " ";
    } else if (tag.name === "w:p" && tag.closing) {
      if (tableDepth === 0 && paraText !== null) {
        const text = collapse(paraText);
        if (text) paragraphs.push(text);
        paraText = null;
      }
    }

    cursor = tag.end + 1;
  }

  return { paragraphs, tables };
}
