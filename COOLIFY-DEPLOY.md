# Coolify Deployment Guide — Client Portal Stack

Deploy both the frontend and API to your Contabo server running Coolify as a single Docker Compose resource.

---

## Prerequisites

1. This repo pushed to GitHub/GitLab
2. Coolify v4 running on your Contabo server
3. PostgreSQL database available (Coolify-managed or external)
4. DNS records pointing to your Contabo IP:
   - `client.advancedmarketing.co` → Contabo IP
   - `portal-api.advancedmarketing.co` → Contabo IP

---

## Step 1: Push to Git

```bash
cd client-portal-stack
git init
git add .
git commit -m "Initial client portal stack"
git remote add origin https://github.com/bensblueprints/advancedmarketing-portal.git
git push -u origin main
```

---

## Step 2: Create Coolify Project

1. Log into your Coolify dashboard (`https://coolify.your-domain.com`)
2. Click **Projects** → **New Project**
3. Name it: `Advanced Marketing — Client Portal`
4. Click **Create**

---

## Step 3: Add the Docker Compose Resource

1. Inside the project, click **Add Resource**
2. Select **Private Repository** (or GitHub/GitLab)
3. Paste your repo URL: `https://github.com/bensblueprints/advancedmarketing-portal.git`
4. **Base Directory**: leave blank (repo root)
5. **Build Pack**: Coolify should auto-detect `Docker Compose`
6. Click **Continue**

> 💡 **Auto-Init**: The API automatically creates all database tables on first boot. No manual SQL required.

---

## Step 4: Configure Services

Coolify will parse `docker-compose.yml` and show two services: `portal-api` and `portal`.

### Service: `portal-api`

| Setting | Value |
|---------|-------|
| **Domains** | `https://portal-api.advancedmarketing.co` |
| **Port** | `3001` |
| **Healthcheck URL** | `http://portal-api:3001/api/health` |

### Service: `portal`

| Setting | Value |
|---------|-------|
| **Domains** | `https://client.advancedmarketing.co` |
| **Port** | `80` |

---

## Step 5: Environment Variables

Go to **Environment Variables** in the Coolify resource and add:

| Variable | Value | Required |
|----------|-------|----------|
| `DB_HOST` | Your Postgres host | ✅ |
| `DB_PORT` | `5432` | ✅ |
| `DB_USER` | `cloudcomputer` (or your user) | ✅ |
| `DB_PASSWORD` | Your password | ✅ |
| `DB_NAME` | `client_portal` | ✅ |
| `JWT_SECRET` | `openssl rand -base64 64` | ✅ |
| `STRIPE_SECRET_KEY` | `sk_live_...` | ✅ |
| `RESEND_API_KEY` | `re_...` | ✅ |
| `ADMIN_NAME` | Your name | Optional |
| `ADMIN_EMAIL` | you@advancedmarketing.co | Optional |
| `ADMIN_PASSWORD` | Strong password | Optional |

> ⚠️ **Rotate keys first** — the old hardcoded keys were exposed in earlier versions.

> 💡 If you set `ADMIN_EMAIL` and `ADMIN_PASSWORD`, the API will auto-create an admin user on first boot. No manual database queries needed.

---

## Step 6: Database Setup

Connect to your Postgres instance and run the schema from the section below **before** first deploy.

---

## Step 7: Deploy

Click **Deploy** in Coolify. It will:
1. Pull the repo
2. Build both Docker images
3. Start containers on the same Docker network
4. Configure the reverse proxy (Traefik/Nginx)
5. Issue SSL certificates via Let's Encrypt

---

## Step 8: Create Admin User (if not using AUTO_ADMIN)

If you didn't set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Step 5, create an admin manually:

```bash
# Sign up
curl -X POST https://portal-api.advancedmarketing.co/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"you@advancedmarketing.co","password":"STRONG_PASSWORD","business_name":"Advanced Marketing"}'

# Promote to admin via database
# psql into your DB and run:
UPDATE clients SET is_admin = true, role = 'admin' WHERE email = 'you@advancedmarketing.co';
```

