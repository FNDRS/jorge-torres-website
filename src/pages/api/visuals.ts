import type { APIRoute } from 'astro';
import { loadGalleryUrlsFromBlob } from '../../lib/blob-visuals';

export const prerender = false;

export const GET: APIRoute = async () => {
  let urls: string[] = [];
  let source: 'blob' | 'empty' = 'empty';

  try {
    const blobUrls = await loadGalleryUrlsFromBlob();
    if (blobUrls.length > 0) {
      urls = blobUrls;
      source = 'blob';
    }
  } catch {
    source = 'empty';
  }

  return new Response(JSON.stringify({ urls, source }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
