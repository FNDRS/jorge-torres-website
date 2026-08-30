import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../lib/admin-auth';
import { getFile, putFile, triggerDeploy } from '../../../lib/github-api';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) return new Response('Unauthorized', { status: 401 });

  const { videoId } = (await request.json()) as { videoId?: string };
  if (!videoId) return new Response('Missing videoId', { status: 400 });

  const filePath = 'src/lib/local-visuals.ts';
  const file = await getFile(filePath);
  if (!file) return new Response('local-visuals.ts not found', { status: 500 });

  const lines = file.content.split('\n');
  const filtered = lines.filter((l) => !l.includes(`videoId: '${videoId}'`));
  if (filtered.length === lines.length) return new Response('Video not found', { status: 404 });

  await putFile(filePath, filtered.join('\n'), `admin: delete YouTube video ${videoId}`, file.sha);
  await triggerDeploy();
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
