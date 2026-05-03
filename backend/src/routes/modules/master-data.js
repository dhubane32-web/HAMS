import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { computeItineraryPricing } from '../../services/masterDataPricing.js';

const router = express.Router();
const writeAdmin = [requireAuth, requireRoles('admin')];
const readCatalog = [requireAuth, requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager')];

async function catalogRows(label, queryText, params = []) {
  try {
    const r = await pool.query(queryText, params);
    return r.rows;
  } catch (e) {
    console.warn(`[master-data] catalog ${label} skipped:`, e?.message || e);
    return [];
  }
}

/** Catalog for booking / ops UIs (read-only for non-admin). */
router.get('/catalog/booking', ...readCatalog, async (_req, res) => {
  const [fareClasses, paymentMethods, currencies, airports] = await Promise.all([
    catalogRows(
      'fareClasses',
      `SELECT id, code, name, booking_class FROM md_fare_classes WHERE is_active = TRUE ORDER BY code`
    ),
    catalogRows(
      'paymentMethods',
      `SELECT id, code, name FROM md_payment_methods WHERE is_active = TRUE ORDER BY code`
    ),
    catalogRows('currencies', `SELECT id, code, name FROM md_currencies WHERE is_active = TRUE ORDER BY code`),
    catalogRows(
      'airports',
      `SELECT id, iata_code, name FROM md_airports WHERE is_active = TRUE ORDER BY iata_code`
    )
  ]);
  return res.json({
    fareClasses,
    paymentMethods,
    currencies,
    airports
  });
});

router.get('/pricing-preview', ...readCatalog, async (req, res) => {
  const { outboundFlightId, inboundFlightId, fareClassId, tripType = 'ONE_WAY' } = req.query;
  if (!outboundFlightId || !fareClassId) {
    return res.status(400).json({ message: 'outboundFlightId and fareClassId are required.' });
  }
  const client = await pool.connect();
  try {
    const out = await client.query(`SELECT * FROM flights WHERE id = $1`, [outboundFlightId]);
    if (!out.rows[0]) return res.status(404).json({ message: 'Outbound flight not found.' });
    let inbound = null;
    if (String(tripType).toUpperCase() === 'RETURN' && inboundFlightId) {
      const inR = await client.query(`SELECT * FROM flights WHERE id = $1`, [inboundFlightId]);
      inbound = inR.rows[0] || null;
      if (!inbound) return res.status(404).json({ message: 'Inbound flight not found.' });
    }
    const pricing = await computeItineraryPricing(client, {
      outboundFlight: out.rows[0],
      inboundFlight: inbound,
      tripType: String(tripType).toUpperCase(),
      fareClassId
    });
    return res.json(pricing);
  } catch (e) {
    const code = e.message;
    const map = {
      INVALID_FARE_CLASS: [400, 'Invalid or inactive fare class.'],
      NO_ROUTE_FOR_OUTBOUND: [400, 'No active master-data route for outbound airports.'],
      NO_ROUTE_FOR_INBOUND: [400, 'No active master-data route for inbound airports.'],
      NO_ROUTE_FARE_FOR_OUTBOUND: [400, 'No route fare for this fare class (outbound).'],
      NO_ROUTE_FARE_FOR_INBOUND: [400, 'No route fare for this fare class (inbound).'],
      CURRENCY_MISMATCH_LEGS: [400, 'Inbound and outbound fares use different currencies.']
    };
    const m = map[code];
    if (m) return res.status(m[0]).json({ message: m[1] });
    return res.status(500).json({ message: 'Pricing preview failed.', error: e.message });
  } finally {
    client.release();
  }
});

/* ---------- Countries ---------- */
router.get('/countries', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_countries ORDER BY name`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/countries', ...writeAdmin, async (req, res) => {
  const { iso2, name, is_active = true } = req.body;
  if (!iso2 || !name) return res.status(400).json({ message: 'iso2 and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_countries (iso2, name, is_active) VALUES (UPPER($1), $2, $3) RETURNING *`,
      [String(iso2).slice(0, 2), name, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/countries/:id', ...writeAdmin, async (req, res) => {
  const { iso2, name, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_countries SET iso2 = COALESCE(UPPER($1), iso2), name = COALESCE($2, name), is_active = COALESCE($3, is_active) WHERE id = $4 RETURNING *`,
      [iso2 ? String(iso2).slice(0, 2) : null, name || null, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/countries/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_countries WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Cities ---------- */
router.get('/cities', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.*, co.iso2 as country_iso2 FROM md_cities c JOIN md_countries co ON co.id = c.country_id ORDER BY c.name`
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/cities', ...writeAdmin, async (req, res) => {
  const { country_id, name, iata_code, is_active = true } = req.body;
  if (!country_id || !name) return res.status(400).json({ message: 'country_id and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_cities (country_id, name, iata_code, is_active) VALUES ($1, $2, $3, $4) RETURNING *`,
      [country_id, name, iata_code || null, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/cities/:id', ...writeAdmin, async (req, res) => {
  const { country_id, name, iata_code, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_cities SET country_id = COALESCE($1::uuid, country_id), name = COALESCE($2, name), iata_code = COALESCE($3, iata_code), is_active = COALESCE($4, is_active) WHERE id = $5::uuid RETURNING *`,
      [country_id || null, name || null, iata_code, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/cities/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_cities WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Currencies ---------- */
router.get('/currencies', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_currencies ORDER BY code`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/currencies', ...writeAdmin, async (req, res) => {
  const { code, name, decimal_places = 2, is_active = true } = req.body;
  if (!code || !name) return res.status(400).json({ message: 'code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_currencies (code, name, decimal_places, is_active) VALUES (UPPER($1), $2, $3, $4) RETURNING *`,
      [String(code).slice(0, 3), name, decimal_places, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/currencies/:id', ...writeAdmin, async (req, res) => {
  const { code, name, decimal_places, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_currencies SET code = COALESCE(UPPER($1), code), name = COALESCE($2, name), decimal_places = COALESCE($3, decimal_places), is_active = COALESCE($4, is_active) WHERE id = $5::uuid RETURNING *`,
      [code ? String(code).slice(0, 3) : null, name || null, decimal_places, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/currencies/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_currencies WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Airports ---------- */
router.get('/airports', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, c.iso2 AS country_iso2, ci.name AS city_name
       FROM md_airports a
       LEFT JOIN md_countries c ON c.id = a.country_id
       LEFT JOIN md_cities ci ON ci.id = a.city_id
       ORDER BY a.iata_code`
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/airports', ...writeAdmin, async (req, res) => {
  const { iata_code, name, country_id, city_id, timezone, is_active = true } = req.body;
  if (!iata_code || !name) return res.status(400).json({ message: 'iata_code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_airports (iata_code, name, country_id, city_id, timezone, is_active)
       VALUES (UPPER($1), $2, $3, $4, $5, $6) RETURNING *`,
      [String(iata_code).slice(0, 3), name, country_id || null, city_id || null, timezone || null, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/airports/:id', ...writeAdmin, async (req, res) => {
  const { iata_code, name, country_id, city_id, timezone, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_airports SET
         iata_code = COALESCE(UPPER($1), iata_code),
         name = COALESCE($2, name),
         country_id = COALESCE($3, country_id),
         city_id = COALESCE($4, city_id),
         timezone = COALESCE($5, timezone),
         is_active = COALESCE($6, is_active)
       WHERE id = $7::uuid RETURNING *`,
      [
        iata_code ? String(iata_code).slice(0, 3) : null,
        name || null,
        country_id,
        city_id,
        timezone,
        is_active,
        req.params.id
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/airports/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_airports WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Routes (origin / dest airports) ---------- */
router.get('/routes', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.*, o.iata_code AS origin_iata, d.iata_code AS dest_iata
       FROM md_routes r
       JOIN md_airports o ON o.id = r.origin_airport_id
       JOIN md_airports d ON d.id = r.dest_airport_id
       ORDER BY o.iata_code, d.iata_code`
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/routes', ...writeAdmin, async (req, res) => {
  const { origin_airport_id, dest_airport_id, distance_nm, is_active = true } = req.body;
  if (!origin_airport_id || !dest_airport_id) {
    return res.status(400).json({ message: 'origin_airport_id and dest_airport_id required.' });
  }
  if (origin_airport_id === dest_airport_id) {
    return res.status(400).json({ message: 'Origin and destination must differ.' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm, is_active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [origin_airport_id, dest_airport_id, distance_nm ?? null, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/routes/:id', ...writeAdmin, async (req, res) => {
  const { origin_airport_id, dest_airport_id, distance_nm, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_routes SET
         origin_airport_id = COALESCE($1::uuid, origin_airport_id),
         dest_airport_id = COALESCE($2::uuid, dest_airport_id),
         distance_nm = COALESCE($3, distance_nm),
         is_active = COALESCE($4, is_active)
       WHERE id = $5::uuid RETURNING *`,
      [origin_airport_id, dest_airport_id, distance_nm, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/routes/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_routes WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Aircraft types ---------- */
router.get('/aircraft-types', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_aircraft_types ORDER BY code`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/aircraft-types', ...writeAdmin, async (req, res) => {
  const { code, name, default_seat_capacity = 150, is_active = true } = req.body;
  if (!code || !name) return res.status(400).json({ message: 'code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_aircraft_types (code, name, default_seat_capacity, is_active) VALUES ($1, $2, $3, $4) RETURNING *`,
      [code, name, default_seat_capacity, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/aircraft-types/:id', ...writeAdmin, async (req, res) => {
  const { code, name, default_seat_capacity, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_aircraft_types SET code = COALESCE($1, code), name = COALESCE($2, name), default_seat_capacity = COALESCE($3, default_seat_capacity), is_active = COALESCE($4, is_active) WHERE id = $5::uuid RETURNING *`,
      [code, name, default_seat_capacity, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/aircraft-types/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_aircraft_types WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Seat maps ---------- */
router.get('/seat-maps', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, t.code AS aircraft_type_code FROM md_seat_maps s JOIN md_aircraft_types t ON t.id = s.aircraft_type_id ORDER BY s.name`
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/seat-maps', ...writeAdmin, async (req, res) => {
  const { name, aircraft_type_id, layout_json = {}, is_active = true } = req.body;
  if (!name || !aircraft_type_id) return res.status(400).json({ message: 'name and aircraft_type_id required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_seat_maps (name, aircraft_type_id, layout_json, is_active) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
      [name, aircraft_type_id, JSON.stringify(layout_json), is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/seat-maps/:id', ...writeAdmin, async (req, res) => {
  const { name, aircraft_type_id, layout_json, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_seat_maps SET name = COALESCE($1, name), aircraft_type_id = COALESCE($2::uuid, aircraft_type_id), layout_json = COALESCE($3::jsonb, layout_json), is_active = COALESCE($4, is_active) WHERE id = $5::uuid RETURNING *`,
      [name, aircraft_type_id, layout_json != null ? JSON.stringify(layout_json) : null, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/seat-maps/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_seat_maps WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Aircraft records (aircraft table) ---------- */
router.get('/aircraft-records', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, t.code AS aircraft_type_code, s.name AS seat_map_name
       FROM aircraft a
       LEFT JOIN md_aircraft_types t ON t.id = a.aircraft_type_id
       LEFT JOIN md_seat_maps s ON s.id = a.seat_map_id
       ORDER BY a.tail_number`
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/aircraft-records', ...writeAdmin, async (req, res) => {
  const { tail_number, model, seat_capacity, release_status = 'RELEASED', aircraft_type_id, seat_map_id } = req.body;
  if (!tail_number || !model || !seat_capacity) {
    return res.status(400).json({ message: 'tail_number, model, seat_capacity required.' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO aircraft (tail_number, model, seat_capacity, release_status, aircraft_type_id, seat_map_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [String(tail_number).toUpperCase(), model, seat_capacity, release_status, aircraft_type_id || null, seat_map_id || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/aircraft-records/:id', ...writeAdmin, async (req, res) => {
  const { tail_number, model, seat_capacity, release_status, aircraft_type_id, seat_map_id } = req.body;
  try {
    const r = await pool.query(
      `UPDATE aircraft SET
         tail_number = COALESCE(UPPER($1), tail_number),
         model = COALESCE($2, model),
         seat_capacity = COALESCE($3, seat_capacity),
         release_status = COALESCE($4, release_status),
         aircraft_type_id = COALESCE($5::uuid, aircraft_type_id),
         seat_map_id = COALESCE($6::uuid, seat_map_id)
       WHERE id = $7::uuid RETURNING *`,
      [tail_number, model, seat_capacity, release_status, aircraft_type_id, seat_map_id, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/aircraft-records/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM aircraft WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Fare classes ---------- */
router.get('/fare-classes', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_fare_classes ORDER BY code`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/fare-classes', ...writeAdmin, async (req, res) => {
  const { code, name, booking_class = 'ECONOMY', description, is_active = true } = req.body;
  if (!code || !name) return res.status(400).json({ message: 'code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_fare_classes (code, name, booking_class, description, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [code, name, booking_class, description || null, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/fare-classes/:id', ...writeAdmin, async (req, res) => {
  const { code, name, booking_class, description, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_fare_classes SET code = COALESCE($1, code), name = COALESCE($2, name), booking_class = COALESCE($3, booking_class), description = COALESCE($4, description), is_active = COALESCE($5, is_active) WHERE id = $6::uuid RETURNING *`,
      [code, name, booking_class, description, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/fare-classes/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_fare_classes WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Route fares ---------- */
router.get('/route-fares', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT rf.*, o.iata_code || '-' || d.iata_code AS route_label, fc.code AS fare_class_code
       FROM md_route_fares rf
       JOIN md_routes r ON r.id = rf.route_id
       JOIN md_airports o ON o.id = r.origin_airport_id
       JOIN md_airports d ON d.id = r.dest_airport_id
       JOIN md_fare_classes fc ON fc.id = rf.fare_class_id
       ORDER BY route_label, fc.code`
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/route-fares', ...writeAdmin, async (req, res) => {
  const { route_id, fare_class_id, amount, currency = 'USD', is_active = true } = req.body;
  if (!route_id || !fare_class_id || amount == null) {
    return res.status(400).json({ message: 'route_id, fare_class_id, amount required.' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO md_route_fares (route_id, fare_class_id, amount, currency, is_active) VALUES ($1, $2, $3, UPPER($4), $5) RETURNING *`,
      [route_id, fare_class_id, amount, String(currency).slice(0, 3), is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/route-fares/:id', ...writeAdmin, async (req, res) => {
  const { route_id, fare_class_id, amount, currency, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_route_fares SET route_id = COALESCE($1::uuid, route_id), fare_class_id = COALESCE($2::uuid, fare_class_id), amount = COALESCE($3, amount), currency = COALESCE(UPPER($4), currency), is_active = COALESCE($5, is_active) WHERE id = $6::uuid RETURNING *`,
      [route_id, fare_class_id, amount, currency ? String(currency).slice(0, 3) : null, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/route-fares/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_route_fares WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Tax / fee / payment / baggage ---------- */
router.get('/tax-settings', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_tax_settings ORDER BY sort_order, code`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/tax-settings', ...writeAdmin, async (req, res) => {
  const { code, name, rate_percent = 0, applies_to = 'SUBTOTAL', sort_order = 0, is_active = true } = req.body;
  if (!code || !name) return res.status(400).json({ message: 'code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_tax_settings (code, name, rate_percent, applies_to, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code, name, rate_percent, applies_to, sort_order, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/tax-settings/:id', ...writeAdmin, async (req, res) => {
  const { code, name, rate_percent, applies_to, sort_order, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_tax_settings SET code = COALESCE($1, code), name = COALESCE($2, name), rate_percent = COALESCE($3, rate_percent), applies_to = COALESCE($4, applies_to), sort_order = COALESCE($5, sort_order), is_active = COALESCE($6, is_active) WHERE id = $7::uuid RETURNING *`,
      [code, name, rate_percent, applies_to, sort_order, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/tax-settings/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_tax_settings WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/fee-settings', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_fee_settings ORDER BY code`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/fee-settings', ...writeAdmin, async (req, res) => {
  const { code, name, amount_fixed = 0, rate_percent = 0, is_active = true } = req.body;
  if (!code || !name) return res.status(400).json({ message: 'code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_fee_settings (code, name, amount_fixed, rate_percent, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [code, name, amount_fixed, rate_percent, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/fee-settings/:id', ...writeAdmin, async (req, res) => {
  const { code, name, amount_fixed, rate_percent, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_fee_settings SET code = COALESCE($1, code), name = COALESCE($2, name), amount_fixed = COALESCE($3, amount_fixed), rate_percent = COALESCE($4, rate_percent), is_active = COALESCE($5, is_active) WHERE id = $6::uuid RETURNING *`,
      [code, name, amount_fixed, rate_percent, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/fee-settings/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_fee_settings WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/payment-methods', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_payment_methods ORDER BY code`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/payment-methods', ...writeAdmin, async (req, res) => {
  const { code, name, is_active = true } = req.body;
  if (!code || !name) return res.status(400).json({ message: 'code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_payment_methods (code, name, is_active) VALUES ($1, $2, $3) RETURNING *`,
      [code, name, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/payment-methods/:id', ...writeAdmin, async (req, res) => {
  const { code, name, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_payment_methods SET code = COALESCE($1, code), name = COALESCE($2, name), is_active = COALESCE($3, is_active) WHERE id = $4::uuid RETURNING *`,
      [code, name, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/payment-methods/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_payment_methods WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/baggage-rules', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.*, o.iata_code || '-' || d.iata_code AS route_label
       FROM md_baggage_rules b
       LEFT JOIN md_routes r ON r.id = b.route_id
       LEFT JOIN md_airports o ON o.id = r.origin_airport_id
       LEFT JOIN md_airports d ON d.id = r.dest_airport_id
       ORDER BY b.created_at DESC`
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/baggage-rules', ...writeAdmin, async (req, res) => {
  const {
    route_id,
    fare_class_id,
    free_pieces = 1,
    free_weight_kg = 23,
    max_weight_per_piece_kg = 32,
    charge_per_kg_over = 0,
    currency = 'USD',
    is_active = true
  } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO md_baggage_rules (route_id, fare_class_id, free_pieces, free_weight_kg, max_weight_per_piece_kg, charge_per_kg_over, currency, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, UPPER($7), $8) RETURNING *`,
      [route_id || null, fare_class_id || null, free_pieces, free_weight_kg, max_weight_per_piece_kg, charge_per_kg_over, String(currency).slice(0, 3), is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/baggage-rules/:id', ...writeAdmin, async (req, res) => {
  const b = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_baggage_rules SET
         route_id = COALESCE($1::uuid, route_id),
         fare_class_id = COALESCE($2::uuid, fare_class_id),
         free_pieces = COALESCE($3, free_pieces),
         free_weight_kg = COALESCE($4, free_weight_kg),
         max_weight_per_piece_kg = COALESCE($5, max_weight_per_piece_kg),
         charge_per_kg_over = COALESCE($6, charge_per_kg_over),
         currency = COALESCE(UPPER($7), currency),
         is_active = COALESCE($8, is_active)
       WHERE id = $9::uuid RETURNING *`,
      [
        b.route_id,
        b.fare_class_id,
        b.free_pieces,
        b.free_weight_kg,
        b.max_weight_per_piece_kg,
        b.charge_per_kg_over,
        b.currency ? String(b.currency).slice(0, 3) : null,
        b.is_active,
        req.params.id
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/baggage-rules/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_baggage_rules WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Departments ---------- */
router.get('/departments', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_departments ORDER BY name`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.post('/departments', ...writeAdmin, async (req, res) => {
  const { code, name, parent_id, is_active = true } = req.body;
  if (!code || !name) return res.status(400).json({ message: 'code and name required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_departments (code, name, parent_id, is_active) VALUES ($1, $2, $3, $4) RETURNING *`,
      [code, name, parent_id || null, is_active]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/departments/:id', ...writeAdmin, async (req, res) => {
  const { code, name, parent_id, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE md_departments SET code = COALESCE($1, code), name = COALESCE($2, name), parent_id = COALESCE($3::uuid, parent_id), is_active = COALESCE($4, is_active) WHERE id = $5::uuid RETURNING *`,
      [code, name, parent_id, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/departments/:id', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_departments WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- Role definitions (metadata for user_role enum) ---------- */
router.get('/role-definitions', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_role_definitions ORDER BY role_key`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/role-definitions/:roleKey', ...writeAdmin, async (req, res) => {
  const { display_name, description } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO md_role_definitions (role_key, display_name, description)
       VALUES ($1::user_role, $2, $3)
       ON CONFLICT (role_key) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description, updated_at = NOW()
       RETURNING *`,
      [req.params.roleKey, display_name, description || null]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ---------- System preferences ---------- */
router.get('/system-preferences', ...readCatalog, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM md_system_preferences ORDER BY pref_key`);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.put('/system-preferences/:key', ...writeAdmin, async (req, res) => {
  const { pref_value, value_type = 'STRING' } = req.body;
  if (pref_value == null) return res.status(400).json({ message: 'pref_value required.' });
  try {
    const r = await pool.query(
      `INSERT INTO md_system_preferences (pref_key, pref_value, value_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (pref_key) DO UPDATE SET pref_value = EXCLUDED.pref_value, value_type = EXCLUDED.value_type, updated_at = NOW()
       RETURNING *`,
      [req.params.key, String(pref_value), value_type]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.delete('/system-preferences/:key', ...writeAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM md_system_preferences WHERE pref_key = $1`, [req.params.key]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
