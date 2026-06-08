import { NextRequest, NextResponse } from 'next/server'
import { getJob, loadGraphData } from '@/lib/store'

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

      function buildInitialPositions(nodes, edges) {
        var positions = {};
        
        // 1. Group nodes by community
        var byComm = {};
        nodes.forEach(function (n) {
          var commId = n.community_id !== undefined ? n.community_id : n.community;
          if (commId !== undefined) {
            if (!byComm[commId]) byComm[commId] = [];
            byComm[commId].push(n.id);
          }
        });

        var comms = [];
        for (var k in byComm) {
          if (byComm.hasOwnProperty(k)) {
            comms.push({ id: Number(k), ids: byComm[k] });
          }
        }
        var K = comms.length;

        if (K > 0) {
          var RING = Math.max(300, Math.min(K * 40, 1200));
          var SPREAD = 80;

          comms.forEach(function (comm, ci) {
            var ca = (ci / K) * 2 * Math.PI;
            var cx = Math.cos(ca) * RING;
            var cy = Math.sin(ca) * RING;
            var ids = comm.ids;
            ids.forEach(function (id, ni) {
              var na = (ni / Math.max(ids.length, 1)) * 2 * Math.PI;
              var r = SPREAD * (0.35 + (ni % 3) * 0.32);
              positions[id] = {
                x: cx + Math.cos(na) * r,
                y: cy + Math.sin(na) * r
              };
            });
          });
        }

        // 2. Build adjacency list
        var adj = {};
        edges.forEach(function (e) {
          if (!adj[e.from]) adj[e.from] = [];
          if (!adj[e.to]) adj[e.to] = [];
          adj[e.from].push(e.to);
          adj[e.to].push(e.from);
        });

        // 3. Position nodes without a community based on neighbors
        var unpositionedNodes = nodes.filter(function (n) {
          var commId = n.community_id !== undefined ? n.community_id : n.community;
          return commId === undefined;
        });

        for (var pass = 0; pass < 3; pass++) {
          var placedAny = false;
          unpositionedNodes.forEach(function (n) {
            if (positions[n.id]) return;

            var neighbors = adj[n.id] || [];
            var sumX = 0;
            var sumY = 0;
            var count = 0;

            neighbors.forEach(function (neighId) {
              var pos = positions[neighId];
              if (pos) {
                sumX += pos.x;
                sumY += pos.y;
                count++;
              }
            });

            if (count > 0) {
              var jitterX = (Math.random() - 0.5) * 30;
              var jitterY = (Math.random() - 0.5) * 30;
              positions[n.id] = {
                x: sumX / count + jitterX,
                y: sumY / count + jitterY
              };
              placedAny = true;
            }
          });
          if (!placedAny) break;
        }

        // 4. Position remaining disconnected nodes
        var unplacedCount = 0;
        unpositionedNodes.forEach(function (n) {
          if (!positions[n.id]) unplacedCount++;
        });

        var unplacedIdx = 0;
        unpositionedNodes.forEach(function (n) {
          if (!positions[n.id]) {
            var angle = (unplacedIdx / Math.max(unplacedCount, 1)) * 2 * Math.PI;
            var r = 200 + Math.random() * 100;
            positions[n.id] = {
              x: Math.cos(angle) * r,
              y: Math.sin(angle) * r
            };
            unplacedIdx++;
          }
        });

        return positions;
      }

      var initPos = buildInitialPositions(GRAPH_DATA.nodes, GRAPH_DATA.edges);

      var nodes = GRAPH_DATA.nodes.map(function (n) {
        var isApplicant = n.type === 'applicant';
        var isPatent = n.type === 'patent';
        
        // Handle color being a string or an object
        var bgColor = '#BAB0AC';
        var borderColor = '#BAB0AC';
        var highlightBg = '#6B9CC3';
        var highlightBorder = '#6B9CC3';

        if (typeof n.color === 'string') {
          bgColor = n.color;
          borderColor = n.color;
        } else if (n.color && typeof n.color === 'object') {
          bgColor = n.color.background || bgColor;
          borderColor = n.color.border || borderColor;
          if (n.color.highlight) {
            highlightBg = n.color.highlight.background || highlightBg;
            highlightBorder = n.color.highlight.border || highlightBorder;
          } else {
            highlightBg = bgColor;
            highlightBorder = borderColor;
          }
        }

        var nodeFont = (n.font && typeof n.font === 'object') ? n.font : {};
        var fontSize = nodeFont.size !== undefined ? nodeFont.size : 12;
        var fontColor = nodeFont.color !== undefined ? nodeFont.color : '#F8FAFC';

        var shape = n.shape || (isApplicant ? 'star' : 'dot');
        var pos = initPos[n.id] || {};

        return {
          id: n.id,
          label: n.label,
          shape: shape,
          size: n.size,
          x: pos.x,
          y: pos.y,
          color: {
            background: bgColor,
            border: borderColor,
            highlight: { background: highlightBg, border: highlightBorder },
            hover: { background: highlightBg, border: highlightBorder },
          },
          font: {
            color: fontColor,
            size: fontSize,
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
