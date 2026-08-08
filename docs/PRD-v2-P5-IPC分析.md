# PRD v2 / P5：IPC 分類分析（規格 v1.0）

**日期**：2026-08-08
**前置**：P0（專利節點已帶 `ipc5[]`／`ipc_primary`／`ipc_depth`）、P4（視圖層重建與分單位指標）
**上位需求**：`docs/PRD-v2-意圖.md` P5 —— 五級層級 slider（預設 L3）、樹狀多選篩選、依 IPC 著色。
**範圍**：IPC 篩選＋依 IPC 著色。**不新增 IPC 節點層**（一篇最多 13 個 IPC，建節點會讓圖爆掉）。

## 0. 這份文件的範圍

**只規範 P5。** 機構視圖／單位指標（P4）照舊；「先後順序」屬 P6。本檔只定義 IPC 如何進視圖層：
五級投影、樹狀多選篩選、依 IPC 著色、URL/離線同步。**不做** IPC 節點、不做 IPC 之間的分析（如
「哪些概念橫跨哪些 IPC」屬未來），不做 IPC 本身的時間分析。

**驗收條件只引用 P5 內部。** 編號沿用「S（定案決策）」「N（新）」「R（回歸）」字首。

## 1. 目的

老師想回答：「這批專利的技術分類長什麼樣、我只要某幾個 IPC 的專利時圖變成什麼樣」：

1. **五級層級可切** —— L1 部 → L2 類 → L3 次類 → L4 主類 → L5 次目，預設 **L3 次類**（`G06Q` 粒度講「金融科技」就夠粗）。
2. **樹狀多選篩選** —— 照 IPC 的階層樹（部→類→次類→主類→次目）瀏覽，在**目前層級**勾選多個 key；命中任一即納入該專利（與 P2 來源檔並集同語義）。
3. **依 IPC 著色** —— 概念節點由其涵蓋專利的**優勢 IPC** 上色，一眼看出「這個技術概念落在哪個分類」。

## 2. 定案決策（S1–S8）

| # | 問題 | 定案 |
|---|---|---|
| S1 | 五級投影 | 正規化 key（P0 §3.2，形如 `G06Q10/10` 或深度 3 的 `G06Q`）投影：L1=`G`、L2=`G06`、L3=`G06Q`、L4=`G06Q10`、L5=`G06Q10/10`。**深度 3 的 key 沒有 L4/L5**（P0「不參與 L4/L5 分組統計」，投影回 null）。無法投影（無 ipc5／空值）的專利：**篩選時不命中、著色中性灰**。 |
| S2 | 篩選語義 | 專利若 ∃ 其（投影到目前層級的）IPC key ∈ 選取集合 → **納入**（多鍵取任一，OR）。IPC 篩選與 P2 來源檔篩選**同時作用時為 AND**（專利必須兩者皆中）。未勾選任何 key＝不做 IPC 篩選（socket 全圖）。 |
| S3 | 篩選如何重算 | **純視圖層重建**（不重跑 LLM、不加 DB 欄）。與 P2 同一條路：由結構邊（`包含`／`申請了`）重建專利↔概念／專利↔機構索引，只留「IPC 命中 ∩ 來源命中」的專利子集 → 概念集、`frequency`（篇）、`applicant_count`（家）、兩個單位的 `support`、`jaccard`／`NPMI`／association 用 `computeUnitMetrics` 重算（S3 沿用）。門檻隨單位規則不變。 |
| S4 | 依 IPC 著色 | `colorMode='ipc'` 只作用於**概念視圖**：節點用**優勢 IPC** 著色——涵蓋專利在各該層級投影 key 的**多數票**（同票按字典順序較小者勝）；無任何 IPC 專利的概念保持中性灰。與 P2 S1 一致：**優勢（dominant）永遠照目前子集重算**（篩到單 IPC 時，成為該 IPC 的專利優勢自然集中）。機構圖／脈絡圖不做 IPC 著色（脈絡圖維持原有交色）。 |
| S5 | IPC 色盤 | 獨立色盤 `IPC_COLORS`（12 色，避開來源檔色盤／社群色盤語意混淆）。key → 色 = 該層級**排序後索引** mod 12；圖例與節點用同一規則，跨圖穩定。 |
| S6 | 切換層級 | 改變 `ipcLevel`（1…5，預設 3）會**清空 IPC 篩選**（不同層的 key 不互轉）並**重畫樹**；`colorMode='ipc'` 的著色隨新層級重算。UI 明示「切換層級會清空 IPC 篩選」。 |
| S7 | URL 同步 | `colorMode=ipc`；`ipcLevel=N`（僅 N≠3 時掛）；`ipc=<key>` 可重複。缺省不掛。離線 HTML 的 `parseExportOptions` 接受同組參數。 |
| S8 | 樹狀多選 UI | 樹到目前層級（根=L1），**只勾選該層級葉**；上層節點的 checkbox 不做（半選／全選太複雜，先記限制）；顯示每 key 的專利數；「全部 IPC」reset。層級 slider 為 range input（1–5，label L1..L5）。 |

