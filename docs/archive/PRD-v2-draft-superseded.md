> # ⚠️ 已作廢，不可作為實作依據
>
> 這份草稿有 **33 條已知缺陷**（2026-08-05 fresh-context 驗收，
> 覆蓋率 24/29、新引入 33），包含：穩定 ID 公式的 `sha1()` 括號錯位、
> 空識別碼仍會碰撞、`application_number` 正規化從未定義導致跨格式去重
> 永不觸發、`case_status` 取字典序最小會撤銷排除、`edges.kind` 的 CHECK
> 約束是虛構的、六處循環的期別依賴、以及 association strength 拿來當線寬
> 會產生與設計意圖相反的結果。
>
> **現行文件**：
> - P0 規格 → `docs/PRD-v2-P0-資料層.md`
> - 後續期意圖與未決問題 → `docs/PRD-v2-意圖.md`
>
> 保留本檔的唯一理由是 **§10 審核紀錄**（Codex 一輪 9 條 + Claude 三 lens
> 29 條的完整歷程與證據），以及那些「錯誤斷言的具體長相」——它們是
> 實作時的陷阱清單。**其餘內容一律以現行文件為準。**

---

# PRD v2：多檔比對、IPC 分析與時序關聯（作廢草稿）

**版本**：v2.1-draft（第二次重寫，收斂三份審核共 29 條 BLOCKING）
**日期**：2026-08-05
**狀態**：待使用者核准 → 實作
**基準**：`docs/PRD.md` v1.2（已實作）
**樣本**：`專利爬蟲.xlsx`（格式 A，1500 筆）、`專利彙整(全) (1).xlsx`（格式 B，1869 筆，已全量實測）

---

## 一、本版目標與非目標

讓老師用多份專利 Excel 做跨資料集技術地圖比對，並回答 v1.2 回答不了的三件事：

1. **時間**：技術概念何時出現、何時熱、現在還活著嗎？
2. **關聯與單位**：兩個概念關聯多強？是「幾篇專利」還是「幾家機構」在做？
3. **先後**：哪個概念是另一個的前身？證據是什麼、可信度多高？

外加工程需求：**PNG 匯出**，讓老師把多張圖並排放進論文。

### 非目標（本版明確不做）

- **距離語意映射**（原 F-22）。已移除，理由見 §9-1。`layout_distance_interpretation`
  維持 v1.2 的 `'visual_only'`。
- MDS / t-SNE 座標投影（§9-1）
- N 張圖並排的比對頁面（本版以「單圖 + 來源著色/篩選」達成）
- 詞向量自動同義詞合併（只做正規化 + LLM 候選 + 人工可編輯對照表）
- 發明人網路（§9-2；但 v2.0 就要解析入庫）

---

## 二、資料層（阻塞其他所有期）

### 2.1 雙格式兼容與工作表選取

| | 格式 A：爬蟲版 | 格式 B：老師版 |
|---|---|---|
| 來源 | `scripts/get.py` | 老師既有資料（TIPO 匯出 + 手工分析） |
| 判定指紋 | `搜尋關鍵字` 或 `專利名稱(中)` | `IPC5-1` |
| 工作表 | 單一 `專利清單` | **10 個**，資料在 `原始資料` |
| 欄位數 | 9 | 83 |
| 有效列數 | 1500 | 1869（工作表共 1888 列，尾端 18 列為空白列） |

**工作表選取（格式 B）**。其餘 9 個工作表是老師已做好的分析表
（`發明人合併`、`專利件數分析-*`、`專利權人別分析`、`發明人別分析`、
`IPC3分析`、`IPC5分析`、`雷達圖分析`），表頭與資料表不同。

1. **優先以名稱 `原始資料` 定位。**
2. **絕不整檔讀取所有工作表**：`發明人合併` 有 **1048576 列**（Excel 上限，
   公式填滿），讀入會耗盡記憶體。只讀選定的那一張。
3. **fallback 不可只看 `IPC5-1` 指紋**：實測 `雷達圖分析` 工作表表頭
   也含字面 `IPC5-1`（`["申請號","證書號","申請年","申請人1","申請人2","IPC5-1",…]`，
   1559 列），會被誤選，且它缺 `專利名稱`／`摘要`／`申請日`，使用者只會看到
   「缺少必要欄位」而不知真因是選錯表。fallback 須**同時**滿足：
   - 表頭含 `IPC5-1`
   - 表頭含 `摘要`、`專利名稱`、`申請號` 三者
   - 非空資料列 > 500
   - 表名不在已知分析表黑名單（`發明人合併`、`雷達圖分析`、`IPC3分析`、
     `IPC5分析`、以 `專利件數分析` 或 `*別分析` 結尾者）
4. 都不命中 → 明確錯誤訊息列出所有工作表名與各自表頭，讓使用者判斷。

**尾端空白列剔除（先於一切統計）**：以 `專利編號` 非空為有效列判準。
樣本檔第 1870–1887 列除 `案件狀態` 一格外其餘 82 欄全空，**必須在讀取任何
欄位統計之前剔除**（見 §2.6 對此的實測教訓）。

> **附帶情報（不改本版範圍）**：老師已在 Excel 自行做 IPC3／IPC5 分析、
> 專利權人別、發明人別與技術生命週期分析。F-24 與 §9-2 的發明人網路
> 正對著他既有工作流。

### 2.2 欄位對應表

| canonical | 格式 A | 格式 B | 備註 |
|---|---|---|---|
| `title` | `專利名稱(中)` | `專利名稱` | 必要 |
| `abstract` | `摘要` | `摘要` | 必要；需剝 BOM（§2.2.2） |
| `title_en` | `專利名稱(英)` | — | 選配 |
| `application_number` | `申請號`（`TW113123858`） | `申請號`（`111201471`） | **非唯一**，見 §2.6 |
| `patent_number` | — | `專利編號`（`M628244`） | 引用比對鍵（§2.5）；出現兩次且 1869/1869 完全相同，取一 |
| `publication_number` | `公開公告號`（`TW202601532A`） | — | 與格式 B 的 `專利編號` **非同一體系**，不可互相比對 |
| `filing_date` | `申請日`（字串） | `申請日`（**Excel 序列數**） | 時間軸主軸（§2.2.1） |
| `publication_date` | `公開公告日`（字串） | `公告/公開日`（**Excel 序列數**） | 僅記錄，不用於時序 |
| `search_keyword` | `搜尋關鍵字` | — | 格式 B 無，來源標記改用檔名 |
| `applicants[]` | `申請人`（單欄需清理） | `申請人1..5`（已乾淨） | §2.3 |
| `inventors[]` | — | `發明人1..21` | v2.0 只入庫 |
| `ipc5[]` | — | `IPC5-1..13` | §2.4 |
| `ipc3[]` | — | `IPC3-1..13` | 交叉驗證用 |
| `references[]` | — | `參考文獻1..15` | §2.5 |
| `cited_by_count` | — | `被參考次數` | 僅 101/1869 有值 |
| `case_status` | — | `案件狀態` | §2.6 |
| `design_class` | — | `設計分類號` | 67 筆有值 |
| `priority` | — | `優先權` | 8 筆有值，僅記錄 |
| `agents[]` | — | `代理人1..4` | 僅記錄 |
| `gazette` | — | `公報分卷期` | 僅記錄 |

**編號欄位群解析（通用）**：對 `X1..Xn` / `X-1..X-n` 樣式，掃描符合
`^<prefix>[-]?\d+$` 的表頭，依數字排序取非空值去重成陣列。**不得寫死 13 或 21。**

實測值域（驗收基準）：申請人 1–2 家（`申請人3..5` 全空）；發明人 1–21 人；
`IPC5-1` 非空 1804/1869；`參考文獻n` 任一非空 255/1869。

### 2.2.1 日期必須做 Excel 序列數轉換（格式 B）

格式 B 的 `申請日`、`公告/公開日` 是 **Excel 序列數（number 型別）**，
實測 1869/1869 全為數字，範圍 38016–44558。

- 轉換：`new Date(Date.UTC(1899, 11, 30) + serial * 86400000)`
- **驗證基準（已用 `XLSX.SSF.parse_date_code()` 與儲存格快取顯示值雙重核對）**：

  | serial | 正確結果 | 交叉驗證 |
  |---|---|---|
  | `44196` | **`2020-12-31`** | `parse_date_code` 回 `{y:2020,m:12,d:31}`；儲存格 `w = "12/31/20"` |
  | `38016` | `2004-01-30` | — |
  | `44558` | `2021-12-28` | — |

  > **注意**：本文件前一版把 `44196` 寫成 `2021-01-01`，是錯的。若實作者照
  > 錯誤斷言寫測試，會看到正確公式「跑出錯誤結果」而去補 `+1`，導致
  > **1869 筆日期全部推後一天**、跨年邊界專利歸錯年份。以上表為準。

