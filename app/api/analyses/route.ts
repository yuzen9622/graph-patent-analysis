import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { listAnalyses } from '@/lib/db/analyses'
import { uploadUrl } from '@/lib/db/uploads'
import { query } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

interface UploadLink {
  analysis_id: string
  upload_id: string
  original_name: string | null
}

/**
 * Every upload backing each analysis (§6.3).
 *
 * `analyses.upload_id` / `analyses.filename` are single-valued, so after a
 * multi-file upload they can only ever name one file; `analysis_uploads` is the
 * complete list. Analyses recorded before that table existed have no rows here,
 * hence the caller's fallback to the single-valued columns.
 */
async function loadUploadLinks(analysisIds: string[]): Promise<Map<string, UploadLink[]>> {
  const byAnalysis = new Map<string, UploadLink[]>()
  if (analysisIds.length === 0) return byAnalysis

  const rows = await query<UploadLink>(
    `SELECT au.analysis_id::text AS analysis_id,
            au.upload_id::text   AS upload_id,
            COALESCE(au.original_name, up.original_name) AS original_name
     FROM analysis_uploads au
     JOIN uploads up ON up.id = au.upload_id
     WHERE au.analysis_id = ANY($1::uuid[])
     ORDER BY au.analysis_id, original_name NULLS LAST, au.upload_id`,
    [analysisIds],
  )

  for (const row of rows) {
    const list = byAnalysis.get(row.analysis_id)
    if (list) list.push(row)
    else byAnalysis.set(row.analysis_id, [row])
  }
  return byAnalysis
}

/**
 * GET /api/analyses — the signed-in user's analysis history, replacing the old
 * localStorage list so it follows the account across browsers.
 * Admins see every analysis.
 */
export async function GET() {
  let user
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }

  const rows = await listAnalyses({
    ownerId: user.id,
    includeAll: user.role === 'admin',
  })

  // A missing analysis_uploads table (migration 002 not applied) must not take
  // the whole history down — degrade to the single-valued columns instead.
  let uploadLinks: Map<string, UploadLink[]>
  try {
    uploadLinks = await loadUploadLinks(rows.map((row) => row.id))
  } catch (err) {
    console.error('[analyses] could not read analysis_uploads:', err)
    uploadLinks = new Map()
  }

  return NextResponse.json({
    analyses: rows.map((row) => {
      const links = uploadLinks.get(row.id) ?? []
      const files =
        links.length > 0
          ? links.map((link) => ({
              upload_id: link.upload_id,
              filename: link.original_name,
              url: uploadUrl(link.upload_id),
            }))
          : row.upload_id
            ? [{ upload_id: row.upload_id, filename: row.filename, url: uploadUrl(row.upload_id) }]
            : []

      return {
        id: row.id,
        // Legacy single values, kept so older clients keep rendering.
        filename: row.filename ?? files[0]?.filename ?? null,
        source_file_url: files[0]?.url ?? null,
        // Multi-file view (§5.3, §6.3).
        files,
        filenames: files
          .map((file) => file.filename)
          .filter((name): name is string => Boolean(name)),
        file_count: files.length,
        status: row.status,
        error: row.error,
        owner: row.owner_username,
        provider: row.provider,
        model_id: row.model_id,
        patent_count: row.patent_count,
        concept_count: row.concept_count,
        community_count: row.community_count,
        year_range:
          row.year_min !== null && row.year_max !== null ? [row.year_min, row.year_max] : null,
        created_at: row.created_at,
        completed_at: row.completed_at,
      }
    }),
  })
}
