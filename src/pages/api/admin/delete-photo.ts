import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../lib/admin-auth';
import { getFile, putFile, triggerDeploy } from '../../../lib/github-api';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) return new Response('Unauthorized', { status: 401 });

  const { id } = (await request.json()) as { id?: string };
  if (!id) return new Response('Missing id', { status: 400 });

  const file = await getFile('src/lib/visuals-manifest.json');
  if (!file) return new Response('Manifest not found', { status: 500 });

  const manifest = JSON.parse(file.content) as { packs: { id: string }[] };
  const before = manifest.packs.length;
  manifest.packs = manifest.packs.filter((p) => p.id !== id);
  if (manifest.packs.length === before) return new Response('Photo not found', { status: 404 });

  await putFile(
    'src/lib/visuals-manifest.json',
    JSON.stringify(manifest, null, 2),
    `admin: delete photo ${id}`,
    file.sha,
  );
  await triggerDeploy();
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
