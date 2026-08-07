# PRD v2 / P3（概念時間）設計審核報告

**審核對象**：`docs/PRD-v2-P3-概念時間.md`（P3-1.0，2026-08-05）
**基準**：`docs/PRD-v2-意圖.md`、`docs/PRD-v2-P0-資料層.md`（P0 為紀律標竿）
**方法**：規格逐條對照實際程式碼（types/graph.ts、lib/graph-builder.ts、lib/concept-network.ts、
lib/graph-compat.ts、lib/db/analyses.ts、lib/graph-view.ts、lib/export-html.ts、
components/GraphViewer.tsx、components/GraphLayout.tsx、components/Sidebar/index.tsx、
components/GraphLegend.tsx、db/migrations/002・003、tests/）
**未修改任何檔案。**

---

## 一句話結論

**APPROVE-AS-AMENDED** —— 骨架、範圍切割與「驗收條件只引用 P3 內部」的紀律都守住了
（沒有任何一條驗收引用 P4/P6/P7/P8，P0 §0 的循環依賴禁令通過）。但有 **8 條 BLOCKING**：
其中 B1（color_mode 落庫與否三處自相矛盾）**需要作者裁決才能定案**，B6（驗收 7 結構上
不可能失敗）與 B7（新節點欄位完全未驗證會產生 NaN 顏色）是會真的造成資料／畫面損壞的缺陷。

---

## 規格claim 對照程式碼：**準確**的部分（先確認沒有誤述）

| 規格 claim | 實際程式碼 | 判定 |
|---|---|---|
| 申請年由 `filing_date` 前 4 碼解析，沿用既有做法 | `lib/graph-builder.ts:160-163` `filing_date.match(/^(\d{4})/)` | ✅ 準確 |
| 概念節點顏色目前由社群 id 決定 | `lib/graph-builder.ts:114-116` `communityColors.get(communityId) ?? "#BAB0AC"` | ✅ 準確 |
| `normalizeMethodology()` 是嚴格白名單、無 `...raw` 回退 | `lib/graph-compat.ts:124-171`，逐欄列舉、回傳物件無 spread | ✅ 準確（P0 決策 #7 成立） |
| `GraphMethodology` 既有 15 欄 | `types/graph.ts:154-170`，數過= 15 | ✅ 準確 |
| `GraphMethodology` 是 typed interface，新增 optional 欄位需**同時**改 interface 與 normalize passthrough | 是。`normalizeMethodology` 回傳型別為 `GraphMethodology` 的物件字面值，未列的欄位一律消失 | ✅ 準確 |
| `concepts` INSERT 欄位清單需加四欄、`loadGraph` SELECT 對應加四欄 | INSERT 8 欄 `lib/db/analyses.ts:373-396`；SELECT `:604-605` 對稱 | ✅ 準確 |
| `methodology` 已在 `analyses.methodology`（jsonb），不需新增表欄 | `lib/db/analyses.ts:244,265` 整塊 `JSON.stringify(graph.methodology)` | ✅ 準確 |
| P1 合併後 `source_patents` 已是聯集，時間統計直接吃它、不得再處理同義詞 | `lib/concept-network.ts:145-165` 在 `cleanedKeywords()` 於輸入層 resolve；`ConceptAggregate.source_patents` 是合併後結果 | ✅ 準確 |
| 002/003 為 additive 慣例（只 ADD COLUMN / CREATE TABLE，附 down） | `db/migrations/002_p0_data_layer.sql`、`003_p1_synonyms.sql`、`db/migrations/down/{002,003}_down.sql` | ✅ 準確 |
| 灰色 `#BAB0AC` 與社群模式缺省同色 | `lib/graph-builder.ts:35`（TABLEAU_10 第 10 色）與 `:116` fallback 皆為 `#BAB0AC` | ✅ 準確 |
| 驗收條件不引用後期能力 | 驗收 1–8 全部 P3 內部 | ✅ 未違反 P0 §0 |

---

## BLOCKING（8 條）

