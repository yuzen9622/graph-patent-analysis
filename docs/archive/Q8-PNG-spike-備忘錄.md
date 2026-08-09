# Q8 Spike 備忘錄 — Publication-Quality Knowledge Graph Export（PNG）可行性

**日期**：2026-08-09　**方法**：實機（dev server :3100，分析 ba3d79e7：40 篇／190 概念／428 邊／時序箭頭）瀏覽器內探測，`?spike=1` 臨時 handle（已移除）＋ data-URL 落盤 `/tmp/p7spike/`。視覺層另留圖供人目視。

## 目標（Q8 規格）

論文級 PNG 匯出：完整圖譜、凍結佈局、不可重跑佈局、單欄/雙欄/自訂 mm × 300/600dpi、白底、圖例可組版；Publication mode 去除 hover/glow/動畫。SVG **不在 Q8**（vis-network 無 SVG renderer——已查證頂層 exports 僅 `Network` 等，`svgContainer/svgElements` 只是 tooltip/背景 DOM）。

## 決策定案點（與規格一致）

- 圖幅：85/120/180 mm ＋ 自訂 50–250 mm；`px = mm/25.4×dpi`；300/600 dpi。
- 像素表：85mm→1004/2008px；120mm→1417/2835px；180mm→2126/4252px。
- 圖例＝圖**下方獨立留白帶**；provenance 戳記＝**預設 off**（另做 sidecar metadata，不進 figure）。
- 匯出語義：**全圖 fit**、凍結 getPositions()、physics=false、白底。

## PASS / FAIL（機械證據）

| # | 判準 | 結果 | 證據 |
|---|---|---|---|
| model-space 節點位置不變 | ✅ | 顯式注入 `getPositions()` 至全部 190 節點 → 重繪副本 `max |Δ| = 0`（未注入時 Dataset 內僅 37/190 節點帶 x/y，其餘隨機——**必須注入**，見下） |
| `getPositions()` 注入必要 | ✅（發現） | Dataset 物件 190 nodes 中僅 37 個帶 x/y 欄位；不注入則 159/190 出界。A2 管線必須把 `position` 併入每個 node 物 |
| `fit()` 後渲染中心 residual ≤ 0.5px | ✅ 構造性 | `getBoundingBox` 回傳**model 座標**（與 `getPositions` 一致）非 canvas px；canvas 像素即 `(model−view)×scale＋中心` 的投影（已 probe 節點墨點落在投影點 ±8px 內；5/12 精確命中節點色，餘者陰影/AA 干擾）——同 model＋同 transform ⇒ 渲染一致由構造保證 |
| 85/180mm×300/600dpi 尺寸 | ✅ | toDataURL 回 2126×1400；像素表全數驗算吻合 |
| 白底 | ✅ | corner/center pixel (255,255,255,255)；`destination-over` 白底合成不遮圖 |
| 無裁切 | ✅ | content bbox (92,212)–(2036,1192) ⊂ 2126×1400 |
| 已凍結佈局 | ✅ | `stabilizationIterationsDone` 後 physics=false（現況），副本直接吃凍結座標 |
| **A1（現 canvas 放大）** | ❌ | 實際放大 backing 2126×1583＋redraw 後 **view 由 (0,0)→(701,522)**（viewport 污染）、size 未被 vis 重置但污染即 fail——**依規則 A1 fail，A2 出線** |
| **A2（hidden Network 同 data＋getPositions()＋physics:off＋fit()）** | ✅ | 上面全部 PASS 的載體；PNG 落盤 `/tmp/p7spike/a2-180mm-300dpi.png` |
| 圖例帶組版 | ✅ | 1004×661 圖 + 170px band 合成成功→ `legend-85mm-300dpi.png`（1004×831） |
| B' vector（SVG recorder） | ⏸ **defer Q8+** | vis 無 SVG renderer；draw-call-recorder 探測（Proxy ctx）**未通**（0 ops，hook 時機不符）——誠實記：非「驗證可行」，僅「原理可行、實作需 1 天」；**非 Q8 pass 條件** |

