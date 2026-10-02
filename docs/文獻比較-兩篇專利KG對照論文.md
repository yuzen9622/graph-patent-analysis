# 文獻比較：兩篇專利知識圖譜對照論文與本系統的異同

- **文件版本**：v1.0
- **建立日期**：2026-09-18
- **核對方式**：兩篇 PDF 全文以 `pdftotext -layout` 取出後逐句核對；本檔所有數字、公式與引文皆已回查原文對應段落（核對日 2026-09-18）。
- **同系列文件**：
  - 公式與參數的單一事實來源：`docs/知識圖譜分析結果解讀與概念抽取方法.md`
  - 每個設定的文獻依據：`docs/文獻對應與方法正當性.md`
  - 方法章節寫法：`docs/論文方法章節撰寫指引.md`
- **用途**：回答「這兩篇跟我們有什麼不同」「我們的研究缺口引誰」「哪些做法可以搬過來」。

---

## 零、一句話結論

**兩篇都完全不碰專利文字語意，技術單位一律是 IPC 分類碼；而兩篇都做了本系統目前沒做的事——時間切分預測與外部驗證。**

這代表兩件事：本系統以 LLM 抽取概念的路線在這兩篇的方法論裡是空白（可主張為差異化貢獻）；反之，本系統在驗證設計上落後於它們（必須補）。

---

## 一、對照論文 A：Wei &amp; Zhang (2026)

> Wei, J., &amp; Zhang, T. (2026). A novel method to identify potential collaborators with a patent-based knowledge graph. *The Journal of Technology Transfer*, 51, 2330–2366. doi:10.1007/s10961-025-10258-y

研究任務：**為企業找出潛在合作對象**（不是找技術）。

### 1.1 資料與抽樣

- 資料庫：Patsnap Global Patent Database。
- 案例：中國某 IC 晶片設計公司（文中匿名為「H Company」，自述為中國前三大 IC 設計公司，位於深圳）。
- 第一階段（技術聚類）：2023 年 10 月檢索，限申請人／專利權人為 H Company、申請日至 2022 年止（明確排除 2023 年以避免公開遲延），共 **8706 件**發明專利申請與授權專利，其中中國發明申請 2041 件、中國授權 926 件。
- 第二階段（建圖）：限 IPC 為 `G06F3/041`、`G06F3/044`、`G06F3/0354`，時間同樣至 2022 年止。清理與實體對齊後得 **4505 個 entity、9246 筆 patent behavior**（joint application 4199、transfer 4595、license 452）。

### 1.2 技術聚類：IPC 共現矩陣 + PCA

1. 取專利標註頻次最高的 **Top 20 IPC 碼**（使用 **subgroup 全碼**，如 `G06F3/041`，不截斷到 subclass）。
2. 每篇專利編成 20 維向量，值為「是否標註該分類」（**binary**，原文 "to indicate whether it is annotated with a specific classification"）。
3. 以此建 IPC 共現矩陣，跑 **PCA**，得 **9 個技術群**。第一群佔總變異 7.897%，內容為 `G06F3/041`＋`G06F3/044`＋`G06F3/0354`。
4. 效度檢定：**KMO = 0.649**、Bartlett 球形檢定 p = 0.000。中國發明專利子樣本總變異 7.187%。

> ⚠️ 原文未明寫「9 個成分」是依何規則決定（特徵值 &gt; 1？陡坡圖？累積變異門檻？），僅呈現結果。Table 3 只顯示載荷約 ≥ 0.42 的項目，但也未把該門檻寫成規則。群集命名是人工依領域知識判讀，非自動化。

### 1.3 知識圖譜 schema

- **節點只有一類**：entity ＝ 任何創新行為者（企業、大學、研究機構、政府單位、個人）。
- **邊有三類**，即三種專利法律行為：
  - joint application（共同申請，本質對稱）
  - transfer（讓與，assignor → assignee）
  - license（授權，licensor → licensee）
- 存於 **Neo4j**。原文未定義任何儲存於邊上的數值權重——所謂「strength」全部是下游的圖論聚合量，不是邊屬性。
- 沒有把三種行為合成單一權重的公式：這是一張 **multiplex／multi-relational graph**，三層並存。

### 1.4 Entity alignment（可直接借用的部分）

規則鏈，非相似度分數（全文無 Levenshtein／cosine 等門檻）：

