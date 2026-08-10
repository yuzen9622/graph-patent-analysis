import { selectGraphView, type GraphViewOptions } from './graph-view'
import { DEFAULT_IPC_LEVEL } from './ipc-filter'
import type { FrozenPositions } from './export-positions'
import { nodeTooltipLines } from './node-tooltip'
import type { GraphData, GraphMode } from '../types/graph'

export interface ExportOptions extends GraphViewOptions {
  paper: boolean
}

export function safeSerializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return fallback
}

function parseClampedInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || !/^-?\d+$/.test(value)) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function parseExportOptions(
  params: URLSearchParams,
  graph: GraphData,
): ExportOptions {
  const rawMode = params.get('mode')
  const mode: GraphMode =
    rawMode === 'institution' ? 'institution' : rawMode === 'context' ? 'context' : 'concept'
  const cooccurrence = graph.edges.filter((edge) => edge.kind === 'cooccurrence')
  const colorMode = params.get('colorMode') === 'first_year'
    ? 'first_year'
    : params.get('colorMode') === 'community_applicants'
      ? 'community_applicants'
      : params.get('colorMode') === 'source'
        ? 'source'
        : params.get('colorMode') === 'ipc'
          ? 'ipc'
          : 'community'
  const unit = params.get('unit') === 'applicant' ? 'applicant' : 'patent'
  const supportOf = unit === 'applicant'
    ? (e: { support_applicants?: number }) => e.support_applicants ?? 0
    : (e: { support_count?: number }) => e.support_count ?? 0
  const maxSupport = Math.max(1, ...cooccurrence.map(supportOf))
  const yearStart = parseClampedInteger(
    params.get('yearStart'),
    graph.stats.year_range[0],
    graph.stats.year_range[0],
    graph.stats.year_range[1],
  )
  const yearEnd = parseClampedInteger(
    params.get('yearEnd'),
    graph.stats.year_range[1],
    graph.stats.year_range[0],
    graph.stats.year_range[1],
  )
  let edgeWeight: GraphViewOptions['edgeWeight'] = 'jaccard'
  if (params.get('el') === 'npmi' || params.get('ew') === 'npmi') edgeWeight = 'npmi'
  const sourceFiles = params.getAll('source').filter(Boolean)
  // PRD v2 / P5: IPC 層級（1..5，缺省 3）與選定 key（多值）。
  let ipcLevel: GraphViewOptions['ipcLevel'] = DEFAULT_IPC_LEVEL
  const levelRaw = params.get('ipcLevel')
  const level = Number(levelRaw)
  if (levelRaw !== null && Number.isInteger(level) && level >= 1 && level <= 5) {
    ipcLevel = level as GraphViewOptions['ipcLevel']
  }
  const ipcFilter = params.getAll('ipc').filter(Boolean)
  const temporalReference = params.get('temporal_ref') === 'full' ? 'full' as const : 'active' as const
  const showCitations = parseBoolean(params.get('citations'), false)
  return {
    mode,
    showSemantic: parseBoolean(params.get('llm'), false),
    paper: parseBoolean(params.get('paper'), true),
    minSupport: parseClampedInteger(params.get('minSupport'), 1, 1, maxSupport),
    yearRange: yearStart <= yearEnd ? [yearStart, yearEnd] : [yearEnd, yearStart],
    colorMode,
    unit,
    edgeWeight,
    sourceFiles: sourceFiles.length > 0 ? sourceFiles : undefined,
    ipcLevel,
    ipcFilter: ipcFilter.length > 0 ? ipcFilter : undefined,
    temporalReference,
    showCitations,
  }
}

// Always project citation evidence into the offline payload; its visibility is
// controlled by the same toggle as the online viewer. The POST route uses this
// same projection to validate the live position ID set before exporting.
export function buildExportViews(graph: GraphData, options: ExportOptions) {
  return {
    concept: selectGraphView(graph, { ...options, mode: 'concept', showCitations: true }),
    context: selectGraphView(graph, { ...options, mode: 'context', showCitations: true }),
    institution: selectGraphView(graph, { ...options, mode: 'institution', showCitations: true }),
  }
}

