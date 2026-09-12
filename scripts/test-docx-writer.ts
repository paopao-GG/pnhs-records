/**
 * Writing into a Word document without breaking it.
 *
 * This is the riskiest code in the report-card feature, so it is tested on its own rather than
 * only through the forms that use it. The properties that matter:
 *
 *  - **A value spanning several runs is still found.** Word splits one visible word across runs
 *    whenever formatting changes, and does it *differently* in two copies of the same
 *    paragraph — which is exactly how the SF9 template is built. Every fixture here is
 *    hand-written XML rather than something Word produced, because the split has to be
 *    guaranteed rather than hoped for.
 *  - **An inserted run inherits the paragraph mark's formatting.** Grade cells are 10pt with no
 *    font override and attendance cells are 8pt Calibri; a hardcoded run prints one of them
 *    wrong.
 *  - **A paragraph that is not there is an error, not a no-op.** A silently skipped field is a
 *    report card with a blank where a grade should be.
 *  - **Untouched parts survive.** Logos, styles and section geometry are passed through.
 *
 * Run: npm run test:docx-writer
 */

import { strict as assert } from "node:assert";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { DocxFile, MissingParagraphError } from "../lib/docx/writer.ts";

let passed = 0;
const checks: { name: string; fn: () => void }[] = [];
const check = (name: string, fn: () => void) => checks.push({ name, fn });

/** Build a .docx in memory from a body fragment, plus a couple of parts to leave alone. */
function docx(bodyXml: string): Uint8Array {
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>` +
    bodyXml +
    `</w:body></w:document>`;

  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8("<w:styles>untouched</w:styles>"),
    "word/media/image1.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  });
}

/** A paragraph whose text is deliberately split across several runs. */
function splitParagraph(paraId: string, pieces: string[], rPr = ""): string {
  const runs = pieces.map((t) => `<w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r>`).join("");
  return `<w:p w14:paraId="${paraId}" w14:textId="77777777">${runs}</w:p>`;
}

/** An empty table cell as the SF9 template actually holds one: a paragraph with no run. */
function emptyCell(paraId: string, rPr: string): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="517" w:type="dxa"/></w:tcPr>` +
    `<w:p w14:paraId="${paraId}" w14:textId="77777777">` +
    `<w:pPr><w:jc w:val="center"/><w:rPr>${rPr}</w:rPr></w:pPr>` +
    `</w:p></w:tc>`
  );
}

function bodyOf(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)["word/document.xml"]);
}

// --------------------------------------------------------------- run splitting

check("a value split across runs is still found and replaced", () => {
  /*
   * The failure this whole module exists to prevent. Copy A of the SF9 splits its Name blank
   * as 20 + 9 + 1 underscores; a plain string search for thirty of them finds nothing.
   */
  const file = DocxFile.fromBuffer(
    docx(splitParagraph("AAAA1111", [" ____________________", "_________", "_"])),
  );

  const found = file.replaceInParagraph("AAAA1111", "_".repeat(30), "VALENZUELA, Janrine");
  assert.equal(found, true, "the split blank should have been found");
  assert.equal(file.paragraphText("AAAA1111"), " VALENZUELA, Janrine");
});

check("the same value in one run is replaced identically", () => {
  // Copy B of that same field is a single run. Both must end up saying the same thing.
  const file = DocxFile.fromBuffer(
    docx(splitParagraph("BBBB2222", [" " + "_".repeat(30)])),
  );
  assert.equal(file.replaceInParagraph("BBBB2222", "_".repeat(30), "VALENZUELA, Janrine"), true);
  assert.equal(file.paragraphText("BBBB2222"), " VALENZUELA, Janrine");
});

check("text on either side of the match is left alone", () => {
  const file = DocxFile.fromBuffer(
    docx(splitParagraph("CCCC3333", ["LRN: ", "1117981", "20305", " (on file)"])),
  );
  assert.equal(file.replaceInParagraph("CCCC3333", "111798120305", "999900001111"), true);
  assert.equal(file.paragraphText("CCCC3333"), "LRN: 999900001111 (on file)");
});

