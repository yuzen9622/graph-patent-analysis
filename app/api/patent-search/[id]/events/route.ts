import { setTimeout as delay } from "node:timers/promises";
import { getResearchJob } from "@/lib/db/patent-search";
import { isJobActive } from "@/lib/patent-search/contracts";
import { researchId, researchResponseError, researchUser } from "@/lib/patent-search/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await researchUser(request);
    const id = researchId((await context.params).id);
    const initial = await getResearchJob(id, user.id);
    const cancellation = new AbortController();
    const signal = AbortSignal.any([request.signal, cancellation.signal]);
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        let job = initial;
        let previous = "";
        try {
          while (!signal.aborted) {
            const version = `${job.updatedAt}:${job.activities.at(-1)?.id ?? "0"}`;
            if (version !== previous) {
              previous = version;
              controller.enqueue(encoder.encode(`id: ${job.activities.at(-1)?.id ?? "0"}\nevent: job\ndata: ${JSON.stringify(job)}\n\n`));
            } else {
              controller.enqueue(encoder.encode(": heartbeat\n\n"));
            }
            if (!isJobActive(job.status)) break;
            await delay(1500, undefined, { signal });
            // Resolve the session again so revocation also closes an existing stream.
            const current = await researchUser();
            if (current.id !== user.id) break;
            job = await getResearchJob(id, user.id);
          }
        } catch {
          if (!signal.aborted && !closed) controller.enqueue(encoder.encode(`event: unavailable\ndata: ${JSON.stringify({ message: "研究狀態暫時無法讀取，請重新載入或登入。" })}\n\n`));
        } finally {
          if (!closed) { closed = true; controller.close(); }
        }
      },
      cancel() { closed = true; cancellation.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive" } });
  } catch (error) { return researchResponseError(error); }
}
