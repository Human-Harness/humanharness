/** One run of text on a page, in PDF points from the bottom-left corner. */
export interface PdfText {
  x: number;
  y: number;
  size: number;
  text: string;
  bold?: boolean;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/**
 * A small, valid PDF with real text items (Helvetica and Helvetica-Bold, WinAnsi): enough for pdfjs to read sizes and
 * positions. A page with no items has no text layer (a scanned page).
 */
export function makePdf(pages: PdfText[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("PAGES");
  const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const items of pages) {
    const stream = items.map((t) => `BT /${t.bold ? "F2" : "F1"} ${t.size} Tf ${t.x} ${t.y} Td (${esc(t.text)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A page of body text: `lines` lines of 11 pt from y = 700 down, at x. */
export const body = (lines: string[], x = 72, top = 700): PdfText[] => lines.map((text, i) => ({ x, y: top - i * 14, size: 11, text }));
