/**
 * If no `Authorization` header, copy JWT from `hams_token` cookie (httpOnly session mode).
 */
export function bearerFromCookie(req, _res, next) {
  try {
    if (req.headers.authorization?.startsWith('Bearer ')) return next();
    const raw = req.cookies?.hams_token;
    if (raw && String(raw).length > 20) {
      req.headers.authorization = `Bearer ${String(raw)}`;
    }
  } catch {
    /* ignore */
  }
  next();
}
