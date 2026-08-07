"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Network } from "vis-network";
import type {
  GraphNode,
  GraphEdge,
  NodeType,
  GraphAnalysis,
  GodNode,
  SurprisingConnection,
} from "@/types/graph";
import {
  isValidGraphViewport,
  type GraphViewport,
} from "@/lib/graph-viewport";
import type { EdgeWeightMetric } from "@/lib/graph-view";

// ── Performance thresholds ────────────────────────────────────────────────────
// LARGE: shadows off, hideEdgesOnDrag on, reduced iterations
// HUGE:  straight edges, hover off, hideEdgesOnZoom on, clustering
const LARGE_GRAPH = 120;
const HUGE_GRAPH = 350;

// ── DataSet update types ──────────────────────────────────────────────────────

type NodeUpdate = {
  id: string;
  hidden?: boolean;
  opacity?: number;
  color?: string;
  label?: string;
};
type EdgeColorProp = { inherit: "from"; opacity?: number };
type EdgeUpdate = { id: string; hidden?: boolean; color?: EdgeColorProp };
type NodeDataSet = { update: (items: NodeUpdate[]) => void };
type EdgeDataSet = { update: (items: EdgeUpdate[]) => void };

// ── vis-network helpers ───────────────────────────────────────────────────────

function buildTitle(n: GraphNode, godInfo?: GodNode): string {
  const base = n.type === "applicant"
    ? `申請人：${n.label}（${n.patent_count ?? 0} 件專利）`
    : n.type === "patent"
    ? `${n.title ?? n.label}${n.filing_date ? `\n申請日：${n.filing_date}` : ""}`
    : n.type === "concept"
    ? `概念：${n.label}（涵蓋 ${n.frequency ?? 0} 篇專利）${timeLines(n)}`
    : n.title ?? n.label;
  return godInfo ? `${base}\n🔥 樞紐節點（degree: ${godInfo.degree}）` : base;
}

/** 概念時間統計的 tooltip 行（只顯示有資料的欄位）。 */
function timeLines(n: GraphNode): string {
  const lines: string[] = [];
  if (n.first_year !== undefined) lines.push(`首次出現：${n.first_year} 年`);
  if (n.median_year !== undefined) lines.push(`中位年：${n.median_year} 年`);
  if (n.last_year !== undefined) lines.push(`最近出現：${n.last_year} 年`);
  return lines.length ? `\n${lines.join("\n")}` : "";
}

function toVisNode(n: GraphNode, pos?: { x: number; y: number }, godInfo?: GodNode) {
  const isApplicant = n.type === "applicant";
  const isPatent = n.type === "patent";

  // Handle color being a string or an object
  let bgColor = "#BAB0AC";
  let borderColor = "#BAB0AC";
  let highlightBg = "#6B9CC3";
  let highlightBorder = "#6B9CC3";

  if (typeof n.color === "string") {
    bgColor = n.color;
    const baseColor = n.color.length === 9 ? n.color.slice(0, 7) : n.color;
    borderColor = baseColor;
    highlightBg = n.color;
    highlightBorder = baseColor;
  } else if (n.color && typeof n.color === "object") {
    const colorObj = n.color as {
      background?: string;
      border?: string;
      highlight?: { background?: string; border?: string };
    };
    bgColor = colorObj.background ?? bgColor;
    borderColor = colorObj.border ?? borderColor;
    if (colorObj.highlight) {
      highlightBg = colorObj.highlight.background ?? highlightBg;
      highlightBorder = colorObj.highlight.border ?? highlightBorder;
    } else {
      highlightBg = bgColor;
      highlightBorder = borderColor;
    }
  }

  const nodeFont = (n as { font?: unknown }).font as { size?: number; color?: string } | undefined;
  const fontSize = nodeFont?.size !== undefined
    ? nodeFont.size
    : (isApplicant ? 14 : isPatent ? 0 : 11);
  const fontColor = nodeFont?.color !== undefined
    ? nodeFont.color
    : "#000000";

  const shape = (n as { shape?: string }).shape ?? (isApplicant ? "star" : "dot");

  return {
    id: n.id,
    label: isApplicant ? n.label : isPatent ? "" : n.label,
    title: buildTitle(n, godInfo),
    shape: shape,
    size: n.size,
    borderWidth: godInfo ? 4 : undefined,
    color: {
      background: bgColor,
      border: godInfo ? "#FFD700" : borderColor,
      highlight: { background: highlightBg, border: godInfo ? "#FFD700" : highlightBorder },
      hover: { background: highlightBg, border: godInfo ? "#FFD700" : highlightBorder },
    },
    font: {
      color: fontColor,
      size: fontSize,
      face: "Atkinson Hyperlegible, sans-serif",
    },
    ...(pos ?? {}),
  };
}

