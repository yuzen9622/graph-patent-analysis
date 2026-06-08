'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Network } from 'vis-network'
import type { GraphNode, GraphEdge, Community } from '@/types/graph'

// ── Visual helpers ────────────────────────────────────────────────────────────

function toVisNode(n: GraphNode) {
  const isApplicant = n.type === 'applicant'
  const isPatent = n.type === 'patent'
  const baseColor = n.color.length === 9 ? n.color.slice(0, 7) : n.color

  return {
    id: n.id,
    label: isApplicant ? n.label : isPatent ? '' : n.label,
    title: buildTitle(n),
    shape: isApplicant ? 'star' : 'dot',
    size: n.size,
    color: {
      background: n.color,
      border: isApplicant ? baseColor : 'transparent',
      highlight: { background: n.color, border: baseColor },
      hover: { background: n.color, border: baseColor },
    },
    font: {
      color: '#F8FAFC',
      size: isApplicant ? 14 : isPatent ? 0 : 11,
      face: 'Atkinson Hyperlegible, sans-serif',
    },
  }
}

function buildTitle(n: GraphNode): string {
  if (n.type === 'applicant') return `申請人：${n.label}（${n.patent_count ?? 0} 件專利）`
  if (n.type === 'patent') return `${n.title ?? n.label}${n.filing_date ? `\n申請日：${n.filing_date}` : ''}`
  return `概念：${n.label}（出現 ${n.frequency ?? 1} 次）`
}

function toVisEdge(e: GraphEdge) {
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    label: e.relation && e.relation !== 'is_part_of' && e.relation !== 'belongs_to' ? e.relation : '',
    width: e.weight ? Math.max(1, e.weight * 0.6) : 1,
    color: { opacity: 0.45 },
    arrows: { to: { enabled: true, scaleFactor: 0.4 } },
    font: { size: 9, color: '#94A3B8', strokeWidth: 0 },
    smooth: { enabled: true, type: 'continuous', roundness: 0.2 },
  }
}

// ── Node info panel ───────────────────────────────────────────────────────────

