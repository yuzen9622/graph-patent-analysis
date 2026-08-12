# 實作計劃：2026-08-09 視覺調整批次（grilling 定案）

**狀態**：待審核（審核通過後，Sidebar 相關步驟須等其他 agent 合併 Sidebar 後才執行）
**範圍**：分散微調（B 案）——比較圖／技術概念網路／專利脈絡圖各自獨立改動，不推翻三圖收斂。

---

## 0. 定案決策（七問全數定案）

| # | 決策 | 定案 |
| --- | --- | --- |
| 1 | 範圍 | **B 分散微調**：紅色共有→比較圖；彩虹年份→概念網路；IPC 篩選 UI→脈絡圖 |
| 2 | 共有紅 | 只套**比較圖** `DiffMembership.shared`（灰 `#64748b` → 紅 `#dc2626`）；依來源著色灰紫**不動**；形狀冗餘（圓點）保留 |
| 3 | IPC 層 | 實為「IPC 篩選 UI 在脈絡圖**不存在**」（資料層 P5 已共用子集）→ 補 UI |
| 4 | 共享概念數 | (a) 脈絡圖顯示「兩檔共有 N／聯集 M／Jaccard」角標 + (b) minSupport 門檻 slider 暴露到脈絡圖 |
| 5 | 彩虹年份 | `colorMode=first_year` 色盤：sequential_blue 9 錨 → **紅橙黃綠藍靛紫 7 錨**；圖例左（紅=最早）→右（紫=最近）；灰 `#BAB0AC`=未知不變 |
| 6 | 年份輸入 | 有滑桿處（脈絡圖+概念）點年份數字可打字，與滑桿雙向同步；語意=專利申請年全局篩選不變 |
| 7 | 大小區間 | 概念節點 `clamp(10+6√f, 10, 52)` → **`clamp(10+10√f, 10, 72)`**；機構大小不動 |
| 8 | 方向/上下位/距離/權重 | **不改公式**（語意/時間/引用三種箭頭、forceAtlas2 排版距離、線寬=關聯度照舊）；IPC 篩選本身就是可見的上下位樹 |

---

## 1. 已完成（lib 層＋獨立元件，未跑全量驗證）

| 檔案 | 改動 | 驗證 |
| --- | --- | --- |
| `lib/graph-compare.ts` | `DIFF_COLORS.shared` → `#dc2626`；新增純函式 `countSharedConcepts(nodes, filesA, filesB): CompareCount \| null` | TS clean；待加單元測試 |
| `lib/concept-time.ts` | `SEQUENTIAL_BLUE`(9) → `RAINBOW_COLORS`(7)：`#EF4444 #F97316 #EAB308 #22C55E #3B82F6 #4F46E5 #8B5CF6`；`gradientColor` 改用新常數 | TS clean |
| `lib/graph-builder.ts` | `time_color_scale: 'rainbow'`；`concept_size_formula: 'clamp(10 + 10 * sqrt(frequency), 10, 72)'` | TS clean |
| `lib/graph-compat.ts` | normalize：`'sequential_blue' \| 'rainbow'` → 一律正規化為 `'rainbow'`（舊資料圖例不印舊名）；預設公式字串同步 | TS clean |
| `lib/concept-network.ts` | `conceptSize`：`min(72, max(10, 10+10√count))` | TS clean |
| `lib/graph-view.ts` | `selectContextView`：概念節點依 `minSupport` 過濾（frequency ≥ N，頻率已按可見專利子集重算）；`maxSupport` 改為真實最大概念頻率（原寫死 1） | TS clean |
| `types/graph.ts` | `time_color_scale?: "sequential_blue" \| "rainbow"` | TS clean |
| `components/Sidebar/YearFilter.tsx` | 年份數字可點擊→輸入框；Enter/失焦提交、越界 clamp、min≤max；滑桿受控自動同步 | TS clean |
| 測試 | `concept-time`（錨色索引 0/3/6）、`graph-view`（彩虹色＋大小 20）、`graph-compat-p3`（舊名→rainbow）、`concept-network`（size 30/72） | 已同步，待全量跑 |
| `CONTEXT.md` | 新建立：比較圖/共有/首次出現年/專利脈絡圖/技術概念網路/共享概念數/最低支持度/年份範圍/IPC 篩選 等詞彙 | — |

