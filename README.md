[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Q2L8227VO8)

# Bookworm

A self-hosted personal reading tracker. Track what you're reading, what you want to read, and what you've finished. Log multiple reads of the same book with individual ratings and reviews. Organise books into custom shelves. Search Google Books, Open Library and Apple Books (all queried side by side for redundancy), or add books manually.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + vanilla JS + Tailwind CSS v4 |
| Backend | Node 20 + Express |
| Database | Postgres 16 |
| Deployment | Docker Compose |

## Getting started

### Prerequisites

- Docker + Docker Compose
- A Google Books API key (optional — the API works without one at reduced quota)

### 1. Clone and configure

```bash
git clone <your-repo>
cd bookworm
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
POSTGRES_PASSWORD=something-secure
GOOGLE_BOOKS_API_KEY=AIza...   # optional
```

### 2. Run

```bash
docker compose up --build
```

- Frontend: http://localhost:8080
- API: http://localhost:3000

### 3. Stop

```bash
docker compose down          # keep data
docker compose down -v       # wipe data (fresh start)
```

## Local development (without Docker)

Start Postgres however you like, then:

```bash
# Terminal 1 — backend
cd backend
npm install
DATABASE_URL=postgres://bookworm:changeme@localhost:5432/bookworm npm run dev

# Terminal 2 — frontend (proxies /api to localhost:3000)
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_DB` | `bookworm` | Database name |
| `POSTGRES_USER` | `bookworm` | Database user |
| `POSTGRES_PASSWORD` | — | **Required.** Database password |
| `GOOGLE_BOOKS_API_KEY` | _(empty)_ | Optional — higher API quota |
| `API_PORT` | `3000` | Host port for the API container |
| `FRONTEND_PORT` | `8080` | Host port for the frontend container |
| `COVERS_MAX_MB` | _(unset)_ | Optional — cap the cover image cache size in MB; oldest files are pruned on startup and every 24h |
| `REQUIRE_INVITE` | `false` | Set to `true` for invite-only registration: every account except the very first (the admin) must supply a valid, unused invite code |
| `INTEGRATIONS_KEY` | _(unset)_ | Encrypts Audiobookshelf / Calibre-Web / Kobo credentials at rest (AES-256-GCM). A 32-byte key as hex or base64, or any passphrase. **Recommended.** Without it credentials are stored as plaintext and a warning is logged at boot |
| `INTEGRATION_ALLOWED_HOSTS` | _(unset)_ | Optional comma-separated hostnames (e.g. `calibre.lan,192.168.1.20`) that integrations may point at. **Recommended for multi-user instances**; when unset, any user can aim an integration at any LAN host |

### Registration and invites

Registration is **open by default**: anyone who can reach the instance can create an account (the first account on a fresh database becomes the admin). To make the instance invite-only, set `REQUIRE_INVITE=true`; admins then create single-use invite codes in Settings, and every registration after the first must include one. Without `REQUIRE_INVITE`, an invite code is optional but, if supplied, must still be valid and unused. Combine open registration with reCAPTCHA (below) on public deployments.

### Integration secrets

Integration credentials (Calibre-Web password, Audiobookshelf token, Kobo token) are never returned by the API. Set `INTEGRATIONS_KEY` to encrypt them in the database; on the next start any credentials already stored in plaintext are encrypted automatically. Keep the key safe — losing it means users must re-enter their integration credentials. Changing the key has the same effect.

### Profile visibility

Profiles are public by default. A user marked private (`isPublic: false` via `PATCH /api/auth/me`) is hidden — profile, followers, feed entries, user list, likes and comments on their sessions — from everyone except themselves and admins.

### reCAPTCHA v3 (optional but recommended for open registration)

Bookworm can require a reCAPTCHA v3 token when users register. This repository now ships with support for reCAPTCHA v3: the frontend will load the site key and call grecaptcha.execute before sending a registration request; the backend verifies the token with Google's siteverify endpoint.

Set the following environment variables to enable reCAPTCHA:

```env
RECAPTCHA_SITE_KEY=your_site_key_here
RECAPTCHA_SECRET=your_secret_key_here
# Optional: minimum acceptable score (0.0 to 1.0). Default: 0.5
RECAPTCHA_MIN_SCORE=0.5
```

Notes:
- If `RECAPTCHA_SITE_KEY` is not set, the frontend will show "Anti-bot unavailable" and registrations that don't include a valid token will be rejected by the API.
- The very first user you create (fresh database) is still allowed to register without a token and becomes admin.

Example PowerShell dev run with reCAPTCHA env vars:

```powershell
Set-Location backend
#$env:RECAPTCHA_SITE_KEY = 'your_site_key'
#$env:RECAPTCHA_SECRET = 'your_secret'
#$env:RECAPTCHA_MIN_SCORE = '0.5'
npm install
DATABASE_URL=postgres://bookworm:changeme@localhost:5432/bookworm npm run dev
```

Open the frontend in a separate terminal:

```powershell
Set-Location frontend
npm install
npm run dev
# open http://localhost:5173
```

## VPS deployment

1. Copy the project folder to your VPS (`rsync`, `scp`, or git clone).
2. Set up `.env` with a strong `POSTGRES_PASSWORD`.
3. Run `docker compose up --build -d`.
4. Put a reverse proxy (Nginx, Caddy, Traefik) in front to add HTTPS.

The first account you register becomes the admin. Registration stays open to anyone who can reach the site unless you set `REQUIRE_INVITE=true`, in which case later registrations need an invite code generated by the admin in Settings. For a public deployment, set `REQUIRE_INVITE=true` (or enable reCAPTCHA), set `INTEGRATIONS_KEY`, and set `INTEGRATION_ALLOWED_HOSTS`.

Example Caddy snippet:

```
bookworm.yourdomain.com {
    basicauth {
        mihajlo <bcrypt-hash>
    }
    reverse_proxy localhost:8080
    handle /api/* {
        reverse_proxy localhost:3000
    }
}
```

## Data backup

Postgres data lives in a named Docker volume (`pgdata`). To back it up:

```bash
docker exec bookworm-db-1 pg_dump -U bookworm bookworm > backup.sql
```

To restore:

```bash
cat backup.sql | docker exec -i bookworm-db-1 psql -U bookworm bookworm
```
