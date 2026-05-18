import type { NextRequest } from 'next/server';

/** Server-only Railway/VPS API base (Vercel env). */
export function getBackendInternalUrl(): string {
  const raw = process.env.HAMS_BACKEND_INTERNAL_URL || process.env.HAMS_API_PROXY_TARGET;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().replace(/\/+$/, '');
  // Fallback when ops set NEXT_PUBLIC_API_URL to the public Railway URL only.
  const pub = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (pub && /^https?:\/\//i.test(pub)) return pub.replace(/\/+$/, '');
  return '';
}

export function backendNotConfiguredResponse() {
  return Response.json(
    {
      error: 'API backend not configured',
      hint: 'Set HAMS_BACKEND_INTERNAL_URL on Vercel (Production) and redeploy.'
    },
    { status: 503 }
  );
}

/** Known misconfiguration: api.* DNS is not the HAMS API host. */
function misconfiguredBackendResponse(base: string) {
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (host === 'api.hawanaairways.com') {
      return Response.json(
        {
          error: 'Invalid backend URL on Vercel',
          hint:
            'api.hawanaairways.com does not resolve to the HAMS API. In Vercel Production, set HAMS_BACKEND_INTERNAL_URL to your Railway URL (https://YOUR-SERVICE.up.railway.app), set NEXT_PUBLIC_API_URL=/api, remove any api.hawanaairways.com values, then redeploy.',
          configured: base
        },
        { status: 503 }
      );
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Proxy a request to the HAMS backend (Path B). */
export async function proxyToBackend(
  req: NextRequest,
  backendPath: string
): Promise<Response> {
  const base = getBackendInternalUrl();
  if (!base) return backendNotConfiguredResponse();
  const misconfigured = misconfiguredBackendResponse(base);
  if (misconfigured) return misconfigured;

  const search = req.nextUrl.search || '';
  const url = `${base}${backendPath.startsWith('/') ? backendPath : `/${backendPath}`}${search}`;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual'
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    return Response.json(
      {
        error: 'Backend unreachable',
        message: `Could not reach HAMS API at ${base}. Check Railway service health and HAMS_BACKEND_INTERNAL_URL on Vercel.`,
        detail: msg
      },
      { status: 502 }
    );
  }

  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete('transfer-encoding');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}
