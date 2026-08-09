import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'

type DbGlobals = typeof globalThis & {
  __pgPool?: Pool
  __pgMigrated?: Promise<void>
}

export interface DisposableDb {
  dbName: string
  url: string
  drop: () => Promise<void>
}

function dbGlobals(): DbGlobals {
  return globalThis as DbGlobals
}

function quotedIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function urlForDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${database}`
  return url.toString()
}

function databaseUrlFromDotEnv(): string | undefined {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return undefined

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/u)
    if (!match) continue

    const value = match[1].trim()
    if (!value) return undefined
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]
      const end = value.lastIndexOf(quote)
      if (end > 0) return value.slice(1, end)
    }
    return value.replace(/\s+#.*$/u, '').trim()
  }

  return undefined
}

/** Reads .env only when DATABASE_URL was not already supplied by the caller. */
export function loadEnvDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const databaseUrl = databaseUrlFromDotEnv()
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl
  return databaseUrl
}

/** Deliberately excludes credentials and database name for skip logs. */
export function databaseHostPort(databaseUrl: string | undefined): string {
  if (!databaseUrl) return 'host=unknown port=unknown'
  try {
    const url = new URL(databaseUrl)
    return `host=${url.hostname || 'unknown'} port=${url.port || '5432'}`
  } catch {
    return 'host=unknown port=unknown'
  }
}

/** A bounded, read-only health probe for optional PostgreSQL integration tests. */
export async function probePostgres(databaseUrl: string | undefined): Promise<boolean> {
  if (!databaseUrl) return false

  let maintenanceUrl: string
  try {
    maintenanceUrl = urlForDatabase(databaseUrl, 'postgres')
  } catch {
    return false
  }

  const pool = new Pool({
    connectionString: maintenanceUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_000,
    statement_timeout: 2_000,
  })
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('PostgreSQL probe timed out')), 2_000)
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timeout) clearTimeout(timeout)
    await pool.end().catch(() => {})
  }
}

/** Points lib/db/client.ts at a disposable URL and clears its global singleton cache. */
export function pointPoolAt(databaseUrl: string): void {
  process.env.DATABASE_URL = databaseUrl
  delete dbGlobals().__pgPool
  delete dbGlobals().__pgMigrated
}

/** Ends the current client singleton before changing its URL or dropping its database. */
export async function endPointedPool(): Promise<void> {
  const globals = dbGlobals()
  const pool = globals.__pgPool
  delete globals.__pgPool
  delete globals.__pgMigrated
  await pool?.end()
}

/** Creates an isolated PostgreSQL database without ever migrating the development database. */
export async function createDisposableDb(databaseUrl: string): Promise<DisposableDb> {
  const dbName = `wang_test_${process.pid}_${crypto.randomBytes(2).toString('hex')}`
  const adminUrl = urlForDatabase(databaseUrl, 'postgres')
  const admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 2_000 })

  try {
    await admin.query(`CREATE DATABASE ${quotedIdentifier(dbName)}`)
  } finally {
    await admin.end()
  }

  return {
    dbName,
    url: urlForDatabase(databaseUrl, dbName),
    async drop(): Promise<void> {
      const cleanup = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 2_000 })
      try {
        try {
          await endPointedPool()
        } finally {
          try {
            await cleanup.query(
              `SELECT pg_terminate_backend(pid)
               FROM pg_stat_activity
               WHERE datname = $1 AND pid <> pg_backend_pid()`,
              [dbName],
            )
          } finally {
            await cleanup.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(dbName)}`)
          }
        }
      } finally {
        await cleanup.end()
      }
    },
  }
}

/** Applies each requested down migration in its own transaction without changing migration tracking. */
export async function applyDownFiles(pool: Pool, files: readonly string[]): Promise<void> {
  const downDir = path.join(process.cwd(), 'db', 'migrations', 'down')

  for (const file of files) {
    const sql = fs.readFileSync(path.join(downDir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
}

/** Deletes only the tracking rows explicitly named by the caller. */
export async function deleteTrackingRows(pool: Pool, files: readonly string[]): Promise<void> {
  if (files.length === 0) return
  await pool.query('DELETE FROM schema_migrations WHERE name = ANY($1::text[])', [files])
}

export async function tableExists(pool: Pool, table: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table],
  )
  return result.rows[0]?.exists ?? false
}

export async function columnTypes(pool: Pool, table: string): Promise<Record<string, string>> {
  const result = await pool.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  )
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.data_type]))
}

export async function primaryKey(pool: Pool, table: string): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_catalog = kcu.constraint_catalog
      AND tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [table],
  )
  return result.rows.map((row) => row.column_name)
}

export async function indexExists(pool: Pool, table: string, index: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2
     ) AS exists`,
    [table, index],
  )
  return result.rows[0]?.exists ?? false
}

/** Application tables only; schema_migrations is checked separately. */
export async function tableList(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name <> 'schema_migrations'
     ORDER BY table_name`,
  )
  return result.rows.map((row) => row.table_name)
}
