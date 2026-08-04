/**
 * users.ts — account records in PostgreSQL.
 *
 * Passwords are stored as scrypt(password, per-user random salt). The salt is
 * 16 random bytes generated at account creation and kept in `password_salt`,
 * so two users with the same password have unrelated hashes and a stolen hash
 * cannot be attacked with a shared rainbow table.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { query, queryOne, withTransaction } from './client'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64

export type UserRole = 'admin' | 'researcher'

export interface UserRecord {
  id: string
  username: string
  display_name: string | null
  role: UserRole
  is_active: boolean
  created_at: Date
  last_login_at: Date | null
}

export type ManagedUserMutationResult =
  | { outcome: 'ok'; user: UserRecord; sessionsInvalidated: boolean }
  | { outcome: 'not_found' | 'forbidden' | 'self_protected' }

export type ManagedUserDeleteResult =
  | { outcome: 'ok' }
  | { outcome: 'not_found' | 'forbidden' | 'self_protected' }

export interface ManagedUserUpdate {
  username?: string
  password?: string
  displayName?: string | null
  role?: UserRole
  isActive?: boolean
}

interface UserWithSecret extends UserRecord {
  password_hash: string
  password_salt: string
}

const PUBLIC_COLUMNS = 'id, username, display_name, role, is_active, created_at, last_login_at'
const USER_MUTATION_LOCK = 'wang:user-management'

export function newSalt(): string {
  return randomBytes(16).toString('hex')
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return derived.toString('hex')
}

function hashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex')
  const bufferB = Buffer.from(b, 'hex')
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false
  return timingSafeEqual(bufferA, bufferB)
}

export async function createUser(input: {
  username: string
  password: string
  displayName?: string | null
  role?: UserRole
}): Promise<UserRecord> {
  const salt = newSalt()
  const hash = await hashPassword(input.password, salt)
  const rows = await query<UserRecord>(
    `INSERT INTO users (username, password_hash, password_salt, display_name, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [input.username, hash, salt, input.displayName ?? null, input.role ?? 'researcher'],
  )
  return rows[0]
}

/**
 * Creates an account after re-checking the acting admin inside the same
 * serialized transaction as the mutation. Route-level checks remain useful for
 * fast rejection, but this is the authority boundary for account changes.
 */
export async function createUserByAdmin(
  actorId: string,
  input: {
    username: string
    password: string
    displayName?: string | null
    role?: UserRole
  },
): Promise<ManagedUserMutationResult> {
  const salt = newSalt()
  const hash = await hashPassword(input.password, salt)

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [USER_MUTATION_LOCK])
    const actor = await client.query<{ role: UserRole; is_active: boolean }>(
      'SELECT role, is_active FROM users WHERE id = $1 FOR UPDATE',
      [actorId],
    )
    if (actor.rows[0]?.role !== 'admin' || !actor.rows[0].is_active) {
      return { outcome: 'forbidden' }
    }

    const created = await client.query<UserRecord>(
      `INSERT INTO users (username, password_hash, password_salt, display_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${PUBLIC_COLUMNS}`,
      [input.username, hash, salt, input.displayName ?? null, input.role ?? 'researcher'],
    )
    return { outcome: 'ok', user: created.rows[0], sessionsInvalidated: false }
  })
}

export async function updateUserByAdmin(
  actorId: string,
  userId: string,
  input: ManagedUserUpdate,
): Promise<ManagedUserMutationResult> {
  const passwordSecret = input.password
    ? { salt: newSalt(), hash: '' }
    : null
  if (passwordSecret && input.password) {
    passwordSecret.hash = await hashPassword(input.password, passwordSecret.salt)
  }

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [USER_MUTATION_LOCK])
    const actor = await client.query<{ role: UserRole; is_active: boolean }>(
      'SELECT role, is_active FROM users WHERE id = $1 FOR UPDATE',
      [actorId],
    )
    if (actor.rows[0]?.role !== 'admin' || !actor.rows[0].is_active) {
      return { outcome: 'forbidden' }
    }

    const target = await client.query<UserRecord>(
      `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    )
    const existing = target.rows[0]
    if (!existing) return { outcome: 'not_found' }

    const nextRole = input.role ?? existing.role
    const nextActive = input.isActive ?? existing.is_active
    if (actorId === userId && (nextRole !== 'admin' || !nextActive)) {
      return { outcome: 'self_protected' }
    }

    const assignments: string[] = []
    const values: unknown[] = []
    const assign = (column: string, value: unknown) => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }

    if (input.username !== undefined) assign('username', input.username)
    if (input.displayName !== undefined) assign('display_name', input.displayName)
    if (input.role !== undefined) assign('role', input.role)
    if (input.isActive !== undefined) assign('is_active', input.isActive)
    if (passwordSecret) {
      assign('password_hash', passwordSecret.hash)
      assign('password_salt', passwordSecret.salt)
    }

    if (assignments.length === 0) {
      return { outcome: 'ok', user: existing, sessionsInvalidated: false }
    }

    values.push(userId)
    const updated = await client.query<UserRecord>(
      `UPDATE users SET ${assignments.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${PUBLIC_COLUMNS}`,
      values,
    )

    const sessionsInvalidated = Boolean(passwordSecret) || (existing.is_active && !nextActive)
    if (sessionsInvalidated) {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId])
    }

    return { outcome: 'ok', user: updated.rows[0], sessionsInvalidated }
  })
}

export async function deleteUserByAdmin(
  actorId: string,
  userId: string,
): Promise<ManagedUserDeleteResult> {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [USER_MUTATION_LOCK])
    const actor = await client.query<{ role: UserRole; is_active: boolean }>(
      'SELECT role, is_active FROM users WHERE id = $1 FOR UPDATE',
      [actorId],
    )
    if (actor.rows[0]?.role !== 'admin' || !actor.rows[0].is_active) {
      return { outcome: 'forbidden' }
    }
    if (actorId === userId) return { outcome: 'self_protected' }

    const deleted = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId])
    if (deleted.rowCount === 0) return { outcome: 'not_found' }
    return { outcome: 'ok' }
  })
}

export async function setPassword(username: string, password: string): Promise<boolean> {
  const salt = newSalt()
  const hash = await hashPassword(password, salt)
  const rows = await query(
    `UPDATE users SET password_hash = $2, password_salt = $3
     WHERE lower(username) = lower($1)
     RETURNING id`,
    [username, hash, salt],
  )
  return rows.length > 0
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  return queryOne<UserRecord>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE lower(username) = lower($1)`,
    [username],
  )
}

export async function listUsers(): Promise<UserRecord[]> {
  return query<UserRecord>(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY lower(username)`)
}

/** Returns the account on success, or null for unknown / inactive / wrong password. */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<UserRecord | null> {
  const record = await queryOne<UserWithSecret>(
    `SELECT ${PUBLIC_COLUMNS}, password_hash, password_salt
     FROM users WHERE lower(username) = lower($1)`,
    [username],
  )

  if (!record) {
    // Spend a comparable amount of work so unknown usernames are not faster.
    await hashPassword(password, 'absent-user-placeholder-salt')
    return null
  }

  const candidate = await hashPassword(password, record.password_salt)
  if (!hashesMatch(candidate, record.password_hash)) return null
  if (!record.is_active) return null

  const { password_hash: _hash, password_salt: _salt, ...safe } = record
  void _hash
  void _salt
  return safe
}

export async function markLogin(userId: string): Promise<void> {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId])
}

export async function countUsers(): Promise<number> {
  const row = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM users')
  return Number(row?.count ?? 0)
}
