/**
 * uploads.ts — uploaded spreadsheets live on disk; the database keeps only a
 * row pointing at them. Nothing binary is ever stored in PostgreSQL.
 *
 * Files are written tmp-then-rename so a crash mid-write cannot leave a
 * half-written .xlsx that a database row claims is complete.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { query, queryOne } from './client'

export const DATA_DIR = path.join(process.cwd(), 'data')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

export interface UploadRecord {
  id: string
  owner_id: string | null
  original_name: string
  stored_path: string
  content_type: string | null
  byte_size: string | number | null
  sha256: string | null
  created_at: Date
}

/** The only identifier handed to the browser — download requires a session. */
export function uploadUrl(id: string): string {
  return `/api/files/${id}`
}

export async function saveUpload(input: {
  ownerId: string | null
  originalName: string
  contentType?: string | null
  bytes: Buffer
}): Promise<{ id: string; url: string }> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })

  const id = randomUUID()
  const extension = path.extname(input.originalName).slice(0, 16) || '.xlsx'
  const storedPath = path.join(UPLOAD_DIR, `${id}${extension}`)
  const tempPath = `${storedPath}.tmp`

  await fs.writeFile(tempPath, input.bytes)
  await fs.rename(tempPath, storedPath)

  const sha256 = createHash('sha256').update(input.bytes).digest('hex')

  try {
    await query(
      `INSERT INTO uploads (id, owner_id, original_name, stored_path, content_type, byte_size, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.ownerId,
        input.originalName,
        storedPath,
        input.contentType ?? null,
        input.bytes.byteLength,
        sha256,
      ],
    )
  } catch (err) {
    // Do not leave an orphan file behind if the row could not be written.
    await fs.unlink(storedPath).catch(() => {})
    throw err
  }

  return { id, url: uploadUrl(id) }
}

export async function getUpload(id: string): Promise<UploadRecord | null> {
  return queryOne<UploadRecord>('SELECT * FROM uploads WHERE id = $1', [id])
}

export async function readUploadBytes(record: UploadRecord): Promise<Buffer | null> {
  try {
    return await fs.readFile(record.stored_path)
  } catch {
    return null
  }
}
