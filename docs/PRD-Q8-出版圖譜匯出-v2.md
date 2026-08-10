# PRD-Q8 出版圖譜匯出 v2.1（publication-layout）

**日期**：2026-08-09（2026-08-10 更新現況，見 §0/§10）　**性質**：規格修訂（取代 v1 的「高解析度 raster 取向」）　**狀態**：M1 Overview 與 M2 Subgraph **皆已實作**（含 mm 自訂／120mm／300/600dpi 選項），frozen Offline HTML POST foundation 維持有效。**唯一未完成的是像素級視覺驗收**（見 §0/§8）——工程環境沒有瀏覽器，無法實際看輸出圖片，邏輯依單元測試驗證，尚未經人眼/像素掃描確認。
**背景**：Q8 PNG spike（`docs/archive/Q8-PNG-spike-備忘錄.md`）已證實 **A2 canvas 管線技術可行**（凍結 geometry + physics:off + fit + 白底輸出）。gpt 目視審核結論：fail 的不是 renderer，而是 **「Full graph + 全部完整標籤 + 85mm + 可讀字級」此規格本身在物理上不成立**。v2.1 把 Q8 從 raster-resolution 問題改為 **publication-layout 問題**：資訊密度由版面策略控制，**不許用 DPI 補救**（600dpi 只是更清晰的文字重疊圖）。

## §0 現況（2026-08-10）

本節以下的 §1–§9 是規格文件，記錄「該怎麼設計」的技術決策，**內容本身沒有改動**。這裡補充「實際做了什麼」，避免文件跟現況對不上。

- **輕量版 PNG 匯出（已上線）**：不是本文件的 M1/M2 規格，是另一條更便宜的路——直接讀 vis-network 目前畫出來的 canvas（`components/GraphViewer.tsx` 的 `captureNetworkImage`），貼到白底畫布上輸出，沒有自動標籤分級／碰撞避讓／print-scale。使用者自己用既有篩選/縮放喬好畫面再按「匯出圖片」，系統忠實拍照。跟 M1/M2 是並存的兩個按鈕，各自獨立。
- **比較模式（試做版，已上線）**：同一份分析裡，左右兩側各自選來源檔子集並排顯示，「匯出圖片」在此模式下把兩張畫面併成一張 PNG。這是 `docs/PRD-v2-P2-多檔比對.md` 明講「不做（v2.1 以後）」的「N 張圖並排」功能，範圍縮小到「兩張、來源檔篩選、匯出時合併」；跟出版圖（M1/M2）互斥——比較模式開啟時「出版圖」按鈕停用，兩者都假設單一 view。
- **M1 Overview（已實作）**：§2–§7 全部落地，見 §7 逐項狀態。
- **M2 Subgraph（已實作）**：畫布上點一個節點當中心、選 1/2 hop，子圖一律全標籤；跟 M1 共用同一個選項面板（`components/PublicationExportPanel.tsx`），用頂端 M1/M2 切換。
- **圖幅／dpi 已一般化**：85/120/180mm 為快捷值，另可輸入任意 mm；85/180mm 是規格錨點（精確對齊 §4/§3 的數字），其餘寬度依 §9 的說法線性內插（K 上限、全標籤封鎖門檻皆然）；dpi 提供 300/600 兩檔。
- **§3 封鎖矩陣改為示警＋opt-in**：不再直接擋死按鈕，因為碰撞避讓本來就會自動省略重疊標籤、不會畫出疊字的圖；使用者勾選「我了解可能被省略」後仍可產生，下載後回報實際放上幾個／省略幾個（`requestedLabels`／`placedLabels`）。
- **邊透明度疊上既有的 support-strength heuristic**：非另立一套跟活體檢視脫鉤的印刷專用透明度，而是在 `edge.opacity`（`lib/temporal.ts` 的 τ=5 heuristic，單源常數）之上疊加主要/非主要邊的分層；輸出圖片的說明文字也直接引用 `TEMPORAL_OPACITY_LINE`，不重複手打。
- 以上皆是**獨立的匯出功能**，只在匯出當下讀取目前的篩選/佈局結果，**不會**改動 `selectGraphView`／既有的圖譜設定狀態；離開匯出面板、篩選條件、URL 分享都跟以前一樣。
- **唯一沒做的**：像素級視覺驗收（§8）。純邏輯（degree/root/hub/社群代表、mm↔px、封鎖門檻、hop BFS）都有單元測試（`tests/publication-export.test.ts`，24 案例），但「輸出圖片實際長怎樣、字級是否合理、有沒有意外的視覺瑕疵」需要瀏覽器才能看到——這個工作環境沒有瀏覽器，無法自行驗證，需要你實際下載後回饋。

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
2. **DONE — label tier 計算**：`lib/publication-export.ts` 的 `selectPrimaryLabels`／`computeDegrees`，純函數、export 當下即時從目前檢視的節點/邊算 root（概念 DAG 入邊=0 且有出邊）/hub（全局 degree 前 3）/社群代表（每 community_id 內 degree+frequency 最高）/依 degree 補滿，單元測試見 `tests/publication-export.test.ts`。
3. **DONE — post-render label 碰撞**：`components/GraphViewer.tsx` 的 `renderPublicationFigure`，canvas `measureText` 量 bounding box + 依優先序貪婪覆蓋（後放的與已放置的重疊就跳過，不落地標籤）。**未做像素級掃描測試**，只手動核對邏輯——這是目前唯一還沒驗過的部分，見 §8。
4. **DONE — 視覺 print-scale**：`renderPublicationFigure` 套用 `PRINT_NODE_SCALE`(1.4)／`PRINT_EDGE_SCALE`(1.25)；邊透明度疊在既有 `edge.opacity`（`lib/temporal.ts` 的 τ=5 heuristic，單源常數）之上——非主要邊封頂在 50%、主要邊（兩端皆有標籤）維持 100%，不是另立一套跟活體檢視脫鉤的印刷專用透明度。字級為相對圖幅內容縮放的近似值，非嚴格依字體度量校正，**未做**視覺驗收。
5. **DONE — 匯出 UI 頁（面板形式，非獨立頁面）**：`components/PublicationExportPanel.tsx`，M1/M2 切換、85/120/180mm 快捷值＋自訂 mm 輸入、300/600dpi、標籤三態（M2 強制全標籤並隱藏此選項）。**仍非獨立頁面**，是頭列按鈕觸發的下拉面板；legend 說明文字已引用 `lib/temporal.ts` 的 `TEMPORAL_OPACITY_LINE`（單源常數），但不含完整的 τ 逐項推導文字。
6. **DONE，但偏離 §3 原設計 — 警報邏輯（2026-08-10 由硬擋改為示警＋opt-in）**：`isFullLabelBlocked`／`fullLabelBlockedMessage` 仍實作 §3 矩陣邏輯（85/180mm 為錨點，其餘寬度線性內插判斷門檻，§9 已預告 120mm 如此處理），但**不再直接擋死按鈕**——因為碰撞避讓（item 3）本來就會自動省略重疊標籤、不會畫出疊字的圖，所以改成面板顯示警告 + 「我了解可能被省略，仍要產生」勾選框，產生後 `renderPublicationFigure` 回報 `requestedLabels`／`placedLabels`，畫面上顯示「已放置 X/Y 個標籤」讓使用者知道實際省略了多少。
7. **DONE — M2 局部子圖**：`lib/publication-export.ts` 的 `subgraphNodeIds`（純函數 BFS，單元測試涵蓋 hop=1/2、孤立節點、雙向連通）+ `renderPublicationFigure` 的 `mode: 'subgraph'` 分支：收斂節點/邊到子圖範圍、強制全標籤、沿用同一套碰撞避讓與封鎖判斷（子圖節點數對 85mm 一樣可能觸發示警）。UI 上：先在畫布點一個節點，開出版圖面板選「M2 局部子圖」會自動抓該節點當中心，另選 1/2 hop。

