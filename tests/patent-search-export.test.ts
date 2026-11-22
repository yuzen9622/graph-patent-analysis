import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseExcel } from "@/lib/excel-parser";
import { applicantMatches, buildTwipQuery } from "@/lib/patent-search/twip-format";
import { buildPatentWorkbook } from "@/lib/patent-search/export-xlsx";
import { validateSearchPlan, type PatentSourceRecord, type SearchPlan } from "@/lib/patent-search/contracts";

const plan: SearchPlan = { keywords: ["金融"], match: "all", applicants: [], dateField: "filing", dateFrom: null, dateTo: null, ipc: [], sort: "relevance", limit: 20 };
const record: PatentSourceRecord = {
  id: "fixture-1", title: "測試用金融資料處理系統", titleEn: "Test financial processing system", abstract: "此為相容性測試資料，包含繁體中文與換行。\n第二行。", applicants: ["測試機構"],
  applicationNumber: "001234567", filingDate: "2023-01-02", publicationNumber: "I0123456", publicationDate: "2024-01-03",
  sourceUrl: "https://cloud.tipo.gov.tw/s690/twipsearch/#/patent/detail?id=fixture-1&database=TWB", retrievedAt: "2026-11-15T00:00:00.000Z",
};

function arrayBuffer(bytes: Uint8Array) { return Uint8Array.from(bytes).buffer; }

describe("search plan validation", () => {
  it.each([0, -1, 1.5])("rejects an invalid retrieval limit %s", (limit) => expect(() => validateSearchPlan({ ...plan, limit })).toThrow());
  it("accepts all results and explicit counts above 100", () => {
    expect(validateSearchPlan({ ...plan, limit: undefined }).limit).toBeNull();
    expect(validateSearchPlan({ ...plan, limit: null }).limit).toBeNull();
    expect(validateSearchPlan({ ...plan, limit: 1001 }).limit).toBe(1001);
  });
  it("searches applicants and dates without inventing title or abstract keywords", () => {
    expect(buildTwipQuery({ ...plan, keywords: [], applicants: ["臺灣銀行"], dateFrom: "2000-01-01" }))
      .toBe('AANM:("臺灣銀行") AND APD:[2000-01-01 TO *]');
    expect(() => validateSearchPlan({ ...plan, keywords: [] })).toThrow("至少提供");
  });
  it("rejects reversed and nonexistent dates", () => {
    expect(() => validateSearchPlan({ ...plan, dateFrom: "2025-01-01", dateTo: "2024-01-01" })).toThrow();
    expect(() => validateSearchPlan({ ...plan, dateFrom: "2025-02-30" })).toThrow();
  });
  it("rejects arbitrary source URLs and unsupported fields", () => expect(() => validateSearchPlan({ ...plan, url: "http://127.0.0.1" })).toThrow());
});

