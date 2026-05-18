import type { NextRequest } from 'next/server';
import { isDeadApiHost, sanitizeBackendUrl } from '@/lib/dead-api-host';

/** Server-only Railway/VPS API base (Vercel env). Ignores dead api.hawanaairways.com. */
export function getBackendInternalUrl(): string {
  const internal = sanitizeBackendUrl(
    process.env.HAMS_BACKEND_INTERNAL_URL || process.env.HAMS_API_PROXY_TARGET
  );
  if (internal) return internal;
  const pub = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (pub && /^https?:\/\//i.test(pub) && !isDeadApiHost(pub)) return pub.replace(/\/+$/, '');
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

/** Proxy a request to the HAMS backend (Path B). */
export async function proxyToBackend(
  req: NextRequest,
  backendPath: string
): Promise<Response> {
  const base = getBackendInternalUrl();
  if (!base) {
    return Response.json(
      {
        error: 'API backend not configured',
        hint:
          'Remove api.hawanaairways.com from Vercel Production env. Set HAMS_BACKEND_INTERNAL_URL=https://YOUR-SERVICE.up.railway.app, NEXT_PUBLIC_API_URL=/api, NEXT_PUBLIC_USE_API_PROXY=true, then redeploy with clear cache.'
      },
      { status: 503 }
    );
  }

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
