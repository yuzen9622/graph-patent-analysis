/**
 * PRD v2 / P4 second slice — per-unit relationship metrics.
 *
 * Reader's guide (intent doc decisions Q2/Q4/Q5, P4 spec §2.1–2.4):
 *   * Two analysis units: `patent`（篇，現有）and `applicant`（家/機構, 決策 8）。
 *   * EVERY metric has one value per unit. 門檻是 display 層 filter（Q4）——
 *     這裡的數值全部是「門檻前」的全量計算，進 DB 後絕不再因門檻重算。
 *   * NPMI `p_ij = 1` ⇒ `undefined`（決策 Q5）：極限路徑相依、該況 PMI=0，
 *     記成量尺最大值與語意相反，所以不入排序、邊詳細顯示「—」。
 *   * clamp(-1,1) 吸收浮點溢出（Q5）。
 *   * Association strength (意圖決策 2)：只用於同一張圖內的排序/門檻，**不當線寬**。
 *
 * 所有函式皆純粹（無 DB、無 side effect），供 builder 使用且可直接 vitest。
 */

import { runLouvain, type LouvainOptions } from './louvain'

export interface EdgeMetrics {
  /** 同一位申請人其專利同時含過 i 且含過 j 的家數（可跨篇）。 */
  support_applicants?: number
  /** 家單位 jaccard。 */
  jaccard_applicants?: number
  /** 篇單位 NPMI（合法稀疏值 1→undefined，見 Q5）。 */
  npmi?: number
  /** 家單位 NPMI。 */
  npmi_applicants?: number
  /** 篇單位 association strength（排序用，非線寬，意圖決策 2）。 */
  association_strength?: number
  /** 家單位 association strength。 */
  association_strength_applicants?: number
}

function clampMinMax(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Strip the `concept:` prefix from a node id to get the concept label. */
export function labelOf(nodeId: string): string {
  return nodeId.replace(/^concept:/, '')
}

/** Stable unordered pair key (concept labels). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/**
 * applicant → 其專利碰過的概念集（跨專利的聯集）——「家」單位的邊計數基礎。
 * 每一組 (i,j) 只要同一間機構在其任一專利碰過 i 且在任一專利碰過 j，就算該家
 * co-covers (i,j)。回傳 key=pairKey(labelA,labelB) → 家 id 集合。
 */
export function pairApplicantSupport(
  applicantConcepts: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>()
  for (const [applicantId, concepts] of applicantConcepts) {
    const arr = Array.from(concepts)
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const key = pairKey(arr[i], arr[j])
        const s = pairs.get(key) ?? new Set<string>()
        s.add(applicantId)
        pairs.set(key, s)
      }
    }
  }
  return pairs
}

/**
 * NPMI for one pair. `undefined` when `p_ij = 1`（決策 5）——該況 PMI=0，
 * 記成量尺最大值與語意相反；不入排序、邊詳細顯示「—」。
 * 另以 clamp(-1,1) 吸收浮點溢出。
 */
export function normalizedPointwiseMutualInformation(
  pXY: number,
  pX: number,
  pY: number,
): number | undefined {
  if (!(pXY > 0) || !(pX > 0) || !(pY > 0)) return undefined
  if (pXY >= 1 - 1e-12) return undefined // 極限路徑相關：不予定義
  const pmi = Math.log(pXY) - Math.log(pX) - Math.log(pY)
  const denominator = -Math.log(pXY)
  const value = pmi / denominator
  if (!Number.isFinite(value)) return undefined
  return clampMinMax(value, -1, 1)
}

function nPointwise(cXY: number, cX: number, cY: number, total: number): number | undefined {
  if (total <= 0) return undefined
  return normalizedPointwiseMutualInformation(cXY / total, cX / total, cY / total)
}

export function assocOf(cIJ: number, cA: number, cB: number, m: number): number | undefined {
  if (!(cIJ > 0) || cA <= 0 || cB <= 0) return undefined
  return (2 * m * cIJ) / (cA * cB)
}

/**
 * 計算每一條 co-occurrence 邊在兩個單位下的全部指標（全量、門檻前）。
 * `cooccurrence` 必須已有「篇」單位的 `support_count` 與 `jaccard`（由
 * concept-network 提供）；「家」單位資訊由 `pairApplicants` 提供。
 */
