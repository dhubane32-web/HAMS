/**
 * OCC flight timeline (occ_flight_event) + live status timestamps on flights.
 */

const OCC_SOURCES = new Set(['occ', 'booking', 'checkin', 'crew', 'finance', 'maintenance', 'system']);

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function recordOccFlightEvent(db, { flightId, eventType, sourceSystem = 'occ', payload = {}, userId = null }) {
  if (!flightId || !eventType) return;
  const src = OCC_SOURCES.has(sourceSystem) ? sourceSystem : 'occ';
  try {
    await db.query(
      `INSERT INTO occ_flight_event (flight_id, event_type, source_system, payload_json, created_by)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)`,
      [
        flightId,
        String(eventType).slice(0, 64),
        src,
        JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
        userId || null
      ]
    );
  } catch (e) {
    if (e?.code === '42P01' || e?.code === '42703') return;
    throw e;
  }
}

/**
 * Sets flight status and first-seen operational timestamps (OCC columns when migrated).
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function applyStatusWithTracking(db, { flightId, nextStatus, etaCurrentAt = null }) {
  const eta =
    etaCurrentAt != null && String(etaCurrentAt).trim() && !Number.isNaN(new Date(etaCurrentAt).getTime())
      ? new Date(etaCurrentAt).toISOString()
      : null;
  try {
    return await db.query(
      `UPDATE flights SET
        status = $2::varchar,
        actual_off_block_at = CASE WHEN $2::varchar = 'DEPARTED' AND actual_off_block_at IS NULL THEN NOW() ELSE actual_off_block_at END,
        actual_airborne_at = CASE WHEN $2::varchar = 'IN_AIR' AND actual_airborne_at IS NULL THEN NOW() ELSE actual_airborne_at END,
        actual_landed_at = CASE WHEN $2::varchar = 'ARRIVED' AND actual_landed_at IS NULL THEN NOW() ELSE actual_landed_at END,
        eta_current_at = COALESCE($3::timestamptz, eta_current_at)
       WHERE id = $1::uuid
       RETURNING id, flight_number, status, departure_time, arrival_time,
         actual_off_block_at, actual_airborne_at, actual_landed_at, eta_current_at`,
      [flightId, nextStatus, eta]
    );
  } catch (e) {
    if (e?.code === '42703') {
      return await db.query(
        `UPDATE flights SET status = $2::varchar WHERE id = $1::uuid
         RETURNING id, flight_number, status, departure_time, arrival_time`,
        [flightId, nextStatus]
      );
    }
    throw e;
  }
}
