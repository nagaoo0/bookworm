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

The first account you register becomes the admin. Subsequent registrations require an invite code, which the admin generates from Settings.

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
