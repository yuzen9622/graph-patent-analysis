# PRD v2 / P4：關聯度與分析單位（機構第一）

**版本**：v1.0（2026-08-07 初稿，待定案）
**前置**：P0（資料層）、P1（同義詞治理）
**上位需求**：`docs/PRD-v2-意圖.md` 決策 8 —— **分析主單位＝機構（家）**，篇退為下鑽細節。

## 0. 這份文件的範圍

**只規範 P4：把系統的分析單位落到「機構（家）」，並提供以機構為主角的視圖與指標。**
「先後順序／上下位（統計＋引用）」屬 P6；「IPC 五級」屬 P5；「PNG 戳記」屬 P7；「離線 HTML 圖例」屬 P8——
本檔只留接口，不展開。

**資料-agnostic 原則（決策 8）**：本系統不針對樣本的厚薄／產業貼合度調校。真實資料由老師端整理提供；
樣本只有幾所機構、或混入非金融產業，**都不是本系統要修的問題**。系統不得因稀疏／空樣本當掉或產生偏差結論
（稀疏时要給明確的「資料不足」提示，而不是畫一張假的密集圖）。

**驗收條件只引用 P4 內部。** 邏輯編號沿用「決策」「N（新）」「B（Bug 防）」。

---

## 1. 兩個分析單位

| 單位 | 名稱 | 語意 | 一手來自（P0） |
|---|---|---|---|
| `patent` | 篇 | 「這概念出現在幾份專利說明書」 | `concepts`、`patent_concepts`、`patents` |
| `applicant` | 家（機構） | 「幾間機構的專利碰過這概念」 | `applicants`、`patent_applicants`、`patents` |

**1.2 概念的格量（每個概念兩單位各算一份）**
- `support_count_i` = 包含概念 i 的**專利篇數**
- `applicant_count_i` = 包含概念 i 的專利所屬的**不同申請人家數**
- 邊 (i,j)：
  - `support_patents_ij` = 同一篇同時含 i 與 j 的**篇數**
  - `support_applicants_ij` = **同一位申請人**（可跨篇）其專利同時含過 i 且含過 j 的**家數**
- 重要：`support_applicants` 不需要 i、j 在同**一篇**專利，只要同一間機構的**不同專利分別**碰過 i 與 j 即可。——這正是「某銀行＋某大學『都在做』某概念」那一層。

**1.3 機構類型**（新，`applicants.type`）
- 分類尺：`銀行 / 保險 / 大學・學校 / 科技新創 / 政府 / 其他 / 未知`
- 規則範本（依名稱關鍵字，`applicant_key`）＋**人工可編輯、跨分析共享、不可變快照**（完全複用 P1 同義詞的治理架構，不改規則）。
- 初版規則不必完美：名稱含「銀行／信託／金控」→銀行；「保險／人壽／產物」→保險；「大學／學校／學院」→大學；else 未知。「科技／資訊／電子／軟體」可歸科技，但**未具名的就別猜**（歸未知，人工補）。

---

## 2. 四個指標（每項都定義兩單位）

**2.1 支持度** `support_patents_ij` ／ `support_applicants_ij`（見 §1.2）。門檻的語意隨單位。

**2.2 Jaccard（線寬用，有界）**
- 篇：`|i∩j 的篇| / |i∪j 的篇|`
- 家：`|i∩j 的家| / |i∪j 的家|`
- `jaccard=1`（i、j 只共同出現一次且各自無其他）是合法的稀疏值，不是 bug（樣本小導致）。

**2.3 Association strength（排序／引用用，**不用**線寬）**
- 公式：`s_ij = 2m·c_ij / (c_i·c_j)`，`c_i = Σ_{j≠i} c_ij`，`c_ij`＝概念對共現次數，`m = ½Σ_i c_i`（決策 2）。
- 兩單位各算一份（篇用篇次數、家用家次數）。
- 已知限制（意圖決策 2）：單邊網 `s≡2`、稀疏網路 `s` 幾乎恆>1、`s` 跨圖**不可比**。因此：只用於**同一張圖內**的排序與門檻，圖例明載其膨脹與跨圖限制；**不當線寬**。

**2.4 NPMI（線寬用，有界、可跨圖比較）**
- `w_i` 跟單位：篇 → `p_i = support_patents_i / N_patents`；家 → `p_i = applicant_count_i / N_institutions`。
- 邊機率 `p_ij`＝（i、j 依單位共現）／（對應母體數）。
- `p_ij = 1` → **`undefined`**：不入排序、邊詳細顯示「—」，**不記成量尺最大值**（該況 PMI=0，記最大值與語意相反）。
- `clamp(-1, 1)` 吸收浮點溢出。
- 線寬 = `jaccard` 或 `NPMI`（決策 2 已定：用有界指標），UI 二選一。

---

## 3. 資料結構與 DB（Q2、Q4）

**3.1 社群分單位持久化（決策 7 ＋ Q2 定案）**
- `communities` 主鍵加 `unit` 維度：`(analysis_id, unit, community_id)`；`unit ∈ {'patent','applicant'}`。
- 概念 → 社群歸屬按單位各存一份（`concept_communities(analysis_id, label, unit, community_id)`），不依賴「載入時重算」。
- 色盤取 key 用 `unit + community_id`：同 id 不同單位**不共享色**，跨圖不誤判。

**3.2 指標全量算、進 DB；門檻只顯示過濾（Q4）**
- `edges` 把 `support_count` 擴成兩單位字段（`support_patents`/`support_applicants`），並存 `jaccard`（兩單位）、`npmi`（兩單位）、`association_strength`、`shared_concepts[]`。
- 差量**一律全量（門檻前）**。門檻是 view 層 filter，**絕不重算**指標；隱藏邊仍計入全量分母。
- 方法圖例明載「指標為全量計算・顯示以 support≥k 過濾」。

