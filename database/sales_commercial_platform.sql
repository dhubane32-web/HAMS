-- Hawana Airways Management System (HAMS) — Sales & Commercial Platform v1
-- Idempotent extensions. Run after sales_marketing.sql + schema.sql.

-- ---------------------------------------------------------------------------
-- Distribution: sales channels (every booking must reference by code)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_sales_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  default_commission_pct NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (default_commission_pct >= 0 AND default_commission_pct <= 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sm_sales_channels (code, name, default_commission_pct) VALUES
  ('DIRECT_WEB', 'Website direct', 0),
  ('MOBILE_APP', 'Mobile app', 0),
  ('AGENT_PORTAL', 'Travel agent portal', 7),
  ('CORPORATE_PORTAL', 'Corporate portal', 3),
  ('API', 'API partner', 5),
  ('OTA', 'Online travel agency', 12),
  ('GDS_PREP', 'GDS (preparation)', 10),
  ('CALL_CENTER', 'Call center', 0)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sales_channel_code VARCHAR(40) NOT NULL DEFAULT 'DIRECT_WEB';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS corporate_account_id UUID REFERENCES sales_corporate_customers(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS travel_agent_id UUID REFERENCES sales_travel_agents(id);

CREATE INDEX IF NOT EXISTS idx_bookings_sales_channel ON bookings(sales_channel_code);
CREATE INDEX IF NOT EXISTS idx_bookings_corporate ON bookings(corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_bookings_travel_agent ON bookings(travel_agent_id);

-- ---------------------------------------------------------------------------
-- Corporate accounts (extends sales_corporate_customers)
-- ---------------------------------------------------------------------------
ALTER TABLE sales_corporate_customers ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE sales_corporate_customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14, 2);
ALTER TABLE sales_corporate_customers ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(14, 2);
ALTER TABLE sales_corporate_customers ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(40);
ALTER TABLE sales_corporate_customers ADD COLUMN IF NOT EXISTS billing_cycle_days INT CHECK (billing_cycle_days IS NULL OR billing_cycle_days > 0);
ALTER TABLE sales_corporate_customers ADD COLUMN IF NOT EXISTS travel_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sales_corporate_customers ADD COLUMN IF NOT EXISTS fare_agreement_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS sm_corporate_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  corporate_id UUID NOT NULL REFERENCES sales_corporate_customers(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  discount_percent NUMERIC(6, 3) CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  contract_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_corporate_contracts_dates CHECK (valid_until >= valid_from)
);

CREATE TABLE IF NOT EXISTS sm_corporate_travelers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  corporate_id UUID NOT NULL REFERENCES sales_corporate_customers(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
  employee_ref VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (corporate_id, passenger_id)
);

-- ---------------------------------------------------------------------------
-- Travel agents — approval & credit
-- ---------------------------------------------------------------------------
ALTER TABLE sales_travel_agents ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'APPROVED';
ALTER TABLE sales_travel_agents ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14, 2);
ALTER TABLE sales_travel_agents ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(14, 2);
ALTER TABLE sales_travel_agents ADD COLUMN IF NOT EXISTS debt_balance NUMERIC(14, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_travel_agents_approval_check') THEN
    ALTER TABLE sales_travel_agents
      ADD CONSTRAINT sales_travel_agents_approval_check
      CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Commission engine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_commission_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_type VARCHAR(24) NOT NULL,
  channel_code VARCHAR(40) REFERENCES sm_sales_channels(code),
  origin_airport VARCHAR(10),
  dest_airport VARCHAR(10),
  promo_code_id UUID REFERENCES sales_promo_codes(id),
  commission_percent NUMERIC(8, 4) NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
  priority INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_commission_rules_type CHECK (rule_type IN ('STANDARD', 'ROUTE', 'PROMO', 'VOLUME', 'OVERRIDE', 'BONUS'))
);

CREATE TABLE IF NOT EXISTS sm_agent_commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  travel_agent_id UUID REFERENCES sales_travel_agents(id),
  channel_code VARCHAR(40) REFERENCES sm_sales_channels(code),
  base_amount NUMERIC(14, 2) NOT NULL,
  commission_rate NUMERIC(8, 4) NOT NULL,
  commission_amount NUMERIC(14, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'ACCRUED',
  rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_agent_commissions_booking ON sm_agent_commissions(booking_id);
CREATE INDEX IF NOT EXISTS idx_sm_agent_commissions_agent ON sm_agent_commissions(travel_agent_id);

-- ---------------------------------------------------------------------------
-- Promo usage log (per booking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_promo_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code_id UUID NOT NULL REFERENCES sales_promo_codes(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promo_code_id, booking_id)
);

-- ---------------------------------------------------------------------------
-- CRM profiles (passenger-centric; auto-sync from bookings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_crm_customers (
  passenger_id UUID PRIMARY KEY REFERENCES passengers(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  segment_tag VARCHAR(80),
  total_spend NUMERIC(14, 2) NOT NULL DEFAULT 0,
  booking_count INT NOT NULL DEFAULT 0,
  preferred_routes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  complaint_count INT NOT NULL DEFAULT 0,
  last_booking_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_crm_customers_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'VIP'))
);

CREATE INDEX IF NOT EXISTS idx_sm_crm_customers_status ON sm_crm_customers(status);

-- ---------------------------------------------------------------------------
-- Loyalty
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_loyalty_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id UUID NOT NULL UNIQUE REFERENCES passengers(id) ON DELETE CASCADE,
  miles_balance INT NOT NULL DEFAULT 0 CHECK (miles_balance >= 0),
  tier VARCHAR(20) NOT NULL DEFAULT 'SILVER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_loyalty_tier CHECK (tier IN ('SILVER', 'GOLD', 'PLATINUM'))
);

CREATE TABLE IF NOT EXISTS sm_loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loyalty_account_id UUID NOT NULL REFERENCES sm_loyalty_accounts(id) ON DELETE CASCADE,
  txn_type VARCHAR(16) NOT NULL,
  miles INT NOT NULL,
  booking_id UUID REFERENCES bookings(id),
  description VARCHAR(500),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_loyalty_txn_type CHECK (txn_type IN ('EARN', 'REDEEM', 'ADJUST', 'EXPIRE'))
);