## 2. 待實作（Sidebar 相關——**等其他 agent 合併 Sidebar 後才動**）

### 2.1 `components/Sidebar/index.tsx`

1. 新增 `IpcFilterSection` 元件：抽取概念分支現有 IPC 區塊（層級 slider + 樹狀多選 + 全部 IPC），原樣搬移。
2. 新增 `MinSupportControl` 元件：minSupport slider（label/value/max/onChange props）。
3. `Props` 新增 `sharedConceptCount: CompareCount | null`。
4. **context 分支**改為（由上至下）：共享概念數角標 → 年份範圍（含可打字）→ 最低支持度（label「概念至少出現在 N 篇專利才顯示」＋說明）→ IPC 篩選（`hasIpcData` 才顯示）→ 節點層。
5. 概念分支的 IPC 區塊與 minSupport label 改用上述元件（**行為不變**，純抽取）。
6. 角標樣式：`兩檔共享概念` 卡片，`僅 A／僅 B／共有(紅)／聯集／Jaccard` + 註記「隨年份／IPC／最低支持度篩選重算」。

### 2.2 `components/GraphLayout.tsx`

1. `lib/graph-compare` import 加 `countSharedConcepts`。
2. 新增 `sharedConceptCount` useMemo：
   - `mode !== 'context'` → null；
   - compareMode 且面板 ≥2 → 兩面板節點依 id 聯集後計數（A=左 scope、B=右 scope）；
   - 否則 `allSourceFiles.length === 2` → 以目前脈絡圖檢視節點計數（隨子集重算）；
   - 否則 null。
3. `<Sidebar>` 傳 `sharedConceptCount`。

### 2.3 新測試

- `tests/graph-compare.test.ts`：`countSharedConcepts`——兩檔各有獨有概念、共有概念、邊界（空側→null、patent id 前綴、無 source_files）。
- `tests/graph-view.test.ts`（context 區）：minSupport=2 時低頻概念節點與其結構邊消失、`maxSupport` 正確。

## 3. 文件更新

| 文件 | 內容 |
| --- | --- |
| `docs/PRD-v2-P3-概念時間.md` | B4 色盤修訂：9 錨 blue → 7 錨 rainbow；`time_color_scale` 值；驗收 3 錨色索引 |
| `docs/PRD-v2-P5-IPC分析.md` | 修訂記錄：脈絡圖補 IPC 篩選 UI（S8 範圍擴充）；共享概念數角標與 minSupport 暴露 |
| `docs/PRD-Q8-出版圖譜匯出-v2.md` | §0 比較模式：shared 配色改紅 |
| `docs/知識圖譜分析結果解讀與概念抽取方法.md` | 第 23–26 行大小公式 → `clamp(10 + 10 × √frequency, 10, 72)` |
| `docs/PRD.md` | §284 節點大小公式同步 |

## 4. 驗證

1. `pnpm test` 全綠（含新增測試）。
2. `next build` 通過。
3. `verifier-pro` fresh-context 驗收（不給實作背景，逐條 PASS/FAIL）。
4. 手動 QA：脈絡圖 IPC 篩選/層級切換清空、角標數字、slider 過濾、年份打字同步、比較圖 shared 紅、彩虹漸層左紅右紫。

## 5. 風險與對策

| 風險 | 對策 |
| --- | --- |
| Sidebar 與其他 agent 衝突 | 等合併後再動；改動前 `git diff` 確認基底；全程只用 edit 精準替換，不再用腳本大範圍替換 |
| 舊資料 `time_color_scale='sequential_blue'` | normalize 正規化為 rainbow，圖例一致 |
| 大小公式影響既有測試/文件 | 已同步 4 個測試檔＋2 份文件；`graph-compat-v3` 等 fixture 保留舊字串不影響（asString 原樣保留） |
| `selectContextView` minSupport 影響既有行為 | 預設 minSupport=1 → 不過濾任何概念，行為不變 |

## 6. 不做（誠實記限）

- 脈絡圖不做 IPC 節點層、不做依 IPC 著色（P5 S4 維持）；依來源著色灰紫不動（Q2 定案）。
- 機構模式不加年份篩選（Q5b 定案）；比較模式兩面板年份維持全局共用（Q5c）。
- 彩虹色盤不改插值公式、不換 OkLab（沿用 sRGB 逐通道）。
