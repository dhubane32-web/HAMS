import { getPublicApiBaseUrl } from '@/lib/api-base';

type ApiJsonOptions = RequestInit & {
  endpointTag?: string;
  timeoutMs?: number;
  retries?: number;
};

const DEFAULT_TIMEOUT_MS = 28_000;
const DEFAULT_RETRIES = 2;

function endpointLabel(path: string, tag?: string): string {
  return tag || path;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiFetch(path: string, init?: ApiJsonOptions): Promise<Response> {
  const base = getPublicApiBaseUrl();
  const url = `${base}${path}`;
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = init?.retries ?? DEFAULT_RETRIES;
  const { timeoutMs: _t, retries: _r, endpointTag, ...fetchInit } = init ?? {};

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, fetchInit, timeoutMs);
    } catch (error) {
      lastError = error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[api][network][${endpointLabel(path, endpointTag)}]`, {
          url,
          method: fetchInit.method || 'GET',
          error: error instanceof Error ? error.message : String(error),
          aborted
        });
      }
      throw new Error(
        aborted
          ? 'Request timed out. The operations server may be busy — try again.'
          : 'No data yet. Backend service is unreachable.'
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Backend service is unreachable.');
}

export async function apiFetchJson<T = unknown>(path: string, init?: ApiJsonOptions): Promise<T> {
  const response = await apiFetch(path, init);
  const text = await response.text();
  let body: { message?: string; error?: string } & Partial<T> = {};
  if (text) {
    try {
      body = JSON.parse(text) as { message?: string; error?: string } & T;
    } catch {
      body = {};
    }
  }
  if (!response.ok) {
    const msg =
      body.message ||
      body.error ||
      (response.status === 502
        ? 'Backend unreachable. Check Railway deployment and Vercel HAMS_BACKEND_INTERNAL_URL.'
        : `Request failed (${response.status})`);
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[api][http][${endpointLabel(path, init?.endpointTag)}]`, {
        status: response.status,
        method: init?.method || 'GET',
        message: msg
      });
    }
    throw new Error(msg);
  }
  return body as T;
}
