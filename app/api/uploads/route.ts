import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { saveUpload } from '@/lib/db/uploads'
import {
  checkContentLength,
  checkProxyBodyLimit,
  readLimits,
  validateUploadFiles,
} from '@/lib/analyze-limits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/uploads — stores the original spreadsheets on disk and records one
 * row per file. The response only carries ids and URLs; the bytes never enter
 * PostgreSQL.
 *
 * Accepts several `file` parts in one request (PRD v2 P0 §5.3). Ceilings —
 * per-file bytes, file count, total bytes — come from §5.2 and are all
 * environment-overridable; the total-bytes check runs on `Content-Length`
 * *before* `formData()` so an oversized batch is never buffered into memory.
 */
export async function POST(request: Request) {
  let user
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }

  const limits = readLimits()

  const contentLength = request.headers.get('content-length')
  const tooBig =
    checkContentLength(contentLength, limits.uploadMaxTotalBytes) ??
    // Next's proxy truncates a body over its own cap without telling anyone;
    // refuse instead of parsing half a multipart stream.
    checkProxyBodyLimit(contentLength)
  if (tooBig) {
    return NextResponse.json({ error: tooBig.error }, { status: tooBig.status })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: '請以 multipart/form-data 上傳檔案。' }, { status: 400 })
  }

  const files = form.getAll('file').filter((entry): entry is File => entry instanceof File)

  const failure = validateUploadFiles(
    files.map((file) => ({ name: file.name || 'upload.xlsx', size: file.size })),
    limits,
  )
  if (failure) {
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }

  const uploads: Array<{ upload_id: string; url: string; filename: string }> = []
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer())
    const saved = await saveUpload({
      ownerId: user.id,
      originalName: file.name || 'upload.xlsx',
      contentType: file.type || null,
      bytes,
    })
    uploads.push({ upload_id: saved.id, url: saved.url, filename: file.name || 'upload.xlsx' })
  }

  return NextResponse.json(
    {
      uploads,
      upload_ids: uploads.map((u) => u.upload_id),
      // Kept so any caller written against the previous single-file shape still
      // works; multi-file callers read `uploads` / `upload_ids`.
      upload_id: uploads[0]?.upload_id ?? null,
      url: uploads[0]?.url ?? null,
    },
    { status: 201 },
  )
}