### B1 — `color_mode` 究竟落不落庫，規格三處自相矛盾（**需作者裁決**）
**位置**：§2.1 / §4.1 / §6 表 #2 / §7-7
**為什麼**：四處講的不是同一件事，而它們指向不同的實作與不同的損壞：
- §2.1 把 `color_mode` 放進 `GraphMethodology`；而 methodology 是整塊 jsonb 落庫
  （`lib/db/analyses.ts:265`）→ **會落庫**。
- §4.1 明寫「切換狀態**不落庫**（是視圖設定，不是資料）」→ **不落庫**。
- §7-7 要求 `methodology.color_mode` 在往返後存在 → 又假設落庫。
- §6 表 #2 要 `graph-builder` 在 `color_mode==='first_year'` 時「概念節點用漸層色」。
  這條最危險：那個顏色會經 `saveGraph()` 寫進 `concepts.color`
  （`lib/db/analyses.ts:373-396`），而離線 HTML 直接採用 `node.color`
  （`lib/export-html.ts:176`），該檔圖例卻硬寫「顏色＝Louvain 社群」（`:95`、`:157`）
  → **圖例說謊**，正是 §5 宣稱要守的東西被自己的 §6 打破。

**具體修法（建議裁決，作者可否決但必須明寫一種）**：
1. `GraphNode.color` / `concepts.color` **永遠是社群色**，漸層只存在 view 層；
2. `GraphMethodology` 只收 `time_window` + `time_color_scale`（前者是資料事實、後者是色盤宣告，
   兩者都必須跟著分析一起持久化）；**移除 `color_mode`**（它是視圖狀態，不是方法宣告，
   與其餘 15 欄的語意層級不同）；
3. §6 表 #2 改成「graph-builder 只把四個時間欄位塞進概念節點，**不著色**」；
4. §7-7 改為只驗 `time_window` / `time_color_scale`。

### B2 — 著色切換的落點與程式現實不符，且高亮路徑會把漸層色沖掉
**位置**：§4.1、§6 表 #2/#6
**為什麼**：
- §4.1 說「GraphViewer 既有控制區加一個雙態切換」——`components/GraphViewer.tsx` **沒有控制區**，
  只有一顆 fit-to-view 按鈕（`:648-655`）。所有視圖控制在 `components/Sidebar/index.tsx`
  （年份範圍 `:160`、語意 `:185`、支持門檻），狀態在 `components/GraphLayout.tsx:29-50`。
  §6 的檔案表因此**漏了 `GraphLayout.tsx`、`Sidebar/index.tsx`、`lib/graph-view.ts`**。
- 若照「純客戶端 `nodeDataSet.update` 只改顏色」實作：`applyHighlight()`（`:483-512`）與
  `clearHighlight()`（`:524-` ）都用 `toVisNode(n)` 從 **prop nodes 的 `n.color`** 還原顏色。
  使用者切到 first_year、再點任一節點（觸發高亮）、再取消 → **概念節點跳回社群色**。

**具體修法**：把 `color_mode` 加進 `GraphViewOptions`（`lib/graph-view.ts:10-15`），
由 `selectGraphView()` 回傳已重算 `color` 的 nodes。這條路：純函式可測、highlight/clear
自動一致、不碰 DB 與離線 HTML，而且與現有慣例相同（mode/minSupport/yearRange 就是這樣走的）。
代價：`GraphViewer` 的 rebuild effect（deps `[nodes, edges]`，`:596`）會重建 Network 並重跑
stabilization——但 yearRange 滑桿現在**已經**是這個代價，且 viewport 會還原（`:420-430`）。
若作者堅持 §3.1 的「布局全部不動」，則必須改走 colour-only 的 `nodeDataSetRef.current.update()`
（`:598-632` 那條 effect 就是現成範式）**並且**讓 highlight/clear 共用同一個顏色解析器。
**兩條路必須在規格裡選一條並寫死**，否則實作者會選到會壞的那條。

