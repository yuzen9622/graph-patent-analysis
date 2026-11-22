import { chatForResearchJob } from "@/lib/db/research-chats";
import { researchId, researchResponseError, researchUser } from "@/lib/patent-search/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await researchUser(request);
    const chatId = await chatForResearchJob(user.id, researchId((await context.params).id));
    return Response.json({ chatId });
  } catch (error) { return researchResponseError(error); }
}
