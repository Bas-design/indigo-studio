'use strict';
/* The photo pipeline.

   This replaces Step 1 of HOW-TO-ADD-A-PROJECT.md entirely. That step
   asks Mia to install PowerToys, resize to 2000px by hand, watch the file
   size, and rename every file to lowercase-with-hyphens. Here she drops
   camera originals in and gets exactly that, every time.

   Targets come straight from the guide:
     2000px on the longest edge
     JPEG, quality ~80
     under ~600 KB where possible */

const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const projects = require('./projects');

const MAX_EDGE = 2000;
const TARGET_BYTES = 600 * 1024;
// Quality ladder: start at the guide's 80 and step down only if the file
// is still over target. Below 62 a photograph starts to show artefacts in
// flat areas like walls, which is most of an interior shot — so we stop
// there and accept a larger file rather than a visibly worse one.
const QUALITY_LADDER = [80, 74, 68, 62];

/* Next free number prefix in the folder, so files stay tidy and sort in
   upload order. Display order comes from the photos[] array in
   project.json, not the filename, so renumbering on reorder is
   unnecessary — and avoiding it keeps git history clean. */
async function nextIndex(slug) {
  const files = await projects.filesOnDisk(slug);
  let max = 0;
  for (const f of files) {
    const m = /^(\d{1,3})-/.exec(f);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

async function uniqueName(slug, desired) {
  const files = new Set(await projects.filesOnDisk(slug));
  if (!files.has(desired)) return desired;
  const ext = path.extname(desired);
  const stem = desired.slice(0, -ext.length);
  for (let n = 2; n < 500; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!files.has(candidate)) return candidate;
  }
  throw new Error('Too many photos with that name.');
}

/* Resize and save one uploaded photo. `originalName` is only used to
   build a readable filename; the bytes are re-encoded either way, so a
   mislabelled extension cannot smuggle anything through. */
async function addPhoto(slug, buffer, originalName, hint) {
  projects.assertSafeSlug(slug);

  let image = sharp(buffer, { failOn: 'error' });
  let meta;
  try {
    meta = await image.metadata();
  } catch {
    throw Object.assign(
      new Error('That file does not look like a photo. JPEG, PNG and WebP all work.'),
      { status: 400 }
    );
  }
  if (!meta.width || !meta.height) {
    throw Object.assign(new Error('That photo could not be read.'), { status: 400 });
  }

  // .rotate() with no argument applies the EXIF orientation and then
  // drops the tag. Without it, phone photos taken in portrait appear
  // sideways on the site — the browser honours EXIF, but the resize
  // would otherwise bake in the wrong orientation.
  image = image.rotate();

  const longest = Math.max(meta.width, meta.height);
  if (longest > MAX_EDGE) {
    image = image.resize({
      width: meta.width >= meta.height ? MAX_EDGE : null,
      height: meta.height > meta.width ? MAX_EDGE : null,
      withoutEnlargement: true,
      fit: 'inside',
    });
  }

  let out = null;
  let quality = QUALITY_LADDER[QUALITY_LADDER.length - 1];
  for (const q of QUALITY_LADDER) {
    // mozjpeg gives a meaningfully smaller file at the same visual
    // quality. Metadata is stripped by default, which also removes the
    // GPS coordinates of a client's home — worth having deliberately.
    out = await image.clone().jpeg({ quality: q, mozjpeg: true, progressive: true }).toBuffer();
    quality = q;
    if (out.length <= TARGET_BYTES) break;
  }

  const stem = projects.slugify(hint || path.basename(originalName || '', path.extname(originalName || '')) || 'photo', 'photo');
  const idx = String(await nextIndex(slug)).padStart(2, '0');
  const name = await uniqueName(slug, `${idx}-${stem}.jpg`);

  await fsp.writeFile(path.join(projects.projDir(slug), name), out);

  const after = await sharp(out).metadata();
  return {
    image: name,
    width: after.width,
    height: after.height,
    bytes: out.length,
    quality,
    // Shown in the UI so Mia can see the resize actually happened.
    original: { width: meta.width, height: meta.height, bytes: buffer.length },
    overTarget: out.length > TARGET_BYTES,
  };
}

async function deletePhoto(slug, image) {
  projects.assertSafeSlug(slug);
  // Must be a bare filename: no directory parts, no traversal.
  if (!/^[a-z0-9][a-z0-9.-]*\.(jpe?g|png|webp)$/i.test(image) || image.includes('..')) {
    throw Object.assign(new Error('That is not a valid photo name.'), { status: 400 });
  }
  await fsp.rm(path.join(projects.projDir(slug), image), { force: true });
}

module.exports = { addPhoto, deletePhoto, MAX_EDGE, TARGET_BYTES };
