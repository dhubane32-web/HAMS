-- Airline finance ERP extensions (idempotent).

CREATE TABLE IF NOT EXISTS finance_vendor_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_name VARCHAR(200) NOT NULL,
  invoice_ref VARCHAR(120),
  category VARCHAR(60) NOT NULL DEFAULT 'OTHER',
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  due_on DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  notes TEXT,
  entered_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  CONSTRAINT finance_vendor_invoices_status CHECK (status IN ('OPEN', 'PARTIAL', 'PAID', 'VOID'))
);

CREATE INDEX IF NOT EXISTS idx_finance_vendor_inv_due ON finance_vendor_invoices (due_on);
CREATE INDEX IF NOT EXISTS idx_finance_vendor_inv_status ON finance_vendor_invoices (status);

CREATE TABLE IF NOT EXISTS finance_bank_deposits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deposit_date DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  reference VARCHAR(160),
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_bank_dep_date ON finance_bank_deposits (deposit_date DESC);
