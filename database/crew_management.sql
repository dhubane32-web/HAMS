-- Crew management: profiles, licenses, medicals, training, availability, documents, duty/rest. Run after schema.sql.

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
