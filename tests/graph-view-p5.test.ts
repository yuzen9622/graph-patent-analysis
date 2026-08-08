import { describe, expect, it } from 'vitest'
import { selectGraphView } from '../lib/graph-view'
import { IPC_COLORS, ipcSortedKeys } from '../lib/ipc-filter'
import { ipcGraph } from './fixtures/ipc-graph'

const base = {
  mode: 'concept' as const,
  showSemantic: false,
  minSupport: 1,
  yearRange: [2020, 2021] as [number, number],
  edgeWeight: 'jaccard' as const,
}

describe('P5 IPC 篩選（S2/S3）', () => {
  it('L3 選 G06Q → 概念子集、frequency 重算', () => {
    const view = selectGraphView(ipcGraph(), { ...base, ipcLevel: 3, ipcFilter: ['G06Q'] })
    expect(view.nodes.map((n) => n.label).sort()).toEqual(['C1', 'C2'])
    // C1: 只剩 p1；C2: p1+p3 都在子集 → frequency 2
    expect(view.nodes.find((n) => n.label === 'C1')?.frequency).toBe(1)
    expect(view.nodes.find((n) => n.label === 'C2')?.frequency).toBe(2)
    expect(view.stats.patent_count).toBe(2) // p1、p3
  })

  it('co-occurrence support 在子集上重算（C1–C2 只剩 p1 支持）', () => {
    const view = selectGraphView(ipcGraph(), { ...base, ipcLevel: 3, ipcFilter: ['G06Q'] })
    const co = view.edges.find((e) => e.kind === 'cooccurrence')
    expect(co).toBeDefined()
    expect(co?.support_count).toBe(1)
  })

  it('與來源檔篩選取交集（fileA + G06Q → 只剩 p1）', () => {
    const view = selectGraphView(ipcGraph(), {
      ...base,
      sourceFiles: ['fileA'],
      ipcLevel: 3,
      ipcFilter: ['G06Q'],
    })
    expect(view.nodes.map((n) => n.label).sort()).toEqual(['C1', 'C2'])
    expect(view.nodes.find((n) => n.label === 'C1')?.frequency).toBe(1)
    expect(view.nodes.find((n) => n.label === 'C2')?.frequency).toBe(1) // p2 在 fileA 但非 G06Q
    expect(view.stats.patent_count).toBe(1)
  })

  it('無 ipc5 的專利在篩選時消失（C4 掉）', () => {
    const view = selectGraphView(ipcGraph(), { ...base, ipcLevel: 3, ipcFilter: ['H04L'] })
    expect(view.nodes.map((n) => n.label)).toEqual(['C3'])
  })

  it('機構視圖同步 IPC 專利子集', () => {
    const view = selectGraphView(ipcGraph(), {
      ...base,
      mode: 'institution',
      ipcLevel: 3,
      ipcFilter: ['G06Q'],
    })
    // 只剩 p1（A1）、p3（A2）；共享概念 C1（p1）→ 一條邊
    expect(view.nodes.map((n) => n.label).sort()).toEqual(['A1', 'A2'])
    expect(view.edges).toHaveLength(1)
    expect(view.edges[0]?.relation).toBe('共享概念')
    expect(view.edges[0]?.support_count).toBe(1)
  })

  it('脈絡視圖限定 IPC 專利', () => {
    const view = selectGraphView(ipcGraph(), {
      ...base,
      mode: 'context',
      ipcLevel: 3,
      ipcFilter: ['G06Q'],
    })
    const patents = view.nodes.filter((n) => n.type === 'patent')
    expect(patents.map((n) => n.label).sort()).toEqual(['專利一', '專利三'])
  })
})

describe('IPC 層級（S1）', () => {
  it('L4 選 G06Q40 只命 p1（配合 ipcLevel=4）', () => {
    const view = selectGraphView(ipcGraph(), { ...base, ipcLevel: 4, ipcFilter: ['G06Q40'] })
    expect(view.nodes.map((n) => n.label).sort()).toEqual(['C1', 'C2'])
    expect(view.stats.patent_count).toBe(1) // 只有 p1
    expect(view.nodes.find((n) => n.label === 'C1')?.frequency).toBe(1)
    expect(view.nodes.find((n) => n.label === 'C2')?.frequency).toBe(1)
  })
})

describe('colorMode=ipc（S4）', () => {
  it('概念節點用優勢色；無 IPC 保持原色', () => {
    const view = selectGraphView(ipcGraph(), { ...base, colorMode: 'ipc', ipcLevel: 3 })
    const sorted = ipcSortedKeys(ipcGraph(), 3)
    const color = (key: string) => IPC_COLORS[sorted.indexOf(key) % IPC_COLORS.length]
    expect(view.nodes.find((n) => n.label === 'C1')?.color).toBe(color('G06K')) // 同票取小
    expect(view.nodes.find((n) => n.label === 'C2')?.color).toBe(color('G06Q'))
    expect(view.nodes.find((n) => n.label === 'C3')?.color).toBe(color('H04L'))
    expect(view.nodes.find((n) => n.label === 'C4')?.color).toBe('#444') // 保持原色
  })

  it('篩選後優勢在子集上重算（C1 由多數變 G06Q）', () => {
    const view = selectGraphView(ipcGraph(), {
      ...base,
      colorMode: 'ipc',
      ipcLevel: 3,
      ipcFilter: ['G06Q'],
    })
    const sorted = ipcSortedKeys(ipcGraph(), 3)
    const gq = IPC_COLORS[sorted.indexOf('G06Q') % IPC_COLORS.length]
    expect(view.nodes.find((n) => n.label === 'C1')?.color).toBe(gq)
  })

  it('全部專利無 IPC 時選 ipc 不崩（維持原色）', () => {
    const g = ipcGraph()
    const without = {
      ...g,
      nodes: g.nodes.map((n) => (n.type === 'patent' ? { ...n, ipc5: undefined } : n)),
    }
    const view = selectGraphView(without, { ...base, colorMode: 'ipc', ipcLevel: 3 })
    expect(view.nodes).toHaveLength(4)
    expect(view.nodes.find((n) => n.label === 'C1')?.color).toBe('#111')
    expect(view.nodes.find((n) => n.label === 'C4')?.color).toBe('#444')
  })
})