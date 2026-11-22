// The public CBC form posts these fields when 本國銀行 and 僅查詢總機構 are selected.
export const BANK_DIRECTORY = "https://www.cbc.gov.tw/tw/sp-bank-qform-1.html";

export async function resolveDomesticBanks(signal: AbortSignal) {
  const response = await fetch(new URL("sp-bank-qresult-1.html", BANK_DIRECTORY), {
    method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    body: new URLSearchParams({ CKBCheckBankType: "1", DDLBankType: "01本國銀行", CKBCheckQueryList: "1", DDLQueryList: "Y" }),
  });
  if (!response.ok) throw new Error("中央銀行名錄暫時無法查詢。");
  const result = await response.json();
  if (result.Result !== "success" || typeof result.Content !== "string" || !result.Content.includes("金融機構類別：本國銀行"))
    throw new Error("中央銀行未回傳本國銀行名錄。");
  const names = new Set<string>();
  for (const row of result.Content.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!row[1].includes("[總機構]")) continue;
    const cell = row[1].match(/<td data-title="名稱"[^>]*>([\s\S]*?)<\/td>/i);
    const name = cell?.[1].replace(/<[^>]+>/g, "").trim();
    if (!name) throw new Error("中央銀行名錄缺少總機構名稱。");
    if (name !== "中華郵政公司儲匯部門") names.add(name);
  }
  if (!names.size) throw new Error("中央銀行名錄未列出銀行，已停止建立查詢。");
  return [...names];
}
