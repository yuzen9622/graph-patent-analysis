#!/usr/bin/env node
/**
 * make-account.mjs — create or update an account in PostgreSQL.
 *
 *   node scripts/make-account.mjs wang                    # random password
 *   node scripts/make-account.mjs wang 'chosen-password'
 *   node scripts/make-account.mjs yuzen 'pw' --role admin
 *   node scripts/make-account.mjs --list
 *
 * Each account gets its own 16-byte random salt; the password itself is never
 * stored. Must stay in sync with hashPassword() in lib/db/users.ts.
 *
 * Reads DATABASE_URL from the environment or .env.
 */

import { randomBytes, scryptSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

// Minimal .env reader — the script runs outside Next, which normally loads it.
function loadEnv() {
  const file = path.join(process.cwd(), '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim()
  }
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomPassword(length = 16) {
  return Array.from(randomBytes(length), (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

function usage() {
  console.error(`用法：
  node scripts/make-account.mjs <username> [password] [--role admin|researcher] [--name 顯示名稱]
  node scripts/make-account.mjs --list`)
}

async function main() {
  loadEnv()
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('缺少 DATABASE_URL。')
    process.exit(1)
  }

  const argv = process.argv.slice(2)
  const client = new pg.Client({ connectionString })
  await client.connect()

  try {
    if (argv[0] === '--list') {
      const { rows } = await client.query(
        'SELECT username, display_name, role, is_active, created_at, last_login_at FROM users ORDER BY created_at',
      )
      if (rows.length === 0) console.log('（尚無帳號）')
      for (const row of rows) {
        console.log(
          `${row.username}\t${row.role}\t${row.is_active ? '啟用' : '停用'}\t` +
            `建立 ${row.created_at.toISOString().slice(0, 10)}\t` +
            `最後登入 ${row.last_login_at ? row.last_login_at.toISOString().slice(0, 16) : '—'}` +
            `${row.display_name ? `\t${row.display_name}` : ''}`,
        )
      }
      return
    }

    // Walk the argv so a flag's value is never mistaken for a positional —
    // `make-account wang --role admin` must not read "admin" as the password.
    const positional = []
    const flags = {}
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg.startsWith('--')) {
        flags[arg.slice(2)] = argv[i + 1]
        i += 1
      } else {
        positional.push(arg)
      }
    }

    const username = positional[0]
    if (!username) {
      usage()
      process.exit(1)
    }

    const password = positional[1] ?? randomPassword()
    const role = flags.role ?? 'researcher'
    const displayName = flags.name ?? null

    if (!['admin', 'researcher'].includes(role)) {
      console.error(`role 必須是 admin 或 researcher，收到 "${role}"`)
      process.exit(1)
    }

    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(password, salt, 64).toString('hex')

    const { rows } = await client.query(
      `INSERT INTO users (username, password_hash, password_salt, display_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (lower(username)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt,
             display_name  = COALESCE(EXCLUDED.display_name, users.display_name),
             role          = EXCLUDED.role,
             is_active     = true
       RETURNING id, (xmax = 0) AS inserted`,
      [username, hash, salt, displayName, role],
    )

    // Changing a password must not leave old sessions usable.
    if (!rows[0].inserted) {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id])
    }

    console.log(rows[0].inserted ? '已建立帳號' : '已更新帳號（既有 session 已登出）')
    console.log(`帳號：${username}`)
    console.log(`密碼：${password}`)
    console.log(`角色：${role}`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
