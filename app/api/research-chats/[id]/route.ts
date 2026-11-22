import { z } from "zod";
import { readChat } from "@/lib/db/research-chats";
import { researchResponseError, researchUser } from "@/lib/patent-search/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await researchUser();
    return Response.json(await readChat(user.id, z.string().uuid().parse((await params).id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchResponseError(error); }
}