- 格式 A 沿用字串解析，**不得改動**（§7-5）
- 落在 < 1990 或 > 今年+1 的值記入 `data_quality_warnings.date_out_of_range`
- `publication_date` 早於 `filing_date` 的筆數須統計並記入 warnings（不阻斷）

**資料時間窗為 2004-01-30 – 2021-12-28（申請日）**，無 2022 年後專利。
F-20 的時間著色**不得寫死「近三年」**，須顯示實際資料窗。

### 2.2.2 摘要要剝 BOM

實測 32/1869 筆 `摘要` 以 U+FEFF 開頭。解析時剝除字串開頭的 BOM 與零寬字元
（`^[﻿​-‍]+`），否則混進 LLM 輸入並影響概念字面比對。

### 2.3 申請人

- **格式 B**：取 `申請人1..5` 非空值，**不執行空格截斷清理**（已是乾淨名稱）
- **格式 A**：沿用 v1.2 F-05 規則（全形／半形空格截斷 + 括號截斷 + `；` 分隔）
- **正規化只產生合併鍵，不覆寫欄位值**：`normalizeApplicantName()`
  （去前後空白、統一全半形、統一公司尾綴寫法）的輸出**只用於決定哪些字串
  合併成同一節點**，存為 `applicant_key`。
  - 格式 A 的 `applicant` 欄位值必須與 v1.2 **逐字元相同**。現況
    `lib/excel-parser.ts:210` 完全沒有全半形正規化（grep `normalize|全形|NFKC|uFF`
    零命中）；若對它套新規則，`ＪＸ金屬股份有限公司` 會變成
    `JX金屬股份有限公司`，直接違反 §7-5。
  - 節點 `label` 取該群第一次出現的原值（依 `application_number` 字典序決定
    「第一次」，確保與上傳順序無關）
- `applicant_raw` 保留原始值（`types/graph.ts` 已有）

### 2.4 IPC 階層

**實際格式（對樣本檔 3080 個非空 `IPC5-n` 值實測）**：形如 **`G06Q-010/10`**
—— **連字號**分隔次類與主類目（不是空白），主類目**零填充 3 位**。

實測樣式分佈：

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

另有前導空白不一致（`" G06Q-040/04"`；`IPC3-1` 同時出現 `" G06Q"` 與 `"G06Q"`）。

**正規化順序（不可調換）**：

