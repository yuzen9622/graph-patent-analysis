export type BankOwnership = "public" | "private";

export const BANK_OWNERSHIPS: readonly BankOwnership[] = ["public", "private"];
export const BANK_OWNERSHIP_LABELS: Record<BankOwnership, string> = {
  public: "國營",
  private: "民營",
};

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").replace(/台/g, "臺").replace(/(?:股份)?有限公司$/, "");
}

// 產品定義：僅此 11 家歸國營，合併純公股、泛公股與指定政策機構；不延伸到金控或子公司。
const PUBLIC_BANK_NAMES = new Set([
  ["臺灣銀行", "臺銀"],
  ["臺灣土地銀行", "土地銀行", "土銀"],
  ["中國輸出入銀行", "輸出入銀行"],
  ["合作金庫商業銀行", "合作金庫銀行", "合作金庫", "合庫"],
  ["第一商業銀行", "第一銀行", "一銀"],
  ["華南商業銀行", "華南銀行", "華銀"],
  ["彰化商業銀行", "彰化銀行", "彰銀"],
  ["兆豐國際商業銀行", "兆豐商業銀行", "兆豐銀行"],
  ["臺灣中小企業銀行", "臺灣企銀", "臺企銀"],
  ["中央銀行"],
  ["全國農業金庫", "全國農業金庫銀行"],
].flat().map(normalizeName));

export function bankOwnershipOf(name: string): BankOwnership {
  return PUBLIC_BANK_NAMES.has(normalizeName(name)) ? "public" : "private";
}

export function includesAllOwnership(ownership?: readonly BankOwnership[]): boolean {
  return ownership === undefined || BANK_OWNERSHIPS.every(kind => ownership.includes(kind));
}

export function parseBankOwnership(params: URLSearchParams): BankOwnership[] | undefined {
  if (!params.has("ownership")) return undefined;
  const values = params.getAll("ownership");
  if (!values.every(value => value === "none" || BANK_OWNERSHIPS.some(kind => kind === value))) return undefined;
  return BANK_OWNERSHIPS.filter(kind => values.includes(kind));
}
