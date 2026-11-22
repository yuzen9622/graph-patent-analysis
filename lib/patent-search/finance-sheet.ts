import type ExcelJS from "exceljs";
import type { PatentSourceRecord } from "./contracts";

const series = (name: string, length: number) => Array.from({ length }, (_, i) => name + (i + 1));
const groups = [
  ["IPC5-", 13], ["IPC3-", 13], ["當前專利權人", 2], ["發明人", 32],
  ["申請人", 5], ["代理人", 4], ["參考文獻", 14],
] as const;

function values(record: PatentSourceRecord) {
  const data = record.bibliography!;
  const ipc = data.ipc.map(code => code.replace(/^([A-HY]\d{2}[A-Z])\s*0*(\d+\/\d+)$/i, "$1-$2"));
  return { "IPC5-": ipc, "IPC3-": ipc.map(code => code.slice(0, 4)), 當前專利權人: data.owners,
    發明人: data.inventors, 申請人: record.applicants, 代理人: data.agents, 參考文獻: data.references };
}

export function addFinanceSheet(workbook: ExcelJS.Workbook, records: PatentSourceRecord[]) {
  const sheet = workbook.addWorksheet("原始資料");
  const headers = ["專利編號", "公告/公開日", "申請號", "專利名稱", "證書號", "申請日", "申請年",
    ...series("IPC5-", 13), "申請日", ...series("IPC3-", 13), "設計分類號", "公報分卷期",
    ...series("當前專利權人", 2), ...series("發明人", 32), ...series("申請人", 5), ...series("代理人", 4),
    "優先權", ...series("參考文獻", 14), "摘要", "被參考次數", "案件狀態"];
  const rows = records.map(values);
  // Preserve all values when a record exceeds the numbered columns in the template.
  for (const [prefix, count] of groups) {
    const max = rows.reduce((max, row) => Math.max(max, row[prefix].length), count as number);
    headers.push(...series(prefix, max).slice(count));
  }
  sheet.addRow(headers);
  for (const [index, record] of records.entries()) {
    const data = record.bibliography!;
    const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00Z") : s;
    const fields: Record<string, ExcelJS.CellValue> = {
      專利編號: "TW" + record.publicationNumber + data.kind, "公告/公開日": date(record.publicationDate),
      申請號: "TW" + record.applicationNumber, 專利名稱: record.title, 證書號: data.certificate,
      申請日: date(record.filingDate), 申請年: record.filingDate.slice(0, 4), 設計分類號: data.design,
      公報分卷期: data.issue, 優先權: data.priority, 摘要: record.abstract, 被參考次數: data.citedCount, 案件狀態: data.status,
    };
    for (const [prefix] of groups) rows[index][prefix].forEach((v, i) => { fields[prefix + (i + 1)] = v; });
    sheet.addRow(headers.map(header => fields[header] ?? null));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  headers.forEach((header, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = header === "摘要" ? 70 : header === "專利名稱" ? 40 : 18;
    if (["公告/公開日", "申請日"].includes(header)) column.numFmt = "yyyy-mm-dd";
  });
}
