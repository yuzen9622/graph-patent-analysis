import { z, ZodError } from "zod";
import { authMode } from "@/lib/auth";
import { requireUser, UnauthorizedError } from "@/lib/db/sessions";
import { ResearchError } from "@/lib/db/patent-search";

export async function researchUser(request?: Request) {
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      let sameHost = false;
      try {
        const source = new URL(origin);
        sameHost = ["https:", "http:"].includes(source.protocol) && source.host === request.headers.get("host");
      } catch { /* Opaque or malformed origins are not allowed. */ }
      if (!sameHost) throw new ResearchError("不接受跨網站的研究操作。", 403);
    }
  }
  if (authMode() !== "configured") throw new ResearchError("專利研究需要設定資料庫並登入帳號。", 503);
  return requireUser();
}

export function researchId(id: string) { return z.string().uuid().parse(id); }

export async function researchBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ResearchError("請使用 JSON 格式。", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ResearchError("缺少研究條件。", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new ResearchError("研究需求過長。", 413); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ResearchError("JSON 格式不正確。", 400); }
  } finally { reader.releaseLock(); }
}

export function researchResponseError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const databaseMessage = code === "42P01" ? "研究資料表尚未建立，請管理者套用專案的資料庫 migration 後重新檢查。"
    : ["ECONNREFUSED", "ETIMEDOUT", "57P01", "28P01"].includes(code) ? "無法連線至研究資料庫，請管理者檢查 PostgreSQL 連線設定。" : null;
  if (databaseMessage) return Response.json({ error: databaseMessage }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const status = error instanceof ResearchError ? error.status : error instanceof UnauthorizedError ? 401 : error instanceof ZodError ? 400 : 500;
  const message = error instanceof ZodError ? error.issues[0]?.message ?? "研究條件格式不正確。" : error instanceof ResearchError || error instanceof UnauthorizedError ? error.message : "研究服務暫時無法處理請求。";
  if (status === 500) console.error("[patent-search] request failed", { code, type: error instanceof Error ? error.name : "unknown" });
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
