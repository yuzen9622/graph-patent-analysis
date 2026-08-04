import { NextResponse } from 'next/server'
import { ForbiddenError, requireAdmin, UnauthorizedError } from '@/lib/db/sessions'
import { createUserByAdmin, listUsers, type UserRole } from '@/lib/db/users'

export const dynamic = 'force-dynamic'

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

interface CreateUserInput {
  username: string
  password: string
  displayName: string | null
  role: UserRole
}

function cleanUsername(value: unknown): ParseResult<string> {
  if (typeof value !== 'string') return { ok: false, error: '請輸入帳號。' }
  const username = value.trim()
  if (!username) return { ok: false, error: '請輸入帳號。' }
  if (username.length > 100) return { ok: false, error: '帳號不得超過 100 個字元。' }
  if (/\s|[\u0000-\u001f\u007f]/u.test(username)) {
    return { ok: false, error: '帳號不可包含空白或控制字元。' }
  }
  return { ok: true, value: username }
}

function cleanPassword(value: unknown, required: boolean): ParseResult<string | undefined> {
  if (value === undefined && !required) return { ok: true, value: undefined }
  if (typeof value !== 'string' || !value) return { ok: false, error: '請輸入密碼。' }
  if (value.length < 8) return { ok: false, error: '密碼至少需要 8 個字元。' }
  if (value.length > 200) return { ok: false, error: '密碼不得超過 200 個字元。' }
  return { ok: true, value }
}

function cleanDisplayName(value: unknown): ParseResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: '顯示名稱格式錯誤。' }
  const displayName = value.trim()
  if (displayName.length > 100) {
    return { ok: false, error: '顯示名稱不得超過 100 個字元。' }
  }
  return { ok: true, value: displayName || null }
}

function cleanRole(value: unknown): ParseResult<UserRole> {
  if (value !== 'admin' && value !== 'researcher') {
    return { ok: false, error: '角色必須是管理員或研究人員。' }
  }
  return { ok: true, value }
}

function parseCreateUserInput(body: unknown): ParseResult<CreateUserInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '請求格式錯誤。' }
  }
  const value = body as Record<string, unknown>
  const username = cleanUsername(value.username)
  if (!username.ok) return username
  const password = cleanPassword(value.password, true)
  if (!password.ok) return password
  if (password.value === undefined) return { ok: false, error: '請輸入密碼。' }
  const displayName = cleanDisplayName(value.display_name)
  if (!displayName.ok) return displayName
  const role = cleanRole(value.role ?? 'researcher')
  if (!role.ok) return role
  return {
    ok: true,
    value: {
      username: username.value,
      password: password.value,
      displayName: displayName.value,
      role: role.value,
    },
  }
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

export async function GET() {
  try {
    await requireAdmin()
    return NextResponse.json({ users: await listUsers() })
  } catch (error) {
    const authResponse = adminErrorResponse(error)
    if (authResponse) return authResponse
    console.error('[admin/users] list failed:', error)
    return NextResponse.json({ error: '無法讀取帳號清單。' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '請求格式錯誤。' }, { status: 400 })
    }

    const parsed = parseCreateUserInput(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const result = await createUserByAdmin(admin.id, parsed.value)
    if (result.outcome !== 'ok') {
      return NextResponse.json({ error: '需要管理者權限。' }, { status: 403 })
    }
    return NextResponse.json({ user: result.user }, { status: 201 })
  } catch (error) {
    const authResponse = adminErrorResponse(error)
    if (authResponse) return authResponse
    if (isUsernameConflict(error)) {
      return NextResponse.json({ error: '這個帳號已存在。' }, { status: 409 })
    }
    console.error('[admin/users] create failed:', error)
    return NextResponse.json({ error: '無法新增帳號。' }, { status: 500 })
  }
}
