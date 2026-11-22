export const COMPLETE_APPLICANTS_COLUMN = "完整申請人(JSON v1)";

export function parseCompleteApplicants(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 32767) throw new Error("完整申請人欄位必須是 JSON 名稱陣列。");
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((name): name is string => typeof name === "string" && name.trim().length > 0)) {
    throw new Error("完整申請人欄位必須是非空白字串組成的陣列。");
  }
  return [...new Set(parsed.map((name) => name.trim()))];
}
