-- Booking & ticketing: payment tracking and notes. Run after schema.sql.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Backfill from successful payments vs total
UPDATE bookings b
SET payment_status = CASE
  WHEN b.total_amount <= 0 THEN 'PAID'
  WHEN COALESCE(
    (SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND UPPER(TRIM(p.payment_status)) IN ('SUCCESS', 'PAID')),
    0
  ) >= b.total_amount THEN 'PAID'
  WHEN EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND UPPER(TRIM(p.payment_status)) IN ('SUCCESS', 'PAID'))
    THEN 'PARTIALLY_PAID'
  ELSE 'UNPAID'
END;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS return_date DATE,
  ADD COLUMN IF NOT EXISTS fare_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS fare_base_total NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS fare_tax_total NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS fare_fee_total NUMERIC(12, 2);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_status_check') THEN
    ALTER TABLE bookings DROP CONSTRAINT bookings_payment_status_check;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_status_check') THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_payment_status_check CHECK (
        payment_status IN (
          'UNPAID',
          'PARTIALLY_PAID',
          'PAID',
          'REFUNDED',
          'PENDING',
          'FAILED'
        )
      );
  END IF;
END $$;
