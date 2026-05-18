import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { path: string[] } };

async function handle(req: NextRequest, { params }: Ctx) {
  const segments = params.path ?? [];
  return proxyToBackend(req, `/api/${segments.join('/')}`);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
