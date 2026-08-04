import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listUsers: vi.fn(),
  createUserByAdmin: vi.fn(),
  updateUserByAdmin: vi.fn(),
  deleteUserByAdmin: vi.fn(),
}))

vi.mock('@/lib/db/sessions', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: mocks.requireAdmin,
  }
})

vi.mock('@/lib/db/users', () => ({
  listUsers: mocks.listUsers,
  createUserByAdmin: mocks.createUserByAdmin,
  updateUserByAdmin: mocks.updateUserByAdmin,
  deleteUserByAdmin: mocks.deleteUserByAdmin,
}))

import { ForbiddenError, UnauthorizedError } from '@/lib/db/sessions'
import { GET, POST } from '@/app/api/admin/users/route'
import { DELETE, PATCH } from '@/app/api/admin/users/[id]/route'

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const user = {
  id: USER_ID,
  username: 'researcher',
  display_name: '研究人員',
  role: 'researcher' as const,
  is_active: true,
  created_at: new Date('2026-08-01T00:00:00Z'),
  last_login_at: null,
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({
    id: ADMIN_ID,
    username: 'admin',
    display_name: null,
    role: 'admin',
  })
})

describe('admin user collection route', () => {
  it('rejects requests without an authenticated session', async () => {
    mocks.requireAdmin.mockRejectedValue(new UnauthorizedError())
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('rejects authenticated non-admin users', async () => {
    mocks.requireAdmin.mockRejectedValue(new ForbiddenError())
    const response = await GET()
    expect(response.status).toBe(403)
  })

  it('lists only public account records for an admin', async () => {
    mocks.listUsers.mockResolvedValue([user])
    const response = await GET()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      users: [{ id: USER_ID, username: 'researcher', role: 'researcher' }],
    })
  })

  it('creates an account with normalized input', async () => {
    mocks.createUserByAdmin.mockResolvedValue({
      outcome: 'ok',
      user,
      sessionsInvalidated: false,
    })
    const response = await POST(
      jsonRequest('http://localhost/api/admin/users', 'POST', {
        username: '  researcher  ',
        password: 'password123',
        display_name: '  研究人員  ',
        role: 'researcher',
      }),
    )
    expect(response.status).toBe(201)
    expect(mocks.createUserByAdmin).toHaveBeenCalledWith(ADMIN_ID, {
      username: 'researcher',
      password: 'password123',
      displayName: '研究人員',
      role: 'researcher',
    })
  })

  it('rejects a short password before writing', async () => {
    const response = await POST(
      jsonRequest('http://localhost/api/admin/users', 'POST', {
        username: 'researcher',
        password: 'short',
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.createUserByAdmin).not.toHaveBeenCalled()
  })

  it('maps a case-insensitive username conflict to 409', async () => {
    mocks.createUserByAdmin.mockRejectedValue({ code: '23505' })
    const response = await POST(
      jsonRequest('http://localhost/api/admin/users', 'POST', {
        username: 'Researcher',
        password: 'password123',
      }),
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '這個帳號已存在。' })
  })
})

describe('admin user item route', () => {
  it('rejects a malformed account id', async () => {
    const response = await PATCH(
      jsonRequest('http://localhost/api/admin/users/nope', 'PATCH', { display_name: 'A' }),
      context('nope'),
    )
    expect(response.status).toBe(400)
    expect(mocks.updateUserByAdmin).not.toHaveBeenCalled()
  })

  it('updates an account and reports when the current session was invalidated', async () => {
    mocks.updateUserByAdmin.mockResolvedValue({
      outcome: 'ok',
      user: { ...user, id: ADMIN_ID, username: 'admin', role: 'admin' },
      sessionsInvalidated: true,
    })
    const response = await PATCH(
      jsonRequest(`http://localhost/api/admin/users/${ADMIN_ID}`, 'PATCH', {
        password: 'new-password',
      }),
      context(ADMIN_ID),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ current_session_invalidated: true })
  })

  it('blocks deleting, deactivating, or demoting the acting admin', async () => {
    mocks.updateUserByAdmin.mockResolvedValue({ outcome: 'self_protected' })
    const response = await PATCH(
      jsonRequest(`http://localhost/api/admin/users/${ADMIN_ID}`, 'PATCH', {
        is_active: false,
      }),
      context(ADMIN_ID),
    )
    expect(response.status).toBe(409)
  })

  it('deletes another account', async () => {
    mocks.deleteUserByAdmin.mockResolvedValue({ outcome: 'ok' })
    const response = await DELETE(
      new Request(`http://localhost/api/admin/users/${USER_ID}`, { method: 'DELETE' }),
      context(USER_ID),
    )
    expect(response.status).toBe(200)
    expect(mocks.deleteUserByAdmin).toHaveBeenCalledWith(ADMIN_ID, USER_ID)
    await expect(response.json()).resolves.toEqual({ deleted: true })
  })

  it('returns 404 for an account that no longer exists', async () => {
    mocks.deleteUserByAdmin.mockResolvedValue({ outcome: 'not_found' })
    const response = await DELETE(
      new Request(`http://localhost/api/admin/users/${USER_ID}`, { method: 'DELETE' }),
      context(USER_ID),
    )
    expect(response.status).toBe(404)
  })
})
