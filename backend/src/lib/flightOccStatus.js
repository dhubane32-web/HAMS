/**
 * Airline OCC-style flight status gates for passenger check-in and boarding workflows.
 */

export const OCC_STATUSES_ALLOW_PASSENGER_CHECKIN = ['CHECKIN_OPEN', 'BOARDING', 'DELAYED'];

/** Boarding scan / gate: allow once cabin is accepting movement to aircraft. */
export const OCC_STATUSES_ALLOW_BOARDING_OPS = ['CHECKIN_OPEN', 'BOARDING', 'GATE_CLOSED', 'DELAYED'];

/**
 * @param {string} status
 * @param {{ relaxScheduled?: boolean }} [opts] If relaxScheduled, also allow SCHEDULED (legacy / demos).
 */
export function isFlightOpenForPassengerCheckin(status, opts = {}) {
  const u = String(status || '').trim().toUpperCase();
  const allow = new Set(OCC_STATUSES_ALLOW_PASSENGER_CHECKIN);
  if (opts.relaxScheduled) allow.add('SCHEDULED');
  return allow.has(u);
}

export function isFlightOpenForBoardingOps(status) {
  const u = String(status || '').trim().toUpperCase();
  return new Set(OCC_STATUSES_ALLOW_BOARDING_OPS).has(u);
}
