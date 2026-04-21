import type { APIRoute } from 'astro';
import { getVisualsBlobStorageStats } from '../../lib/blob-visuals';
import { readServerEnv } from '../../lib/server-env';

export const prerender = false;

function parseQuotaMB(): number {
  const raw = readServerEnv('VISUALS_QUOTA_MB');
  if (!raw) return 500;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 500;
  return n;
}

export const GET: APIRoute = async ({ request }) => {
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

  if (!readServerEnv('BLOB_READ_WRITE_TOKEN')?.length) {
    return new Response(JSON.stringify({ error: 'BLOB_READ_WRITE_TOKEN is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const stats = await getVisualsBlobStorageStats();
    const quotaMB = parseQuotaMB();
    return new Response(
      JSON.stringify({
        usedBytes: stats.usedBytes,
        mediaFileCount: stats.mediaFileCount,
        quotaMB,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to read storage';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
