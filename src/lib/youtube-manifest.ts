import { head, put } from '@vercel/blob';
import { readServerEnv } from './server-env';

/** Reserved JSON manifest in Blob (must stay under `visuals/`). */
export const YOUTUBE_MANIFEST_PATHNAME = 'visuals/_youtube.json';

export type YoutubeManifestEntry = {
  videoId: string;
  addedAt: string;
};

type ManifestFile = {
  entries: YoutubeManifestEntry[];
};

function normalizeManifest(data: unknown): YoutubeManifestEntry[] {
  if (!data || typeof data !== 'object') return [];
  const entries = (data as ManifestFile).entries;
  if (!Array.isArray(entries)) return [];
  const out: YoutubeManifestEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const videoId = typeof (e as YoutubeManifestEntry).videoId === 'string' ? (e as YoutubeManifestEntry).videoId : '';
    const addedAt =
      typeof (e as YoutubeManifestEntry).addedAt === 'string'
        ? (e as YoutubeManifestEntry).addedAt
        : new Date().toISOString();
    if (!/^[\w-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    out.push({ videoId, addedAt });
  }
  return out;
}

export async function readYoutubeManifest(): Promise<YoutubeManifestEntry[]> {
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

export async function writeYoutubeManifest(entries: YoutubeManifestEntry[]): Promise<void> {
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
