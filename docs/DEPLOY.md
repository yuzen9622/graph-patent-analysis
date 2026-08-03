# Deployment (Docker + Cloudflare Tunnel)

The app builds into a self-contained Next.js **standalone** server and runs as a
Docker container. LLM API keys are read from the **server environment** — there
is no bring-your-own-key input in the UI.

## Prerequisites

- Docker + Docker Compose
- A Gemini API key
- A Cloudflare account with a Tunnel (Zero Trust → Access → Tunnels)

## Quick start

```bash
cp .env.docker.example .env
# edit .env: GEMINI_API_KEY, CLOUDFLARE_TUNNEL_TOKEN, AUTH_SECRET,
#            POSTGRES_PASSWORD (and the matching DATABASE_URL)
docker compose up -d --build

# create the first account (migrations run on the app's first DB access)
node scripts/make-account.mjs yuzen --role admin --name "系統管理者"
```

Then in the Cloudflare Zero Trust dashboard, edit the tunnel's **Public
Hostname** and point it at the service `http://app:3001`. The tunnel connector
runs inside the same Compose network, so no host port needs to be exposed.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | app container | Server-side Gemini key used by `/api/analyze`. Required. |
| `AUTH_SECRET` | app container | ≥16 chars; signs the session cookie. Required in production. |
| `DATABASE_URL` | app container | PostgreSQL connection string. Required in production. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | db container | Credentials the compose file also builds `DATABASE_URL` from. |
| `CLOUDFLARE_TUNNEL_TOKEN` | cloudflared container | Token-based Cloudflare Tunnel credential. |
| `NEXT_PUBLIC_USE_MOCK` | build arg (optional) | `true` skips real LLM calls in the UI (dev only). |

## Storage model

| Where | What |
|---|---|
| PostgreSQL | Accounts, sessions, and every analysis result — normalised into `analyses` / `patents` / `applicants` / `concepts` / `patent_concepts` / `edges` / `communities`. |
| Disk (`/app/data/uploads`) | The uploaded `.xlsx` files. The database stores only `uploads.stored_path`; the bytes never enter PostgreSQL. |
| Disk (`/app/data/snapshots`) | A JSON snapshot per analysis, written tmp-then-rename. A portable backup / export artefact — the app never reads it back. |

Downloads go through `GET /api/files/<id>`, which requires a session and checks
ownership; the filesystem path is never exposed to the browser.

Schema lives in `db/migrations/*.sql` and is applied automatically on the app's
first database access, guarded by a Postgres advisory lock so two containers
starting together cannot race.

## Authentication

Every page and API route sits behind a login. Public paths are only `/login`,
`/api/auth/login` and `/api/auth/logout`.

- `proxy.ts` performs the cheap **optimistic** check (cookie signature +
  expiry, no I/O), the pattern Next 16 recommends.
- `requireUser()` (`lib/db/sessions.ts`) is the **authoritative** check against
  the `sessions` table, called by every route handler that touches data — so a
  logout, a deleted session or a deactivated account takes effect immediately.
- Passwords are scrypt hashes with a **per-user 16-byte random salt** stored in
  `users.password_salt`. Two accounts with the same password get unrelated
  hashes. The raw session token is never stored either — only its SHA-256.
- Roles: `admin` (sees and manages every analysis, can run the importer) and
  `researcher` (own analyses only).
- Login attempts are throttled to 10 failures per IP per 5 minutes.
- **Fail-closed**: with `NODE_ENV=production` and no `AUTH_SECRET`/`DATABASE_URL`,
  the app answers `503` to everything instead of publishing an open instance.
  Outside production the gate is bypassed so `pnpm dev` keeps working.

### Add, rotate or list accounts

```bash
node scripts/make-account.mjs wang                            # random password
node scripts/make-account.mjs wang 'chosen-password'
node scripts/make-account.mjs yuzen --role admin --name "系統管理者"
node scripts/make-account.mjs --list
```

The script talks to PostgreSQL directly (via `DATABASE_URL`, which points at the
loopback-published `127.0.0.1:5433`). Re-running it for an existing username
resets the password **and deletes that user's sessions**. Changing
`AUTH_SECRET` logs everybody out.

### Importing pre-database analyses

`POST /api/admin/import` (admin only) reads every `data/*.json` left over from
the file-based version and writes it into the normalised tables, reusing the
same normaliser as a live analysis — including `graph-compat` reconstruction
for pre-v2 files. It is idempotent; pass `?force=1` to re-import.

> `NVIDIA_API_KEY` / `OPENAI_API_KEY` are also honored if those providers are
> selected, but only `GEMINI_API_KEY` is required for the default setup.

## Persisted data

Two named volumes:

- `patent-db` → `/var/lib/postgresql/data`. **The one that matters** — accounts
  and all analysis results. Back this up with `pg_dump`.
- `patent-data` → `/app/data`. Uploaded spreadsheets and JSON snapshots.

```bash
docker compose exec -T db pg_dump -U patent patent_graph | gzip > backup.sql.gz
```

## Running without the tunnel (local)

Uncomment the `ports: - "3001:3001"` block in `docker-compose.yml` and open
<http://localhost:3001>.

## Build the image on its own

```bash
docker build -t graph-patent-analysis .
docker run --rm -p 3001:3001 \
  -e GEMINI_API_KEY=... -e AUTH_SECRET=... -e DATABASE_URL=postgres://... \
  -v patent-data:/app/data graph-patent-analysis
```

> The image copies `db/` and the `vis-network` UMD bundle explicitly: Next's
> standalone tracing only follows `import`s, and both are read at runtime with
> `readFileSync`.
