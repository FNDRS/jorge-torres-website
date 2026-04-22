import { list } from '@vercel/blob';
import { readServerEnv } from './server-env';
import { readYoutubeManifest } from './youtube-manifest';
import { GALLERY_IMAGE_MANIFEST_PATHNAME, readGalleryImageManifest, type GalleryImagePack } from './gallery-image-manifest';

/** All uploads from the admin/API must use this prefix inside the Blob store. */
export const VISUAL_BLOB_PREFIX = 'visuals/';

const GALLERY_EXT = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|m4v)$/i;

const RESERVED_PATHNAMES = new Set(
  ['visuals/_youtube.json', GALLERY_IMAGE_MANIFEST_PATHNAME].map((p) => p.toLowerCase()),
);

export function isGalleryMediaPathname(pathname: string): boolean {
  return GALLERY_EXT.test(pathname);
}

export function isVisualPackInternalPathname(pathname: string): boolean {
  return pathname.startsWith(`${VISUAL_BLOB_PREFIX}g/`);
}

export function isReservedVisualPathname(pathname: string): boolean {
  return RESERVED_PATHNAMES.has(pathname.trim().toLowerCase());
}

function isLegacyTopLevelGalleryPathname(pathname: string): boolean {
  const p = pathname.trim();
  if (!p.startsWith(VISUAL_BLOB_PREFIX)) return false;
  if (isVisualPackInternalPathname(p)) return false;
  if (isReservedVisualPathname(p)) return false;
  if (p.slice(VISUAL_BLOB_PREFIX.length).includes('/')) return false;
  return isGalleryMediaPathname(p);
}

type RawBlobRow = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

async function listAllVisualBlobs(): Promise<RawBlobRow[]> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return [];

  const collected: RawBlobRow[] = [];
  let cursor: string | undefined;

  for (;;) {
    const { blobs, hasMore, cursor: nextCursor } = await list({
      prefix: VISUAL_BLOB_PREFIX,
      limit: 1000,
      token,
      ...(cursor ? { cursor } : {}),
    });

    for (const b of blobs) {
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

  return collected;
}

/** Sum sizes under `visuals/` (pack variants, legacy media, manifests). */
export async function getVisualsBlobStorageStats(): Promise<{
  usedBytes: number;
  mediaFileCount: number;
}> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return { usedBytes: 0, mediaFileCount: 0 };

  const rows = await listAllVisualBlobs();
  let usedBytes = 0;
  for (const r of rows) {
    usedBytes += r.size;
  }

  const packs = await readGalleryImageManifest();
  const packIds = new Set(packs.map((p) => p.id));
  let legacyMedia = 0;
  for (const r of rows) {
    if (isVisualPackInternalPathname(r.pathname)) continue;
    if (isReservedVisualPathname(r.pathname)) continue;
    if (isLegacyTopLevelGalleryPathname(r.pathname)) legacyMedia += 1;
  }

  const mediaFileCount = packIds.size + legacyMedia;

  return { usedBytes, mediaFileCount };
}

export async function loadGalleryUrlsFromBlob(): Promise<string[]> {
  const items = await resolveGalleryItems();
  return items.filter((i): i is { kind: 'media'; url: string } => i.kind === 'media').map((i) => i.url);
}

export type GalleryBlobListItem = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

/** Admin list: one row per optimized pack + one per legacy blob (no pack internals). */
export async function listGalleryBlobItems(): Promise<GalleryBlobListItem[]> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return [];

  const [packs, rows] = await Promise.all([readGalleryImageManifest(), listAllVisualBlobs()]);

  const packRows: GalleryBlobListItem[] = packs.map((p) => {
    const smallest = p.variants[0]!;
    return {
      url: smallest.webpUrl,
      pathname: `${VISUAL_BLOB_PREFIX}g/${p.id}`,
      size: p.totalBytes,
      uploadedAt: p.uploadedAt,
    };
  });

  const legacy: GalleryBlobListItem[] = [];
  for (const r of rows) {
    if (isVisualPackInternalPathname(r.pathname)) continue;
    if (isReservedVisualPathname(r.pathname)) continue;
    if (!isLegacyTopLevelGalleryPathname(r.pathname)) continue;
    legacy.push({
      url: r.url,
      pathname: r.pathname,
      size: r.size,
      uploadedAt: r.uploadedAt,
    });
  }

  legacy.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  const merged = [...packRows, ...legacy];
  merged.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return merged;
}

export type PublicGalleryImageMeta = {
  width: number;
  height: number;
  lqip: string;
  variants: { w: number; avif: string; webp: string }[];
};

export type PublicGalleryItem =
  | { kind: 'media'; url: string; packId?: string; image?: PublicGalleryImageMeta }
  | { kind: 'youtube'; videoId: string }
  | { kind: 'vimeo'; videoId: string };

function packToPublicItem(p: GalleryImagePack): PublicGalleryItem & { t: number } {
  const largest = p.variants[p.variants.length - 1]!;
  return {
    kind: 'media',
    url: largest.webpUrl,
    packId: p.id,
    image: {
      width: p.width,
      height: p.height,
      lqip: p.lqip,
      variants: p.variants.map((v) => ({ w: v.w, avif: v.avifUrl, webp: v.webpUrl })),
    },
    t: new Date(p.uploadedAt).getTime(),
  };
}

/** Blob media + YouTube / Vimeo embeds from manifest, newest first (by upload / added time). */
export async function resolveGalleryItems(): Promise<PublicGalleryItem[]> {
  try {
    const [packs, rows, embedEntries] = await Promise.all([
      readGalleryImageManifest(),
      listAllVisualBlobs(),
      readYoutubeManifest(),
    ]);

    const fromPacks: Array<PublicGalleryItem & { t: number }> = packs.map(packToPublicItem);

    const legacyItems: Array<PublicGalleryItem & { t: number }> = [];
    for (const r of rows) {
      if (isVisualPackInternalPathname(r.pathname)) continue;
      if (isReservedVisualPathname(r.pathname)) continue;
      if (!isLegacyTopLevelGalleryPathname(r.pathname)) continue;
      legacyItems.push({
        kind: 'media',
        url: r.url,
        t: new Date(r.uploadedAt).getTime(),
      });
    }

    const merged: Array<PublicGalleryItem & { t: number }> = [
      ...fromPacks,
      ...legacyItems,
      ...embedEntries.map((e) => {
        const t = new Date(e.addedAt).getTime();
        if (e.provider === 'vimeo') {
          return { kind: 'vimeo' as const, videoId: e.videoId, t };
        }
        return { kind: 'youtube' as const, videoId: e.videoId, t };
      }),
    ];
    merged.sort((a, b) => b.t - a.t);
    return merged.map((row) => {
      if (row.kind === 'media') {
        return {
          kind: 'media',
          url: row.url,
          ...(row.packId ? { packId: row.packId } : {}),
          ...(row.image ? { image: row.image } : {}),
        };
      }
      if (row.kind === 'vimeo') return { kind: 'vimeo', videoId: row.videoId };
      return { kind: 'youtube', videoId: row.videoId };
    });
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
