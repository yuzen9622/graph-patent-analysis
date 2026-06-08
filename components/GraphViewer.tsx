"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Network } from "vis-network";
import type { GraphNode, GraphEdge, Community, NodeType } from "@/types/graph";

// ── Performance thresholds ────────────────────────────────────────────────────
// LARGE: shadows off, hideEdgesOnDrag on, reduced iterations
// HUGE:  straight edges, hover off, hideEdgesOnZoom on, clustering
const LARGE_GRAPH = 120;
const HUGE_GRAPH = 350;

// ── DataSet update types ──────────────────────────────────────────────────────

type NodeUpdate = { id: string; hidden?: boolean; opacity?: number };
type EdgeColorProp = { inherit: "from"; opacity?: number };
type EdgeUpdate = { id: string; hidden?: boolean; color?: EdgeColorProp };
type NodeDataSet = { update: (items: NodeUpdate[]) => void };
type EdgeDataSet = { update: (items: EdgeUpdate[]) => void };

// ── vis-network helpers ───────────────────────────────────────────────────────

function toVisNode(n: GraphNode, pos?: { x: number; y: number }) {
  const isApplicant = n.type === "applicant";
  const isPatent = n.type === "patent";
  const baseColor = n.color.length === 9 ? n.color.slice(0, 7) : n.color;

  return {
    id: n.id,
    label: isApplicant ? n.label : isPatent ? "" : n.label,
    title: buildTitle(n),
    shape: isApplicant ? "star" : "dot",
    size: n.size,
    color: {
      background: n.color,
      // border must NOT be 'transparent' — vis-network uses border color for
      // edge `inherit:'from'` rendering.
      border: baseColor,
      highlight: { background: n.color, border: baseColor },
      hover: { background: n.color, border: baseColor },
    },
    font: {
      color: "#000000",
      size: isApplicant ? 14 : isPatent ? 0 : 11,
      face: "Atkinson Hyperlegible, sans-serif",
    },
    ...(pos ?? {}),
  };
}

function buildTitle(n: GraphNode): string {
  if (n.type === "applicant")
    return `申請人：${n.label}（${n.patent_count ?? 0} 件專利）`;
  if (n.type === "patent")
    return `${n.title ?? n.label}${n.filing_date ? `\n申請日：${n.filing_date}` : ""}`;
  return `概念：${n.label}（出現 ${n.frequency ?? 1} 次）`;
}

function toVisEdge(e: GraphEdge) {
  const isConceptEdge =
    e.from.startsWith("concept:") && e.to.startsWith("concept:");
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    label:
      e.relation && e.relation !== "is_part_of" && e.relation !== "belongs_to"
        ? e.relation
        : "",
    width: isConceptEdge ? Math.max(1.5, (e.weight ?? 1) * 0.5) : 1,
    color: { inherit: "from" as const, opacity: isConceptEdge ? 0.75 : 0.45 },
    arrows: { to: { enabled: true, scaleFactor: 0.4 } },
    font: { size: 9, color: "rgb(115, 115, 115)", strokeWidth: 0 },
    // smooth is controlled globally via options — not set per-edge
    // so that perf-adaptive global setting takes effect
  };
}

// Pre-spread concept nodes by community so ForceAtlas2 starts from a
// separated state — prevents same-community nodes from collapsing together.
function buildInitialPositions(
  nodes: GraphNode[],
): Map<string, { x: number; y: number }> {
  const byComm = new Map<number, string[]>();
  nodes.forEach((n) => {
    if (n.type === "concept" && n.community_id !== undefined) {
      const arr = byComm.get(n.community_id) ?? [];
      arr.push(n.id);
      byComm.set(n.community_id, arr);
    }
  });

  const comms = [...byComm.entries()];
  const K = comms.length;
  if (K === 0) return new Map();

  const RING = Math.max(500, K * 140);
  const SPREAD = 140;

  const positions = new Map<string, { x: number; y: number }>();
  comms.forEach(([, ids], ci) => {
    const ca = (ci / K) * 2 * Math.PI;
    const cx = Math.cos(ca) * RING;
    const cy = Math.sin(ca) * RING;
    ids.forEach((id, ni) => {
      const na = (ni / Math.max(ids.length, 1)) * 2 * Math.PI;
      const r = SPREAD * (0.35 + (ni % 3) * 0.32);
      positions.set(id, {
        x: cx + Math.cos(na) * r,
        y: cy + Math.sin(na) * r,
      });
    });
  });
  return positions;
}

