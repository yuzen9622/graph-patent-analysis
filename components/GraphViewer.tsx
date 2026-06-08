'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Network } from 'vis-network'
import type { GraphNode, GraphEdge, Community, NodeType } from '@/types/graph'

// ── vis-network helpers ───────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: Community[]
  onNodeSelect?: (node: GraphNode | null) => void
  yearRange?: [number, number]
  visibleLayers?: Set<NodeType>
  hiddenCommunities?: Set<number>
  focusNodeId?: string
}

type SimpleDataSet = {
  update: (items: { id: string; hidden?: boolean }[]) => void
}

export default function GraphViewer({
  nodes,
  edges,
  communities: _communities,
  onNodeSelect,
  yearRange,
  visibleLayers,
  hiddenCommunities,
  focusNodeId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)
  const nodeDataSetRef = useRef<SimpleDataSet | null>(null)
  const [stabilized, setStabilized] = useState(false)

  const handleFit = useCallback(() => {
    networkRef.current?.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
  }, [])

  // ── Build / rebuild network when nodes or edges change ──
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const init = async () => {
      const { Network } = await import('vis-network')
      const { DataSet } = await import('vis-data')
      if (cancelled || !containerRef.current) return

      const nodeDataSet = new DataSet(nodes.map(toVisNode))
      const edgeDataSet = new DataSet(edges.map(toVisEdge))
      nodeDataSetRef.current = nodeDataSet as unknown as SimpleDataSet

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
        if (!cancelled) {
          network.setOptions({ physics: { enabled: false } })
          setStabilized(true)
        }
      })

      network.on('click', (params) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0] as string
          onNodeSelect?.(nodes.find((n) => n.id === nodeId) ?? null)
        } else {
          onNodeSelect?.(null)
        }
      })

      // Double-click: focus mode (hide non-adjacent)
      network.on('doubleClick', (params) => {
        if (params.nodes.length === 0) {
          // Restore all on double-click canvas
          nodeDataSet.update(nodes.map(n => ({ id: n.id, hidden: false })))
          return
        }
        const clickedId = params.nodes[0] as string
        const adjacent = new Set<string>([clickedId])
        edges.forEach(e => {
          if (e.from === clickedId) adjacent.add(e.to)
          if (e.to === clickedId) adjacent.add(e.from)
        })
        nodeDataSet.update(nodes.map(n => ({ id: n.id, hidden: !adjacent.has(n.id) })))
      })
    }

    void init()

    return () => {
      cancelled = true
      if (networkRef.current) {
        networkRef.current.destroy()
        networkRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  // ── Apply filter: yearRange + visibleLayers + hiddenCommunities ──
  useEffect(() => {
    if (!nodeDataSetRef.current) return

    const [y0, y1] = yearRange ?? [0, 9999]
    const updates = nodes.map(n => {
      let hidden = false

      if (visibleLayers && !visibleLayers.has(n.type)) hidden = true

      if (!hidden && n.type === 'patent' && n.year) {
        if (n.year < y0 || n.year > y1) hidden = true
      }

      if (!hidden && n.type === 'concept' && n.community_id !== undefined) {
        if (hiddenCommunities?.has(n.community_id)) hidden = true
      }

      return { id: n.id, hidden }
    })

    nodeDataSetRef.current.update(updates)
  }, [nodes, yearRange, visibleLayers, hiddenCommunities])

  // ── Focus a node (from SearchBox) ──
  useEffect(() => {
    if (!focusNodeId || !networkRef.current) return
    networkRef.current.focus(focusNodeId, {
      scale: 1.5,
      animation: { duration: 400, easingFunction: 'easeInOutQuad' },
    })
    networkRef.current.selectNodes([focusNodeId])
  }, [focusNodeId])

  return (
    <div className="relative w-full h-full bg-[#0F172A]">
      {/* Fit-to-view button */}
      <button
        onClick={handleFit}
        title="全部顯示"
        className="absolute top-3 right-3 z-10 px-2.5 py-1.5 text-xs rounded border border-[#334155] bg-[#1E293B]/90 text-[#94A3B8] hover:text-[#F8FAFC] hover:border-[#4E79A7] transition-colors duration-150 cursor-pointer backdrop-blur-sm"
      >
        全部顯示
      </button>

      {/* Stabilizing overlay */}
      {!stabilized && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-[#0F172A]/85 border border-[#334155] rounded-md px-4 py-1.5 text-xs text-[#94A3B8] pointer-events-none backdrop-blur-sm">
          佈局計算中…
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