1. 保留原值到 `ipc5_raw[]` 供稽核
2. 剝頭尾空白；剝尾端非法字元 `[^A-Z0-9/]+$`（清掉 `\`、`.`、`(`）；
   剝括號版本尾註 `\s*\((19|20)\d{2}\.\d{2}\)\s*$`（本樣本未出現，防禦性保留）
3. 移除所有內部空白
4. **anchored 全字串驗證**：`^([A-H]\d{2}[A-Z])-?(\d{1,4})\/(\d{1,6})$`
   或只到次類的 `^[A-H]\d{2}[A-Z]$`（後者標 `ipc_depth: 3`）
5. **主類目去前導零**：`010 → 10`、`09 → 9`。必要步驟——實測
   `G06K-09/00` 與 `G06K-009/00` 同時存在，不去零填充會分裂成兩組
6. 驗證失敗才記入 `data_quality_warnings.ipc_unparseable`

五級：

| 級 | 名稱 | 內部鍵 | 顯示形 |
|---|---|---|---|
| L1 | 部 | `G` | `G` |
| L2 | 類 | `G06` | `G06` |
| L3 | 次類 | `G06Q` | `G06Q` |
| L4 | 主類目 | `G06Q10` | `G06Q 10` |
| L5 | 次類目 | `G06Q10/10` | `G06Q 10/10` |

`ipc_depth: 3` 的值 L4 = L5 = L3，**不參與 L4／L5 分組統計**。
`IPC3-n` 與從 `IPC5-n` 截出的 L3 集合比對，不一致記入 warnings。
**主分類 = `IPC5-1`**，其餘為副分類。

**驗收**：對樣本檔全部 3080 個值跑正規化，確認 ① 零非法輸出
② `G06K-09/00` 與 `G06K-009/00` 合併為同一 L5 鍵 ③ 無效值數與 warnings 筆數相符。

### 2.5 參考文獻（引用）

**比對鍵是 `專利編號`，不是 `申請號`**。實測 1119 個非空參考文獻值：

| 類別 | 筆數 |
|---|---|
| 外國專利（`CN`/`KR`/`JP`/`US`/`EP`/`WO` 前綴） | 620 |
| 含中文的不規則值（`美國60/168,89419991203`） | 12 |
| **對上本資料集 `專利編號`** | **105** |
| 對上本資料集 `申請號` | **0**（命名空間完全不同） |
| 台灣編號但不在本資料集內 | 382 |

正規化：大寫化 → 剝 `TW` 前綴 → 去除非 `[A-Z0-9/]` → 剝尾綴 `U`
（`TWM563592U` → `M563592`）。

**正規化不得跨專利類型合併**：`D`（設計）、`M`（新型）、`I`（發明）前綴
必須保留，否則 `D199419` 與 `M199419` 會被視為同一筆。

- **內部引用**：正規化後對上某筆 `專利編號` → 建 `citation` 邊
- **外部引用**：其餘只記在 `external_references[]`，**不建節點**
- 方向固定「引用者 → 被引用者」，語意「後者為前者之技術前身」
- 無法解析的 12 筆記入 `data_quality_warnings.reference_unparseable`

**可用引用對 93 對**（105 原始 → 排除設計專利兩端後 93 → 再排除核駁/消滅仍 93）。
相對 1869 筆專利，此量**不足以作為時序主證據**，F-23 的證據優先序已據此翻轉。

### 2.6 去重與篩選

#### 2.6.1 `申請號` 不是唯一鍵（實測）

**單一格式 B 檔案內部**就有一組 `申請號` 對應兩筆完全不同的真實專利：

| 專利編號 | 標題 | 申請人 | IPC5-1 |
|---|---|---|---|
| `M546543` | 匯款系統平台 | 京城商業銀行 | `G06Q-020/10` |
| `M541619` | 車聯網事故資料紀錄與舉證系統 | 泰安產物保險 | `G06Q-050/10` |

兩者 `申請號` 都是 `106201453`。另有 132 組 `申請號` 重複（131 組為同列重記、
無害），以及 2 組（`108211626`、`109202820`）`專利編號` 相同但標題與申請日不同。
**「申請號 → 專利」在原始資料裡不是一對一關係。**

#### 2.6.2 身分判定與去重規則

**身分元組**（皆為正規化後值）：`(patent_number, application_number, title_key)`，
`title_key` = 標題去空白、統一全半形、去標點。

合併判準（**必須全部成立才合併**）：

| 情況 | 動作 |
|---|---|
| `patent_number` 兩邊皆非空且相等，且 `title_key` 相等 | **合併** |
| `patent_number` 兩邊皆非空但不相等 | **不合併**（即使 `application_number` 相同）；記入 `warnings.appno_collisions` |
| `patent_number` 至少一邊為空（如格式 A 無此欄）→ 改用 `application_number` 相等 **且** `title_key` 相等 | **合併** |
| `application_number` 相等但 `title_key` 不同 | **不合併**；記入 `warnings.appno_collisions` |
| `patent_number` 相等但 `title_key` 不同 | **不合併**；記入 `warnings.patno_title_conflicts` |
| 兩個識別欄位皆空 | **不合併**，各自保留；記入 `warnings.no_identifier` |

**穩定專利 ID**（與上傳順序無關，且空值不碰撞）：

```
node_id = `patent:p:${sha1(patent_number ?? '') + '|' + (application_number ?? '') + '|' + title_key}`
```

- **保留 `patent:` 前綴**：`lib/graph-builder.ts:153` 現用 `patent:${patent.id}`，
  且 `lib/graph-view.ts:140`、`lib/graph-compat.ts:254`、
  `components/Sidebar/EdgeInfo.tsx:229`、`app/api/analyze/route.ts:115` 四處依賴它
- **不再用 `${filename}-${rowIndex}`**（會使結果依上傳順序改變）
- 前一版規格寫的 `p:<normalized_app_no>` 已作廢：空申請號會產生同一個 ID，
  撞 `patents` 表的 `UNIQUE (analysis_id, node_id)`（`001_init.sql:122`），
  而 `insertRows` 無 `ON CONFLICT` → `withTransaction` 全部 rollback →
  分析卡在 running、LLM 成本已付、結果全失

#### 2.6.3 合併時的欄位決勝（與輸入順序無關）

| 欄位類型 | 規則 |
|---|---|
| `abstract`、`title` | 取字元數最長；等長取字典序最小 |
| `filing_date`、`publication_date` | 取最早的有效日期 |
| `ipc5[]`、`references[]`、`inventors[]` | 聯集後排序去重 |
| `applicants[]` | 聯集後排序去重，**但見下方衝突稽核** |
| `cited_by_count` | 取最大值 |
| `case_status` | 取字典序最小（並記衝突） |
| `source_files[]`、`search_keywords[]` | 聯集後排序 |

**清單型欄位也要衝突稽核**。實測跨格式案例：`申請號 109208236` 在兩檔皆有，
標題逐字相同、申請日相同，但申請人一邊是「臺灣新光商業銀行股份有限公司」、
另一邊是「臺灣中小企業銀行股份有限公司」（其中一邊資料誤植）。單純聯集會讓
**兩家銀行都掛在同一筆專利上**，直接汙染 F-21 的「哪幾家機構在做這個概念」。

規則：合併時若兩邊 `applicants[]` 正規化後集合**無交集**，除聯集外必須：
- 標記該專利 `identity_uncertain: true`
- 記入 `data_quality_warnings.applicant_identity_conflicts`（含兩邊原值與來源檔）
- UI 在該節點與資料品質面板顯著標示

**所有非空值衝突（含清單型）都要記錄，不得靜默取其一。**

**驗收（順序不變性）**：同一組檔案以**反轉順序**上傳，產出的 `GraphData`
除 `generated_at` 外必須逐欄相同（含 `node_id`、concept frequency、所有邊的指標）。

#### 2.6.4 案件狀態與設計專利篩選

**實測字典（母體 = 1869 筆有 `專利編號` 的有效列）**：

| 值 | 筆數 | 預設處理 |
|---|---|---|
| `核准` | 1867 | 保留 |
| `消滅` | 2 | 排除（`is_inactive: true`） |

> **重要更正**：本文件前一版寫「核准 1867、未審查/公開 13、核駁 5、消滅 2」，
> 那是**未剔除尾端空白列**的統計（加總 1887）。實測 `未審查/公開`(13) 與
> `核駁`(5) **全部落在第 1870–1887 列的空白尾列**，該 18 列除 `案件狀態` 外
> 其餘 82 欄全空。**這兩個狀態在真實專利母體中不存在。**
> 相關處理邏輯保留為防禦性分支（未來資料可能出現），但 UI 不得預先承諾筆數。

- 未知 `案件狀態` 值一律**保留**並記入 `warnings.unknown_case_status`
- 防禦性分支：值含 `核駁`／`不予專利`／`撤回`／`放棄`／`消滅`／`失效` → `is_inactive`；
  含 `未審查`／`公開` → `is_pending: true`（保留但標記）
- `設計分類號` 有值 **或** `專利編號` 以 `D` 開頭 → `is_design: true`，預設排除。
  實測 **76 筆**（設計專利無技術摘要語意，會汙染概念萃取）
- UI 顯示「已排除 N 筆」，數字由實際計算得出，**不得寫死**；可逐項切回

---

## 三、型別變更（`types/graph.ts`）

```ts
// ── PatentRow ──
interface PatentRow {
  // v1.2 既有欄位保留
  title_en?: string
  patent_number?: string
  publication_number?: string
  publication_date?: string
  applicants: string[]              // 取代單一 applicant（保留 applicant 供 v1 相容）
  inventors?: string[]
  ipc5?: string[]                   // 正規化後
  ipc5_raw?: string[]
  ipc_primary?: string
  ipc_depth?: number
  references?: string[]             // 已確認在資料集內
  external_references?: string[]
  cited_by_count?: number
  case_status?: string
  is_design?: boolean
  is_inactive?: boolean
  is_pending?: boolean
  identity_uncertain?: boolean
  source_files: string[]
  search_keywords?: string[]
}

// ── GraphNode ──
interface GraphNode {
  // 概念節點
  first_year?: number
  last_year?: number
  median_year?: number              // lower median，見 F-20
  year_histogram?: Record<number, number>
  applicant_count?: number
  applicant_ids?: string[]          // 篩選後重算單位與相似度所需
  ipc_distribution?: Record<string, number>
  // 專利節點（篩選要能在重新載入後重算，必須進 GraphData）
  ipc5?: string[]
  ipc_primary?: string
  ipc_depth?: number
  source_files?: string[]
  cited_by_count?: number
  is_design?: boolean
  is_inactive?: boolean
  is_pending?: boolean
  identity_uncertain?: boolean
  // 申請人節點
  applicant_key?: string
}

// ── 邊 ──
type GraphEdgeKind =
  | 'structural' | 'cooccurrence' | 'semantic'
  | 'citation'              // 專利→專利，有向
  | 'temporal'              // 概念→概念，有向
  | 'taxonomic'             // 概念→概念，有向（語意上下位）
  | 'applicant_similarity'  // 機構→機構

interface GraphEdge {
  // v1.2 既有
  support_count?: number         // 不改名（DB、graph-compat、既有 data/*.json 三處都在用）
  // 新增指標
  support_applicants?: number
  association_strength?: number  // VOSviewer 版，見 F-21
  npmi?: number
  // temporal 專用
  lag_years?: number
  overlap_ratio?: number
  temporal_basis?: 'citation' | 'statistical'
  evidence_strength?: number     // 環偵測的統一比較尺度，見 F-23
  citation_pairs_forward?: number
  citation_pairs_backward?: number
  // applicant_similarity 專用
  shared_concepts?: string[]
}

// ── methodology ──
interface GraphMethodology {
  // v1.2 既有欄位保留
  time_axis_field: 'filing_date'
  association_metric: 'support_count' | 'jaccard' | 'association_strength' | 'npmi'
  analysis_unit: 'patent' | 'applicant'
  community_edge_weight: 'support_count' | 'support_applicants'
  layout_distance_interpretation: 'visual_only'   // 本版不變，F-22 已移除
  ipc_level: 1 | 2 | 3 | 4 | 5
  ipc_match_mode: 'any' | 'primary_only'
  synonym_table_version: string
  concept_size_formula: string    // 隨 analysis_unit 改寫，見 F-21
  population_n: number            // 當前篩選後的母體大小
  excluded_counts: { design: number; inactive: number; deduped: number }
}
```

**`schema_version` 升至 `3`，型別由字面 `2` 放寬為 `2 | 3`**
（`types/graph.ts:136` 目前是字面型別 `2`，不放寬會讓既有測試出現型別錯誤而阻塞 build）。

**相容性**：所有新指標缺失時留 `undefined`。UI 每一處讀取新欄位都必須容忍
`undefined`，**不得顯示成 0**（關聯度上「0」與「未計算」是不同結論）。

---

## 四、DB migration（`db/migrations/002_v2_analysis.sql`）

> 既有 schema（`001_init.sql`）共 11 張表：`users`、`sessions`、`uploads`、
> `analyses`、`applicants`、`patents`、`patent_applicants`、`concepts`、
> `patent_concepts`、`communities`、`edges`。
> `patent_applicants` 已是多對多正規化表 → `申請人1..5` 不需新結構。

- `patents`：加 `patent_number`、`publication_number`、`publication_date`、
  `ipc5 text[]`、`ipc5_raw text[]`、`ipc_primary`、`ipc_depth`、
  `cited_by_count`、`case_status`、`is_design`、`is_inactive`、`is_pending`、
  `identity_uncertain`、`source_files text[]`、`external_references text[]`
- `concepts`（現有 `id, analysis_id, node_id, label, frequency, community_id, color, size`）：
  加 `first_year int`、`last_year int`、`median_year real`（**`real` 不可用
  `int`**，見 F-20）、`year_histogram jsonb`、`source_patents text[]`（**現況
  就缺這一欄**，`loadGraph()` 重建概念節點時取不到）、`applicant_ids text[]`
- `applicants`：加 `applicant_key text`
- `edges`（現有含 `support_count`、`jaccard`）：加 `support_applicants`、
  `association_strength`、`npmi`、`lag_years`、`overlap_ratio`、
  `temporal_basis`、`evidence_strength`、`citation_pairs_forward`、
  `citation_pairs_backward`、`shared_concepts text[]`。
  **放寬 `edges.kind` 的 CHECK 約束**以容納 4 種新 kind（`001_init.sql:157` 起）
- `communities`：**主鍵加 `analysis_unit`** → `(analysis_id, analysis_unit, community_id)`；
  `concepts.community_id` 無法同時存兩套分群，因此改為新表
  `concept_communities (analysis_id, analysis_unit, concept_node_id, community_id, color, size)`。
  理由見 F-21「兩種單位的社群必須分別持久化」
- `analyses`：加 `data_quality_warnings jsonb`
- 新表 `analysis_uploads (analysis_id, upload_id, original_name)` ——
  `analyses.upload_id`／`filename` 是單值（`001_init.sql:62-64`），
  多檔上傳後歷史側欄只會顯示其中一個檔名、「下載原始檔」只給得到 1 個，
  另外的 upload 記錄與該分析永久失聯
- 新表 `citations (analysis_id, from_patent, to_patent, is_internal)`
- 新表 `concept_synonym_versions (id bigserial, created_at, created_by, note)`
- 新表 `concept_synonyms (id, version_id → concept_synonym_versions,
  canonical, variant, source ('auto'|'manual'), created_at)`
  - `UNIQUE (version_id, variant)`
  - CHECK：同一 version 內 `variant` 不得同時是某組的 `canonical`
    （否則 `AI→人工智慧` 與 `人工智慧→AI` 並存會讓正規化振盪）
  - **版本快照不可變**；`methodology.synonym_table_version` 寫入 `version_id`

**索引**：`concepts(analysis_id, first_year)`、`edges(analysis_id, kind)`、
`citations(analysis_id, to_patent)`、`concept_synonyms(version_id, variant)`、
`concept_communities(analysis_id, analysis_unit)`。

**回滾**：`002` 全部為 additive（加欄位／加表／放寬 CHECK），無 DROP、無資料改寫。
`concepts.community_id` 保留不動（v2 讀取路徑仍可用）。降版時 v3 資料的新欄位
被忽略但不損毀。migration 須附對應的 `002_down.sql`。

### 4.1 必須一起改的程式碼（`ALTER TABLE` 本身完全不夠）

前一版規格只列了 4 個檔，實際盤點後**至少 8 個**：

| # | 位置 | 為什麼 |
|---|---|---|
| 1 | `lib/db/analyses.ts` insert 欄位清單（約 `:243` `patents`、`:282` `concepts`、`:318` `edges`）與 `loadGraph()` 的 SELECT（約 `:433`、`:453`、`:493`） | **明列欄位**，不是動態的。不改則新欄位永遠不寫入也不讀出 |
| 2 | `lib/db/analyses.ts:531` `schema_version: 2` 硬寫 | 從 DB 重建的 `GraphData` 會宣稱自己是 v2 |
| 3 | `lib/graph-compat.ts:336` 分派條件 `input.schema_version === 2 ? normalizeV2 : normalizeLegacy` | **v3 會落入 `normalizeLegacy()`**，該函式重建整個概念網路、丟棄所有 cooccurrence 邊、覆寫 `frequency`／`community_id`／`color`、把 methodology 重設為 v1.2 預設（`:260-326`）。接著 `saveGraph()` 先 `DELETE FROM edges/communities/concepts/patents/applicants`（`:176-180`）再寫入被毀版本 → **不可回復**。改為明確 `2 \| 3` 分支 |
| 4 | `lib/graph-compat.ts:204`、`:314` 兩處硬寫 `schema_version: 2` | 同 #2 |
| 5 | `lib/graph-compat.ts:131-170` `normalizeMethodology()` + `methodologyDefaults()` | **嚴格白名單且強制回寫**：`community_edge_weight` 非 `'support_count'` 一律改回（`:144-146`）、`layout_distance_interpretation` 非 `'visual_only'` 一律改回（`:152-154`），且回傳物件無 `...raw` → §3 新增的 9 個欄位全被丟棄。結果是方法圖例與 PNG 戳記印出**與實際計算不符**的宣告 |
| 6 | `lib/graph-compat.ts:17` `EDGE_KINDS` 白名單（只 3 種）與 `inferEdgeKind()`（`:54-62`） | 4 種新 kind 會被改寫：`citation`（patent→patent）→ `structural`、`temporal`（concept→concept）→ `semantic` |
| 7 | **`lib/graph-view.ts`** —— 前一版完全沒提，但它是**唯一的篩選重算層** | 見下方獨立說明 |
| 8 | `lib/export-html.ts:49-51`、`:85-89`，及 `:133-139` / `:156-161` **兩份硬寫 legend 字串** | 離線 HTML 完全建立在 `selectGraphView` 上，payload 只序列化 `{views, methodology, options}`，新圖層不會出現，legend 硬寫的方法宣告會與 `methodology` 不一致 |

另需同步：`lib/graph-builder.ts`（把 IPC／來源／`applicant_ids` 放進 `GraphNode`，
`:269` 的 `concept_size_formula` 改為隨 unit 產生）、`lib/graph-analysis.ts`、
`lib/analysis-history.ts`、`app/api/analyses/route.ts`（單值 `filename` /
`source_file_url`）。

#### 4.1.1 `lib/graph-view.ts`：concept 模式目前沒有任何篩選重算

`selectGraphView()` 是所有「篩選 → 重算」的實作點，但 `selectConceptView()`
（`:53-89`）**只做一件事**：`kind === 'cooccurrence' && support_count >= minSupport`。

它**不套年份、不套來源、沒有 IPC 概念、不重算 frequency／size／社群**。
F-24 說「沿用 v1.2 F-10 對年份篩選的同一原則」——那個原則只存在於
`selectContextView()`（`:91-173`），concept 模式從來沒有。更關鍵：`:54` 把所有
patent 節點過濾掉，而 **IPC／來源檔／案件狀態全部掛在 patent 節點上**，
重算路徑不存在。`GraphViewData`（`:17-24`）是白名單，也不帶 `N`、
`analysis_unit`、`methodology`。

本版必須：

- concept 模式改為**先由 `structural` 邊重建 patent↔concept 成員關係**，
  再套用全部篩選（年份／IPC／來源／案件狀態），然後重算
  `frequency`／`applicant_count`／`size`／全部關聯度指標／社群
- `GraphViewData` 回傳 `population_n`、`analysis_unit`、`association_metric`
  與實際生效的 `methodology`（供 PNG 戳記單一來源，見 F-19）

**驗收（持久化與篩選契約，這是唯一防線）**：跑一次新分析 → **重啟伺服器** →
開 `/analysis/<id>` → 逐項確認 IPC 篩選、來源檔篩選、單位切換、時間著色
**全部可用且數字與分析當下相同**。只在分析當下測試完全看不到這類缺陷。

---

## 五、功能規格

### F-18 多檔上傳與來源標記

- `components/UploadZone.tsx:198` `files?.[0]` → 接受 `FileList`；
  拖放路徑（`:166` 的 `.find()`）同樣接受多檔
- `app/api/uploads/route.ts:33` `form.get('file')` → `getAll('file')`，
  逐檔驗證副檔名與大小，各自建立 `uploads` 記錄
- `POST /api/analyze` 的 `filename?: string` → `filenames: string[]`；
  建立 `analysis_uploads` 關聯（§4）
- 每筆專利帶 `source_files[]`；去重時聯集
- UI：欄位對應面板改為**每檔一段**（格式 A/B、筆數、未識別欄位、選定工作表），
  末列顯示「合計 N 筆 → 去重後 M 筆」＋衝突清單連結
- 側邊欄新增「來源檔」篩選與「依來源著色」開關 → 本版的「比對」

#### F-18 資源上限（修正：前一版打錯端點）

`/api/uploads` **從不解析 xlsx**（`:44` 只做 `Buffer.from(await file.arrayBuffer())`），
xlsx 解析與去重都在瀏覽器（`components/UploadZone.tsx:93` 呼叫 `parseExcel`）。
所以「去重後總列數」上限在該端點**算不出來**。

真正把資料送進伺服器記憶體的是 **`POST /api/analyze` 的 JSON body**
（`patents: PatentRow[]`，含完整摘要），該處只檢查
`Array.isArray(patents) && patents.length > 0`（`:189-194`），
且 `sample_size` **未 clamp** 就進 `.slice()`（`:169`、`:196`）。

| 端點 | 上限 | 預設 |
|---|---|---|
| `POST /api/uploads` | 單檔 bytes | 50 MB（現況 `:8`，不變） |
| | 單次檔案數 | 10 |
| | 單次總 bytes（`Content-Length` 預檢，在 `formData()` 之前） | 100 MB |
| `POST /api/analyze` | `patents.length` | 20000（超限 413，不截斷） |
| | body bytes（`Content-Length` 預檢） | 100 MB |
| | `sample_size` | clamp 到 `[1, 2000]` |

全部可由環境變數調整。

**驗收**：上傳 3 檔（含 1 個格式 A、1 個格式 B、1 個與前者部分重複），
去重後筆數與人工核算一致；來源著色能區分三檔；只勾一檔時統計數字同步重算；
`sample_size: 1e9` 被 clamp；21000 筆 body 回 413。

### F-19 PNG 匯出

- 位置：圖譜頁右上角，與現有「匯出 HTML」並列
- 取像：監聽 vis-network `afterDrawing` 取得 `ctx`，`ctx.canvas.toDataURL('image/png')`
- 選項：解析度 1x/2x/4x；背景（深色／白色）；內容戳記（預設開）

**匯出必須與畫面一致（新增，前一版缺此契約）**。穩定化結束後
`physics.enabled: false`（`GraphViewer.tsx:445`）節點座標已固定，但
現有 `handleFit()`（`:380-384`）只改 scale／translate ——
若匯出時呼叫 `fit()`，得到的是「全圖取景」而非老師畫面上的視野；
且 `hideEdgesOnDrag: isLarge` / `hideEdgesOnZoom: isHuge`（`:340-341`）
在放大重繪的瞬間可能讓邊不被畫進 frame。

規則：
- **不呼叫 `fit()`**；沿用匯出瞬間的 scale／translate
- 放大解析度時暫時關閉 `hideEdgesOnDrag` / `hideEdgesOnZoom`，擷取後還原
- 驗收明列：**匯出圖像的節點座標、可見邊集合與取景須與匯出瞬間畫面一致**

**戳記必須有單一來源**。要印的值散在 `GraphLayout` 的多個獨立 state
（`mode`、`yearRange`、`minSupport`、`showSemantic`、`hiddenCommunities`，
再加 IPC／來源／unit／關聯度門檻），而 `population_n` 只存在於重算結果中。
規則：戳記與圖像**同時由一個 `ExportSnapshot` 產生**，該物件由
`selectGraphView()` 一次回傳（含 `population_n`、所有篩選值、生效的 `methodology`）。

戳記內容：圖譜模式、全部篩選條件、關聯度指標名稱、`analysis_unit`、
`community_edge_weight`、`population_n`、`synonym_table_version`、
`generated_at`，以及 v1.2 的「節點距離僅供排版，不代表語意距離」聲明
（本版 F-22 已移除，此聲明**不變**）。

檔名：`patent-graph-{mode}-{unit}-L{ipcLevel}-{YYYYMMDD-HHmm}.png`

> **實作風險**：vis-network 無官方高解析度擷取 API。**先做 1 天 spike**
> 確認 2x/4x 產出正確；不可行則退回 1x 並提示老師用瀏覽器縮放後截圖。
> 這是本版唯一仍未驗證的假設。

### F-20 概念時間屬性

時間軸一律用 **`申請日`**（申請日貼近技術產生時間；公開公告日晚 18 個月以上，
會系統性延後演化曲線）。寫入 `methodology.time_axis_field`。

概念由其 `source_patents` 的申請年推導：

- `first_year`、`last_year`
- **`median_year` = lower median**（偶數個時取較小的中間值）。
  必須明訂，因為 F-23 的方向條件之一是 `|median(B) − median(A)| ≥ 1`，
  且 F-23(c) 直接把它當 Y 座標。實測反例：A={2014,2016}、B={2015,2016} 時
  lower median 得 `|1|` → 畫箭頭；upper median 得 `|0|` → 不畫；
  取平均再存整數欄位又得 `|0|`。**同一組資料，插值約定決定有沒有箭頭。**
  DB 欄位型別為 `real`（不可 `int`，避免未來改定義時被截斷）
- `year_histogram`：`Record<number, number>`（JSON key 會變字串，屬性存取
  自動字串化，四位數年份排序一致，實測無問題）

`filing_date` 缺失的專利不計入時間統計但仍計入 frequency；缺失比例顯示在方法圖例。

UI：
- 著色模式新增「**依首次出現年份漸層**」（與社群著色、IPC 著色互斥切換）
- 節點資訊面板加年度 sparkline
- **時間窗由資料算出並顯示**（本樣本 2004–2021），不得寫死「近三年」

**驗收**：取 3 個概念手算 first/last/lower-median 與年度分佈與 UI 比對；
缺 `filing_date` 的專利不影響 frequency。

### F-21 關聯度指標與分析單位

#### F-21.1 四個指標

| 指標 | 定義 | 性質 |
|---|---|---|
| `support_count` | 共同出現的專利篇數 | **證據量，不是強度** |
| `jaccard` | \|A∩B\| / \|A∪B\| | v1.2 已有 |
| **`association_strength`** | **`s_ij = 2m·c_ij / (c_i·c_j)`** | VOSviewer 標準，預設 |
| `npmi` | `ln(p_ij/(p_i·p_j)) / (−ln p_ij)` | 統計意義最清楚 |

**`association_strength` 的符號定義（已回查一手來源）**：

```
c_ij = 節點 i 與 j 之間的連結數（本專案 = 共同出現的專利篇數或機構家數，依 unit）
c_i  = Σ_{j≠i} c_ij        ← 節點 i 的「總連結強度」，排除自身
m    = ½ · Σ_i c_i         ← 網路總連結數
s_ij = 2m·c_ij / (c_i·c_j)
```

出處：Waltman, van Eck & Noyons, *A unified approach to mapping and clustering
of bibliometric networks*, arXiv:1006.1032，式 (1)(2)（p.2–3），該文明確標示
`s_ij` 為 Van Eck & Waltman (2009) 的 association strength。**2026-08-05 核對原文**。

> **前一版錯誤更正**：前一版寫 `c_ij/(w_i·w_j)` 並標成「VOSviewer 預設」。
> 那是錯的——分母是**總連結強度** `c_i` 而非 document frequency `w_i`，
> 且**漏掉 `2m` 因子**。前一版的式子實際上是 lift/N。若照前一版實作，
> `methodology` 會宣稱「VOSviewer 標準關聯度」但數字無法與任何 VOSviewer
> 輸出對照，老師引 Van Eck & Waltman (2009) 即為**錯誤引用**。

**可解釋性**：`s_ij` 是「觀察值 / 隨機期望值」，**門檻在 1**——
`s_ij > 1` 表示共現高於隨機期望。方法圖例須標示此性質。
`s_ij` 無上界，線寬用 `sqrt` 縮放並 clamp。

#### F-21.2 母體與邊界行為

母體 `N` = **當前篩選後**（年份／IPC／來源／案件狀態全部套用完）、
**當前 `analysis_unit`** 的元素總數。`p_i = w_i/N`、`p_ij = c_ij/N`。
`N` 隨篩選變動，所有指標跟著重算，且 `N`（`population_n`）進 PNG 戳記。

| 邊界情況 | 定義行為 |
|---|---|
| `c_ij = 0` | 不建立邊（不是建 0 權重的邊） |
| **`p_ij = 1`**（所有元素都同時含 A、B） | **`npmi := undefined`** |
| `p_i = 1` 但 `p_ij < 1` | 分子 `ln 1 = 0`、分母 > 0 → `npmi = 0`（正確，非錯誤） |
| `c_i = 0` 或 `c_j = 0` | 該概念無任何共現邊，不會產生 `s_ij` |
| `m = 0`（全圖無共現邊） | 所有 `association_strength` 為 `undefined` |
| `N ≤ 1` | 全部指標 `undefined`，UI 顯示「樣本不足」，**不顯示 0** |
| 任何指標為 `NaN`／`±Inf` | 存 `undefined` 並記入 warnings，**不得寫入 DB 或 PNG 戳記** |

**`npmi` 最後一律 `clamp(-1, 1)`**：浮點會溢出值域，實測 `N=46, w_i=w_j=c_ij=45`
算出 `1.0000000000000069`。

> **`p_ij = 1` 的處理更正**：前一版寫「`npmi := 1`（依 NPMI 定義取極限值）」。
> 那是錯的。`p_ij → 1` 是真正的 0/0，極限**路徑相依**：沿
> `p_i = p_j = p_ij = 1−ε` 收斂到 1，沿 `p_i = 1, p_j = p_ij = 1−ε` 收斂到 **0**。
> 且 `p_ij = 1 ⟹ p_i = p_j = 1 ⟹ PMI = ln(1/(1·1)) = 0`，統計上是
> 「兩個常數、互資訊為零」，記成量尺最大值與語意相反。故定義為 `undefined`。

**驗收**：以「篩選後只剩 2 篇、兩篇都含 A 與 B」為 fixture，確認
`npmi` 為 `undefined` 而非 `NaN` 也非 1；以 `N=1` 確認全部指標 `undefined`
且 UI 不顯示 0；窮舉 `N=1..8` 全部整數狀態確認無非有限值外洩。

#### F-21.3 分析單位切換

| | `patent`（現況） | `applicant`（新增） |
|---|---|---|
| 概念集合 | 概念 → 專利 ID 集合 | 概念 → **機構 ID 集合**（`COUNT(DISTINCT applicant)`） |
| 概念大小 | 幾篇專利提到 | **幾家機構在做** |
| 邊強度 | 共同出現在幾篇 | **幾家機構同時做這兩個概念** |

**切換單位時必須全部重算**，不是換算現有數字：

- 每個概念維護兩套集合：`patent_ids` 與 `applicant_ids`
  （後者 = 該概念所有專利的申請人聯集去重）
- 切換 → 以該單位的集合重算 `c_ij`、`c_i`、`m`、`N` 與全部四個指標
- **節點大小**：`size = conceptSize(unit === 'applicant' ? applicant_count : frequency)`，
  且 `methodology.concept_size_formula` **隨單位輸出對應字串**。
  現況 `lib/graph-builder.ts:269` 是常數字串
  `'clamp(10 + 6 * sqrt(frequency), 10, 52)'`，方法圖例常駐顯示（§7-2）；
  若 size 改用家數而字串不變，老師會把「3 家」的圓點讀成「9 篇專利」
- **Louvain 邊權重跟著單位走**：`patent` → `support_count`（維持 v1.2 契約）；
  `applicant` → `support_applicants`。寫入 `methodology.community_edge_weight`

**兩種單位的社群必須分別持久化**。現況 `detectCommunities()` 只在
`app/api/analyze/route.ts:92` 與 `lib/graph-compat.ts:262` 被呼叫，
**沒有「篩選／單位改變後重算」的入口**；且 `concepts.community_id` 是單值、
`communities` 主鍵 `(analysis_id, community_id)` 無 unit 維度。
更糟的是 `lib/community.ts:69-77` 的社群 id 直接沿用 graphology 回傳的整數、
顏色按排序後 index 取 `COMMUNITY_COLORS[index % 15]` →
**兩種單位會產生同一組 id `{0,1,2,…}` 與同一組顏色序列但成員完全不同**，
`Community.name`（`:80-95` 取最高度數節點）也被覆寫。

> 具體失效情境：老師匯出兩張 PNG，兩張圖例都寫「社群 0：區塊鏈」、顏色相同、
> 成員不同 → 跨圖比對得到錯誤結論。這正是本版比對功能要避免的。

規則：
- 新表 `concept_communities`（含 `analysis_unit`）與 `communities` 主鍵加
  `analysis_unit`（§4）
- **重算執行位置**：伺服器端 `POST /api/analyses/[id]/recompute`
  （body 帶 unit 與篩選條件），回傳重算後的 view + `population_n`；
  不在前端引入 graphology
- UI 切換單位時明示「社群已依機構單位重算」，不得靜默改變顏色分組

#### F-21.4 視覺與門檻

- **線寬 = 關聯強度，不透明度 = 證據量**（`support_count`）
- **雙門檻**：`support_count ≥ 2` 才允許畫線（單篇偶然共現不得呈現為強關聯）；
  關聯度低於使用者門檻者隱藏。兩門檻值進 PNG 戳記

#### F-21.5 機構相似度邊

兩家機構共同投入概念數 ≥ k（預設 3）→ `applicant_similarity` 邊，
帶 `shared_concepts[]`，點擊列出共同概念。直接回答「某公司和某學校都在做這個」。

**驗收**：用 20 篇小資料集手算四個指標與兩種單位逐一比對；
`support ≥ 3` 時僅 2 篇支持的邊確實消失；`shared_concepts` 可在資料裡驗證；
切換單位後社群顏色與 id 不與另一單位混用。

### F-23 時序先行與上下位

> （編號沿用；原 F-22 距離映射已移除，見 §9-1）

**「時間先後」與「語意上下位」是兩件事**，混為一談會產出錯誤結論。
反例：先有窄的具體技術（「OTP 簡訊驗證」），後才歸納出上位概念
（「多因子身分驗證」）——時間在前，分類上卻是下位。拆成兩條可獨立開關的邊。

#### (a) 時序先行 `temporal`（有向）

**證據優先序**：可用內部引用僅 **93 對／1869 筆專利**（§2.5），投影到概念層、
扣掉共有概念、再要求方向淨多數之後能定向的概念對是個位數。因此：

- **統計時序為主力**（覆蓋全部概念對）
- **引用為高可信度補強**（稀疏但客觀）
- 兩者在圖上用不同線型區分，邊上記 `temporal_basis`

**1. 引用投影規則**（`temporal_basis: 'citation'`）

設 `P_new` 引用 `P_old`（後者為技術前身），概念集合 `C_new`、`C_old`。
**直接取笛卡兒積會壞掉**：兩篇共有概念 {A,B} 時會同時產生
`A→A`、`B→B`、`A→B`、`B→A`（自環 + 二元環），而演化圖必須是 DAG。

1. **排除共有概念**：只取 `(C_old \ C_new) → (C_new \ C_old)`。
   同時出現在兩篇的概念不帶先後資訊，必須剔除；此步同時消掉所有自環
2. **時間一致性檢查**：`P_old.filing_date` 必須早於 `P_new.filing_date`。
   矛盾者（資料錯誤或同族後案）**不採用**，記入
   `warnings.citation_date_conflicts`
3. **雙向證據仲裁**：
   - `net = |支持 A→B 的引用對| − |支持 B→A 的引用對|`
   - `|net| < 2`，或兩方向證據數比值落在 `[1/2, 2]` → **引用方向不明**
   - 否則取淨多數方向，邊上同時記 `citation_pairs_forward` 與
     `citation_pairs_backward`（不可只存勝方）

**2. 統計時序**（`temporal_basis: 'statistical'`，主力）

須**同時**滿足：

- `support_count ≥ k`（預設 3）
- `|median_year(B) − median_year(A)| ≥ 1`（lower median，F-20）
- **分布不重疊：`max(A) ≤ min(B)`**

  > 這是 **nearest-rank** 百分位在 n=3 時的等價形式。必須明訂插值方法：
  > 前一版只寫「A 的 P75 ≤ B 的 P25」，而 linear／R-7 插值（Excel
  > `PERCENTILE`、numpy 預設）與 nearest-rank 在預設 `k=3` 下會給**相反答案**。
  > 實測反例：A=[2008,2009,2015]、B=[2012,2013,2014] 時 linear 得
  > P75(A)=2012 ≤ P25(B)=2012.5 → **畫箭頭**，但 A 的最新專利（2015）
  > 晚於 B 的全部專利——與資料相反的結論。nearest-rank 不會畫。
  > 故採用 nearest-rank，並寫入 `methodology`。

- **移除「或 Mann–Whitney U 檢定顯著」分支**。理由：在預設 `k=3` 下
  n₁=n₂=3、排列總數 C(6,3)=20、最小雙尾 p = 0.10，**α=0.05 永不顯著**——
  該分支是死碼；且申請年為整數、重複值極多，MWU 需 ties 校正，
  前一版未給 α、未給單／雙尾、未給小樣本行為。本版不採用統計檢定，
  只用上述三條確定性條件（可完整重現、可人工核對）。

不滿足者退回無向 `cooccurrence` 邊，**不畫箭頭**。

**3. 引用與統計衝突的裁決順序**（前一版自我矛盾，本版明訂）

| 引用證據 | 統計判定 | 結果 |
|---|---|---|
| 方向明確（`\|net\| ≥ 2`） | 任意 | **引用勝**，`temporal_basis: 'citation'`；若與統計方向相反，記入 `warnings.temporal_direction_conflicts`（含兩邊證據量）並在 UI 標示 |
| 方向不明（`\|net\| < 2`） | 方向明確 | **交還統計**，`temporal_basis: 'statistical'`；**不得抹掉統計箭頭** |
| 方向不明 | 方向不明 | 無向 `cooccurrence` |
| 無引用 | 方向明確 | 統計，`temporal_basis: 'statistical'` |

> 前一版「引用覆寫統計」與「引用方向不明退回無向不畫箭頭」互相矛盾。
> 且覆寫無警告：2 對引用即可翻轉由 120 篇專利年份分布得出的方向。
> 本版保留覆寫（引用確實更客觀），但**強制記錄每一次翻轉**。

**4. 環偵測**

所有 `temporal` 邊必須有統一的比較尺度 `evidence_strength`（前一版用 `net`，
但 `net` 只在引用分支定義，統計邊沒有 → `Math.min` 得 `NaN`，
「重跑直到無環」不會終止）：

```
evidence_strength =
  temporal_basis === 'citation'   ? 1000 + |net|          // citation 一律強於 statistical
  : /* statistical */               |median_year(B) − median_year(A)|
```

輸出 `temporal` 圖層前跑 DAG 檢查；發現環時移除環上 `evidence_strength`
最小的邊，重跑至無環。被移除的邊降級為無向 `cooccurrence` 並記入
`warnings.temporal_cycles_broken`（含環的節點路徑），**不得靜默丟棄**——
環的存在本身是研究上值得注意的訊號。

#### (b) 語意上下位 `taxonomic`（需語意來源）

- 現有 LLM prompt 已有 `relation` 欄位，擴充要求輸出
  `broader_than` / `narrower_than`（沿用既有 `confidence` 機制）
- 亦可由 IPC 樹提供客觀骨架
- 與 (a) 完全分開的圖層開關

#### (c) 時間分層 layout

Y 軸 = `median_year`（越上越早），X 軸自由散佈，physics 關閉。
把「上下位」直接畫成上下位置，箭頭順著往下 → 技術演化路徑自己浮現。

**驗收**：人工檢查 20 條 `citation` 邊方向與原始參考文獻一致；
統計箭頭抽 10 條核對 `max(A) ≤ min(B)` 確實成立；不滿足者確實無箭頭；
人造一個三元環 fixture 確認 DAG 檢查會終止並記錄；
時間分層 layout 下節點 Y 座標順序與 `median_year` 單調對應。

### F-24 IPC 篩選與分析

- **層級 slider（L1–L5）**：切換時即時顯示「本層級切出 X 組／最大組 Y 筆／
  單筆組 Z 個」。預設 **L3 次類**（`G06Q`）——L1 太粗、L5 太細
- **IPC 樹狀多選面板**：部 → 類 → 次類展開，每節點顯示專利數
- **比對模式**：預設「任一 IPC 符合」，提供「僅主分類（`IPC5-1`）」開關
- **IPC 著色**：概念節點依「該概念專利的 IPC 眾數」著色；與社群著色、
  年份著色三者互斥
- **不新增 IPC 節點層**（一篇最多 13 個 IPC，建節點會讓圖爆掉）
- 附常見 IPC 中文對照（至少 `G06Q`＝行政/商業/金融資料處理、
  `G06Q 40`＝金融保險稅務、`G06K`、`G16H`、`H04L`）
- IPC 篩選變動時，透過 §4.1.1 的重算路徑重算
  `frequency`／`applicant_count`／`size`／全部指標／統計列／社群

**驗收**：選 `G06Q` 後圖與統計列同步且數字正確；L1–L5 皆可切且組數統計正確；
「僅主分類」與「任一符合」結果有可解釋差異；`IPC3-n` 與 L3 不一致的筆數
出現在資料品質警告。

### F-25 概念同義詞治理

現況 `lib/concept-network.ts:47` 是**完全字面比對**去重。不先解決，
F-20/F-21/F-23 全部會被它毀掉（「人工智慧」與「AI」分裂 → support 砍半 →
關聯度系統性偏低、`first_year` 錯、機構家數低估）。

#### F-25.1 合併必須發生在輸入層（關鍵）

**合併是 `buildConceptNetwork()` 的輸入層正規化**：同義詞表先套在 keyword 上，
再做去重、共現、時間、機構與 Louvain 的**全量計算**。

> **不可事後合併。** 前一版寫「分析完成後對概念清單跑同義詞分群」，
> 若照字面實作，除 `frequency` 取聯集正確外其餘全錯，且會**靜默丟邊**：
> `lib/concept-network.ts:134` 的邊 id 是
> `stableEdgeId('cooccurrence', [source, target])`（label 的 hash），
> 合併後 `(AI, X)` 與 `(人工智慧, X)` 產生**同一個 edge id**，
> 而 `lib/graph-builder.ts:130-135` 的 `addEdge` 是
> `if (!edgeSet.has(edge.id))` → **第二條邊被靜默丟棄**，
> `support_count` 只留先到者而非聯集。
> 另：合併後原本 `AI ↔ 人工智慧` 的共現邊會變成**自環**
> （`lib/community.ts:41` 會跳過，但 `graph-builder` 的 `addEdge` 不會，
> 圖上與 `computeGodNodes` 的度數會納入）；
> `lib/concept-network.ts:140` 的 `jaccard` 用合併前的 `frequencyA/frequencyB`，
> 事後改 `frequency` 不會回頭修 `jaccard`。

#### F-25.2 流程

1. **正規化**（純函式，可測）：全／半形統一、大小寫、去標點與空白、
   去尾綴（「系統」「方法」「裝置」「之方法」）
2. **LLM 候選**：對概念清單跑同義詞分群，產出候選對照表（不自動生效）
3. **人工審核介面**：接受／拒絕／手動新增。定稿時建立
   **新的 `concept_synonym_versions` 快照**（不可變）
4. **重跑**：審核通過後以新 `version_id` **重跑一次完整 pipeline**
   （LLM 萃取結果可快取複用，不必重呼叫 LLM；但共現／時間／機構／Louvain
   全部重算）
5. `methodology.synonym_table_version = version_id`
6. **舊分析載入時鎖定其記錄的 `version_id`**，不套用新版表
   （否則「跨分析共用」與「結果可重現」直接矛盾）

**不做**詞向量自動合併——不可審查，寫不進論文。

**驗收**：給 20 組已知同義詞（含「人工智慧/AI」「區塊鏈/blockchain」），
合併後 `frequency` 為兩者聯集去重的專利數（**不是相加**）；
`(AI,X)` 與 `(人工智慧,X)` 合併後 `support_count` 為兩者**聯集**（驗證邊未被丟棄）；
合併後圖上無自環；拒絕某組後重算，該組確實分開；
舊分析在表更新後重開，結果與當初逐欄相同。

---

## 六、分期與依賴

| 期 | 內容 | 依賴 |
|---|---|---|
| **P0** | §2 全部（雙格式 parser、工作表選取、日期轉換、BOM、IPC 正規化、引用解析、身分判定與去重、狀態篩選）；§3 型別（含 `schema_version: 2\|3`）；§4 migration + `002_down.sql`；§4.1 全部 8 處 mapping；**更新 4 個受影響測試檔**；**為 `lib/excel-parser.ts` 建立格式 A snapshot 回歸測試** | — |
| **P1** | F-25 同義詞治理（輸入層正規化 + 版本快照 + 重跑） | P0 |
| **P2a** | F-18 多檔上傳與來源標記（含資源上限） | P0 |
| **P3** | F-20 概念時間 | P1 |
| **P4** | F-21 關聯度四指標、單位切換、重算 endpoint、社群 unit 維度、機構相似度邊 | P1 |
| **P5** | F-24 IPC 篩選與分析 | P0、P4（共用重算路徑） |
| **P6** | F-23 時序先行、語意上下位、時間分層 layout | P3、P4 |
| **P2b** | **F-19 PNG 匯出**（含 `ExportSnapshot`） | **P4、P5**（戳記需 `population_n`、指標名稱、IPC 條件） |
| **P7** | 離線 HTML 同步支援新圖層與 methodology 一致（`lib/export-html.ts`） | P6 |

> **P2 已拆為 P2a / P2b**。前一版把「多檔 + PNG」合為 P2 並標示只依賴 P0，
> 但 F-19 的戳記要求含關聯度指標名稱與 `population_n`（P4）、
> IPC 篩選條件（P5），依賴圖自我矛盾，照原分期做 P2 必須在 P4/P5 之後重工。

P1 與 P2a 可並行（不同檔案、無資料依賴）。

**P0 的測試工作不可省**。現有 10 個測試檔中 4 個會壞，其中 2 個是**型別錯誤
（阻塞 build，不只紅燈）**，因為 `types/graph.ts:136` 是字面型別 `2`：

| 測試 | 症狀 |
|---|---|
| `tests/graph-view.test.ts:6` | `schema_version: 2` 於 typed `GraphData` → TS 錯 |
| `tests/export-html.test.ts:11` | 同上 |
| `tests/graph-compat.test.ts:38` | `expect(graph?.schema_version).toBe(2)` 執行失敗 |
| `tests/community.test.ts:41-42`、`:58` | `applicant: "X；X"` → `applicants: string[]` 後型別錯 + 斷言失敗 |

且 `lib/excel-parser.ts` **目前 0 測試覆蓋**（無測試檔 import `parseExcel`／
`FIELD_SYNONYMS`／`cleanApplicantName`），所以 §7-5 的回歸契約目前**不可執行**。
P0 必須建立該 snapshot 基準。

---

## 七、不得破壞的既有行為

1. `data/*.json`（目前 11 個）與 DB 內所有既有分析必須仍能開啟。
   **驗收**：升版後逐一開啟全部既有 JSON，確認可渲染且不出現 NaN 或 0 冒充值
2. v1.2 可解釋性防線全部保留：`frequency` 以不同專利 ID 去重計數、
   共現以 `support_count` 為單位、LLM 語意邊不參與社群計算、方法圖例常駐。
   **驗收**：§4.1 #5 的 `normalizeMethodology()` 改動後，
   `methodology` 的每個欄位在存→讀往返後與寫入值相同（含新增 9 欄）
3. 取消分析（F-16）、SSE 進度（F-08）、分享 URL（F-13）、離線 HTML（F-13b）
   行為不變。**驗收**：離線 HTML 含新圖層，且其 legend 的方法宣告與
   `methodology` 一致（現況 legend 在 `export-html.ts` 硬寫兩份）
4. API Key 不進 body、不寫 log
5. 格式 A 的既有解析結果不變：**既有欄位**須逐字元相同
   （`專利爬蟲.xlsx` 前 50 筆 snapshot 回歸）。新增欄位填 `undefined`／空陣列
   是允許的；不允許改動 `title`／`abstract`／`applicant`／`filing_date` 的值。
   特別是 `applicant`：正規化只能用於節點合併鍵，不得回寫欄位（§2.3）

---

## 八、假設驗證結果

全部以 `專利彙整(全) (1).xlsx` 1869 筆全量實測（2026-08-04／05）。

| # | 原假設 | 結果 |
|---|---|---|
| 1 | `IPC5-n` 形如 `G06Q 40/04` | **為假** → 實際 `G06Q-010/10`（§2.4 已重寫） |
| 2 | `專利編號` 兩欄為公開號/公告號 | **純重複**，1869/1869 完全相同 |
| 3 | 格式 B 無搜尋關鍵字 → 用檔名 | **成立** |
| 4 | `參考文獻n` 可對上識別欄位 | **部分為假** → 對 `申請號` 命中 0；對 `專利編號` 93 對可用 → **F-23 證據優先序翻轉** |
| 5 | `案件狀態` 字典 | **已取得**，且前一版統計錯（母體未剔空白列）→ 有效母體只有 `核准`/`消滅` |
| 6 | `申請號` 可作唯一去重鍵 | **為假** → 同檔內即有一組對應兩筆不同專利（§2.6.1）→ 去重鍵重新設計 |
| 7 | vis-network 高解析 PNG 可行 | **仍未驗證** → F-19 的 1 天 spike，**本版唯一未驗證項** |

原計劃未涵蓋、實測補入的資料現實：Excel 序列數日期（§2.2.1）、
10 工作表與 1048576 列陷阱（§2.1）、摘要 BOM（§2.2.2）、
時間窗 2004–2021（§2.2.1）、IPC 零填充不一致（§2.4）、
跨檔申請人身分衝突（§2.6.3）、`被參考次數` 僅 5.4% 有值（§9-3）。

---

## 九、v2.1 候選（本版不做）

### 9-1 距離語意映射（原 F-22，已移除）

前一版設計 `springLength = L_base × (1 − normalized_association)`。
移除理由（實測）：`normalized_association` 未定義正規化方式，而四個指標值域
互異；用 min-max 正規化時，整張圖的距離由**最低頻的那一條邊**決定，結果與
設計意圖**完全相反**：

| 邊 | 支持篇數 | min-max norm | springLength (L=250) |
|---|---|---|---|
| w=2, w=2, c=2 | 2 | 1.0000 | **0.0**（全圖最緊） |
| w=10, w=10, c=8 | 8 | 0.1573 | 210.7 |
| w=100, w=100, c=80 | 80 | 0.0128 | **246.8**（最遠） |

即「剛好通過 `support ≥ 2` 門檻的低頻對」被畫成全圖最緊密，
「80 篇支持的高頻對」被畫在最遠。而 `layout_distance_interpretation` 一旦改成
`'approximate_association'`，方法圖例就會為這個反向排版背書。
`springLength = 0`（或因浮點溢出為負）在 vis-network 不拋錯，只會讓彈簧
持續把兩點拉向重合並與 `avoidOverlap` 互鬥，產生抖動不收斂。

未來若要做，正確路徑是 **VOS mapping / classical MDS**：
Waltman, van Eck & Noyons (arXiv:1006.1032) 式 (3) 的目標函數
`V = Σ s_ij d_ij² − Σ d_ij` 就是 VOS mapping，該文明言它與 MDS 密切相關。
搭配 Kruskal stress-1 作為失真指標，距離才有可辯護的語意、且可跨圖比較
（近似版做不到）。

### 9-2 發明人網路

`發明人1..21` 已在 P0 解析入庫。學校與公司常靠人（教授掛在公司專利上）連結，
發明人網路對「某學校某公司都在做這個」比機構共現更靈敏。
依 `patent_applicants` 同一模式新增 `inventors` + `patent_inventors`。

### 9-3 其他

- ~~`被參考次數` 作為影響力指標~~ **降級**：實測僅 101/1869（5.4%）有值、
  值域 1–4，排名會由 94.6% 的空值決定
- 外部引用聚合視圖（目前只記錄不建節點）
- N 張圖並排比對頁面

---

## 十、審核紀錄

### 現況斷言核實（2026-08-04）

fresh-context 驗收者對 20 條 `檔案:行號` 斷言逐條 read-back，**20/20 PASS**。
附帶發現 `001_init.sql` 實有 11 張表。

### Codex 計劃審核 round 1（2026-08-04，`gpt-5.6-sol`）

**BLOCKING 9**，全數採納（B1–B9）。

### Claude fresh-context 三 lens 審核 round 2（2026-08-05）

Codex 額度緊張，依 `CORE.md` §跨模型 step 4 fail-open，審核者降級為
Claude fresh-context subagent，三個 lens 並行、同一份受限 rubric。
**合計 BLOCKING 29，全數採納。**

| Lens | 模型 | BLOCKING |
|---|---|---|
| 資料層 | sonnet | 5（A1–A5） |
| 指標演算法 | opus | 11（M1–M11） |
| 相容與持久化 | opus | 13（C1–C13） |

其中 4 條是本文件前一版**未經回查的斷言**所致，已在對應章節以「更正」框標出：

| 條 | 錯誤 | 更正處 |
|---|---|---|
| A2 | `44196 → 2021-01-01`（實為 `2020-12-31`） | §2.2.1 |
| A3 | 案件狀態四值統計（母體未剔尾端空白列） | §2.6.4 |
| M1 | `p_ij = 1` 時 `npmi := 1`（極限路徑相依，且語意相反） | §F-21.2 |
| M2 | `c_ij/(w_i·w_j)` 標為 VOSviewer 標準（分母應為總連結強度且漏 `2m`） | §F-21.1 |

M2 的正確公式已回查一手來源（arXiv:1006.1032 式 (1)(2)，2026-08-05 核對）。

其餘 25 條的修正散在 §2.1（A1）、§2.6.2（A4、C5）、§2.6.3（A5）、
§4（C6、C11、C12）、§4.1（C2、C3、C4、C7）、§4.1.1（C1）、
§F-18（C10）、§F-19（C9）、§F-20（M5）、§F-21（M3、M4）、
§F-23（M6、M7、M8、M9）、§F-25（M11）、§6（C8、C13）、§9-1（M10）。

使用者決定（2026-08-05）：① 全部修完再交 ② 關聯度實作真正的 VOSviewer 版
③ F-22 距離映射本版移除、維持 `visual_only`。

**尚未取得使用者核准進入實作**（`CORE.md` §跨模型協作 step 5）。

---

_基於 `docs/PRD.md` v1.2 與 2026-08-04／05 需求討論與三輪審核撰寫。_