## 規格缺口（P7 建置要點，spike 抓到）

1. **label 渲染字級過小**：180mm 300dpi 時 fit scale≈0.49，font 11×0.49≈**5.4px** → 不可讀。機制：P7 將「視覺單位下限」×`(欲渲染 ink px / (font×scale))` 同比例放大（label 字級與 node 點徑**必須一起**，否點徑剩 2.5px、字 33px 失衡；85mm 探測點徑 11×0.23≈2.5px 即劣例）。
2. 60mm 250dpi 下邊界外推：600dpi 即 2×300dpi pixel 數（同 mechanism），無新風險。
3. 圖例帶建議最小高 140–180px@300dpi（含篇數/單位/τ/heuristic 字樣——現有 `lib/temporal.ts` 單源常數直接重用）。
4. **離線 HTML 匯出目前重新跑 stabilization**——與「不可重跑」不一致（gap，可留 Q8+ 修或 P7 同修）。

## 產出（可目視）

- `/tmp/p7spike/a2-180mm-300dpi.png`（2126×1400，全圖 fit、白底、無裁切）
- `/tmp/p7spike/legend-85mm-300dpi.png`（1004×831＝85mm＋圖例帶 示例）

## 誠實記限

- 我（flash 模型）不能看圖：一切「可讀性」為數據化探測（ink 像素在投影點、content bbox、tonal）＋留 PNG 供**你/老師目視**。
- 箭頭／τ 符號可讀性未有像素級測（與 node/label 同 renderer，推定同步，待目視）。
- A2 的 600dpi 沒有直測（300dpi 機制同，尺寸 2×，外推；若需硬證可在 P7 建置時補一拍）。
- 本次僅測 180/85mm @ 300dpi 兩種輸出；120mm 外推。
---

## 追加（2026-08-09，目視回合）— GPT 看圖診斷＋修正匯出

**流程**：`?spike=1` 臨時 handle 重掛（仍受限於該 query、正常使用零影響）＋ `/api/p7spike` 臨時 POST 落盤 route 重掛 → 重跑 A2 修正探測 → 存 `/tmp/p7spike/fix2-*` → sips 寫 300dpi。**handle/route 仍留著待下一輪，談定後移除。**

### GPT（gpt-5.6-terra 實看三圖）診斷
1. **透明背景**：A2 檔 96.8% pixels 透明（黑字沉沒＝「跟系統完全不一樣」主兇）。我以 sips 核實 `hasAlpha: yes`。
2. **label 過小**：fit scale 0.485 時 font 11≈5.4px——先前數學預言成真。
3. **metadata 72ppi 非 300**（sips `dpiWidth: 72` 核實）。
4. 85mm 圖例帶字級互壓：label 碰撞 → P7 需「僅主要標籤/全部標籤」選項。

### 修正（fix2）
- 白底＝**輸出 canvas 先 `fillRect` 白底再 `drawImage` 貼圖**（不再用 live canvas 上不可靠的 destination-over——被 RAF 重繪清掉）。
- 視覺下限：label ≥ 8pt ink（33px）+ node 點徑 ≥ 16px ink，`Math.ceil(ink/scale)` 一起放大（180mm：font 69/size 33；85mm：font 146/size 70）。
- 存檔後 sips 寫 300dpi metadata。

### 驗證（PIL）
- fix2-180mm-300dpi.png 2126×1403：alpha=255 100%、四角白、300dpi ✓
- fix2-85mm-300dpi-legend.png 1004×863（含 200px 圖例帶）：alpha=255 100%、四角白/圖例沿 ✓

### 成待 P7
- 視覺下限機制＝「font floor＋node size/edge scale 同比例」（非僅字級）。
- 圖例帶 200px@300dpi 合組版 OK。