function NodeInfoPanel({
  node,
  onClose,
}: {
  node: GraphNode
  onClose: () => void
}) {
  const typeLabel = { applicant: '申請人', patent: '專利', concept: '技術概念' }[node.type]

  return (
    <aside
      style={{
        width: '280px',
        flexShrink: 0,
        background: '#1E293B',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '16px',
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <button
        onClick={onClose}
        aria-label="關閉節點資訊"
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'none',
          border: 'none',
          color: '#94A3B8',
          fontSize: '1rem',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ✕
      </button>

      {/* Type badge */}
      <div
        style={{
          display: 'inline-block',
          background: node.color,
          color: '#020617',
          fontSize: '0.7rem',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: '4px',
          marginBottom: '8px',
          opacity: 0.9,
        }}
      >
        {typeLabel}
      </div>

      <h3
        style={{
          fontFamily: "'Crimson Pro', Georgia, serif",
          fontSize: '1rem',
          fontWeight: 600,
          color: '#F8FAFC',
          marginBottom: '12px',
          lineHeight: 1.4,
          wordBreak: 'break-all',
        }}
      >
        {node.label}
      </h3>

      {/* Fields */}
      <dl style={{ fontSize: '0.82rem', color: '#94A3B8' }}>
        {node.type === 'applicant' && (
          <Row label="專利件數" value={String(node.patent_count ?? 0)} />
        )}
        {node.type === 'patent' && (
          <>
            {node.applicant && <Row label="申請人" value={node.applicant} />}
            {node.filing_date && <Row label="申請日" value={node.filing_date} />}
            {node.year && <Row label="年份" value={String(node.year)} />}
            {node.application_number && (
              <Row label="申請號" value={node.application_number} />
            )}
            {node.abstract && (
              <div style={{ marginTop: '8px' }}>
                <dt style={{ color: '#64748B', marginBottom: '4px' }}>摘要</dt>
                <dd
                  style={{
                    color: '#CBD5E1',
                    lineHeight: 1.6,
                    fontSize: '0.78rem',
                    margin: 0,
                  }}
                >
                  {node.abstract.slice(0, 200)}
                  {node.abstract.length > 200 ? '…' : ''}
                </dd>
              </div>
            )}
          </>
        )}
        {node.type === 'concept' && (
          <>
            <Row label="出現次數" value={String(node.frequency ?? 1)} />
            {node.community_id !== undefined && (
              <Row label="所屬社群" value={String(node.community_id)} />
            )}
          </>
        )}
      </dl>
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
      <dt style={{ color: '#64748B', flexShrink: 0, width: '72px' }}>{label}</dt>
      <dd style={{ color: '#CBD5E1', margin: 0, wordBreak: 'break-word' }}>{value}</dd>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Layer = 'applicant' | 'patent' | 'concept'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: Community[]
}

export default function GraphViewer({ nodes, edges, communities }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    applicant: true,
    patent: true,
    concept: true,
  })
  const [stabilized, setStabilized] = useState(false)

  const toggleLayer = useCallback((layer: Layer) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))
  }, [])

  const handleFit = useCallback(() => {
    networkRef.current?.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    const init = async () => {
      const { Network, DataSet } = await import('vis-network')
      if (cancelled || !containerRef.current) return

      // Filter nodes/edges by visible layers
      const visibleNodes = nodes.filter((n) => layers[n.type])
      const visibleIds = new Set(visibleNodes.map((n) => n.id))
      const visibleEdges = edges.filter(
        (e) => visibleIds.has(e.from) && visibleIds.has(e.to),
      )

      const nodeDataSet = new DataSet(visibleNodes.map(toVisNode))
      const edgeDataSet = new DataSet(visibleEdges.map(toVisEdge))

      const options = {
        nodes: {
          borderWidth: 1,
          shadow: { enabled: true, size: 5, x: 2, y: 2, color: 'rgba(0,0,0,0.5)' },
        },
        edges: {
          color: { inherit: 'from', opacity: 0.4 },
          selectionWidth: 2,
        },
        physics: {
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -60,
            centralGravity: 0.008,
            springLength: 120,
            springConstant: 0.06,
            damping: 0.45,
          },
          stabilization: { iterations: 200, updateInterval: 50 },
        },
        interaction: {
          hover: true,
          tooltipDelay: 250,
          navigationButtons: false,
          keyboard: { enabled: true, bindToWindow: false },
          zoomView: true,
          dragView: true,
        },
        layout: { improvedLayout: false },
      }

      if (networkRef.current) {
        networkRef.current.destroy()
        networkRef.current = null
      }

      const network = new Network(
        containerRef.current,
        { nodes: nodeDataSet, edges: edgeDataSet },
        options,
      )
      networkRef.current = network

      setStabilized(false)
      network.once('stabilizationIterationsDone', () => {
        if (!cancelled) setStabilized(true)
      })

      network.on('click', (params) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0] as string
          setSelectedNode(nodes.find((n) => n.id === nodeId) ?? null)
        } else {
          setSelectedNode(null)
        }
      })
    }

    init()

    return () => {
      cancelled = true
      if (networkRef.current) {
        networkRef.current.destroy()
        networkRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, layers])

  const LAYER_LABELS: Record<Layer, string> = {
    applicant: '申請人',
    patent: '專利',
    concept: '技術概念',
  }

  return (
    <div style={{ display: 'flex', gap: '12px', height: '72vh' }}>
      {/* Canvas wrapper */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          background: '#0F172A',
          borderRadius: '8px',
          border: '1px solid #334155',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        {/* Layer toggles */}
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            zIndex: 10,
            display: 'flex',
            gap: '6px',
          }}
        >
          {(['applicant', 'patent', 'concept'] as Layer[]).map((layer) => (
            <button
              key={layer}
              onClick={() => toggleLayer(layer)}
              title={`切換顯示「${LAYER_LABELS[layer]}」節點`}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: `1px solid ${layers[layer] ? '#4E79A7' : '#475569'}`,
                background: layers[layer] ? '#4E79A766' : '#1E293B',
                color: layers[layer] ? '#BAD0F0' : '#94A3B8',
                fontSize: '0.75rem',
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
            >
              {LAYER_LABELS[layer]}
            </button>
          ))}
        </div>

        {/* Fit button */}
        <button
          onClick={handleFit}
          title="全部顯示"
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 10,
            padding: '4px 10px',
            borderRadius: '4px',
            border: '1px solid #475569',
            background: '#1E293B',
            color: '#94A3B8',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          全部顯示
        </button>

        {/* Stabilizing overlay */}
        {!stabilized && (
          <div
            style={{
              position: 'absolute',
              bottom: '12px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              background: 'rgba(15,23,42,0.85)',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '0.75rem',
              color: '#94A3B8',
              pointerEvents: 'none',
            }}
          >
            佈局計算中…
          </div>
        )}

        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Node detail panel */}
      {selectedNode && (
        <NodeInfoPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}

      {/* Community legend — show when no node is selected */}
      {!selectedNode && communities.length > 0 && (
        <aside
          style={{
            width: '200px',
            flexShrink: 0,
            background: '#1E293B',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '14px',
            overflow: 'auto',
          }}
        >
          <h3
            style={{
              fontFamily: "'Crimson Pro', Georgia, serif",
              fontSize: '0.9rem',
              fontWeight: 600,
              color: '#CBD5E1',
              marginBottom: '10px',
            }}
          >
            技術社群
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {communities.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '5px 0',
                  borderBottom: '1px solid #334155',
                  fontSize: '0.78rem',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: c.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: '#CBD5E1', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </span>
                <span style={{ color: '#64748B', flexShrink: 0 }}>{c.node_count}</span>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}
