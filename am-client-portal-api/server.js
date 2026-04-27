require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'cloudcomputer',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'client_portal',
});

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// ============ DATABASE INIT ============

async function initDatabase() {
  try {
    // Create tables
    await pool.query(`
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
      )
    `);

    await pool.query(`
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_data TEXT NOT NULL,
        document_type VARCHAR(50) DEFAULT 'other',
        uploaded_by VARCHAR(50) DEFAULT 'client',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        subject VARCHAR(500),
        status VARCHAR(50) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_messages (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        sender_type VARCHAR(50) NOT NULL,
        sender_name VARCHAR(255),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
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
      )
    `);

    await pool.query(`
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS goal_checkins (
        id SERIAL PRIMARY KEY,
        goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
        day_number INTEGER NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP,
        notes TEXT
      )
    `);

    await pool.query(`
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS publications (
        id SERIAL PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        genre VARCHAR(100),
        price DECIMAL(10,2),
        domain_authority INTEGER,
        url VARCHAR(500),
        notes TEXT
      )
    `);

    // Auto-create admin if env vars provided and no admins exist
    const { rows: admins } = await pool.query("SELECT * FROM clients WHERE is_admin = true LIMIT 1");
    if (!admins.length && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await pool.query(
        'INSERT INTO clients (name, email, password_hash, business_name, is_admin, role) VALUES ($1, $2, $3, $4, $5, $6)',
        [process.env.ADMIN_NAME || 'Admin', process.env.ADMIN_EMAIL.toLowerCase().trim(), hash, 'Advanced Marketing', true, 'admin']
      );
      console.log('✅ Admin user created:', process.env.ADMIN_EMAIL);
    }

    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
  }
}

// JWT helpers
function createJWT(payload, expiresInMin) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInMin * 60 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

function verifyJWT(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(parts[0] + '.' + parts[1]).digest('base64url');
  if (sig !== parts[2]) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// Auth middleware
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const payload = verifyJWT(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  req.user = payload;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user.is_admin && req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function adminOrRep(req, res, next) {
  if (!req.user.is_admin && req.user.role !== 'admin' && req.user.role !== 'sales_rep') return res.status(403).json({ error: 'Access denied' });
  next();
}

// ============ AUTH ============

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await pool.query('SELECT * FROM clients WHERE email = $1', [email.toLowerCase().trim()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const client = rows[0];
    if (!client.password_hash) return res.status(401).json({ error: 'No password set. Contact support.' });

    const valid = await bcrypt.compare(password, client.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const role = client.role || (client.is_admin ? 'admin' : 'client');
    const token = createJWT({ clientId: client.id, email: client.email, is_admin: client.is_admin || role === 'admin', role }, 1440);
    res.json({ token, client: { id: client.id, name: client.name, email: client.email, business_name: client.business_name, service_type: client.service_type, is_admin: client.is_admin || role === 'admin', role } });
  } catch (err) { console.error('Login error:', err); res.status(500).json({ error: 'Server error' }); }
});

// Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, business_name } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO clients (name, email, password_hash, business_name) VALUES ($1, $2, $3, $4) RETURNING id, name, email, business_name, service_type, is_admin',
      [name.trim(), email.toLowerCase().trim(), hash, (business_name || '').trim()]
    );
    const client = rows[0];
    const token = createJWT({ clientId: client.id, email: client.email, is_admin: client.is_admin }, 1440);
    res.json({ token, client });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already registered' });
    console.error('Signup error:', err); res.status(500).json({ error: 'Server error' });
  }
});

