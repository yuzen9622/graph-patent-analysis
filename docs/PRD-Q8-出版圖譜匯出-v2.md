# PRD-Q8 出版圖譜匯出 v2.1（publication-layout）

**日期**：2026-08-09　**性質**：規格修訂（取代 v1 的「高解析度 raster 取向」）　**狀態**：規格已修訂；除 canonical frozen Offline HTML POST foundation 已完成外，所有 publication implementation 依使用者指示 **PAUSED**。
**背景**：Q8 PNG spike（`docs/archive/Q8-PNG-spike-備忘錄.md`）已證實 **A2 canvas 管線技術可行**（凍結 geometry + physics:off + fit + 白底輸出）。gpt 目視審核結論：fail 的不是 renderer，而是 **「Full graph + 全部完整標籤 + 85mm + 可讀字級」此規格本身在物理上不成立**。v2.1 把 Q8 從 raster-resolution 問題改為 **publication-layout 問題**：資訊密度由版面策略控制，**不許用 DPI 補救**（600dpi 只是更清晰的文字重疊圖）。

## §1 核心不變式（invariant）

1. **匯出重現點擊時的 active live mode**：canonical Offline HTML UI export 是已登入 POST，吃 active live `getPositions()`，不可重跑 layout。初始 active exported mode 使用完全相同的凍結座標、`physics:false`，不做 stabilization。
   - 正常 `mode=concept` 的**預設概念視圖**必須保留 community pre-spread + ForceAtlas2 的 community-cluster geometry；匯出不得套用 temporal median-year Y-band。
   - **時序衍生匯出**只可在使用者明確選擇未來的 temporal mode 時存在；目前 temporal UI mode 未實作，canonical UI／export 路徑不得靜默切換。離線 HTML 僅序列化並呈現 active mode；缺少該 mode 的 frozen snapshot 時會顯示錯誤，不會 temporal/stabilized fallback。`GET /api/export/{id}` 已改為 `405`（`Allow: POST`），並指示使用分析頁的「離線 HTML」按鈕。
2. **不透明白底**：輸出 canvas 先整面填白再貼圖（live canvas 的 destination-over 合成不可靠，已被實證）。
3. **標籤密度由模式決定，不由像素決定**。
4. **所有「主要概念」判定純機械化**（degree/頻率/社群，從邊即時算出），無 AI/人工。
5. 300/600 dpi 保留為圖紙選項，僅決定實體尺寸，不決定可讀性。

## §2 兩種輸出模式（PAUSED／未實作）

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

## §3 標籤政策與約束（PAUSED／未實作）

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

## §4 主要概念判定（機械化，無 AI；PAUSED／未實作）

**degree 即時算**（自邊表，render/export 前一次 O(E)），**不新增 DB 欄位**（spike 已確認無現成 degree/root/pin 欄位）。

優先序（依序收, 收滿 K 個即止）：
1. **root 概念**：concept DAG 中入邊=0（無任何 prerequisite 指入）者。
2. **hub**：degree top 3 的全局極高連線節點。
3. **社群代表**：每個 `community_id` 內 degree＋frequency 綜合最高者——保證**每個社群至少一個 label**（顏色與 label 對照，讀者能讀群）。
4. 剩餘額度：依 degree 降序補足。

**K 上限（碰撞 budget，§5 同樣機制決定）**：
- 85 mm：≈ 12–15
- 180 mm：≈ 30–35

## §5 碰撞控制（label collision avoidance；PAUSED／未實作）

建立時 **greedy placement**：依 §4 優先序逐個放 label；以 canvas text measurement 量出 bounding box（同 scale 同 font），與「已放置」box 重疊即**隱藏該 label**（次優先讓位）。保證輸出視覺無重疊——目標像素級驗收「任何兩個 label 文字的 ink bbox 不相交」。

## §6 視覺 print-scale（PAUSED／未實作）

概覽模式（僅 M1）套用視覺下限（與點徑一次到位，**不可只放大字級**）：
- node 直徑 ×1.3–1.5（相對 live）
- edge 寬 ×1.2–1.3
- 已達下限者不縮（max）。
- 密集區降邊 opacity：普通邊 40–60%，先備/主要邊 100%（現在 opacity 本身就是 jaccard-scaled，print 模式套用分層即可）。

## §7 工程拆解（P8 實作面）

