# PRD：王老師專利知識圖譜分析平台（Next.js 版）

**版本**：v1.1  
**日期**：2026-06-06  
**狀態**：草稿（已納入架構決策）

---

## 一、背景與目標

### 背景

現有系統（`src/main.py`）是一個 Python tkinter 桌面應用程式，功能包含：讀取 Excel 專利資料、呼叫 LLM 萃取技術概念、產生 pyvis 互動式知識圖譜、輸出 AI 趨勢報告。

核心限制：

- 桌面程式，無法多人同時使用或分享連結
- 圖譜只有概念詞節點，無法呈現「誰申請了什麼」的競爭結構
- 無年份篩選、無申請人分組，難以做學術時序分析
- 樣式過時，缺乏可用性

### 目標

建立一個 Next.js 網頁應用程式，完整遷移現有功能，並加入三層節點設計（申請人 → 專利 → 技術概念），讓老師可以直接用瀏覽器進行金融專利的競爭分析與學術研究。

### 非目標（本版本不做）

- 使用者帳號系統 / 多人協作
- 自動定期爬蟲更新
- 專利引用鏈分析（需要額外資料來源）
- 行動裝置 App

---

## 二、使用者故事

| 編號  | 角色   | 故事                                    | 驗收條件                                                                  |
| ----- | ------ | --------------------------------------- | ------------------------------------------------------------------------- |
| US-01 | 研究者 | 我想上傳 Excel 專利資料，讓系統自動分析 | 上傳後 5 秒內看到進度，分析完成後圖譜自動出現                             |
| US-02 | 研究者 | 我想選擇使用哪個 LLM 模型來萃取概念     | 可在介面上切換 NVIDIA / Gemini / OpenAI                                   |
| US-03 | 研究者 | 我想看哪家金控在哪個技術領域最活躍      | 申請人節點和技術概念節點有顏色區分                                        |
| US-04 | 研究者 | 我想篩選特定年份的專利來看技術演化      | 有年份滑桿或下拉選單，篩選後圖譜即時更新                                  |
| US-05 | 研究者 | 我想點擊節點看到這篇專利的完整資訊      | sidebar 顯示：專利名稱、申請日、申請人、摘要、相鄰節點                    |
| US-06 | 研究者 | 我想隱藏/顯示特定技術社群來聚焦分析     | 點擊 legend 色點可切換顯示/隱藏                                           |
| US-07 | 研究者 | 我想看 AI 產生的技術趨勢報告            | sidebar 下方有 AI 報告面板，可捲動閱讀                                    |
| US-08 | 研究者 | 我想搜尋特定技術關鍵字在圖中的位置      | 搜尋框即時過濾，點擊結果自動 focus 到該節點                               |
| US-09 | 研究者 | 我想把圖譜分享給合作者看                | 分析完成後產生可分享的 URL 連結，任何可存取此伺服器的人可直接開啟互動圖譜 |
| US-10 | 研究者 | 我想中止正在進行的分析                  | 點擊「取消分析」後，LLM 呼叫停止，顯示「已中止，完成 N/M 筆」             |
| US-11 | 研究者 | 第一次使用時我知道該怎麼開始            | 首頁未上傳時顯示引導說明；篩選/搜尋無結果時顯示明確提示訊息               |

---

## 三、功能需求

### 3.1 資料輸入模組

**F-01 Excel 上傳**

- 支援 `.xlsx` 格式，單次可上傳多個檔案
- 自動辨識欄位（支援同義欄位名稱）：

| 欄位     | 識別同義字                                          |
| -------- | --------------------------------------------------- |
| 專利名稱 | `專利名稱(中)`, `title`, `專利名稱`, `name`, `題名` |
| 摘要     | `摘要`, `abstract`, `summary`, `內容`               |
| 申請人   | `申請人`, `applicant`, `assignee`                   |
| 申請日   | `申請日`, `filing_date`, `application_date`         |
| 申請號   | `申請號`, `application_number`                      |

- 若必要欄位缺失，顯示明確錯誤訊息，指出缺少哪個欄位
- 上傳後顯示資料預覽：總筆數、欄位對應結果、可辨識/無法辨識的欄位列表

**F-02 抽樣設定**

- 可設定分析筆數上限（預設 50，最大 2000）
- 若總資料少於設定值，全部分析不抽樣
- 顯示「將分析 N / 總計 M 筆」

**F-03 模型選擇**

- 支援三個 LLM 提供商：

| 提供商        | 模型                          | 需要的 API Key   |
| ------------- | ----------------------------- | ---------------- |
| NVIDIA NIM    | `meta/llama-3.1-70b-instruct` | `NVIDIA_API_KEY` |
| Google Gemini | `gemini-3-flash-preview`      | `GEMINI_API_KEY` |
| OpenAI        | `gpt-4o`                      | `OPENAI_API_KEY` |

- API Key 可在介面上輸入，儲存在 session（不寫入 server）
- 選擇提供商後，自動驗證 API Key 有效性（打一個低成本的測試請求）

---

### 3.2 分析處理模組

**F-04 LLM 概念萃取**

針對每篇專利的摘要，呼叫 LLM 萃取：

