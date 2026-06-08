'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import SearchBox from './SearchBox'
import NodeInfo from './NodeInfo'
import YearFilter from './YearFilter'
import LayerToggle from './LayerToggle'
import CommunityLegend from './CommunityLegend'
import AIReport from './AIReport'
import type { GraphNode, GraphEdge, Community, NodeType } from '@/types/graph'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: Community[]
  aiReport: string
  yearRange: [number, number]
  fullYearRange: [number, number]
  selectedNode: GraphNode | null
  visibleLayers: Set<NodeType>
  hiddenCommunities: Set<number>
  onYearChange: (range: [number, number]) => void
  onLayerToggle: (type: NodeType) => void
  onCommunityToggle: (id: number) => void
  onNodeFocus: (nodeId: string) => void
  onNodeSelect: (node: GraphNode | null) => void
}

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-2 group cursor-pointer">
        <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide">
          {title}
        </span>
        <ChevronDown
          size={12}
          className="text-[#475569] transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export default function Sidebar({
  nodes,
  edges,
  communities,
  aiReport,
  yearRange,
  fullYearRange,
  selectedNode,
  visibleLayers,
  hiddenCommunities,
  onYearChange,
  onLayerToggle,
  onCommunityToggle,
  onNodeFocus,
  onNodeSelect,
}: Props) {
  return (
    <aside
      className="w-[300px] flex-shrink-0 bg-[#1E293B] border-l border-[#334155] flex flex-col overflow-hidden"
      aria-label="控制側邊欄"
    >
      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-0.5">

          {/* Search */}
          <div className="pb-3">
            <SearchBox
              nodes={nodes}
              onNodeFocus={onNodeFocus}
              onNodeSelect={(n) => onNodeSelect(n)}
            />
          </div>

          <Separator className="bg-[#334155]" />

          {/* Node Info */}
          <Section title="節點資訊">
            {selectedNode ? (
              <NodeInfo
                node={selectedNode}
                edges={edges}
                nodes={nodes}
                communities={communities}
                onClose={() => onNodeSelect(null)}
                onNodeSelect={(n) => { onNodeSelect(n); onNodeFocus(n.id) }}
                onNodeFocus={onNodeFocus}
              />
            ) : (
              <p className="text-xs text-[#475569] pb-1">
                點擊圖譜中的節點以查看詳情
              </p>
            )}
          </Section>

          <Separator className="bg-[#334155]" />

          {/* Filters */}
          <Section title="篩選器">
            <div className="space-y-4">
              <div>
                <p className="text-xs text-[#475569] mb-2">年份範圍</p>
                <YearFilter
                  value={yearRange}
                  fullRange={fullYearRange}
                  onChange={onYearChange}
                />
              </div>
              <div>
                <p className="text-xs text-[#475569] mb-2">節點層</p>
                <LayerToggle
                  visibleLayers={visibleLayers}
                  onToggle={onLayerToggle}
                />
              </div>
            </div>
          </Section>

          <Separator className="bg-[#334155]" />

          {/* Community Legend */}
          {communities.length > 0 && (
            <>
              <Section title="技術社群">
                <CommunityLegend
                  communities={communities}
                  hiddenCommunities={hiddenCommunities}
                  onToggle={onCommunityToggle}
                />
              </Section>
              <Separator className="bg-[#334155]" />
            </>
          )}

          {/* AI Report */}
          {aiReport && (
            <Section title="AI 趨勢報告" defaultOpen={false}>
              <AIReport html={aiReport} />
            </Section>
          )}

        </div>
      </ScrollArea>
    </aside>
  )
}
