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

  // Rebuild packs: interleave columns round-robin (col0[0], col1[0], col2[0], col3[0], col0[1], …)
  // so the initial visible window contains items from every column — critical because the gallery
  // slices by visibleCount first, and a columnar order would fill all initial slots with col:0.
  const colPacks = columns.map((colIds, colIdx) =>
    colIds.flatMap((id) => {
      const pack = packMap.get(id);
      return pack ? [{ ...pack, col: colIdx }] : [];
    }),
  );
  const reordered: typeof manifest.packs = [];
  const maxLen = Math.max(...colPacks.map((c) => c.length));
  for (let row = 0; row < maxLen; row++) {
    for (const col of colPacks) {
      if (row < col.length) reordered.push(col[row]!);
    }
  }

  // Append any packs not present in the submitted columns (safety net)
  manifest.packs.forEach((p) => {
    if (!reordered.find((r) => r.id === p.id)) reordered.push(p);
  });

  manifest.packs = reordered;
  await putFile('src/lib/visuals-manifest.json', JSON.stringify(manifest, null, 2), 'admin: reorder photos', file.sha);
  await triggerDeploy();
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
