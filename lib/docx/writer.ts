/**
 * Minimal, fidelity-preserving .docx writer.
 *
 * The same discipline as [lib/xlsx/workbook.ts](../xlsx/workbook.ts): treat the file as the zip
 * it is, rewrite only `word/document.xml`, and pass every other entry through untouched. The
 * school's forms carry logos, section geometry, floating table anchors and a page of borders
 * that a general-purpose Word library would rewrite on save.
 *
 * ## Paragraphs are addressed by `w14:paraId`, never by their text
 *
 * This is the whole design, and it exists because of one property of the SF9 template.
 *
 * That form prints **two copies side by side** on one landscape sheet, to be cut apart. The two
 * copies are duplicated *content*, not duplicated *bytes*: in the first, the Name blank is three
 * separate runs (`" ____…"` + `"_________"` + `"_"`); in the second it is one. `LRN: ` is its own
 * run in the first copy and fused with its underscores in the second.
 *
 * So a document-wide find-and-replace fills one copy and silently misses the other - a report
 * card that looks right on the half somebody checked. `w14:paraId` is unique across the part
 * (421 of them in that template, no collisions), so a map naming both copies' ids writes both
 * halves explicitly, and a typo in one is a hard failure rather than a half-filled form.
 *
 * It is the direct equivalent of addressing a cell as `r="G7"` in the xlsx writer.
 *
 * ## What "preserved" means here, precisely
 *
 * `zipSync(unzipSync(x))` re-deflates at fflate's default level, so the output file is not
 * byte-identical to the input - the SF9 template measures 54,060 bytes in and 50,878 out.
 * Untouched parts are identical **after inflation**: the same `Uint8Array` is passed straight
 * through and never re-encoded. Nothing in the OPC format cares about the stored form, but a
 * fidelity check must compare inflated parts rather than files, which is a real difference from
 * what `npm run verify` asserts about the xlsx path.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { readFileSync } from "node:fs";

const BODY = "word/document.xml";

/** Any fixed instant. See `toBuffer()` for why it must not be "now". */
const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");

export class DocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxError";
  }
}