function toVisEdge(e: GraphEdge, surprising?: SurprisingConnection, edgeWeight: EdgeWeightMetric = 'jaccard') {
  const isCooccurrence = e.kind === "cooccurrence";
  const isSemantic = e.kind === "semantic";
  const isInstitution = e.kind === "institution";
  const supportLine = isCooccurrence
    ? `共同出現：${e.support_count ?? 0} 篇 / ${e.support_applicants ?? 0} 家
` +
      `Jaccard：篇 ${(e.jaccard ?? 0).toFixed(3)} ｜ 家 ${fmt(e.jaccard_applicants)}
` +
      `NPMI：篇 ${fmt(e.npmi)} ｜ 家 ${fmt(e.npmi_applicants)}`
    : "";
  const semanticLine = isSemantic
    ? `LLM 語意關係：${e.relation}\n目前保存來源：${e.source_patents?.length ?? 0} 篇`
    : "";
  const institutionLine = isInstitution
    ? `共享概念：${e.support_count ?? 0} 個\n${(e.shared_concepts ?? []).slice(0, 6).join("、")}${(e.shared_concepts?.length ?? 0) > 6 ? ` …共 ${e.shared_concepts!.length} 個` : ""}`
    : "";
  const surprisingLine = surprising ? "\n跨社群罕見橋接" : "";
  const title = `${supportLine}${semanticLine}${institutionLine}${surprisingLine}` || e.relation;

  return {
    id: e.id,
    from: e.from,
    to: e.to,
    label: isSemantic ? e.relation : "",
    title,
    dashes: isSemantic ? ([6, 4] as [number, number]) : undefined,
    width: isCooccurrence
      ? cooccurrenceWidth(e, edgeWeight)
      : isInstitution
        ? Math.min(8, 1 + Math.sqrt(e.support_count ?? 1) * 1.4)
        : isSemantic
          ? 1.5
          : 1,
    color: surprising
      ? { color: "#FF6B35" }
      : isSemantic
        ? { color: "#8B5CF6", opacity: 0.8 }
        : isInstitution
          ? { color: "#0f766e", opacity: 0.75 }
          : isCooccurrence
            ? { color: "#64748B", opacity: 0.7 }
            : { color: "#94A3B8", opacity: 0.35 },
    arrows: {
      to: {
        enabled: isSemantic || isCooccurrence || e.kind === "structural",
        scaleFactor: 0.4,
      },
    },
    font: { size: 9, color: "rgb(115, 115, 115)", strokeWidth: 0 },
    // Semantic relations are an evidence overlay and must not alter layout.
    physics: !(isSemantic || isInstitution),
    // smooth is controlled globally via options — not set per-edge
    // so that perf-adaptive global setting takes effect
  };
}

function fmt(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(3)
}

/** 線寬用有界指標（意圖決策 2）：jaccard（預設）或 NPMI（p_ij=1 → 不顯示）。 */
function cooccurrenceWidth(e: GraphEdge, metric: EdgeWeightMetric): number {
  if (metric === 'npmi') {
    const v = Math.max(0, e.npmi ?? 0)
    return Math.min(8, 1 + v * 7)
  }
  return Math.min(8, 1 + (e.jaccard ?? 0) * 7)
}

function stableUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