```json
{
  "translated_abstract": "繁體中文翻譯",
  "keywords": ["關鍵字1", "關鍵字2"],
  "relations": [
    { "source": "概念A", "target": "概念B", "relation": "應用於", "weight": 1-5 }
  ]
}
```

- 系統提示要求全程使用繁體中文
- 若 LLM 回傳非 JSON，自動 retry 最多 2 次
- 失敗的專利記錄到錯誤日誌，不中斷整體流程

**F-05 三層圖譜建構**

從 Excel 原始資料 + LLM 萃取結果，建立三層節點圖：

```
[申請人] ──申請了──▶ [專利] ──包含──▶ [技術概念]
```

**申請人名稱清理規則**（在 `excel-parser.ts` 解析階段執行，列入 Phase 1 驗收條件）：

1. 以第一個**全形空格**（U+3000）或**半形空格**為截斷點，取前段作為公司名稱
2. 若截斷後仍含括號（如「（臺北）」），再次截斷
3. 多申請人（原始欄位以「；」或「;」分隔）：**各自建立獨立節點**，共同指向同一篇專利
4. 清理後去重（`Map<string, ApplicantNode>`）；同名公司合併為一個節點

> 範例：`國泰金融控股股份有限公司 臺北市...` → `國泰金融控股股份有限公司`

節點屬性：

| 節點類型 | 屬性                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 申請人   | `name`, `patent_count`, `color`（按機構分色）                                 |
| 專利     | `title`, `applicant`, `filing_date`, `year`, `abstract`, `application_number` |
| 技術概念 | `name`, `frequency`（出現在幾篇專利中）, `community_id`                       |

邊屬性：

| 邊類型              | 屬性                                              |
| ------------------- | ------------------------------------------------- |
| 申請人 → 專利       | `relation: "申請了"`                              |
| 專利 → 技術概念     | `relation: "包含"`, `weight`                      |
| 技術概念 → 技術概念 | `relation`（來自 LLM）, `weight`, `source_patent` |

**F-06 社群偵測**

- 對技術概念層執行 Louvain 社群偵測，使用 TypeScript 套件 **`graphology` + `graphology-communities-louvain`**
- 每個社群自動分配顏色
- 社群標籤 = 該社群度數最高的概念節點名稱
- **Phase 1 末需完成 PoC**：建立 50 個測試節點，驗證輸出社群分組正確，作為 Phase 2 開工前置條件

> **演算法說明：** 原 Python 版本使用的 `networkx.greedy_modularity_communities` 實作的是 Clauset-Newman-Moore（CNM）演算法，並非 Louvain。本版本統一採用 `graphology-communities-louvain`（MIT 授權），結果會與原 Python 版略有差異，此為預期行為。

**F-07 AI 趨勢報告**

- 抽取前 15 筆分析結果，呼叫 LLM 產生技術趨勢報告
- 報告結構：技術核心現況 / 技術流向分析 / 未來研究建議
- 以 HTML 格式輸出（`<h4>`, `<ul>`, `<li>`）

**F-08 即時進度**

- 透過 Server-Sent Events (SSE) 推送進度
- 每完成一個批次推送一條進度事件
- 事件格式：`{ done: N, total: M, batch_titles: ["..."] }`
- 前端顯示進度條 + 當前批次的專利名稱列表

**F-15 並行批次處理（加速分析）**

採用「批次 Prompt + 並行請求」雙重加速，**全程 TypeScript 實作**，使用 `p-limit` 控制並行上限，LLM 呼叫使用 Vercel AI SDK（`@ai-sdk/openai`、`@ai-sdk/google`、`@ai-sdk/openai-compatible`）。

**速度對比**（以 200 筆、每次 LLM 約 2.5s 為基準）：

| 模式                    | 說明                   | 估計時間               |
| ----------------------- | ---------------------- | ---------------------- |
| 串行（舊）              | 每次 1 筆 × 200 次     | ~500 秒                |
| 並行（無批次）          | 10 並行 × 20 輪        | ~50 秒                 |
| 批次（無並行）          | 每批 10 筆 × 20 批     | ~70 秒                 |
| **批次 + 並行（預設）** | **每批 5 筆 × 5 並行** | **~25 秒（20x 加速）** |

**實作規格（TypeScript）：**

```ts
import pLimit from "p-limit";

const limit = pLimit(concurrency); // 預設 concurrency = 5

const batches = chunk(patents, batch_size); // 預設 batch_size = 5
const results = await Promise.all(
  batches.map((batch, i) => limit(() => extractBatch(batch, i, cancelToken))),
);
// 結果依原始 batch index 排序後合併到圖譜
```

**批次 Prompt 格式：**

```
[0] 摘要A內容...

[1] 摘要B內容...

[2] 摘要C內容...
```

LLM 回傳 JSON 陣列，每個元素含 `index`、`keywords`、`relations`，長度必須等於輸入筆數。

**可設定參數：**

| 參數          | 預設值                        | 說明             |
| ------------- | ----------------------------- | ---------------- |
| `batch_size`  | 5                             | 每批包含幾篇專利 |
| `concurrency` | 5                             | 同時執行幾個批次 |
| 同時分析筆數  | batch_size × concurrency = 25 |                  |

> **速率限制注意事項：** NVIDIA NIM 免費層 RPM 限制較低，建議 concurrency=3；OpenAI / Gemini 可設 5–10。

