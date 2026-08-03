/**
 * proxy.ts — Next.js 16 renamed `middleware` to `proxy` (same convention,
 * project root, Node.js runtime by default).
 *
 * This is an *optimistic* gate: it only checks that the session cookie carries
 * a valid signature and has not expired, which needs no I/O. The authoritative
 * check against the `sessions` table happens in route handlers and server
 * components via `requireUser()` — so a deleted session or a deactivated
 * account is rejected there even though the cookie still looks well-formed.
 * Deliberately no database import here: Next's proxy docs warn against relying
 * on shared modules/globals in this file.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, authMode, verifySessionToken } from '@/lib/auth'

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout'])

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next()

  const mode = authMode()
  if (mode === 'open') return NextResponse.next()
  if (mode === 'misconfigured') {
    return NextResponse.json(
      { error: '伺服器尚未設定 AUTH_SECRET / DATABASE_URL，已拒絕所有請求。' },
      { status: 503 },
    )
  }

  if (verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '未登入或工作階段已過期。' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  const next = `${pathname}${request.nextUrl.search}`
  if (next !== '/') loginUrl.searchParams.set('next', next)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Everything except Next's own static output and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
