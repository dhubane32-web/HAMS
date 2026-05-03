/**
 * Append-only finance ledger for compliance and reporting.
 */

export async function logFinanceTransaction(client, row) {
  const {
    txnType,
    amount = null,
    currency = 'USD',
    bookingId = null,
    paymentId = null,
    refundId = null,
    refundRequestId = null,
    expenseId = null,
    description = null,
    metadata = null,
    userId = null
  } = row;

  await client.query(
    `INSERT INTO finance_transactions (
      txn_type, amount, currency, booking_id, payment_id, refund_id, refund_request_id, expense_id, description, metadata, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      String(txnType).slice(0, 50),
      amount === null || amount === undefined ? null : Number(amount),
      String(currency || 'USD').slice(0, 3).toUpperCase(),
      bookingId || null,
      paymentId || null,
      refundId || null,
      refundRequestId || null,
      expenseId || null,
      description ? String(description).slice(0, 2000) : null,
      metadata ? JSON.stringify(metadata) : null,
      userId || null
    ]
  );
}
