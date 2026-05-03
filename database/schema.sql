CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'finance', 'operations', 'agent', 'crew', 'maintenance');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aircraft (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tail_number VARCHAR(20) UNIQUE NOT NULL,
  model VARCHAR(80) NOT NULL,
  seat_capacity INT NOT NULL,
  release_status VARCHAR(30) NOT NULL DEFAULT 'RELEASED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_number VARCHAR(20) NOT NULL,
  departure_airport VARCHAR(10) NOT NULL,
  arrival_airport VARCHAR(10) NOT NULL,
  departure_time TIMESTAMPTZ NOT NULL,
  arrival_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  aircraft_id UUID REFERENCES aircraft(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE flights
  ADD COLUMN IF NOT EXISTS gate VARCHAR(10),
  ADD COLUMN IF NOT EXISTS boarding_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_closed_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_flights_checkin_closed_at ON flights (checkin_closed_at)
  WHERE checkin_closed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS crew_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  crew_user_id UUID NOT NULL REFERENCES users(id),
  duty_role VARCHAR(50) NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flight_id, crew_user_id)
);

CREATE TABLE IF NOT EXISTS passengers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  gender VARCHAR(20),
  date_of_birth DATE,
  nationality VARCHAR(80),
  passport_no VARCHAR(50),
  passport_expiry DATE,
  phone VARCHAR(40),
  email VARCHAR(150),
  emergency_contact VARCHAR(150),
  travel_status VARCHAR(30) NOT NULL DEFAULT 'BOOKED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE passengers
ADD COLUMN IF NOT EXISTS travel_status VARCHAR(30) NOT NULL DEFAULT 'BOOKED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'passengers_travel_status_check'
  ) THEN
    ALTER TABLE passengers
      ADD CONSTRAINT passengers_travel_status_check
      CHECK (travel_status IN ('BOOKED', 'CHECKED_IN', 'BOARDED', 'NO_SHOW'));
  END IF;
END $$;

ALTER TABLE passengers
ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

ALTER TABLE passengers
ADD COLUMN IF NOT EXISTS passport_expiry DATE;

ALTER TABLE passengers
ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(150);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pnr VARCHAR(10) UNIQUE NOT NULL,
  trip_type VARCHAR(20) NOT NULL DEFAULT 'ONE_WAY',
  booking_status VARCHAR(20) NOT NULL DEFAULT 'HOLD',
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_passengers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES passengers(id),
  passenger_type VARCHAR(10) NOT NULL DEFAULT 'ADT',
  UNIQUE (booking_id, passenger_id)
);

CREATE TABLE IF NOT EXISTS booking_flights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  flight_id UUID NOT NULL REFERENCES flights(id),
  leg_type VARCHAR(10) NOT NULL DEFAULT 'OUTBOUND',
  cabin_class VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
  fare_amount NUMERIC(12, 2) NOT NULL,
  UNIQUE (booking_id, flight_id)
);

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS trip_type VARCHAR(20) NOT NULL DEFAULT 'ONE_WAY';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_trip_type_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_trip_type_check CHECK (trip_type IN ('ONE_WAY', 'RETURN'));
  END IF;
END $$;

