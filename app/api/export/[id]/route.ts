import { NextRequest, NextResponse } from 'next/server'
import { getJob, loadGraphData } from '@/lib/store'
import type { GraphNode } from '@/types/graph'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Check job status
  const job = getJob(id)

  if (!job) {
    // Job not in memory — try reading from disk
    const graph = loadGraphData(id)
    if (!graph) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // If file exists the job completed previously; fall through with graph
    return buildHtmlResponse(id, JSON.stringify(graph))
  }

  if (job.status !== 'done') {
    return NextResponse.json(
      { error: 'Analysis not yet complete' },
      { status: 409 },
    )
  }

  const graph = loadGraphData(id)
  if (!graph) {
    return NextResponse.json({ error: 'Graph data not found' }, { status: 404 })
  }

  return buildHtmlResponse(id, JSON.stringify(graph))
}

function buildHtmlResponse(id: string, graphJson: string): NextResponse {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const dateStr = `${yyyy}${mm}${dd}`
  const filename = `patent-graph-${dateStr}.html`

  // Inline the graph data into the HTML so it is completely self-contained.
  // vis-network is loaded from CDN so the file works without a server but
  // requires an internet connection for the first open (acceptable per PRD).
  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>專利知識圖譜 · ${id}</title>
  <script src="https://cdn.jsdelivr.net/npm/vis-network@9/standalone/umd/vis-network.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #020617;
      color: #F8FAFC;
      font-family: 'Atkinson Hyperlegible', 'Segoe UI', sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      padding: 12px 20px;
      background: #0F172A;
      border-bottom: 1px solid #334155;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    header h1 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #F8FAFC;
    }

    header span {
      font-size: 0.8rem;
      color: #94A3B8;
    }

    #graph {
      flex: 1;
      background: #020617;
    }

    #tooltip {
      position: fixed;
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 0.8rem;
      color: #F8FAFC;
      max-width: 280px;
      pointer-events: none;
      display: none;
      z-index: 100;
      line-height: 1.5;
    }

    #stats {
      padding: 8px 20px;
      background: #0F172A;
      border-top: 1px solid #334155;
      font-size: 0.75rem;
      color: #94A3B8;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <header>
    <h1>專利知識圖譜離線快照</h1>
    <span>Job ID: ${id} · 匯出日期: ${yyyy}-${mm}-${dd}</span>
  </header>
  <div id="graph"></div>
  <div id="tooltip"></div>
  <div id="stats"></div>

  <script>
    (function () {
      var GRAPH_DATA = ${graphJson};

      var nodes = GRAPH_DATA.nodes.map(function (n) {
        var shape = n.type === 'applicant' ? 'star' : 'dot';
        return {
          id: n.id,
          label: n.label,
          shape: shape,
          size: n.size,
          color: {
            background: n.color,
            border: n.color,
            highlight: { background: '#6B9CC3', border: '#6B9CC3' },
            hover: { background: '#6B9CC3', border: '#6B9CC3' },
          },
          font: {
            color: '#F8FAFC',
            size: 12,
          },
          // Store original metadata for tooltip
          _type: n.type,
          _applicant: n.applicant,
          _filing_date: n.filing_date,
          _abstract: n.abstract ? n.abstract.slice(0, 200) : undefined,
          _frequency: n.frequency,
          _patent_count: n.patent_count,
        };
      });

      var edges = GRAPH_DATA.edges.map(function (e) {
        return {
          id: e.id,
          from: e.from,
          to: e.to,
          label: e.relation,
          color: { color: '#334155', highlight: '#4E79A7', hover: '#4E79A7' },
          font: { color: '#94A3B8', size: 10, align: 'middle' },
          arrows: { to: { enabled: true, scaleFactor: 0.5 } },
          width: e.weight ? Math.max(1, e.weight * 0.5) : 1,
        };
      });

      var container = document.getElementById('graph');

      var network = new vis.Network(
        container,
        {
          nodes: new vis.DataSet(nodes),
          edges: new vis.DataSet(edges),
        },
        {
          physics: {
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
              gravitationalConstant: -60,
              springLength: 120,
              avoidOverlap: 0.8,
            },
            stabilization: { iterations: 200, fit: true },
          },
          interaction: {
            hover: true,
            tooltipDelay: 100,
            hideEdgesOnDrag: true,
          },
        },
      );

      network.on('stabilizationIterationsDone', function () {
        network.setOptions({ physics: { enabled: false } });
      });

      // Tooltip on hover
      var tooltip = document.getElementById('tooltip');
      var nodeMap = {};
      GRAPH_DATA.nodes.forEach(function (n) { nodeMap[n.id] = n; });

      network.on('hoverNode', function (params) {
        var n = nodeMap[params.node];
        if (!n) return;
        var lines = ['<strong>' + n.label + '</strong>'];
        if (n.type === 'applicant') {
          lines.push('申請人 · ' + (n.patent_count || 0) + ' 件專利');
        } else if (n.type === 'patent') {
          if (n.applicant) lines.push('申請人：' + n.applicant);
          if (n.filing_date) lines.push('申請日：' + n.filing_date);
          if (n.abstract) lines.push(n.abstract.slice(0, 120) + '…');
        } else {
          if (n.frequency) lines.push('出現頻率：' + n.frequency);
        }
        tooltip.innerHTML = lines.join('<br>');
        tooltip.style.display = 'block';
      });

      network.on('blurNode', function () {
        tooltip.style.display = 'none';
      });

      document.addEventListener('mousemove', function (e) {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top  = (e.clientY + 14) + 'px';
      });

      // Stats bar
      var s = GRAPH_DATA.stats;
      document.getElementById('stats').textContent =
        s.applicant_count + ' 申請人 · ' +
        s.patent_count + ' 專利 · ' +
        s.concept_count + ' 技術概念 · ' +
        s.community_count + ' 社群';
    })();
  </script>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
