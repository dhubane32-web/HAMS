import { isShuttingDown } from '../lib/gracefulShutdown.js';

/**
 * Abort long-running requests to protect worker stability under load.
 */
export function requestTimeout(ms = Number(process.env.HAMS_REQUEST_TIMEOUT_MS || 60_000)) {
  const timeoutMs = Math.max(5_000, Math.min(300_000, Number(ms) || 60_000));

  return (req, res, next) => {
    if (isShuttingDown()) {
      return res.status(503).json({ message: 'Server is shutting down.' });
    }
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        res.status(504).json({ message: 'Request timed out.' });
      }
    });
    next();
  };
}
