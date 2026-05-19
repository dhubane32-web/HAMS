-- HAMS Phase 2 — Airline Commercial Core (booking extensions, coupons, CRM notifications)
-- Idempotent. Run after schema.sql, booking_ticketing.sql, sales_commercial_platform.sql

-- ---------------------------------------------------------------------------
-- Trip types: MULTI_CITY
-- ---------------------------------------------------------------------------
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_trip_type_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_trip_type_check
  CHECK (trip_type IN ('ONE_WAY', 'RETURN', 'MULTI_CITY'));

ALTER TABLE booking_flights ADD COLUMN IF NOT EXISTS leg_sequence INT NOT NULL DEFAULT 1;

ALTER TABLE booking_flights DROP CONSTRAINT IF EXISTS booking_flights_leg_type_check;
ALTER TABLE booking_flights
  ADD CONSTRAINT booking_flights_leg_type_check
  CHECK (leg_type IN ('OUTBOUND', 'INBOUND', 'LEG'));

CREATE INDEX IF NOT EXISTS idx_booking_flights_booking_seq ON booking_flights (booking_id, leg_sequence);

-- ---------------------------------------------------------------------------
-- Passenger profiles (repeat travelers / CRM)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passenger_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_ref VARCHAR(12) NOT NULL UNIQUE,
  primary_email VARCHAR(150),
  primary_phone VARCHAR(40),
  loyalty_tier VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
  notes TEXT,
  travel_history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passenger_profiles_email ON passenger_profiles (lower(primary_email))
  WHERE primary_email IS NOT NULL;

ALTER TABLE passengers ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES passenger_profiles(id);

-- ---------------------------------------------------------------------------
-- SSR / OSI (PNR service requests)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_ssr (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_id UUID REFERENCES passengers(id) ON DELETE CASCADE,
  flight_id UUID REFERENCES flights(id) ON DELETE SET NULL,
  ssr_code VARCHAR(4) NOT NULL,
  ssr_text VARCHAR(240),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booking_ssr_status_check CHECK (status IN ('ACTIVE', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_booking_ssr_booking ON booking_ssr (booking_id);

CREATE TABLE IF NOT EXISTS booking_osi (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  osi_line VARCHAR(200) NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_osi_booking ON booking_osi (booking_id);

-- ---------------------------------------------------------------------------
-- Ticket coupons (one per flight leg on issued ticket)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  booking_flight_id UUID NOT NULL REFERENCES booking_flights(id) ON DELETE CASCADE,
  coupon_number SMALLINT NOT NULL,
  coupon_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  fare_amount NUMERIC(12, 2),
  tax_amount NUMERIC(12, 2),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticket_coupons_status_check CHECK (coupon_status IN ('OPEN', 'USED', 'VOID', 'REFUNDED', 'EXCHANGED')),
  CONSTRAINT ticket_coupons_unique UNIQUE (ticket_id, booking_flight_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_coupons_ticket ON ticket_coupons (ticket_id);

-- ---------------------------------------------------------------------------
-- Booking modification audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_modification_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  modification_type VARCHAR(40) NOT NULL,
  before_json JSONB,
  after_json JSONB,
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_mod_log_booking ON booking_modification_log (booking_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Route inventory control (per-flight bucket)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_inventory_control (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  fare_class_id UUID REFERENCES md_fare_classes(id),
  authorized_seats INT NOT NULL CHECK (authorized_seats >= 0),
  sold_seats INT NOT NULL DEFAULT 0 CHECK (sold_seats >= 0),
  waitlist_max INT NOT NULL DEFAULT 0 CHECK (waitlist_max >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT route_inventory_unique UNIQUE (flight_id, fare_class_id)
);

CREATE INDEX IF NOT EXISTS idx_route_inventory_flight ON route_inventory_control (flight_id);

-- ---------------------------------------------------------------------------
-- Commercial notifications outbox (email / WhatsApp / SMS-ready)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel VARCHAR(20) NOT NULL,
  template_code VARCHAR(60) NOT NULL,
  recipient VARCHAR(240) NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  flight_id UUID REFERENCES flights(id) ON DELETE SET NULL,
  passenger_id UUID REFERENCES passengers(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_ref VARCHAR(120),
  error_message TEXT,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_notifications_channel_check CHECK (channel IN ('EMAIL', 'WHATSAPP', 'SMS')),
  CONSTRAINT commercial_notifications_status_check CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED'))
);

CREATE INDEX IF NOT EXISTS idx_commercial_notifications_status ON commercial_notifications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_notifications_booking ON commercial_notifications (booking_id);

-- Standby list per flight
CREATE TABLE IF NOT EXISTS flight_standby_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 100,
  status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT flight_standby_unique UNIQUE (flight_id, booking_id, passenger_id),
  CONSTRAINT flight_standby_status_check CHECK (status IN ('WAITING', 'CLEARED', 'REMOVED', 'NO_SHOW'))
);

CREATE INDEX IF NOT EXISTS idx_flight_standby_flight ON flight_standby_list (flight_id, status);
