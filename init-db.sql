-- Advanced Marketing — Client Portal Database Schema
-- Run this once on your PostgreSQL instance, or let the API auto-create tables on first boot

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

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_data TEXT NOT NULL,
  document_type VARCHAR(50) DEFAULT 'other',
  uploaded_by VARCHAR(50) DEFAULT 'client',
  created_at TIMESTAMP DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  subject VARCHAR(500),
  status VARCHAR(50) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  sender_type VARCHAR(50) NOT NULL,
  sender_name VARCHAR(255),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS goal_checkins (
  id SERIAL PRIMARY KEY,
  goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  notes TEXT
);

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

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS publications (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  genre VARCHAR(100),
  price DECIMAL(10,2),
  domain_authority INTEGER,
  url VARCHAR(500),
  notes TEXT
);
