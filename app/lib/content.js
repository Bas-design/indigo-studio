'use strict';
/* Site copy that is not part of a project.

   At the moment that means the three testimonials on the home page.
   They live in assets/content/testimonials.json rather than in
   index.html because the Studio is deliberately not allowed to write
   hand-authored pages — js/main.js reads the JSON and renders them.

   Same guarantees as the project data: Mia fills in fields, we build
   the object and write it with JSON.stringify, so malformed JSON is
   not reachable, and the write is atomic. */

const fsp = require('fs/promises');
const path = require('path');
const repo = require('./repo');

const CONTENT_DIR = () => path.join(repo.SITE_DIR, process.env.CONTENT_SUBDIR || 'assets/content');
const FILE = () => path.join(CONTENT_DIR(), 'testimonials.json');

const NOTE =
  'Edited through Indigo Studio. The quotation marks are added by the ' +
  'site, so write the quote as plain text without them.';

async function readTestimonials() {
  try {
    const raw = JSON.parse(await fsp.readFile(FILE(), 'utf8'));
    const list = Array.isArray(raw.testimonials) ? raw.testimonials : [];
    return list.map((t) => ({
      quote: String((t && t.quote) || ''),
      name: String((t && t.name) || ''),
      location: String((t && t.location) || ''),
    }));
  } catch {
    // Missing or unreadable: treat as empty rather than failing. The
    // site keeps showing its static fallback either way.
    return [];
  }
}

async function writeTestimonials(list) {
  if (!Array.isArray(list)) {
    throw Object.assign(new Error('Testimonials must be a list.'), { status: 400 });
  }
  if (list.length > 24) {
    throw Object.assign(new Error('That is more testimonials than the page can show.'), { status: 400 });
  }

  const clean = list
    .map((t) => ({
      quote: String((t && t.quote) || '').trim(),
      name: String((t && t.name) || '').trim(),
      location: String((t && t.location) || '').trim(),
    }))
    // A quote is the only required part; one with no words is just an
    // empty card, so drop it rather than publish a blank.
    .filter((t) => t.quote.length > 0);

  await fsp.mkdir(CONTENT_DIR(), { recursive: true });
  const file = FILE();
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(
    tmp,
    JSON.stringify({ _comment: NOTE, testimonials: clean }, null, 2) + '\n',
    'utf8'
  );
  await fsp.rename(tmp, file);
  return clean;
}

/* Warnings rather than errors: a testimonial with no name still renders
   perfectly well, it just reads as anonymous. Only an empty set is
   worth flagging, because the page then falls back to the three built
   into index.html and Mia would wonder why her edits did nothing. */
function checkTestimonials(list) {
  const problems = [];
  if (!list.length) {
    problems.push('No testimonials yet — the website is showing its built-in three instead.');
  }
  list.forEach((t, i) => {
    if (!t.name) problems.push(`Testimonial ${i + 1} has no name against it.`);
    if (t.quote.length > 400) problems.push(`Testimonial ${i + 1} is very long and may not fit its card.`);
  });
  return problems;
}

module.exports = { readTestimonials, writeTestimonials, checkTestimonials };
