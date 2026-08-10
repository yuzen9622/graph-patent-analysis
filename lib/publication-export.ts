/**
 * PRD-Q8 v2.1 · M1 Overview（出版整體圖）的純邏輯部分：主要概念判定（§4）、
 * 標籤三態封鎖矩陣（§3）、mm↔px 換算與 print-scale 常數（§6）。
 * 畫布繪製／碰撞避讓需要 DOM canvas，留在 components/GraphViewer.tsx；
 * 這裡只放不依賴瀏覽器 API、可單元測試的判斷邏輯。
 */
import type { GraphEdge, GraphNode } from '../types/graph'

/** mm 可自訂（面板提供 85/120/180 三個快捷值＋自由輸入）；85/180 是規格錨點，其餘線性內插。 */
export type PublicationWidthMm = number
export type PublicationLabelMode = 'primary' | 'all' | 'none'
export type PublicationDpi = 300 | 600

const WIDTH_ANCHOR_MIN = 85
const WIDTH_ANCHOR_MAX = 180
/** §4：85mm ≈ 12–15、180mm ≈ 30–35，各取區間上限做為兩端錨點。 */
const LABEL_CAP_AT_MIN = 15
const LABEL_CAP_AT_MAX = 35
/** §3／§9：85mm 全部標籤一律封鎖（等效門檻 0）；180mm 節點數 ≤30 才允許，120mm 沿用同一矩陣內插（§9）。 */
const FULL_LABEL_THRESHOLD_AT_MIN = 0
const FULL_LABEL_THRESHOLD_AT_MAX = 30

function interpolateByWidth(widthMm: number, atMin: number, atMax: number): number {
  const t = (widthMm - WIDTH_ANCHOR_MIN) / (WIDTH_ANCHOR_MAX - WIDTH_ANCHOR_MIN)
  return atMin + t * (atMax - atMin)
}

/** §4：主要標籤數量上限（碰撞預算）。85/180mm 精確對齊規格錨點，其餘寬度依 §9 內插。 */
export function primaryLabelCap(widthMm: number): number {
  return Math.max(1, Math.round(interpolateByWidth(widthMm, LABEL_CAP_AT_MIN, LABEL_CAP_AT_MAX)))
}

/** §6：node 直徑／edge 寬相對 live 的下限倍率，取區間中點。 */
export const PRINT_NODE_SCALE = 1.4
export const PRINT_EDGE_SCALE = 1.25
/** §6：密集區降邊透明度上限——非主要邊疊在既有 support-strength 透明度上再封頂；主要邊維持 100%。 */
export const PRINT_DIM_EDGE_OPACITY = 0.5

export const PRINT_DPI: PublicationDpi = 300
const MM_PER_INCH = 25.4

export function mmToPixels(mm: number, dpi: number = PRINT_DPI): number {
  return Math.round((mm / MM_PER_INCH) * dpi)
}

/**
 * §3／§9：全部標籤（或 M2 子圖，一律全標）在該圖幅下是否物理上封鎖。
 * 85mm 等效門檻 0（一律封鎖）；180mm 門檻 30；其餘寬度線性內插判斷門檻。
 */
export function isFullLabelBlocked(nodeCount: number, widthMm: number): boolean {
  const threshold = interpolateByWidth(widthMm, FULL_LABEL_THRESHOLD_AT_MIN, FULL_LABEL_THRESHOLD_AT_MAX)
  return nodeCount > threshold
}

/** §3 封鎖訊息樣板（M1 全部標籤被擋時顯示）。 */
export function fullLabelBlockedMessage(nodeCount: number): string {
  return `此圖譜包含 ${nodeCount} 個節點，完整顯示所有標籤於目前圖幅會造成文字重疊。建議改用「僅主要概念」。`
}

interface DegreeInfo {
  degree: number
  inDegree: number
  outDegree: number
}

/**
 * 從目前檢視的節點／邊即時算 degree（§4：不新增 DB 欄位，render/export 前一次 O(E)）。
 * inDegree／outDegree 只計 temporal_directed 的共現邊（P6 中位年排序的方向），
 * 作為「概念 DAG」的入邊／出邊，用於判定 root。
 */
