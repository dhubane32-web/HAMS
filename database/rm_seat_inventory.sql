-- RM seat inventory: one row per issued-ticket passenger per flight leg (links tickets to seat usage).
-- Applied after sales_commercial_platform.sql (expects tickets, booking_flights, md_fare_classes).

CREATE TABLE IF NOT EXISTS sm_seat_leg_allocation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  fare_class_id UUID REFERENCES md_fare_classes(id) ON DELETE SET NULL,
  cabin_class VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sm_seat_leg_allocation_unique UNIQUE (booking_id, flight_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_sm_seat_leg_allocation_flight ON sm_seat_leg_allocation (flight_id);
CREATE INDEX IF NOT EXISTS idx_sm_seat_leg_allocation_booking ON sm_seat_leg_allocation (booking_id);
CREATE INDEX IF NOT EXISTS idx_sm_seat_leg_allocation_ticket ON sm_seat_leg_allocation (ticket_id);

-- Backfill from existing issued tickets (idempotent)
INSERT INTO sm_seat_leg_allocation (booking_id, flight_id, passenger_id, ticket_id, fare_class_id, cabin_class)
SELECT bf.booking_id,
       bf.flight_id,
       t.passenger_id,
       t.id,
       bf.fare_class_id,
       bf.cabin_class
FROM tickets t
JOIN bookings b ON b.id = t.booking_id
  AND upper(trim(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
JOIN booking_flights bf ON bf.booking_id = t.booking_id
JOIN booking_passengers bp ON bp.booking_id = t.booking_id AND bp.passenger_id = t.passenger_id
WHERE upper(trim(COALESCE(t.ticket_status, ''))) = 'ISSUED'
  AND upper(trim(COALESCE(bp.passenger_type, 'ADT'))) <> 'INF'
ON CONFLICT (booking_id, flight_id, passenger_id) DO NOTHING;