ALTER TABLE booking_flights
ADD COLUMN IF NOT EXISTS leg_type VARCHAR(10) NOT NULL DEFAULT 'OUTBOUND';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_flights_leg_type_check'
  ) THEN
    ALTER TABLE booking_flights
      ADD CONSTRAINT booking_flights_leg_type_check CHECK (leg_type IN ('OUTBOUND', 'INBOUND'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number VARCHAR(20) UNIQUE NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id),
  passenger_id UUID NOT NULL REFERENCES passengers(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by UUID REFERENCES users(id),
  ticket_status VARCHAR(20) NOT NULL DEFAULT 'ISSUED'
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID REFERENCES bookings(id),
  payment_type VARCHAR(20) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
  transaction_ref VARCHAR(100),
  processed_by UUID REFERENCES users(id),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  refund_amount NUMERIC(12, 2) NOT NULL,
  reason TEXT,
  approved_by UUID REFERENCES users(id),
  refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  passenger_id UUID NOT NULL REFERENCES passengers(id),
  flight_id UUID NOT NULL REFERENCES flights(id),
  seat_number VARCHAR(8),
  checkin_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_by UUID REFERENCES users(id),
  boarding_pass_no VARCHAR(30) UNIQUE,
  boarding_status VARCHAR(20) NOT NULL DEFAULT 'CHECKED_IN',
  checkin_status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  boarded_at TIMESTAMPTZ,
  boarding_gate VARCHAR(20),
  boarding_sequence INT,
  UNIQUE (passenger_id, flight_id)
);

ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS boarding_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS checkin_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS boarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boarding_gate VARCHAR(20),
  ADD COLUMN IF NOT EXISTS boarding_sequence INT;

UPDATE checkins SET boarding_status = 'CHECKED_IN' WHERE boarding_status IS NULL OR btrim(boarding_status::text) = '';
UPDATE checkins SET checkin_status = 'COMPLETED' WHERE checkin_status IS NULL OR btrim(checkin_status::text) = '';
ALTER TABLE checkins ALTER COLUMN boarding_status SET DEFAULT 'CHECKED_IN';
ALTER TABLE checkins ALTER COLUMN checkin_status SET DEFAULT 'COMPLETED';
ALTER TABLE checkins ALTER COLUMN boarding_status SET NOT NULL;
ALTER TABLE checkins ALTER COLUMN checkin_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkins_boarding_status_check'
  ) THEN
    ALTER TABLE checkins
      ADD CONSTRAINT checkins_boarding_status_check
      CHECK (boarding_status IN ('CHECKED_IN', 'BOARDING', 'BOARDED', 'NO_SHOW'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkins_checkin_status_check'
  ) THEN
    ALTER TABLE checkins
      ADD CONSTRAINT checkins_checkin_status_check
      CHECK (checkin_status IN ('PENDING', 'COMPLETED', 'CANCELLED'));
  END IF;
END $$;

UPDATE checkins SET boarded_at = checkin_time
WHERE upper(btrim(boarding_status::text)) = 'BOARDED' AND boarded_at IS NULL;

CREATE TABLE IF NOT EXISTS baggage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checkin_id UUID NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  tag_number VARCHAR(30) UNIQUE NOT NULL,
  weight_kg NUMERIC(6, 2) NOT NULL,
  pieces INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id),
  dispatch_status VARCHAR(20) NOT NULL,
  remarks TEXT,
  dispatched_by UUID REFERENCES users(id),
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dispatch_logs ADD COLUMN IF NOT EXISTS checklist_json JSONB;

CREATE TABLE IF NOT EXISTS flight_delays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  delay_minutes INT NOT NULL CHECK (delay_minutes >= 1),
  reason TEXT NOT NULL,
  reported_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS revised_departure TIMESTAMPTZ;
ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS operational_notes TEXT;

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aircraft_id UUID NOT NULL REFERENCES aircraft(id),
  defect_code VARCHAR(50),
  defect_description TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  opened_by UUID REFERENCES users(id),
  closed_by UUID REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS maintenance_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aircraft_id UUID NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  inspection_type VARCHAR(60) NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  remarks TEXT,
  scheduled_by UUID REFERENCES users(id),
  completed_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100),
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS notes TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_status_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_payment_status_check
      CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ops_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_airport VARCHAR(10) NOT NULL,
  dest_airport VARCHAR(10) NOT NULL,
  label VARCHAR(160),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_routes_od_uidx ON ops_routes (upper(origin_airport), upper(dest_airport));

ALTER TABLE flights
  ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES ops_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

UPDATE flights SET status = 'ARRIVED' WHERE UPPER(TRIM(status)) = 'LANDED';

