import { addFinanceSheet } from "./finance-sheet";
import ExcelJS from "exceljs";
import { parseExcel } from "../excel-parser";
import { COMPLETE_APPLICANTS_COLUMN } from "./workbook-contract";
import { sourceRecordSchema, validateSearchPlan, type PatentSourceRecord, type SearchPlan } from "./contracts";

const HEADERS = ["專利名稱(中)", "專利名稱(英)", "摘要", "申請人", "申請日", "申請號", "公開公告號", "公開公告日", "搜尋關鍵字", COMPLETE_APPLICANTS_COLUMN];

export async function buildPatentWorkbook(records: readonly PatentSourceRecord[], input: SearchPlan) {
  const plan = validateSearchPlan(input);
  const included: PatentSourceRecord[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const inputRecord of records) {
    const record = sourceRecordSchema.parse(inputRecord);
    const reason = seen.has(record.id) ? "重複來源"
      : !record.title.trim() ? "缺少專利名稱"
      : !record.abstract.trim() ? "缺少摘要"
      : Object.values(record).some((value) => typeof value === "string" && value.length > 32767) || record.applicants.join("；").length > 32767 || JSON.stringify(record.applicants).length > 32767 ? "欄位超過 Excel 儲存格長度上限" : null;
    if (reason) { excluded.push({ id: record.id, reason }); continue; }
    seen.add(record.id);
    included.push(record);
  }
  if (included.length === 0) throw new Error("沒有可匯出的專利，請確認資料包含專利名稱與摘要。");

  const workbook = new ExcelJS.Workbook();
  if (included.every(record => record.bibliography)) addFinanceSheet(workbook, included);
  const sheet = workbook.addWorksheet("專利清單");
  sheet.addRow(HEADERS);
  for (const record of included) {
    sheet.addRow([record.title, record.titleEn, record.abstract, record.applicants.join("；"), record.filingDate,
      record.applicationNumber, record.publicationNumber, record.publicationDate, plan.keywords.join("、"), JSON.stringify(record.applicants)]);
  }
  sheet.columns.forEach((column, index) => { column.width = index === 2 ? 70 : index < 2 ? 40 : 22; column.numFmt = "@"; });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `J${included.length + 1}` };

  const warnings: string[] = [];

  const sources = workbook.addWorksheet("資料來源");
  sources.addRow(["公開公告號", "官方來源", "擷取時間", "搜尋條件"]);
  for (const record of included) sources.addRow([record.publicationNumber, record.sourceUrl, record.retrievedAt, JSON.stringify(plan)]);
  sources.getRow(1).font = { bold: true };
  sources.columns.forEach((column) => { column.width = 40; column.numFmt = "@"; });
  if (excluded.length) {
    const warnings = workbook.addWorksheet("未匯出紀錄");
    warnings.addRow(["來源識別碼", "原因"]);
    for (const item of excluded) warnings.addRow([item.id, item.reason]);
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const parsed = parseExcel(Uint8Array.from(bytes).buffer, "generated-patents.xlsx");
  if (parsed.errors.length || !parsed.patents.length) throw new Error("產出的 Excel 未通過既有匯入器驗證，檔案不會提供下載。", { cause: parsed.errors });
  if (parsed.patents.length < included.length) warnings.push(`依系統既有去重規則，匯入分析後會保留 ${parsed.patents.length} 筆專利。`);
  return { bytes, included, excluded, warnings };
}
