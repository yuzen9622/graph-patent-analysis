import { chromium, type Page } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { SOURCE_HOME, validateSearchPlan, type PatentSourceRecord, type SearchPlan } from "./contracts";
import { applicantMatches, buildTwipQuery, parseTwipWorkbook, TWIP_COLUMNS, type TwipResultLink } from "./twip-format";

interface RetrievalOptions {
  signal: AbortSignal;
  onBatch: (records: PatentSourceRecord[], total: number) => Promise<void>;
}

async function waitForResults(page: Page) {
  const count = page.getByText(/^\s*[\d,]+\s*筆結果\s*$/).first();
  await count.waitFor({ timeout: 45_000 });
  const total = Number((await count.innerText()).replace(/[^\d]/g, ""));
  if (!Number.isFinite(total)) throw new Error("無法讀取官方搜尋結果筆數。");
  if (total > 0) await page.locator(".el-table:visible tbody tr.el-table__row").first().waitFor({ timeout: 45_000 });
  return total;
}

async function readBibliography(page: Page, record: PatentSourceRecord) {
  await page.goto(record.sourceUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".el-form-item__label").filter({ hasText: /^申請號$/ }).first().waitFor();
  const fields: Record<string, {text: string; names: string[]; entries: string[]}> = await page.locator(".el-form-item:visible").evaluateAll(items =>
    Object.fromEntries(items.map(item => {
      const label = item.querySelector(".el-form-item__label")?.textContent?.trim();
      const content = item.querySelector<HTMLElement>(".el-form-item__content");
      const groups = Array.from(content?.querySelectorAll<HTMLElement>(":scope > div > *") ?? []);
      return [label, {
        text: content?.innerText.trim() ?? "",
        names: groups.map(group => group.querySelector("a")?.textContent?.trim()).filter((n): n is string => !!n),
        entries: groups.map(group => group.innerText.replace(/Espacenet/g, "").trim()).filter(Boolean),
      }];
    }))
  );
  const data = record.bibliography!;
  if (fields["申請號"]?.text.split(/\s+/)[0] !== record.applicationNumber) throw new Error("無法核對官方明細的申請號。");
  data.kind = fields["類別代碼"]?.text ?? "";
  data.certificate = fields["證書號"]?.text ?? "";
  const count = fields["被參考次數"]?.text.replaceAll(",", "");
  data.citedCount = count && /^\d+$/.test(count) ? Number(count) : null;
  if (fields["申請人"]?.names.length) record.applicants = fields["申請人"].names;
  if (fields["發明人"]?.names.length) data.inventors = fields["發明人"].names;
  if (fields["當前專利權人"]?.names.length) data.owners = fields["當前專利權人"].names;
  if (fields["代理人"]) data.agents = fields["代理人"].text.split(/[;；]/).map(s => s.trim()).filter(Boolean);
  const references = fields["引用專利"]?.entries ?? [];
  if (references.length) data.references = [...references, ...(fields["引用非專利"]?.entries ?? (fields["引用非專利"] ? [fields["引用非專利"].text] : []))];
}

