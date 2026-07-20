import pLimit from "p-limit";
import { generateText } from "ai";
import type { PatentRow, ExtractionResult, RelationConfidence } from "@/types/graph";
import type { LanguageModel } from "ai";

const VALID_CONFIDENCES: readonly RelationConfidence[] = ["EXTRACTED", "INFERRED", "AMBIGUOUS"];

export const EXTRACTION_PROMPT_VERSION = "fintech-concepts-v2";

const SYSTEM_PROMPT = `你是一位專業的中文金融科技（FinTech）專利分析師。
使用者會提供一組專利摘要，請為每一筆專利：
1. 將摘要翻譯為繁體中文（若已是中文則潤飾使其更精確）。
2. 萃取 5–10 個「金融相關之具體技術概念（Financial Technology Concepts）」。
   【極度重要限制】：
   - 必須只萃取與「金融科技 (FinTech)」直接相關的專業名詞（例如：行動支付、智能理財、區塊鏈、風險控管、徵信、反洗錢）。
   - 禁止萃取非金融領域的通用技術名詞（如單純的資料庫、伺服器、演算法），若要萃取必須帶有金融場景（如：金融資料庫、支付伺服器）。
   - 絕對禁止萃取空泛詞彙（例如：系統、方法、裝置、模組、步驟、伺服器、網路）。
   - 名詞請盡量統整為業界標準詞彙，且長度盡量保持在 2~6 個字以內。
3. 找出實體關係（source → target），每條關係標註 relation 類型與 weight（1–5，5 最強），並提供 reason（解釋為何兩者有關聯及權重的依據）。並為每條關係標註 confidence：EXTRACTED（摘要中明確陳述此關係）、INFERRED（摘要未明講，但依技術脈絡合理推論）、AMBIGUOUS（證據薄弱、屬於猜測）。

注意：實體關係中的 \`source\` 與 \`target\` 必須來自於你在第二步中所萃取的 \`keywords\` 清單中。請勿在此步驟中使用非關鍵字清單內的詞彙。

回傳格式：純 JSON 陣列，不含任何 markdown 或說明文字。
每個元素結構如下：
{
  "index": <原始索引 number>,
  "translated_abstract": "<翻譯後摘要>",
  "keywords": ["keyword1", "keyword2", ...],
  "relations": [
    { "source": "<來源>", "target": "<目標>", "relation": "<關係類型>", "weight": <1-5>, "reason": "<關聯性與權重給分依據>", "confidence": "<EXTRACTED|INFERRED|AMBIGUOUS>" }
  ]
}`;

interface LLMBatchItem {
  index: number;
  translated_abstract: string;
  keywords: string[];
  relations: Array<{
    source: string;
    target: string;
    relation: string;
    weight: number;
    reason?: string;
    confidence?: string;
  }>;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function buildUserPrompt(patents: PatentRow[], startIndex: number): string {
  const items = patents.map((p, i) => ({
    index: startIndex + i,
    title: p.title,
    abstract: p.abstract,
    applicant: p.applicant,
  }));
  return JSON.stringify(items, null, 2);
}

function extractJsonArray(text: string): LLMBatchItem[] | null {
  // Try to find JSON array in the response (handles markdown code fences etc.)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed as LLMBatchItem[];
  } catch {
    return null;
  }
}

function emptyResult(patent: PatentRow): ExtractionResult {
  return {
    patent_id: patent.id,
    translated_abstract: patent.abstract ?? "",
    keywords: [],
    relations: [],
  };
}

async function extractBatch(
  patents: PatentRow[],
  startIndex: number,
  model: LanguageModel,
  maxRetries = 3,
): Promise<ExtractionResult[]> {
  const userPrompt = buildUserPrompt(patents, startIndex);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { text } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
      });

      const items = extractJsonArray(text);
      if (!items) {
        console.warn(
          `[extractor] attempt ${attempt + 1}: failed to parse JSON array`,
        );
        continue;
      }
      if (items.length !== patents.length) {
        console.warn(
          `[extractor] attempt ${attempt + 1}: expected ${patents.length} items, got ${items.length}`,
        );
        continue;
      }

      return items.map((item, i) => ({
        patent_id: patents[i].id,
        translated_abstract: item.translated_abstract ?? patents[i].abstract ?? "",
        keywords: Array.isArray(item.keywords) ? item.keywords : [],
        relations: Array.isArray(item.relations)
          ? item.relations.map((r) => ({
              source: String(r.source ?? ""),
              target: String(r.target ?? ""),
              relation: String(r.relation ?? ""),
              weight: Number(r.weight ?? 1),
              reason: r.reason ? String(r.reason) : undefined,
              confidence: VALID_CONFIDENCES.includes(r.confidence as RelationConfidence)
                ? (r.confidence as RelationConfidence)
                : "INFERRED",
            }))
          : [],
      }));
    } catch (err) {
      console.error(`[extractor] attempt ${attempt + 1} error:`, err);
    }
  }

  // Fallback: return empty results for all patents in the batch
  console.warn(
    `[extractor] all ${maxRetries} retries failed for batch at index ${startIndex}, using empty fallback`,
  );
  return patents.map((p) => emptyResult(p));
}

export async function runBatchExtraction(
  patents: PatentRow[],
  batchSize: number,
  concurrency: number,
  cancelCheck: () => boolean,
  onBatchDone: (results: ExtractionResult[], doneCount: number) => void,
  model: LanguageModel,
): Promise<ExtractionResult[]> {
  const chunks = chunkArray(patents, batchSize);
  const allResults: ExtractionResult[] = new Array(patents.length);
  const limit = pLimit(concurrency);

  let doneCount = 0;

  const tasks = chunks.map((chunk, chunkIndex) => {
    const startIndex = chunkIndex * batchSize;
    return limit(async () => {
      if (cancelCheck()) return;
      const batchResults = await extractBatch(chunk, startIndex, model);
      for (let i = 0; i < batchResults.length; i++) {
        allResults[startIndex + i] = batchResults[i];
      }
      doneCount += batchResults.length;
      onBatchDone(batchResults, doneCount);
    });
  });

  await Promise.all(tasks);

  return allResults.filter(Boolean);
}
