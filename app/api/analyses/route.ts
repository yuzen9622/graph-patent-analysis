import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { listAnalyses } from '@/lib/db/analyses'
import { uploadUrl } from '@/lib/db/uploads'

export const dynamic = 'force-dynamic'

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

  return NextResponse.json({
    analyses: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
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
      source_file_url: row.upload_id ? uploadUrl(row.upload_id) : null,
      created_at: row.created_at,
      completed_at: row.completed_at,
    })),
  })
}
