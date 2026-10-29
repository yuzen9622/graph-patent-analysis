# 大型圖譜渲染方式與本專案等待問題

查核日期為 2026-10-23，產品程式基準為 `032cb0e`。本報告回答大型圖譜如何處理佈局與繪製，以及哪些方法適用於目前的專利脈絡圖。這是來源研究與診斷，沒有更換框架或修改產品程式。

## 結論

目前的證據不支持「1,237 個節點已經讓瀏覽器畫不動」。正式頁面的主要等待發生在物理佈局，程式又把整張圖維持透明直到收斂或逾時。逾時座標不快取，回訪會重新計算。

大型圖譜的可用方法包含預先計算與保存座標、Worker 計算、GPU 模擬、WebGL 繪製，以及互動時減少繪製細節。這些方法處理不同成本，不能互相替代。尤其改用 WebGL renderer，不會自動消除 CPU 佈局與 30 秒等待規則。

## 官方實作提供哪些方法

### vis-network 本身就支援保存座標

[官方 Network 文件](https://visjs.github.io/vis-network/docs/network/) 說明 renderer 使用 HTML Canvas，並描述可處理數千節點與邊。這是官方能力描述，不是本專案在特定硬體上的速度保證。

同一文件的 `storePositions()` 將節點的 `x`、`y` 寫回 DataSet。官方建議保存算好的座標，下一次載入沿用。這不表示只呼叫 `storePositions()` 就會自動存入資料庫，應用程式仍需負責持久化與快取失效。

[官方效能範例](https://visjs.github.io/vis-network/examples/network/other/performance.html) 提醒，大圖可以停用 dynamic smooth curves。本專案已在大圖使用直線，不應把這項設定列成尚未實作的解法。

### Sigma.js 與 Graphology 分開處理繪製和佈局

[Sigma.js README](https://github.com/jacomyal/sigma.js) 說明它以 WebGL 顯示圖譜，並使用 Graphology 作為圖資料結構。節點可以帶入已有的 `x`、`y`，不必每次顯示都重新執行力導向演算法。

[Graphology ForceAtlas2 文件](https://graphology.github.io/standard-library/layout-forceatlas2.html) 同時提供同步版本與 Worker 版本。Worker API 是 `graphology-layout-forceatlas2/worker`，包含 `start()`、`stop()`、`kill()`。Worker 可以把佈局計算移出 UI 主執行緒，但不保證計算總時間縮短，也不保證特定幀率。

[Sigma settings 原始碼](https://github.com/jacomyal/sigma.js/blob/main/packages/sigma/src/settings.ts) 提供 `hideEdgesOnMove`、`hideLabelsOnMove`、`labelDensity`、`labelGridCellSize` 與 `labelRenderedSizeThreshold`。這些設定控制互動期間的繪製成本與標籤密度，不處理力導向收斂。

這個組合的可借鏡處是把座標計算與顯示分開。它不是本專案的直接替換件，換 renderer 仍要重驗星形申請人、圖層、高亮、比較面板與匯出。

### Cytoscape.js 提供現成座標與不同佈局外掛

[官方 preset layout 文件](https://js.cytoscape.org/#layouts/preset) 說明，可以在 elements JSON 指定座標，並使用 `preset` 保留這些位置。這能避免再次執行自動佈局，但不代表資料載入或繪製耗時為零。

[官方效能指南](https://github.com/cytoscape/cytoscape.js/blob/master/documentation/md/performance.md) 建議減少不必要的標籤、簡化邊線，並提供 `hideEdgesOnViewport` 與 `textureOnViewport` 等選項。指南也指出，圖大小、邊、視覺樣式與硬體都影響速度，不能只比較節點數。

[fCoSE 官方 README](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose) 提供兩項與本專案結構相關的能力。

- `packComponents: true` 用來排列未相連的分量，需另外註冊並初始化 `cytoscape-layout-utilities`。
- `randomize: false` 可從已有座標開始，文件要求搭配 `quality: "proof"`。

這些是候選方法，不是已證明適合本圖的方案。不能僅因存在大量葉節點，就斷言葉節點擺動是本次收斂慢的根因。

### Cosmos 將模擬和繪製都放到 GPU

[Cosmos 官方 README](https://github.com/cosmosgl/graph) 說明力導向運算與繪製在 GPU 的 fragment 與 vertex shaders 執行。它還提供 `pause()`、`stop()` 與 `setPointPositions()` 等 API。

這和只把繪製改成 WebGL 不同。GPU 模擬可以作為另一條路線評估，但仍需測試目標硬體、排列品質、功能相容性與互動成本。官方展示的節點規模不是本專案同等樣式與同等佈局品質下的效能保證。

## 本專案的程式實際卡在哪裡

### 1,500 次是初始計算額度，不是整個佈局的上限

[vis-network 事件文件](https://visjs.github.io/vis-network/docs/network/#Events) 明確區分兩個事件。

- `stabilizationIterationsDone` 表示隱藏計算階段結束，可能只是迭代額度耗盡。
- `stabilized` 表示引擎判定穩定，或程式呼叫了 `stopSimulation()`。不能把所有此事件都視為自然收斂。

已安裝的 vis-network 版本為 10.1.0。[同版本 PhysicsEngine 原始碼](https://github.com/visjs/vis-network/blob/v10.1.0/lib/network/modules/PhysicsEngine.js) 中，`_finalizeStabilization()` 在未穩定時會呼叫 `startSimulation()` 繼續運算。`moveNodes()` 用所有節點的最大速度判定穩定，不是平均速度。

原本過早停止會留下亂的排列，因此不能直接回復舊的低迭代次數。現在的問題是把首次顯示與嚴格收斂綁在一起，沒有另外處理可用的佈局結果。

### 等待期間全透明，逾時後不保留計算成果

以下行號對應本次研究時的工作樹。

| 位置 | 已確認行為 |
| --- | --- |
| `components/GraphViewer.tsx:730-749` | 使用 ForceAtlas2Based 與 1,500 次初始計算額度。 |
| `components/GraphViewer.tsx:999` | 節點初始 `opacity` 為 0。 |
| `lib/graph-stabilization.ts:2-3` | 1,500 次迭代與 30 秒逾時設定。 |
| `lib/graph-stabilization.ts:14-36` | 等待 `stabilized`，逾時回報未收斂。 |
| `components/GraphViewer.tsx:889-892` | 座標快取只存在元件 `useRef` 中。 |
| `components/GraphViewer.tsx:1269-1291` | 只保存收斂結果，逾時不更新座標快取。 |
| `components/GraphViewer.tsx:1310-1313` | 完成回呼後才開始顯示節點。 |
| `components/GraphViewer.tsx:1296-1307` | 有先前 viewport 時不自動 fit，切換不同圖形規模時可能沿用不適合的縮放。 |

本專案已在 `components/GraphViewer.tsx:710-764` 停用大圖陰影、使用直線，並在拖曳與縮放時隱藏邊。因此不能把所有等待歸因於尚未做繪製優化。

[ForceAtlas2Based 10.1.0 原始碼](https://github.com/visjs/vis-network/blob/v10.1.0/lib/network/modules/components/physics/FA2BasedRepulsionSolver.js) 繼承 BarnesHutSolver，也不能未經查核就指控它每次都做完整的節點兩兩比較。

## 正式頁面的證據與限制

指定分析送進 GraphViewer 的資料有 1,237 節點與 1,243 條邊，其中包含 200 個專利節點。進入元件的節點沒有已保存的 `x`、`y`。

兩次從其他視圖切回脈絡圖，都約在 30 秒逾時。監聽器附加後的紀錄分別為 29.783 秒與 29.808 秒，監聽器是在建圖後才附加，因此這不是完整端到端耗時。初始 1,500 次約花 13.4 秒，此時仍有 477 個節點速度高於 0.75 門檻。這些是診斷觀察，不是框架速度比較，也不是加速後的驗收數字。

瀏覽器實際點選「照會統計分析平台」後，右側顯示申請人、申請號、年份與摘要，未觀察到 JavaScript 例外。沒有重現專利資料遺失。

另有獨立的縮放問題。從脈絡圖切到機構網路後，35 個節點沿用約 0.045 的縮放。按「全部顯示」後，縮放約為 0.188，圖形恢復合適大小。

以實際節點與邊做無向連通分量計算，共有 47 個分量，最大分量有 931 節點，974 節點的度數為 1。分量排列值得列入實驗，但這些數字不證明某一物理參數就是根因。資料上沒有連線的分量，也不應為了外觀而添加假邊。

本機原始證據位於 `/tmp/wang-layout-diagnosis/`。

- `live-context.json` 與 `live-repeat.json` 記錄正式頁面事件與速度狀態。
- `live-view.json` 保存當時元件收到的圖資料。
- `live-patent-click.json` 與 `live-patent-detail.png` 記錄節點點選。
- `live-institution-before-fit.png` 與 `live-institution-fitted.png` 記錄縮放問題。

暫存目錄不是永久測試資產。研究沒有把這份資料送到外部圖譜服務，也沒有把登入帳密寫入筆記。以上觀察受到本機硬體、同機服務負載及瀏覽器診斷開銷影響。

## 建議的修正順序

### 先處理重算與顯示生命週期

先保留目前 renderer，分開處理佈局產生、座標保存與畫面顯示。可用的完整座標結果應能重用，避免同一張圖每次從頭計算。快取鍵需要包含資料與佈局設定版本，不能只看節點數。

如果要保存未完成結果作為下次起點，必須標示為暫定座標，不能把逾時結果冒充已收斂結果。首次顯示的策略也不能犧牲使用者要求的整齊排列。

### 再用相同資料評估首次佈局

候選包括背景 Worker、調整現有求解器、分量排列，以及替換佈局演算法。Worker 主要隔離主執行緒，不保證總計算時間變短。Graphology 與 vis-network 的 ForceAtlas2 實作不能因名稱相近就當成等價。

實驗需固定同一份資料、初始條件、視窗尺寸及品質要求。比較首次顯示、互動回應、排列重疊與完整節點和邊，再決定方案。不能只比較誰先停止。

### 最後才判斷是否更換 renderer

只有在座標固定後，繪製與互動仍是主要瓶頸，才有理由優先投入 WebGL renderer 遷移。改 renderer 而保留目前的 30 秒等待與重算流程，不會自動解決開圖等待。

修正還需分別覆蓋回訪快取、資料變動後的失效、不同視圖的 viewport，以及 200 個專利節點的點選與匯出。這份研究沒有宣稱任何候選方案已達到這些驗收條件。
