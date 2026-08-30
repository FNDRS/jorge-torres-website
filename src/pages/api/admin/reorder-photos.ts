import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../lib/admin-auth';
import { getFile, putFile, triggerDeploy } from '../../../lib/github-api';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) return new Response('Unauthorized', { status: 401 });

  const { ids } = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(ids)) return new Response('Invalid ids', { status: 400 });

  const file = await getFile('src/lib/visuals-manifest.json');
  if (!file) return new Response('Manifest not found', { status: 500 });

  const manifest = JSON.parse(file.content) as { packs: { id: string }[] };
  const packMap = new Map(manifest.packs.map((p) => [p.id, p]));

  const reordered = ids.map((id) => packMap.get(id)).filter(Boolean) as typeof manifest.packs;
  manifest.packs.forEach((p) => { if (!ids.includes(p.id)) reordered.push(p); });
  manifest.packs = reordered;

  await putFile('src/lib/visuals-manifest.json', JSON.stringify(manifest, null, 2), 'admin: reorder photos', file.sha);
  await triggerDeploy();
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
