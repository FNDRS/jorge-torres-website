import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../lib/admin-auth';
import { getFile, putFile, triggerDeploy } from '../../../lib/github-api';

export const prerender = false;

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0] ?? null;
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const parts = u.pathname.split('/');
      const si = parts.indexOf('shorts');
      if (si !== -1) return parts[si + 1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) return new Response('Unauthorized', { status: 401 });

  const body = (await request.json()) as { url?: string; embeddable?: boolean };
  const videoId = body.url ? extractVideoId(body.url) : null;
  if (!videoId) return new Response('URL de YouTube inválida', { status: 400 });

  const filePath = 'src/lib/local-visuals.ts';
  const file = await getFile(filePath);
  if (!file) return new Response('local-visuals.ts no encontrado', { status: 500 });

  const embedStr = body.embeddable === false ? ", embeddable: false" : '';
  const entry = `  { provider: 'youtube', videoId: '${videoId}', addedAt: '${new Date().toISOString()}'${embedStr} },`;

  const updated = file.content.replace(/(const EMBEDS[^=]+=\s*\[)/, `$1\n${entry}`);
  if (updated === file.content) return new Response('No se encontró el array EMBEDS', { status: 500 });

  await putFile(filePath, updated, `admin: add YouTube video ${videoId}`, file.sha);
  await triggerDeploy();
  return new Response(JSON.stringify({ ok: true, videoId }), { status: 200 });
};
