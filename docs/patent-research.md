# 啟動與使用專利研究工作台

## 啟動本機服務

1. 使用 Node.js 22 以上版本，執行 `pnpm install`。
2. 設定 `DATABASE_URL` 與 `AUTH_SECRET`，使用既有登入帳號。新研究功能不使用免登入開發帳號。
3. 若需要 AI 規劃，設定既有的 `GEMINI_API_KEY`。沒有模型金鑰時，仍可直接填寫結構化條件。
4. 執行 `pnpm dev`，同時啟動網站與資料擷取 worker。若網站已另外啟動，可單獨執行 `pnpm research:worker`。

worker 透過 Playwright 操作 TwIP Search 的公開搜尋與 Excel 匯出介面。macOS 預設使用已安裝的 Google Chrome；其他環境使用 Playwright Chromium。若沒有可用瀏覽器，執行 `pnpm exec playwright install chromium`。可設定 `TWIP_BROWSER_CHANNEL=chromium`，改用已安裝的 Playwright Chromium。

若外接磁碟上的 Turbopack 開發快取出現 CSS module 缺失或錯置，使用 `pnpm dev --webpack` 重新啟動預覽。不要修改圖譜程式來處理開發樣式快取問題。

正式部署前先備份資料庫。既有 migration runner 會在首次存取資料庫時套用 `009_patent_search.sql 與 010_research_chats.sql`。本次程式修改不代表已執行正式資料庫 migration 或部署。

## 以 Docker 啟動 worker

既有 `docker-compose.yml` 新增 `research-worker` 服務，使用 `Dockerfile.research-worker` 安裝 Chromium 與系統依賴。worker 和 app 使用同一個 PostgreSQL；worker 不需要模型金鑰或 session secret。

在完成部署授權與備份後，執行：

```sh
docker compose up -d --build app research-worker
```

若只要檢查 worker 的程式建置，執行 `pnpm research:worker:build`。產物為 `dist/research-worker.mjs`，不提交至 Git。

## 搜尋與下載專利

1. 在首頁描述研究需求，或按 **結構化條件** 填入關鍵字、申請人、日期與 IPC。
2. 直接索取資料時，Gemini 呼叫 searchPatents 工具並排入 worker。若只要求規劃或使用結構化條件，可在卡片中調整條件。
3. 若卡片顯示等待確認，按 **確認並開始檢索**。
4. 查看研究進度、執行紀錄與官方來源。
5. 取得檔案後，按 **下載 Excel**，或按 **匯入分析** 進入原有上傳、欄位檢查與取樣流程。

關鍵字查詢範圍是專利名稱與摘要。依官方關聯度排序，預設翻頁取得全部符合條件的專利。若只需要部分結果，可在需求或結構化條件中指定筆數。

對話與首頁建議都由 Gemini 依需求拆分研究步驟、決定檢索條件；必要資訊不足時會先提問。對話中的研究計畫列出模型提出的步驟，執行紀錄則顯示 worker 回報的進度。國銀查詢先依中央銀行全國金融機構查詢系統的「本國銀行／總機構」名錄展開申請人，排除郵政儲匯部門，並逐筆比對實際申請人。範圍以查詢當下名錄為準。專利欄位由智慧局匯出及案件明細取得。本次需求、首問、最近十輪已完成的問答及上一份搜尋條件會送至既有 Gemini 模型。Excel 附件只走原有匯入流程，不會傳送給搜尋規劃模型。

## 處理中斷與失敗

- 若需要停止，按 **停止研究**。伺服器會拒絕已取消任務的後續結果寫入。
- 若瀏覽器中斷，重新開啟含 `researchId` 的網址，或從首頁 **接續研究** 開啟任務。
- 若部分資料已取得，但後續擷取失敗，下載卡會標示 **部分結果**，並列出限制或排除原因。
- 若沒有符合條件的專利，不會產生空白 Excel。調整條件後建立新的研究。
- 若顯示 worker 未啟動，啟動 `pnpm research:worker`，再按 **重新檢查研究服務**。
- 若官方網站要求登入、人工驗證或拒絕存取，停止該次取得流程。系統不會繞過限制。

下載檔案保留 24 小時。建立滿 7 天且已結束的研究記錄會被清理。worker 負責到期清理，不影響原有分析記錄與使用者上傳的檔案。

每個帳號同時最多執行一份研究，每小時最多規劃 20 次。多個 worker 也會共用資料庫租約，避免同時大量存取官方來源。中斷的 worker 可重新取得過期租約，最多嘗試兩次；舊 worker 的結果不會覆蓋新狀態。

## 匯入產出的 Excel

新擷取資料的第一張工作表為 **原始資料**，依金融專利範本的 97 欄排列。官方缺值留空，多值超過範本容量時在末尾增欄。**專利清單** 保留供既有流程使用。原有九個欄位維持不變，另有明確版本化的 **完整申請人(JSON v1)** 欄位。

新的完整申請人欄位保留英文空格、括號與多個申請人，避免舊格式把 `Bank of America` 截成 `Bank`。只有存在此欄位的檔案會啟用新讀取方式；無效的 JSON 名稱陣列會使該列報錯，不會悄悄退回舊的裁切方式。舊 Format A、Format B、識別碼及去重規則維持原樣。

**資料來源** 工作表保留官方 URL、擷取時間與搜尋條件。缺少必要名稱或摘要的紀錄會列入排除資訊。writer 在提供下載之前，會以系統 parser 實際讀回 workbook bytes。

## 驗證變更

執行基本檢查：

```sh
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm research:worker:build
```

資料庫測試需要可建立隔離資料庫的測試帳號。不要將正式資料庫管理連線交給測試。為研究生命週期測試設定 `TEST_RESEARCH_DATABASE_URL`；既有資料庫測試使用 `DATABASE_URL`。

主要契約與驗證位置：

- `lib/patent-search/contracts.ts` 定義條件、任務快照與串流事件。
- `lib/patent-search/workbook-contract.ts` 定義新匯出檔的完整申請人欄位。
- `tests/patent-search-export.test.ts` 驗證真實 workbook、公式形狀字串、新欄位與舊檔相容性。
- `tests/patent-search-jobs.test.ts` 驗證 PostgreSQL 權限、核准、租約、取消、過期及反序快照。
- `tests/patent-search-download.test.ts` 驗證瀏覽器下載失敗不會留下未處理拒絕。它不替代官方來源的實際測試。

程式未變更 `GraphViewer.tsx`、`GraphLayout.tsx` 或圖譜計算模組。圖譜 sidebar 的變更限於呈現層。

## 官方文件與元件來源

- [TwIP Search 官方操作與檢索語法](https://cloud.tipo.gov.tw/s690/twipsearch/static/zh/page03/)。
- [智慧局整合式專利檢索服務公告](https://www.tipo.gov.tw/tw/tipo1/799-99664.html)。
- [beUI agent 元件](https://beui.dev/components/agents/agent-activity)。
- [assistant-ui 官方安裝文件](https://www.assistant-ui.com/docs/manual-installation)。

beUI、assistant-ui 元件透過官方 registry 引入，保留既有共用 primitive。新對話使用 assistant-ui external-store runtime，沒有為介面改版升級既有分析流程的 AI SDK。
