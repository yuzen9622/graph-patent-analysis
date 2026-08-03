import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authMode,
  constantTimeEquals,
  issueSessionToken,
  tokenHash,
  verifySessionToken,
} from '@/lib/auth'
import { classifyOrgType, extractCountry } from '@/lib/applicant-classify'

const SECRET = 'test-secret-at-least-16-chars'

function setEnv(secret: string | undefined, databaseUrl?: string, nodeEnv?: string) {
  if (secret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = secret
  if (databaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = databaseUrl
  if (nodeEnv !== undefined) vi.stubEnv('NODE_ENV', nodeEnv)
}

afterEach(() => {
  setEnv(undefined, undefined)
  vi.unstubAllEnvs()
})

describe('session tokens', () => {
  it('issues a token that verifies', () => {
    setEnv(SECRET)
    const issued = issueSessionToken()
    expect(issued).not.toBeNull()
    expect(verifySessionToken(issued!.token)).toBe(true)
    expect(issued!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('rejects a tampered signature or payload', () => {
    setEnv(SECRET)
    const { token } = issueSessionToken()!
    const lastDot = token.lastIndexOf('.')
    const payload = token.slice(0, lastDot)
    const signature = token.slice(lastDot + 1)
    expect(verifySessionToken(`${payload}.${signature.slice(0, -1)}x`)).toBe(false)
    // Same signature, later expiry — must not validate.
    const farFuture = payload.replace(/\.\d+$/, `.${Math.floor(Date.now() / 1000) + 999999}`)
    expect(verifySessionToken(`${farFuture}.${signature}`)).toBe(false)
  })

  it('rejects an expired token', () => {
    setEnv(SECRET)
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    const { token } = issueSessionToken(eightDaysAgo)!
    expect(verifySessionToken(token)).toBe(false)
  })

  it('rejects garbage and empty input', () => {
    setEnv(SECRET)
    expect(verifySessionToken(undefined)).toBe(false)
    expect(verifySessionToken('')).toBe(false)
    expect(verifySessionToken('no-dots')).toBe(false)
  })

  it('cannot issue or verify without a long enough secret', () => {
    setEnv('short')
    expect(issueSessionToken()).toBeNull()
    expect(verifySessionToken('a.b.c')).toBe(false)
  })

  it('hashes tokens deterministically and never returns the raw value', () => {
    const hash = tokenHash('abc')
    expect(hash).toHaveLength(64)
    expect(hash).toBe(tokenHash('abc'))
    expect(hash).not.toContain('abc')
  })

  it('compares strings without throwing on length mismatch', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true)
    expect(constantTimeEquals('abc', 'abcd')).toBe(false)
    expect(constantTimeEquals('', '')).toBe(true)
  })
})

describe('authMode', () => {
  it('is configured when secret and database are both present', () => {
    setEnv(SECRET, 'postgres://localhost/x', 'production')
    expect(authMode()).toBe('configured')
  })

  it('fails closed in production when the database is missing', () => {
    setEnv(SECRET, undefined, 'production')
    expect(authMode()).toBe('misconfigured')
  })

  it('stays open outside production so local dev keeps working', () => {
    setEnv(undefined, undefined, 'development')
    expect(authMode()).toBe('open')
  })
})

describe('applicant classification', () => {
  it('reads the country from the trailing parenthesis', () => {
    expect(extractCountry('國泰金融控股股份有限公司 臺北市大安區仁愛路4段296號 (中華民國)')).toBe(
      '中華民國',
    )
    expect(extractCountry('SOME CORP （美國）')).toBe('美國')
    expect(extractCountry('沒有國別的名稱')).toBeNull()
  })

  it('classifies the financial sub-sectors seen in the dataset', () => {
    expect(classifyOrgType('國泰金融控股股份有限公司')).toBe('金控')
    expect(classifyOrgType('玉山商業銀行股份有限公司')).toBe('銀行')
    expect(classifyOrgType('南山人壽保險股份有限公司')).toBe('保險')
    expect(classifyOrgType('元大證券股份有限公司')).toBe('證券投信')
    expect(classifyOrgType('國立臺北大學')).toBe('學研')
    expect(classifyOrgType('鴻海精密工業股份有限公司')).toBe('其他')
    expect(classifyOrgType('聯發科技股份有限公司')).toBe('科技資訊')
  })

  it('puts 金控 ahead of 銀行 for holding companies', () => {
    // 「金融控股」 contains no 銀行 substring, but the ordering matters for
    // names like 「王道商業銀行金融控股」 — 金控 must win.
    expect(classifyOrgType('王道商業銀行金融控股股份有限公司')).toBe('金控')
  })
})