**3.3 migration `005_p4_units.sql`**（+`down`），全 ADDITIVE。

---

## 4. 機構節點圖（P4 主視圖）

**4.1 單位切換 UI**：視圖控制新增 `unit ∈ {concept（現有）, applicant（機構）}`。切到機構後全圖換成機構節點。

**4.2 機構節點圖內容**
- 節點 = 一家機構；大小／不透明按機構涉足的概念數（單位「家」——見 §5.2）。
- 邊 = 兩家共同投入（`shared_index_count ≥ k`，k 用 view 門檻）→ 連邊；邊權重 = 共享概念數。
- 邊的不透明度/門檻照「家」（§5.1）。
- 點開一條機構邊 → 顯示**兩家共享的概念清單**（正是「銀行＋大學**一起做哪些技術**」的直接答案）。

**4.3 機構類型標示與篩選**
- 節點用機構類型著色（可選，預設社群色）。
- 類型篩選：例如只看「銀行 × 大學」邊——直接回答老師那句。

**4.4 篇做下鑽**：點一家機構節點 → 顯示其專利列表、涉足概念、時間（P6 再上機構時間軸）。

---

## 5. 視圖層的單位跟隨（Q3、Q9）

**5.1 門檻／線寬／不透明度跟隨單位**：切到「家」時，`minSupport` 語義變 `support_applicants`，UI 標籤「≥N 篇」⇄「≥N 家」；線寬與不透明度映射改用機構計數。
**5.2 節點大小／圖例字串跟隨單位**：節點大小純量（篇→概念出現篇數；家→機構家數）及方法圖例、戳記字串，一律由單位參數驅動（例如圖例「節點大小＝該概念出現的**機構家數**」），不再寫死。
**5.3 view-url**：把自己 `unit` 納入既有 `lib/view-url.ts` 序列化（`mode` 值域加一份或另欄 `unit`），維持 N6 的 URL 同步與 round-trip。

---

## 6. 不得破壞的既有行為

- 既有**概念圖**視角（`mode=concept`）的不偏離語義、社群色、P3 年漸層。
- 沿用 `lib/view-url.ts`：`unit` 加入後，`parseViewQuery`/`toViewQueryString` 仍 round-trip、缺省值不掛 URL。
- 沿用 `graph-compat`：新索引舊與舊資料（v3↓）不需型別 break；`normalizeNode`、`normalize.*methodology` 對新 `unit` 字段容忍空值。
- P0 legacy `data/*.json` 仍可開（單位字段缺省→`patent`，行為不變）。
- P1 同義詞 `input layer` 合併照常；機構類型治理架構複用不改動核心。

---

## 7. 必須同步改的程式碼（P4 範圍）

`types/graph.ts`、`lib/graph-builder.ts`、`lib/db/analyses.ts`、`lib/graph-compat.ts`、`lib/graph-view.ts`、`lib/analyze-limits.ts`（機構單位支持）、`lib/db/applicants.ts`（新增類型字段）、`lib/institution-type.ts`（新增：分類規則＋治理）、`lib/view-url.ts`、`db/migrations/005*`、UI（`GraphViewer`、`GraphLegend`、`Sidebar`、`GraphLayout`、新機構節點 detail）。

---

## 8. 驗收條件（只引用 P4 內部）

> 以 live DB 的樣本分析為基準。凡可自動化者用 vitest；視力/交互者用 agent-browser。

- **V1** 切換到「機構」視圖：節點為機構、邊為「共享 ≥k 概念」，點開邊出示共享概念清單——與 DB `edges.shared_index[]` 一致。（自動化純量＋agent）
- **V2** 門檻/權重/不透明切到「家」後，套 `support_applicants`；UI 標籤顯示「家」。
- **V3** 節點大小數值與圖例字串在兩單位下相符（篇用 `support_patents`、家用 `shared concept/applicant` 計量），無寫死字串殘留。
- **V4** 社群持久化含 `unit` 維度：`select distinct unit from communities` 回 `{'patent','applicant'}`，且同 id 兩單位色碼（unit,id）key 不同（檢查色盤輸出。）
- **V5** 全量計算驗證：把 `minSupport` 從 1→5，`jaccard`/`npmi`/`s` 的** DB 值不變**；僅渲染邊數變化。（Vitest 對 DB 值）
- **V6** NPMI：抽查已知 `p_ij=1` 的對，DB 值為 `NULL`、前端顯示「—」，且不被排序；`clamp(−1,1)`（自動化）。
- **V7** association strength 按各家公式，為同圖排序唯一、不當線寬；圖例印膨脹/跨圖限制。
- **V8** 機構類型：給出的實例申請人（中國信託→銀行、富邦→保險、某大學→大學）分類正確；`unknown` 屬可人工改並跨分析生效。
- **V9** 稀疏/空資料行為（資料-agnostic）：實驗把分析縮到極少篇，兩單位下都能端正常提示「資料不足」而非視圖崩或錯密集圖。
- **V10** 回歸：既有概念圖、P1 同義、P3 漸層、view-url round-trip 皆綠（`pnpm test`、`next build`）。

（附註：本初稿刻意不含 P6 統計時序、P5 IPC、P7 戳記 — 留接口。）

---

## 附錄 A：實測基準（樣本）

live DB 的「40 篇樣本分析」（`61348c1f…`）：194 概念、861 邊、27 社群、56 家申請人（`applicant_key` 已封釘，含中國信託／彰銀／三井住友／多家保險／宁夏大学）。
樣本含非金融產業申請人——**屬開發樣本特性，非本系統要處理（決策 8）**。