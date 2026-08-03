import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { getUpload, readUploadBytes } from '@/lib/db/uploads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/files/<id> — the download URL recorded in `uploads.stored_path`.
 * Requires a session; the raw filesystem path is never exposed to the client.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: '檔案 ID 格式錯誤。' }, { status: 400 })
  }

  const record = await getUpload(id)
  if (!record) {
    return NextResponse.json({ error: '找不到檔案。' }, { status: 404 })
  }
  // Researchers see their own uploads; admins can fetch any.
  if (user.role !== 'admin' && record.owner_id !== user.id) {
    return NextResponse.json({ error: '無權存取此檔案。' }, { status: 403 })
  }

  const bytes = await readUploadBytes(record)
  if (!bytes) {
    return NextResponse.json({ error: '檔案已不存在於磁碟。' }, { status: 410 })
  }

  const filename = encodeURIComponent(record.original_name)
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type':
        record.content_type ??
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  })
}
