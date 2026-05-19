/**
 * Emergency maintenance gate — returns 503 for all traffic except health probes.
 * Set HAMS_MAINTENANCE_MODE=true on Railway during DR or schema work.
 */
function isMaintenanceEnabled() {
  const raw = String(process.env.HAMS_MAINTENANCE_MODE || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

function maintenanceMessage() {
  return (
    process.env.HAMS_MAINTENANCE_MESSAGE?.trim() ||
    'HAMS is temporarily unavailable for scheduled maintenance. Please try again shortly.'
  );
}

function isHealthProbePath(pathname) {
  const p = String(pathname || '').split('?')[0];
  return (
    p === '/live' ||
    p === '/ready' ||
    p === '/health' ||
    p.startsWith('/health/')
  );
}

export function maintenanceMode(req, res, next) {
  if (!isMaintenanceEnabled()) return next();
  const path = (req.originalUrl || req.url || '').split('?')[0];
  if (isHealthProbePath(path)) return next();
  return res.status(503).json({
    message: maintenanceMessage(),
    maintenance: true
  });
}

export function isMaintenanceModeActive() {
  return isMaintenanceEnabled();
}