CREATE INDEX IF NOT EXISTS idx_sm_loyalty_txn_account ON sm_loyalty_transactions(loyalty_account_id);

-- ---------------------------------------------------------------------------
-- Ancillaries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_ancillary_products (
  code VARCHAR(40) PRIMARY KEY,
  label VARCHAR(160) NOT NULL,
  category VARCHAR(40) NOT NULL,
  default_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO sm_ancillary_products (code, label, category, default_price) VALUES
  ('XBAG', 'Extra baggage', 'BAGGAGE', 35),
  ('SEAT', 'Seat selection', 'SEAT', 15),
  ('PRIO', 'Priority boarding', 'SERVICE', 25),
  ('MEAL', 'Meal', 'CATERING', 12),
  ('CHGFEE', 'Change fee', 'FEE', 75),
  ('UPGFEE', 'Upgrade fee', 'UPGRADE', 120)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS sm_ancillary_sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  product_code VARCHAR(40) NOT NULL REFERENCES sm_ancillary_products(code),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_ancillary_sales_booking ON sm_ancillary_sales(booking_id);

-- ---------------------------------------------------------------------------
-- Revenue management — fare families & flight bucket inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_fare_families (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  cabin VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO sm_fare_families (code, name, cabin, sort_order) VALUES
  ('ECON_SAVER', 'Economy Saver', 'ECONOMY', 10),
  ('ECON_FLEX', 'Economy Flex', 'ECONOMY', 20),
  ('BUSINESS', 'Business', 'BUSINESS', 30)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS sm_fare_class_family_map (
  fare_class_id UUID NOT NULL REFERENCES md_fare_classes(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES sm_fare_families(id) ON DELETE CASCADE,
  PRIMARY KEY (fare_class_id)
);

CREATE TABLE IF NOT EXISTS sm_rm_flight_bucket (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  fare_class_id UUID NOT NULL REFERENCES md_fare_classes(id) ON DELETE CASCADE,
  seats_allocated INT NOT NULL DEFAULT 0 CHECK (seats_allocated >= 0),
  seats_sold INT NOT NULL DEFAULT 0 CHECK (seats_sold >= 0),
  bucket_open BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flight_id, fare_class_id)
);

CREATE INDEX IF NOT EXISTS idx_sm_rm_flight_bucket_flight ON sm_rm_flight_bucket(flight_id);

CREATE TABLE IF NOT EXISTS sm_seasonal_route_fare (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_airport VARCHAR(10) NOT NULL,
  dest_airport VARCHAR(10) NOT NULL,
  fare_class_id UUID REFERENCES md_fare_classes(id) ON DELETE SET NULL,
  season_start DATE NOT NULL,
  season_end DATE NOT NULL,
  fare_multiplier NUMERIC(8, 4) NOT NULL DEFAULT 1 CHECK (fare_multiplier > 0),
  notes VARCHAR(500),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_seasonal_route_fare_dates CHECK (season_end >= season_start)
);

CREATE TABLE IF NOT EXISTS sm_dynamic_pricing_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(160) NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  adjustment_type VARCHAR(16) NOT NULL DEFAULT 'PERCENT',
  adjustment_value NUMERIC(12, 4) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_dyn_adj_type CHECK (adjustment_type IN ('PERCENT', 'FIXED_AMOUNT'))
);

CREATE TABLE IF NOT EXISTS sm_rm_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  load_factor_close_bucket NUMERIC(5, 2) NOT NULL DEFAULT 0.78,
  load_factor_open_upper NUMERIC(5, 2) NOT NULL DEFAULT 0.55,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sm_rm_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Marketing automation (stubs — outbound dispatch wired later)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trigger_code VARCHAR(48) NOT NULL,
  channel VARCHAR(16) NOT NULL DEFAULT 'EMAIL',
  campaign_id UUID REFERENCES sales_campaigns(id),
  template_key VARCHAR(120),
  schedule_cron VARCHAR(80),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_automation_channel CHECK (channel IN ('EMAIL', 'SMS', 'SOCIAL'))
);

