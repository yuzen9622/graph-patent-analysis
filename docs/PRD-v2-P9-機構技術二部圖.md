# PRD v2 / P9：機構–技術二部圖（⛔ 已廢止，僅存為記錄）

> ## ⛔ 2026-08-10 廢止
>
> **本規格不實作。** 使用者確認老師的實際需求是 **(a) 把「時間」與「單位（篇／家）」在畫面上標示清楚** ＋ **(b) 產出可放進論文的表格**，不是新增一張圖。
>
> 廢止理由（三點，都在寫規格與審核過程中查證過）：
>
> 1. **②承諾的問題，現有視圖已可回答**：「哪個技術競爭者最多」＝概念視圖切「家」單位，節點大小已是機構家數（`selectConceptView`，unit=applicant 分支）；「哪些公司學校都在做同一技術」＝機構網路圖的邊已帶 `shared_concepts` 清單（`selectInstitutionView`）。
> 2. **兩欄固定 Y 排序（原 D1(a)＋D5(a)）是錯誤的設計建議**：§4.5.3 的幾何推算顯示它在 label 可讀的前提下一屏只容納 11–15 個概念（186 個概念需約 13,400 canvas 單位高），且此排版在專利／文獻計量領域並非慣例——VOSviewer／CiteSpace／Gephi 均不提供，兩欄式 bipartite layout 是通用繪圖慣例（如 NetworkX `bipartite_layout`），用於數十節點的小圖。
> 3. **需求源頭誤讀**：把「三圖收斂」的②直接當成「必須新做一張圖」，未先確認該圖是否必要。
>
> **本檔保留的價值**（後續期別仍應參考，不要重新踩）：
>
> - §4.5.1 **Y 塌陷**失敗模式與示意圖：任何把節點 Y 設成某個量的函數的排版都會踩到（實據 `.orca/drops/live3-fullfit-current.png`）。
> - §2 對 I1 的註記：`selectConceptViewFiltered` 篩選後不重算社群，是**既有全域 debt**，非任何新期引入。
> - **兩個與 P9 無關、獨立存在的既有缺陷**（值得單獨修）：
>   1. `minSupport` 是 `GraphLayout` 的單一共用 state、`selectMode` 不重設 → 在概念視圖設「≥8 家」切到機構網路會靜默變成「≥8 個共享概念」並清空畫面。
>   2. `GraphViewer` 的 `onPositionSnapshotProvider` 只在 `stabilizationIterationsDone` 內註冊 → 任何 `physics:false` 的視圖永遠拿不到座標 snapshot，離線匯出必定 hard-gate 失敗。
>
> 以下原文全部保留，**其中的 D1–D10 決策一律失效**。

---

**日期**：2026-08-10
**狀態**：⛔ **已廢止（2026-08-10），不實作。** 見檔首廢止說明。
**前置**：P0（資料層）、P1（同義詞）、P4（關聯度與分析單位）、P5（IPC）、P6（I1–I5 invariant）、P8（離線匯出契約）
**上位需求**：`docs/PRD-v2-意圖.md` 決策 8（分析主單位＝機構）＋ 老師 2026-08-09 拍板「三圖收斂」之②（出處：`docs/PRD-v2-P6-時序關聯.md` §1 表格）
**名稱**：機構–技術二部圖（Institution–Technology Bipartite Graph），URL `mode=bipartite`

> **狀態聲明**：D1–D9 已於 2026-08-10 拍板（§12）。**D10 未決**——把 D1(a)＋D5(a) 的座標算成具體數字後（§4.5.3）發現「一欄一列＋label 可讀」一屏只容納 11–15 個概念，需先決定版面策略才能實作排版。D4 的邊數上限**數值**須實作後以開發樣本實測回填，不得憑猜測寫死。
>
> **已排除的做法不列為待決選項**：任何違反上位已定案 invariant（P6 I1／I4、意圖決策 1／7／8）的做法一律進 §12.1「已排除」並附理由，不當成可拍板的選項——否則實作者可能依「拍板」產出已知違反 invariant 的版本。要重開 invariant 必須先在 `docs/PRD-v2-意圖.md` 另行拍板。

---

## 1. 範圍與目的

回答老師三問（P6 §1 表格②）：**哪間學校做哪些技術、哪些公司學校做相同技術、哪個技術競爭者最多**。

**做**：新增第四個 view mode `bipartite`——機構（applicant）↔ 概念（concept）二部圖。純 view 層由結構邊重建（比照既有 `selectInstitutionView`），不重跑 LLM、不加 DB 欄位、無 migration。含兩側節點編碼、邊語意與門檻、排版、篩選繼承、離線匯出、單元測試。

**不做**：機構↔機構共享概念邊（那是既有 `institution` view，本圖明確不混入）；概念↔概念共現邊（`concept` view）；三層脈絡（`context` view）；時序 layout（P6）；概念對指標的重新定義；機構分類治理層（§8；D2 定案 A → **不納入本期**，另立一期）。

### 1.1 與既有三個 mode 的分工

| 模式                | 節點           | 邊                | 回答                        | 為何不能取代本圖                            |
| ------------------- | -------------- | ----------------- | --------------------------- | ------------------------------------------- |
| `concept`           | 概念           | 概念↔概念共現     | 技術地圖、技術彼此的關聯    | 看不到「誰在做」                            |
| `context`           | 機構→專利→概念 | 三層結構邊        | 單一專利／機構的完整脈絡    | 無聚合的「機構×技術」對照，專利層會把圖撐爆 |
| `institution`       | 機構           | 機構↔機構共享概念 | 兩家機構共同投入多少技術    | 看不到「哪個技術被誰做」                    |
| `bipartite`（本圖） | 機構 ∪ 概念    | 機構↔概念「投入」 | 機構×技術對照、技術的競爭者 | —                                           |

