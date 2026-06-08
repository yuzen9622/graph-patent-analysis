import pLimit from "p-limit";
import { generateText } from "ai";
import type { PatentRow, ExtractionResult } from "@/types/graph";
import type { LanguageModel } from "ai";

const SYSTEM_PROMPT = `你是一位專業的中文金融專利分析師。
使用者會提供一組專利摘要，請為每一筆專利：
1. 將摘要翻譯為繁體中文（若已是中文則潤飾使其更精確）
2. 萃取 5–10 個關鍵字（concepts/technologies/methods）
3. 找出實體關係（source → target），每條關係標註 relation 類型與 weight（1–5，5 最強）

回傳格式：純 JSON 陣列，不含任何 markdown 或說明文字。
每個元素結構如下：
{
  "index": <原始索引 number>,
  "translated_abstract": "<翻譯後摘要>",
  "keywords": ["keyword1", "keyword2", ...],
  "relations": [
    { "source": "<來源>", "target": "<目標>", "relation": "<關係類型>", "weight": <1-5> }
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
  // Mock mode
  if (process.env.USE_LLM_MOCK === "true") {
    const { default: mockExtract } = await import("./__mocks__/mockExtract");
    const results: ExtractionResult[] = [];
    const chunks = chunkArray(patents, batchSize);

    for (const chunk of chunks) {
      if (cancelCheck()) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const batchResults = await mockExtract(chunk);
      results.push(...batchResults);
      onBatchDone(batchResults, results.length);
    }

    return results;
  }

  // Real LLM mode
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