// Adaptive options: degrade rendering quality as graph size grows.
// Inspired by vis-network smoothWorldCup example which achieves fluid
// rendering by: adaptiveTimestep, continuous (not dynamic) smooth, and
// hiding edges during drag/zoom.
function buildOptions(nodeCount: number) {
  const isLarge = nodeCount >= LARGE_GRAPH;
  const isHuge = nodeCount >= HUGE_GRAPH;

  return {
    nodes: {
      // borderWidth: 0 cuts per-node border stroke in large graphs
      borderWidth: isLarge ? 0 : 1,
      // shadow is very expensive — disable for large graphs
      shadow: isLarge
        ? false
        : { enabled: true, size: 5, x: 2, y: 2, color: "rgba(0,0,0,0.6)" },
    },
    edges: {
      color: { inherit: "from" as const, opacity: 1 },
      selectionWidth: 2,
      // "continuous" smooth: canvas-only, no hidden physics nodes (fast).
      // For huge graphs use straight lines — eliminates all curve math.
      smooth: isHuge
        ? false
        : { enabled: true, type: "continuous" as const, roundness: 0.2 },
    },
    physics: {
      solver: "forceAtlas2Based" as const,
      forceAtlas2Based: {
        gravitationalConstant: isLarge ? -26 : -60,
        centralGravity: 0.008,
        springLength: isLarge ? 100 : 120,
        springConstant: 0.06,
        damping: 0.45,
        // avoidOverlap adds per-node overlap checks
        avoidOverlap: isLarge ? 0 : 0,
      },
      // adaptiveTimestep: key WorldCup trick — auto-scales dt for stability,
      // meaning the solver converges in far fewer real iterations
      adaptiveTimestep: true,
      maxVelocity: 50,
      minVelocity: 0.75,
      stabilization: {
        enabled: true,
        iterations: isHuge ? 80 : isLarge ? 130 : 200,
        updateInterval: isLarge ? 25 : 15,
        fit: false,
      },
    },
    interaction: {
      hover: !isHuge,
      tooltipDelay: 250,
      navigationButtons: false,
      keyboard: { enabled: true, bindToWindow: false },
      zoomView: true,
      dragView: true,
      // hiding edges during drag/zoom is the single biggest UX win for
      // large graphs — canvas redraws drop from O(E) to O(N) per frame
      hideEdgesOnDrag: isLarge,
      hideEdgesOnZoom: isHuge,
    },
    layout: { improvedLayout: false },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: Community[];
  onNodeSelect?: (node: GraphNode | null) => void;
  yearRange?: [number, number];
  visibleLayers?: Set<NodeType>;
  hiddenCommunities?: Set<number>;
  focusNodeId?: string;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodeDataSetRef = useRef<NodeDataSet | null>(null);
  const edgeDataSetRef = useRef<EdgeDataSet | null>(null);
  const [stabilized, setStabilized] = useState(false);
  const [stabProgress, setStabProgress] = useState(0);

  const handleFit = useCallback(() => {
    networkRef.current?.fit({
      animation: { duration: 400, easingFunction: "easeInOutQuad" },
    });
  }, []);

  // ── Build / rebuild network when nodes or edges change ──
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const init = async () => {
      const { Network } = await import("vis-network");
      const { DataSet } = await import("vis-data");
      if (cancelled || !containerRef.current) return;

      const initPos = buildInitialPositions(nodes);
      const nodeDataSet = new DataSet(
        nodes.map((n) => toVisNode(n, initPos.get(n.id))),
      );
      const edgeDataSet = new DataSet(edges.map(toVisEdge));
      nodeDataSetRef.current = nodeDataSet as unknown as NodeDataSet;
      edgeDataSetRef.current = edgeDataSet as unknown as EdgeDataSet;

      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }

      const network = new Network(
        containerRef.current,
        { nodes: nodeDataSet, edges: edgeDataSet },
        buildOptions(nodes.length),
      );
      networkRef.current = network;

      setStabilized(false);
      setStabProgress(0);

      network.on("stabilizationProgress", (params) => {
        if (!cancelled)
          setStabProgress(Math.round((params.iterations / params.total) * 100));
      });

      network.once("stabilizationIterationsDone", () => {
        if (!cancelled) {
          network.setOptions({ physics: { enabled: false } });
          setStabilized(true);
          setStabProgress(100);
        }
      });

      // ── Highlight: dim non-adjacent nodes/edges on click ──────────────
      let highlightActive = false;
      const DIM_EDGE: EdgeColorProp = { inherit: "from", opacity: 0.06 };

      const applyHighlight = (clickedId: string) => {
        const adjacent = new Set<string>([clickedId]);
        const adjEdgeIds = new Set<string>();
        edges.forEach((e) => {
          if (e.from === clickedId || e.to === clickedId) {
            adjacent.add(e.from);
            adjacent.add(e.to);
            adjEdgeIds.add(e.id);
          }
        });
        nodeDataSet.update(
          nodes.map((n) => ({
            id: n.id,
            opacity: adjacent.has(n.id) ? 1 : 0.08,
          })),
        );
        edgeDataSet.update(
          edges.map((e) => ({
            id: e.id,
            color: adjEdgeIds.has(e.id) ? toVisEdge(e).color : DIM_EDGE,
          })),
        );
        highlightActive = true;
      };

      const clearHighlight = () => {
        if (!highlightActive) return;
        nodeDataSet.update(nodes.map((n) => ({ id: n.id, opacity: 1 })));
        edgeDataSet.update(
          edges.map((e) => ({ id: e.id, color: toVisEdge(e).color })),
        );
        highlightActive = false;
      };

      network.on("click", (params) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0] as string;
          onNodeSelect?.(nodes.find((n) => n.id === nodeId) ?? null);
          applyHighlight(nodeId);
        } else {
          onNodeSelect?.(null);
          clearHighlight();
        }
      });

      // Double-click: focus mode (hide non-adjacent).
      // Clear opacity-highlight first to avoid stacked visual states.
      network.on("doubleClick", (params) => {
        clearHighlight();
        if (params.nodes.length === 0) {
          nodeDataSet.update(nodes.map((n) => ({ id: n.id, hidden: false })));
          return;
        }
        const clickedId = params.nodes[0] as string;
        const adjacent = new Set<string>([clickedId]);
        edges.forEach((e) => {
          if (e.from === clickedId) adjacent.add(e.to);
          if (e.to === clickedId) adjacent.add(e.from);
        });
        nodeDataSet.update(
          nodes.map((n) => ({ id: n.id, hidden: !adjacent.has(n.id) })),
        );
      });
    };

    void init();

    return () => {
      cancelled = true;
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // ── Apply filter: yearRange + visibleLayers + hiddenCommunities ──
  useEffect(() => {
    if (!nodeDataSetRef.current) return;

    const [y0, y1] = yearRange ?? [0, 9999];

    const hiddenIds = new Set<string>();
    const nodeUpdates = nodes.map((n) => {
      let hidden = false;

      if (visibleLayers && !visibleLayers.has(n.type)) hidden = true;

      if (!hidden && n.type === "patent" && n.year) {
        if (n.year < y0 || n.year > y1) hidden = true;
      }

      if (!hidden && n.type === "concept" && n.community_id !== undefined) {
        if (hiddenCommunities?.has(n.community_id)) hidden = true;
      }

      if (hidden) hiddenIds.add(n.id);
      return { id: n.id, hidden };
    });

    nodeDataSetRef.current.update(nodeUpdates);

    // Sync edge visibility: hide any edge whose from OR to node is hidden.
    if (edgeDataSetRef.current) {
      const edgeUpdates = edges.map((e) => ({
        id: e.id,
        hidden: hiddenIds.has(e.from) || hiddenIds.has(e.to),
      }));
      edgeDataSetRef.current.update(edgeUpdates);
    }
  }, [nodes, edges, yearRange, visibleLayers, hiddenCommunities]);

  // ── Focus a node (from SearchBox) ──
  useEffect(() => {
    if (!focusNodeId || !networkRef.current) return;
    networkRef.current.focus(focusNodeId, {
      scale: 1.5,
      animation: { duration: 400, easingFunction: "easeInOutQuad" },
    });
    networkRef.current.selectNodes([focusNodeId]);
  }, [focusNodeId]);

  const isLarge = nodes.length >= LARGE_GRAPH;

  return (
    <div className="relative w-full h-full bg-accent">
      {/* Fit-to-view button */}
      <button
        onClick={handleFit}
        title="全部顯示"
        className="absolute top-3 right-3 z-10 px-2.5 py-1.5 text-xs rounded border border-border bg-background/90 text-muted-foreground hover:primary-foreground hover:border-[#4E79A7] transition-colors duration-150 cursor-pointer backdrop-blur-sm"
      >
        全部顯示
      </button>

      {/* Stabilizing overlay with progress */}
      {!stabilized && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 bg-accent/85 border border-border rounded-md px-4 py-2 pointer-events-none backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            佈局計算中… {stabProgress > 0 ? `${stabProgress}%` : ""}
          </span>
          {isLarge && (
            <div className="w-32 h-1 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-[#4E79A7] rounded-full transition-all duration-150"
                style={{ width: `${stabProgress}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
