import type { APIRoute } from 'astro';
import { parseYoutubeVideoId } from '../../lib/youtube-url';
import { parseVimeoId } from '../../lib/vimeo-url';
import {
  readYoutubeManifest,
  writeYoutubeManifest,
  type EmbedProvider,
  type GalleryEmbedEntry,
} from '../../lib/youtube-manifest';
import { readServerEnv } from '../../lib/server-env';

export const prerender = false;

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const expected = readServerEnv('VISUALS_UPLOAD_SECRET');
  if (!expected?.length) {
    return new Response(JSON.stringify({ error: 'VISUALS_UPLOAD_SECRET is not configured on the server' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return unauthorized();
  }
  if (!readServerEnv('BLOB_READ_WRITE_TOKEN')?.length) {
    return new Response(JSON.stringify({ error: 'BLOB_READ_WRITE_TOKEN is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const entries = await readYoutubeManifest();
    return new Response(JSON.stringify({ entries }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to read manifest';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

type PostBody = { action?: string; url?: string; videoId?: string; provider?: string };

function parseEmbedFromUrl(url: string): { provider: EmbedProvider; id: string } | null {
  const yt = parseYoutubeVideoId(url);
  if (yt) return { provider: 'youtube', id: yt };
  const vm = parseVimeoId(url);
  if (vm) return { provider: 'vimeo', id: vm };
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const expected = readServerEnv('VISUALS_UPLOAD_SECRET');
  if (!expected?.length) {
    return new Response(JSON.stringify({ error: 'VISUALS_UPLOAD_SECRET is not configured on the server' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return unauthorized();
  }
  if (!readServerEnv('BLOB_READ_WRITE_TOKEN')?.length) {
    return new Response(JSON.stringify({ error: 'BLOB_READ_WRITE_TOKEN is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const action = typeof body.action === 'string' ? body.action : '';

  try {
    const current = await readYoutubeManifest();

    if (action === 'add') {
      const url = typeof body.url === 'string' ? body.url : '';
      const parsed = parseEmbedFromUrl(url);
      if (!parsed) {
        return new Response(
          JSON.stringify({
            error: 'No se reconoció el enlace. Usa una URL de YouTube o de Vimeo (o el id numérico de Vimeo).',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (current.some((e) => e.provider === parsed.provider && e.videoId === parsed.id)) {
        return new Response(JSON.stringify({ error: 'Ese vídeo ya está en la galería.' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const entry: GalleryEmbedEntry = {
        provider: parsed.provider,
        videoId: parsed.id,
        addedAt: new Date().toISOString(),
      };
      const next: GalleryEmbedEntry[] = [entry, ...current];
      await writeYoutubeManifest(next);
      return new Response(JSON.stringify({ ok: true, entries: next }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'remove') {
      const provider: EmbedProvider = body.provider === 'vimeo' ? 'vimeo' : 'youtube';
      const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
      if (provider === 'youtube' && !/^[\w-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid YouTube video id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (provider === 'vimeo' && !/^\d{6,12}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid Vimeo video id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const next = current.filter((e) => !(e.provider === provider && e.videoId === videoId));
      if (next.length === current.length) {
        return new Response(JSON.stringify({ error: 'No está en el manifiesto.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      await writeYoutubeManifest(next);
      return new Response(JSON.stringify({ ok: true, entries: next }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action (use add or remove).' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update manifest';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
