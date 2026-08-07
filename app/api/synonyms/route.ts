// app/api/synonyms/route.ts — PRD v2 / P1 synonym dictionary CRUD API.
//
// Authenticated.  The global dictionary is read at analysis start and snapshotted
// per-analysis, so editing it here never rewrites past analyses.

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import {
  deleteSynonymGroup,
  getSynonymGroup,
  listSynonymGroups,
  upsertSynonymGroup,
} from '@/lib/db/synonyms'
import { buildSynonymMap } from '@/lib/synonyms'

function authError(err: unknown): NextResponse | null {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 })
  }
  throw err
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: string }).code === 'string' &&
    (err as { code?: string }).code === '23505'
  )
}

/** GET /api/synonyms — list all groups plus the derived resolve-map warnings. */
export async function GET(): Promise<NextResponse> {
  try {
    await requireUser()
  } catch (err) {
    const denial = authError(err)
    if (denial) return denial
  }
  const groups = await listSynonymGroups()
  const { warnings } = buildSynonymMap(groups)
  return NextResponse.json({ groups, warnings })
}

interface SynonymBody {
  id?: string | null
  canonical: string
  aliases?: string[]
  note?: string | null
}

/** POST /api/synonyms — create or update one group; body is the full group. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireUser()
  } catch (err) {
    const denial = authError(err)
    if (denial) return denial
  }

  let body: SynonymBody
  try {
    body = (await request.json()) as SynonymBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const canonical = typeof body.canonical === 'string' ? body.canonical.trim() : ''
  const aliases = Array.isArray(body.aliases) ? body.aliases.filter((a) => typeof a === 'string') : []
  if (!canonical) {
    return NextResponse.json({ error: 'canonical 不能為空' }, { status: 400 })
  }
  if (aliases.some((a) => a.trim() === canonical)) {
    return NextResponse.json(
      { error: 'aliases 不得與 canonical 相同' },
      { status: 400 },
    )
  }

  try {
    const groups = await upsertSynonymGroup({
      id: typeof body.id === 'string' && body.id ? body.id : null,
      canonical,
      aliases,
      note: typeof body.note === 'string' ? body.note : null,
    })
    return NextResponse.json({ group: groups }, { status: 200 })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: '已有相同 canonical 的同義詞群組' },
        { status: 409 },
      )
    }
    throw err
  }
}

/** DELETE /api/synonyms?id=<uuid> — remove a group. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    await requireUser()
  } catch (err) {
    const denial = authError(err)
    if (denial) return denial
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 })
  }
  const existing = await getSynonymGroup(id)
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  await deleteSynonymGroup(id)
  return NextResponse.json({ ok: true }, { status: 200 })
}