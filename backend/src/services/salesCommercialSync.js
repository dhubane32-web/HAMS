import { logFinanceTransaction } from './financeLedger.js';

/**
 * Upsert CRM aggregates for passengers on a booking.
 * @param {import('pg').PoolClient} client
 */
export async function syncCrmCustomersForBooking(client, bookingId) {
  const q = await client.query(
    `SELECT b.id, b.total_amount, b.created_at,
            f.departure_airport || '→' || f.arrival_airport AS route_key
     FROM bookings b
     JOIN booking_flights bf ON bf.booking_id = b.id AND bf.leg_type = 'OUTBOUND'
     JOIN flights f ON f.id = bf.flight_id
     WHERE b.id = $1`,
    [bookingId]
  );
  const row = q.rows[0];
  if (!row) return;

  const pax = await client.query(
    `SELECT DISTINCT bp.passenger_id
     FROM booking_passengers bp WHERE bp.booking_id = $1`,
    [bookingId]
  );

  for (const { passenger_id } of pax.rows) {
    await client.query(
      `INSERT INTO sm_crm_customers (passenger_id, status, total_spend, booking_count, preferred_routes_json, last_booking_at, updated_at)
       VALUES ($1, 'ACTIVE', $2, 1, jsonb_build_array($3::text), $4::timestamptz, NOW())
       ON CONFLICT (passenger_id) DO UPDATE SET
         total_spend = sm_crm_customers.total_spend + EXCLUDED.total_spend,
         booking_count = sm_crm_customers.booking_count + 1,
         preferred_routes_json = coalesce(sm_crm_customers.preferred_routes_json, '[]'::jsonb) || jsonb_build_array($3::text),
         last_booking_at = EXCLUDED.last_booking_at,
         updated_at = NOW()`,
      [passenger_id, Number(row.total_amount || 0), row.route_key, row.created_at]
    );
  }
}

/**
 * Log structured promo usage per booking (in addition to sales_promo_codes.used_count).
 */
export async function recordPromoUsageRow(client, { promoCodeId, bookingId, discountAmount }) {
  if (!promoCodeId) return;
  await client.query(
    `INSERT INTO sm_promo_usage (promo_code_id, booking_id, discount_amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (promo_code_id, booking_id) DO UPDATE SET discount_amount = EXCLUDED.discount_amount, used_at = NOW()`,
    [promoCodeId, bookingId, Number(discountAmount || 0)]
  );
}

/**
 * After tickets are issued: loyalty miles + travel-agent commission accrual (finance-linked).
 * Idempotent: skips if commission row already exists for booking.
 */
export async function postTicketCommercialHooks(client, bookingId, userId) {
  const b = await client.query(
    `SELECT id, pnr, total_amount, currency, travel_agent_id, sales_channel_code, corporate_account_id
     FROM bookings WHERE id = $1`,
    [bookingId]
  );
  const booking = b.rows[0];
  if (!booking) return;

  const tc = await client.query(`SELECT COUNT(*)::int AS c FROM tickets WHERE booking_id = $1`, [bookingId]);
  const pc = await client.query(`SELECT COUNT(*)::int AS c FROM booking_passengers WHERE booking_id = $1`, [
    bookingId
  ]);
  if (Number(tc.rows[0]?.c || 0) < Number(pc.rows[0]?.c || 0)) return;

  const existingComm = await client.query(`SELECT 1 FROM sm_agent_commissions WHERE booking_id = $1 LIMIT 1`, [
    bookingId
  ]);

  let rate = null;
  let agentId = booking.travel_agent_id;
  if (agentId) {
    const ag = await client.query(
      `SELECT commission_percent, approval_status FROM sales_travel_agents WHERE id = $1`,
      [agentId]
    );
    const ap = ag.rows[0];
    if (ap && String(ap.approval_status).toUpperCase() === 'APPROVED' && ap.commission_percent != null) {
      rate = Number(ap.commission_percent);
    }
  }
  if (rate == null && booking.sales_channel_code) {
    const ch = await client.query(`SELECT default_commission_pct FROM sm_sales_channels WHERE code = $1`, [
      booking.sales_channel_code
    ]);
    if (ch.rows[0]) rate = Number(ch.rows[0].default_commission_pct || 0);
  }
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    rate = 0;
  }

  const base = Number(booking.total_amount || 0);
  const amt = Math.round(base * (rate / 100) * 100) / 100;
  if (existingComm.rowCount === 0 && amt > 0) {
    await client.query(
      `INSERT INTO sm_agent_commissions (
        booking_id, ticket_id, travel_agent_id, channel_code, base_amount, commission_rate, commission_amount, currency, status, rule_snapshot
      ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'ACCRUED', $8::jsonb)`,
      [
        bookingId,
        agentId,
        booking.sales_channel_code || 'DIRECT_WEB',
        base,
        rate,
        amt,
        booking.currency || 'USD',
        JSON.stringify({ source: 'post_ticket', pnr: booking.pnr })
      ]
    );
    await logFinanceTransaction(client, {
      txnType: 'COMMISSION_ACCRUED',
      amount: amt,
      currency: booking.currency || 'USD',
      bookingId,
      description: `Sales commission accrual (${rate}% ) PNR ${booking.pnr}`,
      metadata: { travelAgentId: agentId, channel: booking.sales_channel_code },
      userId
    });
  }

  const milesPer = Math.max(0, Math.floor(base / 50));
  if (milesPer <= 0) return;

  const loyaltyDone = await client.query(`SELECT 1 FROM sm_loyalty_transactions WHERE booking_id = $1 LIMIT 1`, [
    bookingId
  ]);
  if (loyaltyDone.rowCount > 0) return;

  const paxRows = await client.query(
    `SELECT DISTINCT passenger_id FROM booking_passengers WHERE booking_id = $1`,
    [bookingId]
  );
  for (const { passenger_id } of paxRows.rows) {
    await client.query(
      `INSERT INTO sm_loyalty_accounts (passenger_id, miles_balance, tier)
       VALUES ($1, 0, 'SILVER')
       ON CONFLICT (passenger_id) DO NOTHING`,
      [passenger_id]
    );
    const ex = await client.query(`SELECT id, miles_balance FROM sm_loyalty_accounts WHERE passenger_id = $1`, [
      passenger_id
    ]);
    const loyaltyId = ex.rows[0]?.id;
    if (!loyaltyId) continue;

    await client.query(
      `INSERT INTO sm_loyalty_transactions (loyalty_account_id, txn_type, miles, booking_id, description)
       VALUES ($1, 'EARN', $2, $3, $4)`,
      [loyaltyId, milesPer, bookingId, `Miles for ticket revenue on ${booking.pnr}`]
    );
    const newBal = Number(ex.rows[0].miles_balance || 0) + milesPer;
    const tier =
      newBal >= 50000 ? 'PLATINUM' : newBal >= 15000 ? 'GOLD' : 'SILVER';
    await client.query(
      `UPDATE sm_loyalty_accounts SET miles_balance = miles_balance + $2, tier = $3, updated_at = NOW() WHERE id = $1`,
      [loyaltyId, milesPer, tier]
    );
  }
}
