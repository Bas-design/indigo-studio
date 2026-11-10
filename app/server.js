'use strict';
/* Indigo Studio — local project editor for the Indigo Interiors website.
 *
 * Two things live on one port:
 *   /          the real website, served from the git working copy, with a
 *              small Studio bar injected. Mia browses the actual gallery
 *              and clicks through to edit what she is looking at.
 *   /studio    the editor.
 *
 * Serving the site at the root (rather than under /preview) matters: the
 * site's 404.html uses root-relative paths, and project.html?p=<slug>
 * links resolve naturally. Under a prefix, both would break.
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const repo = require('./lib/repo');
const projects = require('./lib/projects');
const images = require('./lib/images');
const github = require('./lib/github');

const PORT = parseInt(process.env.PORT, 10) || 4100;
const SITE_DIR = repo.SITE_DIR;
const LIVE_URL = process.env.LIVE_URL || 'https://indigointeriors.com.au';

const app = express();
app.disable('x-powered-by');
app.set('etag', false);
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 24 },
});

/* Only this machine may talk to the Studio. The container publishes the
   port to the host, and anything on Mia's network could otherwise reach
   an API that can push to GitHub. */
app.use((req, res, next) => {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1' || process.env.ALLOW_REMOTE === '1') return next();
  // Docker's userland proxy rewrites the source address to the bridge
  // gateway, so host traffic arrives from inside the container's subnet
  // rather than from 127.0.0.1. Private ranges are therefore allowed;
  // the port is bound to the host, not the internet.
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return next();
  res.status(403).type('text').send('Indigo Studio only accepts connections from this computer.');
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, err) {
  const status = err && err.status ? err.status : 500;
  res.status(status).json({
    error: (err && err.message) || 'Something went wrong.',
    detail: (err && err.detail) || undefined,
  });
}

/* ------------------------------- API ------------------------------- */

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/state', wrap(async (req, res) => {
  const cred = await github.loadToken();

  /* Fire-and-forget: refresh our view of the remote in the background,
     throttled inside fetchRemote. The count below is read from refs we
     already have, so this request never waits on the network. */
  repo.fetchRemote(cred && cred.token).catch(() => {});

  const [pending, ahead, last, list, behind] = await Promise.all([
    repo.pendingChanges(),
    repo.unpushedCount(),
    repo.lastCommit(),
    repo.isRepo() ? projects.listAll() : Promise.resolve({ visible: [], hidden: [], categories: projects.CATEGORIES }),
    repo.behindCount(),
  ]);
  res.json({
    auth: cred ? { login: cred.login, name: cred.name, avatar: cred.avatar, repo: cred.repo } : null,
    repo: {
      cloned: repo.isRepo(),
      branch: repo.BRANCH,
      pending: pending.files,
      pendingCount: pending.count,
      unpushed: ahead,
      behind,
      lastCommit: last,
      liveUrl: LIVE_URL,
    },
    ...list,
    limits: { maxEdge: images.MAX_EDGE, targetBytes: images.TARGET_BYTES },
  });
}));

app.post('/api/auth', wrap(async (req, res) => {
  const token = String((req.body && req.body.token) || '').trim();
  if (!token) throw Object.assign(new Error('Paste your token first.'), { status: 400 });
  const record = await github.verify(token);
  await github.saveToken(record);
  await repo.setIdentity(record.name, record.email);
  res.json({ auth: { login: record.login, name: record.name, avatar: record.avatar, repo: record.repo } });
}));

app.delete('/api/auth', wrap(async (req, res) => {
  await github.clearToken();
  res.json({ ok: true });
}));

app.get('/api/projects/:slug', wrap(async (req, res) => {
  const slug = projects.assertSafeSlug(req.params.slug);
  const data = await projects.readProject(slug);
  const order = await projects.readOrder();
  res.json({
    slug,
    data,
    visible: order.includes(slug),
    filesOnDisk: await projects.filesOnDisk(slug),
    problems: await projects.validate(data, slug),
  });
}));

app.post('/api/projects', wrap(async (req, res) => {
  const { slug, data } = await projects.createProject(req.body || {});
  res.status(201).json({ slug, data, problems: await projects.validate(data, slug) });
}));

app.put('/api/projects/:slug', wrap(async (req, res) => {
  const slug = projects.assertSafeSlug(req.params.slug);
  const { data } = await projects.updateProject(slug, req.body || {});
  res.json({ slug, data, problems: await projects.validate(data, slug) });
}));

