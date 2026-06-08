"use client";

import { useState, useCallback } from "react";
import { BarChart2, Copy, Check, Download } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Sidebar from "./Sidebar";
import StatsBar from "./StatsBar";
import AnalysisHistorySidebar from "./AnalysisHistorySidebar";
import type { GraphData, GraphNode, NodeType } from "@/types/graph";

// Load vis-network component client-side only
const GraphViewer = dynamic(() => import("./GraphViewer"), { ssr: false });

interface Props {
  graph: GraphData;
  jobId: string;
}

export default function GraphLayout({ graph, jobId }: Props) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [yearRange, setYearRange] = useState<[number, number]>(
    graph.stats.year_range,
  );
  const [visibleLayers, setVisibleLayers] = useState<Set<NodeType>>(
    new Set<NodeType>(["applicant", "patent", "concept"]),
  );
  const [hiddenCommunities, setHiddenCommunities] = useState<Set<number>>(
    new Set(),
  );
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleCopy = useCallback(() => {
    if (typeof window !== "undefined") {
      void navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const toggleLayer = useCallback((type: NodeType) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleCommunity = useCallback((id: number) => {
    setHiddenCommunities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Header ── */}
      <header className="shrink-0 bg-accent border-b border-border px-4 py-2.5 flex items-center justify-between gap-3 min-h-[52px]">
        <Link href="/" className="flex items-center gap-2.5 min-w-0 hover:opacity-85 transition-opacity">
          <BarChart2
            size={20}
            className="text-success shrink-0"
            aria-hidden
          />
          <div className="min-w-0">
            <h1 className="font-serif text-base font-bold text-foreground leading-tight truncate">
              專利知識圖譜分析
            </h1>
            <p className="text-[0.65rem] text-foreground leading-none mt-0.5 font-mono">
              {jobId.slice(0, 8)}…
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-accent hover:text-accent-foreground hover:border-accent transition-colors duration-150 cursor-pointer"
            aria-label="複製分享連結"
          >
            {copied ? (
              <>
                <Check size={12} className="text-success" />
                已複製
              </>
            ) : (
              <>
                <Copy size={12} />
                複製連結
              </>
            )}
          </button>
          <a
            href={`/api/export/${jobId}`}
            className="inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-accent hover:text-accent-foreground transition-colors duration-150"
            aria-label="下載離線 HTML 圖譜"
          >
            <Download size={12} />
            離線 HTML
          </a>
        </div>
      </header>

      {/* ── Main area: graph + sidebar ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* History sidebar — hidden on mobile */}
        <div className="hidden md:flex shrink-0">
          <AnalysisHistorySidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
          />
        </div>

        {/* Graph canvas */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <GraphViewer
            nodes={graph.nodes}
            edges={graph.edges}
            communities={graph.communities}
            onNodeSelect={setSelectedNode}
            yearRange={yearRange}
            visibleLayers={visibleLayers}
            hiddenCommunities={hiddenCommunities}
            focusNodeId={focusNodeId}
          />
        </div>

        {/* Right sidebar */}
        <Sidebar
          nodes={graph.nodes}
          edges={graph.edges}
          communities={graph.communities}
          aiReport={graph.ai_report}
          yearRange={yearRange}
          fullYearRange={graph.stats.year_range}
          selectedNode={selectedNode}
          visibleLayers={visibleLayers}
          hiddenCommunities={hiddenCommunities}
          onYearChange={setYearRange}
          onLayerToggle={toggleLayer}
          onCommunityToggle={toggleCommunity}
          onNodeFocus={setFocusNodeId}
          onNodeSelect={setSelectedNode}
        />
      </div>

      {/* ── Stats bar ── */}
      <StatsBar stats={graph.stats} />
    </div>
  );
}
