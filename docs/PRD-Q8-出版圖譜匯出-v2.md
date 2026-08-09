# PRD-Q8 出版圖譜匯出 v2.0（publication-layout）

**日期**：2026-08-09　**性質**：規格定案（取代 v1 的「高解析度 raster 取向」）
**背景**：Q8 PNG spike（`docs/archive/Q8-PNG-spike-備忘錄.md`）已證實 **A2 canvas 管線技術可行**（凍結 geometry + physics:off + fit + 白底輸出）。gpt 目視審核結論：fail 的不是 renderer，而是 **「Full graph + 全部完整標籤 + 85mm + 可讀字級」此規格本身在物理上不成立**。v2.0 把 Q8 從 raster-resolution 問題改為 **publication-layout 問題**：資訊密度由版面策略控制，**不許用 DPI 補救**（600dpi 只是更清晰的文字重疊圖）。

## §1 核心不變式（invariant）

1. **圖幾何＝凍結的 live 佈局**：匯出吃同一份 `getPositions()`（不可重跑 stabilization；修掉現 buildExportHtml 重跑之 gap，用 spike 已驗證的「注入 positions＋physics:off＋fit()」管線）。
2. **不透明白底**：輸出 canvas 先整面填白再貼圖（live canvas 的 destination-over 合成不可靠，已被實證）。
3. **標籤密度由模式決定，不由像素決定**。
4. **所有「主要概念」判定純機械化**（degree/頻率/社群，從邊即時算出），無 AI/人工。
5. 300/600 dpi 保留為圖紙選項，僅決定實體尺寸，不決定可讀性。

## §2 兩種輸出模式

### M1 Overview Figure（整體知識結構圖）
- 全節點、全邊、社群著色、白底、圖例帶置底、凍結佈局。
- **只標主要節點**（§4），其餘節點無 label（保留形狀/顏色）。
- 圖幅：**180 mm 雙欄為主軸**，85 mm 單欄亦可（同套式，僅主要節點數上限不同）。
- 用途：論文說明整體 KG / prerequisite structure。

### M2 Detailed Figure（局部子圖）
- 由使用者**選一個節點 → 匯出該節點子圖**（hop 範疇預設 2，可選 1）。
- 子圖內**全部節點顯示完整中文 label**（此為全標籤的唯一允許場合）。
- 圖幅：按子圖規模自動建議（≤20–30 節點可 85 mm；更大建議 180 mm）。
- 用途：展示「自動化審核」「金融監理機制」等具體概念名。

## §3 標籤政策與約束

UI 三態：**僅主要概念**（預設）/ **全部概念** / **不顯示**。

| 情境 | 85 mm 單欄 | 180 mm 雙欄 |
|---|---|---|
| M1 + 僅主要 | ✅ | ✅ |
| M1 + 全部 | **禁止**（實體不可行，直接封鎖＋提示改子圖） | 僅當全圖節點數 ≤ 30，否則**封鎖**＋警告 |
| M1 + 不顯示 | ✅（不建議論文使用） | ✅ |
| M2 子圖 ≤ 30 節點 | ✅ 全標 | ✅ 全標 |
| M2 子圖 > 30 節點 | 僅主要 | ✅ 全標 |

封鎖訊息樣本：
> 此圖譜包含 186 個節點，完整顯示所有標籤於目前圖幅會造成文字重疊。建議改用「僅主要概念」或匯出局部子圖（選節點 → 子圖匯出）。

## §4 主要概念判定（機械化，無 AI）

**degree 即時算**（自邊表，render/export 前一次 O(E)），**不新增 DB 欄位**（spike 已確認無現成 degree/root/pin 欄位）。

優先序（依序收, 收滿 K 個即止）：
1. **root 概念**：concept DAG 中入邊=0（無任何 prerequisite 指入）者。
2. **hub**：degree top 3 的全局極高連線節點。
3. **社群代表**：每個 `community_id` 內 degree＋frequency 綜合最高者——保證**每個社群至少一個 label**（顏色與 label 對照，讀者能讀群）。
4. 剩餘額度：依 degree 降序補足。

**K 上限（碰撞 budget，§5 同樣機制決定）**：
- 85 mm：≈ 12–15
- 180 mm：≈ 30–35