判斷守則：問「誰在做什麼」→ `bipartite`；問「兩家共享多少」→ `institution`；問「技術之間的關係」→ `concept`。

---

## 2. 繼承的 invariant（強制）

- **I1 — Cohort consistency（最高優先）**：本圖所有統計與視覺編碼（機構涉足概念數、概念持有機構家數、邊權重、節點大小、tooltip 統計）皆自同一 `analysis_scope` 重建。任何篩選改變 cohort 即全量重算（沿用 `selectedRawIds` 與 `scopeIdOf`）。
  - **既有全域例外（非 P9 引入）**：`selectConceptViewFiltered` 在有篩選時只重算成員數與指標，`community_id`／`community_id_applicants` 仍沿用建圖時的全量社群、不在 cohort 內重跑 Louvain。這是既有 concept view 的行為，屬**全域 debt**，不是 P9 新問題。P9 只裁決是否沿用該既有例外（D9），**不得**在本期單獨為二部圖跑 cohort Louvain——那會讓同一顏色在兩張圖代表不同社群，違反意圖決策 7。
- **I4 — Encoding separation**：本圖唯一可編碼的資料量是邊的支持篇數；寬度與不透明度**不得雙重編碼同一變數**（見 §4.4）。citation 層不適用（本圖無概念對邊，`citation_edges` 恆空）。
- **決策 1 — 距離不賦予語意**：`layout_distance_interpretation` 維持 `visual_only`。兩側座標只為閱讀，任何軸不對應關聯強度；圖例必須明載「距離不表示投入強度，請看邊不透明度／數值」。
- **決策 8 — 主單位＝機構（家）**：概念側的節點量一律用家數；篇只出現在邊權重與下鑽 tooltip。
- **I2／I3**：本圖無時間箭頭；tooltip 的 `median_year` 等僅供下鑽，任何排序不得以時間打破 tie。

---

## 3. 本期基準決策（B1–B7）

以下為本期基準。D1／D2／D3／D8 已拍板（§12），B4 由 I4 強制。

| #   | 項目       | 基準                                                                                                                                                                                                                                                |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | 模式地位   | 新增第四 mode `bipartite`，不取代其餘三者（§1.1）                                                                                                                                                                                                   |
| B2  | 邊語意     | 邊＝「該機構的專利中有幾篇包含該概念」。`kind='bipartite'`、`relation='投入'`、`support_count = weight` ＝該機構專利集與該概念專利集的交集大小（見 §4.2）。**不套用**概念對指標（jaccard／NPMI／association strength），**也不發明**機構↔概念的變體 |
| B3  | 節點編碼   | 機構側 `concept_count`＝涉足概念數、`org_type`、色＝機構類型色；概念側 `applicant_count`＝持有機構家數、色見 D9。形狀沿用既有規則（機構 star、概念 dot）                                                                                            |
| B4  | 邊視覺     | 寬度固定；`opacity = supportStrengthOpacity(s)`（`lib/temporal.ts` 既有函式，τ=5 視覺 heuristic）。由 I4 強制（§4.4）                                                                                                                               |
| B5  | 排版       | **兩欄固定座標＋`physics:false`（D1(a) 定案）**，且**必須同步修正 snapshot provider 的註冊時機**（§9.1，否則離線匯出永遠拿不到座標）                                                                                                                |
| B6  | 篩選繼承   | source／IPC／year 沿用 `selectedRawIds`；`unit`／`edgeWeight`／`showSemantic`／`showCitations`／`colorMode='ipc'` 在本 mode 無意義 → disable（§5）                                                                                                  |
| B7  | 門檻 state | `minSupport` 在各 mode 語意不同 → **門檻改為 per-mode 保存**（§4.3）                                                                                                                                                                                |

---

## 4. 圖的定義

### 4.1 節點

由結構邊（`申請了`：applicant→patent；`包含`：patent→concept）在 active cohort 內重建：

- **機構側**（`type='applicant'`）：`concept_count`＝該機構涉足的概念數；涉足概念為空集者剔除；`size` 沿用既有 `applicantSize` 家族的 √ 壓縮，`org_type = institutionTypeOf(label)`（D2 定案 A：沿用規則式）。
- **概念側**（`type='concept'`）：`applicant_count`＝持有該概念的機構家數；無持有者者剔除；`size` 依家數。
- 兩側皆帶 `scope_id`（I1）。

### 4.2 邊

`patents(A) ∩ patents(C) ≠ ∅` 即建邊，權重為交集篇數。全量計算，`minSupport` 只做顯示過濾（承 P4 Q4：指標門檻前算、門檻只過濾顯示）。

### 4.3 `minSupport` 語意（本圖關鍵裁決）

**本 mode 的 `minSupport` ＝「該機構至少以 N 篇專利投入該概念」**，過濾 `s(A,C) ≥ N`。

- **UI 標籤必須顯示「≥ N 篇」**，不得沿用概念視圖家單位的「≥N 家」，也不得沿用 `institution` view 的「共同投入 ≥N 個概念」文案——三者語意完全不同，共用字串會直接誤導。
- 決策 8 說主單位是家，但**邊的量本質是篇**：一家機構對一個概念的關係強度只能用篇數衡量（家數在此恆為 1）。家單位體現在概念側節點大小，不是邊。這是本圖與 P4 家單位語意的分界，必須在圖例寫明。

