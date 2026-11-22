import { query } from "@/lib/db/client";
import { requireUser, UnauthorizedError } from "@/lib/db/sessions";

export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
    throw error;
  }
  const term = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const pattern = "%" + term.replace(/[\\%_]/g, "\\$&") + "%";
  const results = await query<{
    id: string; title: string; date: string; kind: "graph" | "chat" | "research"; running: boolean;
  }>(`
    (SELECT a.id, coalesce(a.title, a.filename, '未命名圖譜') AS title, a.created_at AS date,
            'graph' AS kind, a.status = 'running' AS running
     FROM analyses a WHERE (a.owner_id = $1 OR $3) AND (
       $4 OR a.title ILIKE $2 OR a.filename ILIKE $2
       OR EXISTS (SELECT 1 FROM analysis_uploads u JOIN uploads f ON f.id=u.upload_id
                  WHERE u.analysis_id=a.id AND coalesce(u.original_name,f.original_name) ILIKE $2)
       OR EXISTS (SELECT 1 FROM concepts c WHERE c.analysis_id=a.id AND c.label ILIKE $2)
       OR EXISTS (SELECT 1 FROM patents p WHERE p.analysis_id=a.id AND (p.title ILIKE $2 OR p.application_number ILIKE $2))
       OR EXISTS (SELECT 1 FROM applicants n WHERE n.analysis_id=a.id AND n.name ILIKE $2))
     ORDER BY date DESC, a.id LIMIT 50)
    UNION ALL
    (SELECT c.id, coalesce(c.title, left(c.first_prompt, 60)), c.updated_at AS date, 'chat', false
     FROM research_chats c WHERE c.owner_id=$1 AND (
       $4 OR c.title ILIKE $2 OR c.first_prompt ILIKE $2
       OR EXISTS (SELECT 1 FROM research_chat_turns t LEFT JOIN patent_search_jobs j ON j.id=t.job_id WHERE t.chat_id=c.id AND (t.prompt ILIKE $2 OR t.response ILIKE $2 OR j.title ILIKE $2 OR (j.plan->'keywords')::text ILIKE $2)))
     ORDER BY date DESC, c.id LIMIT 50)
    UNION ALL
    (SELECT j.id, coalesce(j.title, nullif(j.summary,''), left(j.prompt,60)), j.updated_at AS date, 'research', false
     FROM patent_search_jobs j WHERE j.owner_id=$1 AND NOT EXISTS (SELECT 1 FROM research_chat_turns t WHERE t.job_id=j.id) AND (
       $4 OR j.title ILIKE $2 OR j.summary ILIKE $2 OR j.prompt ILIKE $2 OR (j.plan->'keywords')::text ILIKE $2)
     ORDER BY date DESC, j.id LIMIT 50)
    ORDER BY date DESC, id
  `, [user.id, pattern, user.role === "admin", !term]);
  return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}