check("formatting outside the match survives", () => {
  /*
   * Only text content is rewritten, so a bold word elsewhere in the sentence keeps its run.
   * This is what makes the certificate templates safe: the learner's name changes and the
   * surrounding wording keeps whatever emphasis the school gave it.
   */
  const body =
    `<w:p w14:paraId="DDDD4444">` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">This is to certify that </w:t></w:r>` +
    `<w:r><w:t>JANRINE F. VALENZUELA</w:t></w:r>` +
    `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> is a GRADUATE.</w:t></w:r>` +
    `</w:p>`;
  const file = DocxFile.fromBuffer(docx(body));

  assert.equal(file.replaceInParagraph("DDDD4444", "JANRINE F. VALENZUELA", "MARIA SANTOS"), true);
  assert.equal(file.paragraphText("DDDD4444"), "This is to certify that MARIA SANTOS is a GRADUATE.");

  const out = bodyOf(file.toBuffer());
  assert.ok(out.includes("<w:b/>"), "the bold run must survive");
  assert.ok(out.includes("<w:i/>"), "the italic run must survive");
});

check("a value that is not there reports itself rather than pretending", () => {
  const file = DocxFile.fromBuffer(docx(splitParagraph("EEEE5555", ["nothing to see"])));
  assert.equal(file.replaceInParagraph("EEEE5555", "JANRINE", "MARIA"), false);
  assert.equal(file.paragraphText("EEEE5555"), "nothing to see");
});

check("XML-significant characters in a value are escaped", () => {
  const file = DocxFile.fromBuffer(docx(splitParagraph("FFFF6666", ["NAME"])));
  file.replaceInParagraph("FFFF6666", "NAME", "Smith & Sons <Ltd>");
  const out = bodyOf(file.toBuffer());
  assert.ok(out.includes("Smith &amp; Sons &lt;Ltd&gt;"), "must not emit raw markup");
  assert.equal(file.paragraphText("FFFF6666"), "Smith & Sons <Ltd>");
});

// ------------------------------------------------------------------ insertion

check("a run-less cell can be filled, and inherits the paragraph mark's formatting", () => {
  /*
   * Every fillable cell in the SF9 is like this: no run, no <w:t/>, nothing between </w:pPr>
   * and </w:p>. There is nothing to replace, so the writer inserts - and the formatting has to
   * come from <w:pPr><w:rPr>, or the value prints in the wrong size and face.
   */
  const rPr = `<w:rFonts w:ascii="Calibri"/><w:sz w:val="16"/>`;
  const file = DocxFile.fromBuffer(docx(`<w:tbl>${emptyCell("1111AAAA", rPr)}</w:tbl>`));

  assert.equal(file.paragraphText("1111AAAA"), "", "the cell starts empty");
  file.appendRun("1111AAAA", "88");
  assert.equal(file.paragraphText("1111AAAA"), "88");

  const out = bodyOf(file.toBuffer());
  assert.ok(
    out.includes(`<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">88</w:t></w:r>`),
    `the inserted run did not inherit the mark's formatting:\n${out}`,
  );
});

check("setParagraphText replaces every run with one", () => {
  const file = DocxFile.fromBuffer(docx(splitParagraph("2222BBBB", ["old ", "value ", "here"])));
  file.setParagraphText("2222BBBB", "replaced");
  assert.equal(file.paragraphText("2222BBBB"), "replaced");
  assert.equal((bodyOf(file.toBuffer()).match(/<w:t/g) ?? []).length, 1);
});

// -------------------------------------------------------------------- anchors

check("an unknown paragraph is an error, not a silent no-op", () => {
  // A skipped field would print as a blank where a grade belongs.
  const file = DocxFile.fromBuffer(docx(splitParagraph("3333CCCC", ["x"])));
  assert.throws(() => file.appendRun("NOSUCHID", "88"), MissingParagraphError);
  assert.throws(() => file.paragraphText("NOSUCHID"), MissingParagraphError);
});

check("a paraId on a table row is not mistaken for a paragraph", () => {
  /*
   * w14:paraId appears on <w:tr> as well as <w:p>, and the SF9 has one on every row. Matching
   * the row would take the next </w:p> in the document - some other cell's - and write the
   * value into the wrong place entirely.
   */
  const body =
    `<w:tbl><w:tr w14:paraId="ROW00001">` +
    emptyCell("CELL0001", "") +
    `</w:tr></w:tbl>` +
    splitParagraph("ROW00001", ["I am the paragraph"]);
  const file = DocxFile.fromBuffer(docx(body));

  // Both the row and a paragraph carry this id; only the paragraph may be written.
  file.appendRun("ROW00001", "!");
  assert.equal(file.paragraphText("ROW00001"), "I am the paragraph!");
  assert.equal(file.paragraphText("CELL0001"), "", "the cell must not have been touched");
});

