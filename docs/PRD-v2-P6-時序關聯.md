# PRD v2 / P6：依中位申請年排序的技術關聯圖（規格 v1.1）

**日期**：2026-08-09
**前置**：P0（資料層）、P3（概念時間）、P4（關聯度與分析單位）、P5（IPC）
**上位需求**：`docs/PRD-v2-意圖.md` P6（時序先後）＋老師拍板的三圖收斂（2026-08-09）
**審查**：Codex（gpt-5.6-sol，read-only）嚴審後修正；4 個 blocking 全數接受（R4/R5/R6/R10）
**名稱**：本圖正式名稱「**依中位申請年排序的技術關聯圖**」（Technology Relationship Graph Ordered by Median Application Year）。**不再**稱「技術演進圖」「前因→後果」——本圖不宣稱因果。

> ## ⚠️ 2026-08-09 修訂／權威狀態
> **本次校正取代任何將 P6 時序 layout 當成預設概念圖的解讀。**
>
> - **預設概念視圖（default concept view）**＝community pre-spread + ForceAtlas2 community clustering；它是正常 `mode=concept` 的 `GraphViewer`，且必須保持預設。
> - **時序衍生視圖（optional temporal derived view）**＝依 `median_year` 的序數 Y-band layout；只能經明確使用者選擇／URL mode 啟用，現階段尚未實作為 UI mode，絕不得靜默取代預設概念視圖或凍結匯出。
> - `median_year` 等時序 metadata／statistics、`temporal_directed` 箭頭、opacity 語意、citation evidence/conflict 與 I1–I5 scope invariant 仍保留；Y-band 僅屬時序衍生視圖。
> - **Canonical Offline HTML UI export**＝已登入的 POST，從 active live `getPositions()` 擷取座標；離線 HTML 只序列化並呈現 active mode，使用凍結 live coordinates + `physics:false`。缺少 frozen snapshot 時 runtime 顯示錯誤並停止，不會計算 temporal/stabilized fallback；`GET /api/export/{id}` 立即回 `405`（`Allow: POST`）並指示使用分析頁的「離線 HTML」按鈕。
> - `GraphLegend` 已在正常概念模式移除 temporal legend；該 prose 只保留給未來明確時序 mode。

---

## 0. 最高層 invariant（I1–I5；P6 一切規則由此推導）

> **I1 — Cohort consistency（最高優先）**
> 同一張圖內所有統計量**與所有視覺編碼必須來自同一個 `analysis_scope`**。
> node size／concept patent_count／median_year／first/last year／edge support／relation_weight／citation evidence
> 全部皆自同一批資料重算（不得 size=subset、median=全量）。

> **I2 — Temporal semantics**
> `median_year` 統計與 `temporal_directed` 箭頭只表示 active scope 內的序數先後；不表示因果、演進或等比時間距離。**只有在明確啟用時序衍生視圖時**，Y 軸才表示該序數關係；預設概念視圖不得因此取得 median-based Y 座標或 fixed-Y。

> **I3 — Tie semantics**
> median 相同或任一端缺值 → 無 temporal direction；任何 hash、label、ID **不得**打破時間 tie。
> hash 只允許作用於**時序衍生視圖**同一 Y band 內的 X/lane 與輸出順序（見 §6），不參與任何 temporal 判定。

> **I4 — Encoding separation**
> `width = relation weight`、`opacity = 支持專利計數的視覺強弱`、`citation = 獨立的證據層/badge`，三者一律各不相關，也不與時間編碼互寫；此資料／邊／citation invariant 適用於所有視圖，不以 Y-band 為前提。

> **I5 — Canonical comparison**
> 多資料集比較必須基於 canonical concept/applicant identity 與明確的 A/B comparison universe；**不得以 display label 做集合比較**。

---

## 1. 目的與三圖收斂（不取代預設概念視圖）

老師的三件事：**時間**、**關聯與單位**、**先後**。
2026-08-09 定案：產品收斂成**三張圖**，各自回答不同問題，不做「一張萬能圖」。**三圖計畫不表示以①取代正常 `mode=concept` 的預設概念視圖。** 預設概念視圖仍是 community pre-spread + ForceAtlas2 的 community clustering；時序圖只能是另行明確選擇的衍生視圖。

| 圖 | 樣態 | 回答 | 階段 |
|---|---|---|---|
| **① 依中位申請年排序的技術關聯圖（時序衍生視圖）** | 概念節點；僅在明確啟用時 Y＝median-year 序數、邊＝關聯 | 哪些技術先出現／後來發展／彼此高度相關 | **P6＝本規格；optional，UI mode 目前未實作** |
| **② 機構–技術二部圖** | Applicant ↔ Concept | 哪間學校做哪些技術、哪些公司學校做相同技術、哪個技術競爭者最多 | P4 機構網絡進化（另規格） |
| **③ 多資料集比較圖** | Overlay／Intersection／A-only／B-only／Difference＋指標 | A/B/C Excel 的共同與差異 | 獨立分析模型（另規格） |

