/**
 * OCC flight column detection — safe SQL when eta_current_at is not migrated yet.
 */

let cache = { at: 0, cols: new Set() };

const TRACKING_COLUMNS = [
  'eta_current_at',
  'eta_revised_at',
  'current_eta',
  'actual_off_block_at',
  'actual_airborne_at',
  'actual_landed_at'
];

export async function refreshFlightColumnCache(pool) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'flights'`
  );
  cache = { at: Date.now(), cols: new Set(r.rows.map((x) => x.column_name)) };
  return cache.cols;
}

export async function getFlightColumns(pool) {
  if (cache.cols.size && Date.now() - cache.at < 120_000) return cache.cols;
  return refreshFlightColumnCache(pool);
}

/** Apply idempotent OCC tracking columns (safe on every boot). */
export async function ensureOccEtaColumns(pool) {
  const statements = [
    'ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_off_block_at TIMESTAMPTZ',
    'ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_airborne_at TIMESTAMPTZ',
    'ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_landed_at TIMESTAMPTZ',
    'ALTER TABLE flights ADD COLUMN IF NOT EXISTS eta_current_at TIMESTAMPTZ',
    'ALTER TABLE flights ADD COLUMN IF NOT EXISTS eta_revised_at TIMESTAMPTZ',
    'ALTER TABLE flights ADD COLUMN IF NOT EXISTS current_eta TIMESTAMPTZ'
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
  return refreshFlightColumnCache(pool);
}

/**
 * SELECT list fragment for OCC dashboard / live (aliases preserved for API).
 */
export function buildOccFlightSelectFragments(cols, alias = 'f') {
  const etaParts = [];
  if (cols.has('eta_current_at')) etaParts.push(`${alias}.eta_current_at`);
  if (cols.has('eta_revised_at')) etaParts.push(`${alias}.eta_revised_at`);
  if (cols.has('current_eta')) etaParts.push(`${alias}.current_eta`);
  etaParts.push(`${alias}.arrival_time`);

  return {
    eta: `COALESCE(${etaParts.join(', ')}) AS eta_current_at`,
    actualOffBlock: cols.has('actual_off_block_at')
      ? `${alias}.actual_off_block_at`
      : 'NULL::timestamptz AS actual_off_block_at',
    actualAirborne: cols.has('actual_airborne_at')
      ? `${alias}.actual_airborne_at`
      : 'NULL::timestamptz AS actual_airborne_at',
    actualLanded: cols.has('actual_landed_at')
      ? `${alias}.actual_landed_at`
      : 'NULL::timestamptz AS actual_landed_at',
    hasEtaColumn: cols.has('eta_current_at')
  };
}

export async function queryOccDashboardFlights(pool, dateStr) {
  const cols = await getFlightColumns(pool);
  const f = buildOccFlightSelectFragments(cols, 'f');
  const r = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time,
            f.status, f.gate, f.aircraft_id,
            ${f.eta},
            ${f.actualOffBlock},
            ${f.actualAirborne},
            ${f.actualLanded},
            a.tail_number, a.model
     FROM flights f
     LEFT JOIN aircraft a ON a.id = f.aircraft_id
     WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
     ORDER BY f.departure_time ASC`,
    [dateStr]
  );
  return { rows: r.rows, schemaMode: f.hasEtaColumn ? 'full' : 'compat' };
}

export async function queryOccFlightLive(pool, flightId) {
  const cols = await getFlightColumns(pool);
  const f = buildOccFlightSelectFragments(cols, 'f');
  const r = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time,
            f.status, f.gate, f.aircraft_id,
            ${f.eta},
            ${f.actualOffBlock},
            ${f.actualAirborne},
            ${f.actualLanded},
            a.tail_number, a.model
     FROM flights f
     LEFT JOIN aircraft a ON a.id = f.aircraft_id
     WHERE f.id = $1::uuid`,
    [flightId]
  );
  return r.rows[0] || null;
}

export async function updateFlightEta(pool, flightId, etaIso) {
  const cols = await ensureOccEtaColumns(pool);
  if (!cols.has('eta_current_at')) {
    throw Object.assign(new Error('Could not add eta_current_at column.'), { code: 'SCHEMA' });
  }
  const r = await pool.query(
    `UPDATE flights SET eta_current_at = $2::timestamptz WHERE id = $1::uuid
     RETURNING id, flight_number, status, departure_time, arrival_time, eta_current_at,
       actual_off_block_at, actual_airborne_at, actual_landed_at`,
    [flightId, etaIso]
  );
  return r.rows[0] || null;
}
