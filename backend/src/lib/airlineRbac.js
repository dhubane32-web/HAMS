/**
 * Airline-style role groups for Express route guards.
 * Super Admin inherits wherever `admin` is allowed (`userHasAnyRole` in roles.js).
 */

/** Check-in desk: DCS lookup, seats, boarding docs, passenger check-in. */
export const ROLES_CHECKIN_DESK = ['admin', 'checkin_agent', 'agent', 'operations'];

/** Close / reopen flight for check-in (operations control). */
export const ROLES_CHECKIN_OPS = ['admin', 'operations'];

/** Gate boarding scan and status. */
export const ROLES_BOARDING = ['admin', 'checkin_agent', 'agent', 'operations'];

/** Booking list, search, create, PNR read, cancel, update notes — not finance-only reports. */
export const ROLES_BOOKING_DESK = ['admin', 'booking_agent', 'agent', 'customer_service', 'sales_manager'];

/** Record payments on a booking (desk + finance back-office). */
export const ROLES_BOOKING_PAYMENTS = ['admin', 'booking_agent', 'agent', 'customer_service', 'sales_manager', 'finance'];

/** Issue e-tickets after payment rules (not customer service). */
export const ROLES_TICKET_ISSUE = ['admin', 'booking_agent', 'agent', 'sales_manager'];

/** E-ticket / invoice / receipt PDFs and email. */
export const ROLES_TICKET_DOCS = ['admin', 'booking_agent', 'agent', 'sales_manager', 'finance'];

/** Finance module: ledger, expenses, org-wide dashboards. */
export const ROLES_FINANCE_ORG = ['admin', 'super_admin', 'finance', 'sales_manager'];

/** Refund request queue: finance sees all; desk roles may see own where handler filters. */
export const ROLES_REFUND_QUEUE = ['admin', 'finance', 'agent', 'booking_agent', 'customer_service', 'sales_manager'];

/** Create a refund request (not approval). */
export const ROLES_REFUND_REQUEST = ['admin', 'finance', 'agent', 'booking_agent', 'customer_service', 'sales_manager'];

/** Operations control center (no passenger desk, no maintenance UI). */
export const ROLES_OPS_READ = ['admin', 'operations'];

/** Flight day list: ops + maintenance (tail assignment context, no manifest). */
export const ROLES_OPS_FLIGHTS_LIST = ['admin', 'operations', 'maintenance'];

/** Flight detail / manifest-style payload. */
export const ROLES_OPS_FLIGHT_DETAIL = ['admin', 'operations'];

/** Mutating operations (schedules, status, crew, dispatch). */
export const ROLES_OPS_WRITE = ['admin', 'operations'];