CREATE TABLE IF NOT EXISTS sm_lead_followups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  remind_at TIMESTAMPTZ NOT NULL,
  note VARCHAR(2000),
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Lead pipeline — add NEGOTIATION stage
-- ---------------------------------------------------------------------------
ALTER TABLE sales_leads DROP CONSTRAINT IF EXISTS sales_leads_status_check;
ALTER TABLE sales_leads ADD CONSTRAINT sales_leads_status_check CHECK (
  status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST')
);

-- ---------------------------------------------------------------------------
-- Route profitability cache (optional nightly ETL; store snapshots)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_route_profitability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  origin_airport VARCHAR(10) NOT NULL,
  dest_airport VARCHAR(10) NOT NULL,
  revenue NUMERIC(16, 2) NOT NULL DEFAULT 0,
  cost_estimate NUMERIC(16, 2) NOT NULL DEFAULT 0,
  bookings INT NOT NULL DEFAULT 0,
  passengers INT NOT NULL DEFAULT 0,
  load_factor NUMERIC(8, 4),
  yield_per_pax NUMERIC(14, 4),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_start, period_end, origin_airport, dest_airport)
);

-- ---------------------------------------------------------------------------
-- Fare rules (editable commercial rules per fare class / route pattern)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_fare_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fare_class_id UUID REFERENCES md_fare_classes(id) ON DELETE CASCADE,
  rule_key VARCHAR(80) NOT NULL,
  rule_value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_fare_rules_class ON sm_fare_rules(fare_class_id);

-- ---------------------------------------------------------------------------
-- RBD inventory seed (Y,B,M,K,Q,V,L) — map to Economy/Business buckets
-- ---------------------------------------------------------------------------
INSERT INTO md_fare_classes (code, name, booking_class, description, is_active)
SELECT v.code, v.name, v.cabin::varchar, v.desc, TRUE
FROM (VALUES
  ('Y', 'Economy Flex (Y)', 'ECONOMY', 'Full-flex economy RBD'),
  ('B', 'Economy Flex (B)', 'ECONOMY', 'Economy flex bucket'),
  ('M', 'Economy Flex (M)', 'ECONOMY', 'Economy flex bucket'),
  ('K', 'Economy Saver (K)', 'ECONOMY', 'Economy saver bucket'),
  ('Q', 'Economy Saver (Q)', 'ECONOMY', 'Economy saver bucket'),
  ('V', 'Economy Saver (V)', 'ECONOMY', 'Economy saver bucket'),
  ('L', 'Economy Saver (L)', 'ECONOMY', 'Deep saver bucket'),
  ('J', 'Business (J)', 'BUSINESS', 'Business full fare')
) AS v(code, name, cabin, desc)
WHERE NOT EXISTS (SELECT 1 FROM md_fare_classes f WHERE upper(f.code) = upper(v.code));

INSERT INTO sm_fare_class_family_map (fare_class_id, family_id)
SELECT f.id, fam.id
FROM md_fare_classes f
JOIN sm_fare_families fam ON (
  (f.code IN ('Y','B','M') AND fam.code = 'ECON_FLEX')
  OR (f.code IN ('K','Q','V','L') AND fam.code = 'ECON_SAVER')
  OR (upper(f.code) = 'ECON' AND fam.code = 'ECON_SAVER')
  OR (upper(f.code) = 'FLEX' AND fam.code = 'ECON_FLEX')
  OR (f.code = 'J' AND fam.code = 'BUSINESS')
)
ON CONFLICT (fare_class_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Views for channel revenue & exec KPIs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW sm_v_channel_revenue AS
SELECT
  COALESCE(NULLIF(trim(b.sales_channel_code), ''), 'DIRECT_WEB') AS channel,
  COUNT(*)::int AS bookings,
  COALESCE(SUM(b.total_amount), 0)::numeric AS gross_booked,
  COALESCE(SUM(CASE WHEN upper(trim(b.payment_status)) = 'PAID' THEN b.total_amount ELSE 0 END), 0)::numeric AS paid_revenue
FROM bookings b
WHERE upper(trim(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
GROUP BY 1;

CREATE OR REPLACE VIEW sm_v_route_sales AS
SELECT
  upper(trim(f.departure_airport)) AS origin,
  upper(trim(f.arrival_airport)) AS dest,
  COUNT(DISTINCT b.id)::int AS bookings,
  COALESCE(SUM(bf.fare_amount), 0)::numeric AS itinerary_fare_sum
FROM booking_flights bf
JOIN flights f ON f.id = bf.flight_id
JOIN bookings b ON b.id = bf.booking_id
WHERE upper(trim(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
GROUP BY 1, 2;
