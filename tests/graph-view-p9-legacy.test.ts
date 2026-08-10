import { describe, expect, it } from 'vitest'
import {
  applicantAvailability,
  selectGraphView,
} from '../lib/graph-view'
import { conceptSize } from '../lib/concept-network'
import { legacyApplicantGraph } from './fixtures/legacy-applicant-graph'
import type { GraphData } from '../types/graph'

/**
 * P9: 舊格式分析（schema v2 備份）的「家」單位──沒有 applicant_count /
 * support_applicants 欄位，但存有結構邊（申請了／包含），view 層應由結構重建，
 * 而不是畫出一張 0 邊、大小誤讀成篇數的空圖。
 */

function conceptOptions(unit: 'patent' | 'applicant') {
  return {
    mode: 'concept' as const,
    showSemantic: false,
    minSupport: 1,
    yearRange: [2020, 2022] as [number, number],
    edgeWeight: 'jaccard' as const,
    unit,
  }
}

describe('applicantAvailability（P9 可用性判別）', () => {
  it('舊格式圖（有結構邊、無家統計）→ rebuildable', () => {
    expect(applicantAvailability(legacyApplicantGraph)).toBe('rebuildable')
  })

  it('新版圖（有 support_applicants）→ stored', () => {
    const storedGraph: GraphData = structuredClone(legacyApplicantGraph)
    storedGraph.edges = storedGraph.edges.map((edge) =>
      edge.kind === 'cooccurrence' ? { ...edge, support_applicants: 2 } : edge,
    )
    expect(applicantAvailability(storedGraph)).toBe('stored')
  })

  it('只有概念節點帶 applicant_count 也算 stored', () => {
    const storedGraph: GraphData = structuredClone(legacyApplicantGraph)
    storedGraph.nodes = storedGraph.nodes.map((node) =>
      node.type === 'concept' ? { ...node, applicant_count: 3 } : node,
    )
    expect(applicantAvailability(storedGraph)).toBe('stored')
  })

  it('無結構邊也無家統計 → none', () => {
    const bare: GraphData = structuredClone(legacyApplicantGraph)
    bare.edges = bare.edges.filter((edge) => edge.kind === 'cooccurrence')
    expect(applicantAvailability(bare)).toBe('none')
  })
})

describe('舊格式圖在「家」單位的概念視圖（P9 重建）', () => {
  it('未篩選＋家單位：邊由結構重建（不能是 0 條）', () => {
    const view = selectGraphView(legacyApplicantGraph, conceptOptions('applicant'))
    expect(view.edges.length).toBeGreaterThan(0)
    const co = view.edges.find((edge) => edge.id === 'coAB')
    expect(co).toBeDefined()
    // 同一機構跨篇碰過兩概念也算共同投入：A–B 家 support = a1 = 1。
    expect(co!.support_applicants).toBe(1)
    expect(co!.support_count).toBe(1)
  })

  it('未篩選＋家單位：節點大小與家數一致（不是退回篇數）', () => {
    const view = selectGraphView(legacyApplicantGraph, conceptOptions('applicant'))
    // A：2 篇但只有 1 家 → 家單位大小 = conceptSize(1) ≠ 篇單位 conceptSize(2)。
    expect(view.nodes.find((node) => node.label === 'A')?.size).toBe(conceptSize(1))
    // B：a1、a2 都碰過 → conceptSize(2)。
    expect(view.nodes.find((node) => node.label === 'B')?.size).toBe(conceptSize(2))
    expect(view.nodes.find((node) => node.label === 'C')?.size).toBe(conceptSize(1))
  })

  it('未篩選＋家單位：統計與圖例 claim 一致', () => {
    const view = selectGraphView(legacyApplicantGraph, conceptOptions('applicant'))
    expect(view.stats.applicant_count).toBe(2)
    expect(view.stats.patent_count).toBe(3)
    // 重建路徑順帶補上舊資料沒有的活性中位年（active scope 語意）。
    expect(view.nodes.find((node) => node.label === 'A')?.first_year).toBe(2020)
  })

  it('圖例說明：rebuildable＋家單位附重建說明；篇單位不附', () => {
    const applicantView = selectGraphView(legacyApplicantGraph, conceptOptions('applicant'))
    expect(applicantView.capabilityWarning).toContain('舊格式')
    expect(applicantView.capabilityWarning).toContain('重建')
    const patentView = selectGraphView(legacyApplicantGraph, conceptOptions('patent'))
    expect(patentView.capabilityWarning ?? '').not.toContain('重建')
  })

  it('篇單位照舊：用儲存的 support_count 與大小', () => {
    const view = selectGraphView(legacyApplicantGraph, conceptOptions('patent'))
    expect(view.edges.length).toBe(2)
    expect(view.nodes.find((node) => node.label === 'A')?.size).toBe(conceptSize(2))
    expect(view.nodes.find((node) => node.label === 'B')?.size).toBe(conceptSize(2))
    expect(view.capabilityWarning).toBeUndefined()
  })

  it('stored 圖走原路徑：家單位直接讀儲存統計，無重建說明', () => {
    const stored: GraphData = structuredClone(legacyApplicantGraph)
    stored.schema_version = 3
    stored.edges = stored.edges.map((edge) =>
      edge.kind === 'cooccurrence' ? { ...edge, support_applicants: 7, jaccard_applicants: 0.5 } : edge,
    )
    stored.nodes = stored.nodes.map((node) =>
      node.type === 'concept' ? { ...node, applicant_count: 5 } : node,
    )
    const view = selectGraphView(stored, conceptOptions('applicant'))
    expect(view.edges.length).toBe(2)
    expect(view.edges.find((edge) => edge.id === 'coAB')?.support_applicants).toBe(7)
    expect(view.nodes.find((node) => node.label === 'A')?.size).toBe(conceptSize(5))
    expect(view.capabilityWarning).toBeUndefined()
  })

  it('已篩選路徑（舊格式＋家）照常重建（回歸：原本就有的能力不壞掉）', () => {
    const view = selectGraphView(legacyApplicantGraph, {
      ...conceptOptions('applicant'),
      yearRange: [2021, 2022],
    })
    expect(view.edges.length).toBeGreaterThan(0)
  })

  it('none 圖＋家單位：維持舊行為（0 邊），由 UI 停用切換', () => {
    const bare: GraphData = structuredClone(legacyApplicantGraph)
    bare.edges = bare.edges.filter((edge) => edge.kind === 'cooccurrence')
    const view = selectGraphView(bare, conceptOptions('applicant'))
    expect(applicantAvailability(bare)).toBe('none')
    expect(view.edges.filter((edge) => edge.kind === 'cooccurrence').length).toBe(0)
  })
})