const isProd = process.env.NODE_ENV === 'production';

/**
 * Last middleware: never leak stack traces in production.
 */
export function productionErrorHandler(err, _req, res, _next) {
  const status = Number(err?.status || err?.statusCode || 500);
  const safe = status >= 400 && status < 600 ? status : 500;
  if (isProd) {
    console.error('[hams]', err?.message || err);
    return res.status(safe).json({ message: 'Request failed.' });
  }
  console.error(err);
  return res.status(safe).json({ message: err?.message || 'Request failed.', error: String(err?.stack || err) });
}
