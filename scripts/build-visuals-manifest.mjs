// One-off generator: reads originals from SOURCE_DIR, writes optimized AVIF/WebP
// variants into public/media/visuals/<id>/ and a static manifest at
// src/lib/visuals-manifest.json. Not part of `npm run build` — run manually
// whenever the photo set changes:
//   node scripts/build-visuals-manifest.mjs "C:\path\to\photos"
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE_DIR = process.argv[2];
if (!SOURCE_DIR) {
  console.error('Usage: node scripts/build-visuals-manifest.mjs <source-dir>');
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'media', 'visuals');
const MANIFEST_PATH = path.join(ROOT, 'src', 'lib', 'visuals-manifest.json');
const TARGET_WIDTHS = [480, 960, 1600, 2400];
const IMAGE_EXT = /\.(jpe?g|png)$/i;

function computeTargets(origW) {
  const cap = Math.min(Math.max(1, origW), 2400);
  const set = new Set();
  for (const tw of TARGET_WIDTHS) {
    if (tw <= cap) set.add(tw);
  }
  set.add(cap);
  return [...set].sort((a, b) => a - b);
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function processOne(filePath, id) {
  const buffer = await fs.readFile(filePath);
  const meta = await sharp(buffer).rotate().metadata();
  const ow = meta.width ?? 0;
  const oh = meta.height ?? 0;
  if (ow < 1 || oh < 1) throw new Error(`Could not read dimensions: ${filePath}`);

  const targets = computeTargets(ow);
  const outDir = path.join(OUT_DIR, id);
  await fs.mkdir(outDir, { recursive: true });

  const variants = [];
  for (const w of targets) {
    const pipeline = sharp(buffer).rotate().resize({ width: w, withoutEnlargement: true });
    const [avif, webp] = await Promise.all([
      pipeline.clone().avif({ quality: 52, effort: 3 }).toBuffer(),
      pipeline.clone().webp({ quality: 78, effort: 4 }).toBuffer(),
    ]);
    await fs.writeFile(path.join(outDir, `${w}.avif`), avif);
    await fs.writeFile(path.join(outDir, `${w}.webp`), webp);
    variants.push({
      w,
      avifUrl: `/media/visuals/${id}/${w}.avif`,
      webpUrl: `/media/visuals/${id}/${w}.webp`,
    });
  }

  const thumbH = Math.max(1, Math.round((20 * oh) / ow));
  const lqipBuf = await sharp(buffer)
    .rotate()
    .resize({ width: 20, height: thumbH, fit: 'fill' })
    .avif({ quality: 22, effort: 2 })
    .toBuffer();
  const lqip = `data:image/avif;base64,${lqipBuf.toString('base64')}`;

  return { id, width: ow, height: oh, lqip, variants };
}

async function main() {
  const entries = await fs.readdir(SOURCE_DIR, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && IMAGE_EXT.test(e.name));

  const withStats = await Promise.all(
    files.map(async (f) => {
      const full = path.join(SOURCE_DIR, f.name);
      const stat = await fs.stat(full);
      return { full, name: f.name, mtime: stat.mtimeMs };
    }),
  );
  withStats.sort((a, b) => b.mtime - a.mtime); // newest first

  await fs.mkdir(OUT_DIR, { recursive: true });

  const usedIds = new Set();
  const packs = [];
  let i = 0;
  for (const f of withStats) {
    i += 1;
    let id = slugify(f.name) || `photo-${i}`;
    while (usedIds.has(id)) id = `${id}-${i}`;
    usedIds.add(id);

    process.stdout.write(`[${i}/${withStats.length}] ${f.name} -> ${id}\n`);
    const pack = await processOne(f.full, id);
    packs.push({ ...pack, uploadedAt: new Date(f.mtime).toISOString() });
  }

  await fs.writeFile(MANIFEST_PATH, JSON.stringify({ packs }, null, 2));
  console.log(`\nWrote ${packs.length} image packs to ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
