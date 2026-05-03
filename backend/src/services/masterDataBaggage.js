/**
 * Baggage allowance from md_baggage_rules (route + optional fare class).
 */

export async function findBaggageRule(client, { depIata, arrIata, fareClassId }) {
  const routeRes = await client.query(
    `SELECT r.id
     FROM md_routes r
     JOIN md_airports o ON o.id = r.origin_airport_id
     JOIN md_airports d ON d.id = r.dest_airport_id
     WHERE UPPER(o.iata_code) = UPPER($1) AND UPPER(d.iata_code) = UPPER($2) AND r.is_active = TRUE
     LIMIT 1`,
    [depIata, arrIata]
  );
  const routeId = routeRes.rows[0]?.id;
  if (!routeId) return null;

  if (fareClassId) {
    const spec = await client.query(
      `SELECT * FROM md_baggage_rules
       WHERE is_active = TRUE AND route_id = $1 AND fare_class_id = $2
       LIMIT 1`,
      [routeId, fareClassId]
    );
    if (spec.rows[0]) return spec.rows[0];
  }

  const routeOnly = await client.query(
    `SELECT * FROM md_baggage_rules
     WHERE is_active = TRUE AND route_id = $1 AND fare_class_id IS NULL
     LIMIT 1`,
    [routeId]
  );
  if (routeOnly.rows[0]) return routeOnly.rows[0];

  const global = await client.query(
    `SELECT * FROM md_baggage_rules
     WHERE is_active = TRUE AND route_id IS NULL AND fare_class_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return global.rows[0] || null;
}

/**
 * @param bags [{ weightKg, pieces }]
 */
export async function evaluateBaggageAllowance(client, { depIata, arrIata, fareClassId, bags }) {
  const rule = await findBaggageRule(client, { depIata, arrIata, fareClassId });
  if (!rule) {
    return { allowed: true, excessKg: 0, excessPieces: 0, charge: 0, rule: null };
  }

  const totalKg = bags.reduce((s, b) => s + Number(b.weightKg || 0) * Number(b.pieces || 1), 0);
  const totalPieces = bags.reduce((s, b) => s + Number(b.pieces || 1), 0);

  const freeKg = Number(rule.free_weight_kg);
  const freePieces = Number(rule.free_pieces);
  const maxPerPiece = Number(rule.max_weight_per_piece_kg);
  const chargePerKg = Number(rule.charge_per_kg_over);

  for (const b of bags) {
    const w = Number(b.weightKg);
    const p = Number(b.pieces || 1);
    if (w > maxPerPiece) {
      return {
        allowed: false,
        reason: `A single bag may not exceed ${maxPerPiece} kg (rule for this route).`,
        rule
      };
    }
  }

  let excessKg = Math.max(0, totalKg - freeKg);
  const excessPieces = Math.max(0, totalPieces - freePieces);
  if (excessPieces > 0) {
    excessKg += excessPieces * 5;
  }

  const charge = excessKg * chargePerKg;
  return {
    allowed: true,
    excessKg,
    excessPieces,
    charge,
    currency: rule.currency,
    rule
  };
}