1. **DONE — UI POST positions（active mode only）**：live 頁在點擊匯出時以 `getPositions()` 將 active live positions POST 到 `buildExportHtml`；離線 HTML 僅呈現 active mode，採凍結座標 + `physics:false`，缺少 snapshot 即 hard-gate 顯示錯誤，沒有 temporal/stabilized fallback。`GET /api/export/{id}` 不再輸出檔案，會以 `405`／`Allow: POST` 指示使用分析頁的「離線 HTML」按鈕。
2. **PAUSED／未實作 — label tier 計算**：export/select 時自 edge 表算 root/hub/社群代表（純函數，參 `types/graph.ts:GraphNode/GraphEdge`）。
3. **PAUSED／未實作 — post-render label 碰撞**：vis-network 無內建 → canvas text measurement + greedy 覆蓋器。
4. **PAUSED／未實作 — 視覺 print-scale**：print 模式覆蓋 node size/edge width/opacity 分層。
5. **PAUSED／未實作 — 匯出 UI 頁**：目前無 publication options 頁面；未來才處理 mm×dpi、M1/M2、標籤三態、legend 與 85/120/180/自訂圖幅。
6. **PAUSED／未實作 — 警報/封鎖邏輯**：§2 矩陣的檢查（fail-open：超過時警示並建議，85mm+full 直接擋）。

### §7.1 Offline HTML 凍結座標 POST 契約（DONE）

- Canonical UI 路徑是需已登入的 `POST /api/export/{id}`。點擊匯出時從 **active live view** 的 `getPositions()` 擷取 positions，包含使用者手動拖曳後的座標；`GET /api/export/{id}` 固定回 `405`／`Allow: POST`，並指示使用分析頁的「離線 HTML」按鈕。
- Body 為 `{ "positions": { "<node-id>": { "x": number, "y": number } } }`；座標 node-ID 集合必須與伺服器依該 query 生成的 active view **完全相同**。Body 有效大小上限為 **8 MiB**。
- malformed JSON／body／position，或缺少、額外、非有限座標與 ID mismatch 都回 `400`；超過 8 MiB 回 `413`。
- 成功時回傳 `Content-Disposition: attachment` 的離線 HTML，且只含 active mode。該 mode 使用**精確** frozen coordinates、`physics:false`、無 stabilization；相對點擊時的 active live positions 必須 `max|Δ|=0`。若無 snapshot，runtime 顯示錯誤並停止，不會計算 fallback layout。

## §8 驗收判準（publication work PAUSED；frozen POST foundation 有效回歸）

1. **M1 180mm**：全節點全邊；label 數 ≤ 35 且任意兩 label ink bbox 不相交（像素級掃描）；白底 100% 不透明；四角白；node 直徑/邊寬符合 print-scale（PX 級驗算）；300dpi metadata；legend 帶完整（篇數/單位/τ/heuristic 字樣，`lib/temporal.ts` 單源常數）。
2. **M1 85mm**：同判準，K ≤ 15。
3. **M2**：選 2 個 hub＋1 個中樞社群節點，子圖（hop 2）全標；任兩 label 不相交；子圖節點數 > 30 時 85mm 被擋、切 180mm 通過。
4. **a200-node 大圖**（500-patent 樣本 ~7k 邊）：overview 可出（K 機制控標籤），全標籤封鎖訊息出現。
5. **Canonical frozen export regression**：預設概念匯出的 visual/community-cluster layout 必須對應點擊時的 live 預設概念視圖，且與 active live `getPositions()` 全等（`max|Δ|=0`）；除非使用者明確選擇未來 temporal mode，否則不得出現 horizontal year bands 或套用 temporal Y-band。

## §9 誠實限界 / 已知 debt

- **老師 pin／研究焦點節點**：目前無資料欄位、無 UI 機制 → v2 不列；若老師要，需 P8+ 加「pin 節點」功能再註進優先序。
- 120mm 圖幅沿用（同一 layout 矩陣，只是 K 介於 85/180 之間）。
- 全 600dpi 不解決 density（實體驗收只跑 300；600 與 300 同一機制，尺寸 2×）。
- **已校正 — GET guidance**：Canonical Offline HTML UI export 是 POST；`GET /api/export/{id}` 立即回 `405`／`Allow: POST`，並指示使用分析頁的「離線 HTML」按鈕。
- **已校正 — single-mode frozen export**：離線 HTML 只序列化並呈現 active mode；缺少 active snapshot 即顯示錯誤並停止，沒有 temporal/stabilized fallback 或非初始 mode 切換。
- **已校正 — ordinary concept legend**：`GraphLegend` 在正常概念模式不再印 temporal legend；該 prose 保留給未來明確 temporal mode。

## §10 暫停狀態與恢復後順序

**目前沒有 active schedule。** 除已完成的 frozen Offline HTML POST foundation 外，所有 publication work（PNG、labels、M1/M2、K、collision、print-scale、options page、警報／封鎖）均依使用者指示 **PAUSED**。

僅在使用者明確恢復此工作後，才以下列順序重新確認並進入 planning（不是目前排程）：
1. M1 Overview（85/180mm、僅主要標籤、碰撞、print-scale）。
2. M2 Subgraph（hop 1/2 全標籤）。
3. options UI 頁面與封鎖矩陣。
