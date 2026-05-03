/**
 * Fare calculation from master data: route fares, fare classes, taxes, fees.
 */

export async function resolveRouteIdByFlightAirports(client, depIata, arrIata) {
  const r = await client.query(
    `SELECT r.id
     FROM md_routes r
     JOIN md_airports o ON o.id = r.origin_airport_id
     JOIN md_airports d ON d.id = r.dest_airport_id
     WHERE UPPER(o.iata_code) = UPPER($1) AND UPPER(d.iata_code) = UPPER($2) AND r.is_active = TRUE
     LIMIT 1`,
    [depIata, arrIata]
  );
  return r.rows[0]?.id || null;
}

export async function getRouteFareAmount(client, routeId, fareClassId) {
  const r = await client.query(
    `SELECT amount, currency
     FROM md_route_fares
     WHERE route_id = $1 AND fare_class_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [routeId, fareClassId]
  );
  return r.rows[0] || null;
}

export async function getFareClassRow(client, fareClassId) {
  const r = await client.query(
    `SELECT id, code, name, booking_class, is_active FROM md_fare_classes WHERE id = $1`,
    [fareClassId]
  );
  return r.rows[0] || null;
}

export async function loadActiveTaxes(client) {
  const r = await client.query(
    `SELECT code, name, rate_percent, applies_to, sort_order
     FROM md_tax_settings
     WHERE is_active = TRUE
     ORDER BY sort_order ASC, code ASC`
  );
  return r.rows;
}

export async function loadActiveFees(client) {
  const r = await client.query(
    `SELECT code, name, amount_fixed, rate_percent
     FROM md_fee_settings
     WHERE is_active = TRUE
     ORDER BY code ASC`
  );
  return r.rows;
}

/**
 * @returns {{ outboundPerPax: number, inboundPerPax: number, totalPerPax: number, currency: string, bookingClass: string, breakdown: object[] }}
 */
export async function computeItineraryPricing(client, { outboundFlight, inboundFlight, tripType, fareClassId }) {
  const fc = await getFareClassRow(client, fareClassId);
  if (!fc || !fc.is_active) {
    throw new Error('INVALID_FARE_CLASS');
  }

  const outRoute = await resolveRouteIdByFlightAirports(
    client,
    outboundFlight.departure_airport,
    outboundFlight.arrival_airport
  );
  if (!outRoute) throw new Error('NO_ROUTE_FOR_OUTBOUND');
  const outFare = await getRouteFareAmount(client, outRoute, fareClassId);
  if (!outFare) throw new Error('NO_ROUTE_FARE_FOR_OUTBOUND');

  let inboundPerPax = 0;
  if (tripType === 'RETURN' && inboundFlight) {
    const inRoute = await resolveRouteIdByFlightAirports(
      client,
      inboundFlight.departure_airport,
      inboundFlight.arrival_airport
    );
    if (!inRoute) throw new Error('NO_ROUTE_FOR_INBOUND');
    const inFare = await getRouteFareAmount(client, inRoute, fareClassId);
    if (!inFare) throw new Error('NO_ROUTE_FARE_FOR_INBOUND');
    inboundPerPax = Number(inFare.amount);
    if (String(inFare.currency) !== String(outFare.currency)) throw new Error('CURRENCY_MISMATCH_LEGS');
  }

  const outboundPerPax = Number(outFare.amount);
  const currency = String(outFare.currency);
  const subtotal = outboundPerPax + inboundPerPax;
  const breakdown = [
    { code: 'BASE_OUT', label: 'Outbound base fare', amount: outboundPerPax },
    ...(inboundPerPax > 0 ? [{ code: 'BASE_IN', label: 'Inbound base fare', amount: inboundPerPax }] : [])
  ];

  const taxes = await loadActiveTaxes(client);
  const fees = await loadActiveFees(client);

  let running = subtotal;

  for (const t of taxes.filter((x) => x.applies_to === 'SUBTOTAL')) {
    const amt = (subtotal * Number(t.rate_percent)) / 100;
    breakdown.push({ code: t.code, label: t.name, amount: amt, type: 'tax', applies: 'SUBTOTAL' });
    running += amt;
  }

  for (const f of fees) {
    const fixed = Number(f.amount_fixed);
    const pct = (subtotal * Number(f.rate_percent)) / 100;
    const amt = fixed + pct;
    if (amt !== 0) {
      breakdown.push({ code: f.code, label: f.name, amount: amt, type: 'fee' });
      running += amt;
    }
  }

  for (const t of taxes.filter((x) => x.applies_to === 'TOTAL')) {
    const amt = (running * Number(t.rate_percent)) / 100;
    breakdown.push({ code: t.code, label: t.name, amount: amt, type: 'tax', applies: 'TOTAL' });
    running += amt;
  }

  const totalPerPax = breakdown.reduce((s, b) => s + Number(b.amount), 0);

  return {
    outboundPerPax,
    inboundPerPax,
    totalPerPax,
    currency,
    bookingClass: fc.booking_class,
    breakdown
  };
}