check("<w:tab/> and <w:tc> are not mistaken for text nodes", () => {
  // They all start with "<w:t". Only <w:t> and <w:t ...> hold text.
  const body =
    `<w:p w14:paraId="4444DDDD">` +
    `<w:r><w:tab/><w:t>after a tab</w:t></w:r>` +
    `</w:p>`;
  const file = DocxFile.fromBuffer(docx(body));
  assert.equal(file.paragraphText("4444DDDD"), "after a tab");
});

// ------------------------------------------------------------------- container

check("untouched parts come back byte-identical after inflation", () => {
  /*
   * The guarantee this module actually makes. The zip is re-deflated, so the FILE differs -
   * what must not change is the content of every part we did not write.
   */
  const original = docx(splitParagraph("5555EEEE", ["x"]));
  const before = unzipSync(original);

  const file = DocxFile.fromBuffer(original);
  file.setParagraphText("5555EEEE", "y");
  const after = unzipSync(file.toBuffer());

  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "no part may vanish");
  for (const name of ["word/styles.xml", "word/media/image1.png", "[Content_Types].xml"]) {
    assert.deepEqual(
      Array.from(after[name]),
      Array.from(before[name]),
      `${name} was modified and should not have been`,
    );
  }
  assert.ok(strFromU8(after["word/document.xml"]).includes(">y<"), "the edit should be present");
});

check("a document written twice keeps both edits", () => {
  const file = DocxFile.fromBuffer(
    docx(splitParagraph("6666FFFF", ["a"]) + splitParagraph("7777AAAA", ["b"])),
  );
  file.setParagraphText("6666FFFF", "first");
  file.setParagraphText("7777AAAA", "second");
  assert.equal(file.paragraphText("6666FFFF"), "first");
  assert.equal(file.paragraphText("7777AAAA"), "second");
});

check("a paragraph can be appended, and lands before the section properties", () => {
  /*
   * <w:sectPr> must stay last in the body. Appending after it makes Word read it as a new
   * section, which changes the page geometry - on a landscape certificate, that is the whole
   * layout.
   */
  const body = splitParagraph("8888BBBB", ["content"]) + `<w:sectPr><w:cols w:num="2"/></w:sectPr>`;
  const file = DocxFile.fromBuffer(docx(body));
  file.appendParagraph("DRAFT — PENDING SCHOOL CONFIRMATION", { bold: true, centred: true });

  const out = bodyOf(file.toBuffer());
  assert.ok(out.includes("DRAFT — PENDING SCHOOL CONFIRMATION"), "the stamp should be present");
  assert.ok(
    out.indexOf("DRAFT") < out.indexOf("<w:sectPr>"),
    "the appended paragraph must come before <w:sectPr>",
  );
});

check("contains() sees text however its runs are split", () => {
  // The guard that proves a template no longer carries the learner it was made from.
  const file = DocxFile.fromBuffer(docx(splitParagraph("9999CCCC", ["JANRINE F. ", "VALENZ", "UELA"])));
  assert.equal(file.contains("JANRINE F. VALENZUELA"), true);
  file.replaceInParagraph("9999CCCC", "JANRINE F. VALENZUELA", "{{NAME}}");
  assert.equal(file.contains("JANRINE F. VALENZUELA"), false, "the old value must be gone");
  assert.equal(file.contains("{{NAME}}"), true);
});

check("the same input produces byte-identical output", () => {
  /*
   * fflate stamps zip entries with the current time unless told otherwise, which would make
   * every regeneration a different file. The SF9 route tells a reprint from a real second
   * issuance by comparing hashes, so a clock in the container would fill a learner's record
   * with copies of one card.
   */
  const build = () => {
    const f = DocxFile.fromBuffer(docx(splitParagraph("AAAA0001", ["x"])));
    f.setParagraphText("AAAA0001", "same every time");
    return f.toBuffer();
  };
  assert.deepEqual(Array.from(build()), Array.from(build()));
});

check("a file that is not a docx is refused", () => {
  assert.throws(() => DocxFile.fromBuffer(new Uint8Array([1, 2, 3])), /not a zip archive/);
  assert.throws(
    () => DocxFile.fromBuffer(zipSync({ "hello.txt": strToU8("hi") })),
    /no word\/document\.xml/,
  );
});

for (const { name, fn } of checks) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

console.log(
  process.exitCode ? "\ndocx writer: FAILURES above\n" : `\ndocx writer: ${passed} checks passed\n`,
);
