import { NextResponse } from 'next/server'
import { SESSION_COOKIE, authMode } from '@/lib/auth'
import { markLogin, verifyCredentials } from '@/lib/db/users'
import { createSession } from '@/lib/db/sessions'

export const dynamic = 'force-dynamic'

// The instance is published through a Cloudflare Tunnel, so throttle brute
// force attempts. Single container, so an in-memory window is enough.
const WINDOW_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 10
const attempts = new Map<string, { count: number; resetAt: number }>()

function clientIp(request: Request): string {
  const forwarded = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || 'unknown'
}

function tooManyAttempts(key: string): boolean {
  const entry = attempts.get(key)
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= MAX_ATTEMPTS)
}

function recordFailure(key: string): void {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  entry.count += 1
}

export async function POST(request: Request) {
  if (authMode() === 'misconfigured') {
    return NextResponse.json({ error: '伺服器尚未完成設定，請聯絡管理者。' }, { status: 503 })
  }

  const ip = clientIp(request)
  if (tooManyAttempts(ip)) {
    return NextResponse.json({ error: '嘗試次數過多，請於 5 分鐘後再試。' }, { status: 429 })
  }

  let username = ''
  let password = ''
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown }
    username = typeof body.username === 'string' ? body.username.trim() : ''
    password = typeof body.password === 'string' ? body.password : ''
  } catch {
    return NextResponse.json({ error: '請求格式錯誤。' }, { status: 400 })
  }

  if (!username || !password) {
    return NextResponse.json({ error: '請輸入帳號與密碼。' }, { status: 400 })
  }

  let user
  try {
    user = await verifyCredentials(username, password)
  } catch (err) {
    console.error('[auth] credential check failed:', err)
    return NextResponse.json({ error: '伺服器無法連線至資料庫。' }, { status: 503 })
  }

  if (!user) {
    recordFailure(ip)
    return NextResponse.json({ error: '帳號或密碼錯誤。' }, { status: 401 })
  }

  const session = await createSession(user.id, {
    ip,
    userAgent: request.headers.get('user-agent'),
  })
  if (!session) {
    return NextResponse.json({ error: '伺服器缺少 AUTH_SECRET，無法建立工作階段。' }, { status: 503 })
  }

  await markLogin(user.id).catch(() => {})
  attempts.delete(ip)

  const response = NextResponse.json({
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  })
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    // Served over HTTPS via Cloudflare Tunnel; relaxed for local http dev.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  })
  return response
}