**門檻 state 必須改成 per-mode（B7）**：`minSupport` 目前是 `GraphLayout` 的**單一共用 state**，`selectMode` 只清 `selectedNode`／`selectedEdge`，不重設門檻。因此在概念視圖設 `minSupport=8`（家）後切到二部圖，會**靜默變成「≥ 8 篇」**並一次打掉大量邊與節點，使用者會誤以為「二部圖沒資料」。

- 定案：**門檻按 mode 分別保存**（切回原 mode 還原該 mode 的值），新 mode 首次進入用該 mode 的預設（二部圖預設 1）。
- 這是**既有缺陷**：`concept`（≥N 篇／家）↔ `institution`（≥N 個共享概念）之間已經有同一問題。P9 修正該 state 結構時順帶修好三者，但**不得改變既有三 view 在同一門檻值下的輸出**（§14 禁止修改範圍）。

### 4.4 視覺編碼與 I4

寬度固定、opacity 映射篇數（B4）。理由：本圖唯一可用的量是篇數，若寬度與 opacity 都映射它即違反 I4；固定寬度是唯一不發明公式又不違 I4 的選擇。**「寬度也映射篇數」已列入 §12.1 已排除，不是可拍板選項。**

### 4.5 排版

二部圖必須兩側**視覺分離**才可讀，而 ForceAtlas2 無法保證分離（機構會被投入邊拉進概念群中）。**定案（D1(a)）：兩欄固定座標。**

### 4.5.1 必須避免的失敗模式：Y 塌陷

**這是本節存在的唯一理由，實作前必讀。** 若把「依家數遞減」實作成 **Y ＝ 家數的函數**，家數相同的概念會拿到同一個 Y，全部擠成一條水平線、標籤重疊糊成一團：

```
        ✗ 錯誤：Y = f(家數)
家數 3 → Y=200   ●●●●●●●●●●●●                     ← 12 個概念同一列
家數 2 → Y=300   ●●●●●●●●●●●●●●●●●●●●●●●●●●       ← 26 個
家數 1 → Y=400   ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●● ← 80+ 個，標籤全糊
```

開發樣本 186 個概念、家數集中在 1–3，照此實作會得到 3 條無法閱讀的橫線。此失敗模式**已有實據**（見 `.orca/drops/live3-fullfit-current.png`：同一 Y 值的節點被壓成水平帶、標籤互相覆蓋）。

**正確做法：Y ＝ 排序後的列號，一列一個節點。** 家數只決定**排序**，不決定座標：

```
        ✓ 正確：Y = 列號 × ROW_PITCH
   左欄（機構）                  │      右欄（概念）
                                │
列 0   ○ 國泰金控 ───────────────┼───── ● 區塊鏈        12 家
列 1   ○ 玉山銀行 ───────────────┼───── ● 身分驗證       9 家
列 2   ○ 台灣大學 ───────────────┼───── ● 智能客服       5 家
列 3   ○ 富邦人壽 ───────────────┼───── ● 風險評分       5 家  ← 家數相同也各佔一列
列 4   ○ …                       │      ● 保單分析       2 家
                                │
                          中央走廊（無節點）
```

### 4.5.2 座標規則

| 項目        | 規則                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| X           | 只有兩個值：機構側 `-COLUMN_X`、概念側 `+COLUMN_X`。**側別，不是距離語意**                                                                                                     |
| `COLUMN_X`  | 須大於左欄最長 label 的量測寬度之半 ＋ 中央走廊最小寬度，使兩欄 label 不可能水平相撞                                                                                           |
| 概念側 Y    | `列號 × ROW_PITCH`，列號＝依家數遞減排序後的索引（D5(a)）                                                                                                                      |
| 機構側 Y    | 其相鄰概念 Y 的中位數，僅為減少邊交叉，無其他語意；**若兩機構落到同一 Y，須以同一 tie-break 規則錯開，不得共用 Y**                                                             |
| `ROW_PITCH` | ≥ 最大節點直徑 ＋ label 行高 ＋ 邊距（依現行 size 公式上限 52 推算，預設 72）。**任兩節點不得共用 Y**                                                                          |
| tie-break   | 家數相同者依**確定性規則**定序（建議：家數 desc → label 的 locale 排序 asc）。不得用 `Math.random`、不得依賴物件鍵序、不得依賴 hash（承 P6 I3 精神：tie 要可重現、可人工核對） |

### 4.5.3 版面高度的硬約束（連帶問題，見 D10）

`ROW_PITCH = 72` × 186 個概念 ≈ **13,400 canvas 單位高**。畫布視窗約 800px，要一次看完須縮至約 6% 比例，label 即不可讀。

**因此：在 label 可讀的前提下，嚴格的一欄一列一屏只容納約 11–15 個概念。** 這是此排版的物理性質，**不能用縮放或 DPI 解決**（同 Q8 v2.1 的結論：資訊密度由版面策略控制）。處理方式見 **D10**。

座標由確定性函式一次算出、不進 physics。

⚠️ **Y 只表示序、不表示比例**（承決策 1「距離不賦予語意」與 P6 I2 的同一問題）：相鄰兩列的間距固定為 `ROW_PITCH`，與其家數差無關——「12 家 → 9 家」與「5 家 → 2 家」在圖上看起來一樣遠。圖例與離線匯出的 `modeExplanation` 必須明載此點（§9），否則讀者會把 Y 當成等比刻度。

---

## 5. 篩選繼承

