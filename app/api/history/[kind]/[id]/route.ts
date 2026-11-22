import { z } from "zod";
import { queryOne } from "@/lib/db/client";
import { ResearchError } from "@/lib/db/patent-search";
import { researchBody, researchId, researchResponseError, researchUser } from "@/lib/patent-search/http";

const tables = { chat: "research_chats", research: "patent_search_jobs", graph: "analyses" } as const;
const kinds = z.enum(["chat", "research", "graph"]);
const patch = z.union([
  z.object({ title: z.string().trim().min(1).max(200) }).strict(),
  z.object({ pinned: z.boolean() }).strict(),
]);
type Context = { params: Promise<{ kind: string; id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await researchUser(request);
    const params = await context.params;
    const kind = kinds.parse(params.kind);
    const id = researchId(params.id);
    const update = patch.parse(await researchBody(request));
    const column = "title" in update ? "title" : "pinned";
    const value = "title" in update ? update.title : update.pinned;
    const row = await queryOne(
      `UPDATE ${tables[kind]} SET ${column}=$1 WHERE id=$2 AND (owner_id=$3 OR $4) RETURNING id`,
      [value, id, user.id, kind === "graph" && user.role === "admin"]);
    if (!row) throw new ResearchError("找不到這筆紀錄。", 404);
    return new Response(null, { status: 204 });
  } catch (error) { return researchResponseError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await researchUser(request);
    const params = await context.params;
    const kind = z.enum(["chat", "research"]).parse(params.kind);
    const row = await queryOne(`DELETE FROM ${tables[kind]} WHERE id=$1 AND owner_id=$2 RETURNING id`,
      [researchId(params.id), user.id]);
    if (!row) throw new ResearchError("找不到這筆紀錄。", 404);
    return new Response(null, { status: 204 });
  } catch (error) { return researchResponseError(error); }
}