// Pre-spread concept nodes by community so ForceAtlas2 starts from a
// separated state — prevents same-community nodes from collapsing together.
// For nodes without communities (e.g. applicants and patents), positions
// are computed iteratively from their connected nodes to prevent them from
// starting in a giant default outer circle, solving layout issues.
function buildInitialPositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // 1. Group nodes by community if they have one (supports both community_id and community)
  const byComm = new Map<number, string[]>();
  nodes.forEach((n) => {
    const commId = n.community_id !== undefined ? n.community_id : (n as { community?: number }).community;
    if (commId !== undefined) {
      const arr = byComm.get(commId) ?? [];
      arr.push(n.id);
      byComm.set(commId, arr);
    }
  });

  const comms = [...byComm.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, ids]) => [id, [...ids].sort()] as [number, string[]]);
  const K = comms.length;

  if (K > 0) {
    const RING = Math.max(300, Math.min(K * 40, 1200));
    const SPREAD = 80;

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
  }

  // 2. Build adjacency list for connected nodes to compute positions of unpositioned nodes
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  });

  // 3. For nodes without a community, position them based on their neighbors' positions
  const unpositionedNodes = nodes.filter((n) => {
    const commId = n.community_id !== undefined ? n.community_id : (n as { community?: number }).community;
    return commId === undefined;
  });

  for (let pass = 0; pass < 3; pass++) {
    let placedAny = false;
    unpositionedNodes.forEach((n) => {
      if (positions.has(n.id)) return;

      const neighbors = adj.get(n.id) ?? [];
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      neighbors.forEach((neighId) => {
        const pos = positions.get(neighId);
        if (pos) {
          sumX += pos.x;
          sumY += pos.y;
          count++;
        }
      });

      if (count > 0) {
        // Add a small jitter to avoid exact overlapping
        const jitterX = (stableUnit(`${n.id}:x`) - 0.5) * 30;
        const jitterY = (stableUnit(`${n.id}:y`) - 0.5) * 30;
        positions.set(n.id, {
          x: sumX / count + jitterX,
          y: sumY / count + jitterY,
        });
        placedAny = true;
      }
    });
    if (!placedAny) break;
  }

  // 4. Any remaining nodes (completely disconnected or no positioned neighbors) get a default position on a circle
  let unplacedCount = 0;
  unpositionedNodes.forEach((n) => {
    if (!positions.has(n.id)) {
      unplacedCount++;
    }
  });

  let unplacedIdx = 0;
  unpositionedNodes.forEach((n) => {
    if (!positions.has(n.id)) {
      const angle = (unplacedIdx / Math.max(unplacedCount, 1)) * 2 * Math.PI;
      const r = 200 + stableUnit(`${n.id}:radius`) * 100;
      positions.set(n.id, {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
      });
      unplacedIdx++;
    }
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
        gravitationalConstant: isLarge ? -80 : -150, // 大幅增加互斥力，把節點推開
        centralGravity: 0.003, // 極大降低向心力，避免擠在中心
        springLength: isLarge ? 150 : 250, // 把線拉長
        springConstant: 0.04,
        damping: 0.5,
        avoidOverlap: 1, 
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
  analysis?: GraphAnalysis;
  onNodeSelect?: (node: GraphNode | null) => void;
  yearRange?: [number, number];
  edgeWeight?: EdgeWeightMetric;
  visibleLayers?: Set<NodeType>;
  hiddenCommunities?: Set<number>;
  focusNodeId?: string;
  onEdgeSelect?: (edge: GraphEdge | null) => void;
}

export default function GraphViewer({
  nodes,
  edges,
  analysis,
  onNodeSelect,
  yearRange,
  edgeWeight = 'jaccard',
  visibleLayers,
  hiddenCommunities,
  focusNodeId,
  onEdgeSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodeDataSetRef = useRef<NodeDataSet | null>(null);
  const edgeDataSetRef = useRef<EdgeDataSet | null>(null);
  const viewportRef = useRef<GraphViewport | null>(null);
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

      const initPos = buildInitialPositions(nodes, edges);
      const godNodeMap = new Map((analysis?.god_nodes ?? []).map((g) => [g.id, g]));
      const surprisingEdgeMap = new Map(
        (analysis?.surprising_connections ?? []).map((c) => [c.edge_id, c]),
      );
      const nodeDataSet = new DataSet(
        nodes.map((n) => toVisNode(n, initPos.get(n.id), godNodeMap.get(n.id))),
      );
      const edgeDataSet = new DataSet(
        edges.map((e) => toVisEdge(e, surprisingEdgeMap.get(e.id), edgeWeight)),
      );
      nodeDataSetRef.current = nodeDataSet as unknown as NodeDataSet;
      edgeDataSetRef.current = edgeDataSet as unknown as EdgeDataSet;

      if (networkRef.current) {
        const viewport = {
          position: networkRef.current.getViewPosition(),
          scale: networkRef.current.getScale(),
        };
        viewportRef.current = isValidGraphViewport(viewport) ? viewport : null;
        networkRef.current.destroy();
        networkRef.current = null;
      }

      const network = new Network(
        containerRef.current,
        { nodes: nodeDataSet, edges: edgeDataSet },
        buildOptions(nodes.length),
      );
      networkRef.current = network;

      if (isValidGraphViewport(viewportRef.current)) {
        network.moveTo({
          position: viewportRef.current.position,
          scale: viewportRef.current.scale,
          animation: false,
        });
      }

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

      // ── Highlight: Neighbourhood Highlight (1st & 2nd degree) ───────────
      let highlightActive = false;
      const DIM_EDGE: EdgeColorProp = { inherit: "from", opacity: 0.05 };
      const DIM_NODE_COLOR = "rgba(200,200,200,0.3)";

      const applyHighlight = (clickedId: string) => {
        const degree1 = new Set<string>([clickedId]);
        const degree2 = new Set<string>();
        const activeEdges = new Set<string>();

        // Find 1st degree connections
        edges.forEach((e) => {
          if (e.from === clickedId) {
            degree1.add(e.to);
            activeEdges.add(e.id);
          } else if (e.to === clickedId) {
            degree1.add(e.from);
            activeEdges.add(e.id);
          }
        });

        // Find 2nd degree connections
        edges.forEach((e) => {
          if (degree1.has(e.from) && !degree1.has(e.to)) {
            degree2.add(e.to);
            activeEdges.add(e.id);
          } else if (degree1.has(e.to) && !degree1.has(e.from)) {
            degree2.add(e.from);
            activeEdges.add(e.id);
          }
        });

        nodeDataSet.update(
          nodes.map((n) => {
            const original = toVisNode(n);
            if (degree1.has(n.id)) {
              // 1st degree & selected: Original color, Original label, Fully opaque
              return {
                id: n.id,
                color: original.color,
                label: original.label,
                opacity: 1,
              };
            } else if (degree2.has(n.id)) {
              // 2nd degree: Original color, Original label, Slightly dimmed
              return {
                id: n.id,
                color: original.color,
                label: original.label,
                opacity: 0.5,
              };
            } else {
              // Non-connected: Grey out, highly dimmed, hide label (unless it's an applicant)
              // We hide concept and patent labels to reduce clutter. Applicant labels are usually kept but we can hide them too if we want a clean view.
              return {
                id: n.id,
                color: { background: DIM_NODE_COLOR, border: DIM_NODE_COLOR },
                label: "",
                opacity: 0.2,
              };
            }
          }),
        );

        edgeDataSet.update(
          edges.map((e) => ({
            id: e.id,
            color: activeEdges.has(e.id) ? toVisEdge(e, undefined, edgeWeight).color : DIM_EDGE,
          })),
        );
        highlightActive = true;
      };

      const clearHighlight = () => {
        if (!highlightActive) return;
        nodeDataSet.update(
          nodes.map((n) => {
            const original = toVisNode(n);
            return {
              id: n.id,
              color: original.color,
              label: original.label,
              opacity: 1,
            };
          }),
        );
        edgeDataSet.update(
          edges.map((e) => ({ id: e.id, color: toVisEdge(e, undefined, edgeWeight).color })),
        );
        highlightActive = false;
      };

      network.on("click", (params) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0] as string;
          onNodeSelect?.(nodes.find((n) => n.id === nodeId) ?? null);
          onEdgeSelect?.(null);
          applyHighlight(nodeId);
        } else if (params.edges.length > 0) {
          const edgeId = params.edges[0] as string;
          onNodeSelect?.(null);
          onEdgeSelect?.(edges.find((edge) => edge.id === edgeId) ?? null);
          clearHighlight();
        } else {
          onNodeSelect?.(null);
          onEdgeSelect?.(null);
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
        const viewport = {
          position: networkRef.current.getViewPosition(),
          scale: networkRef.current.getScale(),
        };
        viewportRef.current = isValidGraphViewport(viewport) ? viewport : null;
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, edgeWeight]);

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
        className="absolute top-3 right-3 z-10 px-2.5 py-1.5 text-xs rounded border border-border bg-background/90 text-muted-foreground hover:primary-foreground hover:border-accent transition-colors duration-150 cursor-pointer backdrop-blur-sm"
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
                className="h-full bg-accent rounded-full transition-all duration-150"
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
