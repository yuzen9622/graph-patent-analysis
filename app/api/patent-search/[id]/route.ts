import { z } from "zod";
import { approveResearchJob, cancelResearchJob, getResearchJob, ResearchError, workerAvailable } from "@/lib/db/patent-search";
import { searchPlanSchema } from "@/lib/patent-search/contracts";
import { researchBody, researchId, researchResponseError, researchUser } from "@/lib/patent-search/http";

type Context = { params: Promise<{ id: string }> };
const approvalSchema = z.object({ revision: z.number().int().positive(), plan: searchPlanSchema }).strict();

export async function GET(request: Request, context: Context) {
  try {
    const user = await researchUser(request);
    const id = researchId((await context.params).id);
    return Response.json({ job: await getResearchJob(id, user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchResponseError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await researchUser(request);
    const id = researchId((await context.params).id);
    const body = approvalSchema.parse(await researchBody(request));
    if (!(await workerAvailable())) throw new ResearchError("資料擷取 worker 尚未啟動，請聯絡管理者。搜尋條件已保留。", 503);
    return Response.json({ job: await approveResearchJob(id, user.id, body.revision, body.plan) });
  } catch (error) { return researchResponseError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await researchUser(request);
    return Response.json({ job: await cancelResearchJob(researchId((await context.params).id), user.id) });
  } catch (error) { return researchResponseError(error); }
}