export function buildExportHtml(
  jobId: string,
  graph: GraphData,
  options: ExportOptions,
  visNetworkSource: string,
  frozenPositions?: FrozenPositions,
): string {
  const view = selectGraphView(graph, { ...options, showCitations: true })
  // tooltip 文字在伺服器端就算好，離線端只負責渲染，避免線上與離線兩份文字漂移。
  const viewWithTips = {
    ...view,
    nodes: view.nodes.map((node) => ({ ...node, tip: nodeTooltipLines(node, options.unit) })),
  }
  const payload = safeSerializeForInlineScript({
    view: viewWithTips,
    frozenLayouts: frozenPositions ? { [options.mode]: frozenPositions } : {},
    options,
  })
  const escapedJobId = escapeHtml(jobId)
  const visNetworkDataUrl = `data:text/javascript;base64,${Buffer.from(visNetworkSource).toString('base64')}`
  const title =
    options.mode === 'institution'
      ? '機構網絡'
      : options.mode === 'concept'
        ? '技術概念網路'
        : '專利脈絡圖'
  const modeExplanation =
    options.mode === 'institution'
      ? '節點＝一家機構；大小＝該機構涉足的技術概念數（非專利篇數）；邊＝兩家共享 ≥' +
        `${options.minSupport} 個概念；顏色＝機構類型（銀行/保險/大學/…）。`
      : options.mode === 'concept'
        ? options.colorMode === 'ipc'
          ? `節點顏色＝優勢 IPC（L${options.ipcLevel ?? DEFAULT_IPC_LEVEL}）；${options.unit === 'applicant' ? '大小＝機構家數' : '大小＝專利篇數'}；實線粗細＝支持門檻（≥ ${options.minSupport}）；線寬用${options.edgeWeight === 'npmi' ? 'NPMI' : 'Jaccard'}。`
          : options.unit === 'applicant'
          ? `節點大小＝涵蓋該概念的機構家數（非專利篇數）；實線粗細＝共同投入的機構家數（門檻 ≥ ${options.minSupport} 家）；線寬用 ${options.edgeWeight === 'npmi' ? 'NPMI' : 'Jaccard'}。`
          : `節點大小＝包含該概念的專利篇數；實線粗細＝共同出現篇數（門檻 ${options.minSupport}）；線寬用${options.edgeWeight === 'npmi' ? 'NPMI' : 'Jaccard'}。`
        : '申請人大小＝所選年份專利篇數；概念大小＝所選年份涵蓋篇數；結構線不表示強度。'
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · ${escapedJobId}</title>
  <script src="${visNetworkDataUrl}"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: ${options.paper ? '#fff' : '#020617'}; color: ${options.paper ? '#172033' : '#f8fafc'}; font-family: system-ui, sans-serif; }
    header { padding: 12px 18px; border-bottom: 1px solid #cbd5e1; display: flex; justify-content: space-between; gap: 16px; align-items: center; }
    h1 { margin: 0; font-size: 18px; } .meta { color: #64748b; font-size: 12px; }
    .title-group { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    #graph { flex: 1; min-height: 0; }
    #legend { position: fixed; left: 16px; bottom: 40px; z-index: 5; width: min(390px, calc(100vw - 32px)); padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: rgba(255,255,255,.94); color: #172033; font-size: 12px; line-height: 1.55; }
    #legend strong { display: block; margin-bottom: 4px; } #legend p { margin: 3px 0; }
    .warning { color: #b45309; }
    #tooltip { position: fixed; display: none; z-index: 10; max-width: 360px; padding: 9px 11px; border-radius: 6px; background: #172033; color: #fff; font-size: 12px; line-height: 1.5; pointer-events: none; white-space: pre-wrap; }
    footer { padding: 7px 18px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 11px; }
  </style>
</head>
<body>
  <header>
    <div class="title-group">
      <h1 id="graph-title">${escapeHtml(title)}</h1>
      <button id="citation-toggle" type="button" aria-pressed="${options.showCitations}">引用虛線</button>
    </div>
    <span id="graph-meta" class="meta">Job ${escapedJobId} · ${view.stats.patent_count} 篇專利</span>
  </header>
  <div id="graph"></div>
  <aside id="legend" aria-label="圖譜圖例">
    <strong id="legend-title">${escapeHtml(title)}圖例</strong>
    <p id="mode-explanation">${escapeHtml(modeExplanation)}</p>
    <p id="semantic-explanation">${options.mode === 'concept' ? (options.showSemantic ? '紫色虛線＝LLM 語意關係（不參與社群與排版）。' : 'LLM 語意關係目前未顯示。') : '本模式只顯示申請人、專利與概念的來源結構線。'}</p>
    <p id="capability-warning" class="warning"${view.capabilityWarning ? '' : ' hidden'}>${view.capabilityWarning ? escapeHtml(view.capabilityWarning) : ''}</p>
  </aside>
  <div id="tooltip" role="status"></div>
  <footer>${escapeHtml(graph.methodology.cooccurrence_metric)} · Louvain resolution ${escapeHtml(String(graph.methodology.community_resolution))} · ${escapeHtml(graph.methodology.model_id)}</footer>
  <script id="graph-data" type="application/json">${payload}</script>
  <script>
    (function () {
      'use strict';
      var payload = JSON.parse(document.getElementById('graph-data').textContent || '{}');
      var network = null;
      var tooltip = document.getElementById('tooltip');
      var graph = document.getElementById('graph');
      var activeMode = payload.options.mode;
      var view = payload.view;
      var frozenLayout = payload.frozenLayouts && payload.frozenLayouts[activeMode];
      if (!frozenLayout) {
        graph.textContent = '缺少凍結座標，請回到分析頁使用「離線 HTML」按鈕重新匯出。';
        return;
      }
      var showCitations = Boolean(payload.options.showCitations);
      var unit = payload.options.unit || 'patent';
      var ew = payload.options.edgeWeight || 'jaccard';
      var nodesById = new Map(view.nodes.map(function (node) { return [node.id, node]; }));
      var edgesById = new Map(view.edges.map(function (edge) { return [edge.id, edge]; }));
      function render() {
        var nodes = view.nodes.map(function (node) {
          var position = frozenLayout[node.id];
          return {
            id: node.id,
            x: position.x,
            y: position.y,
            fixed: { x: true, y: true },
            label: node.type === 'patent' ? '' : node.label,
            shape: node.type === 'applicant' ? 'star' : 'dot',
            size: node.size,
            color: node.color,
            font: { size: node.type === 'applicant' ? 14 : 11, color: ${options.paper ? "'#172033'" : "'#f8fafc'"} }
          };
        });
        var relationEdges = view.edges.map(function (edge) {
          var co = edge.kind === 'cooccurrence';
          var semantic = edge.kind === 'semantic';
          return {
            id: edge.id,
            from: edge.from,
            to: edge.to,
            label: semantic ? edge.relation : '',
            width: co ? edgeWidth(edge, ew, unit) : (semantic ? 1.5 : 1),
            dashes: semantic ? [6, 4] : false,
            physics: !semantic,
            arrows: { to: { enabled: semantic || edge.temporal_directed || edge.kind === 'structural', scaleFactor: .4 } },
            color: { color: semantic ? '#8b5cf6' : (edge.kind === 'institution' ? '#0f766e' : (co ? '#64748b' : '#94a3b8')), opacity: edge.opacity == null ? 1 : edge.opacity }
          };
        });
        var citationEdges = showCitations ? (view.citationEdges || []).map(function (edge) {
          return { id: 'citation:' + edge.id, from: edge.from, to: edge.to, dashes: [4, 5], width: 1.5,
            physics: false, arrows: { to: { enabled: true, scaleFactor: .35 } },
            color: { color: edge.direction_conflict ? '#dc2626' : '#2563eb', opacity: 1 } };
        }) : [];
        var edges = relationEdges.concat(citationEdges);
        if (network) network.destroy();
        network = new vis.Network(graph, {
          nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges)
        }, {
          layout: { improvedLayout: false },
          physics: { enabled: false },
          interaction: { hover: true, tooltipDelay: 150, hideEdgesOnDrag: true }
        });
        network.fit({ animation: false });
        function showText(lines) { tooltip.textContent = lines.filter(Boolean).join('\\n'); tooltip.style.display = 'block'; }
        network.on('hoverNode', function (params) {
          var node = nodesById.get(params.node); if (!node) return;
          var lines = (node.tip && node.tip.length) ? node.tip.slice() : [node.label];
          if (node.type === 'patent' && node.applicant) lines.push(node.applicant);
          showText(lines);
        });
        network.on('hoverEdge', function (params) {
          var edge = edgesById.get(params.edge); if (!edge) return;
          var lines = [edge.relation];
          if (edge.kind === 'cooccurrence') {
            lines.push('共同出現（篇）：' + (edge.support_count || 0) + ' 篇 ｜（家）：' + (edge.support_applicants || 0) + ' 家');
            lines.push('Jaccard：篇 ' + fmt(edge.jaccard) + ' ｜ 家 ' + fmt(edge.jaccard_applicants));
            lines.push('NPMI：篇 ' + fmt(edge.npmi) + ' ｜ 家 ' + fmt(edge.npmi_applicants));
          }
          if (edge.kind === 'semantic') { lines.push('目前保存來源：' + ((edge.source_patents || []).length) + ' 篇'); if (edge.reason) lines.push(edge.reason); }
          if (edge.kind === 'institution') { lines.push('共享概念：' + (edge.support_count || 0) + ' 個——' + ((edge.shared_concepts || []).join('、'))); }
          showText(lines);
        });
        network.on('blurNode', function () { tooltip.style.display = 'none'; });
        network.on('blurEdge', function () { tooltip.style.display = 'none'; });
      }
      function edgeWidth(edge, ew, unit) {
        if (ew === 'npmi') {
          var v = Math.max(0, unit === 'applicant' ? (edge.npmi_applicants || 0) : (edge.npmi || 0));
          return Math.min(8, 1 + v * 7);
        }
        var j = unit === 'applicant' ? (edge.jaccard_applicants || 0) : (edge.jaccard || 0);
        return Math.min(8, 1 + j * 7);
      }
      function fmt(v) { return (v === undefined || v === null) ? '—' : Number(v).toFixed(3); }
      var citationToggle = document.getElementById('citation-toggle');
      citationToggle.setAttribute('aria-pressed', String(showCitations));
      citationToggle.addEventListener('click', function () {
        showCitations = !showCitations;
        citationToggle.setAttribute('aria-pressed', String(showCitations));
        render();
      });
      document.addEventListener('mousemove', function (event) { tooltip.style.left = (event.clientX + 12) + 'px'; tooltip.style.top = (event.clientY + 12) + 'px'; });
      render();
    })();
  </script>
</body>
</html>`
}
