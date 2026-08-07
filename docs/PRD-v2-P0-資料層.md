# PRD v2 / P0：資料層

**版本**：P0-1.0
**日期**：2026-08-05
**狀態**：待使用者核准 → 實作
**基準**：`docs/PRD.md` v1.2（已實作）
**後續期意圖**：`docs/PRD-v2-意圖.md`

---

## 0. 這份文件的範圍

**只規範 P0：把兩種 Excel 正確讀進來、正確去重、正確落庫、正確讀回。**
不含任何圖譜功能（時間、關聯度、時序、IPC 篩選 UI、PNG、同義詞）——
那些在 `PRD-v2-意圖.md` 只留意圖，等 P0 落地後再逐期詳規。

**驗收條件只引用 P0 內部的東西。** 前一版把「重啟後 IPC 篩選／單位切換可用」
寫進 P0 驗收，造成 P0 依賴最後一期的六處循環依賴。本檔不再這麼寫。

所有資料事實均對 `專利彙整(全) (1).xlsx`（1869 筆）與 `專利爬蟲.xlsx`（1500 筆）
全量實測，日期 2026-08-04／05。

---

## 1. 兩種格式與工作表選取

| | 格式 A：爬蟲版 | 格式 B：老師版 |
|---|---|---|
| 判定指紋 | `搜尋關鍵字` 或 `專利名稱(中)` | `IPC5-1` |
| 工作表 | 單一 `專利清單` | **10 個**，資料在 `原始資料` |
| 欄位數 | 9 | 83 |
| 有效列數 | 1500 | 1869（工作表 1888 列，尾端 18 列為空白列） |

**工作表選取（格式 B）**

1. 優先以名稱 `原始資料` 定位。
2. **絕不整檔讀取所有工作表**：`發明人合併` 有 **1048576 列**（Excel 上限，
   公式填滿），讀入會耗盡記憶體。只讀選定的那一張。
3. **fallback 不可只看 `IPC5-1` 指紋**：實測 `雷達圖分析` 工作表表頭
   也含字面 `IPC5-1`（1559 列，缺 `專利名稱`／`摘要`／`申請日`），會被誤選，
   使用者只會看到「缺少必要欄位」而不知真因。fallback 須**同時**滿足：
   - 表頭含 `IPC5-1`
   - 表頭含 `摘要`、`專利名稱`、`申請號` 三者
   - 非空資料列 > 500
   - 表名不在黑名單：`發明人合併`、`雷達圖分析`、`IPC3分析`、`IPC5分析`、
     以 `專利件數分析` 開頭者、以 `別分析` 結尾者
4. 都不命中 → 錯誤訊息列出所有工作表名與各自表頭。

**尾端空白列剔除必須先於一切欄位統計**：以 `專利編號`（格式 B）／
`專利名稱(中)`（格式 A）非空為有效列判準。樣本檔第 1870–1887 列除
`案件狀態` 一格外其餘 82 欄全空；若先統計再剔除，`案件狀態` 會多出兩個
不存在於真實母體的值（見 §5.4）。

---

## 2. 欄位對應

| canonical | 格式 A | 格式 B | 備註 |
|---|---|---|---|
| `title` | `專利名稱(中)` | `專利名稱` | 必要 |
| `abstract` | `摘要` | `摘要` | 必要；需剝 BOM（§3.3） |
| `title_en` | `專利名稱(英)` | — | |
| `application_number` | `申請號`（`TW113123858`） | `申請號`（`111201471`） | 需正規化（§4.1） |
| `patent_number` | — | `專利編號`（`M628244`） | 出現兩次且 1869/1869 完全相同，取一 |
| `publication_number` | `公開公告號`（`TW202601532A`） | — | **與格式 B 的 `專利編號` 非同一體系，不可互相比對** |
| `filing_date` | `申請日`（字串） | `申請日`（**Excel 序列數**） | §3.1 |
| `publication_date` | `公開公告日`（字串） | `公告/公開日`（**Excel 序列數**） | §3.1 |
| `search_keyword` | `搜尋關鍵字` | — | |
| `applicants[]` | `申請人`（單欄需清理） | `申請人1..5` | §3.4 |
| `inventors[]` | — | `發明人1..21` | 只入庫 |
| `ipc5[]` / `ipc5_raw[]` | — | `IPC5-1..13` | §3.2 |
| `ipc3[]` | — | `IPC3-1..13` | 交叉驗證 |
| `references[]` | — | `參考文獻1..15` | §3.5 |
| `cited_by_count` | — | `被參考次數` | 僅 101/1869 有值 |
| `case_status` | — | `案件狀態` | §5.4 |
| `design_class` | — | `設計分類號` | 67 筆有值 |
| `priority`／`agents[]`／`gazette` | — | `優先權`／`代理人1..4`／`公報分卷期` | 只記錄 |

**編號欄位群解析**：掃描符合 `^<prefix>[-]?\d+$` 的表頭，依數字排序取非空值
去重成陣列。**不得寫死 13 或 21。**

