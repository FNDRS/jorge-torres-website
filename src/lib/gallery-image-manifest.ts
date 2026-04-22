import { head, put } from '@vercel/blob';
import { readServerEnv } from './server-env';

/** Aggregated metadata for optimized multi-file image packs (single JSON read on /visuals). */
export const GALLERY_IMAGE_MANIFEST_PATHNAME = 'visuals/_gallery-images.json';

export type GalleryImageVariant = {
  w: number;
  avifUrl: string;
  webpUrl: string;
};

export type GalleryImagePack = {
  id: string;
  uploadedAt: string;
  width: number;
  height: number;
  lqip: string;
  totalBytes: number;
  variants: GalleryImageVariant[];
};

type ManifestFile = {
  packs: GalleryImagePack[];
};

function isVariantRow(v: unknown): v is GalleryImageVariant {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.w === 'number' &&
    o.w > 0 &&
    typeof o.avifUrl === 'string' &&
    o.avifUrl.startsWith('http') &&
    typeof o.webpUrl === 'string' &&
    o.webpUrl.startsWith('http')
  );
}

function normalizeManifest(data: unknown): GalleryImagePack[] {
  if (!data || typeof data !== 'object') return [];
  const packs = (data as { packs?: unknown }).packs;
  if (!Array.isArray(packs)) return [];
  const out: GalleryImagePack[] = [];
  const seen = new Set<string>();

  for (const p of packs) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^[a-f0-9-]{36}$/i.test(o.id) ? o.id.toLowerCase() : '';
    if (!id || seen.has(id)) continue;
    const uploadedAt = typeof o.uploadedAt === 'string' ? o.uploadedAt : new Date().toISOString();
    const width = typeof o.width === 'number' && o.width > 0 ? Math.floor(o.width) : 0;
    const height = typeof o.height === 'number' && o.height > 0 ? Math.floor(o.height) : 0;
    const lqip = typeof o.lqip === 'string' && o.lqip.startsWith('data:') ? o.lqip : '';
    const totalBytes = typeof o.totalBytes === 'number' && o.totalBytes >= 0 ? o.totalBytes : 0;
    const variantsRaw = o.variants;
    if (!Array.isArray(variantsRaw) || variantsRaw.length === 0) continue;
    const variants = variantsRaw.filter(isVariantRow);
    if (variants.length === 0) continue;
    variants.sort((a, b) => a.w - b.w);
    seen.add(id);
    out.push({ id, uploadedAt, width, height, lqip, totalBytes, variants });
  }
  return out;
}

export async function readGalleryImageManifest(): Promise<GalleryImagePack[]> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return [];

  try {
    const meta = await head(GALLERY_IMAGE_MANIFEST_PATHNAME, { token });
    const res = await fetch(meta.url);
    if (!res.ok) return [];
    const json: unknown = await res.json().catch(() => null);
    return normalizeManifest(json);
  } catch {
    return [];
  }
}

async function writeManifestPacks(packs: GalleryImagePack[]): Promise<void> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');

  const body = JSON.stringify({ packs } satisfies ManifestFile);
  await put(GALLERY_IMAGE_MANIFEST_PATHNAME, body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });
}

/** Prepend pack (newest first). Retries on concurrent writers. */
export async function appendGalleryImagePack(pack: GalleryImagePack): Promise<void> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readGalleryImageManifest();
    if (current.some((p) => p.id === pack.id)) return;
    const next = [pack, ...current.filter((p) => p.id !== pack.id)];
    await writeManifestPacks(next);
    const verify = await readGalleryImageManifest();
    if (verify.some((p) => p.id === pack.id)) return;
    await new Promise((r) => setTimeout(r, 40 + attempt * 35));
  }
  throw new Error('Could not update gallery manifest after retries');
}

export async function removeGalleryPackById(packId: string): Promise<void> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  const id = packId.toLowerCase();
  if (!/^[a-f0-9-]{36}$/.test(id)) return;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readGalleryImageManifest();
    const next = current.filter((p) => p.id !== id);
    if (next.length === current.length) return;
    await writeManifestPacks(next);
    const verify = await readGalleryImageManifest();
    if (!verify.some((p) => p.id === id)) return;
    await new Promise((r) => setTimeout(r, 40 + attempt * 35));
  }
  throw new Error('Could not remove pack from manifest after retries');
}
