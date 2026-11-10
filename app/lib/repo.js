'use strict';
/* Git side of the Studio: clone the website repo, report what has
   changed, and publish.

   One rule runs through this file: the Studio may only ever touch the
   paths in PUBLISH_PATHS. Everything that stages, commits, reverts or
   cleans passes that list explicitly, so a bug here cannot rewrite the
   site's HTML, CSS or JavaScript — the parts Mia cannot repair herself.

   The list is exactly two entries:
     assets/projects  — project folders, photos, projects.json, and the
                        projects-data.js snapshot
     sitemap.xml      — site root, written by rebuild-sitemap.js, because
                        each new project adds a URL for search engines

   sitemap.xml sits outside the projects folder but is entirely machine
   generated, so it is safe for the Studio to own. Nothing else is. */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const SITE_DIR = process.env.SITE_DIR || '/site';
const REPO_URL = process.env.REPO_URL || '';
const BRANCH = process.env.REPO_BRANCH || 'main';
const PROJECTS_SUBDIR = process.env.PROJECTS_SUBDIR || 'assets/projects';
const SITEMAP_FILE = process.env.SITEMAP_FILE || 'sitemap.xml';

/* The complete set of paths the Studio is allowed to write. See the note
   at the top of this file — do not widen it without a good reason. */
const PUBLISH_PATHS = [PROJECTS_SUBDIR, SITEMAP_FILE];

/* The username goes in the remote URL (it is not a secret); the token is
   supplied by the askpass helper from GIT_TOKEN, so it never appears in
   argv, in .git/config, or in git's error output. */
function authUrl(url) {
  return url.replace(/^https:\/\//, 'https://x-access-token@');
}

function git(args, { token, cwd = SITE_DIR, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024 * 16,
      env: {
        ...process.env,
        GIT_TOKEN: token || '',
        GIT_ASKPASS: '/usr/local/bin/askpass',
        GIT_TERMINAL_PROMPT: '0',
        // Keep output stable regardless of the host's locale.
        LC_ALL: 'C',
      },
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message || '').toString();
        // Belt and braces: never let a token reach a log or the browser.
        const clean = token ? msg.split(token).join('***') : msg;
        const e = new Error(clean.trim() || 'git failed');
        e.code = err.code;
        return reject(e);
      }
      resolve(stdout.toString());
    });
  });
}

const isRepo = () => fs.existsSync(path.join(SITE_DIR, '.git'));

/* Clone on first run. The bind-mounted folder exists but is empty, so we
   clone into it rather than into a new subdirectory. */
async function ensureClone(token) {
  if (isRepo()) {
    // Keep the remote on the username-bearing form in case the folder was
    // cloned by hand.
    await git(['remote', 'set-url', 'origin', authUrl(REPO_URL)], { token });
    return { cloned: false };
  }
  if (!REPO_URL) throw new Error('REPO_URL is not set in docker-compose.yml');

  await fsp.mkdir(SITE_DIR, { recursive: true });

  /* `git clone` into "." refuses unless the directory is genuinely
     empty, so placeholders have to go rather than merely be tolerated —
     a .gitkeep left by the repo, or the lost+found some bind mounts
     carry, is enough to abort the clone. */
  const PLACEHOLDERS = ['.gitkeep', '.gitignore', 'lost+found', '.DS_Store', 'Thumbs.db'];
  const entries = await fsp.readdir(SITE_DIR);
  const junk = entries.filter((e) => !PLACEHOLDERS.includes(e));
  if (junk.length) {
    throw new Error(
      `The site folder is not empty but is not a git clone either ` +
      `(found: ${junk.slice(0, 5).join(', ')}). Move those files aside and restart.`
    );
  }
  for (const p of entries) {
    await fsp.rm(path.join(SITE_DIR, p), { recursive: true, force: true });
  }

  await git(['clone', '--branch', BRANCH, authUrl(REPO_URL), '.'], { token, timeout: 300000 });
  return { cloned: true };
}

async function setIdentity(name, email) {
  await git(['config', 'user.name', name || 'Indigo Interiors']);
  await git(['config', 'user.email', email || 'noreply@indigointeriors.com.au']);
}

/* What has Mia changed but not published? Scoped to the projects folder,
   which is the only thing the Studio writes. */
async function pendingChanges() {
  if (!isRepo()) return { files: [], count: 0 };
  const out = await git(['status', '--porcelain', '--', ...PUBLISH_PATHS]);
  const files = out.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const code = l.slice(0, 2).trim();
      // Renames read "R  old -> new"; we only want the destination.
      const file = l.slice(2).trim().replace(/^.*? -> /, '').replace(/^"|"$/g, '');
      const kind = code.includes('D') ? 'deleted'
        : code === '??' || code.includes('A') ? 'added'
        : 'changed';
      return { file, kind };
    });
  return { files, count: files.length };
}

/* Commits waiting to go out — normally zero, but non-zero if a push
   failed partway and she is trying again. */