### §7.1 Offline HTML 凍結座標 POST 契約（DONE）

- Canonical UI 路徑是需已登入的 `POST /api/export/{id}`。點擊匯出時從 **active live view** 的 `getPositions()` 擷取 positions，包含使用者手動拖曳後的座標；`GET /api/export/{id}` 固定回 `405`／`Allow: POST`，並指示使用分析頁的「離線 HTML」按鈕。
- Body 為 `{ "positions": { "<node-id>": { "x": number, "y": number } } }`；座標 node-ID 集合必須與伺服器依該 query 生成的 active view **完全相同**。Body 有效大小上限為 **8 MiB**。
- malformed JSON／body／position，或缺少、額外、非有限座標與 ID mismatch 都回 `400`；超過 8 MiB 回 `413`。
- 成功時回傳 `Content-Disposition: attachment` 的離線 HTML，且只含 active mode。該 mode 使用**精確** frozen coordinates、`physics:false`、無 stabilization；相對點擊時的 active live positions 必須 `max|Δ|=0`。若無 snapshot，runtime 顯示錯誤並停止，不會計算 fallback layout。

## §8 驗收判準（M1 試做版：僅純邏輯單元測試；M2／視覺級驗收尚未做）

1. **M1 180mm**：全節點全邊；label 數 ≤ 35 且任意兩 label ink bbox 不相交（像素級掃描）；白底 100% 不透明；四角白；node 直徑/邊寬符合 print-scale（PX 級驗算）；300dpi metadata；legend 帶完整（篇數/單位/τ/heuristic 字樣，`lib/temporal.ts` 單源常數）。
   - **實際狀態**：mm→px 換算、封鎖矩陣、主要概念判定優先序皆有單元測試（`tests/publication-export.test.ts`，24 案例）。legend 已含篇數/單位/方法/座標免責聲明/`TEMPORAL_OPACITY_LINE`（單源引用，非手打）。碰撞避讓演算法邏輯已寫，但**沒有**像素級掃描測試驗證「任兩 label 不相交」，也沒有實際看過輸出圖片。