export async function retrieveTwipPatents(input: SearchPlan, { signal, onBatch }: RetrievalOptions) {
  const plan = validateSearchPlan(input);
  signal.throwIfAborted();
  const root = process.env.RESEARCH_TEMP_DIR ?? path.join(process.cwd(), "data", "research-tmp");
  await mkdir(root, { recursive: true });
  const downloadsPath = await mkdtemp(path.join(root, "twip-"));
  const browser = await chromium.launch({
    headless: true,
    downloadsPath,
    ...(process.env.TWIP_BROWSER_CHANNEL || process.platform === "darwin" ? { channel: process.env.TWIP_BROWSER_CHANNEL ?? "chrome" } : {}),
  }).catch(async (error: unknown) => { await rm(downloadsPath, { recursive: true, force: true }); throw error; });
  const cancel = () => { void browser.close().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const records: PatentSourceRecord[] = [];
  let total = 0;
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block", locale: "zh-TW" });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.protocol === "https:" && url.hostname === "cloud.tipo.gov.tw" ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(SOURCE_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByRole("textbox", { name: /輸入關鍵字/ }).fill(buildTwipQuery(plan));
    await page.getByRole("button", { name: "檢索", exact: true }).click();
    await page.waitForURL((url) => url.hash.startsWith("#/patent/search/result"));
    total = await waitForResults(page);
    await onBatch([], total);
    const target = Math.min(total, plan.limit ?? total);
    const seen = new Set<string>();
    let examined = 0;

    // Use the documented, anonymous UI export, not hidden API endpoints or credentials.
    while (records.length < target && examined < total) {
      signal.throwIfAborted();
      const rows = page.locator(".el-table:visible tbody tr.el-table__row");
      const pageSize = await rows.count();
      if (!pageSize) throw new Error("官方結果清單尚未載入。");
      let offset = 0;
      while (offset < pageSize && records.length < target) {
        const count = Math.min(pageSize - offset, target - records.length);
        const links: TwipResultLink[] = [];
        for (let index = 0; index < count; index++) {
          signal.throwIfAborted();
          const row = rows.nth(offset + index);
          const anchors = await row.locator('a[href*="/patent/detail?"]').evaluateAll((elements) => elements.map((element) => ({ text: (element as HTMLAnchorElement).innerText.trim(), url: (element as HTMLAnchorElement).href })));
          if (anchors.length < 3) throw new Error("官方結果列格式已改變，無法安全取得來源。");
          const titleLines = anchors[2].text.split("\n").map((line) => line.trim()).filter(Boolean);
          links.push({ publicationNumber: anchors[0].text, url: anchors[0].url, titleEn: titleLines.slice(1).join(" ") });
          await row.locator("label.el-checkbox").click();
          if (!(await row.getByRole("checkbox").isChecked())) throw new Error("無法勾選官方專利結果。");
        }
        await page.getByRole("button", { name: "下載", exact: true }).click();
        for (const name of TWIP_COLUMNS) {
          const checkbox = page.getByRole("checkbox", { name, exact: true });
          if (!(await checkbox.isChecked())) await checkbox.locator("xpath=ancestor::label").click();
          if (!(await checkbox.isChecked())) throw new Error(`無法選取官方匯出欄位：${name}`);
        }
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60_000 }),
          page.getByRole("button", { name: "Excel", exact: true }).click(),
        ]);
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          signal.throwIfAborted();
          size += chunk.length;
          if (size > 10 * 1024 * 1024) throw new Error("官方匯出檔超過處理上限。");
          chunks.push(chunk);
        }
        const batch = parseTwipWorkbook(Buffer.concat(chunks), links, new Date().toISOString());
        if (batch.length !== count) throw new Error("官方匯出筆數與勾選結果不同，已停止以避免資料缺漏。");
        const start = records.length;
        try {
          for (const record of batch) {
            signal.throwIfAborted();
            if (seen.has(record.id)) throw new Error("官方分頁重複回傳資料。");
            seen.add(record.id);
            examined++;
            const detail = await context.newPage();
            try {
              await readBibliography(detail, record);
              if (plan.exactApplicants && plan.applicants.length && !applicantMatches(record.applicants, plan.applicants)) continue;
              records.push(record);
            } finally { await detail.close(); }
            await delay(350, undefined, { signal });
          }
        } finally {
          if (records.length > start) await onBatch(records.slice(start), total);
        }
        if (records.length >= target || examined >= total) break;
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "清除選取", exact: true }).click();
        offset += count;
      }
      if (records.length >= target || examined >= total) break;
      const firstUrl = await rows.first().locator('a[href*="/patent/detail?"]').first().evaluate(a => (a as HTMLAnchorElement).href);
      await delay(1200, undefined, { signal });
      const next = page.getByRole("button", { name: "下一頁", exact: true });
      if (await next.isDisabled()) throw new Error("官方清單提早結束。");
      await next.click();
      await page.waitForFunction((previous) => {
        const anchor = document.querySelector<HTMLAnchorElement>('.el-table tbody tr.el-table__row a[href*="/patent/detail?"]');
        return anchor && anchor.href !== previous;
      }, firstUrl);
      await waitForResults(page);
    }
    return { records, total };
  } catch (error) {
    signal.throwIfAborted();
    throw new Error("TwIP Search 暫時無法完成取得資料；可能是服務逾時、需要人工驗證或頁面格式異動。請稍後重試，系統不會繞過存取限制。", { cause: error });
  } finally {
    signal.removeEventListener("abort", cancel);
    try { await browser.close(); }
    finally { await rm(downloadsPath, { recursive: true, force: true }); }
  }
}
