# HAMS production security

This document summarizes security controls implemented in the backend and frontend, and how to operate them in production.

## Production checklist (15 controls)

| # | Control | Status |
|---|---------|--------|
| 1 | Two-factor authentication (TOTP) | Implemented (`auth-totp.js`, encrypted secrets) |
| 2 | Session timeout (JWT + cookie Max-Age) | Implemented (`JWT_EXPIRES_IN`, `auth-session.ts`) |
| 3 | Role-based access + live role check | Implemented (`middleware/auth.js`, route `requireRoles`) |
| 4 | Password policy | Implemented (`passwordPolicy.js`) |
| 5 | Audit logs for sensitive actions | Implemented (`auditService.js`, finance reject/deposit, auth flows) |
| 6 | Login attempt limits | Implemented (rate limit + `failed_login_count`) |
| 7 | Account lockout | Implemented (`locked_until` after max failures; TOTP failures count) |
| 8 | Secure cookie settings | Implemented (`auth-session.ts`: SameSite/Secure/Max-Age) |
| 9 | CSRF protection | Implemented (`trustedOriginMutations.js` for mutating API calls) |
| 10 | API rate limiting | Implemented (`apiRateLimits.js`, mounted in `index.js`) |
| 11 | Encryption for sensitive data | Implemented (`cryptoField.js` AES-256-GCM for TOTP) |
| 12 | Environment secret validation | Implemented (`config/envValidation.js`) |
| 13 | Admin IP restriction (optional) | Implemented (`adminIpAllowlist.js` + `ADMIN_IP_ALLOWLIST`) |
| 14 | Secure file upload validation | Helpers ready (`middleware/fileUploadPolicy.js`); use when adding uploads |
| 15 | Security headers (CSP, HSTS, X-Frame-Options) | API: `securityHeaders.js`; app: `frontend/next.config.mjs` |

## Authentication and session

| Control | Implementation |
|--------|------------------|
| **Two-factor (TOTP)** | `backend/src/routes/auth-totp.js` — setup, confirm, disable, `POST /api/auth/login/2fa` after password login. Secrets stored with **AES-256-GCM** when `HAMS_ENCRYPTION_KEY` is set (`backend/src/lib/cryptoField.js`). |
| **Session timeout** | JWT access token; expiry from `JWT_EXPIRES_IN` (default **1h** in production, **8h** in dev). Claims include `iat`/`exp`. Frontend mirrors TTL on the session cookie via `expiresInSec` (`frontend/lib/auth-session.ts`). |
| **Role validation** | Every authenticated request in production optionally validates `users.is_active` and JWT `role` against the database (`backend/src/middleware/auth.js`). Disable with `HAMS_STRICT_SESSION=false` only for emergencies. |
| **Password policy** | `backend/src/lib/passwordPolicy.js` — length, character classes, common-password blocklist; used on reset and admin user creation. |

## Abuse prevention

| Control | Implementation |
|--------|------------------|
| **Login rate limit** | `authLoginLimiter` on `POST /api/auth/login` and `POST /api/auth/login/2fa` (`backend/src/middleware/apiRateLimits.js`). Stricter defaults in production. |
| **Password-reset abuse** | `authPasswordResetLimiter` on forgot/reset routes (`backend/src/index.js`). |
| **API rate limit** | `apiLimiter` on `/api/*` (`backend/src/index.js`). |
| **Account lockout** | After `HAMS_LOGIN_MAX_FAILED` bad passwords, `users.locked_until` is set (`backend/src/routes/auth.js`). Failed **TOTP** attempts increment the same counter (`auth-totp.js`). |

## Transport, headers, and CSRF

| Control | Implementation |
|--------|------------------|
| **Security headers** | `backend/src/middleware/securityHeaders.js` — Helmet: **HSTS** (prod), **X-Frame-Options: DENY**, nosniff, referrer policy, **CSP** for JSON API (`default-src 'none'`, `frame-ancestors 'none'`). |
| **Frontend headers** | `frontend/next.config.mjs` — CSP, HSTS, `X-Frame-Options`, etc., for the Next.js app. |
| **CSRF mitigation** | `backend/src/middleware/trustedOriginMutations.js` — in production, mutating requests must send `Origin` or `Referer` allowed by `FRONTEND_URL`, unless exempt auth paths or `HAMS_INTERNAL_API_KEY` trusted client headers. |

## Cookies

| Control | Implementation |
|--------|------------------|
| **Session cookie** | `persistSessionCookie` sets `SameSite=Strict` on HTTPS (non-localhost), `Secure` on HTTPS, `Path=/`, `Max-Age` aligned to JWT (`frontend/lib/auth-session.ts`). **Note:** The cookie is not `HttpOnly` because the SPA reads the JWT for `Authorization` headers; mitigate XSS with CSP and short JWT TTL. |

## Secrets and configuration

| Control | Implementation |
|--------|------------------|
| **Env validation** | `backend/src/config/envValidation.js` runs at startup in production: `JWT_SECRET` length, `FRONTEND_URL`, `DATABASE_URL`, `HAMS_ENCRYPTION_KEY`, `JWT_EXPIRES_IN` upper bound. |
| **Encryption** | TOTP seeds use `encryptField` / `decryptField` (`cryptoField.js`). Production requires `HAMS_ENCRYPTION_KEY` for 2FA storage. |

## Admin and uploads

| Control | Implementation |
|--------|------------------|
| **Admin IP restriction** | Optional `ADMIN_IP_ALLOWLIST` on `/api/system*` (`backend/src/middleware/adminIpAllowlist.js`). |
| **File uploads** | When multipart routes are added, use `backend/src/middleware/fileUploadPolicy.js` (magic-byte checks, safe filenames). |

## Audit logging

| Control | Implementation |
|--------|------------------|
| **Audit trail** | `backend/src/services/auditService.js` — `audit_logs` + `login_history`. Login, password reset, 2FA lifecycle, and sensitive finance actions are logged with IP and user-agent where schema supports it. |

## Implemented files (reference)

- `backend/src/index.js` — middleware order, rate limits, CORS, routes.
- `backend/src/routes/auth.js` — login, lockout, JWT, forgot/reset.
- `backend/src/routes/auth-totp.js` — TOTP, lockout on bad code.
- `backend/src/middleware/auth.js` — JWT + production DB session check.
- `backend/src/middleware/securityHeaders.js` — Helmet / CSP / HSTS.
- `backend/src/middleware/trustedOriginMutations.js` — CSRF-style origin gate.
- `backend/src/middleware/apiRateLimits.js` — rate limits.
- `backend/src/middleware/adminIpAllowlist.js` — optional admin IP allowlist.
- `backend/src/middleware/fileUploadPolicy.js` — upload validation helpers.
- `backend/src/config/envValidation.js` — production env checks.
- `backend/src/lib/passwordPolicy.js`, `backend/src/lib/loginSecurity.js`, `backend/src/lib/cryptoField.js`
- `frontend/next.config.mjs`, `frontend/lib/auth-session.ts`
