import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { isAuthenticated } from '../../../lib/admin-auth';
import { getFile, putFile } from '../../../lib/github-api';

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) return new Response('Unauthorized', { status: 401 });

  const formData = await request.formData();
  const file = formData.get('photo') as File | null;
  if (!file) return new Response('Missing photo', { status: 400 });
  if (file.size > MAX_BYTES) return new Response('File too large (max 10 MB)', { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(buffer).rotate().metadata();
  const ow = meta.width ?? 0;
  const oh = meta.height ?? 0;
  if (ow < 1 || oh < 1) return new Response('Could not read image dimensions', { status: 400 });

  const maxW = Math.min(ow, 1920);
  const maxH = Math.round((oh / ow) * maxW);

  const webpBuf = await sharp(buffer)
    .rotate()
    .resize({ width: maxW, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const lqipBuf = await sharp(buffer)
    .rotate()
    .resize({ width: 20, height: Math.max(1, Math.round((20 * oh) / ow)), fit: 'fill' })
    .webp({ quality: 20 })
    .toBuffer();
  const lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

  const slug = file.name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const id = `${slug}-${Date.now()}`;
  const webpPath = `public/media/visuals/${id}/1920.webp`;

  await putFile(webpPath, webpBuf, `admin: upload photo ${id}`);

  const manifestFile = await getFile('src/lib/visuals-manifest.json');
  if (!manifestFile) return new Response('Manifest not found', { status: 500 });

  const manifest = JSON.parse(manifestFile.content) as { packs: object[] };
  const newPack = {
    id,
    width: maxW,
    height: maxH,
    lqip,
    variants: [{ w: maxW, avifUrl: `/media/visuals/${id}/1920.webp`, webpUrl: `/media/visuals/${id}/1920.webp` }],
    exif: null,
    uploadedAt: new Date().toISOString(),
  };
  manifest.packs.unshift(newPack);

  await putFile(
    'src/lib/visuals-manifest.json',
    JSON.stringify(manifest, null, 2),
    `admin: add photo ${id} to manifest`,
    manifestFile.sha,
  );

  return new Response(JSON.stringify({ ok: true, id }), { status: 200 });
};
