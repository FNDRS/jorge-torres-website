import type { APIRoute } from 'astro';
import { del, list } from '@vercel/blob';
import {
  VISUAL_BLOB_PREFIX,
  isGalleryMediaPathname,
  isReservedVisualPathname,
} from '../../lib/blob-visuals';
import { removeGalleryPackById } from '../../lib/gallery-image-manifest';
import { readServerEnv } from '../../lib/server-env';

export const prerender = false;

const MAX_BODY = 4096;

function extractPackId(pathname: string): string | null {
  const m = pathname.trim().match(/^visuals\/g\/([a-f0-9-]{36})(?:\/|$)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

function isSafeGalleryPathname(pathname: string): boolean {
  const p = pathname.trim();
  if (!p.startsWith(VISUAL_BLOB_PREFIX)) return false;
  if (p.includes('..') || p.includes('\\')) return false;
  if (extractPackId(p)) return true;
  if (!isGalleryMediaPathname(p)) return false;
  if (isReservedVisualPathname(p)) return false;
  return true;
}

async function deleteBlobsUnderPrefix(prefix: string, token: string): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const { blobs, hasMore, cursor: nextCursor } = await list({
      prefix,
      limit: 500,
      token,
      ...(cursor ? { cursor } : {}),
    });
    for (const b of blobs) {
      await del(b.pathname, { token });
    }
    if (!hasMore) break;
    cursor = nextCursor;
    if (!cursor) break;
  }
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
    const packId = extractPackId(pathname);
    if (packId) {
      await deleteBlobsUnderPrefix(`${VISUAL_BLOB_PREFIX}g/${packId}/`, blobToken);
      await removeGalleryPackById(packId);
    } else {
      await del(pathname, { token: blobToken });
    }
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
