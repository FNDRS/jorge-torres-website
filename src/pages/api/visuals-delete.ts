import type { APIRoute } from 'astro';
import { del } from '@vercel/blob';
import { VISUAL_BLOB_PREFIX, isGalleryMediaPathname } from '../../lib/blob-visuals';
import { readServerEnv } from '../../lib/server-env';

export const prerender = false;

const MAX_BODY = 4096;

function isSafeGalleryPathname(pathname: string): boolean {
  const p = pathname.trim();
  if (!p.startsWith(VISUAL_BLOB_PREFIX)) return false;
  if (p.includes('..') || p.includes('\\')) return false;
  if (!isGalleryMediaPathname(p)) return false;
  return true;
}

export const POST: APIRoute = async ({ request }) => {
  const expected = readServerEnv('VISUALS_UPLOAD_SECRET');
  if (!expected?.length) {
    return new Response(JSON.stringify({ error: 'VISUALS_UPLOAD_SECRET is not configured on the server' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const blobToken = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!blobToken?.length) {
    return new Response(JSON.stringify({ error: 'BLOB_READ_WRITE_TOKEN is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY) {
    return new Response(JSON.stringify({ error: 'Body too large' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { pathname?: string };
  try {
    body = JSON.parse(raw) as { pathname?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pathname = typeof body.pathname === 'string' ? body.pathname : '';
  if (!pathname || !isSafeGalleryPathname(pathname)) {
    return new Response(JSON.stringify({ error: 'Invalid pathname' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await del(pathname, { token: blobToken });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Delete failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
