# PRD v2 / P3：概念時間

**版本**：P3-1.1
**日期**：2026-08-07
**狀態**：已審核（APPROVE-AS-AMENDED，8 BLOCKING 全修）→ 實作
**審核**：fresh claude agent（2026-08-07），8 BLOCKING ＋ 10 non-blocking，
完整 findings：`docs/archive/PRD-v2-P3-審核-findings.md`
**基準**：`docs/PRD.md` v1.2、`docs/PRD-v2-P0-資料層.md`、`docs/PRD-v2-意圖.md` §P3
**前置**：P0（完成）、P1（完成）
**不依賴**：P4–P8 任何一期，也不依賴未決設計問題（Q1–Q9 全部作用在 P4/P6/P7）

---

## 0. 這份文件的範圍

**只規範 P3：給每個概念節點算出時間元資料，並提供「依首次出現年份漸層著色」的視圖呈現。**
「先後順序／上下位」屬 P6；「關聯度與分析單位」屬 P4；「PNG 戳記」屬 P7；「離線 HTML 圖例同步」屬 P8——
本檔只留接口，不展開。

**驗收條件只引用 P3 內部的東西。** 沿用 P0 的教訓：後期能力一律不寫進本期驗收，避免循環依賴。

**實測基準**：對 live DB 中唯一的 `schema_version=3` 分析（`analysis id` 見附錄 A）
實測出 **490 個概念、全部有年份、first_year 窗 [2007, 2025]、中位數 2019**。
附註：該分析的母體是 v3 流程跑出的樣本，**不是**老師版 1741 筆全量；全量重跑後
**驗收基準 3** 的窗須以實際值覆核（機制不變，數字更新）。

> **窗的兩種母體不可混淆**：P0 §3.1 實測的「2004–2021」是**專利申請年窗**
> （`stats.year_range`）；本檔的 `time_window=[2007,2025]` 是**概念 first_year 窗**
> ——兩者母體、數值、用途都不同，**不得互相替代**（N4）。

---

## 1. 概念時間統計

### 1.1 定義與母體

一個概念的「時間」由**其合併後 `source_patents` 的申請年（filing_date）**推導：

| 量 | 定義 | 型別（DB → TS） |
|---|---|---|
| `first_year` | 概念下所有**有效年份**的最小值 | `integer` null → `number \| undefined` |
| `last_year` | 最大值 | 同上 |
| `median_year` | 中位年（方法 1.2） | 同上 |
| `year_counts` | 年度分布 `{year: count}`，count=該年不同專利數 | `jsonb` → `Record<string, number>` |

**母體 = 多重集合**：每個有有效年份的專利各貢獻一個年份值，**重複年份必須保留**。
不是 `year_counts` 的鍵集（那會漏掉重複、中位數算錯，見 1.2 的反例，B3）。

**有效年份（B5）**：時間統計只採 `[1990, 今年+1]` 內的年份（與 P0 §3.1 的
`warnings.date_out_of_range` 門檻同源，**不引入新規則**）。落在外的專利**不參與**時間統計；
其筆數沿用既有 warnings 可查——漸層窗因此**不會被單筆髒資料（如 1900／2099）綁架**。
`filing_date` 為「無」與「有效年份為空」都使該專利不貢獻年份；一個概念全部推不出年份 →
`first_year/last_year/median_year = null`，`year_counts = null`。

- 申請年一律由 `filing_date` 前 4 碼解析（**共用** `lib/graph-builder.ts` 的既有規則。
  B6 的 N3 已納入：抽成共用 `parseFilingYear()`，**不得**在 `lib/concept-time.ts` 再寫一份）。
- P1 合併後的 `source_patents` 已是聯集——時間統計**直接吃合併後結果**，不得再處理同義詞。

### 1.2 中位數（沿用已定案決策 5，且母體明確）

nearest-rank + lower median，**母體為 1.1 的多重集合**（保留重複）：

```
A = 所有有效年份升冪（長度 n，含重複）
n 奇數：median = A[(n-1)/2]
n 偶數：median = A[n/2 - 1]     （lower，不取平均）
```

### 1.3 年度分布與中位反例（B3）

`year_counts`：對每個有效年份累加不同專利數（一個專利一個年，天然去重）。

> **中位數不能用 `year_counts` 的鍵計算**。反例：多重集合 `[2015,2020,2020,2020]`
> → lower median = **2020**；若誤用 distinct years `[2015,2020]` → **2015**。
> 決策 5 的理由正是「lower／upper／平均會決定 P6 箭頭有無」，這個錯比 lower/upper 之爭更嚴重。
> 驗收 4 用此 fixture 鎖死。

---

## 2. 資料結構與 DB

### 2.1 `types/graph.ts`