**錯誤處理：**

- 單一批次失敗不影響其他批次，失敗的批次回傳空結果並記錄錯誤
- 若回傳 JSON 格式不符，對該批次 fallback 到逐筆串行重試
- 收到取消信號（F-16）時提前結束，不再派送新批次

**F-16 取消分析**

- 前端 `ProgressPanel` 顯示「取消分析」按鈕，分析進行中可用
- 點擊後：
  1. 前端關閉 SSE 連線
  2. 呼叫 `DELETE /api/analyze/[id]`，Server 設定取消旗標
  3. `p-limit` 佇列中尚未執行的批次跳過，進行中的批次完成當輪後停止
  4. 前端顯示「分析已中止，完成 N / M 筆，已取得部分圖譜」
- 部分結果仍可用於渲染圖譜，使用者不需重頭來過

**F-17 空狀態（Empty State）規格**

| 情境                   | 顯示內容                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| 首頁未上傳             | 拖曳區域下方顯示「← 先上傳 .xlsx 檔案，系統將自動辨識欄位」說明文字    |
| Excel 欄位全部無法辨識 | 錯誤面板列出所有原始欄位名稱，建議使用者重新命名後再上傳               |
| 年份篩選無結果         | 圖譜區顯示「此年份範圍內無專利資料」，保留滑桿可調整                   |
| 搜尋無匹配             | 搜尋下拉顯示「找不到「{query}」相關節點」，非匹配節點 opacity 降至 0.2 |
| 社群 Legend 全部隱藏   | 圖譜區顯示「所有社群已隱藏，點擊 Legend 色點以顯示」                   |
| 分析完成但 0 筆成功    | 顯示錯誤摘要，提供「重新分析」按鈕                                     |

---

### 3.3 圖譜視覺化模組

**F-09 圖譜渲染**

使用 vis-network（`npm install vis-network`，**不透過 CDN 引入**），`GraphViewer.tsx` 加上 `'use client'`，以 `next/dynamic` 搭配 `ssr: false` 動態載入避免 SSR 衝突，物理引擎：

```js
{
  solver: 'forceAtlas2Based',
  forceAtlas2Based: {
    gravitationalConstant: -60,
    springLength: 120,
    avoidOverlap: 0.8
  },
  stabilization: { iterations: 200, fit: true }
}
```

穩定化完成後關閉物理引擎（`physics.enabled: false`）。

**F-10 節點視覺規則**

| 節點類型 | 形狀               | 大小               | 顏色                       |
| -------- | ------------------ | ------------------ | -------------------------- |
| 申請人   | `star` 或 `square` | 固定大（40px）     | 每家機構一個固定色         |
| 專利     | `dot`              | 中（18px）         | 繼承申請人顏色，透明度 70% |
| 技術概念 | `dot`              | 8px + 出現頻率 × 3 | 依社群分色                 |

- 節點 label 顯示規則：申請人節點永遠顯示；專利節點 hover 才顯示完整名稱；技術概念節點 degree > 3 才顯示 label
- 節點大小上限：60px，下限：8px

**F-11 側邊欄（Sidebar）**

固定右側 300px，由上到下：

1. **搜尋框**：即時搜尋節點 label，下拉顯示最多 20 筆結果，點擊 focus 並選中
2. **節點資訊面板**：點擊節點後顯示
   - 申請人節點：機構名稱、申請專利數、相關技術社群列表
   - 專利節點：專利名稱、申請號、申請日、申請人、摘要（可展開）
   - 技術概念節點：概念名稱、出現頻率、所屬社群、相鄰概念列表（可點擊）
3. **篩選器**：
   - 年份範圍滑桿（min/max 從資料自動計算）
   - 節點類型切換（顯示/隱藏 申請人層 / 專利層 / 概念層）
4. **社群圖例（Legend）**：每個技術社群一行，色點 + 名稱 + 節點數，點擊切換顯示/隱藏
5. **AI 趨勢報告**：可捲動，富文字格式
6. **統計資訊**：`X 申請人 · Y 專利 · Z 技術概念 · W 社群`

**F-12 圖譜操作**

- 滑鼠滾輪縮放
- 拖曳平移
- 點擊節點 → 更新側邊欄節點資訊
- 點擊空白處 → 清除選擇
- 雙擊節點 → 自動隱藏非相鄰節點（Focus mode），再雙擊還原

---

### 3.4 輸出模組

**F-13 圖譜分享 URL**

- 分析完成後，將 `GraphData` 序列化為 JSON 並持久化到本機磁碟（`data/<job_id>.json`）
- `app/analysis/[id]/page.tsx` 從磁碟讀取對應 JSON，伺服器運行期間 URL 永久有效
- 分析完成後在頁面右上角顯示「複製分享連結」按鈕，URL 格式：`http://localhost:3000/analysis/<job_id>`
- 連結只在此伺服器運行期間有效；若需跨機器分享，請使用 F-13b 下載 HTML

**F-13b 離線 HTML 快照匯出**

- 將圖譜資料（nodes + edges）序列化後產生自包含 `.html` 檔案（內嵌資料 + vis-network）
- 可直接用瀏覽器開啟，不需要伺服器
- 下載按鈕在頁面右上角，檔名格式：`patent-graph-YYYYMMDD.html`

