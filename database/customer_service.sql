-- Customer Service module (depends on passengers, bookings, users, baggage, refund_requests)

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

-- Compatibility alias for tooling / reporting (same rows as cs_service_cases).
CREATE OR REPLACE VIEW customer_cases AS
SELECT * FROM cs_service_cases;