### B3 — 中位數的母體未定義為多重集合，決策 5 會被實作走鐘
**位置**：§1.2（配合 §1.1 的 `year_counts` 說明）
**為什麼**：§1.2 寫「n = 專利數（升冪排序後）」暗示多重集合，但 §1.1 又寫
「一個專利一個年，天然去重」，很容易讓實作者從 `year_counts` 的鍵（**distinct years**）取中位數。
反例：年份多重集合 `[2015,2020,2020,2020]` → lower median = **2020**；
若用 distinct `[2015,2020]` → **2015**。決策 5 的理由正是「lower/upper/平均會決定 P6 箭頭有無」，
這個錯法比 lower/upper 之爭更嚴重。
**具體修法**：明寫「母體 = **每個有年份的專利貢獻一個年份值，重複年份必須保留**（多重集合），
不是 `year_counts` 的鍵集」；驗收 2 加一條專門鎖這點的 fixture：
`[2015,2020,2020,2020] → median 2020`（若誤用 distinct years 會得 2015，測試會紅）。

### B4 — 漸層映射的插值規則不完整、9 個錨色沒列出來，驗收 3 不可判定
**位置**：§3.3、驗收 3
**為什麼**：
- §3.3 只寫 `color = lerp(錨色序列, t)`。未定義**索引法**（連續插值 `i = t*(N-1)`
  還是分箱 `floor(t*9)`）、**插值空間**（sRGB 逐通道 vs OkLab）、**四捨五入規則**。
  同一個 t 在兩種索引法下給不同顏色，而 §3.3 自己要求「可重現、可測試」。
- **9 個錨色的 hex 值根本沒有列出來**，只說「值必須寫死為常數」。P0 的風格是把基準值逐個列表
  （§3.1 三個 serial→日期、§3.2 完整樣式分佈）。圖例要印 `sequential_blue`、P7 戳記要印它——
  色盤悄悄換掉就毀掉跨圖比對，而規格沒有任何東西能證明它沒被換。
- 驗收 3 的「`first_year=2016 → 中間色`」不可判定。在 `window=[2007,2025]`、9 錨色、
  `i = t*(N-1)` 下：`t = 9/18 = 0.5`，`i = 4` → 精確等於**錨色[4]**。

**具體修法**：列出 9 個 hex 常數；明訂 `t` clamp 後 `i = t*(N-1)`、`lo = floor(i)`、
`hi = min(N-1, lo+1)`、`f = i - lo`、**sRGB 逐通道線性插值 + `Math.round`**；
驗收 3 把「中間色」改成「錨色[4]」，並加一條「`t=0.5` 落在錨色上時不得因浮點誤差偏移」。

### B5 — P0 保留的界外年份會綁架漸層窗，規格沒處理
**位置**：§1.1、§3.2
**為什麼**：P0 §3.1 規定 `filing_date` 落在 `<1990` 或 `>今年+1` 時**只記
`warnings.date_out_of_range`，不丟棄**；`lib/graph-builder.ts:160-163` 的解析也只取前四碼、
不做值域檢查。所以一筆髒資料（1900 或 2099）就會讓 `window` 變成 `[1900, 2025]`，
全部真實概念被壓進最前面一兩個錨色，畫面看起來「全部同色」而使用者查不出原因。
§1.1 只排除了「無 `filing_date`」，沒排除「有 `filing_date` 但年份荒謬」。
**具體修法**：§1.1 明訂時間統計只採 `[1990, currentYear+1]` 內的年份（與 P0 的 warning
門檻同源，不引入新規則），被排除的筆數沿用既有 warnings 可查；§3.2 補一句說明窗因此
不會被單筆髒資料綁架。

### B6 — 驗收 7 結構上不可能失敗，守不住它聲稱要守的 §5-4
**位置**：驗收 7、§5-4、§6 表 #5
**為什麼**：`/analysis/<id>` 走 `loadGraph()`（`app/analysis/[id]/page.tsx:18`），
methodology 是 `meta.methodology as GraphMethodology` **直接 cast**（`lib/db/analyses.ts:710`），
**完全不經過 `normalizeMethodology()`**；而 methodology 是整塊 jsonb 落庫（`:265`）。
→ **就算白名單一個字都不改，驗收 7 照樣全綠。**
連帶：§5-4 的理由句「否則 v3 分析重開時會被白名單丟棄」**指錯路徑**。
`normalizeGraphData()` 在整個 repo 只有一個呼叫點：`app/api/admin/import/route.ts:62`
（匯入 JSON → 接著 `saveGraph()` 覆寫）。**那裡**才是 `time_window`／`time_color_scale`
會被永久丟掉的地方。
**具體修法**：§5-4 的理由改寫為 admin import 路徑（並保留「不允許 `...raw` 回退」的結論）；
驗收新增一條**單元測試**（放進既有 `tests/graph-compat-v3.test.ts`）：
帶 `time_window`／`time_color_scale` 的 v3 payload 經 `normalizeGraphData()` 後逐欄保留。
驗收 7 保留為 DB 往返測試，但不要再宣稱它守 §5-4。

