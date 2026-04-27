# Client Portal Recovery Guide

## What I Found

### 1. Domain is pointing to the wrong place ❌
`client.advancedmarketing.co` is currently serving **GoHighLevel** HTML from Google Cloud Storage — NOT your custom client portal.

**Evidence:**
- Response headers include `x-guploader-uploadid` (Google Cloud Storage)
- HTML body contains `lead-connector` class and GoHighLevel origin-trial tokens
- Served via Cloudflare (`CF-RAY` header)

### 2. API backend is completely down ❌
`portal-api.advancedmarketing.co` is unreachable.

**Evidence:**
- No response to HTTPS requests
- Your Express API (Docker container behind Traefik) is not responding

### 3. Security issues fixed locally ✅
I updated the codebase to remove hardcoded secrets:
- **API backend (`server.js`)**: Stripe key, Resend key, JWT secret, DB credentials → now use `process.env`
- **Netlify functions**: GHL API key, Stripe key, Resend key, JWT secret → now use `process.env`
- Created `.env.example` files in both projects
- Added `.env` to `.gitignore`

> ⚠️ **IMPORTANT**: The old keys were exposed in Git history. You should **rotate them immediately** in Stripe, GoHighLevel, and Resend dashboards.

---

## How to Fix

### Step 1: Fix DNS for `client.advancedmarketing.co`

Your domain is currently pointing to GoHighLevel. You need to point it back to wherever your custom portal frontend is hosted.

**If using Netlify:**
1. Log into your Netlify dashboard
2. Find the site for your client portal
3. Go to **Domain settings** → **Add custom domain**
4. Enter `client.advancedmarketing.co`
5. Update your DNS provider (Cloudflare) to point the CNAME record to Netlify:
   - Type: `CNAME`
   - Name: `client`
   - Target: `<your-site>.netlify.app`

**If you don't have a Netlify site set up:**
Deploy the `am-client-portal/` folder to Netlify:
```bash
cd am-client-portal
npm install netlify-cli -g
netlify deploy --prod --dir=.
```

Or drag-and-drop the folder at [netlify.com](https://netlify.com).

### Step 2: Restart the API backend

The API runs as a Docker container with Traefik. SSH into your server and run:

```bash
# Check if the container is running
docker ps | grep client-portal-api

# If not running, check logs
docker logs client-portal-api

# Start it
cd /path/to/am-client-portal-api
docker-compose up -d

# Verify it's healthy
curl https://portal-api.advancedmarketing.co/api/health
```

**Common restart failures:**
- **Missing Docker networks**: The compose file expects `cloud-computer-community_default` and `traefik-net`. If Traefik or the DB container is down, the API can't start.
- **DB connection failure**: Verify the Postgres container is running and accessible on the Docker network.

### Step 3: Set environment variables

On the server running the API, create `/path/to/am-client-portal-api/.env`:

```env
DB_HOST=cloud-computer-community_postgres_1
DB_PORT=5432
DB_USER=cloudcomputer
DB_PASSWORD=your_actual_password
DB_NAME=client_portal
JWT_SECRET=generate-a-64-char-random-string
STRIPE_SECRET_KEY=sk_live_...
RESEND_API_KEY=re_...
```

For Netlify functions, set these in your Netlify dashboard:
- **Site settings** → **Environment variables**:
  - `GHL_API_KEY`
  - `GHL_LOCATION_ID`
  - `STRIPE_SECRET_KEY`
  - `RESEND_API_KEY`
  - `JWT_SECRET`
  - `PORTAL_URL`

### Step 4: Rotate exposed secrets

Since the old keys were in source code (and may be in Git history), rotate them:

1. **Stripe**: Dashboard → Developers → API keys → Roll secret key
2. **GoHighLevel**: Settings → API → Regenerate key
3. **Resend**: Dashboard → API Keys → Create new / Revoke old
4. **JWT Secret**: Just change it — users will need to re-login

---

## Testing Checklist

After fixing, verify:

- [ ] `https://client.advancedmarketing.co` shows the login page (not GoHighLevel)
- [ ] `https://portal-api.advancedmarketing.co/api/health` returns `{"status":"ok"}`
- [ ] You can log in with a test account
- [ ] Dashboard loads client data, tasks, and invoices
- [ ] Admin panel loads at `/admin.html`
- [ ] New support tickets send email notifications
- [ ] Document uploads work

---

## Architecture Reminder

```
User → client.advancedmarketing.co (Netlify/static host)
       ├── HTML/JS frontend (login, dashboard, admin)
       └── Netlify functions (client-invoices, etc.)

       → portal-api.advancedmarketing.co (Docker + Traefik)
         └── Express API + PostgreSQL + Stripe
```

If anything is still broken after following these steps, check the Docker logs on your server and the Netlify function logs in the Netlify dashboard.
