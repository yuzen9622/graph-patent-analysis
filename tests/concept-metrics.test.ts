import { describe, expect, it } from 'vitest'
import {
  computeUnitMetrics,
  detectUnitCommunities,
  normalizedPointwiseMutualInformation,
  pairApplicantSupport,
} from '../lib/concept-metrics'

describe('pairApplicantSupport（家單位邊計數）', () => {
  it('同一申請人跨不同專利碰過 A 與 B，也算 co-covers (A,B)', () => {
    // X 的專利 P1 有 A，P2 有 B —— 跨篇也算「X 同時做 A 與 B」。
    const applicantConcepts = new Map<string, Set<string>>([
      ['X', new Set(['A', 'B'])],
      ['Y', new Set(['A'])],
    ])
    const pairs = pairApplicantSupport(applicantConcepts)
    const key = 'A\u0000B'
    expect(pairs.get(key)).toEqual(new Set(['X']))
    expect(pairs.size).toBe(1)
  })

  it('同一家內多個專利重複碰到同一概念不會重複計家', () => {
    const applicantConcepts = new Map<string, Set<string>>([
      ['X', new Set(['A', 'B'])],
      ['Y', new Set(['A', 'B'])],
    ])
    const pairs = pairApplicantSupport(applicantConcepts)
    expect(pairs.get('A\u0000B')?.size).toBe(2)
  })
})

describe('NPMI（Q5 定案）', () => {
  it('p_ij = 1 → undefined（不記成量尺最大值）', () => {
    expect(normalizedPointwiseMutualInformation(1, 0.5, 0.5)).toBeUndefined()
    expect(normalizedPointwiseMutualInformation(0.999999999999, 0.9, 0.9)).toBeUndefined()
  })

  it('一般情況算出有界值並 clamp(-1,1)', () => {
    const v = normalizedPointwiseMutualInformation(0.5, 0.5, 0.5)
    expect(v).toBeCloseTo(1, 6)
    // 過度共現導致的浮點溢出也被 clamp 在 [-1,1]
    const extreme = normalizedPointwiseMutualInformation(0.9, 0.1, 0.1)
    expect(extreme).toBeLessThanOrEqual(1)
    expect(extreme).toBeGreaterThanOrEqual(-1)
    // 負相關往 -1 方向（接近但不強制到 -1）
    const neg = normalizedPointwiseMutualInformation(0.01, 0.9, 0.9)
    expect(neg).toBe(-0.9542425094393251)
  })

  it('零機率 → undefined', () => {
    expect(normalizedPointwiseMutualInformation(0, 0.5, 0.5)).toBeUndefined()
  })
})

describe('computeUnitMetrics（全量、門檻前）', () => {
  // X: P1(A,B) P2(C) → {A,B,C}; Y: P3(A,B) → {A,B}; Z: P4(D) → {D}
  // 篇共現：P1,P3 同時含 (A,B) → support_patents(A,B)=2；(A,C) 只 P1 → 1；(B,C) 只 P1 → 1
  const applicantConcepts = new Map<string, Set<string>>([
    ['X', new Set(['A', 'B', 'C'])],
    ['Y', new Set(['A', 'B'])],
    ['Z', new Set(['D'])],
  ])
  const pairApplicants = pairApplicantSupport(applicantConcepts)
  const conceptPatents = new Map<string, number>([
    ['A', 2],
    ['B', 2],
    ['C', 1],
    ['D', 1],
  ])
  const conceptApplicants = new Map<string, number>([
    ['A', 2],
    ['B', 2],
    ['C', 1],
    ['D', 1],
  ])

  const cooccurrence = [
    { id: 'e1', from: 'concept:A', to: 'concept:B', support_count: 2 },
    { id: 'e2', from: 'concept:A', to: 'concept:C', support_count: 1 },
  ]

  const metrics = computeUnitMetrics({
    cooccurrence,
    conceptPatents,
    conceptApplicants,
    pairApplicants,
    totalPatents: 4,
    totalInstitutions: 3,
  })

  it('家單位支持度：同機構跨篇也算', () => {
    expect(metrics.get('e1')?.support_applicants).toBe(2) // X,Y 都碰過 A 與 B
    expect(metrics.get('e2')?.support_applicants).toBe(1) // 只有 X
  })

  it('家單位 jaccard', () => {
    // (A,B)：家交集 2，聯集 2 → 1
    expect(metrics.get('e1')?.jaccard_applicants).toBeCloseTo(1, 6)
    // (A,C)：家交集 1，聯集 2+1-1=2 → 0.5
    expect(metrics.get('e2')?.jaccard_applicants).toBeCloseTo(0.5, 6)
  })

  it('篇單位 NPMI 對 p_ij=1 回 undefined（同套 Q5 邏輯）', () => {
    const single = computeUnitMetrics({
      cooccurrence: [{ id: 'only', from: 'concept:A', to: 'concept:B', support_count: 1 }],
      conceptPatents: new Map([['A', 1], ['B', 1]]),
      conceptApplicants: new Map([['A', 1], ['B', 1]]),
      pairApplicants: pairApplicantSupport(new Map([['X', new Set(['A', 'B'])]])) as never,
      totalPatents: 1,
      totalInstitutions: 1,
    })
    expect(single.get('only')?.npmi).toBeUndefined()
  })

  it('association strength 按決策 2 公式、同圖排序用', () => {
    // c_A = 2(e1) + 1(e2) = 3；c_B = 2；c_C = 1
    // m = (2 + 1) / 2 = 1.5
    // s_e1 = 2*1.5*2 / (3*2) = 1
    expect(metrics.get('e1')?.association_strength).toBeCloseTo(1, 6)
    // s_e2 = 2*1.5*1 / (3*1) = 1
    expect(metrics.get('e2')?.association_strength).toBeCloseTo(1, 6)
  })
})

describe('detectUnitCommunities（Q2：家單位分區）', () => {
  it('連邊的概念同群；孤立概念各自成群', () => {
    const pairApplicants = pairApplicantSupport(
      new Map<string, Set<string>>([
        ['X', new Set(['A', 'B', 'C'])],
        ['Y', new Set(['A', 'B'])],
      ]),
    )
    const assignments = detectUnitCommunities(['A', 'B', 'C', 'D'], pairApplicants)
    expect(assignments.size).toBe(4)
    expect(assignments.get('A')).toBe(assignments.get('B'))
    expect(assignments.get('A')).toBe(assignments.get('C'))
    expect(assignments.get('D')).not.toBe(assignments.get('A'))
  })

  it('空圖（無邊）仍給出 deterministic 指派', () => {
    const assignments = detectUnitCommunities(['A', 'B'], new Map())
    expect(assignments.get('A')).toBeDefined()
    expect(assignments.get('B')).toBeDefined()
    expect(assignments.get('A')).not.toBe(assignments.get('B'))
  })
})