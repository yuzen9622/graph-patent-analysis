import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { retrieveTwipPatents } from "@/lib/patent-search/twip";
import type { SearchPlan } from "@/lib/patent-search/contracts";

vi.mock("playwright", () => ({
  chromium: {
    launch: async () => {
      let rejectDownload: ((error: Error) => void) | undefined;
      const row = {
        locator: (selector: string) => selector.startsWith("a[") ? { evaluateAll: async () => [
          { text: "I123456", url: "https://cloud.tipo.gov.tw/s690/twipsearch/#/patent/detail?id=fixture&database=TWB" },
          { text: "001234567", url: "https://cloud.tipo.gov.tw/s690/twipsearch/#/patent/detail?id=fixture&database=TWB" },
          { text: "測試專利", url: "https://cloud.tipo.gov.tw/s690/twipsearch/#/patent/detail?id=fixture&database=TWB" },
        ] } : { click: async () => {} },
        getByRole: () => ({ isChecked: async () => true }),
      };
      const page = {
        setDefaultTimeout: () => {},
        goto: async () => {},
        waitForURL: async () => {},
        getByText: () => ({ first: () => ({ waitFor: async () => {}, innerText: async () => "1 筆結果" }) }),
        locator: () => ({ first: () => ({ waitFor: async () => {} }), count: async () => 1, nth: () => row }),
        getByRole: (_role: string, options: { name?: string }) => ({
          fill: async () => {}, isChecked: async () => true,
          click: async () => { if (options.name === "Excel") throw new Error("Page closed while clicking export"); },
        }),
        waitForEvent: () => new Promise((_resolve, reject) => { rejectDownload = reject; }),
      };
      return {
        newContext: async () => ({ route: async () => {}, newPage: async () => page }),
        close: async () => { rejectDownload?.(new Error("Download cancelled by page close")); },
      };
    },
  },
}));

afterEach(() => vi.unstubAllEnvs());

describe("TwIP download cancellation boundary", () => {
  it("handles both the click failure and the pending download rejection", async () => {
    vi.stubEnv("RESEARCH_TEMP_DIR", path.join(process.cwd(), ".audit", "download-rejection-test"));
    const unhandled: unknown[] = [];
    const listener = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", listener);
    const plan: SearchPlan = { keywords: ["測試"], match: "all", applicants: [], dateField: "filing", dateFrom: null, dateTo: null, ipc: [], sort: "relevance", limit: 1 };
    try {
      await expect(retrieveTwipPatents(plan, { signal: new AbortController().signal, onBatch: async () => {} })).rejects.toThrow("暫時無法完成");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally { process.off("unhandledRejection", listener); }
  });
});