app.post('/api/projects/:slug/visible', wrap(async (req, res) => {
  const slug = projects.assertSafeSlug(req.params.slug);
  await projects.setVisible(slug, !!(req.body && req.body.visible));
  res.json({ ok: true });
}));

app.delete('/api/projects/:slug', wrap(async (req, res) => {
  const slug = projects.assertSafeSlug(req.params.slug);
  await projects.eraseProject(slug);
  res.json({ ok: true });
}));

app.post('/api/order', wrap(async (req, res) => {
  await projects.reorder((req.body && req.body.order) || []);
  res.json({ ok: true });
}));

app.post('/api/projects/:slug/photos', upload.array('photos', 24), wrap(async (req, res) => {
  const slug = projects.assertSafeSlug(req.params.slug);
  if (!req.files || !req.files.length) {
    throw Object.assign(new Error('No photos were received.'), { status: 400 });
  }
  const added = [];
  const failed = [];
  for (const f of req.files) {
    try {
      added.push(await images.addPhoto(slug, f.buffer, f.originalname));
    } catch (err) {
      failed.push({ name: f.originalname, error: err.message });
    }
  }

  /* Append the new photos to project.json straight away, so a photo on
     disk is always a photo in the data — no orphan files to explain. */
  if (added.length) {
    const data = await projects.readProject(slug).catch(() => projects.normalise({}));
    data.photos = Array.isArray(data.photos) ? data.photos : [];
    for (const a of added) data.photos.push({ image: a.image, heading: '', text: '' });
    if (!data.cover) data.cover = data.photos[0].image;
    await projects.updateProject(slug, data);
  }

  res.json({ added, failed });
}));

app.delete('/api/projects/:slug/photos/:image', wrap(async (req, res) => {
  const slug = projects.assertSafeSlug(req.params.slug);
  const image = req.params.image;
  await images.deletePhoto(slug, image);

  const data = await projects.readProject(slug);
  data.photos = (data.photos || []).filter((p) => p.image !== image);
  // If the cover just went, fall back to the first remaining photo
  // rather than leaving a reference to a file that no longer exists.
  if (data.cover === image) data.cover = (data.photos[0] && data.photos[0].image) || '';
  await projects.updateProject(slug, data);

  res.json({ ok: true, data });
}));

app.post('/api/publish', wrap(async (req, res) => {
  const cred = await github.loadToken();
  if (!cred) throw Object.assign(new Error('Sign in to GitHub first.'), { status: 401 });

  /* Refuse to publish a project that would break on the live site. This
     is the whole reason the Studio exists, so it is a hard stop rather
     than a warning. Hidden projects are not checked — they are not
     served, and half-finished drafts are a legitimate state. */
  const { visible } = await projects.listAll();
  const blocking = visible.filter((p) => p.problems && p.problems.length);
  if (blocking.length && !(req.body && req.body.force)) {
    return res.status(409).json({
      error: 'Some projects that are live on the site are not finished yet.',
      blocking: blocking.map((p) => ({ slug: p.slug, title: p.title, problems: p.problems })),
    });
  }

  const rebuilds = await projects.runRebuilds();
  const message = String((req.body && req.body.message) || '').trim() || 'Update gallery projects';

  const result = await repo.publish({
    token: cred.token,
    message,
    authorName: cred.name,
    authorEmail: cred.email,
  });

  res.json({ ...result, rebuilds, liveUrl: LIVE_URL });
}));

app.get('/api/publish/status', wrap(async (req, res) => {
  const cred = await github.loadToken();
  res.json({ pages: cred ? await github.pagesStatus(cred.token) : null });
}));

/* Pull the newest website changes into the local copy. Offered in the
   UI whenever the clone is behind, and run automatically at startup. */
app.post('/api/update', wrap(async (req, res) => {
  const cred = await github.loadToken();
  const result = await repo.pullLatest(cred && cred.token);
  res.json(result);
}));

app.post('/api/discard', wrap(async (req, res) => {
  await repo.discardChanges();
  res.json({ ok: true });
}));

/* ----------------------------- Studio UI ----------------------------- */

