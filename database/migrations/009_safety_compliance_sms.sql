-- Safety Management System (SMS) — incremental tables (idempotent).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS sms_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(300) NOT NULL,
  description TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  reported_by UUID REFERENCES users (id) ON DELETE SET NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT sms_incidents_severity_check CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT sms_incidents_status_check CHECK (status IN ('OPEN', 'INVESTIGATING', 'CORRECTIVE', 'CLOSED'))
);

CREATE INDEX IF NOT EXISTS idx_sms_incidents_status ON sms_incidents (status, reported_at DESC);

CREATE TABLE IF NOT EXISTS sms_risk_register (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(300) NOT NULL,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  mitigation TEXT,
  owner_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_corrective_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID REFERENCES sms_incidents (id) ON DELETE CASCADE,
  action_text TEXT NOT NULL,
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_corrective_incident ON sms_corrective_actions (incident_id);