**F-14 資料匯出**

- 匯出 Excel：含「節點」與「邊」兩個工作表；節點工作表含概念名稱、出現頻率、所屬社群；檔名格式：`patent-graph-YYYYMMDD.xlsx`
- 匯出 CSV：所有邊（source, target, relation, weight）
- 按鈕位於側邊欄底部；分析進行中 disabled

---

## 四、技術架構

### 4.1 技術選型

| 層         | 技術                                                                             | 理由                                        |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| 前端框架   | Next.js 16 (App Router)                                                          | SSE 支援好、本機部署                        |
| UI 元件    | shadcn/ui + Tailwind CSS                                                         | 快速建立暗色系介面                          |
| 圖譜渲染   | vis-network（`npm install`，非 CDN）                                             | `next/dynamic` + `ssr: false` 避免 SSR 衝突 |
| 後端       | Next.js API Routes                                                               | 不需要獨立後端                              |
| LLM 呼叫   | Vercel AI SDK（`@ai-sdk/openai`、`@ai-sdk/google`、`@ai-sdk/openai-compatible`） | 純 TypeScript，`p-limit` 控制並行           |
| 資料格式   | JSON（圖譜資料）+ XLSX（輸入）                                                   |                                             |
| 圖譜持久化 | **本機 JSON 檔案**（`data/<job_id>.json`）                                       | 支援分享 URL，伺服器重啟後仍可讀取          |
| 部署       | **本機 `next start`**（不部署 Vercel）                                           | 老師在自己電腦上運行                        |
| 社群偵測   | `graphology` + `graphology-communities-louvain`                                  | 純 TypeScript，Louvain 演算法               |

> **部署決策（已定案）：** 本系統部署於本機，不使用 Vercel，因此可使用 in-memory Map 管理 job 狀態，並以本機檔案系統儲存圖譜 JSON 以支援分享 URL。

### 4.2 目錄結構

```
teacher-wang-web/
├── app/
│   ├── page.tsx                 # 首頁（上傳介面）
│   ├── analysis/
│   │   └── [id]/
│   │       └── page.tsx         # 圖譜頁（從磁碟載入 GraphData）
│   └── api/
│       ├── analyze/
│       │   └── route.ts         # POST：開始分析，回傳 job_id
│       │   └── [id]/
│       │       └── route.ts     # DELETE：取消分析（F-16）
│       ├── progress/
│       │   └── [id]/
│       │       └── route.ts     # GET SSE：即時進度（dynamic=force-dynamic）
│       └── export/
│           └── [id]/
│               └── route.ts     # GET：下載自包含 HTML 快照（F-13b）
├── components/
│   ├── UploadZone.tsx
│   ├── ModelSelector.tsx
│   ├── ProgressPanel.tsx        # 含取消分析按鈕（F-16）
│   ├── GraphViewer.tsx          # vis-network wrapper（use client + next/dynamic ssr:false）
│   ├── Sidebar/
│   │   ├── SearchBox.tsx
│   │   ├── NodeInfo.tsx
│   │   ├── YearFilter.tsx
│   │   ├── LayerToggle.tsx
│   │   ├── CommunityLegend.tsx
│   │   └── AIReport.tsx
│   └── ExportButton.tsx
├── lib/
│   ├── graph-builder.ts         # 三層圖譜建構邏輯
│   ├── community.ts             # 社群偵測（graphology-communities-louvain）
│   ├── store.ts                 # job 狀態管理（in-memory Map）+ 圖譜 JSON 讀寫（data/）
│   ├── llm/
│   │   ├── nvidia.ts            # @ai-sdk/openai-compatible
│   │   ├── gemini.ts            # @ai-sdk/google
│   │   └── openai.ts            # @ai-sdk/openai
│   └── excel-parser.ts          # xlsx 解析 + 欄位自動辨識 + 申請人名稱清理
├── data/                        # 持久化圖譜 JSON（.gitignore）
├── types/
│   └── graph.ts                 # Node, Edge, Community 型別定義
└── public/
```

### 4.3 資料流

```
使用者上傳 Excel
      ↓
POST /api/analyze
  ├─ 解析 Excel → 取得 patents[]
  ├─ 建立 job（存 in-memory 或 Redis）
  └─ 啟動背景處理，回傳 job_id
      ↓
前端輪詢 GET /api/progress/[id]（SSE）
  ├─ 每分析完一篇 → push event
  └─ 全部完成 → push { done: true, graph: GraphData }
      ↓
前端收到 GraphData
  ├─ 建立三層圖（graph-builder.ts）
  ├─ 執行社群偵測（community.ts）
  └─ 渲染 GraphViewer（vis-network）
```

---

## 五、資料模型

### 5.1 輸入資料（Excel 列）

```typescript
interface PatentRow {
  id: string; // 系統生成，格式：`${filename}-${rowIndex}`（e.g. "patents-0"）
  title: string; // 專利名稱(中)
  abstract: string; // 摘要
  applicant: string; // 申請人（已清理，多申請人以「；」分隔，地址已截斷）
  filing_date?: string; // 申請日（YYYY/MM/DD）
  application_number?: string; // 申請號
  search_keyword?: string; // 搜尋關鍵字
}
```