| 既有篩選／選項               | 本 mode 行為                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 來源檔 `sourceFiles`         | 適用（進 `selectedRawIds`，I1 全量重算）                                                                                                                                            |
| IPC `ipcFilter`／`ipcLevel`  | 適用（沿用 P5 的層級投影與重算）                                                                                                                                                    |
| 年份 `yearRange`             | 適用（進 `selectedRawIds`）                                                                                                                                                         |
| 機構類型多選                 | 適用，且**排除類型的機構其專利不進 cohort、全量重算**（I1 唯一合法解；「僅顯示層隱藏、不重算」已列 §12.1 已排除）。scope key 依 D8(a)：`analysisScopeKeyOf` 無條件新增 `inst=` 欄位 |
| `unit`（篇/家）              | **disable**：邊量本質是篇、概念量本質是家，本圖無「切換」可言                                                                                                                       |
| `edgeWeight`（jaccard/npmi） | **disable**：本圖邊不是概念對，無線寬指標                                                                                                                                           |
| `showSemantic`               | **disable**：semantic 邊是概念對 LLM 邊                                                                                                                                             |
| `showCitations`              | **disable**：本圖無概念對邊                                                                                                                                                         |
| `colorMode`                  | 概念側著色選項待 D9；`ipc` 沿用 P5 限制 → disable                                                                                                                                   |
| `temporalReference`          | 沿用：tooltip 時序統計遵循 active/full；圖本身無時間編碼                                                                                                                            |

---

## 6. 回答老師三個問題的操作路徑

| 問題                       | UI 操作                      | 看到什麼                                                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) 哪間學校做哪些技術     | 機構類型篩選勾「大學／學研」 | 圖上只剩該類機構＋其概念；或點機構節點 → detail 面板列出其概念與各自投入篇數                                                                                                                                                                                                      |
| (b) 哪些公司學校做相同技術 | 點概念節點                   | tooltip／detail 列出持有機構（含機構類型與投入篇數）；持有者 `org_type` ≥2 種即「跨類型共同投入」。或點機構 →「聚焦此機構」（**二跳展開**：機構 → 其概念 → 其他持有同概念的機構。二部圖上「其他機構」是第二跳，不是 hop-1；沿用既有一階鄰接高亮只會留下該機構與概念，答不了本題） |
| (c) 哪個技術競爭者最多     | 直接看圖                     | 概念節點大小＝持有機構家數；若採 D5(a)，概念側 Y 依家數遞減，家數最多者在頂端                                                                                                                                                                                                     |

（b）的「跨類型高亮徽章」與（c）的「概念排名側欄表」屬新增視覺編碼，列 D6／D7，本期建議不做。

---

## 7. 規模控制（不得靠 DPI 或視窗縮放解決）

- 完全 join 上限＝機構數 × 概念數（開發樣本 56 × 186 ≈ 10,416）。**實際邊數＝Σ\_概念 持有者數，目前未量測**，須實作後量測並回填本節。
- 降載機制：
  1. `minSupport`（篇）門檻，使用者可控（per-mode，§4.3）；
  2. 邊數上限警告：超過時**只警告，不自動丟邊、不自動升門檻**（數值待 D4 spike）；
  3. 聚焦單一機構（二跳，§6(b)）；
  4. 資料能力警告沿用 `GraphViewData.capabilityWarning` 這個**輸出欄位**。
- ⚠️ **現況限制**：`capabilityWarning(graph)` 目前只吃 `GraphData` 且只讀 `graph.methodology`（cooccurrence／semantic provenance），**無法表達邊數超限**。本圖若要出規模警告，必須擴充其輸入（例如另傳算好的邊數與上限）或在 `selectBipartiteView` 內另組字串後併入同一輸出欄位。規格不指定實作形式，但**「沿用現況呼叫即可」是錯的**，N9 必須驗到警告真的出現在 `capabilityWarning` 欄位。
- 資料-agnostic：cohort 為空或無任何持有者時走既有「資料不足」提示路徑，不得畫出誤導性的密集圖。

---

## 8. 機構類型分類：兩套系統並存（D2 已定案 A）

**現況事實**：DB 存 `lib/applicant-classify.ts` 的 `classifyOrgType` **9 類**（`applicants.org_type`，`saveGraph` 時寫入）；UI／圖例／export 用 `lib/graph-view.ts` 的 `institutionTypeOf(label)` **10 類**（多拆「大學」、證券投信→證券投承、科技資訊→科技），由 label 即時重算、**不讀 DB**。兩者值域不同、無人對齊。

| 選項                      | 內容                                                                                              | 後果                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **A. 沿用規則式**（建議） | 本圖用 `institutionTypeOf`，與 `institution` view／圖例／export 一致；DB `org_type` 不參與視覺    | 零 migration、零新治理層；但兩套分類繼續並存、DB `org_type` 無人消費、值域持續漂移 → 記為 debt                            |
| **B. 本期合一**           | 統一為 10 類，`saveGraph` 改寫 `institutionTypeOf` 結果入 DB，UI 改讀 DB                          | DB 與顯示一致；需 migration（值域 9→10）＋ `graph-compat` 容忍舊值；分類仍為規則式、老師仍不能修                          |
| **C. 合一＋可編輯＋快照** | 照 P1 同義詞模式：`institution_types` 表＋CRUD API＋管理 UI＋`analyses.institution_snapshot` 快照 | 符合意圖決策 8 的路線圖（「機構分類需要新做一層」）；老師可修正誤分類；但本期範圍最大，會吃掉 P9 大部分預算，建議另立一期 |

