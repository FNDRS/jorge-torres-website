import type { APIRoute } from 'astro';
import { put } from '@vercel/blob';
import { VISUAL_BLOB_PREFIX } from '../../lib/blob-visuals';
import { readServerEnv } from '../../lib/server-env';

export const prerender = false;

/** Request body must fit in the function payload; raise only if your Vercel plan allows more. */
const MAX_BYTES = 50 * 1024 * 1024;

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|m4v)$/i;

function isAllowedMedia(file: File): boolean {
  if (/^(image|video)\//.test(file.type)) return true;
  if (!file.type || file.type === 'application/octet-stream') {
    return MEDIA_EXT.test(file.name);
  }
  return false;
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const trimmed = base.slice(0, 120);
  return trimmed.length > 0 ? trimmed : 'upload.bin';
}

function blobUploadErrorResponse(message: string) {
  const isPrivateStore =
    /Cannot use public access on a private store/i.test(message) ||
    (/private store/i.test(message) && /public access/i.test(message));

  if (isPrivateStore) {
    return new Response(
      JSON.stringify({
        error:
          'El Blob store está en modo solo privado; no se pueden crear archivos públicos (la galería los muestra en el navegador).',
        hint:
          'En Vercel: Project → Storage → Blob → elige tu store → Settings y habilita acceso público a blobs, o crea un store nuevo con soporte público, vincúlalo al proyecto y actualiza BLOB_READ_WRITE_TOKEN.',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const expected = readServerEnv('VISUALS_UPLOAD_SECRET');
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

  const blobToken = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!blobToken?.length) {
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

  if (!isAllowedMedia(file)) {
    return new Response(
      JSON.stringify({
        error:
          'Only images or videos are allowed (image/*, video/*, or common extensions if the browser omits MIME type).',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const safeName = sanitizeFilename(file.name);
  if (safeName.toLowerCase() === '_youtube.json') {
    return new Response(
      JSON.stringify({ error: 'Reserved filename: visuals/_youtube.json is used for YouTube links.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const pathname = `${VISUAL_BLOB_PREFIX}${safeName}`;
  const useMultipart = file.size > 4 * 1024 * 1024;

  try {
    const result = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: true,
      multipart: useMultipart,
      token: blobToken,
    });

    return new Response(JSON.stringify({ url: result.url, pathname: result.pathname }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return blobUploadErrorResponse(message);
  }
};
