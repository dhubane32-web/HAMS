/**
 * Links issued tickets to per-flight seat usage for RM load factor, buckets, and analytics.
 */

/**
 * Recompute sm_rm_flight_bucket.seats_sold from sm_seat_leg_allocation for the given flights.
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {string[]} flightIds UUID strings
 */
export async function refreshRmFlightBucketsFromAllocations(client, flightIds) {
  if (!flightIds || flightIds.length === 0) return;
  await client.query(
    `UPDATE sm_rm_flight_bucket b
     SET seats_sold = 0, updated_at = NOW()
     WHERE b.flight_id = ANY($1::uuid[])`,
    [flightIds]
  );
  await client.query(
    `WITH counts AS (
       SELECT sla.flight_id,
              COALESCE(
                bf.fare_class_id,
                (SELECT id FROM md_fare_classes
                 WHERE is_active = TRUE
                 ORDER BY CASE WHEN upper(code) = 'Y' THEN 0 ELSE 1 END, code
                 LIMIT 1)
              ) AS fare_class_id,
              COUNT(DISTINCT sla.passenger_id)::int AS c
       FROM sm_seat_leg_allocation sla
       INNER JOIN booking_flights bf ON bf.booking_id = sla.booking_id AND bf.flight_id = sla.flight_id
       WHERE sla.flight_id = ANY($1::uuid[])
       GROUP BY sla.flight_id,
                COALESCE(
                  bf.fare_class_id,
                  (SELECT id FROM md_fare_classes
                   WHERE is_active = TRUE
                   ORDER BY CASE WHEN upper(code) = 'Y' THEN 0 ELSE 1 END, code
                   LIMIT 1)
                )
     )
     UPDATE sm_rm_flight_bucket b
     SET seats_sold = counts.c, updated_at = NOW()
     FROM counts
     WHERE b.flight_id = counts.flight_id
       AND b.fare_class_id = counts.fare_class_id`,
    [flightIds]
  );
}

/**
 * Replace allocations for a booking from current ISSUED tickets × legs (INF excluded).
 * @param {import('pg').PoolClient} client
 * @param {string} bookingId UUID
 */
export async function syncSeatLegAllocationsForBooking(client, bookingId) {
  await client.query(`DELETE FROM sm_seat_leg_allocation WHERE booking_id = $1::uuid`, [bookingId]);
  const ins = await client.query(
    `INSERT INTO sm_seat_leg_allocation (booking_id, flight_id, passenger_id, ticket_id, fare_class_id, cabin_class)
     SELECT bf.booking_id,
            bf.flight_id,
            bp.passenger_id,
            t.id,
            bf.fare_class_id,
            bf.cabin_class
     FROM booking_flights bf
     INNER JOIN bookings b ON b.id = bf.booking_id
       AND upper(trim(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
     INNER JOIN booking_passengers bp ON bp.booking_id = b.id
       AND upper(trim(COALESCE(bp.passenger_type, 'ADT'))) <> 'INF'
     INNER JOIN tickets t ON t.booking_id = b.id
       AND t.passenger_id = bp.passenger_id
       AND upper(trim(COALESCE(t.ticket_status, ''))) = 'ISSUED'
     WHERE bf.booking_id = $1::uuid`,
    [bookingId]
  );
  const fr = await client.query(`SELECT DISTINCT flight_id FROM booking_flights WHERE booking_id = $1::uuid`, [
    bookingId
  ]);
  const ids = fr.rows.map((row) => String(row.flight_id));
  if (ids.length) await refreshRmFlightBucketsFromAllocations(client, ids);
  return ins.rowCount;
}

/**
 * Remove all seat allocations for a booking (e.g. cancellation) and refresh RM buckets.
 * @param {import('pg').PoolClient} client
 * @param {string} bookingId UUID
 */
export async function releaseSeatLegAllocationsForBooking(client, bookingId) {
  const fr = await client.query(`SELECT DISTINCT flight_id FROM sm_seat_leg_allocation WHERE booking_id = $1::uuid`, [
    bookingId
  ]);
  const ids = fr.rows.map((row) => String(row.flight_id));
  await client.query(`DELETE FROM sm_seat_leg_allocation WHERE booking_id = $1::uuid`, [bookingId]);
  if (ids.length) await refreshRmFlightBucketsFromAllocations(client, ids);
}
