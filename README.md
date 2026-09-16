# Restaurant Council

A collaborative restaurant-selection app for groups, and a reference implementation of **multi-agent authorization**. Each participant has a Personal Agent that can read only that person's private preferences. A Negotiator Agent searches restaurants and ranks options from sanitized constraints. LLM prompts are not a security boundary.

Even if a model follows a prompt injection, hallucinates a tool call, or tries to exceed its role, application code and capability checks reject the operation.

## What you can do locally

1. Sign in (development identity, no password).
2. Create an event and invite someone by email.
3. Join from the invitation link.
4. Add public and private preferences.
5. Run a Council session.
6. Watch live progress and recommendations.
7. Demonstrate that cross-user, cross-agent, and Negotiator preference reads are denied.

Restaurant search uses Google Places API (New) when `GOOGLE_PLACES_API_KEY` is set. Without a key, a deterministic mock provider is used so tests and local demos still work. The frontend never calls Google; location lookup and restaurant search go through `/api/locations/*` and `/api/restaurants/*`.

Council agents do not start unless `OPENAI_API_KEY` is set.

## AI agents

Personal Agents and the Negotiator require an OpenAI-compatible API key. Without one, starting a Council returns `AGENTS_NOT_CONFIGURED` instead of silently using a local parser. A failed model call also fails the Council so you can see it. The orchestrator still decides who runs and when. Authorization, vault access, and output schemas stay in application code.

Create `.dev.vars` at the repo root (Wrangler loads it automatically), then restart the API:

```
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
GOOGLE_PLACES_API_KEY=your-places-key
```

`GET /api/health` reports `"agents": "llm"` when a key is loaded and `"restaurants": "google"` when Places is configured. The Council screen disables Start until agents are ready.

Create an event with a real search area (city, neighborhood, landmark, or coordinates) and a radius. After `pnpm --filter @rc/api db:migrate:local`, Start Council searches that area instead of a static catalog.

## Requirements

- Node.js 22+
- [pnpm](https://pnpm.io/) 11+

## Setup

```bash
pnpm install
pnpm --filter @rc/api db:migrate:local
pnpm dev
```

That starts:

- API (Cloudflare Worker + local D1 + Durable Object) at <http://127.0.0.1:8787>
- Web UI at <http://localhost:5173> (proxies `/api` to the Worker)

Open the UI, sign in as `gee@example.com`, create an event, invite `sarah@example.com`, and use the printed **dev invitation URL** (also shown in the UI and API logs).

```text
DEV INVITATION
sarah@example.com:
http://localhost:5173/join?invite=<opaque-token>
```

Raw invitation tokens are never stored. Only a SHA-256 hash is persisted.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run API and web together |
| `pnpm test` | Unit, integration, and security tests |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm build` | Production web build |

## Architecture

```text
apps/web          React / Vite UI
apps/api          Hono Worker, D1, Council Durable Object
packages/domain   Event, preference, and privacy types
packages/auth     Principals, capabilities, authorize()
packages/protocol Zod schemas for inter-agent messages
packages/agents   Personal Agent + Negotiator (no Cloudflare imports)
packages/orchestration  Deterministic Council workflow
packages/tools    Restaurant providers, search service, location resolve
packages/mcp      In-process restaurant tool adapter
```

Private preference source text lives only in `preference_vault`. The Negotiator is structurally denied access to that service, including if its capability list is constructed incorrectly.

## Configuration

See `.env.example`. Local Wrangler defaults live in `wrangler.jsonc` (`SESSION_SECRET` is insecure and local-only). For a hosted deploy:

```bash
wrangler secret put SESSION_SECRET
wrangler d1 create restaurant-council
```

Then replace the `database_id` in `wrangler.jsonc` and deploy `apps/api`. Build `apps/web` and serve the static assets from Cloudflare Pages or the Worker.

Production restaurant search and email providers are adapter-shaped and optional. LLM credentials belong in `.dev.vars` or `wrangler secret put`, never in git.

## License

Apache-2.0
