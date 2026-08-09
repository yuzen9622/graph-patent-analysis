import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { GraphData } from '@/types/graph'

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  loadGraph: vi.fn(),
  requireUser: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
}))

vi.mock('@/lib/store', () => ({
  getJob: mocks.getJob,
}))

vi.mock('@/lib/db/analyses', () => ({
  loadGraph: mocks.loadGraph,
}))

vi.mock('@/lib/db/sessions', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: mocks.requireUser,
  }
})

import { GET, POST } from '@/app/api/export/[id]/route'

const graph: GraphData = {
  schema_version: 2,
  nodes: [
    {
      id: 'concept:alpha',
      type: 'concept',
      label: 'Alpha',
      color: '#000000',
      size: 16,
      frequency: 1,
      community_id: 0,
    },
  ],
  edges: [],
  communities: [{ id: 0, name: '群', color: '#000000', node_count: 1 }],
  stats: {
    applicant_count: 0,
    patent_count: 0,
    concept_count: 1,
    community_count: 1,
    year_range: [2020, 2022],
  },
  ai_report: '',
  generated_at: '2026-01-01T00:00:00.000Z',
  methodology: {
    concept_frequency_metric: 'unique_patent_count',
    cooccurrence_metric: 'unique_patent_support',
    concept_size_formula: 'x',
    applicant_size_formula: 'x',
    patent_size: 18,
    community_algorithm: 'louvain',
    community_edge_weight: 'support_count',
    community_resolution: 1,
    community_random_walk: false,
    layout_distance_interpretation: 'visual_only',
    prompt_version: 'test',
    model_provider: 'test',
    model_id: 'test',
    cooccurrence_data: 'native',
    semantic_provenance: 'complete',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUser.mockResolvedValue({ id: 'user-id' })
  mocks.getJob.mockReturnValue(undefined)
  mocks.loadGraph.mockResolvedValue(graph)
  mocks.readFileSync.mockReturnValue('window.vis = {};')
})

describe('export route', () => {
  it('returns the POST-only guidance without authenticating or loading graph state', async () => {
    const response = await GET()

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    await expect(response.json()).resolves.toEqual({
      error: '請使用分析頁面的「離線 HTML」按鈕；此端點僅支援 POST。',
    })
    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(mocks.getJob).not.toHaveBeenCalled()
    expect(mocks.loadGraph).not.toHaveBeenCalled()
    expect(mocks.readFileSync).not.toHaveBeenCalled()
  })

  it('keeps the canonical POST attachment contract', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/export/job-id?mode=concept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positions: { 'concept:alpha': { x: 12.5, y: -4 } },
        }),
      }),
      { params: Promise.resolve({ id: 'job-id' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="patent-graph-\d{8}\.html"$/,
    )
    const html = await response.text()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('"frozenLayouts":{"concept"')
    expect(html).toContain('"x":12.5,"y":-4')
    expect(html).toContain('citation-toggle')
    expect(mocks.requireUser).toHaveBeenCalledTimes(1)
    expect(mocks.getJob).toHaveBeenCalledWith('job-id')
    expect(mocks.loadGraph).toHaveBeenCalledWith('job-id')
  })
})
