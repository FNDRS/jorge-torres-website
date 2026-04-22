import type { APIRoute } from 'astro';
import { resolveGalleryItems } from '../../lib/blob-visuals';

export const prerender = false;

export const GET: APIRoute = async () => {
  let items: Awaited<ReturnType<typeof resolveGalleryItems>> = [];
  let source: 'blob' | 'empty' = 'empty';

  try {
    items = await resolveGalleryItems();
    if (items.length > 0) {
      source = 'blob';
    }
  } catch {
    source = 'empty';
  }

  const urls = items.filter((i) => i.kind === 'media').map((i) => i.url);

  return new Response(JSON.stringify({ items, urls, source }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