1. 以中國**統一社會信用代碼（Unified Social Credit Code, USCC）**為判定獨立法人的標準。
2. USCC 不足時依序比對：**名稱 → 郵遞區號（若有）→ 地址**。原文理由是郵遞區號比地址標準化（地址常含縮寫）。
3. 申請人／專利權人與讓與人／受讓人判定為同一實體但名稱不同時，**以申請人／專利權人的名稱為準**（因資料庫對前者的標準化程度較高）。
4. License 的對齊**跳過郵遞區號**（licensor／licensee 該欄位常缺）。
5. 跨行為時序一致性檢查：比對同一專利的 transfer 與 license 先後，用以剔除不合法紀錄（例如已讓與後又授權）。
6. 多方關係展開為一對一紀錄（2 位專利權人讓與 3 位受讓人 → 6 筆），並刪除自環（assignor == assignee）。
7. 自陳為 **semi-automated**：無郵遞區號或使用不同簡稱時需人工確認。

### 1.5 核心實體指標

Definition 1（Eq. 1）：

```text
Relationship_strength_i = 與實體 i 直接相連的關係數 / (圖中實體總數 − 1)
```

Definition 2（Eq. 2）：

```text
Control_strength_i = 1/[(N−1)(N−2)/2] × Σ_{s≠i≠t} (經過 i 的 s–t 最短路徑數 / s–t 最短路徑總數)
```

原文自述這兩者分別「in line with」degree centrality 與「extend」betweenness centrality 的概念。**實際上就是正規化 degree centrality 與正規化 betweenness centrality**。closeness 與 eigenvector centrality 全文未使用。

### 1.6 合作者預測

Definition 3（Eq. 3）：

```text
Path_length_ij = min(Length(p)), p ∈ P_ij     // 不可達時記 +∞
Path_strength   = 連接兩實體的最短路徑條數     // Table 1 定義，無獨立編號公式
```

- 依 path length 分層：1 = 第一層（已直接合作過）、2 = 第二層、3 = 第三層；同層內以 path strength 較高者優先（「更穩定可靠」）。
- **無合成分數**：沒有把 path length 與 path strength 加權成單一排序值。
- **純圖論，零 machine learning**（ML 與 LLM 都被列在 future work）。
- 實證只做到第三層，但原文未宣告這是演算法上的硬截斷。

### 1.7 評估設計

- 對照組：用**同一批專利資料**，各取一種行為單獨建網路，得三個 single-behavior network。
- 比較項目：節點數、關係數、最大 degree centrality、最大 betweenness（Table 4）；Top 30 名單的重疊比例（Tables 7–8，例如 KG vs joint application network 的 relationship strength 重疊 66.67%）。
- **摘要那兩個數字的真身**：428.06%（path strength）與 57.14%（推薦數）是 §5.5 中**單一子案例（Solic Technology）第三層路徑**的改善；§5.4 第二層對應的是 192.06% 與 41.67%。分母是同一實體對、同一層級下對應 single-behavior network 的數值，**不是全圖統計**。
- **無 ground truth、無時間切分、無 precision/recall**。整套驗證是「結構對照」：多層圖是否比任一單層圖浮現更多／更密的關係與路徑，而非驗證這些路徑後來真的變成合作。

### 1.8 作者自陳限制

1. 僅靠專利資料，無法捕捉尚未申請專利的非正式或萌芽期合作；建議未來納入學術論文、R&amp;D 投資紀錄、社群媒體。
2. 單一產業案例，跨領域適用性待驗證。
3. 預測能力「可以再靠 machine learning 與大型語言模型精進」——明列為 future work，反證本研究未使用。

---

## 二、對照論文 B：Choi, Lee &amp; Yoon (2023)

> Choi, J., Lee, C., &amp; Yoon, J. (2023). Exploring a technology ecology for technology opportunity discovery: A link prediction approach using heterogeneous knowledge graphs. *Technological Forecasting &amp; Social Change*, 186, 122161.

研究任務：**為企業找出下一步該投入哪個技術領域**（technology opportunity discovery, TOD）。

### 2.1 資料與時間切分