app.use('/studio', express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.get('/studio', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* --------------------- The site itself, as preview -------------------- */

/* Injected into every previewed page. Deliberately small and
   self-contained: it must not depend on the site's own CSS or JS, and
   must not alter layout (fixed position, own stacking context). */
const BAR = `
<div id="indigo-studio-bar" style="
  position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483647;
  display:flex;align-items:center;gap:14px;padding:9px 16px;border-radius:999px;
  background:rgba(32,24,48,.93);backdrop-filter:blur(8px);
  box-shadow:0 6px 28px rgba(0,0,0,.3);
  font:400 12px/1 'Segoe UI',system-ui,sans-serif;letter-spacing:.06em;color:#fff;">
  <span style="text-transform:uppercase;opacity:.6;font-size:10px;letter-spacing:.16em">Preview</span>
  <a href="/studio" style="color:#ccbb92;text-decoration:none;border-bottom:1px solid transparent"
     onmouseover="this.style.borderBottomColor='#ccbb92'"
     onmouseout="this.style.borderBottomColor='transparent'">Open Studio</a>
  <a id="indigo-studio-edit" href="#" style="display:none;color:#fff;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.4)">Edit this project</a>
  <button type="button" onclick="document.getElementById('indigo-studio-bar').remove()"
    aria-label="Hide this bar" style="all:unset;cursor:pointer;opacity:.5;padding:0 2px;font-size:14px">&times;</button>
</div>
<script>
(function () {
  // On a project page, offer a direct link to that project's editor.
  var slug = new URLSearchParams(location.search).get('p');
  if (slug) {
    var a = document.getElementById('indigo-studio-edit');
    a.href = '/studio#edit/' + encodeURIComponent(slug);
    a.style.display = 'inline';
  }
})();
</script>
`;

/* Never serve the git metadata, and never let a path escape SITE_DIR. */
function safeSitePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  if (decoded.split('/').some((seg) => seg === '.git' || seg === '..')) return null;
  const full = path.join(SITE_DIR, decoded);
  const rel = path.relative(SITE_DIR, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

app.use(wrap(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!repo.isRepo()) {
    return res.status(503).type('html').send(
      `<body style="font:16px system-ui;padding:3rem;max-width:34rem;margin:auto">
       <h1>Setting up…</h1><p>The Studio is still downloading the website.
       Give it a moment and refresh. If this persists, open
       <a href="/studio">the Studio</a> for the error.</p></body>`
    );
  }

  let target = safeSitePath(req.path);
  if (!target) return res.status(404).type('text').send('Not found');

  // Directory -> index.html
  try {
    if ((await fsp.stat(target)).isDirectory()) target = path.join(target, 'index.html');
  } catch { /* fall through to the 404 handling below */ }

  const isHtml = /\.html?$/i.test(target);

  if (!fs.existsSync(target)) {
    // Mirror GitHub Pages: unknown paths get the site's own 404.html, so
    // Mia previews the real behaviour, including the page I just built.
    const custom = path.join(SITE_DIR, '404.html');
    if (fs.existsSync(custom)) {
      const html = await fsp.readFile(custom, 'utf8');
      return res.status(404).type('html').set('Cache-Control', 'no-store')
        .send(html.replace(/<\/body>/i, BAR + '</body>'));
    }
    return res.status(404).type('text').send('Not found');
  }

  res.set('Cache-Control', 'no-store');

  if (!isHtml) return res.sendFile(target);

  const html = await fsp.readFile(target, 'utf8');
  res.type('html').send(
    html.includes('</body>') ? html.replace(/<\/body>/i, BAR + '</body>') : html + BAR
  );
}));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[studio]', err && err.message ? err.message : err);
  fail(res, err);
});

/* ------------------------------- boot ------------------------------- */

(async function start() {
  try {
    const cred = await github.loadToken();
    // The website repo is public, so the first clone needs no token —
    // Mia can browse and edit before she ever signs in. The token is
    // only required to publish.
    const { cloned } = await repo.ensureClone(cred && cred.token);
    console.log(cloned ? '[studio] cloned the website repo' : '[studio] using the existing clone');
    if (cred) await repo.setIdentity(cred.name, cred.email);

    /* Sync on every start, so she never opens the Studio onto a version
       of the site that was superseded days ago. Non-fatal: if GitHub is
       unreachable, the local copy still works perfectly well. */
    if (!cloned) {
      try {
        const { updated, behind } = await repo.pullLatest(cred && cred.token);
        console.log(updated
          ? `[studio] pulled ${behind} new change(s) from GitHub`
          : '[studio] already up to date');
      } catch (err) {
        console.warn('[studio] could not sync on startup:', err.message);
      }
    }
  } catch (err) {
    // Not fatal: the Studio still starts so it can show the problem.
    console.error('[studio] setup problem:', err.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[studio] ready — site preview on http://localhost:${PORT}/`);
    console.log(`[studio]         editor      on http://localhost:${PORT}/studio`);
  });
})();
