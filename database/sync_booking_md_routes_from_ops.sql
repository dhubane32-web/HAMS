-- Ensure booking/pricing master data covers every active ops_route sector (idempotent).
-- Run after flight_operations.sql (ops_routes).

INSERT INTO md_fare_classes (code, name, booking_class, description)
VALUES ('BUS', 'Business', 'BUSINESS', 'Business cabin')
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, timezone)
SELECT x.iata, x.iata || ' Airport', 'UTC'
FROM (
  SELECT DISTINCT upper(trim(origin_airport)) AS iata FROM ops_routes WHERE is_active = TRUE
  UNION
  SELECT DISTINCT upper(trim(dest_airport)) AS iata FROM ops_routes WHERE is_active = TRUE
) x
WHERE length(x.iata) = 3
  AND NOT EXISTS (SELECT 1 FROM md_airports a WHERE upper(trim(a.iata_code)) = x.iata);

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm)
SELECT o.id, d.id, 1200
FROM ops_routes r
JOIN md_airports o ON upper(trim(o.iata_code)) = upper(trim(r.origin_airport))
JOIN md_airports d ON upper(trim(d.iata_code)) = upper(trim(r.dest_airport))
WHERE r.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM md_routes mr
    WHERE mr.origin_airport_id = o.id AND mr.dest_airport_id = d.id
  );

UPDATE md_routes mr
SET is_active = TRUE
FROM ops_routes r
JOIN md_airports o ON upper(trim(o.iata_code)) = upper(trim(r.origin_airport))
JOIN md_airports d ON upper(trim(d.iata_code)) = upper(trim(r.dest_airport))
WHERE mr.origin_airport_id = o.id
  AND mr.dest_airport_id = d.id
  AND r.is_active = TRUE;

INSERT INTO md_route_fares (route_id, fare_class_id, amount, currency)
SELECT mr.id, fc.id,
  CASE
    WHEN upper(o.iata_code) IN ('DXB', 'NBO') AND upper(d.iata_code) IN ('DXB', 'NBO') THEN
      CASE fc.code
        WHEN 'ECON' THEN 220.00
        WHEN 'FLEX' THEN 285.00
        WHEN 'BUS' THEN 540.00
        ELSE 220.00
      END
    WHEN (upper(o.iata_code) = 'MGQ' AND upper(d.iata_code) = 'JIB')
      OR (upper(o.iata_code) = 'JIB' AND upper(d.iata_code) = 'MGQ') THEN
      CASE fc.code
        WHEN 'ECON' THEN 195.00
        WHEN 'FLEX' THEN 255.00
        WHEN 'BUS' THEN 495.00
        ELSE 195.00
      END
    WHEN (upper(o.iata_code) = 'MGQ' AND upper(d.iata_code) = 'GGR')
      OR (upper(o.iata_code) = 'GGR' AND upper(d.iata_code) = 'MGQ') THEN
      CASE fc.code
        WHEN 'ECON' THEN 125.00
        WHEN 'FLEX' THEN 165.00
        WHEN 'BUS' THEN 310.00
        ELSE 125.00
      END
    ELSE
      CASE fc.code
        WHEN 'ECON' THEN 200.00
        WHEN 'FLEX' THEN 260.00
        WHEN 'BUS' THEN 480.00
        ELSE 200.00
      END
  END,
  'USD'
FROM md_routes mr
JOIN md_airports o ON o.id = mr.origin_airport_id
JOIN md_airports d ON d.id = mr.dest_airport_id
JOIN md_fare_classes fc ON fc.code IN ('ECON', 'FLEX', 'BUS') AND fc.is_active = TRUE
WHERE mr.is_active = TRUE
ON CONFLICT (route_id, fare_class_id) DO UPDATE SET
  amount = EXCLUDED.amount,
  currency = EXCLUDED.currency,
  is_active = TRUE;