實測值域（驗收基準）：申請人 1–2 家（`申請人3..5` 全空）；發明人 1–21 人；
`IPC5-1` 非空 1804/1869；`參考文獻n` 任一非空 255/1869。

---

## 3. 逐欄解析規則

### 3.1 日期：Excel 序列數轉換（格式 B）

格式 B 的兩個日期欄位是 **Excel 序列數（number 型別）**，實測 1869/1869 全為數字。

- 轉換：`new Date(Date.UTC(1899, 11, 30) + serial * 86400000)`
- **驗證基準**（已用 `XLSX.SSF.parse_date_code()` 與儲存格快取顯示值雙重核對）：

  | serial | 正確結果 | 交叉驗證 |
  |---|---|---|
  | `44196` | **`2020-12-31`** | `parse_date_code` → `{y:2020,m:12,d:31}`；儲存格 `w = "12/31/20"` |
  | `38016` | `2004-01-30` | |
  | `44558` | `2021-12-28` | |

  > 早期草稿曾把 `44196` 誤寫為 `2021-01-01`。若照那個錯誤斷言寫測試，會看到
  > **正確的公式**產出 `2020-12-31` 而誤判公式有錯、補上 `+1`，導致 1869 筆
  > 日期全部推後一天、跨年邊界專利歸錯年份。**以上表為準。**

- 格式 A 沿用字串解析，**不得改動**（§7-5）
- 值落在 < 1990 或 > 今年+1 → `warnings.date_out_of_range`
- `publication_date` 早於 `filing_date` 的筆數須統計並記入 warnings（不阻斷）
- 資料時間窗實測為 **2004-01-30 – 2021-12-28**（申請日）

### 3.2 IPC 正規化

**實際格式**：`G06Q-010/10` —— **連字號**分隔次類與主類目（不是空白），
主類目**零填充 3 位**。對樣本檔 **3081** 個非空值實測樣式分佈
（下表加總即 3081；早期草稿誤寫 3080）：

