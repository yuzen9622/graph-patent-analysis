import * as XLSX from "xlsx";
import { sourceRecordSchema, validateSearchPlan, type SearchPlan, type PatentSourceRecord } from "./contracts";

export interface TwipResultLink { publicationNumber: string; url: string; titleEn: string }

function quote(value: string) { return `"${value.replace(/[\\"]/g, "\\$&")}"`; }

// Field codes and phrase/range syntax are documented in TwIP's static/zh/page03 help.
export function buildTwipQuery(input: SearchPlan) {
  const plan = validateSearchPlan(input);
  const parts: string[] = [];
  if (plan.keywords.length) parts.push(`TA:(${plan.keywords.map(quote).join(plan.match === "all" ? " AND " : " OR ")})`);
  if (plan.applicants.length) parts.push(`AANM:(${plan.applicants.map(quote).join(" OR ")})`);
  if (plan.ipc.length) parts.push(`IPC:(${plan.ipc.map((value) => value.toUpperCase()).join(" OR ")})`);
  if (plan.dateFrom || plan.dateTo) parts.push(`${plan.dateField === "filing" ? "APD" : "PD"}:[${plan.dateFrom ?? "*"} TO ${plan.dateTo ?? "*"}]`);
  return parts.join(" AND ");
}

export function applicantMatches(names: string[], scope: string[]) {
  const normalize = (name: string) => name.normalize("NFKC").replace(/\s+/g, "").replaceAll("台", "臺").replace(/股份有限公司$/, "");
  const wanted = new Set(scope.map(normalize));
  return names.some(name => wanted.has(normalize(name)));
}

export const TWIP_COLUMNS = ["公開/公告號", "公開/公告日", "專利名稱", "申請號", "申請日", "摘要", "申請人", "證書號", "公報卷期", "當前 IPC", "LOC", "當前專利權人", "發明人", "代理人", "優先權", "引用專利", "引用非專利", "案件狀態"];

export function parseTwipWorkbook(bytes: Uint8Array, links: readonly TwipResultLink[], retrievedAt: string): PatentSourceRecord[] {
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("官方匯出檔超過處理上限。");
  const workbook = XLSX.read(bytes, { type: "array", sheets: 0, sheetRows: links.length + 2 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("官方下載檔不包含工作表。");
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  const headers = rows[0]?.map((value) => String(value).trim()) ?? [];
  if (!TWIP_COLUMNS.every((header) => headers.includes(header))) throw new Error("TwIP 匯出欄位已改變，無法安全對應專利資料。");
  const byPublication = new Map(links.map((link) => [link.publicationNumber, link]));
  return rows.slice(1).filter((row) => row.some((value) => String(value).trim())).map((row) => {
    const value = (header: string) => String(row[headers.indexOf(header)] ?? "").trim();
    const lines = (header: string) => value(header).split(/\n+/).map(s => s.trim()).filter(Boolean);
    const publicationNumber = value("公開/公告號");
    const link = byPublication.get(publicationNumber);
    if (!link) throw new Error(`匯出專利 ${publicationNumber} 缺少已驗證的官方來源連結。`);
    const url = new URL(link.url);
    const id = new URLSearchParams(url.hash.split("?")[1]).get("id");
    if (!id) throw new Error("官方來源連結缺少專利識別碼。");
    return sourceRecordSchema.parse({
      id, title: value("專利名稱"), titleEn: link.titleEn, abstract: value("摘要"),
      applicants: value("申請人").split(/\n+/).map((name) => name.trim()).filter(Boolean),
      applicationNumber: value("申請號"), filingDate: value("申請日"),
      bibliography: {
        certificate: value("證書號"), issue: value("公報卷期"),
        ipc: value("當前 IPC").match(/[A-HY]\d{2}[A-Z]\s*\d+\/\d+/gi) ?? [],
        design: value("LOC"), owners: lines("當前專利權人"), inventors: lines("發明人"),
        agents: lines("代理人"), priority: value("優先權"),
        references: [...lines("引用專利"), ...lines("引用非專利")],
        status: value("案件狀態"), citedCount: null, kind: "",
      },
      publicationNumber, publicationDate: value("公開/公告日"), sourceUrl: link.url, retrievedAt,
    });
  });
}