2. **M1 85mm**：同判準，K ≤ 15。同上，邏輯已做，視覺驗收未做。
3. **M2**：選 2 個 hub＋1 個中樞社群節點，子圖（hop 2）全標；任兩 label 不相交；子圖節點數 > 30 時 85mm 被擋、切 180mm 通過。
   - **實際狀態**：功能已實作（`subgraphNodeIds` + `renderPublicationFigure` 的 subgraph 分支），BFS 邏輯有單元測試（hop=1/2、孤立節點、雙向連通）。「選 2 個 hub＋1 個中樞社群節點」這種具體情境、以及碰撞/封鎖在真實子圖上的視覺結果，**未實測**——同樣卡在沒有瀏覽器。
4. **a200-node 大圖**（500-patent 樣本 ~7k 邊）：overview 可出（K 機制控標籤），全標籤封鎖訊息出現。**未實測**（沒有這個規模的樣本資料可驗，也沒有瀏覽器可以跑）。
5. **Canonical frozen export regression**：預設概念匯出的 visual/community-cluster layout 必須對應點擊時的 live 預設概念視圖，且與 active live `getPositions()` 全等（`max|Δ|=0`）；除非使用者明確選擇未來 temporal mode，否則不得出現 horizontal year bands 或套用 temporal Y-band。此為離線 HTML 既有回歸，未受本次變更影響。

## §9 誠實限界 / 已知 debt

- **老師 pin／研究焦點節點**：目前無資料欄位、無 UI 機制 → v2 不列；若老師要，需 P8+ 加「pin 節點」功能再註進優先序。
- 120mm 圖幅：**已支援**，跟 85/180mm 用同一條內插公式（`primaryLabelCap`／`isFullLabelBlocked`），不是另外寫死的第三組數字。
- 600dpi：**已支援**（面板可選 300/600dpi），仍遵守§0 的原則——不解決 density，只是同一張圖放大兩倍，不會讓「全部標籤」在小圖幅下變得可行。
- **已校正 — GET guidance**：Canonical Offline HTML UI export 是 POST；`GET /api/export/{id}` 立即回 `405`／`Allow: POST`，並指示使用分析頁的「離線 HTML」按鈕。
- **已校正 — single-mode frozen export**：離線 HTML 只序列化並呈現 active mode；缺少 active snapshot 即顯示錯誤並停止，沒有 temporal/stabilized fallback 或非初始 mode 切換。
- **已校正 — ordinary concept legend**：`GraphLegend` 在正常概念模式不再印 temporal legend；該 prose 保留給未來明確 temporal mode。
- **M1/M2 新增限界**（截至 2026-08-10）：
  - 「root 概念」判定用 P6 的 `temporal_directed`（中位年排序），只有共現邊會被標方向，語意邊完全不算入 degree/root/hub；圖幅小、方向資訊稀疏時 root 名單可能是空的（正常，會落到 hub/社群代表/補滿接手）。
  - print-scale 的字級／說明文字字級是相對圖幅內容縮放的近似值，不是嚴格依字體度量校正過的絕對字級——**沒有瀏覽器可實際比對輸出**，這是本輪唯一沒做到規格要求的部分，需要你實際下載後回饋，我再依你回饋調整 `components/GraphViewer.tsx` 的 `CAPTION_FONT_PX`、`renderPublicationFigure` 內的 `fontPx` 公式。
  - 只支援單一 view（跟離線 HTML 一樣，比較模式下停用）。
  - §3／§9 的封鎖矩陣改成「示警＋opt-in」而非硬擋（見 §7 item 6）——這是刻意偏離規格原文的決定，理由已寫在該處。

## §10 現況與後續順序（2026-08-10 更新）

**M1 Overview 與 M2 Subgraph 皆已實作**（見 §7 items 2–7），含 mm 自訂／120mm／300/600dpi，frozen Offline HTML POST foundation 也維持有效。**規格內容已無 PAUSED 項目**——剩下的缺口是 §8/§9 講的「像素級視覺驗收」，不是功能沒做，是沒有瀏覽器可以看輸出結果。

後續建議：
1. ~~M1 Overview~~ ~~M2 Subgraph~~ **皆已完成**，等你實際下載出版圖後回饋視覺問題（字級、留白、標籤位置），我再照回饋調參數。
2. 若要做到 §8 完整的像素級掃描驗收，需要一個能跑瀏覽器（或至少 canvas + 字型渲染）的測試環境，目前的純邏輯單元測試已是這個工作環境能做到的上限。
3. 完整獨立的 options 頁面（目前是頭列面板，非獨立路由）、§2 矩陣的完整互動式警示（目前只有一行文字＋checkbox）——這兩項優先度較低，非老師明確要求不建議再擴大範圍。
