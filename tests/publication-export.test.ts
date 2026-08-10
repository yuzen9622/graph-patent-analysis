import { describe, expect, it } from 'vitest'
import {
  computeDegrees,
  fullLabelBlockedMessage,
  isFullLabelBlocked,
  mmToPixels,
  primaryLabelCap,
  selectPrimaryLabels,
  subgraphNodeIds,
} from '@/lib/publication-export'
import type { GraphEdge, GraphNode } from '@/types/graph'

describe('mmToPixels（§6 mm↔px 換算）', () => {
  it('85mm/180mm 於 300dpi 的像素數', () => {
    expect(mmToPixels(85)).toBe(1004)
    expect(mmToPixels(180)).toBe(2126)
  })

  it('600dpi 尺寸為 300dpi 的兩倍（§9：同一機制，尺寸 2×）', () => {
    expect(mmToPixels(180, 600)).toBe(mmToPixels(180, 300) * 2)
  })
})

describe('primaryLabelCap（§4／§9：85/180mm 為錨點，其餘寬度內插）', () => {
  it('85mm/180mm 精確對齊規格上限', () => {
    expect(primaryLabelCap(85)).toBe(15)
    expect(primaryLabelCap(180)).toBe(35)
  })

  it('120mm 介於兩端之間（§9：同一 layout 矩陣，K 介於 85/180 之間）', () => {
    const cap = primaryLabelCap(120)
    expect(cap).toBeGreaterThan(15)
    expect(cap).toBeLessThan(35)
  })
})

describe('isFullLabelBlocked（§3 封鎖矩陣，85/180mm 為錨點）', () => {
  it('85mm：全部標籤一律封鎖，不論節點數', () => {
    expect(isFullLabelBlocked(5, 85)).toBe(true)
    expect(isFullLabelBlocked(500, 85)).toBe(true)
  })

  it('180mm：節點數 ≤30 才允許全部標籤', () => {
    expect(isFullLabelBlocked(30, 180)).toBe(false)
    expect(isFullLabelBlocked(31, 180)).toBe(true)
  })

  it('120mm：門檻介於 85/180mm 之間（內插，非硬編碼）', () => {
    const threshold120 = [...Array(60).keys()].find((n) => isFullLabelBlocked(n, 120))
    expect(threshold120).toBeGreaterThan(0)
    expect(threshold120).toBeLessThan(30)
  })
})

describe('fullLabelBlockedMessage', () => {
  it('帶入節點數並建議改用僅主要概念', () => {
    const message = fullLabelBlockedMessage(186)
    expect(message).toContain('186')
    expect(message).toContain('僅主要概念')
  })
})

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'concept',
  label: id,
  color: '#111',
  size: 18,
  ...extra,
})

describe('computeDegrees', () => {
  it('degree 計全部邊；inDegree/outDegree 只計 temporal_directed 的共現邊', () => {
    const nodes = [node('A'), node('B'), node('C')]
    const edges: GraphEdge[] = [
      { id: 'ab', from: 'A', to: 'B', relation: '共同投入', kind: 'cooccurrence', temporal_directed: true },
      { id: 'bc', from: 'B', to: 'C', relation: '共同投入', kind: 'cooccurrence', temporal_directed: false },
    ]
    const degrees = computeDegrees(nodes, edges)
    expect(degrees.get('A')).toEqual({ degree: 1, inDegree: 0, outDegree: 1 })
    expect(degrees.get('B')).toEqual({ degree: 2, inDegree: 1, outDegree: 0 })
    expect(degrees.get('C')).toEqual({ degree: 1, inDegree: 0, outDegree: 0 })
  })
})

describe('selectPrimaryLabels（§4 主要概念判定）', () => {
  // DAG：A→B（A 為 root：入邊 0、出邊 1）。H 額外連 A/B/C/D 撐高全局 degree，
  // 但 H 沒有 temporal_directed 邊，所以不是 root。C、D 分屬社群 1，交由社群代表補上。
  const nodes = [
    node('A', { community_id: 0 }),
    node('B', { community_id: 0 }),
    node('C', { community_id: 1 }),
    node('D', { community_id: 1 }),
    node('H'),
  ]
  const edges: GraphEdge[] = [
    { id: 'ab', from: 'A', to: 'B', relation: '共同投入', kind: 'cooccurrence', temporal_directed: true },
    { id: 'ha', from: 'H', to: 'A', relation: '共同投入', kind: 'cooccurrence' },
    { id: 'hb', from: 'H', to: 'B', relation: '共同投入', kind: 'cooccurrence' },
    { id: 'hc', from: 'H', to: 'C', relation: '共同投入', kind: 'cooccurrence' },
    { id: 'hd', from: 'H', to: 'D', relation: '共同投入', kind: 'cooccurrence' },
  ]

  it('依 root → hub → 社群代表 → 補滿 的優先序收集，順序即插入順序', () => {
    const selected = selectPrimaryLabels(nodes, edges, 10)
    expect([...selected]).toEqual(['A', 'H', 'B', 'C', 'D'])
  })

  it('maxLabels 提早截斷：只收 root 與 hub 前段，不進入社群代表/補滿階段', () => {
    const selected = selectPrimaryLabels(nodes, edges, 2)
    expect([...selected]).toEqual(['A', 'H'])
  })

  it('孤立、無出邊的節點不會被誤判為 root', () => {
    // H 沒有 temporal_directed 邊：inDegree=0 但 outDegree 也是 0，不應進 root 名單。
    const soloNodes = [node('X'), node('Y')]
    const soloEdges: GraphEdge[] = [
      { id: 'xy', from: 'X', to: 'Y', relation: '共同投入', kind: 'cooccurrence' },
    ]
    const selected = selectPrimaryLabels(soloNodes, soloEdges, 1)
    // 兩者 degree 相同（皆 1），root 名單為空，落到 hub 前 3 名，依 id 排序取 X。
    expect([...selected]).toEqual(['X'])
  })
})

describe('subgraphNodeIds（§2 M2：hop BFS）', () => {
  // 鏈狀：A-B-C-D-E，中心 C。
  const chainEdges: GraphEdge[] = [
    { id: 'ab', from: 'A', to: 'B', relation: '共同投入', kind: 'cooccurrence' },
    { id: 'bc', from: 'B', to: 'C', relation: '共同投入', kind: 'cooccurrence' },
    { id: 'cd', from: 'C', to: 'D', relation: '共同投入', kind: 'cooccurrence' },
    { id: 'de', from: 'D', to: 'E', relation: '共同投入', kind: 'cooccurrence' },
  ]

  it('hop=1：只收直接鄰居', () => {
    const ids = subgraphNodeIds('C', chainEdges, 1)
    expect(ids).toEqual(new Set(['C', 'B', 'D']))
  })

  it('hop=2：收到兩步之外', () => {
    const ids = subgraphNodeIds('C', chainEdges, 2)
    expect(ids).toEqual(new Set(['C', 'B', 'D', 'A', 'E']))
  })

  it('孤立中心節點：只回傳自己', () => {
    const ids = subgraphNodeIds('Z', chainEdges, 2)
    expect(ids).toEqual(new Set(['Z']))
  })

  it('邊不分方向，from/to 都算連通', () => {
    const ids = subgraphNodeIds('A', chainEdges, 1)
    expect(ids).toEqual(new Set(['A', 'B']))
  })
})
