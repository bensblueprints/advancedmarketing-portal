# Advanced Marketing — Client Portal Stack

A unified Docker Compose deployment for the Advanced Marketing client portal.

## What's Included

| Service | Description | Port |
|---------|-------------|------|
| `portal-api` | Express.js API (auth, tasks, invoices, tickets) | 3001 |
| `portal` | Nginx static frontend (login, dashboard, admin) | 80 |

## Quick Start (Local)

```bash
# 1. Copy environment file
cp .env.example .env
# Edit .env with your actual values

# 2. Start the stack
docker-compose up -d --build

# 3. Verify
open http://localhost:80        # Frontend
curl http://localhost:3001/api/health  # API
```

## Deploy to Coolify

See [`COOLIFY-DEPLOY.md`](COOLIFY-DEPLOY.md) for complete Coolify deployment instructions.

## Project Structure

```
.
├── docker-compose.yml          ← Orchestrates both services
├── .env.example                ← Template for env vars
├── am-client-portal/           ← Frontend (Nginx + static HTML)
│   ├── Dockerfile
│   ├── index.html
│   ├── dashboard.html
│   └── ...
└── am-client-portal-api/       ← Backend (Node.js + Express)
    ├── Dockerfile
    ├── server.js
    └── package.json
```

## Database Setup

The API **auto-creates all tables on first boot** — no manual SQL required.

If you prefer to run the schema manually:
```bash
psql -h your-postgres-host -U your-user -d client_portal -f init-db.sql
```

## Domains

- **Frontend**: `https://client.advancedmarketing.co`
- **API**: `https://portal-api.advancedmarketing.co`

Make sure both DNS records point to your Contabo/Coolify server.