**2026-08-10 定案：選項 A。** 本圖沿用 `institutionTypeOf`（10 類、label 即時算），與 `institution` view／`GraphLegend`／export 一致；DB 的 `org_type` 不參與本圖視覺。兩套分類並存記為 debt（§11），可編輯＋快照的治理層（選項 C）另立一期。

---

## 9. 離線 HTML 匯出（沿用 P8 契約）

- `lib/view-url.ts` 的 mode 白名單與 `lib/export-html.ts` 的 `parseExportOptions` **必須同時**新增 `bipartite`。兩處未知值行為不同（view-url 丟棄、export 落回 concept），只改一處會造成「URL 接受但匯出落回概念圖」的靜默錯誤。
- `buildExportViews` 改為同時建**四** view；export route 以 `buildExportViews(...)[options.mode]` 驗證 frozen positions 的節點集合，`bipartite` 必須在內。
- **frozen positions 契約不變**：canonical 路徑仍是已登入的 `POST /api/export/{id}`，座標一律來自點擊當下 active live 的 `getPositions()`（**包含使用者手動拖曳後的座標**）；離線 HTML 設 `physics:false`、`max|Δ|=0`；缺 snapshot 則 hard-gate 顯示錯誤、不做 fallback。
  - ⚠️ 即使採 D1(a) 的確定性兩欄座標，**離線端也不得改為「自行重算座標」**——那會丟掉使用者拖曳結果，且與 P8 單一來源契約衝突。確定性座標的好處只是讓 `max|Δ|=0` 易於成立，不是免除 POST。
- **圖例文字**：標題「機構–技術二部圖」；`modeExplanation` 須含邊語意（「該機構以 ≥N 篇專利投入該概念」）、機構大小＝涉足概念數、概念大小＝持有機構家數、兩側著色來源、距離聲明，以及 **Y 軸序數聲明**（概念自上而下依機構家數遞減排序，垂直位置只表示排名先後、不表示家數差的比例；§4.5）。**不得**出現「線寬＝Jaccard／NPMI」字樣（本圖無線寬指標）。

### 9.1 `physics:false` 與 snapshot provider 的時機（D1(a) 定案 → 本節為 BLOCKING 前置）

現況：`GraphViewer` 只在 `network.once('stabilizationIterationsDone')` 的 callback 內呼叫 `onPositionSnapshotProvider(...)`，同時才把 `physics.enabled` 關掉、`setStabilized(true)`。而 `GraphLayout` 的 `exportReady` 需要 `hasPositionSnapshotProvider` 為真。

後果：**若二部圖從一開始就 `physics:false`，該 stabilization 事件不會觸發 → provider 永不註冊 → `exportReady` 恆假 → 二部圖永遠無法走 canonical POST，離線 HTML 必定 hard-gate 顯示錯誤。**

因此本規格要求（D1(a) 已定案，以下為強制）：

- 固定座標分支必須在 `Network` 建立完成後**立即**註冊 snapshot provider（不等 stabilization），並同步把 stabilized 狀態設為完成，使 `exportReady` 成立。
- 註冊的 `getPositions()` 仍必須回傳 **live network 的當前座標**（含使用者拖曳），不是重算的理論座標。
- 此為**前置條件**，不是可選優化；未處理即不得進入 §15 第 5 步。
- N11 必須驗到「二部圖在無 stabilization 的情況下 `exportReady` 為真且 POST 成功」。

---

## 10. 版本相容

- **無 migration**（純 view 層，同 `institution` view）；`graph-builder`／`concept-network`／`concept-metrics`／`temporal.ts` 的公式不動（`analysisScopeKeyOf` 除外，見 D8）。
- `graph-compat`：本圖不讀 DB 指標、全部由結構邊重建，故舊圖缺 `applicant_count` 無影響；概念著色若採 D9(a) 需容忍舊圖缺 `community_id_applicants`（回退 `community_id`）。
- 新 `GraphEdgeKind='bipartite'` 對舊資料無影響（舊圖沒有該 kind）；`GraphMode` 加值對舊 URL 無影響。

---

## 11. 誠實限界 / debt

- 開發樣本只有 **1 所大學**（56 家機構）→「哪間學校做哪些技術」在開發樣本上幾乎無法演示。這是**樣本特性，不是系統缺陷**（意圖決策 8：資料-agnostic）；真實資料由老師端提供，系統不得因樣本稀薄當掉或偏差，也不得針對樣本調校。
- 機構類型兩套分類並存（§8）為現況 debt：D2 定案 A（沿用規則式），本期不動；DB 的 `applicants.org_type`（9 類）仍無人消費、與顯示的 10 類持續分歧。可編輯＋快照的機構分類治理層（原選項 C）另立一期。
- 實際二部圖邊數未量測；D4 已定案「只警告不自動降級」的機制，但**上限數值必須實作後以開發樣本實測回填**，不得憑猜測寫死。
- 概念側著色（D9）已定案 (a)。
- **版面高度（D10）未決前不得實作排版**：§4.5.3 的幾何推算顯示二部圖無法同時做到「顯示全部 186 個概念」與「label 可讀」。這是排版方式的物理性質，不是可用參數調掉的缺陷。
- `capabilityWarning` 目前無法承載邊數警告（§7），P9 必須擴充其輸入或另組字串；這是既有函式的能力限制，非本圖新增的 debt。
- 既有 `institution` view 的 `Sidebar` 用合成 `id:-1` 群組冒充社群來顯示機構類型清單。本圖**不沿用**該 hack，改由 `GraphLegend` 直接讀 `INSTITUTION_TYPE_COLORS`；既有 hack 不在本期修。

---

