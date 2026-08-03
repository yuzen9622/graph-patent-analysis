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
import { query, queryOne } from './client'

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

interface UserWithSecret extends UserRecord {
  password_hash: string
  password_salt: string
}

const PUBLIC_COLUMNS = 'id, username, display_name, role, is_active, created_at, last_login_at'

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
  return query<UserRecord>(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at`)
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