### 5.2 LLM 萃取結果

```typescript
interface ExtractionResult {
  patent_id: string;
  translated_abstract: string;
  keywords: string[];
  relations: Array<{
    source: string;
    target: string;
    relation: string;
    weight: number; // 1–5
  }>;
}
```

### 5.3 圖譜資料（GraphData）

```typescript
type NodeType = "applicant" | "patent" | "concept";

interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  // 申請人節點
  patent_count?: number;
  // 專利節點
  title?: string;
  applicant?: string;
  filing_date?: string;
  year?: number;
  abstract?: string;
  application_number?: string;
  // 技術概念節點
  frequency?: number;
  community_id?: number;
  // 視覺屬性
  color: string;
  size: number;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  weight?: number; // 申請人→專利邊無 weight，概念邊有；使用 optional
  source_patent?: string; // 哪篇專利產生了這條邊
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: Array<{
    id: number;
    name: string;
    color: string;
    node_count: number;
  }>;
  stats: {
    applicant_count: number;
    patent_count: number;
    concept_count: number;
    community_count: number; // 新增：對應 UI 統計列「W 社群」
    year_range: [number, number];
    // edge_count 不在 UI 顯示，由前端 edges.length 取得即可
  };
  ai_report: string;
  generated_at: string; // ISO 8601 UTC 格式，前端顯示時轉換為台灣時間（UTC+8）
}
```

---

## 六、UI/UX 規格

### 6.1 設計系統總覽

| 項目       | 選定方案                      | 說明                                            |
| ---------- | ----------------------------- | ----------------------------------------------- |
| 風格       | Dark Mode (OLED)              | 學術研究深色介面，低光源友好，WCAG AAA          |
| 標題字體   | Crimson Pro                   | 學術感、可讀性強的 Serif                        |
| 內文字體   | Atkinson Hyperlegible         | 無障礙閱讀優化，適合密集資料                    |
| 主要元件庫 | shadcn/ui + Tailwind CSS      | 以 `npx shadcn@latest add dashboard-01` 為基礎  |
| 圖示系統   | Lucide Icons（SVG）           | 統一 24×24 viewBox，禁止使用 Emoji 作圖示       |
| 圖表       | shadcn Chart（Recharts 封裝） | 使用 `<ChartContainer>` 包裝，不直接用 Recharts |

**Google Fonts 載入**

```css
@import url("https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Crimson+Pro:wght@400;500;600;700&display=swap");
```

---

### 6.2 色彩系統

```css
/* ── 背景層 ── */
--bg-base: #020617; /* 主背景（OLED 深黑） */
--bg-accent: #0f172a; /* 次要背景 */
--bg-sidebar: #1e293b; /* Sidebar 背景 */
--bg-card: #1e293b; /* 卡片 / 面板 */
--border: #334155; /* 邊框（深色模式可見） */

/* ── 文字層 ── */
--primary-foreground: #f8fafc; /* 主要文字 */
--text-muted-foreground: #94a3b8; /* 次要說明文字（最低對比 4.5:1） */
--text-faint: #475569; /* 輔助提示，僅用於非必要文字 */

/* ── 功能色 ── */
--accent: #4e79a7; /* 互動強調色 */
--accent-hover: #6b9cc3; /* hover 狀態 */
--cta: #22c55e; /* 主要行動按鈕（綠色正向指標） */
--cta-hover: #16a34a;
--error: #ef4444;
--warning: #f59e0b;
--success: #22c55e;

/* ── 圖譜：申請人固定 10 色（Tableau 10 語意色） ── */
--ap-color-1: #4e79a7;
--ap-color-2: #f28e2b;
--ap-color-3: #e15759;
--ap-color-4: #76b7b2;
--ap-color-5: #59a14f;
--ap-color-6: #edc948;
--ap-color-7: #b07aa1;
--ap-color-8: #ff9da7;
--ap-color-9: #9c755f;
--ap-color-10: #bab0ac;
```

**對比度驗證**

| 組合                                        | 比例  | 標準   |
| ------------------------------------------- | ----- | ------ |
| `--primary-foreground` on `--bg-base`       | 21:1  | ✅ AAA |
| `--text-muted-foreground` on `--bg-sidebar` | 4.7:1 | ✅ AA  |
| `--cta` on `--bg-accent`                    | 5.2:1 | ✅ AA  |

---

### 6.3 字體排版

```css
/* 標題（Crimson Pro Serif） */
h1 {
  font-family: "Crimson Pro", serif;
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.3;
}
h2 {
  font-family: "Crimson Pro", serif;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.4;
}
h3 {
  font-family: "Crimson Pro", serif;
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.4;
}

/* 內文（Atkinson Hyperlegible） */
body {
  font-family: "Atkinson Hyperlegible", sans-serif;
  font-size: 1rem;
  line-height: 1.6;
}

/* 數據標籤 / 圖譜節點 */
.label-sm {
  font-family: "Atkinson Hyperlegible", sans-serif;
  font-size: 0.75rem;
  line-height: 1.5;
}

/* 行寬限制（提升長文可讀性） */
.prose {
  max-width: 65ch;
}
```

**規則**

