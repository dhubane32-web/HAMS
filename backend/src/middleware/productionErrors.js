import { logError } from '../lib/safeLog.js';
import { logSystemEvent } from '../services/systemLogService.js';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Last middleware: never leak stack traces in production.
 */
export function productionErrorHandler(err, req, res, _next) {
  const status = Number(err?.status || err?.statusCode || 500);
  const safe = status >= 400 && status < 600 ? status : 500;
  if (isProd) {
    logError('[hams] request failed', err, {
      method: req?.method,
      path: (req?.originalUrl || req?.url || '').split('?')[0],
      status: safe
    });
    if (safe >= 500) {
      void logSystemEvent({
        level: 'error',
        category: 'api',
        action: 'HTTP_5XX',
        message: err?.message || 'server error',
        metadata: {
          method: req?.method,
          path: (req?.originalUrl || req?.url || '').split('?')[0],
          status: safe
        }
      });
    }
    return res.status(safe).json({ message: 'Request failed.' });
  }
  console.error(err);
  return res.status(safe).json({ message: err?.message || 'Request failed.', error: String(err?.stack || err) });
}
