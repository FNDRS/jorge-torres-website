/**
 * In `astro dev`, Vite loads `.env` into `import.meta.env`. On Vercel at runtime,
 * variables are typically on `process.env`. Support both so Blob + uploads work locally and in production.
 */
export type ServerEnvKey =
  | 'BLOB_READ_WRITE_TOKEN'
  | 'VISUALS_UPLOAD_SECRET'
  /** Optional display cap for the admin bar (MB). Defaults in API if unset. */
  | 'VISUALS_QUOTA_MB';

export function readServerEnv(name: ServerEnvKey): string | undefined {
  const meta = import.meta.env as Record<string, string | undefined>;
  const fromMeta = meta[name];
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;

  if (typeof process !== 'undefined') {
    const fromProcess = process.env[name];
    if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess;
  }

  return undefined;
}