- 行高：內文 1.5–1.6，標題 1.3–1.4
- 最小字體：mobile 上 16px，標籤最小 12px
- 每行最大字元：65–75 字元（`max-width: 65ch`）

---

### 6.4 頁面佈局

**首頁（上傳頁）**

```
┌──────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────┐    │
│  │  王老師專利知識圖譜分析平台                           │    │
│  │  Patent Knowledge Graph Analysis                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │   ↑  拖曳 .xlsx 至此，或點擊選擇檔案               │    │
│  │      支援多檔同時上傳                               │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────┐  ┌───────────────────────────────┐   │
│  │ 模型選擇        │  │ API Key                       │   │
│  │ ○ NVIDIA       │  │ [________________________]    │   │
│  │ ○ Gemini       │  │ ✓ 驗證中...                   │   │
│  │ ○ OpenAI       │  │                               │   │
│  └────────────────┘  └───────────────────────────────┘   │
│                                                          │
│  抽樣筆數 [____50____]   將分析 50 / 總計 M 筆            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 欄位對應結果（上傳後顯示）                           │    │
│  │  ✓ 專利名稱 → 專利名稱(中)                          │    │
│  │  ✓ 摘要    → abstract                             │    │
│  │  ✗ 申請日  → 未找到                                │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│                  [ 開始分析 → ]                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**分析頁（圖譜頁）**

```
┌──────────────────────────────────────┬──────────────────┐
│                                      │ 🔍 搜尋節點...    │
│                                      ├──────────────────┤
│                                      │ 節點資訊          │
│         圖譜主區域                    │  ─────────────   │
│        (vis-network)                 │  [點擊節點顯示]   │
│                                      ├──────────────────┤
│   [右上角浮動工具列]                   │ 篩選器           │
│   ⬛ 匯出 HTML                        │  年份 ◀━━━━━▶   │
│   ⬛ 下載 Excel                       │  ☑ 申請人層      │
│                                      │  ☑ 專利層        │
│                                      │  ☑ 概念層        │
│                                      ├──────────────────┤
│                                      │ 技術社群          │
│                                      │  ● AI應用   42   │
│                                      │  ● 區塊鏈   28   │
│                                      │  ● 資安     15   │
│                                      ├──────────────────┤
│                                      │ AI 趨勢報告       │
│                                      │  （可捲動閱讀）   │
├──────────────────────────────────────┴──────────────────┤
│  42 申請人 · 156 專利 · 843 技術概念 · 7 社群             │
└──────────────────────────────────────────────────────────┘
```

> **RWD 斷點**：1440px（桌面）、1024px（sidebar 收合至 overlay）、768px（單欄，sidebar 下移）、375px（mobile 最小支援）

---

### 6.5 進度頁（分析進行中）

```
┌──────────────────────────────────────────────────────────┐
│  正在分析專利...                                           │
│                                                          │
│  ████████████████░░░░░░░░░░░░░░  47 / 200  23%          │
│                                                          │
│  ▶ 當前批次：基於ESG的資料整合系統 等 5 篇                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ✓ [batch 1/40]  證券型代幣交易管理系統...           │   │
│  │ ✓ [batch 2/40]  快速識別網站安全性漏洞...           │   │
│  │ ► [batch 3/40]  基於ESG的資料整合系統...  ⏳        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  預估剩餘時間：約 18 秒              [ 取消分析 ]          │
└──────────────────────────────────────────────────────────┘
```

---

### 6.6 元件規格

#### UploadZone（拖曳上傳區）

| 狀態      | 樣式                                                      |
| --------- | --------------------------------------------------------- |
| 預設      | `border-2 border-dashed border-slate-600 bg-slate-900/50` |
| Drag Over | `border-accent bg-accent/10 scale-[1.01]`                 |
| 已上傳    | `border-success bg-success/10`，顯示檔名列表              |
| 錯誤      | `border-error bg-error/10`，顯示具體錯誤訊息              |

#### ModelSelector（模型選擇器）

- 使用 shadcn `RadioGroup` 元件
- 三個選項並排（mobile 單欄）
- 選中後高亮 `bg-accent/20 border-accent`
- API Key 輸入欄使用 `type="password"` + 顯示/隱藏切換按鈕

#### Sidebar（側邊欄）

- 寬度：300px（桌面固定），mobile 為全寬 sheet overlay
- 使用 shadcn `ScrollArea` 實現內部捲動
- 各面板使用 shadcn `Collapsible` 可收合

#### NodeInfo（節點資訊面板）

- 動畫：從右側 slide-in（`transition-transform duration-200`）
- 摘要欄位：預設截斷 3 行，點擊「展開」顯示全文
- 相鄰節點：使用 `Badge` 元件，可點擊 focus 圖譜

#### YearFilter（年份滑桿）

- 使用 shadcn `Slider`（雙把手 range）
- 即時顯示選取範圍，節流 300ms 後觸發圖譜更新
- 顯示「YYYY – YYYY」文字標示

---

### 6.7 動畫與過渡規範

| 場景              | 時間  | Easing        | 說明            |
| ----------------- | ----- | ------------- | --------------- |
| 按鈕 hover/active | 150ms | `ease-out`    | 顏色過渡        |
| Sidebar slide     | 200ms | `ease-in-out` | transform X     |
| 節點點擊 focus    | 300ms | `ease-in-out` | vis-network fit |
| 進度條增加        | 400ms | `ease-out`    | width 過渡      |
| 頁面路由切換      | 200ms | `ease-in-out` | opacity fade    |
| 上傳區拖曳反饋    | 150ms | `ease-out`    | scale + border  |

**規則**

- 使用 `transform` / `opacity` 做動畫，避免 `width` / `height`（觸發 layout）
- 所有 hover 過渡加上 `transition-colors duration-200` 或對應 utility
- 必須支援 `prefers-reduced-motion`：媒體查詢開啟時關閉所有過渡

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

### 6.8 無障礙規格（Accessibility）

| 項目       | 要求                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| 色彩對比   | 正文最低 4.5:1（AA），重要標題建議 7:1（AAA）                            |
| 鍵盤導覽   | Tab 順序符合視覺順序；所有互動元素可鍵盤操作                             |
| Focus 狀態 | 所有 focusable 元素有明顯 focus ring（`outline: 2px solid --accent`）    |
| 表單標籤   | 所有 `<input>` 綁定 `<label for="...">`，不得使用 placeholder 代替 label |
| Icon 按鈕  | 純圖示按鈕必須加 `aria-label`（如「下載圖譜」）                          |
| 圖片 alt   | 有意義的圖片加描述性 alt text；裝飾性圖片加 `alt=""`                     |
| Skip Link  | 圖譜頁加入「跳至主要內容」隱藏連結（keyboard focus 時顯示）              |
| 觸控目標   | 最小 44×44px（mobile），關鍵按鈕建議 48×48px                             |
| 錯誤訊息   | 顯示在問題欄位旁邊，使用 `role="alert"`                                  |

---

### 6.9 交付前檢查清單（Pre-Delivery Checklist）

#### 視覺品質

- [ ] 所有圖示使用 Lucide SVG，無 Emoji 圖示
- [ ] 圖示大小統一（`w-5 h-5` 或 `w-6 h-6`）
- [ ] hover 狀態不造成 layout shift
- [ ] 深色模式下所有邊框可見（不用 `border-white/10`）

#### 互動

- [ ] 所有可點擊元素加 `cursor-pointer`
- [ ] hover 有顏色/陰影反饋
- [ ] 非同步操作期間按鈕 disabled + loading spinner
- [ ] 過渡時間 150–300ms

#### 無障礙

- [ ] 所有 `<input>` 綁定 `<label>`
- [ ] 圖示按鈕有 `aria-label`
- [ ] Focus ring 可見
- [ ] `prefers-reduced-motion` 已處理

#### 版面

- [ ] 375px / 768px / 1024px / 1440px 均無水平捲軸
- [ ] 固定 navbar 不遮蓋內容（padding-top 補足）
- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1">` 已設定