`GraphNode`（概念節點）新增四個 optional 欄位：

```ts
interface GraphNode {
  // …既有欄位（不動）
  first_year?: number        // 概念：首次有效申請年
  last_year?: number         // 概念：最近有效申請年
  median_year?: number       // 概念：中位有效申請年（1.2）
  year_counts?: Record<string, number>  // 概念：年度分布
}
```

`GraphMethodology` 新增兩個 optional 欄位——**沒有 `color_mode`**（它屬 view 狀態，B）：

```ts
interface GraphMethodology {
  // …既有 15 欄（不動）
  time_window?: [number, number] | null   // 漸層窗 = [min first_year, max first_year]（資料事實）
  time_color_scale?: 'sequential_blue'    // 漸層色盤名稱（方法圖例要印）
}
```

### 2.2 `db/migrations/004_p3_concept_time.sql`

`concepts` 加四欄（比照 002/003 之 **additive 慣例**：只 ADD COLUMN / CREATE TABLE、
**不寫 BEGIN/COMMIT**——`runMigrations()` 已包 transaction、附 down 檔）：

```sql
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS first_year   integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS last_year    integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS median_year  integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS year_counts  jsonb;
```

`methodology` 已存於 `analyses.methodology`（整塊 jsonb），**不新增表欄**。
down 檔：`db/migrations/down/004_down.sql`（反向 DROP 這四欄）。

### 2.3 落庫／讀回（N7、N9）

- `lib/db/analyses.ts` 的 `ConceptRow`（約 `:539-547`）與節點映射（約 `:651-660`）要改：
  寫入 `first_year ?? null`（DB 有值才寫，其他留 NULL）、讀回 `?? undefined`（缺欄回傳
  `undefined`，不得塞 0／假預設）。
- `saveGraph()` `concepts` INSERT 欄位清單（約 `:373-396`）加四欄；`loadGraph()` 對應
  SELECT（約 `:604-605`）加四欄。
- **DB `null` ⇄ TS `undefined` 的轉換點只在這一層**：任何下游算式不得見到 `null` 帶進
  顏色計算（見 B7）。`year_counts` 經 jsonb 往返後**鍵一律為字串**，測試以此斷言。

---

## 3. 漸層著色（P3 的核心視化）

### 3.1 著色模式存在 view 層，不落庫（B1、B2 裁決）

概念節點的 `color`／`concepts.color` **永遠是社群色**（`community_id → color`，與 v1.2/P0
完全相同）。漸層**只活在 view 層**：

- `GraphMethodology` 不存 `color_mode`（那是視圖狀態，不是方法宣告）。
- 漸層由 view option `colorMode: 'community' | 'first_year'` 驅動，
  放進 `lib/graph-view.ts` 的 `GraphViewOptions`（與既有 `mode/showSemantic/minSupport/yearRange`
  同層級）——由**純函式 `selectGraphView()`** 回傳「已把概念節點顏色重算為漸層色」的
  **新 nodes 陣列**，**不異動原 graph、不寫 DB、不改 `concepts.color`**。
- 切換只影響**概念節點**的 color；專利／申請人節點、邊、布局、社群 id **全部不動**。
- 之所以必須走 `selectGraphView`（重算返回新 nodes）而不是「只改 DataSet 顏色」：存在
  `applyHighlight()/clearHighlight()`（GraphViewer.tsx:483-524）會從 prop nodes 的 `n.color`
  還原顏色，純 DataSet 改色會被任一節點操作沖掉。走 view 重算後顏色與高亮**自動一致**。

### 3.2 漸層窗由資料算出（不可寫死）

```
time_window = [ min(所有有 first_year 概念), max(…概念 first_year) ]
```

- 只算有 `first_year` 的概念；無年份概念排除在窗之外（見 3.4）。
- **沒有概念有年份時 `time_window = null`**（型別允許），此時漸層切換鍵停用並顯示原因，
  不渲染空漸層（N5）。
- **全部概念同一年（span=0）**：`t` 一律 0（見 3.3 的 `max(1,…)`），全落錨色[0]；
  圖例在 span=0 時只畫單一錨色，不畫完整漸長條（N5）。
- 不得寫死「近三年」等常數；窗須存進 `methodology.time_window`。
- `time_window`（概念窗）與 `stats.year_range`（專利窗）**不同**，不得互相替代（N4）。

### 3.3 色與映射（B4）

**色盤 `sequential_blue`（9 錨色，值為常數）**：

```
["#EFF6FF","#DBEAFE","#BFDBFE","#93C5FD","#60A5FA","#3B82F6","#2563EB","#1D4ED8","#1E3A8A"]
```

映射公式（寫進 methodology 並可重現；**純函式**）：

