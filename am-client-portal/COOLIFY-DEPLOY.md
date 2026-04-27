# Coolify Deployment Guide

This guide covers deploying both the **Client Portal Frontend** and **Client Portal API** to your Contabo server running Coolify.

---

## Prerequisites

1. Code pushed to a Git repository (GitHub/GitLab)
2. Coolify v4 running on your Contabo server
3. A PostgreSQL database available (can be Coolify-managed or existing)
4. Domain DNS pointing to your Contabo server:
   - `client.advancedmarketing.co` → Contabo IP
   - `portal-api.advancedmarketing.co` → Contabo IP

---

## Architecture

```
Internet
    │
    ├──► client.advancedmarketing.co (Coolify → Nginx → Static HTML/JS)
    │
    └──► portal-api.advancedmarketing.co (Coolify → Node.js API → Postgres)
```

---

## Part 1: Deploy the API

### 1. Create New Resource in Coolify

1. Open your Coolify dashboard
2. Click **New Resource** → **Private Repository** (or GitHub/GitLab)
3. Select your repository
4. Set **Base Directory**: `am-client-portal-api`
5. Choose **Build Pack**: `Dockerfile`
6. Click **Continue**

### 2. Configure Domain

In the resource settings:
- **Domains**: `https://portal-api.advancedmarketing.co`
- **Port**: `3001`
- Coolify will automatically handle SSL via Let's Encrypt

### 3. Environment Variables

Add these in Coolify under **Environment Variables**:

| Variable | Value | Required |
|----------|-------|----------|
| `PORT` | `3001` | Yes |
| `DB_HOST` | Your Postgres host | Yes |
| `DB_PORT` | `5432` | Yes |
| `DB_USER` | `cloudcomputer` (or your user) | Yes |
| `DB_PASSWORD` | Your password | Yes |
| `DB_NAME` | `client_portal` | Yes |
| `JWT_SECRET` | Generate: `openssl rand -base64 64` | Yes |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Yes |
| `RESEND_API_KEY` | `re_...` | Yes |

> ⚠️ **Use the NEW rotated keys**, not the old exposed ones.

### 4. Deploy

Click **Deploy**. Coolify will:
- Build the Docker image
- Start the container
- Configure the reverse proxy
- Issue SSL certificate

### 5. Verify

```bash
curl https://portal-api.advancedmarketing.co/api/health
# Should return: {"status":"ok","time":"..."}
```

---

## Part 2: Deploy the Frontend

### 1. Create New Resource in Coolify

1. Click **New Resource** → **Private Repository**
2. Select your repository
3. Set **Base Directory**: `am-client-portal`
4. Choose **Build Pack**: `Dockerfile`
5. Click **Continue**

### 2. Configure Domain

- **Domains**: `https://client.advancedmarketing.co`
- **Port**: `80`

### 3. Environment Variables

The frontend is static, but if you want to override the API URL at build time, add:

| Variable | Value |
|----------|-------|
| `API_BASE` | `https://portal-api.advancedmarketing.co` |

> Note: The API URL is currently hardcoded in the HTML files. If you need to change it later, update all `*.html` files or use the `API_BASE` build arg (requires modifying the Dockerfile).

### 4. Deploy

Click **Deploy**. The static site will be served via Nginx.

### 5. Verify

Open `https://client.advancedmarketing.co` in a browser. You should see the login page.

---

## Part 3: Database Setup

If this is a fresh database, create the required tables. Connect to your Postgres instance and run:

```sql
-- Clients table
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

-- Tasks table
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

-- Documents table
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

## Part 4: Create Admin User

After the API is running, create your first admin user:

```bash
curl -X POST https://portal-api.advancedmarketing.co/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin User",
    "email": "your-email@advancedmarketing.co",
    "password": "strong-password-here",
    "business_name": "Advanced Marketing"
  }'
```

Then promote to admin via database:

```sql
UPDATE clients SET is_admin = true, role = 'admin' WHERE email = 'your-email@advancedmarketing.co';
```

---

## Troubleshooting

### API returns 500 / won't start
- Check Coolify logs for the API container
- Verify `DB_HOST` is reachable from the Coolify network
- If using Coolify-managed Postgres, use the internal Docker hostname (e.g., `postgresql-xxx`)

### Frontend shows blank page
- Check browser console for mixed-content errors (HTTP vs HTTPS)
- Ensure API domain has valid SSL
- Verify CORS is not blocking requests

### Login works but dashboard is empty
- Database tables may be missing — run the SQL setup above
- Check API logs for database connection errors

---

## Files Changed for Coolify

| File | Change |
|------|--------|
| `am-client-portal-api/server.js` | Uses `process.env` for all secrets; added `dotenv` |
| `am-client-portal-api/Dockerfile` | Unchanged (works with Coolify) |
| `am-client-portal-api/docker-compose.yml` | Simplified, removed Traefik labels |
| `am-client-portal-api/.env.example` | Created |
| `am-client-portal/Dockerfile` | Created (Nginx static server) |
| `am-client-portal/.dockerignore` | Created |
| `am-client-portal/dashboard.html` | Now calls `/api/client-invoices` instead of Netlify function |
| `am-client-portal-api/server.js` | Added `/api/client-invoices` endpoint |

---

## Post-Launch Checklist

- [ ] `https://client.advancedmarketing.co` shows login page
- [ ] `https://portal-api.advancedmarketing.co/api/health` returns OK
- [ ] Admin login works
- [ ] Dashboard loads tasks, invoices, documents
- [ ] Support tickets send email notifications
- [ ] Stripe invoices display correctly
- [ ] Document upload/download works
