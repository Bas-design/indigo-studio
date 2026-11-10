'use strict';
/* Reading and writing the project data.

   The point of this file is that Mia can never produce invalid JSON. She
   fills in a form; we build the object, validate it, and write it with
   JSON.stringify. The whole class of "missing comma on line 14 and the
   project vanished from the site" is gone.

   Written to match the existing files exactly: 2-space indent, trailing
   newline, same key order as assets/projects/_TEMPLATE/project.json. */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const repo = require('./repo');

/* The four categories the site understands. `category` is the machine
   value used for filtering; `label` is what visitors read. Mia picks from
   this list, so an invalid category is impossible. */
const CATEGORIES = [
  { category: 'living', label: 'Living Spaces' },
  { category: 'colour', label: 'Colour & Finishes' },
  { category: 'wallpaper', label: 'Wallpaper & Feature Walls' },
  { category: 'organisation', label: 'Organisation' },
];

const dir = () => repo.projectsDir();
const listFile = () => path.join(dir(), 'projects.json');
const projDir = (slug) => path.join(dir(), slug);
const projFile = (slug) => path.join(projDir(slug), 'project.json');

/* Folder and file names: lowercase, digits and hyphens only — the rules
   HOW-TO-ADD-A-PROJECT.md sets out, enforced instead of described. */
function slugify(text, fallback = 'project') {
  const s = String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || fallback;
}

/* Reject anything that could escape the projects folder. Every slug that
   arrives from the browser goes through this. */
function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug) || slug.length > 80) {
    throw Object.assign(new Error('That project name is not valid.'), { status: 400 });
  }
  if (slug === '_TEMPLATE' || slug.startsWith('.')) {
    throw Object.assign(new Error('That project name is reserved.'), { status: 400 });
  }
  return slug;
}

/* Write via a temp file in the same directory, then rename. A crash or a
   container stop mid-write leaves the old file intact rather than a
   truncated one. */
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

async function readOrder() {
  try {
    const raw = JSON.parse(await fsp.readFile(listFile(), 'utf8'));
    return Array.isArray(raw.projects) ? raw.projects : [];
  } catch {
    return [];
  }
}

async function writeOrder(order) {
  await writeJsonAtomic(listFile(), { projects: order });
}

async function readProject(slug) {
  assertSafeSlug(slug);
  const raw = JSON.parse(await fsp.readFile(projFile(slug), 'utf8'));
  return raw;
}

/* Image files actually sitting in the folder. Used to spot photos
   referenced in JSON but missing on disk, and files on disk that no
   entry points at. */
async function filesOnDisk(slug) {
  assertSafeSlug(slug);
  try {
    const entries = await fsp.readdir(projDir(slug));
    return entries.filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  } catch {
    return [];
  }
}

/* Everything the project list screen needs, in display order, plus any
   folders present on disk but absent from projects.json — those are
   "hidden": still on the host, not shown on the site. Removing a line
   from projects.json is how HOW-TO-ADD-A-PROJECT.md says to unpublish a
   project, so the Studio has to represent that state rather than lose it. */
