import helmet from 'helmet';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Security headers for the JSON API: CSP denies active content; HSTS in production.
 */
export function attachSecurityHeaders(app) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: { action: 'deny' },
      hsts: isProd
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: false
          }
        : false,
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      permittedCrossDomainPolicies: false,
      xssFilter: true
    })
  );
}