```
t   = clamp((first_year - window[0]) / max(1, window[1] - window[0]), 0, 1)
pos = t * (N - 1)                  // N = 錨色個數（此為 9）
lo  = floor(pos)                   // hi = min(N-1, lo+1)
f   = pos - lo                     // 0 ≤ f < 1
color = sRGB 逐通道線性插值(锚[lo], 锚[hi], f)，每通道 Math.round，輸出 #RRGGBB
```

- **sRGB 逐通道**（非 OkLab／HSV）；四捨五入用 `Math.round`。
- 預期：`window=[2007,2025]`、`first_year=2016` → `t=0.5` → `pos=4` → **錨色[4]**（見驗收 5）。
- 同 t 兩次呼叫顏色相同（可測試）。t 恰好落在錨色上時不得因浮誤偏移。

### 3.4 無年份概念

`first_year` 為 null 的概念：視為**「年份未知」語意**的灰（固定 `#BAB0AC`），不進窗計；
**灰**在社群模式是「第 10 個社群色」、在 first_year 模式是「年份未知」——**同色不同語意**，
圖例文字**分模式**寫（N10）。

---

## 4. UI

### 4.1 著色切換（落點與既有控制一致，B2）

視化控制都在 `components/Sidebar/index.tsx`（年份範圍、語意、支持門檻）、狀態在
`components/GraphLayout.tsx:29-50`；`GraphViewer.tsx` 只有一顆 fit-to-view。故切換器加在
Sidebar，狀態走 `GraphViewOptions.colorMode`（`lib/graph-view.ts`），由 `selectGraphView()`
重算。§6 的檔案表因此含 `GraphLayout.tsx`、`Sidebar/index.tsx`、`lib/graph-view.ts`。

- `GraphLayout.tsx:70-71` 的 URL 慣例：`colorMode` **進 URL**（純加參數，`mode/showSemantic/…`
  本來就進 URL）；它是視圖狀態，**不落庫**，但進 URL 讓分享連結看到漸層（N6）。
- 已知限制（寫進此處，日後不得當 bug）：`app/api/export/[id]/route.ts` 的 `parseExportOptions`
  **不吃** `colorMode`，故離線 HTML／PNG 在 P7/P8 前不會反映漸層——現在明記。

### 4.2 圖例與 tooltip

- GraphLegend 加「首次年份」說（僅 `colorMode==='first_year'` 顯示）：窗範圍（`time_window`）、
  三個錨色樣本（最早／中間／最近）、色盤名、灰節點說明——**分模式**寫灰語意。
- 概念節點 tooltip 顯示：`首次 {first_year} · 中位 {median_year} · 最近 {last_year} · 涵蓋 N 篇`。
- 離線 HTML 的圖例同步屬 P8，本檔不展開（見 §5）。

---

## 5. 不得破壞的既有行為

1. 概念節點顏色缺省為社群色（`colorMode` 預設 `community`）→ 所有既有 v2/v3 資料與 DB 分析
   開啟後顏色行為不變。
2. 既有 `data/*.json`（11 個，schema_version=2）可開、可渲染、無 NaN／0 冒充值
   （新欄缺欄 = undefined——由 B7 的 `normalizeNode` 驗證兜住）。
3. 取消分析（F-16）、SSE 進度（F-08）、分享 URL（F-13）+ `colorMode` 新增參數行為不變。
4. **`normalizeMethodology()` 的嚴格白名單（決策 7）與 `normalizeNode` 須收編/驗證**：
   - `time_window`／`time_color_scale` 若不在 v3 pay，`normalizeGraphData()` 會**永久丟棄**
     （整個 repo 唯一呼叫點是 `app/api/admin/import/route.ts:62`；`/analysis/<id>` 走
     `loadGraph()` 直接 cast methodology，不經 normalize。見 B6）。因此：
     a) `normalizeMethodology` 明列兩欄（`time_window` 驗成「兩個整數的 tuple 否則 null」；
        缺欄 → `undefined`，不得塞假預設——methodology 版的「0 冒充值」防線，B7）；
     b) `normalizeNode` 對四欄**明確驗證**（`Number.isInteger` 才留，否則 `undefined`；
        `year_counts` 只收 `Record<string, 有限數>`），**不得**靠 spread 原樣放行——否則
        字串/`null`/`1e309` 會進 `t` 算成 `NaN` 顏色，違反 §5-2（B7）。
5. P1 輸入層合併不變：時間統計吃合併後 `source_patents`，不得倒回去用未合併資料。
6. 不引進任何篩選（P2 的來源篩選屬後期）；時間統計在合併後輸入上算。

---

## 6. 必須同步改的程式碼（P3 範圍）

