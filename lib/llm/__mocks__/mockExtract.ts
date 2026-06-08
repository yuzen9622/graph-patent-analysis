import type { PatentRow, ExtractionResult } from '@/types/graph'

// 10 groups of mock keywords, each covering a Chinese fintech domain
export const MOCK_KEYWORDS: string[][] = [
  // 0 — AI / 人工智慧
  ['人工智慧', '機器學習', '深度學習', '神經網路', '預測模型', '自動化決策'],
  // 1 — 區塊鏈
  ['區塊鏈', '分散式帳本', '智能合約', '加密貨幣', '去中心化', '共識機制'],
  // 2 — 資安 / Security
  ['資訊安全', '身份驗證', '加密技術', '零信任架構', '資安防護', '生物辨識'],
  // 3 — 大數據 / Big Data
  ['大數據', '資料分析', '資料倉儲', '即時串流', '資料治理', '商業智慧'],
  // 4 — NLP / 自然語言處理
  ['自然語言處理', '文字探勘', '語意分析', '聊天機器人', '情感分析', '知識圖譜'],
  // 5 — ESG
  ['ESG評分', '永續金融', '碳排放揭露', '綠色債券', '社會責任投資', '氣候風險'],
  // 6 — 支付 / Payments
  ['行動支付', '電子錢包', '跨境匯款', '即時清算', '支付閘道', 'QR Code支付'],
  // 7 — 監理科技 / RegTech
  ['監理科技', '法規遵循', '反洗錢', '客戶盡職調查', '交易監控', '風險報告'],
  // 8 — 量化 / Quant
  ['量化交易', '演算法交易', '高頻交易', '風險模型', '衍生性商品', '投資組合優化'],
  // 9 — 保險科技 / InsurTech
  ['保險科技', '核保自動化', '理賠處理', '精算模型', '車聯網保險', '微型保險'],
]

// 10 groups of mock relations, 2 per group
export const MOCK_RELATIONS: Array<
  Array<{ source: string; target: string; relation: string; weight: number }>
> = [
  // 0 — AI
  [
    { source: '機器學習', target: '預測模型', relation: '用於建立', weight: 4 },
    { source: '深度學習', target: '神經網路', relation: '基於', weight: 5 },
  ],
  // 1 — 區塊鏈
  [
    { source: '區塊鏈', target: '智能合約', relation: '執行', weight: 5 },
    { source: '分散式帳本', target: '共識機制', relation: '依賴', weight: 4 },
  ],
  // 2 — 資安
  [
    { source: '身份驗證', target: '生物辨識', relation: '整合', weight: 4 },
    { source: '零信任架構', target: '加密技術', relation: '採用', weight: 3 },
  ],
  // 3 — 大數據
  [
    { source: '大數據', target: '資料分析', relation: '支援', weight: 5 },
    { source: '即時串流', target: '資料倉儲', relation: '輸入至', weight: 3 },
  ],
  // 4 — NLP
  [
    { source: '自然語言處理', target: '聊天機器人', relation: '驅動', weight: 4 },
    { source: '語意分析', target: '知識圖譜', relation: '構建', weight: 4 },
  ],
  // 5 — ESG
  [
    { source: 'ESG評分', target: '永續金融', relation: '影響', weight: 3 },
    { source: '碳排放揭露', target: '氣候風險', relation: '量化', weight: 3 },
  ],
  // 6 — 支付
  [
    { source: '行動支付', target: '電子錢包', relation: '連結', weight: 5 },
    { source: '跨境匯款', target: '即時清算', relation: '透過', weight: 4 },
  ],
  // 7 — RegTech
  [
    { source: '反洗錢', target: '交易監控', relation: '觸發', weight: 4 },
    { source: '法規遵循', target: '風險報告', relation: '產生', weight: 3 },
  ],
  // 8 — 量化
  [
    { source: '演算法交易', target: '高頻交易', relation: '實現', weight: 5 },
    { source: '風險模型', target: '投資組合優化', relation: '輸入', weight: 4 },
  ],
  // 9 — InsurTech
  [
    { source: '核保自動化', target: '精算模型', relation: '應用', weight: 4 },
    { source: '車聯網保險', target: '微型保險', relation: '延伸至', weight: 3 },
  ],
]

// Domain labels used in titles and abstracts, aligned to MOCK_KEYWORDS groups
const DOMAIN_LABELS = [
  'AI智能風控',
  '區塊鏈金融',
  '資安防護系統',
  '大數據分析平台',
  'NLP客服系統',
  'ESG永續評估',
  '行動支付系統',
  '監理科技平台',
  '量化投資系統',
  '保險科技應用',
]

const APPLICANTS = [
  '國泰金融',
  '富邦金融',
  '中信金控',
  '台灣銀行',
  '合作金庫',
  '第一金控',
  '玉山金控',
]

// 30 fixture patents spanning applicants and years 2018–2024
export const FIXTURE_PATENTS: PatentRow[] = Array.from({ length: 30 }, (_, i) => {
  const year = 2018 + (i % 7)       // cycles 2018–2024
  const applicant = APPLICANTS[i % APPLICANTS.length]
  const domain = DOMAIN_LABELS[i % 10]
  const mm = String((i % 12) + 1).padStart(2, '0')
  const dd = String((i % 28) + 1).padStart(2, '0')
  return {
    id: `fixture-${i}`,
    title: `${applicant}${domain}專利${i + 1}`,
    abstract: `本發明涉及${domain}領域，提出一種基於${MOCK_KEYWORDS[i % 10][0]}之金融科技解決方案，適用於${applicant}之業務場景。`,
    applicant,
    filing_date: `${year}/${mm}/${dd}`,
    application_number: `TW${year}${String(100000 + i).padStart(6, '0')}`,
    search_keyword: MOCK_KEYWORDS[i % 10][0],
  }
})

/**
 * Mock extraction. Maps each patent to its i%10 keyword/relation group.
 * Group index is derived from the trailing numeric suffix of patent.id when
 * available; otherwise falls back to a stable char-code sum so unknown ids
 * still produce deterministic output.
 */
export default async function mockExtract(patents: PatentRow[]): Promise<ExtractionResult[]> {
  return patents.map((patent) => {
    const trailingNum = patent.id.match(/(\d+)$/)
    const groupIndex = trailingNum
      ? parseInt(trailingNum[1], 10) % 10
      : [...patent.id].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 10

    return {
      patent_id: patent.id,
      translated_abstract: `[MOCK] ${patent.abstract ?? 'No abstract provided.'}`,
      keywords: MOCK_KEYWORDS[groupIndex],
      relations: MOCK_RELATIONS[groupIndex],
    }
  })
}