| 樣式 | 筆數 | 說明 |
|---|---|---|
| `A99A-999/99` | 2994 | `G06Q-010/10` 正常 |
| `A99A-999/999` | 52 | 次類目 3 位 |
| `A99A-999/9999` | 20 | 次類目 4 位 |
| `A99A-999/9` | 6 | 次類目 1 位 |
| `A99A-99/99` | 4 | **主類目 2 位 → 零填充不一致** |
| `A99A-9999/99` | 1 | 主類目 4 位 |
| `A99A -999/99` | 1 | 次類後夾空白 |
| `A99A-999/99` + `\` / `.` / `(` | 各 1 | **尾端垃圾字元** |

另有前導空白不一致（`" G06Q-040/04"`；`IPC3-1` 兼有 `" G06Q"` 與 `"G06Q"`）。

**正規化順序（不可調換）**：

1. 原值存入 `ipc5_raw[]`
2. 剝頭尾空白 → **先**剝括號版本尾註 `\s*\((19|20)\d{2}\.\d{2}\)\s*$`
   → **再**剝尾端非法字元 `[^A-Z0-9/]+$`
   > **子步驟順序不可顛倒**（實作階段發現的規格錯誤）：先剝尾端非法字元會把
   > `G06Q-040/00 (2012.01)` 的 `)` 吃掉、變成 `G06Q-040/00 (2012.01`，
   > 版本尾註的 pattern 就再也匹配不到，無法還原。版本尾註本樣本未出現，
   > 為防禦性保留。
3. 移除所有內部空白（含 **U+00A0 不換行空格**與 TAB —— 實測樣本檔
   列 54 `M616135` 的 `IPC5-5` 是 `H02M -001/42`，中間夾的是 U+00A0 而非半形空白；
   另有 `IPC5-1` 以 TAB 開頭者）
4. **anchored 全字串驗證**：`^([A-H]\d{2}[A-Z])-?(\d{1,4})\/(\d{1,6})$`
   或只到次類的 `^[A-H]\d{2}[A-Z]$`（後者 `ipc_depth = 3`）
5. **主類目去前導零**：`010 → 10`、`09 → 9`。必要步驟——實測
   `G06K-09/00` 與 `G06K-009/00` 同時存在，不去零填充會分裂成兩組
6. 驗證失敗 → `warnings.ipc_unparseable`

五級（供後續期使用；P0 只負責產出這些鍵）：

| 級 | 內部鍵 | 顯示形 |
|---|---|---|
| L1 部 | `G` | `G` |
| L2 類 | `G06` | `G06` |
| L3 次類 | `G06Q` | `G06Q` |
| L4 主類目 | `G06Q10` | `G06Q 10` |
| L5 次類目 | `G06Q10/10` | `G06Q 10/10` |

`ipc_depth = 3` 的值 L4 = L5 = L3，**不參與 L4／L5 分組統計**。
`ipc_primary = ipc5[0]`（來自 `IPC5-1`）。
`IPC3-n` 與從 `IPC5-n` 截出的 L3 集合比對，不一致 → warnings。

### 3.3 摘要剝 BOM

實測 32/1869 筆 `摘要` 以 U+FEFF 開頭。剝除字串開頭的 BOM 與零寬字元
（`^[﻿​-‍]+`）。

### 3.4 申請人

- **格式 B**：取 `申請人1..5` 非空值，**不執行空格截斷清理**（已是乾淨名稱）
- **格式 A**：沿用 v1.2 F-05 規則（全形／半形空格截斷 + 括號截斷 + `；` 分隔）
- **正規化只產生合併鍵，不覆寫欄位值**：`normalizeApplicantName()`
  （去前後空白、統一全半形、統一公司尾綴寫法）的輸出存為 `applicant_key`，
  **只用於決定哪些字串合併成同一節點**。
  - 格式 A 的 `applicant` 欄位值必須與 v1.2 **逐字元相同**。現況
    `lib/excel-parser.ts:210` 完全沒有全半形正規化（grep
    `normalize|全形|NFKC|uFF` 零命中）；套新規則會把
    `ＪＸ金屬股份有限公司` 變成 `JX金屬股份有限公司`，違反 §7-5
  - 節點 `label` 取該群中 `application_number` 字典序最小者的原值
    （確保與上傳順序無關）
- `applicant_raw` 保留原始值

### 3.5 參考文獻

**比對鍵是 `專利編號`，不是 `申請號`。** 實測 1119 個非空值：

| 類別 | 筆數 |
|---|---|
| 外國專利（`CN`/`KR`/`JP`/`US`/`EP`/`WO` 前綴） | 620 |
| 含中文的不規則值（`美國60/168,89419991203`） | 12 |
| **對上本資料集 `專利編號`** | **105** |
| 對上本資料集 `申請號` | **0**（命名空間完全不同） |
| 台灣編號但不在本資料集內 | 382 |

正規化：大寫化 → 剝 `TW` 前綴 → 去除非 `[A-Z0-9/]` → 剝尾綴 `U`
（`TWM563592U` → `M563592`）。

**不得跨專利類型合併**：`D`（設計）、`M`（新型）、`I`（發明）前綴必須保留，
否則 `D199419` 與 `M199419` 會被視為同一筆。

- 對上 → 寫入 `citations` 表（**P0 只落庫，不建圖上的邊**；`citation` 邊屬後續期）
- 對不上 → 只記在 `patents.external_references[]`，**不建節點**
- **「無法解析」的判準**（前一版未定義，實作階段補上）：**原值含非 ASCII 字元**。
  實測恰好命中那 12 筆（`美國60/168,89419991203` 這類國名＋案號＋日期黏在一起的）。
  620 筆外國專利（`US2017/0041332A1`、`TW201502845A` 等）全是純 ASCII，
  **算可解析、只是對不上本資料集**，因此進 `external_references[]` 而非 warnings。
  → `warnings.reference_unparseable`
- 實測可用內部引用 **105 對**（排除設計專利兩端後 93）

---

## 4. 身分判定、去重與穩定 ID

### 4.1 識別欄位正規化

| 欄位 | 規則 | 實測 |
|---|---|---|
| `application_number` | 大寫化 → **剝 `TW` 前綴** → 去除非 `[A-Z0-9]` | 格式 A `TW109208236` 與格式 B `109208236` 正規化後相等，跨格式去重才成立 |
| `patent_number` | 大寫化 → 剝 `TW` → 去除非 `[A-Z0-9]` → 剝尾綴 `U`；**保留 `D`/`M`/`I` 型別字母** | `M628244` |
| `title_key` | 去所有空白 → 統一全半形 → 去標點 | |

實測 `申請號` 樣式：8 碼 13 筆、9 碼 1856 筆（民國年 + 類別碼 + 流水號）。

### 4.2 `申請號` 不是唯一鍵（實測）

**單一格式 B 檔案內部**就有一組 `申請號` 對應兩筆完全不同的真實專利：

| 專利編號 | 標題 | 申請人 | IPC5-1 |
|---|---|---|---|
| `M546543` | 匯款系統平台 | 京城商業銀行 | `G06Q-020/10` |
| `M541619` | 車聯網事故資料紀錄與舉證系統 | 泰安產物保險 | `G06Q-050/10` |

兩者 `申請號` 都是 `106201453`。另有 132 組 `申請號` 重複（131 組為同列重記、
無害），以及 2 組（`108211626`、`109202820`）`專利編號` 相同但標題與申請日不同。

### 4.3 合併判定：有序決策程序（first match wins）

令 `pn` / `an` / `tk` 為 §4.1 正規化後的值（`pn`、`an` 可為 null；`tk` 必存在）。
**必須依序求值，第一個命中即決定**——前一版用平行表格導致分支重疊且無優先序。

```
規則 1：兩邊 pn 皆非 null
  1a  pn 相等 且 tk 相等                → 合併
  1b  pn 相等 且 tk 不等                → 不合併，warnings.patno_title_conflicts
  1c  pn 不等                           → 不合併
                                          （若 an 亦相等，warnings.appno_collisions）
規則 2：至少一邊 pn 為 null，且兩邊 an 皆非 null
  2a  an 相等 且 tk 相等                → 合併
  2b  an 相等 且 tk 不等                → 不合併，warnings.appno_collisions
  2c  an 不等                           → 不合併（正常情形，不記警告）
規則 3：其餘（至少一邊 pn 與 an 皆為 null）
                                        → 不合併，warnings.no_identifier
```

此程序**全覆蓋且互斥**：規則 1 涵蓋兩邊皆有 `pn`；規則 2 涵蓋 `pn` 缺失但
`an` 齊備（跨格式合併走這條）；規則 3 涵蓋識別碼不足。

### 4.4 合併時的欄位決勝（與輸入順序無關）

| 欄位 | 規則 |
|---|---|
| `patent_number` | 取非空者；皆非空時取該相等值（規則 1a 的前提） |
| `application_number` | 皆非空且相等 → 該值；一邊空 → 非空者；皆非空但不等 → 字典序最小 + `warnings.appno_conflicts` |
| `title`、`abstract` | 取字元數最長；等長取字典序最小 |
| `filing_date`、`publication_date` | 取最早的有效日期 |
| `ipc5[]`、`ipc5_raw[]`、`references[]`、`external_references[]`、`inventors[]` | 聯集後排序去重 |
| `applicants[]` | 聯集後排序去重，**但見 §4.6 衝突稽核** |
| `cited_by_count` | 取最大值 |
| **`case_status`** | **取「最保守」者**：任一邊為排除類（`核駁`／`不予專利`／`撤回`／`放棄`／`消滅`／`失效`）→ 合併後維持排除；否則任一邊為 `未審查`／`公開` → `is_pending`；並記 `warnings.case_status_conflicts` |
| `source_files[]`、`search_keywords[]` | 聯集後排序 |
| **legacy `applicant`** | **由合併後的 `applicants[]` 以 `；` 串接產生**（見下方修正框）。未合併的單列保持原值不變 |
| `applicant_raw`／`search_keyword` | 沿用 `title`／`abstract` 規則（最長；等長取字典序最小）。未合併的列因此仍與 v1.2 逐字元相同 |

> **修正（實測後）**：本節原先把 `applicant` 也歸到「最長者勝」，**那是錯的**。
> `lib/graph-builder.ts` 建申請人節點時是**拆解 legacy `applicant` 字串**
> （以 `；`／`;` 分隔），不是讀 `applicants[]`。若 `applicant` 只留最長的那一筆，
> 合併後的專利就會少掉申請人節點與「申請了」邊。
> 實測老師版檔案：19 筆專利的 `applicants.length > 1`，但只有 16 筆的 legacy
> `applicant` 拆解後數量相符 —— **3 筆各遺失一家機構**
> （`M601439`／`109208662`、`D206873`／`108304338`、`M529232`／`105208945`）。
> 這直接損害「哪幾家機構在做這個技術」這個核心分析維度，且 133 個測試全綠也抓不到。
>
> 修法為防禦深度兩層：① 合併時 `applicant` 由 `applicants[]` 串接；
> ② `graph-builder` 優先讀 `patent.applicants`，回退才拆字串。
>
> **②必須先對陣列去重**：`Array.from(new Set(applicants.map(s => s.trim()).filter(Boolean)))`。
> 現況 `splitApplicants()` 內含 `Set` 去重，直接改讀陣列會**失去這層保護** ——
> 實測 `專利爬蟲.xlsx` 真的有單列自身重複的情形（地址截斷後產生
> `["宋","呂","宋","宋"]`），不去重會讓該申請人的 `patent_count` 被重複計算。

> **`case_status` 不可用字典序**：`核准`(U+6838) < `消滅`(U+6D88)，取字典序最小
> 會讓「一檔標消滅、另一檔標核准」合併後變成核准，**撤銷 §5.4 的排除**、
> 該筆重新進入母體。故改用嚴重度優先。

### 4.5 穩定專利 ID

由**合併後**的欄位計算，故與上傳順序無關：

```ts
const identityKey =
    pn  ? `pn|${pn}|${tk}`
  : an  ? `an|${an}|${tk}`
  :       `noid|${tk}|${sha1hex(abstract)}|${[...applicants].sort().join(';')}|${filing_date ?? ''}`

patentRow.id = sha1hex(identityKey)     // ← PatentRow.id 的新語意
// 圖上節點 id 仍為 `patent:${patentRow.id}`（lib/graph-builder.ts:153 不變）
```

- **`tk` 必須進 key**：否則規則 1b（`pn` 相等但標題不同、判定不合併）的兩筆會
  得到相同 ID，撞 `patents` 的 `UNIQUE (analysis_id, node_id)`
  （`001_init.sql:122`）。而 `insertRows` 無 `ON CONFLICT` →
  `withTransaction` 全部 rollback → 分析卡在 running、LLM 成本已付、結果全失。
  §4.2 實測的 `108211626`、`109202820` 正是這種情形。
- **`noid` 分支必須加 abstract／applicants／filing_date**：只用 `tk` 時，
  兩筆無識別碼但標題相同的列會碰撞（同一條 rollback 鏈）。若這四者全部相同，
  則兩列在資料上不可區分，合併是正確的；仍記 `warnings.no_identifier`。
- `sha1hex()` 包住**整個** key 字串，不是只包 `pn`。
- 前綴保持 `patent:`，不加無意義的 `p:` 片段。
- **不再使用 `${filename}-${rowIndex}`**（會使結果依上傳順序改變）。
  落點：`lib/excel-parser.ts` 產生 `PatentRow.id` 之處；
  `types/graph.ts:5` 的註解須同步更新。

### 4.6 清單型欄位的衝突稽核

實測跨格式案例：`申請號 109208236` 在兩檔皆有，標題逐字相同、申請日相同，
但申請人一邊是「臺灣新光商業銀行股份有限公司」、另一邊是
「臺灣中小企業銀行股份有限公司」（其中一邊資料誤植）。單純聯集會讓
**兩家銀行都掛在同一筆專利上**。

**使用者決定（2026-08-05）：不做人工裁決介面，目標只是「兼容兩種格式」。**
因此規則簡化為：

- `applicants[]` 一律**聯集**
- 若兩邊正規化後集合**無交集**，記入 `warnings.applicant_identity_conflicts`
  （含兩邊原值與來源檔），供事後檢視
- **不做** `identity_uncertain` 旗標、不做節點標示、不做裁決 UI

> 前一版曾規劃「標記 + UI 顯著標示 + 人工裁決」，理由寫「只有 1 例」。
> **那個數字是錯的**：實作階段實測兩檔合併共 **16 例**——前一版只算了跨格式的
> `109208236`，漏掉同檔內合併也會觸發（格式 A 有 149 組同申請號重複，其中申請人
> 誤植者若干；格式 B 3 組）。16/3028 仍屬少數，且使用者已明示不做裁決介面，
> 故決定不變，但**理由更正為此**。

---

## 5. 過濾與統計

### 5.1 去重回報

回報「原始 N 筆 → 去重後 M 筆」，並提供重複清單與各類衝突清單供檢視。
**LLM 只對去重後的專利萃取一次**（本項的主要成本動機）。

### 5.2 資源上限

`/api/uploads` **從不解析 xlsx**（`:44` 只做 `Buffer.from(await file.arrayBuffer())`），
解析與去重都在瀏覽器（`components/UploadZone.tsx:93`）。真正把資料送進伺服器
記憶體的是 `POST /api/analyze` 的 JSON body（`patents: PatentRow[]`，含完整摘要），
該處只檢查 `Array.isArray(patents) && patents.length > 0`（`:189-194`），
且 `sample_size` **未 clamp** 就進 `.slice()`（`:169`、`:196`）。

| 端點 | 上限 | 預設 |
|---|---|---|
| `POST /api/uploads` | 單檔 bytes | **8 MB** |
| | 單次檔案數 | 10 |
| | 單次總 bytes（`Content-Length` 預檢，在 `formData()` 之前） | **8 MB** |
| `POST /api/analyze` | `patents.length` | 20000（超限 413，不截斷） |
| | body bytes（`Content-Length` 預檢） | **8 MB** |
| | `sample_size` | clamp 到 `[1, 20000]` |

全部可由環境變數調整（`LIMIT_ENV_KEYS`）。

#### 為什麼是 8 MB，而不是更大（2026-08-05 修正）

本檔早期版本寫「單檔 50 MB、總量 100 MB」。**那是達不到的數字**：

本專案有 `proxy.ts`，matcher 涵蓋 `/api/uploads` 與 `/api/analyze`。Next 16 只要
存在 proxy 就會 clone request body 並在記憶體 buffer（讓 proxy 與 route handler
都能讀），上限是 `experimental.proxyClientMaxBodySize`，**預設 10 MB**。超過時
官方文件原文是「the body will **only be buffered up to the limit**, and a warning
will be logged」——**請求照樣繼續執行，handler 拿到半截 body，client 收不到錯誤**。
出處：`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`
（2026-08-05 逐字核實）。

**為什麼不改成調高 `proxyClientMaxBodySize`**：buffer 發生在 route handler
**之前**，所以上表的 `Content-Length` 預檢攔不到它。調到 110 MB 等於允許任何
已登入使用者讓伺服器先吃下 109 MB 再被拒絕——把可執行的上限換成記憶體暴露。

**8 MB 的來源**：在框架 10 MB 預算下留約 2 MB 給 multipart 邊界與 header。
實測 1741 筆專利（含完整摘要）的 analyze body 為 **2–3.5 MB**，約 2–4 倍餘裕。
未來要更大檔，必須**同時**調高 proxy 預算與這裡的數字，並接受記憶體代價；
或把上傳路徑從 proxy matcher 排除（但要確認 auth 仍由 handler 內的
`requireUser()` 把關）。

此取捨由 `tests/analyze-limits.test.ts` 的
「keeps every byte ceiling under the 10MB proxy buffer budget」守住——
任何人把上限調到 10 MB 以上，該測試會紅。

**抽樣預設值改為「全部」（使用者決定 2026-08-05：老師要全跑）**：
`app/page.tsx:63` 現況 `useState(50)` → 上傳完成後自動設為**去重後的實際筆數**，
輸入框仍可手動調小。v1.2 F-02 的「預設 50、最大 2000」上限一併放寬到 20000
（與上表一致），否則 1741 筆會被靜默截斷成 2000。

### 5.3 多檔上傳（P0 只做讀取端，UI 篩選屬後續期）

- `components/UploadZone.tsx:198` `files?.[0]` → 接受 `FileList`；
  拖放路徑（`:166` 的 `.find()`）同樣接受多檔
- `app/api/uploads/route.ts:33` `form.get('file')` → `getAll('file')`
- `POST /api/analyze` 的 `filename?: string` → `filenames: string[]`
- 每筆專利帶 `source_files[]`；去重時聯集
- 建立 `analysis_uploads` 關聯（§6）
- UI：欄位對應面板改為每檔一段（格式 A/B、選定工作表、筆數、未識別欄位），
  末列「合計 N 筆 → 去重後 M 筆」＋衝突清單

### 5.4 案件狀態與設計分類號：只解析，不過濾

**使用者決定（2026-08-05）：不做任何排除。** `專利彙整(全) (1).xlsx` 只是樣本，
真正使用時不需要依案件狀態或專利類型排除資料。

因此本版**不實作**排除機制：

- `案件狀態`、`設計分類號` 只作為**一般欄位解析入庫**（供日後檢視與篩選用），
  不衍生 `is_design` / `is_inactive` / `is_pending` 旗標
- **不做** `methodology.excluded_counts`
- **不做**排除相關的 UI 開關與「已排除 N 筆」提示
- 全部有效列一律進入分析

> 這一節前一版曾規範一整套排除邏輯（依案件狀態字典排除 `核駁`/`消滅`、
> 依 `設計分類號` 或 `D` 前綴排除 76 筆設計專利）。那是**根據單一樣本檔的
> 資料特性推導出的過度工程**，已依使用者指示移除。相關實測數據移到附錄 A
> 保留，供日後真的需要篩選時參考。

**去重後的筆數**（依 §4.3／§4.5 規則實算）：

```
原始有效列 1869 → 去重後 1741（合併 128 筆）   ← 全數送進 LLM 萃取
```

此數列為 P0 驗收條件 §9-3 的基準值。

---

## 6. 型別與 DB

### 6.1 `types/graph.ts`

```ts
interface PatentRow {
  id: string                        // 語意變更：§4.5 的 sha1(identityKey)
  // v1.2 既有欄位保留（含 applicant，§7-5 禁止改其值）
  title_en?: string
  patent_number?: string
  publication_number?: string
  publication_date?: string
  applicants?: string[]             // optional，避免既有 fixture 型別錯（見 §8）
  inventors?: string[]
  ipc5?: string[]
  ipc5_raw?: string[]
  ipc_primary?: string
  ipc_depth?: number
  references?: string[]
  external_references?: string[]
  cited_by_count?: number
  case_status?: string              // 只解析入庫，不衍生排除旗標（§5.4）
  design_class?: string             // 同上
  source_files?: string[]           // optional，同上
  search_keywords?: string[]
}

// GraphNode 的專利節點新增（篩選要能在重載後重算，必須進 GraphData）
interface GraphNode {
  ipc5?: string[]
  ipc_primary?: string
  ipc_depth?: number
  source_files?: string[]
  cited_by_count?: number
  case_status?: string
  source_patents?: string[]         // 概念節點；現況 DB 缺此欄，重載時消失
  applicant_key?: string            // 申請人節點
}

// GraphMethodology：P0 不新增任何欄位（排除機制已取消，故無 excluded_counts）。
// v1.2 既有 15 欄全部保留、行為不變。
```

**`schema_version`**：升至 `3`；`types/graph.ts:135` 的字面型別 `2`
放寬為 `2 | 3`。

**相容性**：新欄位缺失時留 `undefined`，UI 不得顯示成 0。

### 6.2 `db/migrations/002_p0_data_layer.sql`

- `patents` 加：`patent_number`、`publication_number`、`publication_date`、
  `ipc5 text[]`、`ipc5_raw text[]`、`ipc_primary`、`ipc_depth`、
  `cited_by_count`、`case_status`、`design_class`、
  `source_files text[]`、`external_references text[]`
  （**無** `is_design`／`is_inactive`／`is_pending`／`identity_uncertain`——
  排除機制已取消，§5.4）
- `applicants` 加：`applicant_key text`
- `concepts` 加：`source_patents text[]`（**修現況缺陷**——`loadGraph()`
  寫入 `patent_concepts`（`lib/db/analyses.ts:357-366`）卻**從不讀它**，
  概念節點的 `source_patents` 在重載時無聲消失）
- `analyses` 加：`data_quality_warnings jsonb`
- 新表 `analysis_uploads (analysis_id uuid, upload_id uuid, original_name text,
  PRIMARY KEY (analysis_id, upload_id))`
  —— `analyses.upload_id`／`filename` 是單值（`001_init.sql:62-64`），
  多檔上傳後歷史側欄只會顯示一個檔名、「下載原始檔」只給得到 1 個
- 新表 `citations (analysis_id uuid, from_patent text, to_patent text,
  PRIMARY KEY (analysis_id, from_patent, to_patent))`
  —— **不設 `is_internal`**：§3.5 規定外部引用不進此表，該欄恆為 true

**`edges.kind` 不需要動。** 早期草稿寫「放寬 `edges.kind` 的 CHECK 約束
（`001_init.sql:157` 起）」——那是錯的：`:157` 是 `CREATE TABLE communities`，
`edges.kind` 在 `:170` 是純 `text`，**全檔對 `edges` 沒有任何 CHECK**
（全檔僅 `users_role_check:23` 與 `analyses_status_check:85` 兩個 CHECK）。
P0 也不引入新的 edge kind。

**回滾**：`002` 全部 additive（加欄位、加表），無 DROP、無主鍵變更、
無資料改寫。附 `002_down.sql` 反向 drop 新欄位與新表。

### 6.3 必須同步改的程式碼（P0 範圍，共 7 處）

| # | 位置 | 為什麼 |
|---|---|---|
| 1 | `lib/excel-parser.ts` | 雙格式判定、工作表選取、全部解析規則、`PatentRow.id` 新語意 |
| 2 | `lib/db/analyses.ts` 的 `patents`（約 `:243`）／`concepts`（約 `:282`）insert 欄位清單，與 `loadGraph()` 的對應 SELECT（約 `:433`、`:453`、`:493`） | **明列欄位**，不改則新欄位永不寫入也不讀出 |
| 3 | `lib/db/analyses.ts` 的 `analyses` UPDATE（約 `:182-223`）與 `saveGraph()` 的 insert 區塊（`:225-342`） | 需寫入 `data_quality_warnings`、`analysis_uploads`、`citations` |
| 4 | `lib/db/analyses.ts:531` 硬寫 `schema_version: 2` | 從 DB 重建的 `GraphData` 會宣稱自己是 v2 |
| 5 | `lib/graph-compat.ts:336` 分派 `input.schema_version === 2 ? normalizeV2 : normalizeLegacy` | **v3 會落入 `normalizeLegacy()`**，它重建整個概念網路、丟棄 cooccurrence 邊、覆寫 `frequency`／`community_id`／`color`、把 methodology 重設為 v1.2 預設（`:260-326`）。接著 `saveGraph()` 先 `DELETE FROM edges/communities/concepts/patents/applicants`（`:176-180`）再寫入被毀版本 → **不可回復**。改為明確 `2 \| 3` 分支 |
| 6 | `lib/graph-compat.ts:204`、`:314` 兩處硬寫 `schema_version: 2` | 同 #4 |
| 7 | `lib/graph-compat.ts:131-170` `normalizeMethodology()` / `methodologyDefaults()` | **嚴格白名單，回傳物件無 `...raw`** → `excluded_counts` 會被丟棄。P0 只需讓它通過該欄位；`community_edge_weight`／`layout_distance_interpretation` 的強制回寫（`:144-146`、`:152-154`）P0 不動 |

另需：`lib/graph-builder.ts` 把 IPC／來源／`applicant_key`／`source_patents`
放進 `GraphNode`（不只放在 transient `PatentRow`）；
`app/api/analyses/route.ts` 與 `lib/analysis-history.ts` 的單值
`filename`／`source_file_url` 改讀 `analysis_uploads`。

---

## 7. 不得破壞的既有行為

1. `data/*.json`（目前 11 個）與 DB 內既有分析必須仍能開啟。
   **驗收**：升版後逐一開啟全部既有 JSON，確認可渲染且不出現 NaN 或 0 冒充值
2. v1.2 可解釋性防線全部保留：`frequency` 以不同專利 ID 去重計數、
   共現以 `support_count` 為單位、LLM 語意邊不參與社群計算、方法圖例常駐、
   `layout_distance_interpretation` 維持 `'visual_only'`。
   **驗收**：`methodology` 每個欄位在存→讀往返後與寫入值相同（含 `excluded_counts`）
3. 取消分析（F-16）、SSE 進度（F-08）、分享 URL（F-13）、離線 HTML（F-13b）
   行為不變
4. API Key 不進 body、不寫 log
5. 格式 A 的既有解析結果不變：**既有欄位**須逐字元相同
   （`專利爬蟲.xlsx` 前 50 筆 snapshot 回歸）。新增欄位填 `undefined`／空陣列
   是允許的；不允許改動 `title`／`abstract`／`applicant`／`filing_date` 的值

   > **這一條與 §5.1 的去重互相衝突**（前一版未處理）：格式 A 前 50 筆中有 5 組
   > 會被去重合併，所以去重後的輸出無法與 v1.2 逐筆對齊。
   > 解法：`parseExcel()` 提供 `{ dedupe: false }` 選項，**snapshot 測試專用**。
   > 預設仍為去重（保證 `id` 唯一，避免撞 `patents` 的
   > `UNIQUE (analysis_id, node_id)`）。`dedupe: false` 的輸出
   > **不保證 id 唯一，不得落庫**——此限制必須寫在型別註解上。

---

## 8. 既有測試的影響

現有 10 個測試檔中受影響者：

| 測試 | 症狀 | 處理 |
|---|---|---|
| `tests/community.test.ts:40` 起 | 它是 `tests/` 下**唯一**建構 `PatentRow` 的檔案。若 `applicants`／`source_files` 宣告為**必要**欄位，fixture 缺欄 → **型別錯，阻塞 build** | §6.1 已把兩者宣告為 optional，故不需改 fixture；仍須確認 `:58` 的 `applicant:"X；X"` → `applicant:X` 斷言不變（§7-5 保證 `applicant` 欄位不動） |
| `tests/graph-compat.test.ts:38` | `expect(graph?.schema_version).toBe(2)` | 輸入 fixture 是 v2，`normalizeV2` 改為原樣傳遞版本後**仍應回 2**；若改成一律回 3 則此測試須更新。P0 選前者 |
| `tests/graph-view.test.ts:6`、`tests/export-html.test.ts:11` | `schema_version: 2` 於 typed `GraphData` | 型別放寬為 `2 \| 3` 後 `2` **依然合法**，不會出錯，無需改動 |

> 早期草稿稱「4 個測試會壞、其中 2 個型別錯誤阻塞 build」，那是錯的：
> 放寬字面型別後 `schema_version: 2` 仍合法。真正可能阻塞 build 的只有
> `community.test.ts`，且已用 optional 宣告避開。

**P0 必須新增**：`lib/excel-parser.ts` 目前 **0 測試覆蓋**
（`grep -r "parseExcel\|FIELD_SYNONYMS\|cleanApplicantName" tests/` 零命中），
所以 §7-5 的回歸契約目前**不可執行**。P0 交付物包含：

- 格式 A snapshot 回歸：`專利爬蟲.xlsx` 前 50 筆的 `PatentRow` 既有欄位快照
- 格式 B 解析測試：工作表選取（含 `雷達圖分析` 誤選防護）、日期轉換三個基準值、
  IPC 正規化（全部 3080 個值 + `G06K-09/00` 合併案例）、BOM 剝除、
  參考文獻正規化（含 `D199419` vs `M199419` 不得合併）
- 身分判定：§4.3 三規則九分支各一個 fixture
- 穩定 ID：規則 1b 兩筆不得同 ID；`noid` 兩筆標題相同但摘要不同不得同 ID
- **順序不變性**：同一組檔案反轉上傳順序，產出的 `PatentRow[]`（依 `id` 排序後）
  與 `warnings` 逐欄相同

---

## 9. P0 驗收條件（只引用 P0 內部的東西）

1. `pnpm test` 與 `next build` 全綠
2. 格式 A snapshot 回歸通過（前 50 筆既有欄位逐字元相同）
3. 格式 B 解析：有效列數 = 1869；**去重後 1741**；IPC 無效值數與 warnings
   筆數相符；BOM 剝除 32 筆；`案件狀態` 與 `設計分類號` 有被解析入庫
   （不驗排除，因為不做排除）
4. 反轉上傳順序 → 產出逐欄相同
5. `106201453` 的兩筆專利**未被合併**，且各自有不同 `node_id`，
   並出現在 `warnings.appno_collisions`
6. `109208236` 跨格式合併成功，申請人為兩者聯集，並記入
   `warnings.applicant_identity_conflicts`
7. `citations` 表寫入 105 筆內部引用；外部引用只在 `external_references[]`
8. 跑一次分析 → **重啟伺服器** → 開 `/analysis/<id>` →
   `GraphNode` 的 `ipc5`／`ipc_primary`／`source_files`／`source_patents`
   與分析當下逐欄相同（**只驗持久化往返，不驗任何篩選 UI**）
9. 全部既有 `data/*.json` 仍可開啟
10. 上傳完成後抽樣輸入框自動填入 1741（非 50）；`sample_size: 1e9` 被 clamp；
    21000 筆 body 回 413；11 個檔回 413

---

_基於 `docs/PRD.md` v1.2、2026-08-04／05 需求討論、Codex 一輪與 Claude 三 lens
兩輪審核（共 38 條 BLOCKING）撰寫。審核歷程見
`docs/archive/PRD-v2-draft-superseded.md`。_
