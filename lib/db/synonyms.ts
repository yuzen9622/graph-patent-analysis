// lib/db/synonyms.ts — PRD v2 / P1 synonym dictionary CRUD.
//
// The dictionary lives in the global `synonym_groups` table, shared across all
// analyses and editable by an authenticated user.  When an analysis runs, this
// dictionary is snapshot into `analyses.synonym_snapshot` (see lib/synonyms.ts
// createSnapshot + the analyze route), so an analysis never changes on reopen
// when the global dictionary is later edited.

import { randomUUID } from 'crypto'
import { query, queryOne } from './client'
import type { SynonymGroup } from '@/lib/synonyms'

const DB_COLUMNS = `id, canonical, aliases, note`

type GroupRow = { id: string; canonical: string; aliases: string[] | null; note: string | null }

const pluck = (row: GroupRow): SynonymGroup => ({
  id: row.id,
  canonical: row.canonical,
  aliases: row.aliases ?? [],
  ...(row.note ? { note: row.note } : {}),
})

/** All groups, canonical-ordered (deterministic for buildSynonymMap). */
export async function listSynonymGroups(): Promise<SynonymGroup[]> {
  const rows = await query<GroupRow>(`SELECT ${DB_COLUMNS} FROM synonym_groups ORDER BY canonical`)
  return rows.map(pluck)
}

/** One group by id, or null. */
export async function getSynonymGroup(id: string): Promise<SynonymGroup | null> {
  const row = await queryOne<GroupRow>(`SELECT ${DB_COLUMNS} FROM synonym_groups WHERE id = $1`, [
    id,
  ])
  return row ? pluck(row) : null
}

/**
 * Upsert a synonym group. `id` may be empty to create; otherwise the row is
 * replaced wholesale (canonical must stay unique, enforced by the DB).
 *
 * Returns the persisted group. A conflicting canonical on an INSERT surfaces as
 * a 23505 unique violation; the API route maps it to a 409.
 */
export async function upsertSynonymGroup(input: {
  id?: string | null
  canonical: string
  aliases?: string[]
  note?: string | null
}): Promise<SynonymGroup> {
  const id = input.id ?? randomUUID()
  const aliases = (input.aliases ?? []).map((a) => a.trim()).filter(Boolean)
  const note = input.note?.trim() || null
  const row = await queryOne<GroupRow>(
    `INSERT INTO synonym_groups (id, canonical, aliases, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       canonical = EXCLUDED.canonical,
       aliases   = EXCLUDED.aliases,
       note      = EXCLUDED.note,
       updated_at = now()
     RETURNING ${DB_COLUMNS}`,
    [id, input.canonical.trim() || id, aliases, note],
  )
  if (!row) throw new Error('synonym group upsert returned no row')
  return pluck(row)
}

/** Remove a group. Returns true if a row was actually deleted. */
export async function deleteSynonymGroup(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM synonym_groups WHERE id = $1 RETURNING id`,
    [id],
  )
  return rows.length > 0
}