UPDATE flights SET status = 'SCHEDULED'
WHERE UPPER(TRIM(status)) NOT IN (
  'SCHEDULED','CHECKIN_OPEN','BOARDING','GATE_CLOSED','DEPARTED','IN_AIR','ARRIVED','DELAYED','CANCELLED'
);
UPDATE flights SET status = 'DEPARTED' WHERE UPPER(TRIM(status)) = 'DISPATCHED';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flights_status_check') THEN
    ALTER TABLE flights DROP CONSTRAINT flights_status_check;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flights_status_check') THEN
    ALTER TABLE flights
      ADD CONSTRAINT flights_status_check CHECK (
        status IN (
          'SCHEDULED',
          'CHECKIN_OPEN',
          'BOARDING',
          'GATE_CLOSED',
          'DEPARTED',
          'IN_AIR',
          'ARRIVED',
          'DELAYED',
          'CANCELLED'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_bookings_pnr ON bookings(pnr);
CREATE INDEX IF NOT EXISTS idx_checkins_flight_id ON checkins(flight_id);
CREATE INDEX IF NOT EXISTS idx_flights_number ON flights(flight_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_flight_delays_flight ON flight_delays(flight_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_aircraft ON maintenance_logs(aircraft_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_inspections_aircraft ON maintenance_inspections(aircraft_id);

-- Crew management (profiles, compliance, duty/rest)
CREATE TABLE IF NOT EXISTS crew_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  crew_category VARCHAR(20) NOT NULL,
  employee_number VARCHAR(40),
  base_airport VARCHAR(10),
  phone VARCHAR(40),
  emergency_contact VARCHAR(150),
  hire_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crew_profiles_category_check CHECK (crew_category IN ('PILOT', 'CABIN'))
);

CREATE TABLE IF NOT EXISTS crew_licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_type VARCHAR(40) NOT NULL,
  license_number VARCHAR(80),
  issuing_authority VARCHAR(120),
  issue_date DATE,
  expiry_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crew_medicals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medical_class VARCHAR(20),
  expiry_date DATE NOT NULL,
  examiner_name VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crew_training (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  training_code VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  completed_date DATE,
  expiry_date DATE,
  instructor VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crew_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crew_availability_status_check CHECK (status IN ('AVAILABLE', 'UNAVAILABLE')),
  CONSTRAINT crew_availability_period_check CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS crew_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  reference_number VARCHAR(120),
  issue_date DATE,
  expiry_date DATE,
  storage_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crew_duty_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  duty_start TIMESTAMPTZ NOT NULL,
  duty_end TIMESTAMPTZ NOT NULL,
  rest_until TIMESTAMPTZ NOT NULL,
  duty_minutes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, flight_id)
);

CREATE INDEX IF NOT EXISTS idx_crew_licenses_user ON crew_licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_medicals_user ON crew_medicals(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_training_user ON crew_training(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_availability_user ON crew_availability(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_documents_user ON crew_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_duty_logs_user ON crew_duty_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_duty_logs_rest ON crew_duty_logs(user_id, rest_until);

-- Finance & accounting
CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_by UUID NOT NULL REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT refund_requests_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_payment ON refund_requests(payment_id);

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refund_request_id UUID REFERENCES refund_requests(id);

CREATE TABLE IF NOT EXISTS finance_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(60) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  incurred_on DATE NOT NULL,
  description TEXT,
  reference VARCHAR(120),
  flight_id UUID REFERENCES flights(id),
  entered_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_incurred ON finance_expenses(incurred_on);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_flight ON finance_expenses(flight_id);

CREATE TABLE IF NOT EXISTS finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  txn_type VARCHAR(50) NOT NULL,
  amount NUMERIC(14, 2),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  booking_id UUID REFERENCES bookings(id),
  payment_id UUID REFERENCES payments(id),
  refund_id UUID REFERENCES refunds(id),
  refund_request_id UUID REFERENCES refund_requests(id),
  expense_id UUID REFERENCES finance_expenses(id),
  description TEXT,
  metadata JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_txn_created ON finance_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_txn_booking ON finance_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_finance_txn_type ON finance_transactions(txn_type);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_status_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_payment_status_check CHECK (
    UPPER(TRIM(payment_status)) IN (
      'PENDING',
      'PAID',
      'FAILED',
      'REFUNDED',
      'PARTIALLY_REFUNDED'
    )
  );

-- Sales & marketing
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
  default_discount_percent NUMERIC(5, 2),
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
  commission_percent NUMERIC(5, 2),
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

-- Customer Service (see database/customer_service.sql)
CREATE TABLE IF NOT EXISTS cs_customer_profiles (
  passenger_id UUID PRIMARY KEY REFERENCES passengers(id) ON DELETE CASCADE,
  preferred_language VARCHAR(20),
  vip_flag BOOLEAN NOT NULL DEFAULT FALSE,
  service_notes TEXT,
  preferred_contact VARCHAR(40),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cs_service_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_ref VARCHAR(32) UNIQUE NOT NULL,
  case_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  passenger_id UUID REFERENCES passengers(id),
  booking_id UUID REFERENCES bookings(id),
  baggage_id UUID REFERENCES baggage(id),
  refund_request_id UUID REFERENCES refund_requests(id),
  subject VARCHAR(300) NOT NULL,
  description TEXT,
  metadata JSONB,
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT cs_service_cases_type_check CHECK (
    case_type IN ('SUPPORT', 'COMPLAINT', 'REFUND_REQUEST', 'BOOKING_CHANGE', 'LOST_BAGGAGE', 'GENERAL')
  ),
  CONSTRAINT cs_service_cases_status_check CHECK (
    status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')
  ),
  CONSTRAINT cs_service_cases_priority_check CHECK (
    priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')
  )
);

CREATE TABLE IF NOT EXISTS cs_case_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cs_service_cases(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_cases_status ON cs_service_cases(status);
CREATE INDEX IF NOT EXISTS idx_cs_cases_type ON cs_service_cases(case_type);
CREATE INDEX IF NOT EXISTS idx_cs_cases_assigned ON cs_service_cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cs_cases_passenger ON cs_service_cases(passenger_id);
CREATE INDEX IF NOT EXISTS idx_cs_cases_booking ON cs_service_cases(booking_id);
CREATE INDEX IF NOT EXISTS idx_cs_cases_created ON cs_service_cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_case_notes_case ON cs_case_notes(case_id, created_at);

CREATE OR REPLACE VIEW customer_cases AS
SELECT * FROM cs_service_cases;

-- Auth audit extensions (required for POST /api/auth/login)
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64),
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE TABLE IF NOT EXISTS login_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(150) NOT NULL,
  success BOOLEAN NOT NULL,
  ip_address VARCHAR(64),
  user_agent TEXT,
  reason VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_email ON login_history(email);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(128),
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;


-- === Master data tables & seed (from master_data.sql + master_data_seed.sql) ===
-- HAMS master data (run after schema.sql). Admin-only writes via API.

CREATE TABLE IF NOT EXISTS md_countries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  iso2 CHAR(2) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_cities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  country_id UUID NOT NULL REFERENCES md_countries(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  iata_code VARCHAR(3),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_currencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code CHAR(3) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  decimal_places INT NOT NULL DEFAULT 2,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_airports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  iata_code VARCHAR(3) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  country_id UUID REFERENCES md_countries(id),
  city_id UUID REFERENCES md_cities(id),
  timezone VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  parent_id UUID REFERENCES md_departments(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_role_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_key user_role NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_system_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pref_key VARCHAR(80) NOT NULL UNIQUE,
  pref_value TEXT NOT NULL,
  value_type VARCHAR(20) NOT NULL DEFAULT 'STRING',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_aircraft_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  default_seat_capacity INT NOT NULL DEFAULT 150,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_seat_maps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  aircraft_type_id UUID NOT NULL REFERENCES md_aircraft_types(id) ON DELETE CASCADE,
  layout_json JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_airport_id UUID NOT NULL REFERENCES md_airports(id) ON DELETE RESTRICT,
  dest_airport_id UUID NOT NULL REFERENCES md_airports(id) ON DELETE RESTRICT,
  distance_nm INT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (origin_airport_id, dest_airport_id),
  CHECK (origin_airport_id <> dest_airport_id)
);

CREATE TABLE IF NOT EXISTS md_fare_classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  booking_class VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (booking_class IN ('ECONOMY', 'BUSINESS', 'FIRST'))
);

CREATE TABLE IF NOT EXISTS md_route_fares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  route_id UUID NOT NULL REFERENCES md_routes(id) ON DELETE CASCADE,
  fare_class_id UUID NOT NULL REFERENCES md_fare_classes(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, fare_class_id)
);

CREATE TABLE IF NOT EXISTS md_tax_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  rate_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  applies_to VARCHAR(20) NOT NULL DEFAULT 'SUBTOTAL',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (applies_to IN ('SUBTOTAL', 'TOTAL'))
);

CREATE TABLE IF NOT EXISTS md_fee_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  amount_fixed NUMERIC(12, 2) NOT NULL DEFAULT 0,
  rate_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS md_baggage_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  route_id UUID REFERENCES md_routes(id) ON DELETE CASCADE,
  fare_class_id UUID REFERENCES md_fare_classes(id) ON DELETE SET NULL,
  free_pieces INT NOT NULL DEFAULT 1,
  free_weight_kg NUMERIC(8, 2) NOT NULL DEFAULT 23,
  max_weight_per_piece_kg NUMERIC(8, 2) NOT NULL DEFAULT 32,
  charge_per_kg_over NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS aircraft_type_id UUID REFERENCES md_aircraft_types(id);
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS seat_map_id UUID REFERENCES md_seat_maps(id);

ALTER TABLE booking_flights ADD COLUMN IF NOT EXISTS fare_class_id UUID REFERENCES md_fare_classes(id);

CREATE INDEX IF NOT EXISTS idx_md_routes_origin ON md_routes(origin_airport_id);
CREATE INDEX IF NOT EXISTS idx_md_routes_dest ON md_routes(dest_airport_id);
CREATE INDEX IF NOT EXISTS idx_md_route_fares_route ON md_route_fares(route_id);
CREATE INDEX IF NOT EXISTS idx_md_baggage_rules_route ON md_baggage_rules(route_id);

ALTER TABLE baggage ADD COLUMN IF NOT EXISTS excess_charge NUMERIC(12, 2) NOT NULL DEFAULT 0;
-- Seed master data for HAMS (idempotent). Run after master_data.sql.

INSERT INTO md_countries (iso2, name)
VALUES ('AE', 'United Arab Emirates'), ('KE', 'Kenya')
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO md_currencies (code, name, decimal_places)
VALUES ('USD', 'US Dollar', 2), ('KES', 'Kenyan Shilling', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'DXB', 'Dubai International', c.id, 'Asia/Dubai'
FROM md_countries c WHERE c.iso2 = 'AE'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'NBO', 'Jomo Kenyatta International', c.id, 'Africa/Nairobi'
FROM md_countries c WHERE c.iso2 = 'KE'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_aircraft_types (code, name, default_seat_capacity)
VALUES ('B738', 'Boeing 737-800', 162), ('A320', 'Airbus A320', 150)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_seat_maps (name, aircraft_type_id, layout_json)
SELECT 'B738 Default', t.id, '{"rows":28,"economy":"3-3"}'::jsonb
FROM md_aircraft_types t
WHERE t.code = 'B738'
  AND NOT EXISTS (SELECT 1 FROM md_seat_maps s WHERE s.aircraft_type_id = t.id);

INSERT INTO md_fare_classes (code, name, booking_class, description)
VALUES
  ('ECON', 'Economy Saver', 'ECONOMY', 'Default economy'),
  ('FLEX', 'Economy Flex', 'ECONOMY', 'Flexible economy')
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm)
SELECT o.id, d.id, 2200
FROM md_airports o, md_airports d
WHERE o.iata_code = 'DXB' AND d.iata_code = 'NBO'
AND NOT EXISTS (
  SELECT 1 FROM md_routes r
  WHERE r.origin_airport_id = o.id AND r.dest_airport_id = d.id
);

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm)
SELECT o.id, d.id, 2200
FROM md_airports o, md_airports d
WHERE o.iata_code = 'NBO' AND d.iata_code = 'DXB'
AND NOT EXISTS (
  SELECT 1 FROM md_routes r
  WHERE r.origin_airport_id = o.id AND r.dest_airport_id = d.id
);

INSERT INTO md_route_fares (route_id, fare_class_id, amount, currency)
SELECT r.id, f.id, 220.00, 'USD'
FROM md_routes r
JOIN md_airports o ON o.id = r.origin_airport_id
JOIN md_airports d ON d.id = r.dest_airport_id
JOIN md_fare_classes f ON f.code = 'ECON'
WHERE o.iata_code = 'DXB' AND d.iata_code = 'NBO'
ON CONFLICT (route_id, fare_class_id) DO NOTHING;

INSERT INTO md_route_fares (route_id, fare_class_id, amount, currency)
SELECT r.id, f.id, 220.00, 'USD'
FROM md_routes r
JOIN md_airports o ON o.id = r.origin_airport_id
JOIN md_airports d ON d.id = r.dest_airport_id
JOIN md_fare_classes f ON f.code = 'ECON'
WHERE o.iata_code = 'NBO' AND d.iata_code = 'DXB'
ON CONFLICT (route_id, fare_class_id) DO NOTHING;

INSERT INTO md_tax_settings (code, name, rate_percent, applies_to, sort_order)
VALUES ('VAT', 'Value added tax', 5.0, 'SUBTOTAL', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_fee_settings (code, name, amount_fixed, rate_percent)
VALUES ('YQ', 'Carrier fuel surcharge', 15.00, 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_payment_methods (code, name)
VALUES ('CARD', 'Credit / debit card'), ('CASH', 'Cash'), ('WALLET', 'Agency wallet')
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_baggage_rules (route_id, fare_class_id, free_pieces, free_weight_kg, max_weight_per_piece_kg, charge_per_kg_over, currency)
SELECT r.id, NULL, 1, 23, 32, 12.00, 'USD'
FROM md_routes r
JOIN md_airports o ON o.id = r.origin_airport_id
JOIN md_airports d ON d.id = r.dest_airport_id
WHERE (o.iata_code, d.iata_code) IN (('DXB','NBO'),('NBO','DXB'))
AND NOT EXISTS (SELECT 1 FROM md_baggage_rules b WHERE b.route_id = r.id AND b.fare_class_id IS NULL);

INSERT INTO md_departments (code, name)
VALUES ('OPS', 'Operations'), ('COMM', 'Commercial')
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_role_definitions (role_key, display_name, description)
SELECT v.role::user_role, v.label, v.role_description
FROM (VALUES
  ('admin'::user_role, 'Administrator', 'Full system access'),
  ('finance'::user_role, 'Finance', 'Payments and accounting'),
  ('operations'::user_role, 'Operations', 'Flights and dispatch'),
  ('agent'::user_role, 'Agent', 'Bookings and check-in'),
  ('crew'::user_role, 'Crew', 'Rostered flying duties'),
  ('maintenance'::user_role, 'Maintenance', 'Aircraft defects and release')
) AS v(role, label, role_description)
ON CONFLICT (role_key) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description, updated_at = NOW();

INSERT INTO md_system_preferences (pref_key, pref_value, value_type)
VALUES
  ('default_currency', 'USD', 'STRING'),
  ('booking_hold_minutes', '30', 'NUMBER'),
  ('checkin_opens_hours_before', '24', 'NUMBER')
ON CONFLICT (pref_key) DO UPDATE SET pref_value = EXCLUDED.pref_value, updated_at = NOW();

INSERT INTO md_cities (country_id, name)
SELECT c.id, 'Dubai' FROM md_countries c WHERE c.iso2 = 'AE'
AND NOT EXISTS (SELECT 1 FROM md_cities x JOIN md_countries c2 ON x.country_id = c2.id WHERE c2.iso2 = 'AE' AND x.name = 'Dubai');

INSERT INTO md_cities (country_id, name)
SELECT c.id, 'Nairobi' FROM md_countries c WHERE c.iso2 = 'KE'
AND NOT EXISTS (SELECT 1 FROM md_cities x JOIN md_countries c2 ON x.country_id = c2.id WHERE c2.iso2 = 'KE' AND x.name = 'Nairobi');