機構相似度圖（institution↔institution＝「兩家共享多少技術」）是②的**衍生**，不混入同一張。

---

## 2. 時序衍生視圖的視覺 encoding（定案；僅明確啟用時適用）

**以下 visual encoding 規範只在使用者經明確選擇／URL mode 啟用時序衍生視圖時適用。** `width`、`opacity`、citation 與 scope 的資料語意仍跨視圖保留，但不能因為有 `median_year` 或 `temporal_directed` 邊，就靜默啟用 temporal layout。**預設概念視圖不得呼叫 `computeTemporalLayout`，不得設定 median-based coordinates 或 `fixed: { y: true }`；它維持 community pre-spread + ForceAtlas2 community clustering。**

| 時序衍生視圖的編碼 | 值 |
|---|---|
| Y position | 時間先後（active scope 內 `median_year` 的**序數排序**，節點不重疊） |
| X position | 群聚／排版；**同一或相近時間層內，較相關的概念盡量靠近**（版面偏好，不是距離指標） |
| edge width | 技術關聯強度（relation_weight；模型見 §9） |
| edge opacity | 支持專利計數的視覺強弱（§8；不叫 confidence） |
| arrow | `temporal_directed` 的時間先後（earlier → later；§6）；箭頭資料語意可保留，但不會自行啟用 Y-band |
| node size | 該概念在 **active scope** 內的專利數 |
| node color | Excel 資料集／IPC 分類／機構類型（沿用 P2／P5／P4 色盤） |

**「線的距離」語意（定案）**：時序衍生視圖不宣稱「線越短＝越相關」——因為 Y 受時間約束（A 2010、B 2020 即使高度關聯也必須垂直分開）。「相關越近」實作在 **X 軸同層靠近**；正式定量關聯只能看線寬／數值。**只有時序衍生視圖啟用時**，圖例才印：

> Vertical position indicates the ordinal ranking of median application year and does not imply causality or proportional temporal distance.

預設概念視圖不得印這段 temporal legend。`GraphLegend` 已在正常概念模式移除該 prose；只有未來明確 temporal mode 才可顯示。
---

## 3. 資料與 median 語意（R5 修正）

**median 改用真統計中位數（允許小數）**，不再 lower-median 整數化：

| 目前（錯誤） | 新（標準 median） |
|---|---|
| `[2018, 2019]` → 2018 | `2018.5` |
| `[2018, 2024]` → 2018 | `2021.0` |

- `median_year` 型別：**DOUBLE PRECISION（REAL）**；migration `007_p6_temporal.sql` 已完成 INTEGER → DOUBLE PRECISION，並新增 q1/q3 與 leave-one-out span 欄位。
- 概念節點至少保存：
  ```
  first_year, q1_year, median_year, q3_year, last_year, patent_count
  ```
- **stability（不帶主觀門檻）**：`median_loo_span`＝leave-one-out（逐篇移除）後 median 可能移動的範圍。**第一版不拿 stability 改箭頭**（規則不膨脹，只存的顯示）。
- 圖上 arrow 精確語意：「節點依該分析範圍內的中位年份排序。」不寫「技術 A 演進成 B」。

資料（P3 計算鏈）需同步：`lib/concept-time.ts`、DB migration（雙單位同步）。

---

## 4. 年份窗三詞（禁止只用 year_window）

| 詞 | 定義 | 例子 |
|---|---|---|
| `quality_year_bounds` | 資料清理合法範圍（資料品質） | 1990–2026 |
| `analysis_year_filter` | 老師目前分析選用的資料 cohort | 2015–2025 |
| `layout_time_band` | 僅限明確時序衍生視圖的純 UI Y 軸 band／lane；預設概念視圖不得建立或套用 | — |

`analysis_year_filter` 才是 cohort：`median_year`／所有衍生指標都對它重算；只有明確時序衍生視圖的 Y-band 使用該 median（見 §5）。`layout_time_band` 不是預設概念視圖的 layout 選項。

---

## 5. Cohort consistency（R6；I1 落地，最高優先）

**Projection contract**：每次渲染/分析先決定一組 scope：

```
analysis_scope_id := f(dataset, source_files, ipc_filters, analysis_year_filter,
                       institution_type_filter, 其他 active 分析篩選)
```

- 每個 derived metric 帶 `derived_from_scope_id`。
- debug build 可 assert `node.scope_id == edge.scope_id == graph.scope_id`。
- 範例：篩 `來源=Excel A`、`ipc=H01L`、`年=2015–2025`、`機構類型=大學` → node size、concept median、first/last year、edge support、relation_weight、citation badges **全部**由同一批子集重算。
- **禁用**（現況 bug）：`size = H01L 子集 / width = H01L 子集 / median = 全量`。

