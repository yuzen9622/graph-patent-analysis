/**
 * client.ts — PostgreSQL pool + migration runner.
 *
 * The pool is a module-level singleton, cached on globalThis so Next's dev
 * hot-reload does not open a new pool per edit. `proxy.ts` deliberately does
 * NOT import this (Next 16 docs warn against shared modules/globals in proxy);
 * the DB is only touched from route handlers and server components.
 */

import fs from 'node:fs'
import path from 'node:path'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')

declare global {
  var __pgPool: Pool | undefined
  var __pgMigrated: Promise<void> | undefined
}

export function getPool(): Pool {
  if (!globalThis.__pgPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — the app cannot reach PostgreSQL.')
    }
    globalThis.__pgPool = new Pool({
      connectionString,
      max: Number(process.env.PGPOOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
    globalThis.__pgPool.on('error', (err) => {
      console.error('[db] idle client error:', err.message)
    })
  }
  return globalThis.__pgPool
}

/** Applies any migration files not yet recorded. Safe to call concurrently. */
export function migrate(): Promise<void> {
  if (!globalThis.__pgMigrated) {
    globalThis.__pgMigrated = runMigrations().catch((err) => {
      // Let the next request retry instead of caching a failed promise forever.
      globalThis.__pgMigrated = undefined
      throw err
    })
  }
  return globalThis.__pgMigrated
}

async function runMigrations(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : []

  for (const file of files) {
    const client = await pool.connect()
    try {
      // Advisory lock: two containers starting at once must not race.
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [file])
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
        file,
      ])
      if (!rowCount) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`[db] applied migration ${file}`)
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [file]).catch(() => {})
      client.release()
    }
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await migrate()
  const result = await getPool().query<T>(text, params)
  return result.rows
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await migrate()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
