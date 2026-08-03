/**
 * applicant-classify.ts
 *
 * Derives two research dimensions from the raw applicant cell of the patent
 * spreadsheet, which looks like:
 *
 *   國泰金融控股股份有限公司 臺北市大安區仁愛路4段296號 (中華民國)
 *
 * `cleanApplicantName()` in excel-parser.ts keeps only the leading name, so the
 * country in the trailing parenthesis would otherwise be lost. Both values are
 * stored on the `applicants` table for SQL-side breakdowns.
 */

export type OrgType =
  | '金控'
  | '銀行'
  | '保險'
  | '證券投信'
  | '支付金流'
  | '科技資訊'
  | '學研'
  | '個人'
  | '其他'

/** Last parenthesised group of the raw cell, e.g. "(中華民國)" → "中華民國". */
export function extractCountry(rawApplicant: string): string | null {
  const matches = rawApplicant.match(/[（(]([^）)]+)[）)]/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  const inner = last.slice(1, -1).trim()
  return inner.length > 0 ? inner : null
}

// Order matters: 金控 before 銀行 before the generic 公司 fallbacks, so that
// 「國泰金融控股」 is not classified as 「銀行」 by an incidental substring.
const ORG_RULES: Array<{ type: OrgType; patterns: RegExp }> = [
  { type: '金控', patterns: /金融控股|金控/ },
  { type: '銀行', patterns: /商業銀行|銀行|信用合作社|農會信用部|Bank/i },
  { type: '保險', patterns: /人壽|產物保險|保險|再保|Insurance/i },
  { type: '證券投信', patterns: /證券|投信|投顧|期貨|資產管理|Securities/i },
  { type: '支付金流', patterns: /支付|金流|電子票證|悠遊卡|一卡通|Payment|Visa|Mastercard/i },
  { type: '學研', patterns: /大學|學院|研究院|研究所|工研院|資策會|University|Institute/i },
  { type: '科技資訊', patterns: /科技|資訊|電子|通訊|軟體|網路|數位|Technolog|Systems|Software/i },
]

export function classifyOrgType(applicantName: string): OrgType {
  const name = applicantName.trim()
  if (!name) return '其他'
  for (const rule of ORG_RULES) {
    if (rule.patterns.test(name)) return rule.type
  }
  // Natural persons: short names with no corporate suffix at all.
  if (name.length <= 4 && !/公司|企業|集團|基金會|協會|Corp|Inc|Ltd|LLC|GmbH|Co\./i.test(name)) {
    return '個人'
  }
  return '其他'
}
