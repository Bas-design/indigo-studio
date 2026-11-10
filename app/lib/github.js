'use strict';
/* GitHub side: who is signed in, can they write to the repo, and how is
   the deploy going.

   The token is a fine-grained personal access token scoped to the one
   repository with Contents: read and write. It is stored in /config,
   which is mounted outside the website clone so it can never be
   committed, and is written with mode 600. */

const fsp = require('fs/promises');
const path = require('path');

const CONFIG_DIR = process.env.CONFIG_DIR || '/config';
const CRED_FILE = path.join(CONFIG_DIR, 'credentials.json');
const REPO_URL = process.env.REPO_URL || '';

/* "https://github.com/Bas-design/indigo-interiors.git" -> owner + repo */
function repoSlug() {
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(REPO_URL);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function api(pathname, token, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'indigo-studio',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch { /* non-JSON error page */ }
  return { ok: res.ok, status: res.status, json, text: body };
}

async function loadToken() {
  try {
    const raw = JSON.parse(await fsp.readFile(CRED_FILE, 'utf8'));
    return raw && typeof raw.token === 'string' ? raw : null;
  } catch {
    return null;
  }
}

async function saveToken(record) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(CRED_FILE, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  // mkdir/writeFile modes are masked by umask; set it explicitly. On a
  // Windows bind mount this is a no-op, which is fine — the file is still
  // outside the repo and never served.
  try { await fsp.chmod(CRED_FILE, 0o600); } catch { /* best effort */ }
}

async function clearToken() {
  await fsp.rm(CRED_FILE, { force: true });
}

/* Check a token and confirm it can actually push to this repo, rather
   than only that it is a valid token. A token with no write access would
   otherwise look fine until the first publish failed. */
async function verify(token) {
  const user = await api('/user', token);
  if (!user.ok) {
    throw Object.assign(
      new Error(user.status === 401
        ? 'GitHub did not accept that token. It may have been copied incompletely, or it may have expired.'
        : `GitHub returned an error (${user.status}).`),
      { status: 400 }
    );
  }

  const slug = repoSlug();
  if (!slug) throw new Error('REPO_URL in docker-compose.yml is not a GitHub URL.');

  /* Token type matters here, and the difference is invisible until a
     push fails. A fine-grained token is scoped to a single resource
     owner — the account that created it, or an organisation it belongs
     to — so it cannot be granted access to a repository owned by a
     different personal account. GitHub states that only classic tokens
     have write access to public repositories you do not own. That is
     exactly this case for anyone who is a collaborator rather than the
     owner, so say so plainly instead of reporting a bare 404. */
  const fineGrained = /^github_pat_/.test(token);

  const r = await api(`/repos/${slug.owner}/${slug.repo}`, token);
  if (!r.ok) {
    throw Object.assign(
      new Error(
        fineGrained
          ? `That is a fine-grained token, and those cannot reach ${slug.owner}/${slug.repo} ` +
            `because the repository belongs to a different account. Create a classic token ` +
            `instead (github.com/settings/tokens/new) with the "public_repo" scope ticked.`
          : `That token cannot see ${slug.owner}/${slug.repo}. Check that you have accepted ` +
            `the invitation to the repository, and that the token has the "public_repo" scope.`
      ),
      { status: 400 }
    );
  }
  const push = !!(r.json && r.json.permissions && r.json.permissions.push);
  if (!push) {
    throw Object.assign(
      new Error(
        `That token can read ${slug.owner}/${slug.repo} but not write to it. ` +
        (fineGrained
          ? 'Fine-grained tokens cannot write to another account\'s repository — use a classic token with "public_repo".'
          : 'Tick the "public_repo" scope when creating it, and make sure you have accepted the repository invitation.')
      ),
      { status: 400 }
    );
  }

  return {
    token,
    login: user.json.login,
    name: user.json.name || user.json.login,
    // Commits need an email. A user with a private email has none on the
    // API, and GitHub accepts the noreply form for attribution.
    email: user.json.email || `${user.json.login}@users.noreply.github.com`,
    avatar: user.json.avatar_url || null,
    repo: `${slug.owner}/${slug.repo}`,
    savedAt: new Date().toISOString(),
  };
}

/* Deploy progress after a publish. Pages builds take a little while, and
   without this the UI would claim "published" while the live site still
   showed the old version. */
async function pagesStatus(token) {
  const slug = repoSlug();
  if (!slug) return null;
  const r = await api(`/repos/${slug.owner}/${slug.repo}/pages/builds/latest`, token);
  if (!r.ok || !r.json) return null;
  return {
    status: r.json.status,          // "building" | "built" | "errored"
    commit: r.json.commit || null,
    error: (r.json.error && r.json.error.message) || null,
    createdAt: r.json.created_at || null,
    updatedAt: r.json.updated_at || null,
  };
}

module.exports = { loadToken, saveToken, clearToken, verify, pagesStatus, repoSlug, CRED_FILE };
