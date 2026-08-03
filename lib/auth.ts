/**
 * auth.ts — stateless parts of the session cookie.
 *
 * Split of responsibilities:
 *  - This module: mint / verify the signed cookie. No database, no filesystem,
 *    so `proxy.ts` can do a cheap optimistic check on every request (the
 *    pattern Next 16 recommends: 01-app/02-guides/authentication.md).
 *  - `lib/db/sessions.ts`: the authoritative check against PostgreSQL, called
 *    from route handlers and server components. That is what makes logout and
 *    account removal take effect immediately.
 *
 * Accounts themselves live in the `users` table (see db/migrations/001_init.sql),
 * each with its own random salt.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'pkg_session'
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

function secret(): string | null {
  const value = process.env.AUTH_SECRET?.trim()
  return value && value.length >= 16 ? value : null
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** Hash stored in `sessions.token_hash` — the raw token is never persisted. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface IssuedToken {
  token: string
  expiresAt: Date
}

export function issueSessionToken(nowMs: number = Date.now()): IssuedToken | null {
  const key = secret()
  if (!key) return null
  const expSeconds = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS
  const payload = `${randomBytes(24).toString('base64url')}.${expSeconds}`
  return {
    token: `${payload}.${sign(payload, key)}`,
    expiresAt: new Date(expSeconds * 1000),
  }
}

/**
 * Signature + expiry check only — says nothing about whether the session still
 * exists in the database. Used by proxy.ts as an optimistic gate.
 */
export function verifySessionToken(
  token: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  const key = secret()
  if (!key || !token) return false

  const lastDot = token.lastIndexOf('.')
  if (lastDot <= 0) return false
  const payload = token.slice(0, lastDot)
  const signature = token.slice(lastDot + 1)
  if (!constantTimeEquals(signature, sign(payload, key))) return false

  const expSeconds = Number(payload.slice(payload.lastIndexOf('.') + 1))
  if (!Number.isFinite(expSeconds)) return false
  return expSeconds * 1000 > nowMs
}

/**
 * Deployment readiness.
 *  - configured: AUTH_SECRET and DATABASE_URL are both present.
 *  - open: outside production with neither set — the gate is bypassed so
 *    `pnpm dev` still runs without infrastructure.
 *  - misconfigured: production without them — fail closed rather than publish
 *    an open instance through the tunnel.
 */
export function authMode(): 'configured' | 'open' | 'misconfigured' {
  const ready = secret() !== null && Boolean(process.env.DATABASE_URL?.trim())
  if (ready) return 'configured'
  return process.env.NODE_ENV === 'production' ? 'misconfigured' : 'open'
}
