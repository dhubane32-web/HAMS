/**
 * Promo code validation: dates, usage limit, optional route scope, discount math.
 */

export class PromoValidationError extends Error {
  constructor(key, message) {
    super(message);
    this.name = 'PromoValidationError';
    this.key = key;
  }
}

function toDateStr(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}

export async function validateAndLockPromo(client, { code, travelDate, origin, dest, subtotal }) {
  const trimmed = String(code || '').trim();
  if (!trimmed) {
    return { discountAmount: 0, promo: null };
  }

  const r = await client.query(
    `SELECT * FROM sales_promo_codes WHERE upper(code) = upper($1) AND active = TRUE FOR UPDATE`,
    [trimmed]
  );
  const promo = r.rows[0];
  if (!promo) {
    throw new PromoValidationError('PROMO_NOT_FOUND', 'Promo code not found or inactive.');
  }

  const td = toDateStr(travelDate);
  if (!td) {
    throw new PromoValidationError('PROMO_BAD_DATE', 'Travel date is required to apply a promo code.');
  }

  const vf = toDateStr(promo.valid_from);
  const vu = toDateStr(promo.valid_until);
  if (td < vf || td > vu) {
    throw new PromoValidationError('PROMO_EXPIRED', 'Promo code is not valid for this travel date.');
  }

  if (Number(promo.used_count) >= Number(promo.usage_limit)) {
    throw new PromoValidationError('PROMO_USAGE_EXHAUSTED', 'Promo code has reached its usage limit.');
  }

  const routeRows = await client.query(`SELECT 1 FROM sales_route_promotions WHERE promo_code_id = $1 LIMIT 1`, [
    promo.id
  ]);
  if (routeRows.rowCount > 0) {
    const m = await client.query(
      `SELECT 1 FROM sales_route_promotions
       WHERE promo_code_id = $1
         AND upper(origin_airport) = upper($2)
         AND upper(dest_airport) = upper($3)
       LIMIT 1`,
      [promo.id, String(origin || '').trim(), String(dest || '').trim()]
    );
    if (m.rowCount === 0) {
      throw new PromoValidationError('PROMO_ROUTE_MISMATCH', 'Promo code does not apply to this route.');
    }
  }

  const base = Number(subtotal);
  if (!Number.isFinite(base) || base <= 0) {
    throw new PromoValidationError('PROMO_BAD_SUBTOTAL', 'Invalid fare total for promo application.');
  }

  const dtype = String(promo.discount_type || '').toUpperCase();
  let discount = 0;
  if (dtype === 'PERCENT') {
    const pct = Number(promo.discount_value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new PromoValidationError('PROMO_CONFIG', 'Promo percentage is misconfigured.');
    }
    discount = Math.round(base * (pct / 100) * 100) / 100;
  } else if (dtype === 'FIXED_AMOUNT') {
    const fixed = Number(promo.discount_value);
    if (!Number.isFinite(fixed) || fixed < 0) {
      throw new PromoValidationError('PROMO_CONFIG', 'Promo fixed amount is misconfigured.');
    }
    discount = Math.min(fixed, base);
  } else {
    throw new PromoValidationError('PROMO_CONFIG', 'Unknown discount type.');
  }

  discount = Math.min(discount, base);
  discount = Math.round(discount * 100) / 100;

  return { discountAmount: discount, promo };
}

export async function incrementPromoUsage(client, promoId) {
  const u = await client.query(
    `UPDATE sales_promo_codes
     SET used_count = used_count + 1
     WHERE id = $1 AND used_count < usage_limit
     RETURNING id, used_count`,
    [promoId]
  );
  if (u.rowCount === 0) {
    throw new PromoValidationError('PROMO_USAGE_RACE', 'Promo code could not be applied (usage limit).');
  }
}