---

## Database Schema

Run this SQL on your PostgreSQL instance before first deploy:

```sql
-- Clients
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  business_name VARCHAR(255),
  service_type VARCHAR(50) DEFAULT 'web_design',
  onboarding_status VARCHAR(50) DEFAULT 'active',
  google_drive_folder_url TEXT,
  welcome_message_dismissed BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  role VARCHAR(50) DEFAULT 'client',
  commission_rate DECIMAL(5,2) DEFAULT 20,
  github_repo VARCHAR(255),
  hosting_url VARCHAR(255),
  hosting_type VARCHAR(50),
  server_ip VARCHAR(50),
  netlify_site_id VARCHAR(255),
  added_by INTEGER REFERENCES clients(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  assigned_to VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  description TEXT,
  due_date DATE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_data TEXT NOT NULL,
  document_type VARCHAR(50) DEFAULT 'other',
  uploaded_by VARCHAR(50) DEFAULT 'client',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Payment authorizations
CREATE TABLE IF NOT EXISTS payment_authorizations (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  cardholder_name VARCHAR(255),
  last_four_digits VARCHAR(4),
  card_brand VARCHAR(50),
  authorization_note TEXT,
  viewed_by_agency BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP DEFAULT NOW()
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  subject VARCHAR(500),
  status VARCHAR(50) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ticket messages
CREATE TABLE IF NOT EXISTS ticket_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  sender_type VARCHAR(50) NOT NULL,
  sender_name VARCHAR(255),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) DEFAULT 'software',
  amount DECIMAL(10,2) NOT NULL,
  frequency VARCHAR(50) DEFAULT 'monthly',
  vendor VARCHAR(255),
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Goals
CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  target_value INTEGER NOT NULL,
  current_value INTEGER DEFAULT 0,
  unit VARCHAR(50) DEFAULT 'units',
  deadline DATE,
  is_active BOOLEAN DEFAULT TRUE,
  user_id INTEGER REFERENCES clients(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Goal checkins
CREATE TABLE IF NOT EXISTS goal_checkins (
  id SERIAL PRIMARY KEY,
  goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  notes TEXT
);

-- Daily logs
CREATE TABLE IF NOT EXISTS daily_logs (
  id SERIAL PRIMARY KEY,
  log_date DATE NOT NULL,
  user_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  calls_made INTEGER DEFAULT 0,
  pitches_given INTEGER DEFAULT 0,
  deals_closed INTEGER DEFAULT 0,
  revenue_closed DECIMAL(12,2) DEFAULT 0,
  mrr_added DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  UNIQUE(user_id, log_date)
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Publications (for PR service)
CREATE TABLE IF NOT EXISTS publications (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  genre VARCHAR(100),
  price DECIMAL(10,2),
  domain_authority INTEGER,
  url VARCHAR(500),
  notes TEXT
);
```

---

## Post-Deploy Checklist

- [ ] `https://client.advancedmarketing.co` shows login page
- [ ] `https://portal-api.advancedmarketing.co/api/health` returns `{"status":"ok"}`
- [ ] Admin login works
- [ ] Dashboard loads tasks, invoices, documents
- [ ] Support tickets send email notifications
- [ ] Document upload/download works
- [ ] Stripe invoices display correctly

---

## Troubleshooting

**API container keeps restarting**
- Check Coolify logs → likely DB connection failure
- Verify `DB_HOST` is reachable from Coolify's Docker network
- If using Coolify-managed Postgres, use the internal Docker hostname

**Frontend shows "Failed to load"**
- API is likely down or unreachable
- Check that both services are on the same network
- Verify CORS isn't blocking (API has `app.use(cors())`)

**SSL certificate errors**
- Ensure DNS is fully propagated before deploying
- Coolify will retry Let's Encrypt automatically
