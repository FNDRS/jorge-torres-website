import type { APIRoute } from 'astro';
import { put } from '@vercel/blob';
import { VISUAL_BLOB_PREFIX } from '../../lib/blob-visuals';

export const prerender = false;

/** Request body must fit in the function payload; raise only if your Vercel plan allows more. */
const MAX_BYTES = 50 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const trimmed = base.slice(0, 120);
  return trimmed.length > 0 ? trimmed : 'upload.bin';
}

export const POST: APIRoute = async ({ request }) => {
  const expected = process.env.VISUALS_UPLOAD_SECRET;
  if (!expected?.length) {
    return new Response(
      JSON.stringify({ error: 'VISUALS_UPLOAD_SECRET is not configured on the server' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN?.length) {
    return new Response(JSON.stringify({ error: 'BLOB_READ_WRITE_TOKEN is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid multipart body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = form.get('file');
  if (!file || !(file instanceof File) || file.size === 0) {
    return new Response(JSON.stringify({ error: 'Missing non-empty form field "file"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (file.size > MAX_BYTES) {
    return new Response(JSON.stringify({ error: `File exceeds ${MAX_BYTES / (1024 * 1024)}MB limit` }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^(image|video)\//.test(file.type)) {
    return new Response(JSON.stringify({ error: 'Only image/* or video/* uploads are allowed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pathname = `${VISUAL_BLOB_PREFIX}${sanitizeFilename(file.name)}`;
  const useMultipart = file.size > 4 * 1024 * 1024;

  try {
    const result = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: true,
      multipart: useMultipart,
    });

    return new Response(JSON.stringify({ url: result.url, pathname: result.pathname }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