// Magic link verify (for existing magic link flow)
app.post('/api/auth/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    const payload = verifyJWT(token);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
    const sessionToken = createJWT({ clientId: payload.clientId, email: payload.email, is_admin: payload.is_admin || false }, 1440);
    res.json({ token: sessionToken, clientId: payload.clientId, email: payload.email });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ CLIENT DATA ============

// Get current client profile
app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, business_name, service_type, onboarding_status, google_drive_folder_url, welcome_message_dismissed, is_admin, role, commission_rate, created_at FROM clients WHERE id = $1', [req.user.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Update client profile fields
app.patch('/api/me', auth, async (req, res) => {
  try {
    const allowed = ['google_drive_folder_url', 'welcome_message_dismissed', 'business_name'];
    const sets = []; const vals = []; let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = $${i}`); vals.push(req.body[key]); i++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.user.clientId);
    await pool.query(`UPDATE clients SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ TASKS ============

// Get tasks for current client
app.get('/api/tasks', auth, async (req, res) => {
  try {
    const clientId = req.query.client_id && req.user.is_admin ? req.query.client_id : req.user.clientId;
    const { rows } = await pool.query('SELECT * FROM tasks WHERE client_id = $1 ORDER BY assigned_to, sort_order', [clientId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Update task status (client can mark own tasks)
app.patch('/api/tasks/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'in_progress', 'complete'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    // If not admin, can only update own client-assigned tasks
    let query, params;
    if (req.user.is_admin) {
      query = 'UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *';
      params = [status, req.params.id];
    } else {
      query = "UPDATE tasks SET status = $1 WHERE id = $2 AND client_id = $3 AND assigned_to = 'client' RETURNING *";
      params = [status, req.params.id, req.user.clientId];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Task not found or not editable' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Add task (admin only)
app.post('/api/tasks', auth, adminOnly, async (req, res) => {
  try {
    const { client_id, title, assigned_to, description, due_date } = req.body;
    if (!client_id || !title || !assigned_to) return res.status(400).json({ error: 'client_id, title, assigned_to required' });
    const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM tasks WHERE client_id = $1 AND assigned_to = $2', [client_id, assigned_to]);
    const { rows } = await pool.query(
      'INSERT INTO tasks (client_id, title, assigned_to, description, due_date, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [client_id, title, assigned_to, description || '', due_date || null, maxRows[0].next]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Delete task (admin only)
app.delete('/api/tasks/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ DOCUMENTS ============

app.get('/api/documents', auth, async (req, res) => {
  try {
    const clientId = req.query.client_id && req.user.is_admin ? req.query.client_id : req.user.clientId;
    const { rows } = await pool.query('SELECT id, client_id, file_name, document_type, uploaded_by, created_at FROM documents WHERE client_id = $1 ORDER BY created_at DESC', [clientId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/documents', auth, async (req, res) => {
  try {
    const { file_name, file_data, document_type } = req.body;
    if (!file_name || !file_data) return res.status(400).json({ error: 'file_name and file_data required' });
    const clientId = req.body.client_id && req.user.is_admin ? req.body.client_id : req.user.clientId;
    const { rows } = await pool.query(
      'INSERT INTO documents (client_id, file_name, file_data, document_type, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, file_name, document_type, uploaded_by, created_at',
      [clientId, file_name, file_data, document_type || 'other', req.user.is_admin ? 'agency' : 'client']
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/documents/:id/download', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const doc = rows[0];
    // Check access
    if (!req.user.is_admin && doc.client_id !== req.user.clientId) return res.status(403).json({ error: 'Forbidden' });
    // file_data is base64
    const buf = Buffer.from(doc.file_data, 'base64');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/documents/:id', auth, async (req, res) => {
  try {
    const cond = req.user.is_admin ? '' : ' AND client_id = $2';
    const params = req.user.is_admin ? [req.params.id] : [req.params.id, req.user.clientId];
    await pool.query('DELETE FROM documents WHERE id = $1' + cond, params);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ PAYMENT AUTH ============

app.post('/api/payment-auth', auth, async (req, res) => {
  try {
    const { platform, cardholder_name, last_four_digits, card_brand, authorization_note } = req.body;
    if (!platform || !cardholder_name || !last_four_digits) return res.status(400).json({ error: 'Missing fields' });
    if (last_four_digits.length !== 4) return res.status(400).json({ error: 'last_four_digits must be 4 chars' });
    const { rows } = await pool.query(
      'INSERT INTO payment_authorizations (client_id, platform, cardholder_name, last_four_digits, card_brand, authorization_note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.clientId, platform, cardholder_name, last_four_digits, card_brand || '', authorization_note || '']
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ ADMIN ============

// List all clients (sales reps only see their own)
app.get('/api/admin/clients', auth, adminOrRep, async (req, res) => {
  try {
    let clientQuery = 'SELECT id, name, email, business_name, service_type, onboarding_status, is_admin, role, github_repo, hosting_url, hosting_type, server_ip, netlify_site_id, added_by, commission_rate, created_at FROM clients';
    const params = [];
    // Sales reps only see clients they added + their own record
    if (req.user.role === 'sales_rep') {
      clientQuery += ' WHERE (added_by = $1 OR id = $1) AND role = \'client\'';
      params.push(req.user.clientId);
    }
    clientQuery += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(clientQuery, params);
    // Get task counts per client
    const { rows: taskCounts } = await pool.query("SELECT client_id, COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'complete') as done FROM tasks GROUP BY client_id");
    const countMap = {};
    taskCounts.forEach(t => { countMap[t.client_id] = { total: parseInt(t.total), done: parseInt(t.done) }; });
    const clients = rows.map(c => ({ ...c, tasks: countMap[c.id] || { total: 0, done: 0 } }));
    res.json(clients);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Create new client (admin or sales rep)
app.post('/api/admin/clients', auth, adminOrRep, async (req, res) => {
  try {
    const { name, email, password, business_name, service_type } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    const hash = password ? await bcrypt.hash(password, 10) : null;
    const { rows } = await pool.query(
      'INSERT INTO clients (name, email, password_hash, business_name, service_type, added_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, email.toLowerCase().trim(), hash, business_name || '', service_type || 'web_design', req.user.clientId]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Update client (admin)
app.patch('/api/admin/clients/:id', auth, adminOnly, async (req, res) => {
  try {
    const allowed = ['name', 'email', 'business_name', 'service_type', 'onboarding_status', 'is_admin', 'github_repo', 'hosting_url', 'hosting_type', 'server_ip', 'netlify_site_id'];
    const sets = []; const vals = []; let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = $${i}`); vals.push(req.body[key]); i++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Get payment auths (admin)
app.get('/api/admin/payment-auths', auth, adminOnly, async (req, res) => {
  try {
    const where = req.query.client_id ? ' WHERE client_id = $1' : '';
    const params = req.query.client_id ? [req.query.client_id] : [];
    const { rows } = await pool.query('SELECT * FROM payment_authorizations' + where + ' ORDER BY submitted_at DESC', params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/admin/payment-auths/:id', auth, adminOnly, async (req, res) => {
  try {
    const { viewed_by_agency } = req.body;
    const { rows } = await pool.query('UPDATE payment_authorizations SET viewed_by_agency = $1 WHERE id = $2 RETURNING *', [viewed_by_agency, req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ STRIPE INVOICES ============

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');

// Create and send invoice
app.post('/api/admin/invoices', auth, adminOrRep, async (req, res) => {
  try {
    const { client_id, items, memo, due_days } = req.body;
    if (!client_id || !items || !items.length) return res.status(400).json({ error: 'client_id and items[] required' });

    const { rows } = await pool.query('SELECT email, name, business_name FROM clients WHERE id = $1', [client_id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    // Find or create Stripe customer
    const existing = await stripe.customers.list({ email: client.email, limit: 1 });
    let customerId;
    if (existing.data.length) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email: client.email, name: client.business_name || client.name });
      customerId = customer.id;
    }

    // Create draft invoice first
    const invoiceParams = { customer: customerId, collection_method: 'send_invoice', days_until_due: parseInt(due_days) || 14, auto_advance: true };
    if (memo) invoiceParams.description = memo;
    const invoice = await stripe.invoices.create(invoiceParams);

    // Attach line items to this specific invoice
    for (const item of items) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount: Math.round(parseFloat(item.amount) * 100),
        currency: 'usd',
        description: item.description || 'Service',
      });
    }

    // Finalize and send
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(finalized.id);

    res.json({ id: finalized.id, number: finalized.number, amount: finalized.amount_due / 100, status: finalized.status, hosted_url: finalized.hosted_invoice_url, pdf: finalized.invoice_pdf });
  } catch (err) {
    console.error('Invoice create error:', err);
    res.status(500).json({ error: err.message || 'Failed to create invoice' });
  }
});

// List invoices for a client
app.get('/api/admin/invoices', auth, adminOnly, async (req, res) => {
  try {
    const { client_id } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const { rows } = await pool.query('SELECT email FROM clients WHERE id = $1', [client_id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });

    const customers = await stripe.customers.list({ email: rows[0].email, limit: 1 });
    if (!customers.data.length) return res.json([]);

    const invoices = await stripe.invoices.list({ customer: customers.data[0].id, limit: 50 });
    res.json(invoices.data.map(i => ({
      id: i.id, number: i.number, amount: i.amount_due / 100, amount_paid: i.amount_paid / 100,
      status: i.status, created: new Date(i.created * 1000).toISOString(),
      due_date: i.due_date ? new Date(i.due_date * 1000).toISOString() : null,
      hosted_url: i.hosted_invoice_url, pdf: i.invoice_pdf,
      description: i.description || (i.lines.data[0] && i.lines.data[0].description) || '',
    })));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch invoices' }); }
});

// Resend invoice
app.post('/api/admin/invoices/:id/resend', auth, adminOnly, async (req, res) => {
  try {
    await stripe.invoices.sendInvoice(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Void invoice
app.post('/api/admin/invoices/:id/void', auth, adminOnly, async (req, res) => {
  try {
    const invoice = await stripe.invoices.voidInvoice(req.params.id);
    res.json({ success: true, status: invoice.status });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to void invoice' }); }
});

// ============ CLIENT INVOICES (moved from Netlify function) ============

app.get('/api/client-invoices', auth, async (req, res) => {
  try {
    const customers = await stripe.customers.list({ email: req.user.email, limit: 1 });
    if (!customers.data.length) {
      return res.json({ invoices: [], payments: [] });
    }
    const customerId = customers.data[0].id;

    let invoices = [];
    try {
      const inv = await stripe.invoices.list({ customer: customerId, limit: 50 });
      invoices = inv.data.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        amount: i.amount_due / 100,
        amountPaid: i.amount_paid / 100,
        currency: i.currency,
        created: new Date(i.created * 1000).toISOString(),
        dueDate: i.due_date ? new Date(i.due_date * 1000).toISOString() : null,
        hostedUrl: i.hosted_invoice_url,
        pdf: i.invoice_pdf,
        description: i.description || (i.lines.data[0] && i.lines.data[0].description) || 'Invoice',
      }));
    } catch (e) {
      console.error('Invoice fetch error:', e);
    }

    let payments = [];
    try {
      const sessions = await stripe.checkout.sessions.list({ customer_email: req.user.email, limit: 50 });
      payments = sessions.data
        .filter((s) => s.payment_status === 'paid')
        .map((s) => ({
          id: s.id,
          amount: s.amount_total / 100,
          currency: s.currency,
          created: new Date(s.created * 1000).toISOString(),
          status: 'paid',
          description: s.metadata && s.metadata.invoice_number
            ? `Invoice #${s.metadata.invoice_number} - ${s.metadata.business_name || ''}`
            : s.metadata && s.metadata.business_name
            ? `Payment - ${s.metadata.business_name}`
            : 'Payment',
        }));
    } catch (e) {
      console.error('Sessions fetch error:', e);
    }

    res.json({ invoices, payments });
  } catch (err) {
    console.error('client-invoices error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ ADD SERVICE (auto-populate tasks) ============

const TASK_TEMPLATES = {
  web_design: {
    client: ['Create a shared Google Drive folder and paste the link in your portal','Upload your logo (PNG or SVG preferred)','Write a short description of your business','List your main services or products','Upload any photos or images you want on the site','Review and approve the website sitemap','Review and approve the design mockup','Provide any feedback on the first draft'],
    agency: ['Send client the onboarding welcome email','Review uploaded assets and confirm what is missing','Build out sitemap and share with client','Design homepage mockup in Figma','Build out full site in staging environment','Conduct QA and cross-browser testing','Launch site and transfer DNS'],
  },
  facebook_ads: {
    client: ['Add a payment method to your Meta Business Suite account','Confirm your Facebook Business Page URL','Provide your target audience details (age, location, interests)','Approve the first set of ad creatives','Share any existing customer testimonials or success stories'],
    agency: ['Set up Meta Business Manager and ad account','Install Facebook Pixel on client website','Build custom audiences and lookalike audiences','Create first ad campaign drafts','Share ad creatives for client approval','Launch campaigns','Send first performance report at 7 days'],
  },
  google_ads: {
    client: ['Add a billing method to your Google Ads account','Confirm your website URL and main landing page','Provide your target keywords or main products/services','Confirm your service area or target locations','Approve ad copy drafts'],
    agency: ['Set up Google Ads account and link to Analytics','Set up conversion tracking','Conduct keyword research','Write ad copy for client approval','Build out campaign structure','Launch campaigns','Send first performance report at 7 days'],
  },
  seo: {
    client: ['Provide Google Analytics and Google Search Console access','Provide website admin/CMS login (or add agency as user)','Confirm target keywords and service areas','Approve on-page optimization changes before they go live','Provide any blog topics or industry FAQs you get from customers'],
    agency: ['Conduct full technical SEO audit','Conduct keyword research and mapping','Optimize meta titles and descriptions site-wide','Fix technical issues (crawl errors, speed, schema)','Build out first 4 blog posts','Submit sitemap to Google Search Console','Send 30-day ranking report'],
  },
  gohighlevel: {
    client: ['Confirm your business name, phone number, and address for GHL setup','Provide your logo and brand colors','Connect your domain or confirm subdomain preference','Review your pipeline stages and confirm workflow','Set up your GHL mobile app (agency will send invite)','Review and approve automated follow-up sequences'],
    agency: ['Create GHL sub-account for client','Configure pipeline and opportunity stages','Set up automated lead follow-up sequences','Build appointment booking calendar','Set up reputation management (review requests)','Configure reporting dashboard','Send client GHL login credentials and mobile app invite'],
  },
  press: {
    client: ['Provide your professional bio and headshot','List 3-5 key topics you can speak on as an expert','Share any previous media appearances or press coverage','Provide links to your social media profiles','Approve the press release draft (agency will provide)','Review and approve media pitch angles'],
    agency: ['Research target publications and journalists','Write press release draft','Build media contact list','Create press kit with bio, headshot, and talking points','Pitch to journalists and media outlets','Send placement report with links to coverage','Distribute press release via wire service'],
  },
  coaching: {
    client: ['Complete the business intake questionnaire','Share your current revenue numbers and goals','Provide access to your analytics dashboards','List your top 3 business challenges','Come prepared with questions for your first call'],
    agency: ['Review client business model and current metrics','Prepare initial audit of sales process and operations','Identify automation opportunities','Create a strategic action plan for first 30 days','Schedule recurring weekly coaching calls'],
  },
};

// Add a service to a client (creates tasks, optionally updates service_type)
app.post('/api/admin/clients/:id/add-service', auth, adminOnly, async (req, res) => {
  try {
    const { service_type } = req.body;
    if (!TASK_TEMPLATES[service_type]) return res.status(400).json({ error: 'Invalid service_type' });

    const clientId = req.params.id;

    // Don't overwrite primary service_type — tasks stack, primary stays

    // Get current max sort_order for this client
    const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) as mx FROM tasks WHERE client_id = $1', [clientId]);
    let order = parseInt(maxRows[0].mx) + 1;

    const template = TASK_TEMPLATES[service_type];
    const inserts = [];
    for (const title of template.client) {
      inserts.push(pool.query('INSERT INTO tasks (client_id, title, assigned_to, sort_order, description) VALUES ($1, $2, $3, $4, $5)', [clientId, title, 'client', order++, '']));
    }
    for (const title of template.agency) {
      inserts.push(pool.query('INSERT INTO tasks (client_id, title, assigned_to, sort_order, description) VALUES ($1, $2, $3, $4, $5)', [clientId, title, 'agency', order++, '']));
    }
    await Promise.all(inserts);

    res.json({ success: true, tasks_added: template.client.length + template.agency.length });
  } catch (err) {
    console.error('Add service error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DELETE CLIENT ============

app.delete('/api/admin/clients/:id', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    // Cancel any active Stripe subscriptions
    try {
      const customers = await stripe.customers.list({ email: client.email, limit: 1 });
      if (customers.data.length) {
        const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 50 });
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    } catch (e) { console.error('Stripe cleanup error:', e); }

    // Send termination email via Resend
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (process.env.RESEND_API_KEY || ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Advanced Marketing <hello@advancedmarketing.co>',
          to: [client.email],
          bcc: ['ben@advancedmarketing.co'],
          subject: 'Service Termination Notice — Advanced Marketing',
          html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#333;">' +
            '<img src="https://advancedmarketing.co/logo.png" alt="Advanced Marketing" style="height:40px;margin-bottom:24px;">' +
            '<h1 style="font-size:22px;color:#111;margin-bottom:16px;">Service Termination Notice</h1>' +
            '<p style="font-size:15px;line-height:1.7;margin-bottom:16px;">Dear ' + (client.name || 'Client') + ',</p>' +
            '<p style="font-size:15px;line-height:1.7;margin-bottom:16px;">This letter serves as formal notice that Advanced Marketing Limited is terminating our service agreement with ' + (client.business_name || 'your business') + ', effective immediately.</p>' +
            '<p style="font-size:15px;line-height:1.7;margin-bottom:16px;">Please note the following:</p>' +
            '<ul style="font-size:15px;line-height:1.7;margin-bottom:16px;padding-left:20px;">' +
              '<li>All active services and recurring billing have been cancelled.</li>' +
              '<li>Any outstanding invoices remain due per the original terms.</li>' +
              '<li>Your portal access has been deactivated.</li>' +
              '<li>Any files or assets you uploaded are available upon request for 30 days.</li>' +
            '</ul>' +
            '<p style="font-size:15px;line-height:1.7;margin-bottom:16px;">If you have questions about this termination or need to retrieve any assets, please contact us at <a href="mailto:ben@advancedmarketing.co" style="color:#c9a962;">ben@advancedmarketing.co</a>.</p>' +
            '<p style="font-size:15px;line-height:1.7;margin-bottom:16px;">We appreciate the opportunity to have worked with you and wish you continued success.</p>' +
            '<p style="font-size:15px;line-height:1.7;">Regards,<br><strong>Benjamin Boyce</strong><br>Advanced Marketing Limited</p>' +
            '<p style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:16px;margin-top:32px;">This is an automated notice from Advanced Marketing Limited. &copy; 2026</p>' +
          '</div>',
        }),
      });
    } catch (e) { console.error('Termination email error:', e); }

    // Delete from database (cascades to tasks, documents, payment_authorizations)
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);

    res.json({ success: true, message: 'Client deleted and termination notice sent to ' + client.email });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// ============ RECURRING SUBSCRIPTIONS ============

// Create a recurring subscription for a client
app.post('/api/admin/subscriptions', auth, adminOnly, async (req, res) => {
  try {
    const { client_id, description, amount, interval } = req.body;
    if (!client_id || !description || !amount) return res.status(400).json({ error: 'client_id, description, amount required' });

    const { rows } = await pool.query('SELECT email, name, business_name FROM clients WHERE id = $1', [client_id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    // Find or create Stripe customer
    const existing = await stripe.customers.list({ email: client.email, limit: 1 });
    let customerId;
    if (existing.data.length) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email: client.email, name: client.business_name || client.name });
      customerId = customer.id;
    }

    // Map billing frequency to Stripe interval + interval_count
    const intervalMap = {
      weekly: { interval: 'week', interval_count: 1 },
      monthly: { interval: 'month', interval_count: 1 },
      quarterly: { interval: 'month', interval_count: 3 },
      biannually: { interval: 'month', interval_count: 6 },
      annually: { interval: 'year', interval_count: 1 },
    };
    const freq = intervalMap[interval] || intervalMap.monthly;

    // Create product + price
    const product = await stripe.products.create({ name: description, metadata: { client_id, service_type: req.body.service_type || '' } });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(parseFloat(amount) * 100),
      currency: 'usd',
      recurring: { interval: freq.interval, interval_count: freq.interval_count },
    });

    // Build subscription params — send invoice each cycle, client pays via link
    const subParams = {
      customer: customerId,
      items: [{ price: price.id }],
      collection_method: 'send_invoice',
      days_until_due: parseInt(req.body.days_until_due) || 7,
      metadata: { client_id, service_type: req.body.service_type || '' },
    };

    // If a billing anchor date is provided, start billing on that date
    if (req.body.billing_anchor) {
      const anchor = new Date(req.body.billing_anchor);
      if (!isNaN(anchor.getTime())) {
        subParams.billing_cycle_anchor = Math.floor(anchor.getTime() / 1000);
        subParams.proration_behavior = 'none';
      }
    }

    const subscription = await stripe.subscriptions.create(subParams);

    res.json({
      id: subscription.id,
      status: subscription.status,
      amount: parseFloat(amount),
      interval: interval || 'monthly',
      description,
      current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    });
  } catch (err) {
    console.error('Subscription create error:', err);
    res.status(500).json({ error: err.message || 'Failed to create subscription' });
  }
});

// List subscriptions for a client
app.get('/api/admin/subscriptions', auth, adminOnly, async (req, res) => {
  try {
    const { client_id } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });

    const { rows } = await pool.query('SELECT email FROM clients WHERE id = $1', [client_id]);
    if (!rows.length) return res.json([]);

    const customers = await stripe.customers.list({ email: rows[0].email, limit: 1 });
    if (!customers.data.length) return res.json([]);

    const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, limit: 50, expand: ['data.items.data.price.product'] });
    res.json(subs.data.map(s => {
      const intv = s.items.data[0].price.recurring.interval;
      const intc = s.items.data[0].price.recurring.interval_count;
      let freq = intv;
      if (intv === 'month' && intc === 3) freq = 'quarterly';
      else if (intv === 'month' && intc === 6) freq = 'biannually';
      else if (intv === 'month' && intc === 1) freq = 'monthly';
      else if (intv === 'week') freq = 'weekly';
      else if (intv === 'year') freq = 'annually';
      return {
      id: s.id,
      status: s.status,
      amount: s.items.data[0].price.unit_amount / 100,
      interval: freq,
      description: s.items.data[0].price.product.name || '',
      current_period_end: new Date(s.current_period_end * 1000).toISOString(),
      created: new Date(s.created * 1000).toISOString(),
      cancel_at_period_end: s.cancel_at_period_end,
    }}));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch subscriptions' }); }
});

// Cancel a subscription
app.post('/api/admin/subscriptions/:id/cancel', auth, adminOnly, async (req, res) => {
  try {
    const sub = await stripe.subscriptions.update(req.params.id, { cancel_at_period_end: true });
    res.json({ success: true, cancel_at_period_end: sub.cancel_at_period_end });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ REVENUE REPORTING ============

// Get revenue for a single client
app.get('/api/admin/clients/:id/revenue', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT email FROM clients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });

    const customers = await stripe.customers.list({ email: rows[0].email, limit: 1 });
    if (!customers.data.length) return res.json({ lifetime: 0, mrr: 0, subscriptions: [] });
    const customerId = customers.data[0].id;

    // Lifetime revenue from charges
    let lifetime = 0;
    let hasMore = true;
    let startingAfter = null;
    while (hasMore) {
      const params = { customer: customerId, limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;
      const charges = await stripe.charges.list(params);
      charges.data.forEach(c => { if (c.paid && !c.refunded) lifetime += c.amount; });
      hasMore = charges.has_more;
      if (charges.data.length) startingAfter = charges.data[charges.data.length - 1].id;
    }

    // MRR from active subscriptions
    let mrr = 0;
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 50 });
    const subList = subs.data.map(s => {
      const amt = s.items.data[0].price.unit_amount / 100;
      const interval = s.items.data[0].price.recurring.interval;
      const monthlyAmt = interval === 'year' ? amt / 12 : (interval === 'week' ? amt * 4.33 : amt);
      mrr += monthlyAmt;
      return { id: s.id, amount: amt, interval, monthly: Math.round(monthlyAmt * 100) / 100 };
    });

    res.json({ lifetime: lifetime / 100, mrr: Math.round(mrr * 100) / 100, subscriptions: subList });
  } catch (err) {
    console.error('Client revenue error:', err);
    res.status(500).json({ error: 'Failed to fetch revenue' });
  }
});

// Company-wide revenue report
app.get('/api/admin/reports/revenue', auth, adminOnly, async (req, res) => {
  try {
    // Get all clients
    const { rows: clients } = await pool.query('SELECT id, email, name, business_name, service_type FROM clients WHERE is_admin = false');

    let totalLifetime = 0;
    let totalMrr = 0;
    const byService = {};
    const clientRevenue = [];

    for (const client of clients) {
      const customers = await stripe.customers.list({ email: client.email, limit: 1 });
      if (!customers.data.length) {
        clientRevenue.push({ id: client.id, name: client.business_name || client.name, email: client.email, service_type: client.service_type, lifetime: 0, mrr: 0 });
        continue;
      }
      const customerId = customers.data[0].id;

      // Lifetime
      let lifetime = 0;
      const charges = await stripe.charges.list({ customer: customerId, limit: 100 });
      charges.data.forEach(c => { if (c.paid && !c.refunded) lifetime += c.amount; });
      lifetime = lifetime / 100;

      // MRR
      let mrr = 0;
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 50 });
      subs.data.forEach(s => {
        const amt = s.items.data[0].price.unit_amount / 100;
        const interval = s.items.data[0].price.recurring.interval;
        mrr += interval === 'year' ? amt / 12 : (interval === 'week' ? amt * 4.33 : amt);
      });
      mrr = Math.round(mrr * 100) / 100;

      totalLifetime += lifetime;
      totalMrr += mrr;

      // By service
      const svc = client.service_type || 'other';
      if (!byService[svc]) byService[svc] = { lifetime: 0, mrr: 0, count: 0 };
      byService[svc].lifetime += lifetime;
      byService[svc].mrr += mrr;
      byService[svc].count++;

      clientRevenue.push({ id: client.id, name: client.business_name || client.name, email: client.email, service_type: client.service_type, lifetime, mrr });
    }

    // Sort clients by lifetime desc
    clientRevenue.sort((a, b) => b.lifetime - a.lifetime);

    res.json({
      total_lifetime: Math.round(totalLifetime * 100) / 100,
      total_mrr: Math.round(totalMrr * 100) / 100,
      total_clients: clients.length,
      by_service: byService,
      clients: clientRevenue,
    });
  } catch (err) {
    console.error('Revenue report error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ============ EXPENSES ============

app.get('/api/admin/expenses', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM expenses ORDER BY is_active DESC, category, name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/expenses', auth, adminOnly, async (req, res) => {
  try {
    const { name, category, amount, frequency, vendor, notes } = req.body;
    if (!name || !amount) return res.status(400).json({ error: 'name and amount required' });
    const { rows } = await pool.query(
      'INSERT INTO expenses (name, category, amount, frequency, vendor, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, category || 'software', amount, frequency || 'monthly', vendor || '', notes || '']
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/admin/expenses/:id', auth, adminOnly, async (req, res) => {
  try {
    const allowed = ['name', 'category', 'amount', 'frequency', 'vendor', 'notes', 'is_active'];
    const sets = []; const vals = []; let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = $${i}`); vals.push(req.body[key]); i++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/expenses/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// P&L summary
app.get('/api/admin/reports/pnl', auth, adminOnly, async (req, res) => {
  try {
    // Monthly expenses
    const { rows: expenses } = await pool.query('SELECT * FROM expenses WHERE is_active = true');
    let monthlyExpenses = 0;
    const byCategory = {};
    expenses.forEach(e => {
      let monthly = parseFloat(e.amount);
      if (e.frequency === 'quarterly') monthly = monthly / 3;
      else if (e.frequency === 'annually') monthly = monthly / 12;
      else if (e.frequency === 'one_time') monthly = 0; // don't count in recurring
      monthlyExpenses += monthly;
      const cat = e.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += monthly;
    });

    // One-time expenses this month
    let oneTimeThisMonth = 0;
    expenses.forEach(e => {
      if (e.frequency === 'one_time') {
        const created = new Date(e.created_at);
        const now = new Date();
        if (created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear()) {
          oneTimeThisMonth += parseFloat(e.amount);
        }
      }
    });

    // Revenue (MRR from Stripe)
    const { rows: clients } = await pool.query('SELECT id, email, service_type FROM clients WHERE is_admin = false');
    let totalMrr = 0;
    for (const client of clients) {
      try {
        const customers = await stripe.customers.list({ email: client.email, limit: 1 });
        if (!customers.data.length) continue;
        const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 50 });
        subs.data.forEach(s => {
          const amt = s.items.data[0].price.unit_amount / 100;
          const intv = s.items.data[0].price.recurring.interval;
          const intc = s.items.data[0].price.recurring.interval_count || 1;
          if (intv === 'year') totalMrr += amt / 12;
          else if (intv === 'week') totalMrr += amt * 4.33;
          else totalMrr += amt / intc * 1; // month
        });
      } catch (e) {}
    }

    const monthlyProfit = totalMrr - monthlyExpenses - oneTimeThisMonth;

    res.json({
      monthly_revenue: Math.round(totalMrr * 100) / 100,
      monthly_expenses: Math.round(monthlyExpenses * 100) / 100,
      one_time_this_month: Math.round(oneTimeThisMonth * 100) / 100,
      monthly_profit: Math.round(monthlyProfit * 100) / 100,
      margin: totalMrr > 0 ? Math.round((monthlyProfit / totalMrr) * 10000) / 100 : 0,
      expenses_by_category: byCategory,
      expense_count: expenses.length,
    });
  } catch (err) {
    console.error('P&L error:', err);
    res.status(500).json({ error: 'Failed to generate P&L' });
  }
});

// Churn report by service
app.get('/api/admin/reports/churn', auth, adminOnly, async (req, res) => {
  try {
    const { rows: clients } = await pool.query('SELECT id, email, service_type FROM clients WHERE is_admin = false');

    const churn = {};
    Object.keys({ web_design:1, facebook_ads:1, google_ads:1, seo:1, gohighlevel:1, press:1 }).forEach(svc => {
      churn[svc] = { total_clients: 0, active_subs: 0, canceled_subs: 0, churned_clients: 0 };
    });

    for (const client of clients) {
      const svc = client.service_type || 'web_design';
      if (!churn[svc]) churn[svc] = { total_clients: 0, active_subs: 0, canceled_subs: 0, churned_clients: 0 };
      churn[svc].total_clients++;

      try {
        const customers = await stripe.customers.list({ email: client.email, limit: 1 });
        if (!customers.data.length) continue;

        const activeSubs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 50 });
        const canceledSubs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'canceled', limit: 50 });

        churn[svc].active_subs += activeSubs.data.length;
        churn[svc].canceled_subs += canceledSubs.data.length;

        // Client is churned if they have canceled subs but no active subs
        if (canceledSubs.data.length > 0 && activeSubs.data.length === 0) {
          churn[svc].churned_clients++;
        }
      } catch (e) {}
    }

    // Calculate churn rates
    const result = {};
    Object.keys(churn).forEach(svc => {
      const c = churn[svc];
      const totalEver = c.active_subs + c.canceled_subs;
      result[svc] = {
        ...c,
        churn_rate: totalEver > 0 ? Math.round((c.canceled_subs / totalEver) * 10000) / 100 : 0,
        retention_rate: totalEver > 0 ? Math.round((c.active_subs / totalEver) * 10000) / 100 : 100,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Churn error:', err);
    res.status(500).json({ error: 'Failed to generate churn report' });
  }
});

// ============ PUBLICATIONS ============

// Search publications
app.get('/api/admin/publications', auth, adminOnly, async (req, res) => {
  try {
    const { q, genre, limit } = req.query;
    let query = 'SELECT * FROM publications';
    const params = [];
    const conditions = [];

    if (q) {
      params.push('%' + q.toLowerCase() + '%');
      conditions.push('LOWER(name) LIKE $' + params.length);
    }
    if (genre) {
      params.push(genre);
      conditions.push('genre = $' + params.length);
    }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY domain_authority DESC, price ASC';
    query += ' LIMIT ' + (parseInt(limit) || 100);

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Get publication genres for filter
app.get('/api/admin/publications/genres', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT DISTINCT genre FROM publications WHERE genre != '' ORDER BY genre");
    res.json(rows.map(r => r.genre));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Bill publication(s) to a client — creates a Stripe invoice with each pub as a line item
app.post('/api/admin/publications/bill', auth, adminOnly, async (req, res) => {
  try {
    const { client_id, publication_ids, due_days, price_overrides } = req.body;
    if (!client_id || !publication_ids || !publication_ids.length) return res.status(400).json({ error: 'client_id and publication_ids required' });

    // Get client
    const { rows: clientRows } = await pool.query('SELECT email, name, business_name FROM clients WHERE id = $1', [client_id]);
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRows[0];

    // Get publications
    const { rows: pubs } = await pool.query('SELECT * FROM publications WHERE id = ANY($1)', [publication_ids]);
    if (!pubs.length) return res.status(404).json({ error: 'No publications found' });

    // Find or create Stripe customer
    const existing = await stripe.customers.list({ email: client.email, limit: 1 });
    let customerId;
    if (existing.data.length) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email: client.email, name: client.business_name || client.name });
      customerId = customer.id;
    }

    // Create draft invoice
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: parseInt(due_days) || 7,
      description: 'Press Publication Placement' + (pubs.length > 1 ? 's' : ''),
    });

    // Add each publication as a line item (with optional price overrides, min 50% of list)
    let total = 0;
    for (const pub of pubs) {
      const listPrice = parseFloat(pub.price);
      const minPrice = Math.ceil(listPrice * 0.5);
      let finalPrice = listPrice;
      if (price_overrides && price_overrides[pub.id] !== undefined) {
        finalPrice = parseFloat(price_overrides[pub.id]);
        if (finalPrice < minPrice) finalPrice = minPrice; // enforce 50% floor
      }
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount: Math.round(finalPrice * 100),
        currency: 'usd',
        description: pub.name + (pub.genre ? ' (' + pub.genre + ')' : '') + ' — DA ' + pub.domain_authority,
      });
      total += finalPrice;
    }

    // Finalize and send
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(finalized.id);

    res.json({
      id: finalized.id,
      number: finalized.number,
      amount: finalized.amount_due / 100,
      publications: pubs.length,
      status: finalized.status,
      hosted_url: finalized.hosted_invoice_url,
    });
  } catch (err) {
    console.error('Publication billing error:', err);
    res.status(500).json({ error: err.message || 'Failed to create invoice' });
  }
});

// ============ TICKETS ============

// Client creates a ticket (from dashboard message form)
app.post('/api/tickets', auth, async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const clientId = req.user.clientId;

    // Get client name
    const { rows: cRows } = await pool.query('SELECT name FROM clients WHERE id = $1', [clientId]);
    const senderName = cRows[0]?.name || req.user.email;

    // Create ticket
    const { rows: tRows } = await pool.query(
      'INSERT INTO tickets (client_id, subject) VALUES ($1, $2) RETURNING *',
      [clientId, subject || 'Support Request']
    );
    const ticket = tRows[0];

    // Add first message
    await pool.query(
      'INSERT INTO ticket_messages (ticket_id, sender_type, sender_name, message) VALUES ($1, $2, $3, $4)',
      [ticket.id, 'client', senderName, message]
    );

    // Notify admin via email
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (process.env.RESEND_API_KEY || ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Client Portal <hello@advancedmarketing.co>',
          to: ['ben@advancedmarketing.co'],
          subject: 'New Ticket: ' + (subject || 'Support Request') + ' — ' + senderName,
          html: '<div style="font-family:sans-serif;padding:20px;"><h2>New Support Ticket</h2><p><strong>From:</strong> ' + senderName + ' (' + req.user.email + ')</p><p><strong>Subject:</strong> ' + (subject || 'Support Request') + '</p><div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">' + message.replace(/\n/g, '<br>') + '</div><a href="https://client.advancedmarketing.co/tickets.html" style="color:#c9a962;">View in Portal</a></div>',
        }),
      });
    } catch (e) {}

    res.json({ ticket, success: true });
  } catch (err) { console.error('Ticket create error:', err); res.status(500).json({ error: 'Server error' }); }
});

// Client gets their tickets
app.get('/api/tickets', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tickets WHERE client_id = $1 ORDER BY updated_at DESC', [req.user.clientId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Get messages for a ticket
app.get('/api/tickets/:id/messages', auth, async (req, res) => {
  try {
    // Verify access
    const { rows: tRows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
    if (!tRows.length) return res.status(404).json({ error: 'Not found' });
    if (!req.user.is_admin && req.user.role !== 'admin' && tRows[0].client_id !== req.user.clientId) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await pool.query('SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json({ ticket: tRows[0], messages: rows });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Client or admin adds a message to a ticket
app.post('/api/tickets/:id/messages', auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const { rows: tRows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
    if (!tRows.length) return res.status(404).json({ error: 'Not found' });
    const ticket = tRows[0];
    if (!req.user.is_admin && req.user.role !== 'admin' && ticket.client_id !== req.user.clientId) return res.status(403).json({ error: 'Forbidden' });

    const isAdmin = req.user.is_admin || req.user.role === 'admin';
    const { rows: cRows } = await pool.query('SELECT name, email FROM clients WHERE id = $1', [req.user.clientId]);
    const senderName = isAdmin ? 'Advanced Marketing' : (cRows[0]?.name || req.user.email);

    await pool.query(
      'INSERT INTO ticket_messages (ticket_id, sender_type, sender_name, message) VALUES ($1, $2, $3, $4)',
      [req.params.id, isAdmin ? 'agency' : 'client', senderName, message]
    );
    await pool.query('UPDATE tickets SET updated_at = now(), status = $1 WHERE id = $2', [isAdmin ? 'answered' : 'open', req.params.id]);

    // If admin replies, email the client
    if (isAdmin) {
      const { rows: clientRows } = await pool.query('SELECT name, email FROM clients WHERE id = $1', [ticket.client_id]);
      if (clientRows.length) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + (process.env.RESEND_API_KEY || ''), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Advanced Marketing <hello@advancedmarketing.co>',
              to: [clientRows[0].email],
              subject: 'Re: ' + ticket.subject + ' — Advanced Marketing',
              html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#333;"><img src="https://advancedmarketing.co/logo.png" alt="Advanced Marketing" style="height:36px;margin-bottom:20px;"><h2 style="font-size:18px;margin-bottom:12px;">New Reply to Your Ticket</h2><p style="font-size:14px;color:#666;margin-bottom:16px;"><strong>Subject:</strong> ' + ticket.subject + '</p><div style="background:#f5f5f5;padding:16px;border-radius:8px;border-left:3px solid #c9a962;margin-bottom:20px;font-size:15px;line-height:1.6;">' + message.replace(/\n/g, '<br>') + '</div><a href="https://client.advancedmarketing.co/dashboard.html" style="display:inline-block;background:#c9a962;color:#0a0a0a;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">View in Portal</a><p style="font-size:12px;color:#999;margin-top:24px;">Advanced Marketing Limited</p></div>',
            }),
          });
        } catch (e) {}
      }
    }

    res.json({ success: true });
  } catch (err) { console.error('Ticket reply error:', err); res.status(500).json({ error: 'Server error' }); }
});

// Admin: list all tickets
app.get('/api/admin/tickets', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.*, c.name as client_name, c.email as client_email, c.business_name,
        (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
      FROM tickets t JOIN clients c ON t.client_id = c.id
      ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, t.updated_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Admin: close/reopen ticket
app.patch('/api/admin/tickets/:id', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE tickets SET status = $1, updated_at = now() WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ SALES REPS ============

// Admin: create a sales rep
app.post('/api/admin/sales-reps', auth, adminOnly, async (req, res) => {
  try {
    const { name, email, password, commission_rate } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO clients (name, email, password_hash, business_name, role, commission_rate, is_admin) VALUES ($1, $2, $3, '', 'sales_rep', $4, false) RETURNING id, name, email, role, commission_rate",
      [name, email.toLowerCase().trim(), hash, parseFloat(commission_rate) || 20]
    );
    const rep = rows[0];

    // Auto-create a 30-day commission goal for the rep
    const commRate = parseFloat(commission_rate) || 20;
    const revenueTarget = 15000; // agency revenue target
    const commTarget = Math.round(revenueTarget * (commRate / 100));
    const salesTarget = Math.round(revenueTarget / 500); // assuming $500 avg deal

    const { rows: goalRows } = await pool.query(
      'INSERT INTO goals (title, target_value, unit, deadline, user_id) VALUES ($1, $2, $3, CURRENT_DATE + INTERVAL \'30 days\', $4) RETURNING id',
      [salesTarget + ' Sales in 30 Days — $' + commTarget.toLocaleString() + ' Commission', salesTarget, 'sales', rep.id]
    );
    // Create check-in circles
    for (let i = 1; i <= salesTarget; i++) {
      await pool.query('INSERT INTO goal_checkins (goal_id, day_number) VALUES ($1, $2)', [goalRows[0].id, i]);
    }

    res.json(rep);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: list sales reps
app.get('/api/admin/sales-reps', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, email, commission_rate, created_at FROM clients WHERE role = 'sales_rep' ORDER BY name");
    // Get client counts and MRR per rep
    for (const rep of rows) {
      const { rows: clients } = await pool.query('SELECT id, email FROM clients WHERE added_by = $1 AND role = $2', [rep.id, 'client']);
      rep.client_count = clients.length;
      let repMrr = 0;
      for (const c of clients) {
        try {
          const custs = await stripe.customers.list({ email: c.email, limit: 1 });
          if (!custs.data.length) continue;
          const subs = await stripe.subscriptions.list({ customer: custs.data[0].id, status: 'active', limit: 50 });
          subs.data.forEach(s => {
            const amt = s.items.data[0].price.unit_amount / 100;
            const intv = s.items.data[0].price.recurring.interval;
            const intc = s.items.data[0].price.recurring.interval_count || 1;
            repMrr += intv === 'year' ? amt / 12 : (intv === 'week' ? amt * 4.33 : amt / intc);
          });
        } catch (e) {}
      }
      rep.mrr = Math.round(repMrr * 100) / 100;
      rep.commission = Math.round(repMrr * (parseFloat(rep.commission_rate) / 100) * 100) / 100;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Sales rep: get own commission dashboard
app.get('/api/rep/dashboard', auth, async (req, res) => {
  try {
    if (req.user.role !== 'sales_rep') return res.status(403).json({ error: 'Not a sales rep' });
    const { rows: repRows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.user.clientId]);
    if (!repRows.length) return res.status(404).json({ error: 'Not found' });
    const rep = repRows[0];

    const { rows: clients } = await pool.query('SELECT id, name, email, business_name, service_type, created_at FROM clients WHERE added_by = $1 AND role = $2', [req.user.clientId, 'client']);
    let totalMrr = 0;
    let totalLifetime = 0;
    for (const c of clients) {
      try {
        const custs = await stripe.customers.list({ email: c.email, limit: 1 });
        if (!custs.data.length) continue;
        const subs = await stripe.subscriptions.list({ customer: custs.data[0].id, status: 'active', limit: 50 });
        subs.data.forEach(s => {
          const amt = s.items.data[0].price.unit_amount / 100;
          const intv = s.items.data[0].price.recurring.interval;
          const intc = s.items.data[0].price.recurring.interval_count || 1;
          totalMrr += intv === 'year' ? amt / 12 : (intv === 'week' ? amt * 4.33 : amt / intc);
        });
        const charges = await stripe.charges.list({ customer: custs.data[0].id, limit: 100 });
        charges.data.forEach(ch => { if (ch.paid && !ch.refunded) totalLifetime += ch.amount / 100; });
      } catch (e) {}
    }

    const commRate = parseFloat(rep.commission_rate) || 20;
    res.json({
      rep: { name: rep.name, email: rep.email, commission_rate: commRate },
      clients,
      total_mrr: Math.round(totalMrr * 100) / 100,
      total_lifetime: Math.round(totalLifetime * 100) / 100,
      monthly_commission: Math.round(totalMrr * (commRate / 100) * 100) / 100,
      lifetime_commission: Math.round(totalLifetime * (commRate / 100) * 100) / 100,
    });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ GOALS & ACCOUNTABILITY ============

// List goals (scoped to user — admins see their own, reps see their own)
app.get('/api/admin/goals', auth, adminOrRep, async (req, res) => {
  try {
    const { rows: goals } = await pool.query('SELECT * FROM goals WHERE user_id IS NULL OR user_id = $1 ORDER BY is_active DESC, deadline ASC', [req.user.clientId]);
    for (const g of goals) {
      const { rows: checkins } = await pool.query('SELECT * FROM goal_checkins WHERE goal_id = $1 ORDER BY day_number', [g.id]);
      g.checkins = checkins;
      g.completed_count = checkins.filter(c => c.completed).length;
    }
    res.json(goals);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Create goal
app.post('/api/admin/goals', auth, adminOnly, async (req, res) => {
  try {
    const { title, target_value, unit, deadline, checkin_count } = req.body;
    if (!title || !target_value) return res.status(400).json({ error: 'title and target_value required' });
    const { rows } = await pool.query(
      'INSERT INTO goals (title, target_value, unit, deadline, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, target_value, unit || 'units', deadline || null, req.user.clientId]
    );
    const goal = rows[0];
    const count = parseInt(checkin_count) || parseInt(target_value) || 30;
    for (let i = 1; i <= count; i++) {
      await pool.query('INSERT INTO goal_checkins (goal_id, day_number) VALUES ($1, $2)', [goal.id, i]);
    }
    res.json(goal);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Toggle a check-in
app.patch('/api/admin/goals/checkin/:id', auth, adminOrRep, async (req, res) => {
  try {
    const { completed, notes } = req.body;
    const updates = [];
    const vals = [];
    let i = 1;
    if (completed !== undefined) { updates.push('completed = $' + i); vals.push(completed); i++; updates.push('completed_at = $' + i); vals.push(completed ? new Date().toISOString() : null); i++; }
    if (notes !== undefined) { updates.push('notes = $' + i); vals.push(notes); i++; }
    vals.push(req.params.id);
    const { rows } = await pool.query('UPDATE goal_checkins SET ' + updates.join(', ') + ' WHERE id = $' + i + ' RETURNING *', vals);
    // Update goal current_value
    if (rows.length) {
      await pool.query('UPDATE goals SET current_value = (SELECT COUNT(*) FROM goal_checkins WHERE goal_id = $1 AND completed = true) WHERE id = $1', [rows[0].goal_id]);
    }
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Delete goal
app.delete('/api/admin/goals/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM goals WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Daily logs (per user)
app.get('/api/admin/daily-logs', auth, adminOrRep, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM daily_logs WHERE user_id = $1 ORDER BY log_date DESC LIMIT 60', [req.user.clientId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/daily-logs', auth, adminOrRep, async (req, res) => {
  try {
    const { log_date, calls_made, pitches_given, deals_closed, revenue_closed, mrr_added, notes } = req.body;
    const date = log_date || new Date().toISOString().split('T')[0];
    const userId = req.user.clientId;
    const { rows } = await pool.query(
      `INSERT INTO daily_logs (log_date, user_id, calls_made, pitches_given, deals_closed, revenue_closed, mrr_added, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, log_date) DO UPDATE SET calls_made=$3, pitches_given=$4, deals_closed=$5, revenue_closed=$6, mrr_added=$7, notes=$8
       RETURNING *`,
      [date, userId, calls_made || 0, pitches_given || 0, deals_closed || 0, revenue_closed || 0, mrr_added || 0, notes || '']
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ SETTINGS ============

app.get('/api/admin/settings', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings ORDER BY key');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/admin/settings', auth, adminOnly, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await pool.query('INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [key, value]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============ HEALTH ============
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;

initDatabase().then(() => {
  app.listen(PORT, () => console.log(`Client Portal API running on port ${PORT}`));
});
