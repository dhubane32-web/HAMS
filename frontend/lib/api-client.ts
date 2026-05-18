import { getPublicApiBaseUrl } from '@/lib/api-base';

type ApiJsonOptions = RequestInit & {
  endpointTag?: string;
};

function endpointLabel(path: string, tag?: string): string {
  return tag || path;
}

export async function apiFetch(path: string, init?: ApiJsonOptions): Promise<Response> {
  const base = getPublicApiBaseUrl();
  const url = `${base}${path}`;
  try {
    return await fetch(url, init);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[api][network][${endpointLabel(path, init?.endpointTag)}]`, {
        url,
        method: init?.method || 'GET',
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw new Error('No data yet. Backend service is unreachable.');
  }
}

export async function apiFetchJson<T = unknown>(path: string, init?: ApiJsonOptions): Promise<T> {
  const response = await apiFetch(path, init);
  const text = await response.text();
  let body: { message?: string } & Partial<T> = {};
  if (text) {
    try {
      body = JSON.parse(text) as { message?: string } & T;
    } catch {
      body = {};
    }
  }
  if (!response.ok && process.env.NODE_ENV !== 'production') {
    console.error(`[api][http][${endpointLabel(path, init?.endpointTag)}]`, {
      status: response.status,
      method: init?.method || 'GET',
      message: body.message || 'Request failed'
    });
    throw new Error(body.message || `Request failed (${response.status})`);
  }
  return body as T;
}