**年份窗模式**：預設 **window-conditioned** —— 篩什麼 cohort 就重算 median（例：全史 median 2019 → 切 2020–25 後 median 2023）。另提供明確的 reference mode：

```
Temporal reference: ○ Active analysis scope     ● Full-history reference
```

預設 Active；full-history 是「明確且標示」的模式，不偷混。

---

## 6. 建邊規則（時間；DAG by construction＋I3）

- **時間可判定**定義：兩端 `median_year` 皆有值**且不等**。
- 有向邊（時間）只在 `time_rank(source) < time_rank(target)` 時才建立——**建邊階段即不可能成環**（新資料構造上不會有 cycle）。
- `time_rank` 排序鍵：`median_year`（REAL）主鍵；**排名相同就沒有方向**（I3）；`layout_seed = hash(label/id)` **只**負責同一個 Y band 內的 X/lane 排列與輸出順序，**不參與任何 temporal 判定**（Codex R4）。
- 不可判定的 pair → **不畫時間箭**，回退為無向（`related_to`／共現；§9）。
- 既有非時間邊（共現結構）本就無向，不在此規則內。

**legacy/corrupt 產生的 cycle 才走 fallback（Codex R14 修正：不再發明跨尺度 strength）**

```
降級鍵：( relation_support ASC, abs(delta_median) ASC, canonical_edge_id ASC )
```

選第一條降級為 `related_to`；同時寫：

```
warnings.temporal_cycles_broken += {
  edge_id, old_source, old_target, support, delta_median,
  reason: "legacy_or_corrupt_graph"
}
```

正常新規建圖路徑上不存在環；fallback 只是 legacy/corrupt 的防呆。

---

## 7. Citation：獨立證據層（R10／Codex R8）

**門檻（只決定「citation-supported」存在與否，不決定 temporal 方向）**：

```
winner = max(forward, reverse)
loser  = min(forward, reverse)
net    = winner - loser

winner == 0 && loser == 0   → no citation evidence
winner >  0 && loser == 0   → ratio := +Infinity
loser  >  0                 → ratio := winner / loser

citation-supported := (net >= 2) AND (ratio >= 2)
```

- **temporal 方向一律由 rank 決定（先→後）**；citation 的方向可能與其相反——此時**方向不改**，加 badge「conflict」並寫 `warnings.temporal_direction_conflict`（含兩邊數值），UI 以衝突徽章標示。
- citation 四態 badge（與 width、opacity、order 三向正交）：
  ```
  citation aligned      → badge / edge 外框標記
  citation conflicting  → conflict badge
  citation insufficient → 無 badge
  citation absent       → 無 badge
  ```

**citation-only 邊＝獨立虛線層**：當 A/B 共現 = 0（無 Jaccard/NPMI），**不得**硬塞 weight=0 的關聯邊：
- 主圖只畫 `relation_edges`；
- `citation_edges`（獨立虛線層）預設隱藏、可切換；
- 已有 relation 邊的 pair 才顯示 citation badge；
- schema 分兩組表 view（`relation_edges` / `citation_edges`），**不要全塞進同一個 concept_edges**。

---

## 8. opacity（R10 定案）

- opacity **只表示支持專利計數的視覺強弱**，命名 `support_strength_visual`（宣告「edge opacity increases monotonically with supporting patent count」）。
- **禁 per-graph min-max 正規化**（破壞跨圖比較）；用固定飽和函數：

```
opacity(s) = 0.30 + 0.70 × (1 − e^{−s/5})
```

| support | opacity |
|---:|---:|
| 1 | .43 |
| 2 | .53 |
| 3 | .62 |
| 5 | .74 |
| 10 | .91 |

- `tau=5` 是**視覺 heuristic**——寫入 `visualization_methodology` 與 PNG/HTML metadata，不是統計參數。
- **citation 完全不出現在 opacity**（只用徽章/虛線）。

---

## 9. relation weight（沿用 P4 模型）

`relation_weight`（線寬）＝現有 P4 的 `jaccard`｜`npmi`（全量計算、門檻只過濾顯示）。不新增公式；鎖定「width、opacity、citation 三者互不相干」。

---

## 10. 多資料集比較圖（另立規格；本檔 pin 分析模型）

獨立分析模型，不是 P2 的顯示小改。至少 pin：

```
dataset_a_id / dataset_b_id
analysis_scope_a / analysis_scope_b
comparison_universe
canonical_concept_id / canonical_applicant_id        ← 絕對不能用 display label
```

集合比較定義（避免撞名）：

```
concept_set_jaccard = |C_A ∩ C_B| / |C_A ∪ C_B|
```