export function computeDegrees(nodes: GraphNode[], edges: GraphEdge[]): Map<string, DegreeInfo> {
  const info = new Map<string, DegreeInfo>()
  for (const node of nodes) info.set(node.id, { degree: 0, inDegree: 0, outDegree: 0 })
  for (const edge of edges) {
    const from = info.get(edge.from)
    const to = info.get(edge.to)
    if (from) from.degree += 1
    if (to) to.degree += 1
    if (edge.kind === 'cooccurrence' && edge.temporal_directed) {
      if (from) from.outDegree += 1
      if (to) to.inDegree += 1
    }
  }
  return info
}

/**
 * §4 主要概念判定（機械化，無 AI/人工）：依優先序收，收滿 maxLabels 即止。
 * 1. root：概念 DAG 入邊=0 且至少有一條出邊（真正的起點，排除完全無邊的孤立節點）。
 * 2. hub：全局 degree 前 3 名。
 * 3. 社群代表：每個 community_id 內 degree+frequency 綜合最高者，保證每個社群至少一個 label。
 * 4. 剩餘依 degree 降冪補滿。
 * 回傳的 Set 迭代順序＝優先序（JS Set 保留插入順序），供畫布碰撞避讓時決定誰先放。
 */
export function selectPrimaryLabels(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxLabels: number,
): Set<string> {
  const degrees = computeDegrees(nodes, edges)
  const selected = new Set<string>()
  const degreeOf = (id: string) => degrees.get(id)?.degree ?? 0

  const byDegreeDesc = [...nodes].sort(
    (a, b) => degreeOf(b.id) - degreeOf(a.id) || a.id.localeCompare(b.id),
  )

  const roots = nodes
    .filter((n) => {
      const d = degrees.get(n.id)
      return !!d && d.inDegree === 0 && d.outDegree > 0
    })
    .sort((a, b) => degreeOf(b.id) - degreeOf(a.id) || a.id.localeCompare(b.id))
  for (const node of roots) {
    if (selected.size >= maxLabels) break
    selected.add(node.id)
  }

  for (const node of byDegreeDesc.slice(0, 3)) {
    if (selected.size >= maxLabels) break
    selected.add(node.id)
  }

  const byCommunity = new Map<number, GraphNode[]>()
  for (const node of nodes) {
    if (typeof node.community_id !== 'number') continue
    const members = byCommunity.get(node.community_id) ?? []
    members.push(node)
    byCommunity.set(node.community_id, members)
  }
  const compositeScore = (node: GraphNode) =>
    degreeOf(node.id) + (node.frequency ?? node.applicant_count ?? 0)
  const communityIds = [...byCommunity.keys()].sort((a, b) => a - b)
  for (const communityId of communityIds) {
    if (selected.size >= maxLabels) break
    const members = byCommunity.get(communityId)!
    const rep = [...members].sort(
      (a, b) => compositeScore(b) - compositeScore(a) || a.id.localeCompare(b.id),
    )[0]
    if (rep) selected.add(rep.id)
  }

  for (const node of byDegreeDesc) {
    if (selected.size >= maxLabels) break
    selected.add(node.id)
  }

  return selected
}

/**
 * §2 M2：從中心節點做 BFS，收集 hops 步以內可達的節點 id（含中心本身）。
 * 只用邊的 from/to 當連通性，不分邊的種類——子圖是給人看「這個概念周圍長怎樣」，
 * 不是統計量計算，混用共現/語意邊沒有正確性疑慮。
 */
export function subgraphNodeIds(
  centerId: string,
  edges: Array<Pick<GraphEdge, 'from' | 'to'>>,
  hops: 1 | 2,
): Set<string> {
  const adjacency = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    const set = adjacency.get(a) ?? new Set<string>()
    set.add(b)
    adjacency.set(a, set)
  }
  for (const edge of edges) {
    link(edge.from, edge.to)
    link(edge.to, edge.from)
  }

  const visited = new Set<string>([centerId])
  let frontier = new Set<string>([centerId])
  for (let step = 0; step < hops; step += 1) {
    const next = new Set<string>()
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          next.add(neighbor)
        }
      }
    }
    if (next.size === 0) break
    frontier = next
  }
  return visited
}
