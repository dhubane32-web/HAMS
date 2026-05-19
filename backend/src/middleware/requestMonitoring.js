import { getConfig } from '../config/index.js';
import { recordRequest } from '../services/monitoringService.js';

/**
 * Track API latency and 5xx rates for operational monitoring.
 */
export function requestMonitoring(req, res, next) {
  const cfg = getConfig();
  if (!cfg.monitoring.enabled) return next();

  const t0 = Date.now();
  res.on('finish', () => {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    recordRequest({
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - t0
    });
  });
  next();
}
