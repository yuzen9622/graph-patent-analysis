/**
 * A/B 比較的離線 HTML 匯出：把差異（聯集）圖、成員歸屬、指標與凍結座標
 * 一起內嵌成一份可離線互動的檔案。vis-network 原始碼同樣內嵌，沒有任何外部相依。
 *
 * 所有由資料帶入的字串都經過跳脫：顯示在 HTML 的走 escapeHtml，
 * 進到 inline script 的走 safeSerializeForInlineScript，圖上的標籤由
 * vis-network 畫在 canvas 上，不會被當成標記解析。
 */
import { escapeHtml, safeSerializeForInlineScript } from "./export-html";
import {
	compareAnnotationLines,
	compareLegendItems,
	COMPARE_TITLE,
	type CompareAnnotationInput,
} from "./compare-export";
import { DIFF_LABELS, type DifferenceView } from "./graph-compare";
import type { FrozenPositions } from "./export-positions";
import { nodeTooltipLines } from "./node-tooltip";
import type { Unit } from "./graph-view";

export interface CompareExportInput extends CompareAnnotationInput {
	jobId: string;
	difference: DifferenceView;
	positions: FrozenPositions;
	showCitations: boolean;
}

export function buildCompareExportHtml(
	input: CompareExportInput,
	visNetworkSource: string,
): string {
	const unit: Unit = input.unit;
	const view = input.difference.view;
	const payload = safeSerializeForInlineScript({
		nodes: view.nodes.map((node) => ({
			id: node.id,
			label: node.type === "patent" ? "" : node.label,
			type: node.type,
			applicant: node.applicant,
			size: node.size,
			color: node.color,
			shape: node.shape ?? "dot",
			tip: nodeTooltipLines(node, unit),
		})),
		edges: view.edges.map((edge) => ({
			id: edge.id,
			from: edge.from,
			to: edge.to,
			kind: edge.kind,
			relation: edge.relation,
			color: edge.color,
			dashes: edge.dashes ?? false,
			temporal_directed: edge.temporal_directed ?? false,
			opacity: edge.opacity ?? 1,
			support_count: edge.support_count,
			support_applicants: edge.support_applicants,
			jaccard: edge.jaccard,
			jaccard_applicants: edge.jaccard_applicants,
			npmi: edge.npmi,
			npmi_applicants: edge.npmi_applicants,
		})),
		citationEdges: input.showCitations
			? view.citationEdges.map((edge) => ({
					id: edge.id,
					from: edge.from,
					to: edge.to,
					direction_conflict: edge.direction_conflict,
				}))
			: [],
		nodeMembership: input.difference.nodeMembership,
		edgeMembership: input.difference.edgeMembership,
		positions: input.positions,
		membershipLabels: DIFF_LABELS,
		unit,
		edgeWeight: input.edgeWeight,
	});

	const annotation = compareAnnotationLines(input);
	const legend = compareLegendItems();
	const visNetworkDataUrl = `data:text/javascript;base64,${Buffer.from(visNetworkSource).toString("base64")}`;
	const escapedJobId = escapeHtml(input.jobId);

	return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(COMPARE_TITLE)} · ${escapedJobId}</title>
  <script src="${visNetworkDataUrl}"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: #fff; color: #172033; font-family: system-ui, sans-serif; }
    header { padding: 12px 18px; border-bottom: 1px solid #cbd5e1; }
    h1 { margin: 0 0 4px; font-size: 18px; }
    .meta { color: #64748b; font-size: 12px; }
    #summary { padding: 10px 18px; border-bottom: 1px solid #e2e8f0; font-size: 12px; line-height: 1.6; }
    #summary p { margin: 2px 0; }
    #graph { flex: 1; min-height: 0; }
    #legend { position: fixed; left: 16px; bottom: 36px; z-index: 5; width: min(360px, calc(100vw - 32px)); padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: rgba(255,255,255,.95); font-size: 12px; line-height: 1.55; }
    #legend strong { display: block; margin-bottom: 6px; }
    #legend label { display: flex; align-items: center; gap: 8px; min-height: 32px; cursor: pointer; }
    #legend input { width: 16px; height: 16px; }
    .swatch { width: 14px; height: 14px; border-radius: 3px; flex: none; }
    .encoding { color: #64748b; }
    #tooltip { position: fixed; display: none; z-index: 10; max-width: 360px; padding: 9px 11px; border-radius: 6px; background: #172033; color: #fff; font-size: 12px; line-height: 1.5; pointer-events: none; white-space: pre-wrap; }
    footer { padding: 7px 18px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 11px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(COMPARE_TITLE)}</h1>
    <span class="meta">Job ${escapedJobId}</span>
  </header>
  <section id="summary" aria-label="比較摘要">
${annotation.map((line) => `    <p>${escapeHtml(line)}</p>`).join("\n")}
  </section>
  <div id="graph"></div>
  <aside id="legend" aria-label="差異圖例與顯示切換">
    <strong>差異圖例（可切換顯示）</strong>
${legend
	.map(
		(item) => `    <label>
      <input type="checkbox" data-membership="${escapeHtml(item.membership)}" checked />
      <span class="swatch" style="background:${escapeHtml(item.color)}" aria-hidden="true"></span>
      <span>${escapeHtml(item.label)}<span class="encoding"> · ${escapeHtml(item.encoding)}</span></span>
    </label>`,
	)
	.join("\n")}
    <p id="visibility-status" role="status"></p>
  </aside>
  <div id="tooltip" role="status"></div>
  <footer>座標為匯出當下的凍結佈局，僅供排版，不代表定量距離。</footer>
  <script id="compare-data" type="application/json">${payload}</script>
  <script>
    (function () {
      'use strict';
      var payload = JSON.parse(document.getElementById('compare-data').textContent || '{}');
      var container = document.getElementById('graph');
      var tooltip = document.getElementById('tooltip');
      var status = document.getElementById('visibility-status');
      var positions = payload.positions || {};
      var hidden = Object.create(null);

      var visNodes = payload.nodes.map(function (node) {
        var position = positions[node.id] || { x: 0, y: 0 };
        return {
          id: node.id,
          x: position.x,
          y: position.y,
          fixed: { x: true, y: true },
          label: node.label,
          shape: node.shape,
          size: node.size,
          color: node.color,
          font: { size: node.type === 'applicant' ? 14 : 11, color: '#172033' }
        };
      });
      function edgeWidth(edge) {
        if (edge.kind !== 'cooccurrence') return edge.kind === 'semantic' ? 1.5 : 1;
        if (payload.edgeWeight === 'npmi') {
          var npmi = payload.unit === 'applicant' ? edge.npmi_applicants : edge.npmi;
          return Math.min(8, 1 + Math.max(0, Number(npmi || 0)) * 7);
        }
        var jaccard = payload.unit === 'applicant' ? edge.jaccard_applicants : edge.jaccard;
        return Math.min(8, 1 + Math.max(0, Number(jaccard || 0)) * 7);
      }

      var visEdges = payload.edges.map(function (edge) {
        return {
          id: edge.id,
          from: edge.from,
          to: edge.to,
          label: edge.kind === 'semantic' ? edge.relation : '',
          width: edgeWidth(edge),
          dashes: edge.dashes,
          arrows: {
            to: {
              enabled: edge.kind === 'semantic' || edge.temporal_directed || edge.kind === 'structural',
              scaleFactor: .4
            }
          },
          color: { color: edge.color, opacity: edge.opacity },
          physics: false
        };
      }).concat(payload.citationEdges.map(function (edge) {
        return {
          id: 'citation:' + edge.id,
          from: edge.from,
          to: edge.to,
          width: 1.5,
          dashes: [4, 5],
          physics: false,
          arrows: { to: { enabled: true, scaleFactor: .35 } },
          color: { color: edge.direction_conflict ? '#dc2626' : '#2563eb' }
        };
      }));

      var nodeSet = new vis.DataSet(visNodes);
      var edgeSet = new vis.DataSet(visEdges);
      var nodesById = new Map(payload.nodes.map(function (node) { return [node.id, node]; }));
      var edgesById = new Map(payload.edges.map(function (edge) { return [edge.id, edge]; }));
      var network = new vis.Network(container, { nodes: nodeSet, edges: edgeSet }, {
        layout: { improvedLayout: false },
        physics: { enabled: false },
        interaction: { hover: true, tooltipDelay: 150, hideEdgesOnDrag: true }
      });
      network.fit({ animation: false });

      function applyVisibility() {
        var hiddenNodes = Object.create(null);
        var visibleCount = 0;
        nodeSet.update(payload.nodes.map(function (node) {
          var isHidden = Boolean(hidden[payload.nodeMembership[node.id]]);
          if (isHidden) hiddenNodes[node.id] = true; else visibleCount += 1;
          return { id: node.id, hidden: isHidden };
        }));
        edgeSet.update(payload.edges.map(function (edge) {
          var isHidden = Boolean(hidden[payload.edgeMembership[edge.id]])
            || Boolean(hiddenNodes[edge.from]) || Boolean(hiddenNodes[edge.to]);
          return { id: edge.id, hidden: isHidden };
        }));
        edgeSet.update(payload.citationEdges.map(function (edge) {
          return {
            id: 'citation:' + edge.id,
            hidden: Boolean(hiddenNodes[edge.from]) || Boolean(hiddenNodes[edge.to])
          };
        }));
        status.textContent = '顯示中的節點：' + visibleCount + ' / ' + payload.nodes.length;
      }

      Array.prototype.forEach.call(
        document.querySelectorAll('#legend input[data-membership]'),
        function (input) {
          input.addEventListener('change', function () {
            hidden[input.getAttribute('data-membership')] = !input.checked;
            applyVisibility();
          });
        }
      );

      function showText(lines) {
        tooltip.textContent = lines.filter(Boolean).join('\\n');
        tooltip.style.display = 'block';
      }
      function fmt(v) { return (v === undefined || v === null) ? '—' : Number(v).toFixed(3); }
      network.on('hoverNode', function (params) {
        var node = nodesById.get(params.node);
        if (!node) return;
        var lines = (node.tip && node.tip.length) ? node.tip.slice() : [node.label];
        lines.push('歸屬：' + payload.membershipLabels[payload.nodeMembership[node.id]]);
        showText(lines);
      });
      network.on('hoverEdge', function (params) {
        var edge = edgesById.get(params.edge);
        if (!edge) return;
        var lines = [edge.relation];
        if (edge.kind === 'cooccurrence') {
          lines.push('共同出現（篇）：' + (edge.support_count || 0) + ' 篇 ｜（家）：' + (edge.support_applicants || 0) + ' 家');
          lines.push('Jaccard：篇 ' + fmt(edge.jaccard) + ' ｜ 家 ' + fmt(edge.jaccard_applicants));
        }
        lines.push('歸屬：' + payload.membershipLabels[payload.edgeMembership[edge.id]]);
        showText(lines);
      });
      network.on('blurNode', function () { tooltip.style.display = 'none'; });
      network.on('blurEdge', function () { tooltip.style.display = 'none'; });
      document.addEventListener('mousemove', function (event) {
        tooltip.style.left = (event.clientX + 12) + 'px';
        tooltip.style.top = (event.clientY + 12) + 'px';
      });
      applyVisibility();
    })();
  </script>
</body>
</html>`;
}
