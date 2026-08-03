import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth'
import { destroySession } from '@/lib/db/sessions'

export const dynamic = 'force-dynamic'

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token) {
    // Remove the row so the cookie is dead even if someone kept a copy.
    await destroySession(token).catch((err) => console.error('[auth] logout failed:', err))
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