async function unpushedCount() {
  if (!isRepo()) return 0;
  try {
    const out = await git(['rev-list', '--count', `origin/${BRANCH}..HEAD`]);
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/* Staying in step with the repo.

   Until now the clone only synced inside publish(), which meant Mia
   could spend an afternoon editing against a site that Brandon had
   already changed, and only discover it at the moment she pressed
   Publish. These let the Studio notice beforehand and say so.

   fetchRemote is fire-and-forget and throttled: /api/state is called on
   every screen change, and a network round trip on each one would make
   the UI feel slow for information that changes rarely. */
let lastFetchAt = 0;
const FETCH_EVERY_MS = 120000;

async function fetchRemote(token, { force = false } = {}) {
  if (!isRepo()) return false;
  if (!force && Date.now() - lastFetchAt < FETCH_EVERY_MS) return false;
  lastFetchAt = Date.now();
  try {
    await git(['fetch', '--quiet', 'origin', BRANCH], { token, timeout: 60000 });
    return true;
  } catch {
    // Offline, or GitHub unreachable. Not an error worth surfacing —
    // everything local still works, and we simply report the last
    // known state.
    return false;
  }
}

/* How many commits upstream has that we do not. Read from the refs we
   already have, so this is instant and never blocks a request. */
async function behindCount() {
  if (!isRepo()) return 0;
  try {
    const out = await git(['rev-list', '--count', `HEAD..origin/${BRANCH}`]);
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/* Bring the clone up to date. --autostash keeps any work in progress:
   it is set aside, the new commits come in underneath, and the work is
   replayed on top. */
async function pullLatest(token) {
  if (!isRepo()) throw new Error('No clone yet.');
  await fetchRemote(token, { force: true });
  const behind = await behindCount();
  if (behind === 0) return { updated: false, behind: 0 };

  try {
    await git(['pull', '--rebase', '--autostash', 'origin', BRANCH], { token, timeout: 180000 });
  } catch (err) {
    try { await git(['rebase', '--abort']); } catch { /* not mid-rebase */ }
    const e = new Error(
      'The latest website changes clash with what you have been working on, ' +
      'so nothing was changed. Your work is safe. Ask Brandon to sort the clash out.'
    );
    e.detail = err.message;
    throw e;
  }
  return { updated: true, behind };
}

async function lastCommit() {
  if (!isRepo()) return null;
  try {
    const out = await git(['log', '-1', '--format=%h%x1f%an%x1f%ad%x1f%s', '--date=iso']);
    const [hash, author, date, subject] = out.trim().split('\x1f');
    return { hash, author, date, subject };
  } catch {
    return null;
  }
}

/* Publish: commit the project changes and push them to GitHub, which
   triggers the Pages deploy.

   Order matters. We commit before pulling so Mia's work is never carried
   around as a stash, then rebase onto whatever is upstream (Brandon may
   have pushed site changes meanwhile), then push. */
async function publish({ token, message, authorName, authorEmail }) {
  if (!isRepo()) throw new Error('No clone yet — restart the Studio.');
  if (!token) throw new Error('Not signed in to GitHub.');

  await setIdentity(authorName, authorEmail);

  // Stage ONLY the allowed paths. -A picks up deletions too.
  await git(['add', '-A', '--', ...PUBLISH_PATHS], { token });

  const staged = await git(['diff', '--cached', '--name-only', '--', ...PUBLISH_PATHS]);
  const changedFiles = staged.split('\n').map((s) => s.trim()).filter(Boolean);

  let committed = false;
  if (changedFiles.length) {
    await git(['commit', '-m', message || 'Update gallery projects'], { token });
    committed = true;
  }

  const ahead = await unpushedCount();
  if (!committed && ahead === 0) {
    return { ok: true, nothingToDo: true, changedFiles: [] };
  }

  // Bring in anything upstream first, so a push is never rejected for
  // being behind. --autostash covers stray edits outside the projects
  // folder that we deliberately did not stage.
  try {
    await git(['pull', '--rebase', '--autostash', 'origin', BRANCH], { token, timeout: 180000 });
  } catch (err) {
    // A conflict here needs a human. Put the tree back so she is not
    // left mid-rebase, and say so plainly.
    try { await git(['rebase', '--abort']); } catch { /* not rebasing */ }
    const e = new Error(
      'Your changes clashed with a change made elsewhere, so nothing was published. ' +
      'Your work is saved. Ask Brandon to sort the clash out.'
    );
    e.detail = err.message;
    throw e;
  }

  await git(['push', 'origin', `HEAD:${BRANCH}`], { token, timeout: 180000 });

  const commit = await lastCommit();
  return { ok: true, nothingToDo: false, changedFiles, commit };
}

/* Throw away everything since the last publish. The UI asks twice before
   calling this. Restricted to the allowed paths. */
async function discardChanges() {
  if (!isRepo()) throw new Error('No clone yet.');
  await git(['checkout', '--', ...PUBLISH_PATHS]);
  await git(['clean', '-fd', '--', ...PUBLISH_PATHS]);
}

module.exports = {
  SITE_DIR,
  BRANCH,
  PROJECTS_SUBDIR,
  PUBLISH_PATHS,
  projectsDir: () => path.join(SITE_DIR, PROJECTS_SUBDIR),
  git,
  isRepo,
  ensureClone,
  setIdentity,
  pendingChanges,
  unpushedCount,
  lastCommit,
  publish,
  discardChanges,
  fetchRemote,
  behindCount,
  pullLatest,
};
