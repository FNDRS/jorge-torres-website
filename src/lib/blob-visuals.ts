import { list } from '@vercel/blob';
import { readServerEnv } from './server-env';
import { readYoutubeManifest } from './youtube-manifest';

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

export type GalleryBlobListItem = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

/** Full metadata for admin (newest first). Empty if not configured. */
export async function listGalleryBlobItems(): Promise<GalleryBlobListItem[]> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return [];

  const collected: GalleryBlobListItem[] = [];
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
      collected.push({
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt.toISOString(),
      });
    }

    if (!hasMore) break;
    cursor = nextCursor;
    if (!cursor) break;
  }

  collected.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return collected;
}

export type PublicGalleryItem =
  | { kind: 'media'; url: string }
  | { kind: 'youtube'; videoId: string };

/** Blob media + YouTube embeds from manifest, newest first (by upload / added time). */
export async function resolveGalleryItems(): Promise<PublicGalleryItem[]> {
  try {
    const [blobItems, ytEntries] = await Promise.all([listGalleryBlobItems(), readYoutubeManifest()]);

    const merged: Array<PublicGalleryItem & { t: number }> = [
      ...blobItems.map((b) => ({
        kind: 'media' as const,
        url: b.url,
        t: new Date(b.uploadedAt).getTime(),
      })),
      ...ytEntries.map((e) => ({
        kind: 'youtube' as const,
        videoId: e.videoId,
        t: new Date(e.addedAt).getTime(),
      })),
    ];
    merged.sort((a, b) => b.t - a.t);
    return merged.map(({ kind, url, videoId }) =>
      kind === 'media' ? { kind, url: url! } : { kind, videoId: videoId! },
    );
  } catch {
    return [];
  }
}

/** Media URLs only (Blob), same order as `resolveGalleryItems` but without YouTube slots. */
export async function resolveGalleryUrls(): Promise<string[]> {
  try {
    const items = await resolveGalleryItems();
    return items.filter((i): i is { kind: 'media'; url: string } => i.kind === 'media').map((i) => i.url);
  } catch {
    return [];
  }
}
