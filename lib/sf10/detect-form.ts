/**
 * Works out which SF10 variant a workbook is, so the right parser runs.
 *
 * The discriminator is sheet-name casing, which is consistent across every real file
 * inspected: the SHS template uses `FRONT`/`BACK`/`ANNEX`, the JHS template uses
 * `Front`/`Back`. That is a property of the two DepEd templates themselves, not of any one
 * school's files.
 *
 * Anything unrecognised is rejected rather than guessed at. A permanent record parsed with the
 * wrong cell map would import silently and be wrong in ways nobody notices.
 */

import { Workbook } from "../xlsx/workbook.ts";

export type Sf10Form = "jhs" | "shs" | "f137";

/**
 * A .docx is Form 137; a .xlsx is one of the two SF10 variants.
 *
 * Decided from the bytes, not the filename: the school's files are named inconsistently
 * (`F-137-`, `F-137 `, `SF10-JHS - `) and a misnamed file must not be parsed with the wrong
 * cell map.
 */
export function detectByBytes(bytes: Uint8Array): Sf10Form {
  // Both formats are zips; only .docx carries word/document.xml.
  if (looksLikeDocx(bytes)) return "f137";
  return detectForm(Workbook.fromBuffer(bytes));
}

function looksLikeDocx(bytes: Uint8Array): boolean {
  // Cheap check before unzipping: the marker appears in the zip's central directory.
  const probe = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 6000)));
  if (probe.includes("word/document.xml")) return true;
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 40000)));
  return tail.includes("word/document.xml");
}

export class UnknownFormError extends Error {
  constructor(sheets: string[]) {
    super(
      `Could not tell which SF10 form this is. Expected FRONT/BACK (SHS) or Front/Back (JHS), ` +
        `found: ${sheets.join(", ")}`,
    );
    this.name = "UnknownFormError";
  }
}

export function detectForm(wb: Workbook): "jhs" | "shs" {
  const sheets = wb.sheetNames;
  if (sheets.includes("FRONT") && sheets.includes("BACK")) return "shs";
  if (sheets.includes("Front") && sheets.includes("Back")) return "jhs";
  throw new UnknownFormError(sheets);
}

/** Grade levels a form owns, for the level-scoped replacement on re-import. */
export function levelsOwnedBy(form: Sf10Form): string {
  // Form 137 reuses 7-10 for First-Fourth Year, so it owns the same range as JHS. A learner
  // cannot hold both an SF10-JHS and a Form 137 record; they are different curricula.
  return form === "shs" ? "level >= 11" : "level <= 10";
}
