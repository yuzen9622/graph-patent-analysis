import { describe, expect, it } from 'vitest'
import {
  applyIpcColour,
  DEFAULT_IPC_LEVEL,
  dominantIpcOfConcept,
  IPC_COLORS,
  ipcColorOf,
  ipcKeyAtLevel,
  ipcLegendItems,
  ipcSelectedRawIds,
  ipcSortedKeys,
  ipcTreeOf,
} from '../lib/ipc-filter'
import { ipcGraph } from './fixtures/ipc-graph'

describe('S1 五級投影', () => {
  it('G06Q10/40 五個層級全都正確', () => {
    expect(ipcKeyAtLevel('G06Q10/40', 1)).toBe('G')
    expect(ipcKeyAtLevel('G06Q10/40', 2)).toBe('G06')
    expect(ipcKeyAtLevel('G06Q10/40', 3)).toBe('G06Q')
    expect(ipcKeyAtLevel('G06Q10/40', 4)).toBe('G06Q10')
    expect(ipcKeyAtLevel('G06Q10/40', 5)).toBe('G06Q10/40')
  })

  it('深度 3 的 key 在 L4/L5 回 null（不參與分組）', () => {
    expect(ipcKeyAtLevel('G06Q', 3)).toBe('G06Q')
    expect(ipcKeyAtLevel('G06Q', 4)).toBeNull()
    expect(ipcKeyAtLevel('G06Q', 5)).toBeNull()
  })

  it('非法值回 null 不拋錯', () => {
    expect(ipcKeyAtLevel('', 3)).toBeNull()
    expect(ipcKeyAtLevel('not-an-ipc', 3)).toBeNull()
    expect(ipcKeyAtLevel('g06q10/40', 3)).toBeNull() // lower-case normalised form never occurs
  })
})

describe('S5 色盤與排序', () => {
  it('排序後 index 取色；未知 key 回中性灰', () => {
    const sorted = ['G06K', 'G06L', 'G06Q', 'H04L']
    expect(ipcColorOf('G06K', sorted)).toBe(IPC_COLORS[0])
    expect(ipcColorOf('G06Q', sorted)).toBe(IPC_COLORS[2])
    expect(ipcColorOf('NOTHING', sorted)).toBe('#94a3b8')
    expect(ipcSortedKeys(ipcGraph(), 3)).toEqual(['G06K', 'G06Q', 'H04L'])
  })
})

describe('S8 樹狀結構與計數', () => {
  it('L3 的樹：部 → 類 → 次類，count 為不同專利數', () => {
    const tree = ipcTreeOf(ipcGraph(), 3)
    expect(tree.map((n) => n.key)).toEqual(['G', 'H'])
    expect(tree[0].count).toBe(3) // p1..p3 以 G 開頭（p4 是 H）
    const gq = tree[0].children.find((n) => n.key === 'G06')
    expect(gq?.count).toBe(3) // p1, p2, p3
    const leaf = gq?.children.find((n) => n.key === 'G06Q')
    expect(leaf?.count).toBe(2) // p1, p3
    expect(leaf?.children).toEqual([])
  })

  it('L4 的名為有主類目的 key（深度 3 的專利不參與）', () => {
    const g = ipcGraph()
    const four = ipcTreeOf(g, 4)
    const g4 = four.find((n) => n.key === 'G')!
    const leaves = g4.children.flatMap((l2) => l2.children.flatMap((l3) => l3.children.map((n) => n.key)))
    expect(leaves).toEqual(['G06K9', 'G06Q10', 'G06Q20', 'G06Q40'])
  })

  it('同一個專利同層多 key 只計一次（去重）', () => {
    // p1 有 G06Q10 與 G06Q40（L4 兩 key），G06Q10 的 count 仍只算 p1 一次
    const tree = ipcTreeOf(ipcGraph(), 4)
    const gq10 = tree.find((n) => n.key === 'G')!.children
      .find((n) => n.key === 'G06')!.children
      .find((n) => n.key === 'G06Q')!.children.find((n) => n.key === 'G06Q10')
    expect(gq10?.count).toBe(1)
  })
})

describe('S2 篩選命中', () => {
  const graph = ipcGraph()

  it('L3 選 G06Q → p1、p3 命中（OR）', () => {
    expect(ipcSelectedRawIds(graph, 3, ['G06Q'])).toEqual(new Set(['p1', 'p3']))
  })

  it('多 key 並集；L4 選 G06K9 命中 p2', () => {
    expect(ipcSelectedRawIds(graph, 4, ['G06K9', 'G06Q40'])).toEqual(new Set(['p1', 'p2']))
  })

  it('無 ipc5 的專利在篩選時不命中；空選取回空', () => {
    expect(ipcSelectedRawIds(graph, 3, ['H04L'])).toEqual(new Set(['p4']))
    expect(ipcSelectedRawIds(graph, 3, [])).toEqual(new Set())
    expect(DEFAULT_IPC_LEVEL).toBe(3)
  })
})

describe('S4 依 IPC 著色', () => {
  it('概念取涵蓋專利的優勢 IP（同票取小 key）', () => {
    const g = ipcGraph()
    const c3 = g.nodes.find((n) => n.label === 'C3')!   // p4(H04L)
    const c4 = g.nodes.find((n) => n.label === 'C4')!   // p5(no ipc)
    expect(dominantIpcOfConcept(g, c3, 3)).toBe('H04L')
    expect(dominantIpcOfConcept(g, c4, 3)).toBeNull()
  })

  it('applyIpcColour 純函式、不 mutate；無 IPC 專案保持原色', () => {
    const g = ipcGraph()
    const nodes = g.nodes.filter((n) => n.type === 'concept')
    const colored = applyIpcColour(g, nodes, 3)
    expect(colored.map((n) => n.color)).toEqual([
      IPC_COLORS[0], // C1 = G06K 勝（同票小 key，G06K < G06Q）
      IPC_COLORS[1], // C2 → G06Q（p1、p3 皆 G06Q）
      IPC_COLORS[2], // C3 → H04L
      '#444', // C4 維持原色
    ])
    expect(g.nodes.filter((n) => n.type === 'concept').map((n) => n.color)).toEqual(['#111', '#222', '#333', '#444'])
  })
})

describe('圖例資料', () => {
  it('ipcLegendItems 依出現篇數遞減', () => {
    const items = ipcLegendItems(ipcGraph(), 3)
    // G06Q=2（p1,p3）、G06K=1、H04L=1
    expect(items[0].key).toBe('G06Q')
    expect(items[0].count).toBe(2)
    expect(items.map((i) => i.key).sort()).toEqual(['G06K', 'G06Q', 'H04L'])
  })
})