- 資料庫：USPTO bulk data；assignee／inventor 消歧**直接採用 PatentsView 的消歧結果**。
- 母體：**3,148,609 件**專利（登記於 2010–2019）。
- 案例領域：生物技術（依 OECD 2009 的領域界定以分類碼篩出），**94,982 件**。
- **時間切分**：former period **2010–2014**／later period **2015–2019**，各自建一張獨立的 technology ecology；former 用來學，later 的實際連結狀態用來驗。五年窗的理由是「企業 TOD、R&amp;D 與專利活動的週期」。
- Former ecology 規模：33,534 件專利、3578 個 assignee、52,306 個 inventor、1242 個 IPC 碼。
- 焦點公司：**Genentech**（原文明示），選定理由是「依其專利登記歷史為技術活躍、持續開拓新技術領域的公司」——立意抽樣，非隨機。

### 2.2 異質知識圖譜 schema

四類節點：


| 節點                  | 定義                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| patent              | 串起其他三類節點的樞紐                                                                                                                                |
| assignee            | 專利著錄的受讓人／公司（PatentsView 消歧後）                                                                                                               |
| inventor            | 發明人（PatentsView 消歧後）                                                                                                                       |
| **technology area** | **IPC main group**（原文：`IPC codes were analyzed at the level of the main group to represent unit technology areas`），例如 `A61K 35`、`C07D 519` |


五類邊：

1. technology area – technology area：IPC 分類碼**共現**
2. inventor – inventor／assignee – assignee：**共同發明／共同申請**（合作，也可能代表潛在競爭）
3. technology area – inventor：透過共同連結的專利產生，代表該發明人在該領域有經驗
4. inventor – assignee：僱用／合作
5. **assignee – technology area**：該公司**已採納**該技術領域 ← **本研究的預測目標**

合併方式：以 patent 節點為樞紐，把各自獨立的同質／雙邊關係圖 merge 成一張異質網路（technology ecology）。

### 2.3 特徵工程（528 維）

全部在**合併後的異質圖**上直接針對節點鄰居集合 Γ(·) 計算（鄰居可以是混合型別），**不做同質投影**。

**(1) Technological centrality**（作用於單一節點）：degree centrality、clustering coefficient、triangles、eigenvector centrality、entropy、PageRank。

**(2) Technological similarity**（作用於 u–v 這一對）：

```text
common neighbor          = |Γ(u) ∩ Γ(v)|
Jaccard                  = |Γ(u) ∩ Γ(v)| / |Γ(u) ∪ Γ(v)|
Adamic-Adar              = Σ_{i∈Γ(u)∩Γ(v)} 1/log|Γ(i)|
resource allocation      = Σ_{i∈Γ(u)∩Γ(v)} 1/|Γ(i)|
preferential attachment  = |Γ(u)| × |Γ(v)|
```

**(3) Technological context**：**network embedding**（不是文字 embedding）。文中列出 LINE／node2vec／DeepWalk／Struc2Vec 為可選，實作採 **LINE**，每個節點表示為 **256 維**向量。

拼接：每條邊 = **528 維** = 中心性 5×2 ＋ LINE embedding 256×2 ＋ 相似度 6（原文逐字如此，5+5+256+256+6 = 528；注意正文列了 6 個中心性指標但維度寫 5，原文未解釋此落差）。計算工具為 Python NetworkX 與 SciPy。

### 2.4 樣本設計與模型

四種連結變化型態（Table 4），用意是避免偏態訓練集：


| Type       | 定義                    | 筆數     |
| ---------- | --------------------- | ------ |
| I（1 → 1）   | 前後期都存在                | 15,866 |
| II（1 → 0）  | 前期有、後期消失              | 26,410 |
| III（0 → 1） | 前期無、後期新出現             | 14,405 |
| IV（0 → 0）  | 兩期皆無（依其他型態的平均連結數隨機生成） | 20,000 |


- 正樣本（I＋III）30,271；負樣本（II＋IV）下採樣至 30,000 → 共 **60,271** 筆，正負約 1:1。
- 切分：training 75% / validation 25%（此為前期內部切分，用來挑模型）；後期實際連結狀態為外部驗證。
- 模型：比較多種後選用 **XGBoost**。grid search 最佳超參：n_estimators = 700、learning_rate = 0.1、max_depth = 8、L1 = L2 = 1.2、subsample = 0.8。
- 10-fold CV：**accuracy 84.5%、recall 84.4%、precision 85.8%**。**未報告 AUC 或 F1**。

### 2.5 排序：TOPSIS

