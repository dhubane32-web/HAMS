/**
 * Ticket coupons — one OPEN coupon per flight leg when tickets are issued.
 */

export function isMissingCouponSchema(err) {
  return err?.code === '42P01' && String(err?.message || '').includes('ticket_coupons');
}

export async function syncTicketCouponsForBooking(client, bookingId) {
  const tRes = await client.query(
    `SELECT t.id AS ticket_id, t.ticket_number, t.ticket_status
     FROM tickets t
     WHERE t.booking_id = $1 AND upper(trim(COALESCE(t.ticket_status, ''))) = 'ISSUED'`,
    [bookingId]
  );
  if (!tRes.rowCount) return { created: 0, updated: 0 };

  const legs = await client.query(
    `SELECT bf.id AS booking_flight_id, bf.fare_amount, bf.leg_sequence,
            b.currency, b.fare_tax_total, b.fare_base_total
     FROM booking_flights bf
     JOIN bookings b ON b.id = bf.booking_id
     WHERE bf.booking_id = $1
     ORDER BY bf.leg_sequence ASC, bf.leg_type ASC`,
    [bookingId]
  );
  if (!legs.rowCount) return { created: 0, updated: 0 };

  const legCount = legs.rows.length;
  const taxPerLeg =
    legCount > 0 ? Math.round((Number(legs.rows[0].fare_tax_total) || 0) / legCount * 100) / 100 : 0;
  let created = 0;

  for (const tkt of tRes.rows) {
    let seq = 0;
    for (const leg of legs.rows) {
      seq += 1;
      const ins = await client.query(
        `INSERT INTO ticket_coupons (
           ticket_id, booking_flight_id, coupon_number, coupon_status,
           fare_amount, tax_amount, currency
         )
         VALUES ($1, $2, $3, 'OPEN', $4, $5, $6)
         ON CONFLICT (ticket_id, booking_flight_id) DO NOTHING
         RETURNING id`,
        [
          tkt.ticket_id,
          leg.booking_flight_id,
          seq,
          leg.fare_amount,
          taxPerLeg,
          leg.currency || 'USD'
        ]
      );
      if (ins.rowCount) created += 1;
    }
  }
  return { created, updated: tRes.rowCount };
}

export async function voidTicketCoupons(client, ticketId, status = 'VOID') {
  await client.query(
    `UPDATE ticket_coupons SET coupon_status = $2 WHERE ticket_id = $1 AND coupon_status = 'OPEN'`,
    [ticketId, status]
  );
}
