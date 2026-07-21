/**
 * Processes new photos and MERGES them into the existing manifest
 * instead of replacing it. Run with:
 *   node scripts/append-visuals.mjs "path/to/new/photos"
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';

const SOURCE_DIR = process.argv[2];
if (!SOURCE_DIR) {
  console.error('Usage: node scripts/append-visuals.mjs <source-dir>');
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
  for (const tw of TARGET_WIDTHS) { if (tw <= cap) set.add(tw); }
  set.add(cap);
  return [...set].sort((a, b) => a - b);
}

function formatShutterSpeed(t) {
  if (!t || t <= 0) return null;
  if (t >= 1) return `${Math.round(t * 10) / 10}s`;
  return `1/${Math.round(1 / t)}`;
}

async function readExifSummary(buffer) {
  let exif;
  try {
    exif = await exifr.parse(buffer, {
      pick: ['Make', 'Model', 'LensModel', 'FNumber', 'ExposureTime', 'ISO', 'FocalLength'],
    });
  } catch { return null; }
  if (!exif) return null;
  const camera = [exif.Make, exif.Model].filter(Boolean).join(' ').trim() || null;
  const lens = exif.LensModel ?? null;
  const aperture = typeof exif.FNumber === 'number' ? `f/${exif.FNumber}` : null;
  const shutterSpeed = formatShutterSpeed(exif.ExposureTime);
  const iso = typeof exif.ISO === 'number' ? `ISO ${exif.ISO}` : null;
  const focalLength = typeof exif.FocalLength === 'number' ? `${Math.round(exif.FocalLength)}mm` : null;
  if (!camera && !lens && !aperture && !shutterSpeed && !iso && !focalLength) return null;
  return { camera, lens, aperture, shutterSpeed, iso, focalLength };
}

function slugify(name) {
  return name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function processOne(filePath, id) {
  const buffer = await fs.readFile(filePath);
  const meta = await sharp(buffer).rotate().metadata();
  const ow = meta.width ?? 0, oh = meta.height ?? 0;
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
    variants.push({ w, avifUrl: `/media/visuals/${id}/${w}.avif`, webpUrl: `/media/visuals/${id}/${w}.webp` });
  }
  const thumbH = Math.max(1, Math.round((20 * oh) / ow));
  const lqipBuf = await sharp(buffer).rotate()
    .resize({ width: 20, height: thumbH, fit: 'fill' })
    .avif({ quality: 22, effort: 2 }).toBuffer();
  const lqip = `data:image/avif;base64,${lqipBuf.toString('base64')}`;
  const exif = await readExifSummary(buffer);
  return { id, width: ow, height: oh, lqip, variants, exif };
}

async function main() {
  const existing = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf-8'));
  const existingIds = new Set(existing.packs.map(p => p.id));

  const entries = await fs.readdir(SOURCE_DIR, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && IMAGE_EXT.test(e.name));
  const withStats = await Promise.all(files.map(async f => {
    const full = path.join(SOURCE_DIR, f.name);
    const stat = await fs.stat(full);
    return { full, name: f.name, mtime: stat.mtimeMs };
  }));
  withStats.sort((a, b) => b.mtime - a.mtime);

  await fs.mkdir(OUT_DIR, { recursive: true });

  const usedIds = new Set([...existingIds]);
  const newPacks = [];
  let i = 0;
  for (const f of withStats) {
    i++;
    let id = slugify(f.name) || `photo-${i}`;
    while (usedIds.has(id)) id = `${id}-${i}`;
    usedIds.add(id);
    process.stdout.write(`[${i}/${withStats.length}] ${f.name} -> ${id}\n`);
    const pack = await processOne(f.full, id);
    newPacks.push({ ...pack, uploadedAt: new Date(f.mtime).toISOString() });
  }

  // New photos first (newest-first order in gallery)
  const merged = { packs: [...newPacks, ...existing.packs] };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(merged, null, 2));
  console.log(`\nListo: ${newPacks.length} nuevas + ${existing.packs.length} existentes = ${merged.packs.length} total`);
}

main().catch(err => { console.error(err); process.exit(1); });