13 個量化準則（Table 3）：

- **Firm-specific（內部脈絡，7 個）**：collaboration coverage、collaboration intensity、inventor coverage、inventor intensity、technology association coverage、technology association intensity、technological newness-to-firm（以 **IPC 階層結構**算候選領域與公司主要技術領域的距離）。
- **Domain-specific（外部脈絡，6 個）**：technology growth、technology activity、technology strength（平均前引數）、technology competition intensity（Herfindahl 式）、protection scope（平均 claim **數量**）、pace of technological change（專利與其引用專利的年齡中位差）。

流程：向量正規化 → **案例中給予相同權重（identical weight）** → 依準則定正／負理想解（PS 與 PTC 為愈小愈好，其餘愈大愈好）→ `ξ_i = d_i⁻ / (d_i⁺ + d_i⁻)` 排序。權重客製化被列為延伸用法，本案例未做。

### 2.6 結果與驗證

- 焦點公司在後期 ecology 中已涉足 71 個子領域（221 件專利），有 **2768 個未涉足領域**待評估 → 模型篩出 **148 個候選**。
- TOPSIS Top 10：`A61K 35`（ξ = 0.7431）、`A01H 5`、`A01H 1`、`C07D 519`、`G01N 27`、`B01L 3`、`C12P 13`、`G01N 21`、`G16H 50`、`B82Y 5`。
- **作者自己承認 accuracy／precision 不適用**於「機會是否被採納」這種尚未完結的事件，因此另做兩層驗證：

  **(a) 回溯驗證（Table 6）**：追蹤該公司 2020-01 至 2021-08-10 實際登記的 189 件專利，涉及 59 個 IPC main group，其中 **19 個是全新領域**；這 19 個裡有 **14 個（74%）落在本研究提出的 148 個候選內**；該 19 個新領域的 51 件專利中，48 件（94%）屬於這 14 個重疊領域。

  **(b) 跨公司泛化（Table 7）**：對隨機挑選的 15 家專利數足夠的公司計算 false negative rate、false positive rate 與 **Youden's J**（`J = 1 − FNR − FPR`；原文 Table 7 欄位標示為 `(3) = 1−(1)+(2)`，實際數值符合前者）。焦點公司（Firm2）FNR = 0.0968、FPR = 0.0800、**J = 0.8232**；15 家全距為 J = 0.5743（Firm14）至 0.8572（Firm6）。
- **未做專家訪談／評分**：全文無 expert interview、survey、Delphi；驗證完全基於事後專利登記事實。

### 2.7 作者自陳限制

1. 只涵蓋專利可得的技術性因子，未納入市場、政策等非技術因素。
2. 僅適用於技術開發與專利活動活躍的公司；firm-specific 指標全由專利資訊推得，未整合 R&amp;D 能力或夥伴關係等外部資料。
3. **黑箱**：「the specific mechanism is hidden in high-dimensional data learning and challenging to track... this is not completely explainable.」
4. 單一案例：link prediction 那一段驗過 15 家，但完整流程（含 TOPSIS）只在一家公司上跑完。

### 2.8 Future work 第一條（本系統的研究缺口引文）

> "Technology ecology structures can be advanced by additionally employing knowledge graphs of **technical keywords representing the problems, solutions, or functions in patent text data**."

**這句話可直接引為本研究的缺口**：TFSC 上的作者明文指出「用專利文字中的技術關鍵詞知識圖強化技術生態結構」是該做而他們沒做的事。

---

## 三、三方對照表


