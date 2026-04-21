import { list } from '@vercel/blob';
import { FALLBACK_VISUAL_URLS } from './visuals-fallback';
import { readServerEnv } from './server-env';

/** All uploads from the admin/API must use this prefix inside the Blob store. */
export const VISUAL_BLOB_PREFIX = 'visuals/';

const GALLERY_EXT = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|m4v)$/i;

export function isGalleryMediaPathname(pathname: string): boolean {
  return GALLERY_EXT.test(pathname);
}

/** Sum sizes of gallery media under `visuals/` (same filter as the public gallery). */
export async function getVisualsBlobStorageStats(): Promise<{
  usedBytes: number;
  mediaFileCount: number;
}> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return { usedBytes: 0, mediaFileCount: 0 };

  let usedBytes = 0;
  let mediaFileCount = 0;
  let cursor: string | undefined;

  for (;;) {
    const { blobs, hasMore, cursor: nextCursor } = await list({
      prefix: VISUAL_BLOB_PREFIX,
      limit: 1000,
      token,
      ...(cursor ? { cursor } : {}),
    });

    for (const b of blobs) {
      if (!isGalleryMediaPathname(b.pathname)) continue;
      usedBytes += b.size;
      mediaFileCount += 1;
    }

    if (!hasMore) break;
    cursor = nextCursor;
    if (!cursor) break;
  }

  return { usedBytes, mediaFileCount };
}

export async function loadGalleryUrlsFromBlob(): Promise<string[]> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return [];

  const collected: { url: string; uploadedAt: number }[] = [];
  let cursor: string | undefined;

  for (;;) {
    const { blobs, hasMore, cursor: nextCursor } = await list({
      prefix: VISUAL_BLOB_PREFIX,
      limit: 1000,
      token,
      ...(cursor ? { cursor } : {}),
    });

    for (const b of blobs) {
      if (!isGalleryMediaPathname(b.pathname)) continue;
      collected.push({ url: b.url, uploadedAt: b.uploadedAt.getTime() });
    }

    if (!hasMore) break;
    cursor = nextCursor;
    if (!cursor) break;
  }

  collected.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return collected.map((c) => c.url);
}

/** Prefer Blob store when it has media; otherwise ship the bundled public gallery. */
export async function resolveGalleryUrls(): Promise<string[]> {
  try {
    const fromBlob = await loadGalleryUrlsFromBlob();
    if (fromBlob.length > 0) return fromBlob;
  } catch {
    // Blob not linked, bad token, or network — fall back quietly.
  }
  return FALLBACK_VISUAL_URLS;
}
