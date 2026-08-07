/**
 * Minimal, fidelity-preserving XLSX container.
 *
 * The SF10 templates contain embedded logos, printer settings, workbook protection,
 * VML drawings and form-control checkboxes. Full-featured Excel libraries drop several
 * of these on write, which would corrupt an official DepEd form. So we treat the .xlsx
 * purely as a zip: we rewrite ONLY the worksheet XML parts we touch and pass every other
 * entry through untouched.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { readFileSync, writeFileSync } from "node:fs";
import { parseSharedStrings } from "./cells.ts";

export class Workbook {
  private entries: Record<string, Uint8Array>;
  /** Sheet display name -> zip entry path, e.g. "Front" -> "xl/worksheets/sheet1.xml" */
  private sheetPaths = new Map<string, string>();
  private dirty = new Set<string>();
  private xmlCache = new Map<string, string>();
  private sharedStringCache?: string[];

  private constructor(entries: Record<string, Uint8Array>) {
    this.entries = entries;
    this.resolveSheets();
  }

  static open(path: string): Workbook {
    return new Workbook(unzipSync(readFileSync(path)));
  }

  /** Open from bytes already in memory, e.g. an uploaded file. */
  static fromBuffer(bytes: Uint8Array): Workbook {
    return new Workbook(unzipSync(bytes));
  }

  /**
   * Map sheet display names to their zip entry paths by joining workbook.xml
   * (name -> r:id) against workbook.xml.rels (r:id -> target).
   */
  private resolveSheets(): void {
    const wb = this.readEntry("xl/workbook.xml");
    const rels = this.readEntry("xl/_rels/workbook.xml.rels");

    const relTargets = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1];
      const target = /Target="([^"]+)"/.exec(m[0])?.[1];
      if (id && target) {
        relTargets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
      }
    }

    for (const m of wb.matchAll(/<sheet\b[^>]*\/>/g)) {
      const name = /name="([^"]+)"/.exec(m[0])?.[1];
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
      const target = rid ? relTargets.get(rid) : undefined;
      if (name && target) this.sheetPaths.set(unescapeXml(name), target);
    }
  }

  get sheetNames(): string[] {
    return [...this.sheetPaths.keys()];
  }

  /**
   * The workbook's shared string table, needed to resolve `t="s"` cells when reading.
   *
   * Our own writer emits inline strings and never touches sharedStrings.xml, but files saved
   * by Excel - which is every file the school gives us - put almost all text here.
   * Returns an empty array when the part is absent.
   */
  sharedStrings(): string[] {
    if (this.sharedStringCache) return this.sharedStringCache;
    const buf = this.entries["xl/sharedStrings.xml"];
    this.sharedStringCache = buf ? parseSharedStrings(strFromU8(buf)) : [];
    return this.sharedStringCache;
  }

  private readEntry(path: string): string {
    const buf = this.entries[path];
    if (!buf) throw new Error(`xlsx entry not found: ${path}`);
    return strFromU8(buf);
  }

  sheetXml(name: string): string {
    const path = this.sheetPaths.get(name);
    if (!path) {
      throw new Error(`sheet "${name}" not found; have: ${this.sheetNames.join(", ")}`);
    }
    let xml = this.xmlCache.get(path);
    if (xml === undefined) {
      xml = this.readEntry(path);
      this.xmlCache.set(path, xml);
    }
    return xml;
  }

  setSheetXml(name: string, xml: string): void {
    const path = this.sheetPaths.get(name);
    if (!path) throw new Error(`sheet "${name}" not found`);
    this.xmlCache.set(path, xml);
    this.dirty.add(path);
  }

  /**
   * Force Excel to recalculate every formula when the file is opened.
   *
   * We deliberately never write into formula cells (see cells.ts), so the template's own
   * shared formulas still hold stale cached values from whenever it was last saved. This
   * makes Excel refresh them against the quarter ratings we just wrote.
   */
  forceFullRecalcOnLoad(): void {
    const path = "xl/workbook.xml";
    let xml = this.xmlCache.get(path) ?? this.readEntry(path);

    if (/<calcPr\b[^>]*\/>/.test(xml)) {
      xml = xml.replace(/<calcPr\b([^>]*?)\s*\/>/, (_full, attrs: string) => {
        const cleaned = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
        return `<calcPr${cleaned} fullCalcOnLoad="1"/>`;
      });
    } else {
      xml = xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
    }

    this.xmlCache.set(path, xml);
    this.dirty.add(path);
  }

  /** Serialise to .xlsx bytes. Used by the print route, which never touches disk. */
  toBuffer(): Uint8Array {
    for (const entryPath of this.dirty) {
      const xml = this.xmlCache.get(entryPath);
      if (xml !== undefined) this.entries[entryPath] = strToU8(xml);
    }
    return zipSync(this.entries);
  }

  save(path: string): void {
    writeFileSync(path, this.toBuffer());
  }
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