## §5 碰撞控制（label collision avoidance）

建立時 **greedy placement**：依 §4 優先序逐個放 label；以 canvas text measurement 量出 bounding box（同 scale 同 font），與「已放置」box 重疊即**隱藏該 label**（次優先讓位）。保證輸出視覺無重疊——目標像素級驗收「任何兩個 label 文字的 ink bbox 不相交」。

## §6 視覺 print-scale

概覽模式（僅 M1）套用視覺下限（與點徑一次到位，**不可只放大字級**）：
- node 直徑 ×1.3–1.5（相對 live）
- edge 寬 ×1.2–1.3
- 已達下限者不縮（max）。
- 密集區降邊 opacity：普通邊 40–60%，先備/主要邊 100%（現在 opacity 本身就是 jaccard-scaled，print 模式套用分層即可）。

## §7 工程拆解（P8 實作面）

1. **export 參數帶 positions**：live 頁 freeze 的 `getPositions()` 隨 export 要求送到 buildExportHtml（現 route 只送 options＋id，缺貼圖）。
2. **label tier 計算**：export/select 時自 edge 表算 root/hub/社群代表（純函數，參 `types/graph.ts:GraphNode/GraphEdge`）。
3. **post-render label 碰撞**：vis-network 無內建 → canvas text measurement + greedy 覆蓋器。
4. **視覺 print-scale**：print 模式覆蓋 node size/edge width/opacity 分層。
5. **匯出 UI 頁**：目前**無 options 頁面**（只有 `/api/export/[id]`；parseExportOptions 預設 mode=concept/colorMode=community/...）→ 需新增 表（mm×dpi、模式 M1/M2、標籤三態、legend、．圖幅 list 85/120/180/自訂）。
6. **警報/封鎖邏輯**：§2 矩陣的檢查（fail-open：超過時警示並建議，85mm+full 直接擋）。

### §7.1 Offline HTML 凍結座標 POST 契約

`POST /api/export/{id}` 需已登入，並使用與 GET 相同的 query 參數。Body 為 `{ "positions": { "<node-id>": { "x": number, "y": number } } }`；座標 node-ID 集合必須與伺服器依該 query 生成的檢視**完全相同**（缺少、額外或非有限座標皆回 `400`）。成功時回傳 `Content-Disposition: attachment` 的離線 HTML，且初始模式使用這份凍結座標。

## §8 驗收判準（spike 資料級：ba3d79e7 = 40 篇／190 節點／428 邊）

1. **M1 180mm**：全節點全邊；label 數 ≤ 35 且任意兩 label ink bbox 不相交（像素級掃描）；白底 100% 不透明；四角白；node 直徑/邊寬符合 print-scale（PX 級驗算）；300dpi metadata；legend 帶完整（篇數/單位/τ/heuristic 字樣，`lib/temporal.ts` 單源常數）。
2. **M1 85mm**：同判準，K ≤ 15。
3. **M2**：選 2 個 hub＋1 個中樞社群節點，子圖（hop 2）全標；任兩 label 不相交；子圖節點數 > 30 時 85mm 被擋、切 180mm 通過。
4. **a200-node 大圖**（500-patent 樣本 ~7k 邊）：overview 可出（K 機制控標籤），全標籤封鎖訊息出現。
5. **凍結**：匯出座標與 live `getPositions()` 全等（max|Δ|=0，spike 已證機制）。

## §9 誠實限界 / 未決（待使用者裁）

- **老師 pin／研究焦點節點**：目前無資料欄位、無 UI 機制 → v2 不列；若老師要，需 P8+ 加「pin 節點」功能再註進優先序。
- 120mm 圖幅沿用（同一 layout 矩陣，只是 K 介於 85/180 之間）。
- 全 600dpi 不解決 density（實體驗收只跑 300；600 與 300 同一機制，尺寸 2×）。
- 離線 HTML 匯出目前 still 跑 stabilization：P8 一併修掉（改注入凍結 positions）。

## §10 優先序建議

1. **M1 Overview（85/180mm、僅主要標籤、碰撞、print-scale）** — 最貼近老師實際需求。
2. **M2 Subgraph（hop 1/2 全標籤）**。
3. UI 頁面＋封鎖矩陣。
→ 排程待使用者確認後進 planning。