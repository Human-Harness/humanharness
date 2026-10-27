import JSZip from "jszip";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const zip = async (files: Record<string, string>): Promise<Buffer> => {
  const z = new JSZip();
  // `mimetype` first and stored, as ODF and EPUB require.
  if (files.mimetype) z.file("mimetype", files.mimetype, { compression: "STORE" });
  for (const [name, text] of Object.entries(files)) if (name !== "mimetype") z.file(name, text);
  return z.generateAsync({ type: "nodebuffer" });
};

/** A docx: each paragraph with an optional built-in style (`Heading1`, `Heading2`, `ListParagraph`). */
export function makeDocx(paras: { text: string; style?: string; bold?: boolean }[], comment?: string): Promise<Buffer> {
  const body = paras
    .map((p) => {
      const pPr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : "";
      const rPr = p.bold ? "<w:rPr><w:b/></w:rPr>" : "";
      return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
    })
    .join("");
  const commentRef = comment ? `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>` : "";
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${comment ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ""}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${comment ? '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' : ""}</Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}${commentRef}</w:body></w:document>`,
    ...(comment ? { "word/comments.xml": `<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0" w:author="T"><w:p><w:r><w:t>${xmlEsc(comment)}</w:t></w:r></w:p></w:comment></w:comments>` } : {}),
  });
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';
const odf = (mimetype: string, body: string) =>
  zip({
    mimetype,
    "META-INF/manifest.xml": `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body>${body}</office:body></office:document-content>`,
  });

/** An odt from raw `office:text` children. */
export const makeOdt = (inner: string) => odf("application/vnd.oasis.opendocument.text", `<office:text>${inner}</office:text>`);
/** An ods from raw `office:spreadsheet` children. */
export const makeOds = (inner: string) => odf("application/vnd.oasis.opendocument.spreadsheet", `<office:spreadsheet>${inner}</office:spreadsheet>`);
/** An odp from raw `office:presentation` children. */
export const makeOdp = (inner: string) => odf("application/vnd.oasis.opendocument.presentation", `<office:presentation>${inner}</office:presentation>`);

/** A pptx: one entry per slide, a title, body paragraphs and optional speaker notes. */
export function makePptx(slides: { title?: string; body: string[]; notes?: string }[]): Promise<Buffer> {
  const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sp = (text: string[], ph?: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${text.map((t) => `<a:p><a:r><a:t>${xmlEsc(t)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`,
    // Listed in reverse on purpose: the order is the presentation's, not the file names'.
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slides.length - i}.xml"/>`).join("")}</Relationships>`,
  };
  slides.forEach((s, i) => {
    const file = slides.length - i;
    files[`ppt/slides/slide${file}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P}><p:cSld><p:spTree>${s.title ? sp([s.title], "title") : ""}${sp(s.body)}</p:spTree></p:cSld></p:sld>`;
    if (s.notes) {
      files[`ppt/slides/_rels/slide${file}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${file}.xml"/></Relationships>`;
      files[`ppt/notesSlides/notesSlide${file}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:notes ${P}><p:cSld><p:spTree>${sp(["1"], "sldNum")}${sp([s.notes], "body")}</p:spTree></p:cSld></p:notes>`;
    }
  });
  return zip(files);
}

/** An epub with chapters in spine order (each chapter an XHTML body). */
export function makeEpub(chapters: string[]): Promise<Buffer> {
  const files: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    "OEBPS/book.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>${chapters.map((_, i) => `<item id="c${i + 1}" href="text/c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`,
  };
  chapters.forEach((body, i) => {
    files[`OEBPS/text/c${i + 1}.xhtml`] = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>${body}</body></html>`;
  });
  return zip(files);
}