---

## 七、API 設計

### POST `/api/analyze`

開始一次分析任務。

**Request Body**

```json
{
  "provider": "nvidia | gemini | openai",
  "api_key": "sk-...",
  "sample_size": 50,
  "patents": [
    {
      "title": "證券型代幣交易管理系統",
      "abstract": "本揭示內容提供一種...",
      "applicant": "國泰金融控股股份有限公司",
      "filing_date": "2024/06/26",
      "application_number": "TW113123858"
    }
  ]
}
```

**Request Headers**

- `X-LLM-Api-Key: <api_key>`（API Key 放 header，不放 body，避免寫入 server log）

**Response**

```json
{ "job_id": "abc123" }
```

---

### DELETE `/api/analyze/[id]`

取消正在進行的分析任務（F-16）。

**Response**

```json
{ "cancelled": true, "done": 47, "total": 200 }
```

若 job 不存在或已完成：`404 Not Found`

---

### GET `/api/progress/[id]` (SSE)

訂閱分析進度。

**Route 設定（Next.js 16）：**

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Response header: X-Accel-Buffering: no（禁止 CDN 緩衝）
```

**Event 格式**

進度事件（統一使用 batch 格式，與 F-08 一致）：

```
event: progress
data: {"done": 5, "total": 50, "batch_titles": ["證券型代幣交易管理系統", "快速識別網站安全性漏洞"], "batch_index": 1}
```

完成事件：

```
event: complete
data: {"job_id": "abc123"}
```

> 完成後前端導向 `/analysis/abc123`，圖譜資料從磁碟讀取，**不在 SSE 傳送整份 GraphData**

取消事件：

```
event: cancelled
data: {"done": 47, "total": 200}
```

錯誤事件：

```
event: error
data: {"message": "API Key 無效"}
```

---

### GET `/api/export/[id]`

下載自包含 HTML 快照（F-13b）。

**Response**: `Content-Type: text/html`，檔名 `patent-graph-YYYYMMDD.html`

**錯誤回應：**

- `404 Not Found`：job 不存在或資料已清除
- `409 Conflict`：分析尚未完成
- `500 Internal Server Error`：序列化失敗

---

## 八、遷移對照表

現有 `main.py` 功能對應到新系統：

| 現有功能                | 位置                               | 新系統對應                               |
| ----------------------- | ---------------------------------- | ---------------------------------------- |
| tkinter GUI             | `App` class                        | Next.js 首頁                             |
| Excel 讀取 + 欄位辨識   | `run_analysis()`                   | `lib/excel-parser.ts`                    |
| PatentAnalyzer LLM 呼叫 | `extract_entities_and_relations()` | `lib/llm/*.ts`                           |
| AI 報告生成             | `generate_overall_report()`        | `lib/llm/*.ts` (report endpoint)         |
| networkx 圖建構         | `run_analysis()`                   | `lib/graph-builder.ts`                   |
| community detection     | `greedy_modularity_communities`    | `lib/community.ts`                       |
| vis-network 渲染        | 內嵌 HTML                          | `components/GraphViewer.tsx`             |
| 進度日誌                | `self.log()`                       | SSE events → `ProgressPanel.tsx`         |
| 進度條                  | `ttk.Progressbar`                  | `ProgressPanel.tsx`                      |
| 搜尋功能                | inline JS in HTML                  | `components/Sidebar/SearchBox.tsx`       |
| Legend + 社群篩選       | inline JS in HTML                  | `components/Sidebar/CommunityLegend.tsx` |

---

## 九、非功能需求

| 需求         | 規格                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| 分析速度     | 50 筆 < 30 秒（batch=5, concurrency=5）；200 筆 < 2 分鐘                            |
| 圖譜渲染     | 1000 節點以下流暢運作（60fps）                                                      |
| 首頁載入     | < 2 秒                                                                              |
| 瀏覽器支援   | Chrome / Firefox / Safari 最新版                                                    |
| 本機部署     | `npm run dev` 即可運行，不需要 Docker                                               |
| API Key 安全 | Key 透過 `X-LLM-Api-Key` header 傳遞，不放 request body；不寫入 server 日誌或資料庫 |

---

## 十、開發里程碑

### Phase 1：基礎架構（約 1 週 + 2 天 PoC）

- [ ] Next.js 16 專案初始化，Tailwind + shadcn/ui 設定，`.env.local.example` 建立
- [ ] Excel 上傳元件 + 欄位自動辨識 + **申請人名稱清理**（Phase 1 驗收條件：提供 10 筆測試資料確認清理結果正確）
- [ ] LLM API 整合（三個提供商，使用 Vercel AI SDK；`p-limit` 並行控制）
- [ ] SSE 進度推送（route 加上 `dynamic = 'force-dynamic'`、`runtime = 'nodejs'`）
- [ ] `lib/store.ts`：in-memory job Map + `data/` 目錄 JSON 讀寫（支援分享 URL）
- [ ] `DELETE /api/analyze/[id]` 取消機制
- [ ] **社群偵測 PoC**（`graphology-communities-louvain`，50 個測試節點，輸出分組正確）— Phase 2 開工前置條件

### Phase 2：圖譜核心（約 1.5 週）

- [ ] 三層圖譜建構邏輯（`graph-builder.ts`），使用 mock 資料驗收
- [ ] 社群偵測整合（`community.ts`，接 graphology-communities-louvain PoC 成果）
- [ ] vis-network `GraphViewer` 元件（`use client` + `next/dynamic ssr:false`，`useEffect` cleanup `network.destroy()`）
- [ ] 節點視覺規則（顏色、大小、形狀）
- [ ] `app/analysis/[id]/page.tsx` 從磁碟讀取 GraphData 並渲染

### Phase 3：Sidebar 功能（約 3 天）

- [ ] 搜尋框（節點 label 模糊匹配，非匹配 opacity 0.2）
- [ ] 節點資訊面板（三種節點類型）
- [ ] 年份篩選滑桿（雙把手，`filing_date` 缺失歸「未知」）
- [ ] 節點層切換（申請人 / 專利 / 概念）
- [ ] 社群 Legend + 篩選
- [ ] 空狀態規格（F-17 各情境）

### Phase 4：輸出與收尾（約 2 天）

- [ ] HTML 快照離線匯出（F-13b）
- [ ] 分享 URL「複製連結」按鈕（F-13）
- [ ] Excel/CSV 資料匯出（F-14）
- [ ] 首頁上傳 UX 完善（空狀態、欄位對應預覽）
- [ ] 整合測試（使用真實 API Key，50 筆真實資料）
- [ ] 邊界情況：超大檔案、0 筆成功、網路斷線

---

## 十一、開放問題

1. ~~**圖譜是否要持久化？**~~ ✅ **已決定：** 本機部署，以 `data/<job_id>.json` 本機檔案持久化，支援分享 URL，伺服器運行期間永久有效。
2. ~~**申請人名稱清理：**~~ ✅ **已決定：** 截取第一個全形/半形空格前的字串；多申請人各自建節點。詳見 F-05。
3. ~~**多申請人處理：**~~ ✅ **已決定：** 各自建立獨立節點，共同指向同一篇專利。詳見 F-05。
4. **概念去重（待決定）：** LLM 可能萃取出語意相同但字面不同的詞（如「人工智慧」vs「AI」），是否需要同義詞合併？建議：v1.0 不處理，以精確字面匹配為主；v2.0 考慮引入詞向量相似度合併。

---

_本文件由 Claude Code 協助撰寫，基於現有 `src/main.py` 程式碼分析及 `graphify-out/` 圖譜資料。_