| # | 位置 | 內容 |
|---|---|---|
| 1 | `lib/concept-time.ts`（**新檔**） | `computeConceptStats(conceptNetwork, patentsByYear)` → `Map<label, {first,last,median,yearCounts}>`；含**共用 `parseFilingYear()`**（與 graph-builder 同源）、多重集合中位數、有效年份過濾、窗計算、漸層映射純函式 |
| 2 | `lib/graph-builder.ts` | 呼叫 #1，把四欄**塞進概念節點**（**不著色**）→ 抽 `parseFilingYear()` 供共用 |
| 3 | `types/graph.ts` | §2.1 的四欄 + methodology 兩欄（**無 color_mode**） |
| 4 | `lib/db/analyses.ts` | §2.3：INSERT/SELECT 加四欄 + ConceptRow 映射（null/undefined、YearCounts 字串鍵） |
| 5 | `lib/graph-compat.ts` | `normalizeMethodology` 收欄 + `normalizeNode` 對四欄驗證（B7）；不重作 v3 期（不需要「帶」） |
| 6 | `lib/graph-view.ts` | `GraphViewOptions` 加 `colorMode`；`selectGraphView()` 以純函式重算概念色（B2/B8） |
| 7 | `components/Sidebar/index.tsx` | 著色切換器（B2） |
| 8 | `components/GraphLegend.tsx` | 漸層圖例（分模式）（N10） |
| 9 | `components/GraphViewer.tsx` | concept tooltip 時間；吃 `selectGraphView` 回傳的新 nodes |
| 10 | `db/migrations/004_p3_concept_time.sql` + `down/004_down.sql` | §2.2 |

**不做**：PNG 戳記、離線 HTML 圖例同步、單位切換、時間軸 slider、IPC 篩選。

---

## 7. 驗收條件（只引用 P3 內部；除 1 外全部自動化）

1. `pnpm test` 與 `next build` 全綠。
2. **概念時間元資料 fixture**（純函式，不依賴 DB／DOM）：`tests/concept-time.test.ts`
   - 偶數 lower median：`[2015,2016,2018,2020] → 2016`（**不是** 2017）；
   - 多重集反例：`[2015,2020,2020,2020] → 2020`（B3 鎖死，誤用 distinct years 會綠→紅）；
   - P1 合併後 source_patents 聯集時間；
   - 有效年份過濾：`1990` 與 `今年+1` 之**外**的年份不參與（B5）；全無有效年份 → `null`。
3. **窗與映射純函式**（`lib/concept-time.ts`，可測、不靠 DOM）：
   - `window=[2007,2025]`：`first_year=2007 → 錨色[0]`、`2025 → 錨色[8]`、
     `2016 → 錨色[4]`；`t` 越界 clamp；span=0 全落錨色[0]；浮點落在錨點仍命中；
   - 換一組年份 fixture → window 隨之改變（不寫死）；`null` 時切換鍵停（function-level）。
4. **著色模式純函式 switch**（`selectGraphView`，不依 DOM）：
   同一 graph 分別以 `community` 與 `first_year` 呼叫，比對概念節點 color 陣列：
   切回 `community` 與原 `community` 結果**逐欄相同**（B2/B8 的核心）。
   切到 `first_year`：概念節點全數改成漸層色、社群 id 未改、專利/申請人節點色未改、
   edges 未改。
5. **歸一化驗證**（`tests/graph-compat-v3.test.ts`）：
   - v3 payload 帶 `time_window`/`time_color_scale` 過 `normalizeGraphData()` 後**逐欄保留**（B6）；
   - `normalizeNode` 對 `first_year:"2019"`/`null`/`1e309` → 結果是原本 `undefined`（不 NaN，B7）；
   - 既有「無節點/邊數值 NaN」的測試維持通過。
6. **DB 往返**（DB 層）：跑一次分析 → 重啟 → 開 `/analysis/<id>` → 概念節點五欄與分析當下
   逐欄相同；`methodology.time_window`/`time_color_scale` 亦在往返後存在。此測試驗**DB 往返**，
   **不宣稱**守 §5-4（B6）。
7. 全部既有 `data/*.json`（v2）仍可開、顏色不缺（未加 `colorMode` 的舊圖社社群色）。
8. **手動 QA 清單**（明示在 `pnpm test` 之外，不混入自動驗收）：
   切換不觸發網路請求；圖例文字像分模式且正確；tooltip 顯示時間；分享 URL 帶 `colorMode`，
   新開分頁看到漸層；離線 HTML 不反映漸層（已知限制，非 bug）。

---

*基於 `docs/PRD-v2-意圖.md` §P3、P0 規格與實作、live DB 實測、以及 fresh-agent 一輪審核*
*（findings：`docs/archive/PRD-v2-P3-審核-findings.md`）撰寫。審核 8 條 BLOCKING 全數已寫入上述修正。*