## 12. 設計決策（D1–D9 全數定案；被排除的做法見 §12.1）

| #                                                            | 問題                                         | 選項與後果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** ✅ **定案 (a)**（2026-08-10）                         | 排版：兩欄固定 vs ForceAtlas2                | **(a) 兩欄固定＋`physics:false`（採用）**：可讀性最佳、座標確定性使 `max\|Δ\|=0` 易成立；需在 `buildInitialPositions` 加二部圖分支，**且必須先做 §9.1 的 snapshot provider 前置**。(b) ForceAtlas2＋雙側 pre-spread：沿用現行基礎設施（含 stabilization 與匯出路徑，無 §9.1 問題）、共同概念的機構自然聚攏；但無法保證兩側不混雜，只能靠形狀／顏色辨識。影響 §4.5、§9.1、N8                                                                                                                                                                                                                                                       |
| **D2** ✅ **定案 A**（2026-08-10）                           | 機構類型分類                                 | **A 沿用規則式（採用）**／B 本期合一／C 合一＋可編輯＋快照。後果見 §8 表。**若選 C，本期範圍與排程需重估**。影響 §4.1、§8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **D3** ✅ **定案 (a)**（2026-08-10）                         | 二部圖的「聚焦」是否需要新 UI                | §6(b) 需要二跳展開（機構→概念→其他機構），而既有鄰域高亮是一階鄰接。**(a) 新增「聚焦此機構」按鈕與二跳子集（採用，同時是 §7 的降載手段）**。(b) 沿用既有鄰域高亮：零新 UI，但答不了 §6(b)，且無降載效果。影響 §6(b)、§7、N9                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D4** ✅ **定案：機制照下述，數值待實測回填**（2026-08-10） | 邊數上限數值                                 | 超過上限時**只警告**＋建議提高門檻或使用聚焦，**不自動丟邊、不自動升門檻**。數值不憑猜測寫死：實作 §7 的邊數計算後，以開發樣本實測 vis-network 在本專案 physics 設定下的效能拐點，再回填本節與 §7。N9 先驗機制（警告出現在 `capabilityWarning`、門檻未被自動改動），數值後補。影響 §7、N9                                                                                                                                                                                                                                                                                                                                         |
| **D5** ✅ **定案 (a)**（2026-08-10）                         | 概念側 Y 排序（D1(a) 兩欄固定 → 右欄需定序） | **(a) 依持有機構家數遞減（採用）**：家數最多者置頂，使 §6(c)「哪個技術競爭者最多」**直接由垂直位置讀出**，無需額外 UI（亦為 D7 不做排名表的依據）。代價：同社群概念被拆散於上下各處，右欄顏色不連續。(b) 依家單位社群分塊：右欄形成連續色帶、社群結構好讀，但失去排名資訊且需另做 UI 回答 §6(c)；社群結構在 `mode=concept` 本已可見，不需在本圖重複。<br>**強制附帶約束**：Y **只表示序、不表示比例**（承決策 1 與 P6 I2 的同一問題）——「12 家 → 9 家」與「5 家 → 2 家」在圖上間距相同。圖例與 `modeExplanation` 必須明載，否則會被讀成等比刻度。影響 §4.5、§9、N8                                                                |
| **D6** ✅ **定案 (a)**（2026-08-10）                         | 跨類型概念高亮                               | **(a) 只做 tooltip（採用）**：零新視覺編碼。(b) 概念節點加徽章／邊框：更醒目，但新增編碼需與社群色、節點大小協調，本期不做。影響 §6(b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **D7** ✅ **定案 (a)**（2026-08-10）                         | 概念排名側欄表                               | **(a) 本期不做（採用）**：D5(a) 已把排名編碼進 Y 位置、節點大小亦編碼家數，側欄表為重複呈現。影響 §6(c)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D8** ✅ **定案 (a)**（2026-08-10）                         | `analysisScopeKeyOf` 如何加機構類型維度      | 該函式為 `graph-builder`（建圖時寫 `analyses.scope_id`）與所有 view 的 `scopeIdOf` **共用**。**(a) 無條件加 `inst=` 欄位（採用）**：欄位數固定、格式整齊；會改變既有三 view 產生的 scope_id 字串，已列 §14 受控例外 2。<br>**採用依據（2026-08-10 查證）**：`scope_id` 未被任何 UI 顯示（`components/`、`app/` 零命中），測試只斷言內部一致性（`node.scope_id === view.scopeId`、DB round-trip），無任何地方硬編碼或解析其字串內容 → 字串變長無消費端會壞。(b)「僅在非空時附加」的唯一好處是既有字串不變，在無人比較新舊字串的前提下無價值，故不採用。影響 §5、§10、N5                                                            |
| **D9** ✅ **定案 (a)**（2026-08-10）                         | 概念側著色                                   | **(a) 沿用 DB 家單位社群 `community_id_applicants`（採用）**：顏色可與概念視圖對照；社群為全量算、篩選後不重算，但這是**既有全域 debt（§2 I1 註）**，非 P9 新引入。(b) 統一用單色／機構類型主色：不沾社群語意，但失去與概念視圖的顏色對照。**(c) 在 cohort 內重算 Louvain 已排除**（§12.1）。影響 §4.1、§5、N3                                                                                                                                                                                                                                                                                                                    |
| **D10** ⛔ **未決（阻塞 §15 第 5 步）**                      | 版面高度策略：一屏放不下全部概念             | §4.5.3 推算：`ROW_PITCH=72` × 186 概念 ≈ 13,400 單位高，一屏（約 800px）在 label 可讀前提下只容納 11–15 列。**不能用縮放／DPI 解決**（同 Q8 v2.1 結論）。<br>**(1) 預設只顯示前 N 個概念**（依家數遞減，N 建議 15–20），其餘靠 `minSupport`／篩選／「聚焦此機構」進入：每屏皆可讀、排名直接可見；代價是二部圖定位從「總覽圖」變成「排行榜＋下鑽圖」。<br>**(2) 兩側各為一個二維區塊而非單一直線**：同排名附近的節點可左右錯開，中央保留空白走廊維持兩側分離；186 個概念可入一屏；代價是排名只剩「大致由上而下」、相鄰兩者不可精確比較，且 §4.5.2 的「X 只有兩個值」須改寫為「X 落在兩個不重疊區間」。<br>影響 §4.5、§6(c)、§7、N8 |

### 12.1 已排除的做法（不列為選項；要重開須先改上位決策文件）

| 曾考慮                                        | 為何排除                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 邊寬度也映射支持篇數                          | 與 opacity 雙重編碼同一變數，違反 P6 I4（encoding separation）。I4 是強制 invariant，不是本期可交換的偏好                                                    |
| 機構類型篩選只在顯示層隱藏節點、不重算 cohort | 畫面統計（概念家數、邊權重）會與實際 cohort 不一致，違反 P6 I1。I1 是最高優先 invariant                                                                      |
| 二部圖在 cohort 內重跑 Louvain 取得概念社群色 | 同一顏色會在概念視圖與二部圖代表不同社群成員，違反意圖決策 7（社群 id／色盤需命名空間、跨圖比對不得誤導）。若要改，必須同時改既有 concept view，超出本期範圍 |
| 離線 HTML 端自行以確定性函式重算二部圖座標    | 會丟棄使用者拖曳結果，且違反 P8「座標單一來源＝點擊當下 live `getPositions()`」契約（§9）                                                                    |

## 13. 驗收表

> 機械可查者以 vitest 純函式（inline fixture、無 DOM、無 DB，比照 `tests/institution-view.test.ts`）；需實跑 UI 者標 [UI]。每條自含 fixture，彼此不互為前置。

| #   | 條件                                                                | 檢查方式                                                                                                                                                                                                                                                                                                                                                | 類別     |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| N1  | `selectGraphView(graph, {mode:'bipartite'})` 回傳兩側節點與投入邊   | 新 `tests/bipartite-view.test.ts`：3 機構 3 概念 inline fixture → 邊數、`kind`、`relation`、`support_count` 全等於人工計算；`concept_count`／`applicant_count` 正確                                                                                                                                                                                     | 單元     |
| N2  | 邊權重＝交集篇數                                                    | 機構 A 有 P1、P2 皆含概念 C → 邊 `support_count=2`；機構 B 只有 P3 含 C → 1；無共享專利者不建邊                                                                                                                                                                                                                                                         | 單元     |
| N3  | 概念側量與字串用「家」                                              | 概念 `size` 由家數決定；圖例字串「投入該概念的機構家數」；概念大小說明無「篇」殘留。（著色部分依 D9 定案後補）                                                                                                                                                                                                                                          | 單元＋UI |
| N4  | `minSupport` 語意、per-mode 保存與標籤                              | `minSupport:2` → `support_count=1` 的邊消失、因此孤立的節點被剔除；[UI] 在概念視圖設高門檻後切到二部圖，二部圖用自己的預設值而非沿用；Sidebar 標籤含「≥ N 篇」且無「≥N 家」「共同投入」殘留                                                                                                                                                             | 單元＋UI |
| N5  | I1 scope 重算與機構類型 cohort                                      | 同一 fixture 兩組參數（全量 vs 帶 `sourceFiles`／`ipcFilter`／`yearRange` 子集）→ 邊權重、`concept_count`、`applicant_count` 皆由子集重建，`scope_id` 隨之變化；篩「銀行」→ 非銀行機構的專利不進 cohort，概念家數對應下降；scope key 行為符合 D8 拍板選項                                                                                               | 單元     |
| N6  | 不套用概念對指標                                                    | 二部圖邊不含 `jaccard`／`npmi`／`association_strength`；切換 `edgeWeight` 不改變本圖輸出                                                                                                                                                                                                                                                                | 單元     |
| N7  | 邊寬固定、opacity 公式                                              | 所有二部圖邊 `width` 相等；`opacity === supportStrengthOpacity(s)`，s=1→0.4269、s=5→0.7425、s=10→0.9053                                                                                                                                                                                                                                                 | 單元     |
| N8  | 兩欄固定座標的確定性與**無 Y 塌陷**（D1(a)／D5(a)；版面策略依 D10） | ① 同一 fixture 兩次呼叫座標函式逐點相等；② 機構側與概念側 x 恆屬不同側（或 D10(2) 的不重疊區間）；③ **同一欄內任兩節點的 Y 皆不相等**——以「多個概念家數相同」的 fixture 驗證（如 5 個概念皆 `applicant_count=1`），這是 §4.5.1 Y 塌陷的直接迴歸；④ 相鄰列 Y 差 ≥ `ROW_PITCH`；⑤ 家數相同者的排序由確定性 tie-break 決定，打亂輸入節點順序後輸出列序不變 | 單元     |
| N9  | 規模控制與二跳聚焦（D3(a)；上限數值依 D4）                          | 超上限 fixture → 警告字串出現在 `GraphViewData.capabilityWarning`、且 `minSupport` 未被自動修改；聚焦 fixture → 集合為「目標機構＋其概念＋其他持有同概念的機構」（二跳），非只有一階鄰接                                                                                                                                                                | 單元     |
| N10 | view-url round-trip                                                 | `tests/view-url.test.ts`：`mode=bipartite` 序列化↔解析一致；未知 mode 仍丟棄                                                                                                                                                                                                                                                                            | 單元     |
| N11 | 離線匯出與 snapshot 時機                                            | `parseExportOptions` 接受 `bipartite`；`buildExportViews` 含 `bipartite` key；標題與 `modeExplanation` 符合 §9 且無「Jaccard／NPMI」字樣；[UI] 二部圖**在未經 stabilization 的情況下** `exportReady` 為真、POST 成功、`max\|Δ\|=0`、`physics:false`；缺 snapshot 時 hard-gate                                                                           | 單元＋UI |
| N12 | 回歸                                                                | `npx vitest run` 全綠（基準：撰稿時 28 個 test files ＝ 27 passed ＋ 1 skipped，322 tests ＝ 316 passed ＋ 6 skipped；skip 原因為本機無 PostgreSQL）；`next build` 成功                                                                                                                                                                                 | 回歸     |
| N13 | [UI] §6 三條操作路徑                                                | agent-browser 實跑：切到二部圖 → 機構類型篩選只剩該類＋其概念；點概念看到持有機構與類型；點機構 → 聚焦呈現二跳集合；邊 tooltip 顯示投入篇數                                                                                                                                                                                                             | UI       |

---

## 14. 修改與禁止修改範圍

**修改**（新增一個 mode 的完整清單）：

- `types/graph.ts` — `GraphMode` 加 `'bipartite'`；`GraphEdgeKind` 加 `'bipartite'`
- `lib/graph-view.ts` — 新 `selectBipartiteView()`（結構邊重建、pair 權重、門檻、孤立剔除、`scope_id`）＋ `selectGraphView` 分支
- `lib/view-url.ts` — mode 白名單
- `lib/temporal.ts` — `AnalysisScopeInput`／`analysisScopeKeyOf` 無條件新增機構類型欄位 `inst=`（D8(a) 定案）
- `components/GraphViewer.tsx` — `buildInitialPositions` 兩欄固定座標分支（D1(a)）；`kind='bipartite'` 邊的寬度／opacity／physics 設定；**snapshot provider 註冊時機（§9.1，D1(a) 前置）**
- `components/GraphLayout.tsx` — mode 按鈕、per-mode 圖層設定、**per-mode `minSupport` state（§4.3）**
- `components/Sidebar/index.tsx` — 第四支篩選器（minSupport 標籤、無意義選項 disable、機構類型多選、「聚焦此機構」入口（D3(a)））
- `components/GraphLegend.tsx` — 二部圖分支
- `lib/export-html.ts` — `parseExportOptions`／`buildExportViews`／title／`modeExplanation`
- `tests/bipartite-view.test.ts`（新）、`tests/view-url.test.ts`（補）

**禁止修改**：`lib/applicant-classify.ts`（D2 定案 A → 不動）；`lib/graph-builder.ts`／`lib/concept-network.ts`／`lib/concept-metrics.ts` 的指標與公式；DB migration（本檔無 migration）；P1 同義詞治理；`concept`／`context`／`institution` 三 view 的既有輸出。

**已知的受控例外**（不列出即視為違規）：

1. `minSupport` 改為 per-mode state 會動到 `GraphLayout` 的共用 state（§4.3）。既有三 view 在**同一門檻值**下的輸出必須不變，只有「切 mode 時門檻是否沿用」這個行為改變。
2. **（D8(a) 已拍板，此例外生效）** `analysisScopeKeyOf` 無條件新增 `inst=` 欄位，會改變既有 concept／context／institution view 產生的 `scope_id` 字串，以及新建分析寫入 `analyses.scope_id` 的字串。已查證無 UI 顯示、無測試硬編碼字串內容，故僅為戳記格式變更，不改變任何三 view 的節點／邊／指標輸出。
3. **（D1(a) 已拍板，此例外生效）** `GraphViewer` 的 snapshot provider 註冊時機會改變（§9.1）。既有三 view 仍走 stabilization 路徑，行為不得改變。

---

## 15. 實作順序與回滾

**順序**（每步完成即跑對應測試，勿跨步）：

1. `types/graph.ts` 型別加值 → typecheck 綠
2. `selectBipartiteView()` ＋ `tests/bipartite-view.test.ts`（N1／N2／N6／N7 ＋ N4 單元部分）
3. `lib/view-url.ts` ＋ N10
4. scope key `inst=` 欄位（D8(a)）＋ N5
5. `GraphViewer` 兩欄固定座標與邊分支（D1(a)）＋ **§9.1 snapshot provider 前置** ＋ N8
6. 規模控制與二跳聚焦（D3(a)；上限數值依 D4 spike）＋ N9
7. `GraphLayout`（per-mode 門檻）／`Sidebar`／`GraphLegend` ＋ N3、N4 的 UI 部分
8. `lib/export-html.ts` ＋ N11
9. 回歸 N12 ＋ agent-browser 走 §6 三條路徑（N13）

**回滾**：本檔全為 view 層與 UI 的 additive 修改（無 migration、無資料變更、不覆寫既有輸出），回滾＝還原型別加值與 `selectGraphView` 分支，既有三 view 行為不變。若 scope key `inst=` 欄位（D8(a)）或 snapshot provider 時機（§9.1）已合併，回滾時需一併還原。commit 按 concern 拆分：核心（型別＋view＋測試）與 UI／匯出分開。
