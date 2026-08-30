import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../lib/admin-auth';
import { getFile, putFile, triggerDeploy } from '../../../lib/github-api';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) return new Response('Unauthorized', { status: 401 });

  // columns: array of column arrays, each containing photo IDs in order (top→bottom)
  const { columns } = (await request.json()) as { columns?: string[][] };
  if (!Array.isArray(columns)) return new Response('Invalid columns', { status: 400 });

  const file = await getFile('src/lib/visuals-manifest.json');
  if (!file) return new Response('Manifest not found', { status: 500 });

  const manifest = JSON.parse(file.content) as { packs: ({ id: string; col?: number } & Record<string, unknown>)[] };
  const packMap = new Map(manifest.packs.map((p) => [p.id, p]));

  // Rebuild packs: col0 items first, then col1, col2, col3 — each with col set
  const reordered: typeof manifest.packs = [];
  columns.forEach((colIds, colIdx) => {
    colIds.forEach((id) => {
      const pack = packMap.get(id);
      if (pack) reordered.push({ ...pack, col: colIdx });
    });
  });

  // Append any packs not present in the submitted columns (safety net)
  manifest.packs.forEach((p) => {
    if (!reordered.find((r) => r.id === p.id)) reordered.push(p);
  });

  manifest.packs = reordered;
  await putFile('src/lib/visuals-manifest.json', JSON.stringify(manifest, null, 2), 'admin: reorder photos', file.sha);
  await triggerDeploy();
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
