/**
 * O&D route analytics for a flight departure window [fromTs, toExclusiveTs).
 * Seats sold / load factor use sm_seat_leg_allocation (issued tickets only), aligned with loadFactor.js.
 */

function routeLabel(origin, dest) {
  return `${String(origin || '').toUpperCase()}→${String(dest || '').toUpperCase()}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cabin / route+cabin seat & revenue (ticketed legs only; fare_amount counted once per booking_flight).
 * @param {import('pg').Pool} pool
 */
export async function queryCabinRouteSeatAnalytics(pool, fromTs, toExclusiveTs) {
  const byCabin = await pool.query(
    `WITH per_bf AS (
       SELECT bf.cabin_class,
              bf.fare_amount,
              COUNT(DISTINCT sla.passenger_id)::int AS pax
       FROM sm_seat_leg_allocation sla
       INNER JOIN booking_flights bf ON bf.booking_id = sla.booking_id AND bf.flight_id = sla.flight_id
       INNER JOIN flights f ON f.id = sla.flight_id
       WHERE f.departure_time >= $1::timestamptz
         AND f.departure_time < $2::timestamptz
       GROUP BY bf.id, bf.cabin_class, bf.fare_amount
     )
     SELECT cabin_class AS cabin,
            SUM(pax)::int AS seats_sold,
            SUM(fare_amount)::numeric AS revenue
     FROM per_bf
     GROUP BY cabin_class
     ORDER BY seats_sold DESC`,
    [fromTs, toExclusiveTs]
  );
  const byRouteCabin = await pool.query(
    `WITH per_bf AS (
       SELECT upper(trim(f.departure_airport)) AS origin,
              upper(trim(f.arrival_airport)) AS dest,
              bf.cabin_class,
              bf.fare_amount,
              COUNT(DISTINCT sla.passenger_id)::int AS pax
       FROM sm_seat_leg_allocation sla
       INNER JOIN booking_flights bf ON bf.booking_id = sla.booking_id AND bf.flight_id = sla.flight_id
       INNER JOIN flights f ON f.id = sla.flight_id
       WHERE f.departure_time >= $1::timestamptz
         AND f.departure_time < $2::timestamptz
       GROUP BY bf.id,
                upper(trim(f.departure_airport)),
                upper(trim(f.arrival_airport)),
                bf.cabin_class,
                bf.fare_amount
     )
     SELECT origin,
            dest,
            cabin_class AS cabin,
            SUM(pax)::int AS seats_sold,
            SUM(fare_amount)::numeric AS revenue,
            CASE WHEN SUM(pax) > 0 THEN (SUM(fare_amount) / SUM(pax))::numeric END AS yield_per_seat
     FROM per_bf
     GROUP BY origin, dest, cabin_class
     ORDER BY revenue DESC NULLS LAST
     LIMIT 120`,
    [fromTs, toExclusiveTs]
  );
  return { byCabin: byCabin.rows, byRouteAndCabin: byRouteCabin.rows };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} fromTs
 * @param {string} toExclusiveTs
 */
export async function queryRouteAnalyticsRows(pool, fromTs, toExclusiveTs) {
  const { rows } = await pool.query(
    `WITH flight_leg AS (
       SELECT upper(trim(f.departure_airport)) AS origin,
              upper(trim(f.arrival_airport)) AS dest,
              ac.seat_capacity::numeric AS cap,
              COUNT(DISTINCT sla.passenger_id)::numeric AS sold
       FROM flights f
       INNER JOIN aircraft ac ON ac.id = f.aircraft_id AND ac.seat_capacity > 0
       LEFT JOIN sm_seat_leg_allocation sla ON sla.flight_id = f.id
       WHERE f.departure_time >= $1::timestamptz
         AND f.departure_time < $2::timestamptz
       GROUP BY f.id, upper(trim(f.departure_airport)), upper(trim(f.arrival_airport)), ac.seat_capacity
     ),
     route_lf AS (
       SELECT origin, dest,
              SUM(sold)::numeric AS seats_sold,
              SUM(cap)::numeric AS seats_available
       FROM flight_leg
       GROUP BY origin, dest
     ),
     route_leg_ticketed AS (
       SELECT upper(trim(f.departure_airport)) AS origin,
              upper(trim(f.arrival_airport)) AS dest,
              bf.booking_id,
              bf.fare_amount,
              (
                SELECT COUNT(DISTINCT sla.passenger_id)::int
                FROM sm_seat_leg_allocation sla
                WHERE sla.booking_id = bf.booking_id
                  AND sla.flight_id = bf.flight_id
              ) AS pax_ticketed
       FROM booking_flights bf
       INNER JOIN flights f ON f.id = bf.flight_id
       INNER JOIN bookings b ON b.id = bf.booking_id
         AND upper(trim(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
       WHERE f.departure_time >= $1::timestamptz
         AND f.departure_time < $2::timestamptz
     ),
     route_book AS (
       SELECT origin, dest,
              COUNT(DISTINCT CASE WHEN pax_ticketed > 0 THEN booking_id END)::int AS bookings,
              COALESCE(SUM(CASE WHEN pax_ticketed > 0 THEN fare_amount ELSE 0 END), 0)::numeric AS revenue,
              SUM(pax_ticketed)::numeric AS pax_legs
       FROM route_leg_ticketed
       GROUP BY origin, dest
     ),
     keys AS (
       SELECT origin, dest FROM route_book
       UNION
       SELECT origin, dest FROM route_lf
     )
     SELECT k.origin,
            k.dest,
            COALESCE(rb.bookings, 0)::int AS bookings,
            COALESCE(rb.revenue, 0)::numeric AS revenue,
            COALESCE(rb.pax_legs, 0)::numeric AS pax_legs,
            COALESCE(rl.seats_sold, 0)::numeric AS seats_sold,
            COALESCE(rl.seats_available, 0)::numeric AS seats_available,
            CASE
              WHEN COALESCE(rl.seats_available, 0) > 0
              THEN (COALESCE(rl.seats_sold, 0) / rl.seats_available)::numeric
            END AS load_factor,
            CASE
              WHEN COALESCE(rb.pax_legs, 0) > 0 THEN (COALESCE(rb.revenue, 0) / rb.pax_legs)::numeric
            END AS yield_per_pax,
            CASE
              WHEN COALESCE(rl.seats_sold, 0) > 0 THEN (COALESCE(rb.revenue, 0) / rl.seats_sold)::numeric
            END AS yield_per_seat
     FROM keys k
     LEFT JOIN route_book rb ON rb.origin = k.origin AND rb.dest = k.dest
     LEFT JOIN route_lf rl ON rl.origin = k.origin AND rl.dest = k.dest
     WHERE COALESCE(rb.bookings, 0) > 0
        OR COALESCE(rl.seats_sold, 0) > 0
        OR COALESCE(rl.seats_available, 0) > 0`,
    [fromTs, toExclusiveTs]
  );

  return rows.map((r) => ({
    origin: String(r.origin || ''),
    dest: String(r.dest || ''),
    bookings: Number(r.bookings || 0),
    revenue: num(r.revenue),
    paxLegs: num(r.pax_legs),
    seatsSold: num(r.seats_sold),
    seatsAvailable: num(r.seats_available),
    loadFactor: r.load_factor == null ? null : num(r.load_factor),
    yieldPerPax: r.yield_per_pax == null ? null : num(r.yield_per_pax),
    yieldPerSeat: r.yield_per_seat == null ? null : num(r.yield_per_seat)
  }));
}

function pickMax(rows, scoreFn, tieKey = (r) => `${r.origin}|${r.dest}`) {
  if (!rows.length) return null;
  let best = rows[0];
  let bestS = scoreFn(best);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const s = scoreFn(r);
    if (s > bestS || (s === bestS && tieKey(r) < tieKey(best))) {
      best = r;
      bestS = s;
    }
  }
  return best;
}

function pickMin(rows, scoreFn, tieKey = (r) => `${r.origin}|${r.dest}`) {
  if (!rows.length) return null;
  let best = rows[0];
  let bestS = scoreFn(best);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const s = scoreFn(r);
    if (s < bestS || (s === bestS && tieKey(r) < tieKey(best))) {
      best = r;
      bestS = s;
    }
  }
  return best;
}

function toPayload(r) {
  if (!r) return null;
  return {
    origin: r.origin,
    dest: r.dest,
    route: routeLabel(r.origin, r.dest),
    bookings: r.bookings,
    revenue: r.revenue,
    paxLegs: r.paxLegs,
    seatsSold: r.seatsSold,
    seatsAvailable: r.seatsAvailable,
    loadFactor: r.loadFactor,
    yieldPerPax: r.yieldPerPax,
    yieldPerSeat: r.yieldPerSeat
  };
}

/**
 * @param {Awaited<ReturnType<typeof queryRouteAnalyticsRows>>} rows
 * @param {{ minCapacityForLfLeader?: number, minBookingsForWorst?: number }} [opts]
 */
export function summarizeRouteAnalytics(rows, opts = {}) {
  const minCap = opts.minCapacityForLfLeader ?? 48;
  const minBookWorst = opts.minBookingsForWorst ?? 2;

  const highestRevenue = pickMax(rows, (r) => r.revenue);
  const highestBooked = pickMax(rows, (r) => r.bookings);

  const yieldCandidates = rows.filter(
    (r) =>
      (r.seatsSold > 0 && r.yieldPerSeat != null && Number.isFinite(r.yieldPerSeat)) ||
      (r.paxLegs >= 1 && r.yieldPerPax != null && Number.isFinite(r.yieldPerPax))
  );
  const bestYield = pickMax(yieldCandidates, (r) =>
    r.seatsSold > 0 && r.yieldPerSeat != null ? r.yieldPerSeat : r.yieldPerPax || 0
  );

  const lfCandidates = rows.filter(
    (r) => r.seatsAvailable >= minCap && r.loadFactor != null && Number.isFinite(r.loadFactor)
  );
  const bestLoadFactor = pickMax(lfCandidates, (r) => r.loadFactor || 0);

  let worstPerforming = pickMin(
    rows.filter(
      (r) =>
        r.seatsAvailable >= minCap &&
        r.bookings >= minBookWorst &&
        r.loadFactor != null &&
        Number.isFinite(r.loadFactor)
    ),
    (r) => r.loadFactor || 1
  );
  if (!worstPerforming) {
    worstPerforming = pickMin(
      rows.filter((r) => r.bookings >= 1 && r.revenue >= 0),
      (r) => r.revenue
    );
  }
  if (!worstPerforming) {
    worstPerforming = pickMin(
      rows.filter((r) => r.loadFactor != null && Number.isFinite(r.loadFactor)),
      (r) => r.loadFactor || 1
    );
  }

  return {
    scope: {
      minCapacityForLfLeader: minCap,
      minBookingsForWorst: minBookWorst,
      routeCount: rows.length
    },
    highestRevenue: toPayload(highestRevenue),
    highestBooked: toPayload(highestBooked),
    bestYield: toPayload(bestYield),
    bestLoadFactor: toPayload(bestLoadFactor),
    worstPerforming: toPayload(worstPerforming)
  };
}

export async function queryRouteAnalyticsSnapshot(pool, fromTs, toExclusiveTs, opts) {
  const [rows, cabinAnalytics] = await Promise.all([
    queryRouteAnalyticsRows(pool, fromTs, toExclusiveTs),
    queryCabinRouteSeatAnalytics(pool, fromTs, toExclusiveTs).catch(() => ({ byCabin: [], byRouteAndCabin: [] }))
  ]);
  return {
    ...summarizeRouteAnalytics(rows, opts),
    cabinAnalytics
  };
}
