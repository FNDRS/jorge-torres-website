import sharp from 'sharp';

const TARGET_WIDTHS = [480, 960, 1600, 2400] as const;

function computeTargets(origW: number): number[] {
  const cap = Math.min(Math.max(1, origW), 2400);
  const set = new Set<number>();
  for (const tw of TARGET_WIDTHS) {
    if (tw <= cap) set.add(tw);
  }
  set.add(cap);
  return [...set].sort((a, b) => a - b);
}

export type ProcessedVariantBuffer = { w: number; avif: Buffer; webp: Buffer };

export type ProcessedGalleryImage = {
  width: number;
  height: number;
  lqip: string;
  variants: ProcessedVariantBuffer[];
};

/**
 * Decode → resize buckets → AVIF + WebP per width + tiny LQIP (data URL).
 * Caller uploads buffers to Blob and writes manifest URLs.
 */
export async function processImageForGallery(buffer: Uint8Array): Promise<ProcessedGalleryImage> {
  const meta = await sharp(buffer).rotate().metadata();
  const ow = meta.width ?? 0;
  const oh = meta.height ?? 0;
  if (ow < 1 || oh < 1) {
    throw new Error('Could not read image dimensions');
  }

  const targets = computeTargets(ow);
  const variants: ProcessedVariantBuffer[] = [];

  for (const w of targets) {
    const pipeline = sharp(buffer).rotate().resize({
      width: w,
      withoutEnlargement: true,
    });
    const [avif, webp] = await Promise.all([
      pipeline.clone().avif({ quality: 52, effort: 3 }).toBuffer(),
      pipeline.clone().webp({ quality: 78, effort: 4 }).toBuffer(),
    ]);
    variants.push({ w, avif, webp });
  }

  const thumbH = Math.max(1, Math.round((20 * oh) / ow));
  const lqipBuf = await sharp(buffer)
    .rotate()
    .resize({ width: 20, height: thumbH, fit: 'fill' })
    .avif({ quality: 22, effort: 2 })
    .toBuffer();
  const lqip = `data:image/avif;base64,${lqipBuf.toString('base64')}`;

  return { width: ow, height: oh, lqip, variants };
}
