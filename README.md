<div align="center">
  <h1>graph-patent-analysis</h1>

  [![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=next.js)](https://nextjs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/) [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

  **Ever spent days manually mapping out patent competition? Do it in seconds.**

  **🔬 Transform raw patent Excel data into interactive, three-layer competitive knowledge graphs instantly 🚀**

  [Documentation](docs/知識圖譜分析結果解讀與概念抽取方法.md) · [Deployment Guide](docs/DEPLOY.md) · [Backup & Restore](docs/backup-and-restore.md)
</div>

---

**The Pain:** Analyzing financial patent data from raw Excel sheets manually is incredibly slow, making it difficult to visualize the competitive landscape, track technological trends over time, and identify market opportunities. Existing desktop tools lack interactivity and make sharing findings nearly impossible.

**The Solution:** A modern, Next.js-powered web platform that ingests `.xlsx` patent data, leverages state-of-the-art Gemini LLMs to extract technical concepts, and automatically builds interactive multi-layer knowledge graphs (Applicant → Patent → Concept).

**The Result:** Move from raw data to strategic insights in seconds. Instantly identify industry trends, discover key technological communities, compare competitors side-by-side, and share fully interactive visualizations via simple URLs or self-contained HTML files.

<div align="center">

| Metric | Value |
|--------|-------|
| ⚡ Speed | 20x faster analysis with parallel LLM batch processing |
| 🧠 LLM Engine | Powered by Google Gemini (`gemini-2.5-flash` / `gemini-3-flash`) with parallel batching |
| 🕸️ Performance | 1000+ nodes rendered at 60fps with vis-network & graphology |
| 📊 Research Views | 3 Interactive views (Concept Network, Patent Context Graph, Multi-Panel Comparison) |

</div>

## ✨ Key Features

- **🤖 Automated Concept Extraction**: Use Google Gemini with parallel batch processing (`p-limit`) to automatically extract technical concepts and relationships from patent abstracts.
- **📊 Three Research Views**:
  - **Technical Concept Network**: Empirical co-occurrence analysis and Louvain community grouping.
  - **Patent Context Graph**: Full three-layer context (Applicant → Patent → Concept) to trace every concept back to its source patents.
  - **Multi-Panel Comparison**: Side-by-side comparative analysis of different patent portfolios or source files with shared vs. unique concept highlighting.
- **🔍 Reproducible Community Detection**: Group concepts using the Louvain algorithm with unique-patent co-occurrence support as edge weight. LLM semantic relations serve as an optional dashed overlay.
- **⏳ Temporal & IPC Dynamics**: Track technology evolution using applicant median year statistics, custom application year filters, and 5-level IPC (International Patent Classification) hierarchical multi-selection filtering.
- **📈 AI-Powered Trend Reports**: Automatically generate strategic insights, technology flow analysis, and future research recommendations based on topological graph structure.
- **🎯 Explainable Exploration**: Inspect support counts, Jaccard similarity, source patents, methodology metadata, fixed legends, and paper-friendly display modes.
- **📤 Seamless Sharing & Export**: Share findings via local server links, export data to Excel/CSV for Gephi, or generate fully self-contained HTML snapshots for offline interactive viewing.

## 🚀 Quick Start

Get your local environment up and running in under 2 minutes.

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/yuzen9622/graph-patent-analysis.git
cd graph-patent-analysis

# Install dependencies (pnpm recommended)
pnpm install
```

### 2. Configuration

Create a local environment file based on `.env.local.example`:

```bash
cp .env.local.example .env.local
```

Configure your environment variables in `.env.local`:

```env
# ── LLM API Key (Server-side) ───────────────────────────────────
GEMINI_API_KEY=your_gemini_api_key_here     # Required for concept extraction

# ── Authentication & Security ───────────────────────────────────
AUTH_SECRET=your_random_32_byte_secret_here  # Secret for signing session cookies
# Generate user accounts using: node scripts/make-account.mjs <username>

# ── Database & Web Config ───────────────────────────────────────
DATABASE_URL=postgres://patent:password@127.0.0.1:5432/patent_graph
NEXT_PUBLIC_BASE_URL=http://localhost:3000
USE_LLM_MOCK=false                          # Set to true for mock mode testing without calling LLM APIs
```
*(Note: `GEMINI_API_KEY` is read securely from the server environment — there is no key input in the web client UI.)*

### 3. Run the Platform

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Upload your `.xlsx` patent data and start analyzing!

### 🐳 Docker & Cloudflare Tunnel Deployment

For self-hosted container deployment behind Cloudflare Tunnel, see [docs/DEPLOY.md](docs/DEPLOY.md):

```bash
cp .env.docker.example .env   # set GEMINI_API_KEY + CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d --build
```

### 💾 Backup & Restore

To back up or restore persistent job data and graph states, see [docs/backup-and-restore.md](docs/backup-and-restore.md).

## 📦 Data Export & Integration

Beyond the interactive web view, the platform provides rich data export options for academic research and business intelligence:

- **Standalone HTML Snapshot**: Export research views with current filters as a self-contained `.html` file. Graph data and visualization libraries are embedded for complete offline interactivity.
- **Excel/CSV Export**: Download node frequencies, edge relationships, community mappings, and Jaccard similarity scores for statistical analysis or third-party graph tools like Gephi.

## 🛠️ Architecture & Tech Stack

- **Frontend Framework**: Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui
- **Graph Visualization & Analytics**: `vis-network`, `graphology`, `graphology-communities-louvain`
- **AI / LLM Integration**: Vercel AI SDK (`@ai-sdk/google`) with parallel batching (`p-limit`)
- **Data & State Management**: PostgreSQL / In-memory job state and local JSON persistence for shareable snapshot URLs

## 📐 Graph Interpretation & Methodology

- **Concept Node Sizing**: Concept node radius is calculated as `clamp(10 + 6 × √frequency, 10, 52)`, where `frequency` is the number of distinct patents containing the concept.
- **Applicant Node Sizing**: Applicant node radius is calculated as `clamp(18 + 5 × √patent_count, 18, 52)`; patent nodes are fixed at radius 18.
- **Edge Weight & Support**: In the concept network, solid-line width represents distinct-patent co-occurrence support. Edge inspection reports Jaccard similarity and supporting patent IDs.
- **Semantic Overlays**: Purple dashed lines represent LLM-extracted semantic claims. They do not determine Louvain communities and do not affect the force-directed layout.
- **Layout Interpretation**: Screen coordinates and pixel distances are dynamic force-directed layout artifacts, not quantitative semantic distances or causal metrics.

For detailed formulas, provenance rules, and research wording, see [知識圖譜分析結果解讀與概念抽取方法](docs/知識圖譜分析結果解讀與概念抽取方法.md).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