### B7 — `normalizeNode` 是 spread 不是白名單：四個新欄位「原樣通過」但**完全未驗證**，會產生 NaN 顏色
**位置**：§6 表 #5、§5-2、§2.3
**為什麼**：`lib/graph-compat.ts:37-51` 是
`return { ...(value as GraphNode), id, label, type, color, size, source_patents }`。
所以 `first_year: "2019"`（字串）、`null`、`1e309` 都會**原樣**進節點，
再進 `t = (first_year - window[0]) / …` → `NaN` → 顏色字串變 `#NaNNaNNaN`，
直接違反 §5-2 的「無 NaN」與 §2.3 的「不得顯示成 0」。
另外 §6 表 #5 寫的「v3 分支（若有重算路徑）帶上時間統計」含糊且方向錯：
v3 走 `normalizeV2`，節點欄位本來就是 spread 通過，不需要「帶上」——**需要的是驗證**。
**具體修法**：`normalizeNode` 對四欄明確驗證（`Number.isInteger` 才留、否則 `undefined`；
`year_counts` 只收 `Record<string, 有限數>`），比照它現在對 `size`／`source_patents` 的處理；
延伸既有測試「沒有任何節點或邊的數值變成 NaN」（`tests/graph-compat-v3.test.ts:191`）。
同理 `normalizeMethodology` 對 `time_window` 要驗「兩個整數的 tuple，否則 null」，
且**缺欄時必須省略（undefined）而非填造假預設**——這是 methodology 版的「0 冒充值」防線。

### B8 — 驗收 5／6 以現有測試基礎設施不可執行
**位置**：驗收 5、驗收 6
**為什麼**：測試指令是 `vitest run`（`package.json:11`），devDeps **沒有** jsdom／happy-dom／
testing-library，`tests/` 底下**零元件渲染**（`grep render(|@testing-library|GraphViewer|GraphLegend tests/`
零命中）。所以「切換不觸發網路請求、不重載資料」「圖例有說明文字」寫成驗收條件是
**不可執行的契約**——P0 §8 對 `excel-parser.ts`「§7-5 的回歸契約目前不可執行」就是明確的反面教材，
本檔不該重犯。
**具體修法**：把顏色解析與窗計算放進 `lib/`（純函式，見 B2 的 `selectGraphView` 路徑），
驗收 3/4/5 改成對純函式斷言（例如同一 graph 分別以 `color_mode:'community'` 與
`'first_year'` 呼叫 `selectGraphView()`，比對概念節點 color 陣列：切回去必須**逐欄相同**）；
DOM 層行為（無網路請求、圖例文字）降級為**明說是手動 QA 的清單**，不要混在 `pnpm test` 的驗收裡。

---

## NON-BLOCKING（10 條）

