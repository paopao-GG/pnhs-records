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

export type Sf10Form = "jhs" | "shs";

export class UnknownFormError extends Error {
  constructor(sheets: string[]) {
    super(
      `Could not tell which SF10 form this is. Expected FRONT/BACK (SHS) or Front/Back (JHS), ` +
        `found: ${sheets.join(", ")}`,
    );
    this.name = "UnknownFormError";
  }
}

export function detectForm(wb: Workbook): Sf10Form {
  const sheets = wb.sheetNames;
  if (sheets.includes("FRONT") && sheets.includes("BACK")) return "shs";
  if (sheets.includes("Front") && sheets.includes("Back")) return "jhs";
  throw new UnknownFormError(sheets);
}