**不泛稱 jaccard**（未來尚有 edge_set_jaccard / applicant_set_jaccard / ipc_set_jaccard）。

**A/B 雙 median（small multiples 為主比較）**：A 圖與 B 圖並列，同一 canonical 概念同色、hover 互相 highlight、zoom/filter 同步、旁顯示 `Δmedian`＋comparison table；**不做 pooled Y**。

---

## 11. 機構–技術圖（另規格；本檔只定定義）

- 主需求：**Applicant ↔ Concept 二部圖**（清華大學─先進封裝─台積電這種樣態）。
- 二部圖邊語意是「機構投入該概念」，**不可套用「技術關聯強度」語意** → width/size 尺度按邊型/節點型分流，兩類節點分量或形狀。
- Institution–Institution「共享多少技術」是**衍生**分析（similarity graph），與二部圖分開。

---

## 12. 資料與遷移（已落地狀態）

- migration `007_p6_temporal.sql` 已將 `concepts.median_year` 轉為 DOUBLE PRECISION，並新增 `q1_year / q3_year`、`median_loo_min / median_loo_max`。
- migration `007_p6_temporal.sql` 已新增 `citation_edges`，並在 relation `edges` 加入 `citation_supported`、`citation_direction_conflict`。
- migration `008_p6_scope_id.sql` 與現行 graph metadata／DB round-trip 已承接 scope_id；新增篩選維度仍須維持 I1。
- 三種年份窗名詞與視覺方法聲明由 `lib/temporal.ts` 單源提供；只在明確 temporal mode 顯示 temporal layout 圖說。

---

## 13. 驗收（機械可查；詳列實作時展開）

- I1：切子集（IPC/來源/年）後 median／support／width／size 與 scope 全同（SQL 抽查）；切回全量恢復。
- I2/I3：median 相等或缺值的 pair = 無 temporal arrow；hash 不進 predicate（SQL 可數，單位測試保護）。
- I4：同 support 跨圖 opacity 相同；citation 不影響 opacity。
- citation：四態（無證／+Infinity／達標／不達標）＋conflict badge＋warning 皆有 fixture。
- fallback：餵 legacy 環 fixture → 照字典序選一、可重現、warning 完整（edge_id, old_source/target, support, delta, reason）。
- **預設概念視圖 hard guard**：正常 `mode=concept` 的 `GraphViewer` 路徑不得呼叫 `computeTemporalLayout`，也不得由 `median_year` 設定座標或 fixed-Y；預設截圖必須呈現 community pre-spread + ForceAtlas2 的社群群聚。
- **時序衍生視圖 hard guard**：必須有明確使用者選擇／URL mode 才可進入，並以與預設概念視圖分開的截圖驗收；未選擇時不得出現 horizontal median-year bands。
- **圖例 hard guard**：temporal legend 只可在明確時序 mode 顯示；正常概念模式已移除該常駐 prose。
- **凍結匯出 hard guard**：canonical POST 匯出的 active mode 相對點擊時 active live `getPositions()` 必須 `max|Δ|=0`，使用 frozen live coordinates + `physics:false`，且不得重算任何 layout；離線 HTML 只呈現 active mode，缺少 frozen snapshot 即 hard-gate 顯示錯誤。`GET /api/export/{id}` 固定回 `405`／`Allow: POST`，無 Legacy GET 或非初始 mode 的 temporal/stabilized fallback。
- 既存 280 tests 保持綠。

---

## 14. 誠實記限／目前實作狀態

- **預設概念視圖**是正常 `mode=concept` 的 community pre-spread + ForceAtlas2 community clustering，並非 median-year Y-band。
- **時序衍生視圖**才使用 Y 序數、非等比的 median-year bands；它目前尚未實作為 UI mode，未來也只能由明確使用者選擇／URL mode 進入。median 是「中心」而非「起點」——分布看 q1/q3/loo 的顯示，v1 不影響箭頭。
- citation 門檻（net≥2 且 ratio≥2）為**設計規則值**，非統計檢驗值；徽章只代表「存在引用支持」。
- opacity 是視覺 heuristic（tau=5），不是統計 confidence。
- `GraphLegend` 已在正常概念模式移除 temporal legend；它只會隨未來明確 temporal mode 顯示。
- canonical Offline HTML UI export 是 authenticated POST + active live frozen positions，且只呈現 active mode；缺少 snapshot 即顯示錯誤並停止。`GET /api/export/{id}` 已固定為 `405`／`Allow: POST` 指引，沒有 temporal/stabilized fallback。
- 機構二部圖與多資料集比較圖另立規格；本檔只定義①時序衍生技術關聯圖與其方法學骨架，不改變預設概念視圖。
- I1 是實作紀律核心：任何新增篩選維度，都回到 §5 的 Projection contract 重新界定。