export function computeUnitMetrics(opts: {
  cooccurrence: Array<{
    id: string
    from: string
    to: string
    support_count?: number
  }>
  conceptPatents: Map<string, number>
  conceptApplicants: Map<string, number>
  pairApplicants: Map<string, Set<string>>
  totalPatents: number
  totalInstitutions: number
}): Map<string, EdgeMetrics> {
  const { cooccurrence, conceptPatents, conceptApplicants, pairApplicants } = opts
  const totalPatents = opts.totalPatents
  const totalInstitutions = opts.totalInstitutions

  // 先算 association strength 的每個概念 incident 和 c_i 與 m = ½Σc_i（兩單位各一份）。
  const cPatent = new Map<string, number>()
  const cApplicant = new Map<string, number>()
  let sumPatent = 0
  let sumApplicant = 0
  for (const edge of cooccurrence) {
    const a = labelOf(edge.from)
    const b = labelOf(edge.to)
    const cp = edge.support_count ?? 0
    const ca = pairApplicants.get(pairKey(a, b))?.size ?? 0
    if (cp > 0) {
      cPatent.set(a, (cPatent.get(a) ?? 0) + cp)
      cPatent.set(b, (cPatent.get(b) ?? 0) + cp)
      sumPatent += cp
    }
    if (ca > 0) {
      cApplicant.set(a, (cApplicant.get(a) ?? 0) + ca)
      cApplicant.set(b, (cApplicant.get(b) ?? 0) + ca)
      sumApplicant += ca
    }
  }
  const mPatent = sumPatent / 2
  const mApplicant = sumApplicant / 2

  const out = new Map<string, EdgeMetrics>()
  for (const edge of cooccurrence) {
    const a = labelOf(edge.from)
    const b = labelOf(edge.to)
    const pairApplicantsForEdge = pairApplicants.get(pairKey(a, b))
    const support_applicants =
      pairApplicantsForEdge !== undefined ? pairApplicantsForEdge.size : undefined
    const appA = conceptApplicants.get(a) ?? 0
    const appB = conceptApplicants.get(b) ?? 0
    const patentA = conceptPatents.get(a) ?? 0
    const patentB = conceptPatents.get(b) ?? 0
    const support_patents = edge.support_count ?? 0

    const jaccard_applicants =
      support_applicants !== undefined && appA + appB - support_applicants > 0
        ? support_applicants / (appA + appB - support_applicants)
        : undefined

    out.set(edge.id, {
      support_applicants,
      jaccard_applicants,
      npmi: nPointwise(support_patents, patentA, patentB, totalPatents),
      npmi_applicants:
        support_applicants !== undefined
          ? nPointwise(support_applicants, appA, appB, totalInstitutions)
          : undefined,
      association_strength: assocOf(
        support_patents,
        cPatent.get(a) ?? 0,
        cPatent.get(b) ?? 0,
        mPatent,
      ),
      association_strength_applicants: assocOf(
        support_applicants ?? 0,
        cApplicant.get(a) ?? 0,
        cApplicant.get(b) ?? 0,
        mApplicant,
      ),
    })
  }
  return out
}
/**
 * PRD v2 / P4 (Q2): 「家」單位的 Louvain 社群分區。
 * 節點＝概念，邊權＝同一位申請人（跨篇）同時含過兩概念的**家數**（pairApplicants）。
 * 同一概念 id 的「篇／家」兩單位分區彼此獨立（Q2：色盤 key 用 unit+id）。
 * 回傳 concept label → community id；孤立概念各成一 deterministic 社群。
 */
export function detectUnitCommunities(
  conceptLabels: string[],
  pairApplicants: Map<string, Set<string>>,
  options?: LouvainOptions,
): Map<string, number> {
  const sorted = Array.from(conceptLabels).sort()
  const labels = new Set(sorted)
  const edges: Array<{ a: string; b: string; support: number }> = []

  const seen = new Set<string>()
  for (const [key, applicants] of pairApplicants) {
    const [a, b] = key.split('\u0000')
    if (!labels.has(a) || !labels.has(b) || a === b) continue
    const dedupeKey = pairKey(a, b)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    edges.push({ a, b, support: applicants.size })
  }

  return runLouvain(sorted, edges, options).assignments
}
