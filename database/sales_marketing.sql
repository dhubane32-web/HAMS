-- Sales & marketing: leads, B2B, campaigns, promo codes, segments. Run after schema.sql.

CREATE TABLE IF NOT EXISTS sales_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  channel VARCHAR(80),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  budget_amount NUMERIC(14, 2),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  utm_source VARCHAR(120),
  utm_medium VARCHAR(120),
  utm_campaign VARCHAR(160),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_campaigns_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_sales_campaigns_dates ON sales_campaigns(start_date, end_date);

CREATE TABLE IF NOT EXISTS sales_promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) NOT NULL,
  description VARCHAR(500),
  discount_type VARCHAR(20) NOT NULL,
  discount_value NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  usage_limit INT NOT NULL CHECK (usage_limit >= 1),
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_promo_codes_type_check CHECK (discount_type IN ('PERCENT', 'FIXED_AMOUNT')),
  CONSTRAINT sales_promo_codes_dates_check CHECK (valid_until >= valid_from),
  CONSTRAINT sales_promo_codes_usage_check CHECK (used_count <= usage_limit)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_promo_codes_code_uidx ON sales_promo_codes (upper(code));

CREATE TABLE IF NOT EXISTS sales_route_promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code_id UUID NOT NULL REFERENCES sales_promo_codes(id) ON DELETE CASCADE,
  origin_airport VARCHAR(10) NOT NULL,
  dest_airport VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promo_code_id, origin_airport, dest_airport)
);

CREATE INDEX IF NOT EXISTS idx_sales_route_promos_promo ON sales_route_promotions(promo_code_id);

CREATE TABLE IF NOT EXISTS sales_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(200),
  contact_name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(40),
  source VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'NEW',
  expected_value NUMERIC(14, 2),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  assigned_to UUID REFERENCES users(id),
  campaign_id UUID REFERENCES sales_campaigns(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_leads_status_check CHECK (
    status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST')
  )
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_status ON sales_leads(status);
CREATE INDEX IF NOT EXISTS idx_sales_leads_campaign ON sales_leads(campaign_id);

CREATE TABLE IF NOT EXISTS sales_corporate_customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  legal_name VARCHAR(200) NOT NULL,
  tax_id VARCHAR(80),
  billing_email VARCHAR(150),
  phone VARCHAR(40),
  default_discount_percent NUMERIC(5, 2) CHECK (default_discount_percent IS NULL OR (default_discount_percent >= 0 AND default_discount_percent <= 100)),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_travel_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(200) NOT NULL,
  contact_name VARCHAR(150),
  email VARCHAR(150),
  phone VARCHAR(40),
  iata_code VARCHAR(20),
  user_id UUID REFERENCES users(id),
  commission_percent NUMERIC(5, 2) CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100)),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_travel_agents_user ON sales_travel_agents(user_id);

CREATE TABLE IF NOT EXISTS sales_customer_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  description TEXT,
  rules_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_segment_members (
  segment_id UUID NOT NULL REFERENCES sales_customer_segments(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (segment_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_segment_members_passenger ON sales_segment_members(passenger_id);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES sales_promo_codes(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES sales_campaigns(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS promo_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