describe("generated patent workbook", () => {
  it("preserves finance-template columns, zero counts and additional inventors", async () => {
    const inventors = Array.from({ length: 33 }, (_, i) => "發明人甲" + i);
    const result = await buildPatentWorkbook([{ ...record, bibliography: {
      certificate: "", issue: "20-08", ipc: ["G06Q040/08"], design: "",
      owners: [], inventors, agents: [], priority: "", references: [], status: "核准", citedCount: 0, kind: "B",
    } }], plan);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer(result.bytes));
    const sheet = workbook.worksheets[0];
    const headers = sheet.getRow(1).values as string[];
    expect(sheet.name).toBe("原始資料");
    expect(headers.filter(h => h === "申請日")).toHaveLength(2);
    expect(headers[97]).toBe("案件狀態");
    expect(headers[98]).toBe("發明人33");
    expect(sheet.getRow(2).getCell(98).text).toBe(inventors[32]);
    expect(sheet.getRow(2).getCell(headers.indexOf("被參考次數")).value).toBe(0);
    expect(parseExcel(arrayBuffer(result.bytes), "finance.xlsx").patents[0].ipc5).toEqual(["G06Q40/08"]);
  });

  it("matches the bank legal entity among joint applicants and excludes subsidiaries", () => {
    expect(applicantMatches(["共同申請人", "台灣銀行股份有限公司"], ["臺灣銀行"])).toBe(true);
    expect(applicantMatches(["臺灣銀行人壽保險股份有限公司"], ["臺灣銀行"])).toBe(false);
  });

  it("round-trips real workbook bytes through the unmodified Format A parser", async () => {
    const result = await buildPatentWorkbook([record], plan);
    const parsed = parseExcel(arrayBuffer(result.bytes), "patents.xlsx");
    expect(parsed.errors).toEqual([]);
    expect(parsed.format).toBe("A");
    expect(parsed.patents).toHaveLength(1);
    expect(parsed.patents[0]).toMatchObject({ title: record.title, abstract: record.abstract, application_number: "001234567", publication_number: "I0123456", filing_date: "2023-01-02" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer(result.bytes));
    expect(workbook.worksheets[0].name).toBe("專利清單");
    expect(workbook.getWorksheet("資料來源")?.getCell("B2").text).toBe(record.sourceUrl);
  });

  it("preserves distinct multi-word applicant names without changing the existing parser", async () => {
    const records = [
      { ...record, applicants: ["Bank of America", "共同申請機構"] },
      { ...record, id: "fixture-2", applicationNumber: "001234568", publicationNumber: "I0123457", applicants: ["Bank of Taiwan"] },
    ];
    const result = await buildPatentWorkbook(records, plan);
    const parsed = parseExcel(arrayBuffer(result.bytes), "patents.xlsx");
    expect(parsed.errors).toEqual([]);
    expect(parsed.patents.flatMap((patent) => patent.applicants ?? [])).toEqual(expect.arrayContaining(["Bank of America", "Bank of Taiwan", "共同申請機構"]));
    expect(parsed.patents.flatMap((patent) => patent.applicants ?? [])).not.toContain("Bank");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer(result.bytes));
    expect(workbook.getWorksheet("專利清單")?.getCell("G2").text).toBe(record.publicationNumber);
  });

  it("rejects malformed explicit applicant metadata rather than falling back to truncated names", async () => {
    const result = await buildPatentWorkbook([{ ...record, applicants: ["Bank of America"] }], plan);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer(result.bytes));
    workbook.worksheets[0].getCell("J2").value = '{"name":"Bank of America"}';
    const parsed = parseExcel(Uint8Array.from(new Uint8Array(await workbook.xlsx.writeBuffer())).buffer, "patents.xlsx");
    expect(parsed.patents).toHaveLength(0);
    expect(parsed.errors.join(" ")).toContain("完整申請人欄位格式錯誤");
  });

  it("leaves legacy workbooks on their existing applicant cleaning path", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("專利清單");
    sheet.addRow(["專利名稱(中)", "摘要", "申請人"]);
    sheet.addRow(["舊格式測試", "舊格式測試摘要", "Bank of America"]);
    const parsed = parseExcel(Uint8Array.from(new Uint8Array(await workbook.xlsx.writeBuffer())).buffer, "legacy.xlsx");
    expect(parsed.patents[0].applicants).toEqual(["Bank"]);
  });

  it("keeps formula-shaped external text as a string cell", async () => {
    const title = '=HYPERLINK("https://example.invalid", "test")';
    const result = await buildPatentWorkbook([{ ...record, title }], plan);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer(result.bytes));
    expect(workbook.worksheets[0].getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(workbook.worksheets[0].getCell("A2").value).toBe(title);
  });

  it("reports missing required fields and duplicate sources rather than inventing content", async () => {
    const result = await buildPatentWorkbook([record, record, { ...record, id: "missing", abstract: " " }], plan);
    expect(result.included).toHaveLength(1);
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded.map((row) => row.id)).toEqual(["fixture-1", "missing"]);
    expect(parseExcel(arrayBuffer(result.bytes), "patents.xlsx").patents).toHaveLength(1);
  });

  it("rejects an empty export and non-official provenance", async () => {
    await expect(buildPatentWorkbook([], plan)).rejects.toThrow("沒有可匯出的專利");
    await expect(buildPatentWorkbook([{ ...record, sourceUrl: "https://example.invalid/patent" }], plan)).rejects.toThrow();
  });
});