async function listAll() {
  const order = await readOrder();
  let folders = [];
  try {
    folders = (await fsp.readdir(dir(), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name !== '_TEMPLATE' && !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch { /* projects dir missing — handled by the caller */ }

  async function meta(slug, visible) {
    try {
      const p = await readProject(slug);
      const photos = Array.isArray(p.photos) ? p.photos : [];
      return {
        slug, visible,
        title: p.title || slug,
        category: p.category || '',
        categoryLabel: p.categoryLabel || '',
        location: p.location || '',
        year: p.year || '',
        cover: p.cover || (photos[0] && photos[0].image) || null,
        photoCount: photos.length,
        problems: (await validate(p, slug)).map((e) => e.message),
      };
    } catch (err) {
      // A folder with unreadable JSON must still appear, or it becomes
      // invisible in the Studio while breaking the site.
      return {
        slug, visible, title: slug, broken: true,
        problems: [`project.json could not be read: ${err.message}`],
        photoCount: 0, cover: null,
      };
    }
  }

  const visible = [];
  for (const slug of order) {
    if (folders.includes(slug)) visible.push(await meta(slug, true));
    else visible.push({ slug, visible: true, title: slug, missing: true, photoCount: 0, cover: null, problems: ['Listed on the site but the folder is missing.'] });
  }
  const hidden = [];
  for (const slug of folders) {
    if (!order.includes(slug)) hidden.push(await meta(slug, false));
  }
  return { visible, hidden, categories: CATEGORIES };
}

/* Validation. Returns a list of {field, message} — empty means publishable.
   These are the same rules the hand-written guide asks Mia to hold in her
   head; here they are checked for her and surfaced before anything is
   published. */
async function validate(p, slug) {
  const errors = [];
  const req = (v) => typeof v === 'string' && v.trim().length > 0;

  if (!req(p.title)) errors.push({ field: 'title', message: 'The project needs a title.' });
  if (!CATEGORIES.some((c) => c.category === p.category)) {
    errors.push({ field: 'category', message: 'Pick a category.' });
  }
  if (!req(p.categoryLabel)) errors.push({ field: 'categoryLabel', message: 'The category label is empty.' });
  if (!req(p.location)) errors.push({ field: 'location', message: 'Add a location, e.g. "Camden, NSW".' });
  if (!/^\d{4}$/.test(String(p.year || ''))) errors.push({ field: 'year', message: 'Year should be four digits, e.g. "2026".' });
  if (!req(p.summary)) errors.push({ field: 'summary', message: 'Add a one or two sentence summary — it shows on the gallery tile.' });

  const brief = Array.isArray(p.brief) ? p.brief.filter(req) : [];
  if (!brief.length) errors.push({ field: 'brief', message: 'Write at least one paragraph about the project.' });

  const photos = Array.isArray(p.photos) ? p.photos : [];
  if (!photos.length) {
    errors.push({ field: 'photos', message: 'Add at least one photo.' });
  }

  const onDisk = slug ? await filesOnDisk(slug) : [];
  photos.forEach((ph, i) => {
    if (!req(ph.image)) {
      errors.push({ field: `photos.${i}.image`, message: `Photo ${i + 1} has no image file.` });
    } else if (slug && !onDisk.includes(ph.image)) {
      errors.push({ field: `photos.${i}.image`, message: `Photo ${i + 1} (${ph.image}) is missing from the folder.` });
    }
    if (!req(ph.heading)) errors.push({ field: `photos.${i}.heading`, message: `Photo ${i + 1} needs a heading.` });
    if (!req(ph.text)) errors.push({ field: `photos.${i}.text`, message: `Photo ${i + 1} needs a paragraph of text.` });
  });

  if (!req(p.cover)) {
    errors.push({ field: 'cover', message: 'Choose which photo is the gallery cover.' });
  } else if (photos.length && !photos.some((ph) => ph.image === p.cover)) {
    errors.push({ field: 'cover', message: 'The cover photo is not one of this project\'s photos.' });
  }

  return errors;
}

/* Build a clean project object in the canonical key order, dropping
   anything the form sent that does not belong. */
function normalise(input) {
  const cat = CATEGORIES.find((c) => c.category === input.category);
  const photos = (Array.isArray(input.photos) ? input.photos : []).map((ph) => ({
    image: String(ph.image || '').trim(),
    heading: String(ph.heading || '').trim(),
    text: String(ph.text || '').trim(),
  }));
  return {
    title: String(input.title || '').trim(),
    category: cat ? cat.category : '',
    // Label follows the category unless Mia typed her own.
    categoryLabel: String(input.categoryLabel || (cat ? cat.label : '')).trim(),
    location: String(input.location || '').trim(),
    year: String(input.year || '').trim(),
    cover: String(input.cover || (photos[0] && photos[0].image) || '').trim(),
    summary: String(input.summary || '').trim(),
    brief: (Array.isArray(input.brief) ? input.brief : String(input.brief || '').split(/\n{2,}/))
      .map((s) => String(s).trim())
      .filter(Boolean),
    photos,
  };
}

async function createProject(input) {
  const base = slugify(input.slug || input.title);
  let slug = base;
  let n = 2;
  while (fs.existsSync(projDir(slug))) slug = `${base}-${n++}`;
  assertSafeSlug(slug);

  await fsp.mkdir(projDir(slug), { recursive: true });
  const data = normalise({ year: String(new Date().getFullYear()), ...input });
  await writeJsonAtomic(projFile(slug), data);

  // New projects go to the top of the gallery — newest work first.
  const order = await readOrder();
  if (!order.includes(slug)) await writeOrder([slug, ...order]);

  return { slug, data };
}

async function updateProject(slug, input) {
  assertSafeSlug(slug);
  if (!fs.existsSync(projFile(slug))) {
    throw Object.assign(new Error('That project no longer exists.'), { status: 404 });
  }
  const data = normalise(input);
  await writeJsonAtomic(projFile(slug), data);
  return { slug, data };
}

/* Two different removals, because they mean different things:
   hide  — drop it from projects.json, keep the folder (reversible)
   erase — delete the folder and its photos too (not reversible) */
async function setVisible(slug, visible) {
  assertSafeSlug(slug);
  const order = await readOrder();
  if (visible && !order.includes(slug)) await writeOrder([slug, ...order]);
  if (!visible) await writeOrder(order.filter((s) => s !== slug));
}

async function eraseProject(slug) {
  assertSafeSlug(slug);
  await writeOrder((await readOrder()).filter((s) => s !== slug));
  await fsp.rm(projDir(slug), { recursive: true, force: true });
}

async function reorder(order) {
  if (!Array.isArray(order)) throw Object.assign(new Error('Bad order.'), { status: 400 });
  order.forEach(assertSafeSlug);
  const current = await readOrder();
  // Keep any slug the browser did not know about, so a stale tab cannot
  // silently unpublish a project added since it loaded.
  const extra = current.filter((s) => !order.includes(s));
  await writeOrder([...order, ...extra]);
}

/* Run the two generator scripts that ship in the repo, rather than
   reimplementing them here — they stay the single source of truth, and
   Mia never has to know they exist.

   rebuild-preview-data.js -> assets/projects/projects-data.js
   rebuild-sitemap.js      -> sitemap.xml  (site root) */
function runScript(file) {
  return new Promise((resolve) => {
    execFile('node', [file], { cwd: dir(), timeout: 60000 }, (err, stdout, stderr) => {
      resolve({
        script: file,
        ok: !err,
        output: String(stdout || '').trim(),
        error: err ? String(stderr || err.message).trim() : null,
      });
    });
  });
}

async function runRebuilds() {
  const results = [];
  for (const f of ['rebuild-preview-data.js', 'rebuild-sitemap.js']) {
    if (fs.existsSync(path.join(dir(), f))) results.push(await runScript(f));
    else results.push({ script: f, ok: false, error: 'Script not found in the repo.' });
  }
  return results;
}

module.exports = {
  CATEGORIES,
  dir, projDir, projFile,
  slugify, assertSafeSlug,
  readOrder, writeOrder,
  readProject, filesOnDisk, listAll,
  validate, normalise,
  createProject, updateProject,
  setVisible, eraseProject, reorder,
  runRebuilds,
};
