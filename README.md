<div align="center">
  <h1>graph-patent-analysis</h1>

  [![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/) [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

  **Ever spent days manually mapping out patent competition? Do it in seconds.**

  **🔬 Transform raw patent Excel data into interactive, three-layer competitive knowledge graphs instantly 🚀**

</div>

---

**The Pain:** Analyzing financial patent data from raw Excel sheets manually is incredibly slow, making it difficult to visualize the competitive landscape and identify technological trends over time. Existing desktop tools lack interactivity and make sharing findings impossible.

**The Solution:** A modern, Next.js-powered web platform that ingests `.xlsx` patent data, leverages state-of-the-art LLMs to extract technical concepts, and automatically builds an interactive three-layer knowledge graph (Applicant → Patent → Concept).

**The Result:** Move from raw data to strategic insights in seconds. Instantly identify industry trends, discover key technological communities, and share fully interactive visualizations via a simple URL.

<div align="center">

| Metric | Value |
|--------|-------|
| ⚡ Speed | 20x faster analysis with batch + parallel processing |
| 🧠 LLMs | Support for OpenAI, Gemini, and NVIDIA NIM |
| 🕸️ Graph | 1000+ nodes rendered at 60fps with vis-network |

</div>

## ✨ Key Features

- **🤖 Automated Concept Extraction**: Use your preferred LLM (`gpt-4o`, `gemini-3-flash-preview`, or `meta/llama-3.1-70b-instruct`) to automatically extract technical concepts and relationships from patent abstracts.
- **📊 Three-Layer Architecture**: Move beyond simple concept graphs. Visualize "Who applied for what" with distinct nodes for Applicants, Patents, and Technical Concepts.
- **🔍 Advanced Community Detection**: Automatically group technical concepts into clusters using the Louvain algorithm (`graphology`), revealing distinct technology sectors.
- **📈 AI-Powered Trend Reports**: The system automatically generates strategic insights, technology flow analysis, and future research suggestions based on the graph structure.
- **🎯 Interactive Exploration**: Filter by year, toggle layers, search for specific nodes, and click on communities to isolate the data you care about.
- **📤 Seamless Sharing**: Share your findings via a local server link or export a fully self-contained HTML snapshot of the interactive graph for offline viewing.

## 🚀 Quick Start

Get your local environment up and running in under 2 minutes.

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/graph-patent-analysis.git
cd graph-patent-analysis

# Install dependencies (pnpm recommended)
pnpm install
```

### 2. Configuration

Create a local environment file to store your API keys (these remain safely on your machine):

```bash
cp .env.local.example .env.local
```

Add your preferred LLM API keys to `.env.local`:
```env
OPENAI_API_KEY=your_openai_key_here
GEMINI_API_KEY=your_gemini_key_here
NVIDIA_API_KEY=your_nvidia_key_here
```
*(Note: You only need the key for the model you intend to use. Keys can also be entered directly in the web UI).*

### 3. Run the Platform

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Upload your `.xlsx` patent data and start analyzing!

## 📦 Data Export & Integration

Beyond the interactive web view, the platform provides rich data export options for further academic or business research:

- **Standalone HTML**: Export a self-contained `.html` file containing your interactive graph to share with colleagues offline.
- **Excel/CSV Export**: Download node frequencies, edge relationships, and community mappings for use in statistical software or other graph tools like Gephi.

## 🛠️ Architecture

- **Frontend**: Next.js 16 (App Router), Tailwind CSS, shadcn/ui
- **Graph Engine**: `vis-network`, `graphology`, `graphology-communities-louvain`
- **AI Integration**: Vercel AI SDK with parallel batch processing (`p-limit`)
- **State Management**: In-memory job state and local JSON persistence for shareable URLs

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