| 維度                     | A：Wei &amp; Zhang (2026)              | B：Choi et al. (2023)                        | 本系統                                                                 |
| ---------------------- | ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| 研究任務                   | 找潛在合作者                                | 找技術機會                                       | 描繪技術版圖（描述性）                                                         |
| 資料規模                   | 單一公司 8706 件 → 建圖 4505 entity          | 生技 94,982 件（母體 3,148,609）                   | 依設定取前 N 筆（非隨機）                                                      |
| **技術單位來源**             | IPC subgroup 全碼                       | IPC main group                              | **LLM 從摘要抽概念**（`fintech-concepts-v2`，5–10 個/篇）                      |
| **是否用 NLP／LLM 處理專利文字** | ❌ 完全不用                                | ❌ 完全不用（embedding 指 network embedding）       | ✅ 三者中唯一                                                             |
| 節點型別數                  | 1（entity）                             | 4（patent／assignee／inventor／technology area） | 3（申請人／專利／概念）                                                        |
| 邊語意                    | 3 種法律行為（multiplex）                    | 5 種結構關係                                     | 結構邊（申請了／包含）＋共現邊＋LLM 候選語意邊                                           |
| 邊權重正規化                 | 無（原始計數）                               | 圖上不正規化，正規化在特徵層                              | Jaccard／NPMI／association strength 可切換                               |
| 分群方法                   | PCA（對 IPC，不對圖）                        | 不分群（改做 link prediction）                     | Louvain（`lib/louvain.ts:97` 預設權重為 association strength、`:96` resolution = 1，並回報各社群連通分量數） |
| 實體正規化                  | USCC → 名稱 → 郵遞區號 → 地址（semi-automated） | PatentsView 消歧結果                            | 完全相同字串＋同義詞表；近似詞（如「行動支付」vs「行動支付技術」）仍為兩節點                             |
| 時間處理                   | ❌ 單一靜態切面                              | ✅ 前後兩期，前期預測後期                               | 中位年箭頭＋timelapse（描述性，非預測）                                            |
| 預測模型                   | 純圖論（最短路徑）                             | XGBoost（528 維特徵）                            | 無預測任務                                                               |
| 多準則排序                  | 無                                     | TOPSIS，13 準則等權                              | 無                                                                   |
| **外部驗證**               | ❌ 僅結構對照組                              | ✅ 回溯命中 74% ＋ 15 家公司 Youden's J              | ❌ 無                                                                 |
| **抽取品質校驗**             | 不適用                                   | 不適用                                         | ❌ **未做（頭號缺口）**                                                      |
| 可追溯性                   | Neo4j 路徑可回溯                           | ⚠️ 作者自陳 256 維嵌入導致不可解釋                       | ✅ 每條共現邊可列出支持專利 ID                                                   |


---

## 四、優缺點分析

### 4.1 A 的優點

1. **multiplex 分層有真實洞見**。拆開三種行為後發現：transfer 網路節點最多但密度最低（市場式單向流動、合作不穩定、轉換成本低），joint application 網路節點少但密度最高（需雙方投入知識，形成長期合作）。這個「不同專利行為對應不同合作時程」的結論只有拆層才看得到，本系統的單層共現網路沒有對應物。
2. **Entity alignment 規則鏈寫得清楚可照抄**（見 §1.4）。
3. 指標簡單、可解釋、全程可回溯（Neo4j）。

### 4.2 A 的缺點

1. **兩個「新指標」是既有中心性換名**：relationship strength ＝ 正規化 degree centrality，control strength ＝ 正規化 betweenness。原文自己用 "in line with" 與 "extend" 帶過。新穎性其實在 multiplex 資料建構，不在指標。
2. **宣稱 predictive，但沒有預測驗證**：無時間切分、無 ground truth、無 precision/recall。所謂 predictive 只是「圖上找得到 2–3 跳的路徑」。
3. **關鍵百分比的外部效度薄弱**：428.06%／57.14% 出自單一子案例的單一層級（見 §1.7）。
4. **內部數字不一致**（見 §1.9），引用時要避開 Table 4 的節點數與 centrality 值。
5. 完全忽略專利內容：同一 IPC 下兩家公司做的事可能天差地別，此框架看不見。

### 4.3 B 的優點

1. **方法論嚴謹度三者最高**：時間切分、四型樣本設計避免偏態、正負樣本平衡、grid search＋10-fold CV、事後回溯驗證、跨 15 家公司泛化測試。
2. **知道自己的指標不適用並換掉**：明說 accuracy／precision 無法直接套用於「機會是否被採納」，改用 Youden's J。這種自覺是本系統限制節可模仿的寫法。
3. TOPSIS 把 148 個候選壓成可決策排序，且明確區分內部（firm-specific）與外部（domain-specific）兩組準則。

### 4.4 B 的缺點

1. **黑箱（作者自陳）**：256 維 LINE embedding 讓「為什麼推薦這個領域」無法追溯。這是本系統的相對優勢。
2. **技術單位＝IPC main group，粒度粗且滯後**：尚無專屬 IPC 碼的新興技術，在定義上就看不見——而 TOD 要找的正是新興技術。這個內在張力正是其 future work 第一條的由來。
3. TOPSIS 案例採等權重，形同未加權；權重客製化推給未來研究。
4. 完整流程只在一家公司跑完。