/** Thrown when a map names a paragraph the template does not contain. */
export class MissingParagraphError extends DocxError {
  constructor(paraId: string) {
    super(
      `No paragraph with w14:paraId="${paraId}" in this document. The template has changed, or ` +
        `the map is wrong - either way the form would print with a field silently blank.`,
    );
    this.name = "MissingParagraphError";
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Shared with the reader; kept here so the writer does not depend on it. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** One `<w:t>` element: where its text content sits, and what it says. */
interface TextNode {
  /** Offset of the first character of content, i.e. just past the `>` of the open tag. */
  start: number;
  /** Offset of the `<` of `</w:t>`. */
  end: number;
  text: string;
}

/** A located paragraph, as offsets into the part. */
interface Paragraph {
  /** Offset of `<` of the opening `<w:p`. */
  start: number;
  /** Offset of `<` of the closing `</w:p>`. */
  closeStart: number;
  /** The whole `<w:p …>…</w:p>`. */
  xml: string;
}

export class DocxFile {
  private entries: Record<string, Uint8Array>;
  private body: string;
  private dirty = false;

  private constructor(entries: Record<string, Uint8Array>) {
    this.entries = entries;
    const part = entries[BODY];
    if (!part) throw new DocxError(`Not a readable .docx: no ${BODY} inside.`);
    this.body = strFromU8(part);
  }

  static open(path: string): DocxFile {
    return DocxFile.fromBuffer(readFileSync(path));
  }

  static fromBuffer(bytes: Uint8Array): DocxFile {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new DocxError("Not a readable .docx: the file is not a zip archive.");
    }
    return new DocxFile(entries);
  }

  /** The body part, for tests and for callers that need to assert on the markup. */
  get documentXml(): string {
    return this.body;
  }

  /**
   * Serialise back to .docx bytes.
   *
   * **`mtime` is pinned**, and that is load-bearing rather than tidiness. Left to itself fflate
   * stamps each zip entry with the current time, so generating the same card twice a second
   * apart produces two different files. The SF9 route decides whether a card is a genuine
   * second issuance by comparing hashes, and a timestamp buried in the container would make
   * every reprint look like new work - the learner's record would fill with copies of one card.
   *
   * The value is arbitrary and invisible: Word shows the dates in `docProps`, never the zip
   * entry's. What matters is that identical input produces identical bytes.
   */
  toBuffer(): Uint8Array {
    if (this.dirty) this.entries[BODY] = strToU8(this.body);
    return zipSync(this.entries, { mtime: FIXED_MTIME });
  }

  // -------------------------------------------------------------------------
  // Locating
  // -------------------------------------------------------------------------

  /**
   * Find the `<w:p>` carrying this id.
   *
   * `w14:paraId` also appears on `<w:tr>`, so a bare string search finds table rows too. This
   * walks back to the tag that owns the attribute and rejects anything that is not a paragraph,
   * rather than returning a row whose `</w:p>` is some other paragraph's.
   */
  private paragraph(paraId: string): Paragraph {
    const needle = `w14:paraId="${paraId}"`;
    let at = this.body.indexOf(needle);

    while (at !== -1) {
      const tagStart = this.body.lastIndexOf("<", at);
      if (tagStart !== -1) {
        const name = this.body.slice(tagStart + 1, tagStart + 6);
        if (name.startsWith("w:p") && /^[\s>]/.test(this.body.slice(tagStart + 4, tagStart + 5))) {
          // `</w:p>` and not `</w:pPr>`: the closer needs the `>` immediately after the name.
          const closeStart = this.body.indexOf("</w:p>", tagStart);
          if (closeStart === -1) break;
          return {
            start: tagStart,
            closeStart,
            xml: this.body.slice(tagStart, closeStart + "</w:p>".length),
          };
        }
      }
      at = this.body.indexOf(needle, at + 1);
    }

    throw new MissingParagraphError(paraId);
  }

  /** Every `<w:t>` in a slice, in document order, with content offsets absolute to the part. */
  private textNodes(from: number, to: number): TextNode[] {
    const nodes: TextNode[] = [];
    let cursor = from;

    for (;;) {
      const open = this.body.indexOf("<w:t", cursor);
      if (open === -1 || open >= to) break;

      // `<w:t` also prefixes `<w:tab/>`, `<w:tc>`, `<w:tbl>` and `<w:tblPr>`.
      const after = this.body[open + 4];
      if (after !== ">" && after !== " ") {
        cursor = open + 4;
        continue;
      }

      const openEnd = this.body.indexOf(">", open);
      if (openEnd === -1 || openEnd >= to) break;

      // A self-closing `<w:t/>` holds nothing and cannot be written into in place.
      if (this.body[openEnd - 1] === "/") {
        cursor = openEnd + 1;
        continue;
      }

      const close = this.body.indexOf("</w:t>", openEnd);
      if (close === -1 || close > to) break;

      nodes.push({
        start: openEnd + 1,
        end: close,
        text: unescapeXml(this.body.slice(openEnd + 1, close)),
      });
      cursor = close + "</w:t>".length;
    }

    return nodes;
  }

  /**
   * The run properties to give a run we are inserting.
   *
   * Taken from the paragraph mark's own `<w:pPr><w:rPr>`, which is where Word records the
   * formatting the next character typed into that paragraph would take. Cloning it is not
   * cosmetic: on the SF9, grade cells are 10pt with no font override and attendance cells are
   * 8pt Calibri, so a hardcoded run would print one of them in the wrong face.
   */
  private markProperties(paragraphXml: string): string {
    const pPr = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(paragraphXml);
    if (!pPr) return "";
    const rPr = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(pPr[1]);
    return rPr ? rPr[0] : "";
  }

  /** Splice into the body and remember that the part needs re-encoding. */
  private splice(start: number, end: number, replacement: string): void {
    this.body = this.body.slice(0, start) + replacement + this.body.slice(end);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /** The joined visible text of a paragraph, runs concatenated. */
  paragraphText(paraId: string): string {
    const p = this.paragraph(paraId);
    return this.textNodes(p.start, p.closeStart)
      .map((n) => n.text)
      .join("");
  }

  /**
   * Add a run to the end of a paragraph.
   *
   * The SF9's fillable cells need this rather than a replacement: an empty grade cell is a
   * `<w:p>` with **no run at all** - nothing between `</w:pPr>` and `</w:p>` - so there is no
   * text node to write into. Same shape as `forceFullRecalcOnLoad()` inserting before
   * `</workbook>`, scoped to one paragraph.
   */
  appendRun(paraId: string, text: string): void {
    const p = this.paragraph(paraId);
    const rPr = this.markProperties(p.xml);
    // xml:space unconditionally: a grade is never padded, but a name might be, and a silently
    // trimmed value is the kind of thing nobody notices on a printed form.
    const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    this.splice(p.closeStart, p.closeStart, run);
  }

  /**
   * Replace everything a paragraph says with one run.
   *
   * Drops any formatting that varied within the paragraph, so it suits a field that is wholly
   * ours - a name on its own line - and not a sentence with one emphasised word in it. Use
   * `replaceInParagraph` for that.
   */
  setParagraphText(paraId: string, text: string): void {
    const p = this.paragraph(paraId);
    const rPr = this.markProperties(p.xml);

    // Everything from the end of <w:pPr> (or the open tag) to </w:p> is run content.
    const pPrEnd = p.xml.indexOf("</w:pPr>");
    const contentStart =
      pPrEnd === -1 ? p.start + p.xml.indexOf(">") + 1 : p.start + pPrEnd + "</w:pPr>".length;

    const run = text === "" ? "" : `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    this.splice(contentStart, p.closeStart, run);
  }

  /**
   * Add a paragraph at the end of the body.
   *
   * The one operation here that changes a document's structure rather than its values, and it
   * exists for one purpose: stamping "DRAFT — PENDING SCHOOL CONFIRMATION" into a certificate
   * template, so the marking is part of the file rather than something a fill path could
   * forget to apply.
   *
   * Inserted before `</w:body>` but after the final `<w:sectPr>` would be wrong — the section
   * properties must stay last, or Word treats them as a new section and the page geometry
   * changes. So this goes in ahead of them.
   */
  appendParagraph(text: string, opts: { bold?: boolean; centred?: boolean } = {}): void {
    const sectPr = this.body.lastIndexOf("<w:sectPr");
    const bodyEnd = this.body.lastIndexOf("</w:body>");
    if (bodyEnd === -1) throw new DocxError("No <w:body> to append to.");

    const at = sectPr !== -1 && sectPr < bodyEnd ? sectPr : bodyEnd;
    const jc = opts.centred ? `<w:jc w:val="center"/>` : "";
    const b = opts.bold ? `<w:b/>` : "";
    const para =
      `<w:p><w:pPr>${jc}<w:rPr>${b}</w:rPr></w:pPr>` +
      `<w:r><w:rPr>${b}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

    this.splice(at, at, para);
  }

  /** Is this text anywhere in the document? Used to prove a substitution left nothing behind. */
  contains(text: string): boolean {
    // Against the joined text of every run, so a value split across runs is still found.
    const nodes = this.textNodes(0, this.body.length);
    return nodes.map((n) => n.text).join("").includes(text);
  }

  /**
   * Substitute a string inside a paragraph, however its runs are split.
   *
   * Word breaks a single visible word across runs whenever formatting changes, and does it
   * differently in two copies of the same paragraph - which is the trap this whole module is
   * built around. So the search runs against the *joined* text and the edit is applied to the
   * `<w:t>` nodes the match actually covers.
   *
   * Only text content is touched: runs outside the match keep their formatting exactly, and a
   * bold word elsewhere in the sentence survives.
   *
   * Returns false when the text is not there, so a caller generating a template can tell the
   * difference between "substituted" and "this paragraph did not say what I expected".
   */
  replaceInParagraph(paraId: string, find: string, replacement: string): boolean {
    if (find === "") throw new DocxError("replaceInParagraph needs something to look for.");

    const p = this.paragraph(paraId);
    const nodes = this.textNodes(p.start, p.closeStart);
    const joined = nodes.map((n) => n.text).join("");

    const at = joined.indexOf(find);
    if (at === -1) return false;
    const upTo = at + find.length;

    /*
     * Walk the nodes back to front. Editing changes offsets after the edit point, and going
     * backwards means every splice happens after the offsets still to be used.
     */
    let cursor = joined.length;
    const edits: { start: number; end: number; text: string }[] = [];

    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const nodeEnd = cursor;
      const nodeStart = cursor - node.text.length;
      cursor = nodeStart;

      if (nodeEnd <= at || nodeStart >= upTo) continue; // untouched by the match

      const before = node.text.slice(0, Math.max(0, at - nodeStart));
      const after = node.text.slice(Math.max(0, upTo - nodeStart));
      // The replacement lands whole in the first node the match touches; later nodes keep only
      // whatever trailed the match.
      const isFirst = nodeStart <= at;
      edits.push({
        start: node.start,
        end: node.end,
        text: escapeXml(isFirst ? before + replacement + after : after),
      });
    }

    for (const edit of edits) this.splice(edit.start, edit.end, edit.text);
    return true;
  }
}
