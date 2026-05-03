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
