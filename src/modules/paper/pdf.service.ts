import path from "path";
import PDFDocument from "pdfkit";
import { QuestionPaperDoc } from "../../models/QuestionPaper";

const DIFF_LABEL: Record<string, string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Challenging",
};

const LETTERS = "ABCDEFGH";

// Bundled Unicode-capable fonts (DejaVu Sans) so model output containing Ω, ₹,
// superscripts, etc. renders correctly — pdfkit's built-in Helvetica cannot.
// Resolved from the backend cwd so it works under both tsx (dev) and node dist (prod).
const FONT_DIR = path.resolve(process.cwd(), "assets/fonts");
const FONT = { body: "Body", bold: "Body-Bold" } as const;

// Disable OpenType ligatures everywhere: DejaVu's fi/fl/ff ligature glyphs get
// dropped by pdfkit's font subsetter ("filament" → "flament"), so we render
// plain glyphs instead.
const NO_LIGATURES = { features: [] as [] };

/**
 * Renders a QuestionPaper into a cleanly formatted, exam-style PDF using pdfkit.
 * No headless browser — deploy-friendly. Returns a piped PDFDocument; the caller
 * sets headers and pipes it to the response.
 */
export function buildPaperPdf(paper: QuestionPaperDoc): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  doc.registerFont(FONT.body, path.join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont(FONT.bold, path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  // Text helpers that always disable ligatures (see NO_LIGATURES above).
  type Opts = PDFKit.Mixins.TextOptions;
  const text = (str: string, opts: Opts = {}) => doc.text(str, { ...NO_LIGATURES, ...opts });
  const textAt = (str: string, x: number, y: number, opts: Opts = {}) =>
    doc.text(str, x, y, { ...NO_LIGATURES, ...opts });
  const heightOf = (str: string, opts: Opts) =>
    doc.heightOfString(str, { ...NO_LIGATURES, ...opts });

  // Start a new page if `needed` vertical space won't fit before the bottom margin.
  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottom) doc.addPage();
  };

  const rule = () => {
    doc.moveDown(0.4);
    doc
      .moveTo(left, doc.y)
      .lineTo(left + pageWidth, doc.y)
      .lineWidth(1)
      .strokeColor("#303030")
      .stroke();
    doc.moveDown(0.6);
  };

  // ── Header ──
  doc.fillColor("#303030").font(FONT.bold).fontSize(17);
  text(paper.meta?.school || "School", { align: "center" });
  doc.font(FONT.body).fontSize(11).moveDown(0.3);
  if (paper.meta?.subject) text(`Subject: ${paper.meta.subject}`, { align: "center" });
  if (paper.meta?.class) text(`Class: ${paper.meta.class}`, { align: "center" });
  rule();

  // ── Meta row ──
  const metaY = doc.y;
  doc.font(FONT.body).fontSize(10);
  textAt(`Time Allowed: ${paper.meta?.timeAllowed || "—"}`, left, metaY);
  textAt(`Maximum Marks: ${paper.meta?.maxMarks ?? 0}`, left, metaY, {
    width: pageWidth,
    align: "right",
  });
  doc.moveDown(0.9);
  doc.font("Helvetica-Oblique").fontSize(9.5);
  doc.text("All questions are compulsory unless stated otherwise.", left);
  doc.moveDown(0.9);

  // ── Student fields ──
  doc.font(FONT.body).fontSize(10);
  const fieldLine = (label: string) => {
    const y = doc.y;
    textAt(label, left, y, { continued: false });
    doc
      .moveTo(left + 110, y + 10)
      .lineTo(left + 330, y + 10)
      .lineWidth(0.7)
      .strokeColor("#303030")
      .stroke();
    doc.moveDown(1);
  };
  fieldLine("Name:");
  fieldLine("Roll Number:");
  fieldLine(`Class: ${paper.meta?.class || ""}   Section:`);
  doc.moveDown(0.6);

  // ── Sections ──
  doc.lineGap(2); // a touch more line spacing for readability throughout the body
  let qNumber = 0;
  for (const section of paper.sections) {
    doc.moveDown(1.2); // breathing room above each section
    ensureSpace(110); // don't strand a section heading at the bottom of a page
    doc.font(FONT.bold).fontSize(13).fillColor("#303030");
    // Anchor at the left margin with the full content width so the title centers
    // across the page — earlier question/option rendering leaves doc.x indented,
    // which would otherwise center the title within the shifted (narrower) span.
    textAt(section.title, left, doc.y, { width: pageWidth, align: "center" });
    doc.moveDown(0.6);
    if (section.instruction) {
      doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#444");
      doc.text(section.instruction, left);
      doc.fillColor("#303030").moveDown(0.6);
    }

    doc.font(FONT.body).fontSize(10);
    for (const q of section.questions) {
      qNumber += 1;
      const tag = DIFF_LABEL[q.difficulty] ?? q.difficulty;
      // Difficulty tag sits right beside the marks, both flush to the right margin.
      const rightLabel = `[${tag}]    [${q.marks} ${q.marks === 1 ? "Mark" : "Marks"}]`;
      const rightWidth = doc.widthOfString(rightLabel) + 12;
      const qLine = `${qNumber}.  ${q.text}`;

      // Measure the whole question block (text + option rows) up front, then make
      // sure it fits — this keeps the question text and its right-aligned label on
      // the same page instead of splitting across a page break.
      const colWidth = (pageWidth - 20) / 2;
      const optRowHeight = (oi: number) => {
        const hL = heightOf(`${LETTERS[oi]})  ${q.options[oi]}`, { width: colWidth - 10 });
        const hR =
          q.options[oi + 1] !== undefined
            ? heightOf(`${LETTERS[oi + 1]})  ${q.options[oi + 1]}`, { width: colWidth - 10 })
            : 0;
        return Math.max(hL, hR);
      };
      let blockHeight = heightOf(qLine, { width: pageWidth - rightWidth });
      if (q.options?.length) {
        blockHeight += 6; // gap before options
        for (let oi = 0; oi < q.options.length; oi += 2) blockHeight += optRowHeight(oi);
      }
      ensureSpace(blockHeight + 8);

      const startY = doc.y;
      textAt(qLine, left, startY, { width: pageWidth - rightWidth, align: "left" });
      const afterQuestionY = doc.y;
      // Difficulty + marks, right-aligned on the question's first line.
      textAt(rightLabel, left, startY, { width: pageWidth, align: "right" });
      doc.y = afterQuestionY;

      // MCQ options (A) … D)) indented under the question, two per row.
      if (q.options?.length) {
        doc.moveDown(0.3);
        for (let oi = 0; oi < q.options.length; oi += 2) {
          const rowY = doc.y;
          textAt(`${LETTERS[oi]})  ${q.options[oi]}`, left + 20, rowY, { width: colWidth - 10 });
          const leftEndY = doc.y;
          let rightEndY = leftEndY;
          if (q.options[oi + 1] !== undefined) {
            textAt(`${LETTERS[oi + 1]})  ${q.options[oi + 1]}`, left + 20 + colWidth, rowY, {
              width: colWidth - 10,
            });
            rightEndY = doc.y;
          }
          doc.y = Math.max(leftEndY, rightEndY);
        }
      }
      doc.moveDown(0.85);
    }
    doc.moveDown(1.2); // breathing room below each section
  }

  doc.moveDown(0.6);
  ensureSpace(30);
  doc.font(FONT.bold).fontSize(11);
  textAt("End of Question Paper", left, doc.y);

  // ── Answer key ──
  if (paper.answerKey?.length) {
    doc.addPage();
    doc.font(FONT.bold).fontSize(12.5);
    textAt("Answer Key", left, doc.y);
    rule();
    doc.font(FONT.body).fontSize(10).fillColor("#303030");
    for (const a of paper.answerKey) {
      textAt(`${a.index}.  ${a.answer}`, left, doc.y, { width: pageWidth, align: "left" });
      doc.moveDown(0.65);
    }
  }

  return doc;
}