## 3. 資料

**專利節點已帶**（P0，graph-builder 保留不變）：`ipc5?: string[]`（正規化 key）、`ipc_primary`、`ipc_depth`。
**無 migration**：全部為 view 層計算（graph-node 帶的 ipc5 在重載後依然可重建，同 P4 機構視圖）。

新純函式（lib 新檔 `lib/ipc-filter.ts`）：

| 函式 | 語意 |
|---|---|
| `ipcKeyAtLevel(key, level)` | 正規化 key → 該層投影；無投影回 `null` |
| `ipcKeysOfPatents(ipc5, level)` | 專利 → 去重的該層 key 集合 |
| `ipcTreeOf(graph, level)` | 樹狀（每節點 key/count/children），count＝該 key（該層投影）命中的不同專利數 |
| `ipcSortedKeys(graph, level)` | 全 key 排序（色盤 index 用） |
| `ipcColorOf(key, sortedKeys)` | 循環色盤 |
| `applyIpcColour(graph, nodes, level)` | 概念節點改優勢 IPC 色（純函式、不 mutate） |
| `ipcLegendItems(graph, level)` | `[{key, color, count}]`（count 遞減；供圖例顯示 top N） |

## 4. 驗收條件

- [x] `ipcKeyAtLevel`：L1..L5 對 `G06Q10/10` 正確；深度 3（`G06Q`）→ L4/L5 回 null；`ipc(f)` 非法不回錯。
- [x] `ipcTreeOf`：樹階層與專利數正確（父節點計數＝其投影專利集合聯集）；level 切換後樹的重建正確。
- [x] `selectGraphView` 帶 `ipcFilter`：概念子集、`frequency`／`applicant_count`／co-occurrence support（兩單位）重算、minSupport 按子集；與 sourceFiles 為 AND。
- [x] 機構視圖（專利層過濾）／脈絡視圖（patent 過濾）與概念視圖共用同一 IPC 子集。
- [x] `colorMode='ipc'`：概念節點色＝優勢 IPC（同票取字典較小）；無 IPC 專利中性灰；著色隨子集重算。
- [x] view-url round-trip：`ipcLevel=4&ipc=A&ipc=B` → 反向一致；缺省不掛；非法值忽略。
- [x] export-html `parseExportOptions` 接受 ipc/ipcLevel；匯出視圖沿用同一 `selectGraphView`（色已入節點）。
- [ ] UI：層級 slider（L1–L5 預 L3）；樹狀多選（葉可勾）；「全部 IPC」reset；切層級清空篩選並明示；「依 IPC」選項只在有 IPC 資料時出現。
- [ ] 圖例：`colorMode='ipc'` 時顯示 IPC 色塊與「優勢 IPC」說明（前 N + 「+M 其餘」）。
- [x] 回歸：全套 v2 測試綠（R）。

## 5. 誠實記限

- 樹狀多選目前只支援「該層級葉」多選；上層母節點勾選（自動帶所有後代）留作未來。
- 「優勢 IPC」是粗糙的多數決：概念專利分散在多 IPC 時只顯示單一色，要看「跨 IPC 分布」需未來新增節點層或餅圖。
- 機構視圖不著色（機構色＝機構類型優先）；IPC 只作用於概念視圖。
- colorMode='first_year' 與 colorMode='ipc' 互斥自然成立（一次只選一種）。
- P7 戳記需加 `ipcLevel`＋`ipcFilter`（規格記入）。