import type { NextRequest } from 'next/server';

/** Server-only Railway/VPS API base (Vercel env). */
export function getBackendInternalUrl(): string {
  const raw = process.env.HAMS_BACKEND_INTERNAL_URL || process.env.HAMS_API_PROXY_TARGET;
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
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
  if (!base) return backendNotConfiguredResponse();

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

  const upstream = await fetch(url, init);
  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete('transfer-encoding');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}
