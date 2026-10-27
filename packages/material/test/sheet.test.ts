import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { SHEET_MAX_CELLS, SHEET_MAX_ROWS, csvSheets, odsSheets, rowCount, sheetSummary, xlsxSheets } from "../src";
import { makeOds } from "./make-office";

async function makeXlsx(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) wb.addWorksheet(name).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("spreadsheets (§3)", () => {
  it("xlsx: header row, data rows with cell ranges, formulas as their values, dates as ISO", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRows([["name", "value", "when"], ["a", 1, new Date(Date.UTC(2026, 0, 2))], ["b|c", 2]]);
    ws.getCell("B4").value = { formula: "B2+B3", result: 3 };
    ws.getCell("A4").value = "total";
    const sheets = await xlsxSheets(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ name: "Data", header: "| name | value | when |\n|---|---|---|", columns: ["name", "value", "when"] });
    expect(sheets[0].rows).toEqual([
      { md: "| a | 1 | 2026-01-02 |", loc: "Data!A2:C2" },
      { md: "| b\\|c | 2 |  |", loc: "Data!A3:C3" },
      { md: "| total | 3 |  |", loc: "Data!A4:C4" },
    ]);
  });

  it("empty sheets are skipped; several sheets keep their order", async () => {
    const sheets = await xlsxSheets(await makeXlsx({ One: [["x"], [1]], Empty: [], Two: [["y"], [2]] }));
    expect(sheets.map((s) => s.name)).toEqual(["One", "Two"]);
    expect(rowCount(sheets)).toBe(2);
  });

  it("a broken xlsx is refused as unreadable", async () => {
    await expect(xlsxSheets(Buffer.from("not a zip"))).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("csv and tsv: quotes, commas and new lines inside quotes", () => {
    const [s] = csvSheets(Buffer.from('a,b\n"x, y","line\nnext"\n'), ",", "notes.csv");
    expect(s.name).toBe("notes.csv");
    expect(s.rows).toEqual([{ md: "| x, y | line next |", loc: "notes.csv!A2:B2" }]);
    expect(csvSheets(Buffer.from("a\tb\n1\t2\n"), "\t", "t.tsv")[0].rows[0].md).toBe("| 1 | 2 |");
  });

  it("ods: repeated rows and cells", async () => {
    const buf = await makeOds(
      `<table:table table:name="S"><table:table-row><table:table-cell><text:p>k</text:p></table:table-cell><table:table-cell><text:p>v</text:p></table:table-cell></table:table-row>` +
        `<table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"><text:p>z</text:p></table:table-cell></table:table-row>` +
        `<table:table-row table:number-rows-repeated="1000"><table:table-cell/></table:table-row></table:table>`,
    );
    const [s] = await odsSheets(buf);
    expect(s.rows.map((r) => r.md)).toEqual(["| z | z |", "| z | z |"]);
  });

  it("ods: an empty run in the middle keeps the rows' real numbers", async () => {
    const row = (v: string) => `<table:table-row><table:table-cell><text:p>${v}</text:p></table:table-cell></table:table-row>`;
    const buf = await makeOds(`<table:table table:name="S">${row("h")}<table:table-row table:number-rows-repeated="5"><table:table-cell/></table:table-row>${row("x")}</table:table>`);
    expect((await odsSheets(buf))[0].rows).toEqual([{ md: "| x |", loc: "S!A7:A7" }]);
  });

  it("xlsx: only the cells the file holds; columns empty across the sheet are dropped (a cell in XFD is no bomb)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    for (let r = 1; r <= 2000; r++) {
      ws.getCell(r, 1).value = r === 1 ? "first" : "a";
      ws.getCell(r, 16384).value = r === 1 ? "last" : "z";
    }
    const [s] = await xlsxSheets(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(s.columns).toEqual(["first", "last"]);
    expect(s.rows[0]).toEqual({ md: "| a | z |", loc: "S!A2:XFD2" });
    expect(s.rows).toHaveLength(1999);
    expect(s.cut).toBeUndefined();
  });

  it("csv: a column empty across the sheet is dropped", () => {
    const [s] = csvSheets(Buffer.from("a,,c\n1,,3\n"), ",", "x.csv");
    expect(s.header).toBe("| a | c |\n|---|---|");
    expect(s.rows).toEqual([{ md: "| 1 | 3 |", loc: "x.csv!A2:C2" }]);
  });

  it("csv: more rows than SHEET_MAX_ROWS are cut, and the summary says so", () => {
    const text = `n\n${Array.from({ length: 200_000 }, (_, i) => i).join("\n")}\n`;
    const [s] = csvSheets(Buffer.from(text), ",", "big.csv");
    expect(s.rows).toHaveLength(SHEET_MAX_ROWS - 1);
    expect(s.cut).toBe(true);
    expect(sheetSummary([s], 1)).toContain(`Rows: ${SHEET_MAX_ROWS - 1} (the file has more; it was too large to read whole).`);
  });

  it("ods: repeats multiply within one budget (a 2 KB file claiming 100 000 rows × 5 000 cells)", async () => {
    const buf = await makeOds(
      `<table:table table:name="S"><table:table-row table:number-rows-repeated="100000"><table:table-cell table:number-columns-repeated="5000"><text:p>zz</text:p></table:table-cell></table:table-row></table:table>` +
        `<table:table table:name="T"><table:table-row table:number-rows-repeated="100000"><table:table-cell table:number-columns-repeated="5000"><text:p>zz</text:p></table:table-cell></table:table-row></table:table>`,
    );
    const sheets = await odsSheets(buf);
    const cells = sheets.reduce((n, s) => n + (s.rows.length + 1) * s.columns.length, 0);
    expect(cells).toBeLessThanOrEqual(SHEET_MAX_CELLS + 2 * 5000);
    expect(sheets.every((s) => s.cut)).toBe(true);
  });

  it("the summary fragment: sheets, columns, row counts and the first rows", () => {
    const md = sheetSummary([{ name: "Data", header: "| a |\n|---|", columns: ["a"], rows: Array.from({ length: 30 }, (_, i) => ({ md: `| ${i} |`, loc: `Data!A${i + 2}:A${i + 2}` })) }], 2);
    expect(md).toBe("## Data\n\nColumns: a. Rows: 30.\n\n| a |\n|---|\n| 0 |\n| 1 |");
  });
});
