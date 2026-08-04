/**
 * sessions.ts — authoritative session lookup.
 *
 * `proxy.ts` only checks the cookie's HMAC and expiry. Every route handler and
 * server component that touches data calls `requireUser()` / `currentUser()`,
 * which resolves the cookie against this table — so deleting a session row or
 * deactivating an account takes effect on the very next request.
 */

import { cookies } from 'next/headers'
import { SESSION_COOKIE, authMode, issueSessionToken, tokenHash, verifySessionToken } from '@/lib/auth'
import { query, queryOne } from './client'
import type { UserRecord, UserRole } from './users'

export interface SessionUser {
  id: string
  username: string
  display_name: string | null
  role: UserRole
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date } | null> {
  const issued = issueSessionToken()
  if (!issued) return null
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash(issued.token), issued.expiresAt, meta.ip ?? null, meta.userAgent ?? null],
  )
  return issued
}

export async function destroySession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)])
}

export async function destroyUserSessions(userId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId])
}

export async function purgeExpiredSessions(): Promise<void> {
  await query('DELETE FROM sessions WHERE expires_at <= now()')
}

async function resolve(token: string | undefined): Promise<SessionUser | null> {
  if (!token || !verifySessionToken(token)) return null

  const row = await queryOne<SessionUser & { expires_at: Date; is_active: boolean }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_active, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash(token)],
  )

  if (!row || !row.is_active || row.expires_at.getTime() <= Date.now()) return null

  // Best effort; a failed touch must not break the request.
  void query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [
    tokenHash(token),
  ]).catch(() => {})

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
  }
}

/** Null when signed out. In `open` dev mode returns a synthetic local account. */
export async function currentUser(): Promise<SessionUser | null> {
  if (authMode() === 'open') {
    return { id: '00000000-0000-0000-0000-000000000000', username: 'dev', display_name: '開發模式', role: 'admin' }
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  return resolve(token)
}

export class UnauthorizedError extends Error {
  constructor() {
    super('未登入或工作階段已過期。')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('需要管理者權限。')
    this.name = 'ForbiddenError'
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

/** Account mutations fail closed instead of trusting the synthetic open-mode admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (authMode() !== 'configured' || user.role !== 'admin') throw new ForbiddenError()
  return user
}

export function toSessionUser(record: UserRecord): SessionUser {
  return {
    id: record.id,
    username: record.username,
    display_name: record.display_name,
    role: record.role,
  }
}
