/**
 * Expected production schema — tables/columns referenced by HAMS backend.
 * Used for startup audits and health checks (non-destructive).
 */

export const REQUIRED_TABLES = [
  'users',
  'bookings',
  'flights',
  'audit_logs',
  'backup_logs',
  'sm_seat_leg_allocation',
  'flight_schedules',
  'aircraft_rotations',
  'dispatch_releases',
  'airport_slots',
  'turnaround_events',
  'operational_alerts',
  'occ_flight_event',
  'occ_delay_code_ref',
  'flight_delays'
];

export const OPTIONAL_TABLES = [
  'commercial_notifications',
  'commercial_booking_profiles',
  'hams_schema_migrations'
];

export const REQUIRED_COLUMNS = [
  { table: 'bookings', column: 'travel_agent_id' },
  { table: 'bookings', column: 'sales_channel_code' },
  { table: 'flights', column: 'eta_current_at' },
  { table: 'flights', column: 'eta_revised_at' },
  { table: 'flights', column: 'actual_off_block_at' }
];

/** Legacy/wrong names that should not exist after migration 008. */
export const DEPRECATED_COLUMNS = [
  { table: 'bookings', column: 'travelAgent_id' }
];