---

## 五、與本系統的異同

### 5.1 相同

- 三者都是「專利 → 圖 → 分析」，都用 patent metadata 建異質結構、都算網路指標。
- 都把圖定位為探索與決策支援工具，而非權威本體。
- 都用到 Jaccard 這類集合相似度（B 當特徵，本系統當線寬）。
- 都以機構／申請人為分析主體之一（A 是唯一主體，B 是預測端點，本系統是機構網路）。

### 5.2 根本不同

1. **概念層的來源（最大分野）**。A、B 的技術單位是 IPC 分類碼：官方、穩定、跨研究可比，但粗、滯後、無法表達 IPC 未涵蓋的新概念。本系統的技術單位是 LLM 從摘要抽出的概念：細、即時、語意豐富，但無權威來源、需校驗、且會產生近似詞重複節點。**兩者的優勢與弱點剛好反向互補。**
2. **任務型態**。A、B 是 predictive／prescriptive，本系統是 descriptive。這不是缺陷，但方法章必須講清楚，否則審稿人會拿 B 的 74% 命中率來問「你的驗證呢」。
3. **驗證邏輯**。B 有真正的 ground truth（後來是否真的申請），A 至少有結構對照組，本系統兩者皆缺。

---

## 六、可搬過來的三件事（按性價比排序）

### 6.1 移植 B 的時間切分驗證（最高優先）

系統已有年份篩選與 timelapse，只需：

1. 把樣本切成前後兩期（切點規則見 `docs/論文方法章節撰寫指引.md` §9.4）。
2. 用前期共現網路預測後期**新出現的共現邊**。
3. baseline 用無參數的 link prediction 分數即可（**Adamic-Adar**、**resource allocation**、common neighbor、Jaccard、preferential attachment，公式見 §2.3），不必引入 XGBoost。
4. 報告命中率／FNR／FPR／Youden's J。

效益：把「描述性」升級為「有驗證的探索」，同時補掉 `docs/文獻對應與方法正當性.md` §2.8 標記的「中位年箭頭無文獻支撐」缺口——時間切片是該領域慣例做法。

### 6.2 移植 A 的 entity alignment 規則鏈

改寫成本系統的機構名稱正規化規格（統一編號 → 名稱 → 地址），並類比到概念正規化（對應 EDC canonicalization 那條線，見 `docs/文獻對應與方法正當性.md` §4.1）。

### 6.3 借用 B 的「指標不適用就換」寫法

限制節可循其模式：明說某個常規指標在本研究情境下為何不適用，再提出替代指標——比單純承認「未做驗證」有說服力。

---

## 七、論文定位可直接使用的句子

> 既有的專利知識圖譜研究多以國際專利分類碼作為技術單位：Wei &amp; Zhang (2026) 以 IPC 共現矩陣結合主成分分析界定企業技術群，並以共同申請、讓與、授權三類專利行為建構多層合作圖譜；Choi et al. (2023) 則以 IPC main group 作為技術領域節點，建構含專利、受讓人、發明人與技術領域的異質知識圖譜並進行連結預測。兩者皆未對專利說明文字進行語意層次的概念抽取。Choi et al. (2023) 於其研究限制中明確指出，技術生態結構可藉由納入「表達專利文本中之問題、解法或功能的技術關鍵詞知識圖譜」而獲得強化。本研究即針對此一缺口，以大型語言模型自專利摘要抽取技術概念，建構可回溯至來源專利的候選知識圖譜。

引用時請回查原文頁碼；本檔僅核對內容，未逐項核對頁碼。

---

## 八、待辦與已知不一致

- `docs/知識圖譜分析結果解讀與概念抽取方法.md` §13 參數表仍記「社群邊權重 = `support_count`」，但 `lib/louvain.ts:97` 的預設已是 `association`，且 `runLouvain` 會回報各社群連通分量數（commit `5f825ba`，2026-08-20）。**論文附錄若照抄該表會寫錯，需修正。**
- 本檔第 6.1 節的時間切分驗證尚未實作。
- LLM 抽取品質的人工校驗仍未進行（見 `docs/文獻對應與方法正當性.md` §6 第 1 項，為五個審稿風險中唯一不補可能致命者）。

