import { getResearchArtifact } from "@/lib/db/patent-search";
import { researchId, researchResponseError, researchUser } from "@/lib/patent-search/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await researchUser(request);
    const id = researchId((await context.params).id);
    const artifact = await getResearchArtifact(id, user.id);
    return new Response(Uint8Array.from(artifact.artifact_bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="patents-${id.slice(0, 8)}.xlsx"`,
        "Content-Length": String(artifact.artifact_bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return researchResponseError(error); }
}
