/**
 * Booking payment_status from payment rows and refunds (net of refunds per payment).
 */

export async function sumNetPaidForBooking(client, bookingId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(
       CASE
         WHEN UPPER(TRIM(p.payment_status)) IN ('PENDING', 'FAILED') THEN 0::numeric
         ELSE GREATEST(
           0::numeric,
           p.amount::numeric - COALESCE(rf.refunded, 0::numeric)
         )
       END
     ), 0)::numeric AS paid
     FROM payments p
     LEFT JOIN (
       SELECT payment_id, SUM(refund_amount)::numeric AS refunded
       FROM refunds
       GROUP BY payment_id
     ) rf ON rf.payment_id = p.id
     WHERE p.booking_id = $1`,
    [bookingId]
  );
  return Number(r.rows[0].paid);
}

export async function syncBookingPaymentStatus(client, bookingId) {
  const b = await client.query(`SELECT total_amount, payment_status FROM bookings WHERE id = $1`, [bookingId]);
  if (!b.rows[0]) return;
  if (String(b.rows[0].payment_status || '').toUpperCase() === 'REFUNDED') return;

  const total = Number(b.rows[0].total_amount);
  const paid = await sumNetPaidForBooking(client, bookingId);
  const refundExists = await client.query(
    `SELECT 1 FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.booking_id = $1 LIMIT 1`,
    [bookingId]
  );

  const payMix = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE UPPER(TRIM(payment_status)) IN ('PAID', 'SUCCESS'))::int AS paid_rows,
       COUNT(*) FILTER (WHERE UPPER(TRIM(payment_status)) = 'PENDING')::int AS pending_rows,
       COUNT(*) FILTER (WHERE UPPER(TRIM(payment_status)) = 'FAILED')::int AS failed_rows
     FROM payments WHERE booking_id = $1`,
    [bookingId]
  );
  const mix = payMix.rows[0] || { paid_rows: 0, pending_rows: 0, failed_rows: 0 };

  let status = 'UNPAID';
  if (total <= 0) {
    status = 'PAID';
  } else if (paid >= total) {
    status = 'PAID';
  } else if (paid > 0) {
    status = 'PARTIALLY_PAID';
  } else if (refundExists.rowCount > 0) {
    status = 'REFUNDED';
  } else if (Number(mix.paid_rows) === 0 && Number(mix.pending_rows) > 0) {
    status = 'PENDING';
  } else if (Number(mix.paid_rows) === 0 && Number(mix.failed_rows) > 0 && Number(mix.pending_rows) === 0) {
    status = 'FAILED';
  } else {
    status = 'UNPAID';
  }

  await client.query(`UPDATE bookings SET payment_status = $2 WHERE id = $1`, [bookingId, status]);
}
