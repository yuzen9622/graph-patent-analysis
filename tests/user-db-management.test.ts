import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => {
  const clientQuery = vi.fn()
  const client = { query: clientQuery }
  return {
    clientQuery,
    query: vi.fn(),
    queryOne: vi.fn(),
    withTransaction: vi.fn(
      async (fn: (value: typeof client) => Promise<unknown>) => fn(client),
    ),
  }
})

vi.mock('@/lib/db/client', () => ({
  query: dbMocks.query,
  queryOne: dbMocks.queryOne,
  withTransaction: dbMocks.withTransaction,
}))

import {
  createUserByAdmin,
  deleteUserByAdmin,
  updateUserByAdmin,
  type UserRecord,
} from '@/lib/db/users'

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const baseUser: UserRecord = {
  id: USER_ID,
  username: 'researcher',
  display_name: '研究人員',
  role: 'researcher',
  is_active: true,
  created_at: new Date('2026-08-01T00:00:00Z'),
  last_login_at: null,
}

function sqlOf(call: unknown[]): string {
  return String(call[0]).replace(/\s+/gu, ' ').trim()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('transactional admin user mutations', () => {
  it('re-checks the acting admin in the transaction before creating', async () => {
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT role, is_active')) {
        return { rows: [{ role: 'admin', is_active: true }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO users')) {
        return { rows: [baseUser], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const result = await createUserByAdmin(ADMIN_ID, {
      username: 'researcher',
      password: 'password123',
      displayName: '研究人員',
      role: 'researcher',
    })

    expect(result).toMatchObject({ outcome: 'ok', user: baseUser })
    const calls = dbMocks.clientQuery.mock.calls.map(sqlOf)
    expect(calls[0]).toContain('pg_advisory_xact_lock')
    expect(calls[1]).toContain('SELECT role, is_active FROM users')
    expect(calls[2]).toContain('INSERT INTO users')
  })

  it('refuses a mutation if the actor lost admin rights while waiting for the lock', async () => {
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT role, is_active')) {
        return { rows: [{ role: 'researcher', is_active: true }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const result = await deleteUserByAdmin(ADMIN_ID, USER_ID)
    expect(result).toEqual({ outcome: 'forbidden' })
    expect(dbMocks.clientQuery.mock.calls.map(sqlOf).some((sql) => sql.startsWith('DELETE'))).toBe(
      false,
    )
  })

  it('does not let an admin demote or deactivate their own account', async () => {
    const adminUser: UserRecord = { ...baseUser, id: ADMIN_ID, username: 'admin', role: 'admin' }
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT role, is_active')) {
        return { rows: [{ role: 'admin', is_active: true }], rowCount: 1 }
      }
      if (sql.includes('SELECT id, username')) return { rows: [adminUser], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })

    const result = await updateUserByAdmin(ADMIN_ID, ADMIN_ID, { role: 'researcher' })
    expect(result).toEqual({ outcome: 'self_protected' })
    expect(dbMocks.clientQuery.mock.calls.map(sqlOf).some((sql) => sql.startsWith('UPDATE'))).toBe(
      false,
    )
  })

  it('replaces the password hash and removes every existing session', async () => {
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT role, is_active')) {
        return { rows: [{ role: 'admin', is_active: true }], rowCount: 1 }
      }
      if (sql.includes('SELECT id, username')) return { rows: [baseUser], rowCount: 1 }
      if (sql.startsWith('UPDATE users')) return { rows: [baseUser], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    })

    const result = await updateUserByAdmin(ADMIN_ID, USER_ID, {
      password: 'new-password',
    })

    expect(result).toMatchObject({ outcome: 'ok', sessionsInvalidated: true })
    const calls = dbMocks.clientQuery.mock.calls.map(sqlOf)
    expect(calls.some((sql) => sql.includes('password_hash'))).toBe(true)
    expect(calls).toContain('DELETE FROM sessions WHERE user_id = $1')
  })

  it('deletes another account but never the acting admin', async () => {
    dbMocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT role, is_active')) {
        return { rows: [{ role: 'admin', is_active: true }], rowCount: 1 }
      }
      if (sql.startsWith('DELETE FROM users')) return { rows: [{ id: USER_ID }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })

    await expect(deleteUserByAdmin(ADMIN_ID, USER_ID)).resolves.toEqual({ outcome: 'ok' })
    await expect(deleteUserByAdmin(ADMIN_ID, ADMIN_ID)).resolves.toEqual({
      outcome: 'self_protected',
    })
    const deleteCalls = dbMocks.clientQuery.mock.calls
      .map(sqlOf)
      .filter((sql) => sql.startsWith('DELETE FROM users'))
    expect(deleteCalls).toHaveLength(1)
  })
})
