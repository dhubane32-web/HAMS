/**
 * Operational load factor: seats sold (non-cancelled bookings, seat-bearing pax) /
 * seats available (aircraft capacity), aggregated across flight legs in a departure window.
 *
 * Not an average of per-leg ratios (which omits empty legs and skews network LF).
 */

/** @param {string} todayIsoDate `YYYY-MM-DD` (UTC calendar day for "month to date") */
export function monthToDateDepartureWindow(todayIsoDate) {
  const monthStart = `${todayIsoDate.slice(0, 7)}-01`;
  const fromTs = `${monthStart}T00:00:00.000Z`;
  const end = new Date(`${todayIsoDate}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const toExclusiveTs = `${end.toISOString().slice(0, 10)}T00:00:00.000Z`;
  return { fromTs, toExclusiveTs, monthStart };
}

/** Inclusive calendar `from` / `to` (YYYY-MM-DD) → half-open [fromTs, toExclusiveTs) on departure_time. */
export function dateRangeToDepartureWindow(fromDateStr, toDateStr) {
  const from = String(fromDateStr).slice(0, 10);
  const to = String(toDateStr).slice(0, 10);
  const fromTs = `${from}T00:00:00.000Z`;
  const end = new Date(`${to}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const toExclusiveTs = `${end.toISOString().slice(0, 10)}T00:00:00.000Z`;
  return { fromTs, toExclusiveTs };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} fromTs ISO timestamptz lower bound inclusive
 * @param {string} toExclusiveTs ISO timestamptz upper bound exclusive
 */
export async function queryLoadFactorSnapshot(pool, fromTs, toExclusiveTs) {
  const r = await pool.query(
    `WITH flight_stats AS (
       SELECT
         f.id AS flight_id,
         f.flight_number,
         f.departure_airport AS origin,
         f.arrival_airport AS dest,
         f.departure_time,
         ac.seat_capacity::numeric AS seats_available,
         COUNT(DISTINCT sla.passenger_id) FILTER (WHERE sla.passenger_id IS NOT NULL)::numeric AS seats_sold
       FROM flights f
       INNER JOIN aircraft ac ON ac.id = f.aircraft_id AND ac.seat_capacity > 0
       LEFT JOIN sm_seat_leg_allocation sla ON sla.flight_id = f.id
       WHERE f.departure_time >= $1::timestamptz
         AND f.departure_time < $2::timestamptz
       GROUP BY f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, ac.seat_capacity
     ),
     agg AS (
       SELECT
         COALESCE(SUM(seats_sold), 0)::numeric AS total_seats_sold,
         COALESCE(SUM(seats_available), 0)::numeric AS total_seats_available,
         COUNT(*)::int AS flight_leg_count
       FROM flight_stats
     ),
     per_flight AS (
       SELECT COALESCE(
         json_agg(
           json_build_object(
             'flightId', t.flight_id,
             'flightNumber', t.flight_number,
             'origin', t.origin,
             'dest', t.dest,
             'departureTime', t.departure_time,
             'seatsSold', t.seats_sold::int,
             'seatsAvailable', t.seats_available::int,
             'loadFactor', CASE
               WHEN t.seats_available > 0 THEN ROUND((t.seats_sold / t.seats_available)::numeric, 6)
               ELSE 0::numeric
             END
           )
           ORDER BY t.departure_time DESC
         ),
         '[]'::json
       ) AS rows
       FROM (
         SELECT * FROM flight_stats
         ORDER BY departure_time DESC
         LIMIT 120
       ) t
     )
     SELECT
       CASE
         WHEN agg.total_seats_available > 0 THEN
           ROUND((agg.total_seats_sold / agg.total_seats_available)::numeric, 6)
         ELSE 0::numeric
       END AS load_factor,
       agg.total_seats_sold::bigint AS total_seats_sold,
       agg.total_seats_available::bigint AS total_seats_available,
       agg.flight_leg_count,
       per_flight.rows AS per_flight_load_factor
     FROM agg CROSS JOIN per_flight`,
    [fromTs, toExclusiveTs]
  );
  const row = r.rows[0] || {};
  let perFlight = row.per_flight_load_factor;
  if (typeof perFlight === 'string') {
    try {
      perFlight = JSON.parse(perFlight);
    } catch {
      perFlight = [];
    }
  }
  if (!Array.isArray(perFlight)) perFlight = [];
  return {
    loadFactor: Number(row.load_factor || 0),
    totalSeatsSold: Number(row.total_seats_sold || 0),
    totalSeatsAvailable: Number(row.total_seats_available || 0),
    flightLegCount: Number(row.flight_leg_count || 0),
    perFlightLoadFactor: perFlight
  };
}
