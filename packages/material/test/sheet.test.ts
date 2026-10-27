import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { csvSheets, odsSheets, rowCount, sheetSummary, xlsxSheets } from "../src";
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

  it("the summary fragment: sheets, columns, row counts and the first rows", () => {
    const md = sheetSummary([{ name: "Data", header: "| a |\n|---|", columns: ["a"], rows: Array.from({ length: 30 }, (_, i) => ({ md: `| ${i} |`, loc: `Data!A${i + 2}:A${i + 2}` })) }], 2);
    expect(md).toBe("## Data\n\nColumns: a. Rows: 30.\n\n| a |\n|---|\n| 0 |\n| 1 |");
  });
});
