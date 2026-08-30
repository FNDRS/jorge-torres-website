import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../lib/admin-auth';
import { getFile } from '../../../lib/github-api';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) return new Response('Unauthorized', { status: 401 });

  const [manifestFile, vsFile] = await Promise.all([
    getFile('src/lib/visuals-manifest.json'),
    getFile('src/lib/local-visuals.ts'),
  ]);

  const manifest = manifestFile
    ? (JSON.parse(manifestFile.content) as { packs: { id: string; width: number; height: number; lqip: string; variants: { webpUrl: string }[]; uploadedAt: string }[] })
    : { packs: [] };

  const photos = manifest.packs.map((p) => ({
    id: p.id,
    url: p.variants?.[p.variants.length - 1]?.webpUrl ?? '',
    lqip: p.lqip,
    uploadedAt: p.uploadedAt,
  }));

  const videos: { videoId: string; embeddable: boolean }[] = [];
  if (vsFile) {
    const src = vsFile.content;
    const start = src.indexOf('const EMBEDS');
    const end = src.indexOf('];', start);
    if (start !== -1 && end !== -1) {
      const block = src.slice(start, end);
      const re = /\{[^}]*videoId:\s*'([^']+)'[^}]*\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(block)) !== null) {
        videos.push({
          videoId: m[1]!,
          embeddable: !m[0].includes('embeddable: false'),
        });
      }
    }
  }

  return new Response(JSON.stringify({ photos, videos }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
