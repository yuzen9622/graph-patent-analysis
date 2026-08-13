import type { GraphNode } from "@/types/graph";

export type TooltipUnit = "patent" | "applicant";

/**
 * 節點大小會隨分析單位在「篇」與「家」之間切換，但計量文字若只寫「篇」，
 * 讀者會把「3 家」讀成「3 篇」（PRD v2 意圖・決策 9）。因此概念與機構節點
 * 一律同時列出兩種計量，並把當前單位放在最前面。
 *
 * 線上（GraphViewer）與離線匯出（export-html）共用本函式，避免兩份文字漂移。
 */
export function nodeTooltipLines(
  node: GraphNode,
  unit: TooltipUnit = "patent",
): string[] {
  if (node.type === "applicant") return [applicantLine(node)];
  if (node.type === "patent") return patentLines(node);
  if (node.type === "concept")
    return [conceptLine(node, unit), ...conceptTimeLines(node)];
  return [node.title ?? node.label];
}

function applicantLine(node: GraphNode): string {
  const patents = `${node.patent_count ?? 0} 篇專利`;
  // concept_count 只有機構網路視圖會設，該視圖的節點大小＝涉足概念數而非篇數。
  const counts =
    node.concept_count !== undefined
      ? `涉足 ${node.concept_count} 個技術概念／${patents}`
      : patents;
  return `申請人：${node.label}（${counts}）`;
}

function patentLines(node: GraphNode): string[] {
  const lines = [node.title ?? node.label];
  if (node.filing_date) lines.push(`申請日：${node.filing_date}`);
  return lines;
}

function conceptLine(node: GraphNode, unit: TooltipUnit): string {
  const patents = `${node.frequency ?? 0} 篇專利`;
  if (node.applicant_count === undefined)
    return `概念：${node.label}（${patents}）`;
  const applicants = `${node.applicant_count} 家機構`;
  const counts =
    unit === "applicant"
      ? `${applicants}／${patents}`
      : `${patents}／${applicants}`;
  return `概念：${node.label}（${counts}）`;
}

/** 概念時間統計（只列有資料的欄位）。 */
export function conceptTimeLines(node: GraphNode): string[] {
  const lines: string[] = [];
  if (node.first_year !== undefined)
    lines.push(`首次出現：${node.first_year} 年`);
  if (node.median_year !== undefined)
    lines.push(`中位年：${node.median_year} 年`);
  if (node.last_year !== undefined)
    lines.push(`最近出現：${node.last_year} 年`);
  return lines;
}
