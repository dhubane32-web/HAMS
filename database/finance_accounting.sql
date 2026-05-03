-- Finance & accounting: ledger, refund approvals, expenses. Run after schema.sql.

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

-- Payment status: Pending, Paid, Failed, Refunded, Partially Refunded (legacy SUCCESS -> PAID)
UPDATE payments SET payment_status = 'PAID' WHERE UPPER(TRIM(payment_status)) = 'SUCCESS';
UPDATE payments SET payment_status = 'FAILED' WHERE UPPER(TRIM(payment_status)) IN ('DECLINED');
UPDATE payments SET payment_status = 'FAILED'
WHERE UPPER(TRIM(payment_status)) NOT IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

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
