import { head, put } from '@vercel/blob';
import { readServerEnv } from './server-env';

/** Reserved JSON manifest in Blob (must stay under `visuals/`). */
export const YOUTUBE_MANIFEST_PATHNAME = 'visuals/_youtube.json';

export type EmbedProvider = 'youtube' | 'vimeo';

export type GalleryEmbedEntry = {
  provider: EmbedProvider;
  videoId: string;
  addedAt: string;
};

type ManifestFile = {
  entries: GalleryEmbedEntry[];
};

function normalizeManifest(data: unknown): GalleryEmbedEntry[] {
  if (!data || typeof data !== 'object') return [];
  const entries = (data as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const out: GalleryEmbedEntry[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const provider: EmbedProvider = o.provider === 'vimeo' ? 'vimeo' : 'youtube';
    const videoId =
      typeof o.videoId === 'string'
        ? o.videoId
        : typeof o.id === 'string'
          ? o.id
          : '';
    const addedAt = typeof o.addedAt === 'string' ? o.addedAt : new Date().toISOString();

    if (provider === 'youtube') {
      if (!/^[\w-]{11}$/.test(videoId)) continue;
    } else {
      if (!/^\d{6,12}$/.test(videoId)) continue;
    }

    const dedupe = `${provider}:${videoId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ provider, videoId, addedAt });
  }
  return out;
}

export async function readYoutubeManifest(): Promise<GalleryEmbedEntry[]> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) return [];

  try {
    const meta = await head(YOUTUBE_MANIFEST_PATHNAME, { token });
    const res = await fetch(meta.url);
    if (!res.ok) return [];
    const json: unknown = await res.json().catch(() => null);
    return normalizeManifest(json);
  } catch {
    return [];
  }
}

export async function writeYoutubeManifest(entries: GalleryEmbedEntry[]): Promise<void> {
  const token = readServerEnv('BLOB_READ_WRITE_TOKEN');
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');

  const body = JSON.stringify({ entries } satisfies ManifestFile);
  await put(YOUTUBE_MANIFEST_PATHNAME, body, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    token,
  });
}
