# PRD v2 · P2 多檔比對（規格 v1.0）

**日期**：2026-08-08（實作完稿核對）
**前置**：P0（`source_files[]` 已入 patent 節點與 DB）、P4（視圖層重建與單位指標可直接重用）
**範圍**：來源檔篩選＋依來源著色。**不做** N 張圖並排（v2.1 以後）。

## 1. 目的

老師上傳多批檢索結果（不同關鍵字／不同資料庫抓取）時，要能在同一張圖上回答：

1. **哪個技術概念是「某檔獨有」、哪個是「共同的」** → 依來源檔著色。
2. **單看某一檔，圖長什麼樣**（排除另一檔帶進的干擾） → 來源檔篩選。

## 2. 定案決策

| # | 問題 | 定案 |
|---|---|---|
| S1 | 著色規則 | 概念節點**依其在全部來源檔的出現**著色：恰好一檔→該檔本色（`SOURCE_FILE_COLORS`）；≥2 檔→共享灰紫（`SOURCE_OVERLAP_COLOR`）。著色**永不因篩選改變**（跨檔身份是概念的固有屬性，篩到單檔時仍要能看出「這概念別檔也有」）。 |
| S2 | 篩選語義 | 專利若**任一**來源檔在選取集合 → 納入（多檔並集取任一份）。未選任何檔＝全圖。 |
| S3 | 篩選如何重算 | **純視圖層重建**（不重跑 LLM）：由結構邊（`包含`／`申請了`）重建專利↔概念／專利↔機構索引，只計選中專利 → 概念集、`frequency`（篇）、`applicant_count`（家）、co-occurrence `support_count`（篇）與 `support_applicants`（家）全部重算；`jaccard`／`NPMI`／association strength 用 `computeUnitMetrics` 對子集重算（重測已測函式）。門檻照舊隨單位（Q3/決策 4 不變）。 |
| S4 | 舊圖兼容 | `graph-builder` 已把 `source_files` 帶在 patent 節點、`source_patents` 帶在概念節點（P0），重載圖與新圖共用同一條「結構邊重建」路徑，舊分析 695d1f88 等若只有單來源檔則該功能自然顯示「僅一檔」。 |
| S5 | 三種視圖 | 概念視圖（重建＋著色）、機構視圖（建構式重算）、脈絡視圖（年份交集）都吃同一份 `sourceFiles` 選取。 |
| S6 | URL | `source=<檔案名>` 可重複；`colorMode=source` 獨立序列化。缺省不掛。 |
| S7 | 家單位 | 篩選下「家」門檻／大小也用子集重算的 `support_applicants`／`applicant_count`（Q3 與 S3 同一套）。 |

## 3. 驗收條件

- [x] `sourceFilesOf()`：由專利節點 `source_files` 聯集排序（zh-Hant locale）。
- [x] `applySourceColour`：單檔=檔案色、跨檔=共享色；純函式、不 mutation。
- [x] 概念視圖 sourceFiles 非空 → 子集重建；概念個數、`frequency`、`applicant_count`、cooccurrence support（篇/家）與 minSupport 皆按子集。
- [x] 機構視圖／脈絡圖／共享子集過濾。
- [x] URL round-trip：`source=A&source=B` → `ViewState.sourceFiles=['A','B']`；未選不掛。
- [x] Sidebar：依來源檔是 colorMode 選項（>1 檔才顯示）；來源檔案篩選 checkboxes＋「全部來源」reset。
- [x] 圖例：來源色塊（<=3 檔＋n）與共享灰紫說明。
- [x] 離線 HTML：`parseExportOptions` 接受 `source`／`colorMode=source`，導出的視圖沿用同一 `selectGraphView`（著色已入節點色）。
- [x] 測試：graph-view-p4（著色、篩選重算、家門檻）、view-url；全套 253 綠。
- [x] 瀏覽器（種子多檔）：切「依來源檔」→URL `colorMode=source`；勾 fileB → URL `source=…`、概念數變少、圖例來源 chips；單檔分析顯示「此分析只有一個來源檔」。

## 4. 誠實記限

- 「跨檔類」的共享色以**全量**跨檔為準，篩選後照樣標示跨檔（見 S1 理由）。
- 篩選只**显示层**重建，**沒有**另存一份「子集分析」；戳記/方法圖例對準寫明是全量（決策 4）。P7 PNG 戳記需加「sourceFiles=…」當戳記字段。
- 來源檔是以 `patents.source_files` 字串聯集，不做「檔案歸一」；上傳時檔名不同（如重傳同批）的版本差異不在本版範圍。