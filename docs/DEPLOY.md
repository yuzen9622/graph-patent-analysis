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
# edit .env: set GEMINI_API_KEY and CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d --build
```

Then in the Cloudflare Zero Trust dashboard, edit the tunnel's **Public
Hostname** and point it at the service `http://app:3000`. The tunnel connector
runs inside the same Compose network, so no host port needs to be exposed.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | app container | Server-side Gemini key used by `/api/analyze`. Required. |
| `CLOUDFLARE_TUNNEL_TOKEN` | cloudflared container | Token-based Cloudflare Tunnel credential. |
| `NEXT_PUBLIC_USE_MOCK` | build arg (optional) | `true` skips real LLM calls in the UI (dev only). |

> `NVIDIA_API_KEY` / `OPENAI_API_KEY` are also honored if those providers are
> selected, but only `GEMINI_API_KEY` is required for the default setup.

## Persisted data

Analysis results are written to `/app/data` inside the container and mounted to
the named volume `patent-data`, so shareable result URLs survive restarts.

## Running without the tunnel (local)

Uncomment the `ports: - "3000:3000"` block in `docker-compose.yml` and open
<http://localhost:3000>.

## Build the image on its own

```bash
docker build -t graph-patent-analysis .
docker run --rm -p 3000:3000 -e GEMINI_API_KEY=... -v patent-data:/app/data graph-patent-analysis
```
