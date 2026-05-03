/**
 * Crew assignment rules: availability, license/medical/training validity, rest between duties.
 */

const REST_HOURS = 10;
export const CABIN_SAFETY_TRAINING_CODE = 'CABIN_SAFETY';

export async function assertCrewAssignableForFlight(client, { crewUserId, flightId }) {
  const user = await client.query(`SELECT id, role::text AS role FROM users WHERE id = $1`, [crewUserId]);
  if (!user.rows[0]) {
    return { ok: false, status: 404, message: 'User not found.' };
  }
  if (user.rows[0].role !== 'crew') {
    return { ok: false, status: 400, message: 'User is not a crew role.' };
  }

  const profile = await client.query(`SELECT crew_category FROM crew_profiles WHERE user_id = $1`, [crewUserId]);
  if (!profile.rows[0]) {
    return { ok: false, status: 400, message: 'Crew profile is required before assignment.' };
  }

  const f = await client.query(
    `SELECT departure_time, arrival_time, status FROM flights WHERE id = $1`,
    [flightId]
  );
  if (!f.rows[0]) {
    return { ok: false, status: 404, message: 'Flight not found.' };
  }
  if (String(f.rows[0].status || '').toUpperCase() === 'CANCELLED') {
    return { ok: false, status: 400, message: 'Cannot assign crew to a cancelled flight.' };
  }

  const dep = f.rows[0].departure_time;
  const arr = f.rows[0].arrival_time;
  const depDate = new Date(dep).toISOString().slice(0, 10);

  const unav = await client.query(
    `SELECT 1 FROM crew_availability
     WHERE user_id = $1 AND status = 'UNAVAILABLE'
       AND period_start < $3::timestamptz AND period_end > $2::timestamptz`,
    [crewUserId, dep, arr]
  );
  if (unav.rowCount > 0) {
    return { ok: false, status: 409, message: 'Crew is marked unavailable for this flight period.' };
  }

  const rest = await client.query(`SELECT MAX(rest_until) AS ru FROM crew_duty_logs WHERE user_id = $1`, [crewUserId]);
  const ru = rest.rows[0]?.ru;
  if (ru && new Date(ru) > new Date(dep)) {
    return {
      ok: false,
      status: 409,
      message: `Rest requirement: crew is not cleared until ${new Date(ru).toISOString()}.`
    };
  }

  const cat = String(profile.rows[0].crew_category || '').toUpperCase();
  if (cat === 'PILOT') {
    const lic = await client.query(
      `SELECT 1 FROM crew_licenses
       WHERE user_id = $1 AND is_active = TRUE
         AND UPPER(license_type) IN ('ATPL', 'CPL', 'FO')
         AND expiry_date >= $2::date`,
      [crewUserId, depDate]
    );
    if (lic.rowCount === 0) {
      return {
        ok: false,
        status: 400,
        message: 'Pilot requires an active ATPL, CPL, or FO license expiring on or after the flight date.'
      };
    }
    const med = await client.query(
      `SELECT 1 FROM crew_medicals WHERE user_id = $1 AND is_active = TRUE AND expiry_date >= $2::date`,
      [crewUserId, depDate]
    );
    if (med.rowCount === 0) {
      return {
        ok: false,
        status: 400,
        message: 'Pilot requires an active medical certificate valid on the flight date.'
      };
    }
  } else if (cat === 'CABIN') {
    const tr = await client.query(
      `SELECT 1 FROM crew_training
       WHERE user_id = $1 AND UPPER(training_code) = $2
         AND (expiry_date IS NULL OR expiry_date >= $3::date)`,
      [crewUserId, CABIN_SAFETY_TRAINING_CODE, depDate]
    );
    if (tr.rowCount === 0) {
      return {
        ok: false,
        status: 400,
        message: `Cabin crew requires training code ${CABIN_SAFETY_TRAINING_CODE} with no expiry or expiry on/after the flight date.`
      };
    }
  }

  return { ok: true };
}

export async function recordDutyAfterAssignment(client, { crewUserId, flightId }) {
  const f = await client.query(`SELECT departure_time, arrival_time FROM flights WHERE id = $1`, [flightId]);
  if (!f.rows[0]) return;
  const dep = new Date(f.rows[0].departure_time);
  const arr = new Date(f.rows[0].arrival_time);
  const minutes = Math.max(1, Math.round((arr.getTime() - dep.getTime()) / 60000));
  const restUntil = new Date(arr.getTime() + REST_HOURS * 3600 * 1000);
  await client.query(
    `INSERT INTO crew_duty_logs (user_id, flight_id, duty_start, duty_end, rest_until, duty_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, flight_id) DO UPDATE SET
       duty_start = EXCLUDED.duty_start,
       duty_end = EXCLUDED.duty_end,
       rest_until = EXCLUDED.rest_until,
       duty_minutes = EXCLUDED.duty_minutes`,
    [crewUserId, flightId, dep.toISOString(), arr.toISOString(), restUntil.toISOString(), minutes]
  );
}

export async function deleteDutyLogForAssignment(client, { crewUserId, flightId }) {
  await client.query(`DELETE FROM crew_duty_logs WHERE user_id = $1 AND flight_id = $2`, [crewUserId, flightId]);
}

export async function deleteDutyLogsForFlight(client, flightId) {
  await client.query(`DELETE FROM crew_duty_logs WHERE flight_id = $1`, [flightId]);
}