| # | 位置 | 問題 | 修法 |
|---|---|---|---|
| N1 | §0 | 「全量重跑後**驗收基準 7** 須以實際全量值覆核」指錯條號——驗收 7 沒有任何數字，帶數字的是驗收 3（`window=[2007,2025]`）與 §3.2 | 改成「驗收基準 3」 |
| N2 | §0、§3.2 | 實測母體未指明，且與另兩份文件不一致：P0 §3.1 實測老師版申請日窗是 2004-01-30–2021-12-28，`PRD-v2-意圖.md` §P3 寫「本樣本 2004–2021」，本檔寫 [2007,2025]。caveat 本身寫得算克制（有註明非全量），但不可追溯 | 補 analysis id／來源檔／專利筆數／有年份概念數；順手修正意圖檔 §P3 那句括號，或註明兩者母體不同 |
| N3 | §6 表 #1 | 年份解析會出現**第二份實作**：`graph-builder.ts:158-163` 已算出 `patentNode.year`，而 `computeConceptTimeStats(conceptNetwork, patents)` 的簽章會讓同一條規則再寫一次 | 改傳 `Map<patentId, year>`，或抽共用 `parseFilingYear()`。P0 §3.1 那條日期規則是硬換來的，不該有兩份會漂移的拷貝 |
| N4 | §2.1、§3.2 | `time_window` 與既有 `stats.year_range`（`types/graph.ts:183`）語意相近但值不同：後者是**專利年** min/max，前者是**概念 first_year** min/max | 明寫兩者不同、不得互相替代，否則圖例與未來戳記會混用 |
| N5 | §3.2、§2.1 | 退化與 null 行為未定義：全部概念同一年 → span 0 → `max(1,0)` 使所有 `t=0`、全落錨色[0]，但圖例仍畫完整漸層條；沒有任何概念有年份時 `time_window` 應為 `null`（型別已允許，§3.2 沒說何時 null） | 定義 `null` 判準；`null` 時切換鍵停用並顯示原因，而非渲染空漸層 |
| N6 | §4.1、§5-3 | 分享 URL 慣例：現有 mode/showSemantic/minSupport/yearStart/yearEnd 全進 URL（`GraphLayout.tsx:70-71`），§4.1 只說「不落庫」沒說 URL。若不進 URL，分享連結會看不到漸層 | 建議 `color_mode` 進 URL（純加參數，不違反 §5-3）；同時記下**已知限制**：`app/api/export/[id]/route.ts` 的 `parseExportOptions` 不吃該參數，離線 HTML／PNG 在 P7/P8 前不會反映漸層——現在寫下來，免得日後被當 bug |
| N7 | §2.3 | 未點名要改的型別與映射：`ConceptRow`（`lib/db/analyses.ts:539-547`）與 `:651-660` 的映射。現況 `frequency: row.frequency` 沒有 null→undefined 這層，四個新欄位不要照抄 | 明寫寫入 `?? null`、讀回 `?? undefined`；並註明 `year_counts` 經 jsonb 往返鍵一律是字串，測試照此斷言 |
| N8 | §2.2、§6 表 #8 | 004 的慣例細節：003 明寫「不放 BEGIN/COMMIT，`runMigrations()` 已包 transaction」；down 檔實際路徑是 `db/migrations/down/00X_down.sql`（§6 表寫對、§2.2 只寫 `004_down.sql`） | 補上 transaction 慣例一句；兩處路徑寫法統一 |
| N9 | §1.1 vs §2.1 | 型別不一致：§1.1 表寫「integer，**可 null**」，§2.1 的 TS 是 `first_year?: number`（optional，非 nullable） | 明寫 DB `null` → TS `undefined` 的轉換點（配合 N7），否則 `first_year: null` 會流進算式（見 B7） |
| N10 | §3.4 | 灰色 `#BAB0AC` 在社群模式是「第 10 個社群的顏色」，在 first_year 模式是「年份未知」——同色不同語意 | 圖例文字**分模式**寫；§3.4 的「與社群模式缺省同色」是準確的，但要註明語意差異 |

---

## 附：本次沒有發現違反的紀律（供作者放心）

- **循環依賴**：驗收 1–8 全部只引用 P3 內部；P4/P6/P7/P8 只在動機與「不做」清單中以散文提及，
  未進入任何驗收條件。P0 §0 的禁令**通過**。
- **「0 冒充值」防線**：§2.3 與 §3.4 都正確引用，且 §3.4「灰色是明確的未知語意、不是缺欄冒充」
  的區分是對的。唯一缺口在 B7（未驗證的欄位會變 NaN，比 0 更糟）。
- **v1.2 do-not-break 清單**：§5 六條方向正確；唯一自我矛盾來自 §6 表 #2（見 B1）。
- **P1 輸入層合併**：§1.1／§5-5 對 `lib/concept-network.ts` 的理解準確，沒有要求在後期重做合併。
