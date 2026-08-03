import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { saveUpload } from '@/lib/db/uploads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 50 * 1024 * 1024

/**
 * POST /api/uploads — stores the original spreadsheet on disk and records a
 * row pointing at it. The response only carries an id and a URL; the bytes
 * never enter PostgreSQL.
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

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: '請以 multipart/form-data 上傳檔案。' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 file 欄位。' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: '檔案是空的。' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '檔案超過 50 MB 上限。' }, { status: 413 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const saved = await saveUpload({
    ownerId: user.id,
    originalName: file.name || 'upload.xlsx',
    contentType: file.type || null,
    bytes,
  })

  return NextResponse.json({ upload_id: saved.id, url: saved.url }, { status: 201 })
}
