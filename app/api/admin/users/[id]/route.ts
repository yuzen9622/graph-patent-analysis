import { NextResponse } from 'next/server'
import { ForbiddenError, requireAdmin, UnauthorizedError } from '@/lib/db/sessions'
import {
  deleteUserByAdmin,
  updateUserByAdmin,
  type ManagedUserUpdate,
  type UserRole,
} from '@/lib/db/users'

export const dynamic = 'force-dynamic'

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function validId(id: string): boolean {
  return UUID_PATTERN.test(id)
}

function parseUpdateUserInput(body: unknown): ParseResult<ManagedUserUpdate> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '請求格式錯誤。' }
  }
  const value = body as Record<string, unknown>
  const update: ManagedUserUpdate = {}

  if ('username' in value) {
    if (typeof value.username !== 'string') return { ok: false, error: '請輸入帳號。' }
    const username = value.username.trim()
    if (!username) return { ok: false, error: '請輸入帳號。' }
    if (username.length > 100) return { ok: false, error: '帳號不得超過 100 個字元。' }
    if (/\s|[\u0000-\u001f\u007f]/u.test(username)) {
      return { ok: false, error: '帳號不可包含空白或控制字元。' }
    }
    update.username = username
  }

  if ('password' in value) {
    if (typeof value.password !== 'string' || value.password.length < 8) {
      return { ok: false, error: '新密碼至少需要 8 個字元。' }
    }
    if (value.password.length > 200) {
      return { ok: false, error: '密碼不得超過 200 個字元。' }
    }
    update.password = value.password
  }

  if ('display_name' in value) {
    if (value.display_name !== null && typeof value.display_name !== 'string') {
      return { ok: false, error: '顯示名稱格式錯誤。' }
    }
    const displayName = typeof value.display_name === 'string' ? value.display_name.trim() : null
    if (displayName && displayName.length > 100) {
      return { ok: false, error: '顯示名稱不得超過 100 個字元。' }
    }
    update.displayName = displayName || null
  }

  if ('role' in value) {
    if (value.role !== 'admin' && value.role !== 'researcher') {
      return { ok: false, error: '角色必須是管理員或研究人員。' }
    }
    update.role = value.role as UserRole
  }

  if ('is_active' in value) {
    if (typeof value.is_active !== 'boolean') {
      return { ok: false, error: '帳號狀態格式錯誤。' }
    }
    update.isActive = value.is_active
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: '至少需要修改一個欄位。' }
  }
  return { ok: true, value: update }
}

function adminErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }
  return null
}

function isUsernameConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505',
  )
}

function mutationError(outcome: 'not_found' | 'forbidden' | 'self_protected') {
  if (outcome === 'not_found') {
    return NextResponse.json({ error: '找不到帳號。' }, { status: 404 })
  }
  if (outcome === 'forbidden') {
    return NextResponse.json({ error: '需要管理者權限。' }, { status: 403 })
  }
  return NextResponse.json(
    { error: '不能刪除、停用或取消自己的管理員權限。' },
    { status: 409 },
  )
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    if (!validId(id)) return NextResponse.json({ error: '帳號 ID 格式錯誤。' }, { status: 400 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '請求格式錯誤。' }, { status: 400 })
    }
    const parsed = parseUpdateUserInput(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const result = await updateUserByAdmin(admin.id, id, parsed.value)
    if (result.outcome !== 'ok') return mutationError(result.outcome)
    return NextResponse.json({
      user: result.user,
      current_session_invalidated: result.sessionsInvalidated && admin.id === id,
    })
  } catch (error) {
    const authResponse = adminErrorResponse(error)
    if (authResponse) return authResponse
    if (isUsernameConflict(error)) {
      return NextResponse.json({ error: '這個帳號已存在。' }, { status: 409 })
    }
    console.error('[admin/users] update failed:', error)
    return NextResponse.json({ error: '無法修改帳號。' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    if (!validId(id)) return NextResponse.json({ error: '帳號 ID 格式錯誤。' }, { status: 400 })

    const result = await deleteUserByAdmin(admin.id, id)
    if (result.outcome !== 'ok') return mutationError(result.outcome)
    return NextResponse.json({ deleted: true })
  } catch (error) {
    const authResponse = adminErrorResponse(error)
    if (authResponse) return authResponse
    console.error('[admin/users] delete failed:', error)
    return NextResponse.json({ error: '無法刪除帳號。' }, { status: 500 })
  }
}
