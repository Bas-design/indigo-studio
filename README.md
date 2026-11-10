# Indigo Studio

A local web app that lets Mia add and edit gallery projects without
touching JSON, resize photos without PowerToys, and publish to the live
site with one button. Runs in Docker on her own PC; the only thing she
installs is Docker Desktop.

It replaces, for her, essentially all of
`assets/projects/HOW-TO-ADD-A-PROJECT.md`.

---

## What it does

| Manual step in the old guide | In the Studio |
|---|---|
| Resize to 2000px / 80% / <600 KB with PowerToys | automatic on upload (sharp) |
| Rename to `01-living-room.jpg` | automatic, slugified, numbered |
| Copy `_TEMPLATE/project.json`, edit in Notepad | a form |
| Get the commas right; check at jsonlint.com | impossible to produce bad JSON |
| Add the folder name to `projects.json` | automatic; order via ▲▼ |
| `node rebuild-preview-data.js` | run automatically before publish |
| `node rebuild-sitemap.js` | run automatically before publish |
| Upload files to the host | **Publish** button |

It also auto-rotates photos by EXIF (phone portraits came out sideways
otherwise) and strips metadata, which removes the GPS coordinates of a
client's home from the published file.

## Giving it to Mia

### What she needs

1. **Docker Desktop.** The only install. Everything else ships inside the
   image.
2. **A GitHub account**, and an accepted invitation as a collaborator on
   `Bas-design/indigo-interiors` (Settings → Collaborators → Add people →
   Write). She must click **Accept** in the email; an unaccepted
   invitation looks identical to no access.
3. **A classic personal access token** with the `public_repo` scope. The
   sign-in screen walks her through it.

### Token type is not a preference — fine-grained tokens cannot work here

A fine-grained PAT is scoped to a single *resource owner*: the account
that created it, or an organisation that account belongs to. It cannot
be pointed at a repository owned by a **different personal account**, and
GitHub documents collaborator access as a known limitation. Their own
wording: only classic tokens have write access to public repositories you
do not own.

`indigo-interiors` is owned by `Bas-design`, so a fine-grained token works
for **you** and cannot work for **Mia** — she would not even see the
repository in the picker. `github.verify()` now detects a `github_pat_`
prefix and says so directly rather than reporting a bare 404.

`public_repo` rather than `repo`: it grants write to public repositories
only, so the token cannot touch anything private she owns.

> If this ever moves to a GitHub **organisation**, fine-grained tokens
> become possible again (the org must enable them), and that is the
> cleaner long-term shape for a client project. Not worth doing solely
> for this.

### Packaging

The Studio needs its own **public** repository, because
`Update Indigo Studio.bat` downloads from it before any sign-in exists:

```
gh repo create Bas-design/indigo-studio --public --source=tools/studio --push
```

`site/` and `config/` are gitignored, so they are never in the download
and survive every update. If you name it something else, change
`STUDIO_REPO` at the top of `Update Indigo Studio.bat`.

Then send her the folder however you like — a zip is fine for the first
copy. After that she updates in place with the .bat, so you never send a
second zip.

There are no secrets in the repo: the token lives in `config/`, outside
both the clone and the download.

## Staying in sync

Two independent staleness problems, handled separately:

**The website** — the clone syncs on every container start, and
`/api/state` runs a throttled background `fetch` (2 min) so the UI can
show how many commits it is behind. A gold bar then offers **Get the
latest**, which runs `pull --rebase --autostash`. It is offered rather
than applied silently, because a pull rewrites files underneath someone
who may be mid-edit.

Verified both paths: with a clean tree, and with an uncommitted
work-in-progress project — the draft survived and the incoming commit
landed. On a genuine conflict it aborts the rebase, keeps her work and
tells her to ask you.

**The Studio itself** — `Update Indigo Studio.bat` pulls the latest from
the public studio repo using only `curl`, `tar` and `robocopy`, all built
into Windows 11, so she installs nothing extra. It excludes `site`,
`config` and `.git`, stops the container, copies, and rebuilds.

## Running it

```
docker compose up -d --build
```

Then <http://localhost:4100/studio>. Mia uses `Start Indigo Studio.bat`,
which starts Docker Desktop if needed, waits for the health check, and
opens the browser.

Two things on one port, deliberately:

- `/` — the real website, served from the git working copy, with a small
  Studio bar injected. She browses the actual gallery and clicks through
  to edit what she is looking at.
- `/studio` — the editor.

The site is served at the root rather than under `/preview` because
`404.html` uses root-relative paths and `project.html?p=<slug>` links
have to resolve naturally. Under a path prefix both break.

## Layout

```
tools/studio/
├── docker-compose.yml        REPO_URL, branch, allowed paths, live URL
├── Dockerfile                node:22-bookworm-slim + git + sharp
├── Start/Stop ….bat          what Mia double-clicks
├── site/                     the clone (gitignored; created on first run)
├── config/                   the saved token (gitignored, outside site/)
└── app/
    ├── server.js             API, Studio UI, site preview
    ├── lib/repo.js           git: clone, status, publish
    ├── lib/projects.js       JSON read/write + validation
    ├── lib/images.js         the photo pipeline
    ├── lib/github.js         token verify, Pages build status
    └── public/               the editor (vanilla JS, no build step)
```

## The safety properties

These are the reasons the thing is trustworthy, and the parts to be
careful about if you change it:

**It can only write two paths.** `repo.js` has `PUBLISH_PATHS =
['assets/projects', 'sitemap.xml']`. Every git call that stages, commits,
reverts or cleans passes that list explicitly. A bug in the Studio
therefore cannot rewrite the site's HTML, CSS or JS — the parts Mia
cannot repair. `sitemap.xml` is in the list only because
`rebuild-sitemap.js` writes it at the site root and each new project adds
a URL; it is fully machine-generated, so the Studio can own it.

**It refuses to publish a broken project.** `/api/publish` validates
every *visible* project first and returns 409 with a per-project problem
list. Hidden projects are skipped, so half-finished drafts are a
legitimate state. Verified: a project missing its location, summary,
brief and photo text blocked the publish and committed nothing.

**JSON cannot be malformed.** She never edits text; the server builds the
object, validates it, and writes `JSON.stringify(data, null, 2)`. Output
matches the existing files' house style byte for byte — same 2-space
indent, same key order as `_TEMPLATE/project.json`.

**Writes are atomic.** Temp file in the same directory, then rename, so a
container stop mid-write leaves the previous file intact rather than a
truncated one.

**Slugs cannot traverse.** `assertSafeSlug` is `^[a-z0-9][a-z0-9-]*$`,
applied to every slug arriving from the browser; photo names are matched
against a bare-filename pattern. `.git` and `..` are rejected by the
static handler, so `/.git/config` 404s.

**The token is scoped and isolated.** Fine-grained PAT, one repo,
Contents: read/write. Stored in `/config` — mounted outside the website
clone precisely so it can never be committed. `github.verify()` checks
`permissions.push` rather than just that the token is valid, so a
read-only token is rejected at sign-in instead of at the first failed
publish. Git reads it through an askpass helper from `GIT_TOKEN`, so it
never appears in argv, in `.git/config`, or in git's error output, and any
token substring is redacted from error messages before they reach the
browser.

**Only this machine can reach it.** Loopback and private ranges only
(Docker's userland proxy rewrites the source address to the bridge
gateway, so strict loopback would reject host traffic). Override with
`ALLOW_REMOTE=1` if you ever need to.

## Publishing

`repo.publish()` commits, then `pull --rebase --autostash`, then pushes.
On a rebase conflict it aborts, leaves her work intact, and says to ask
you — a conflict needs a human and should be vanishingly rare while she
is the only one touching `assets/projects`.

The UI then polls `/repos/.../pages/builds/latest` so it does not claim
"published" while the old version is still being served, and times out
to a soft message after five minutes.

## If you change the repo

`REPO_URL` in `docker-compose.yml` points at **the public repo**
(`Bas-design/indigo-interiors`), which is what GitHub Pages serves — not
`indigo-dev-history`. That is also the answer to the drift question: the
public repo is now canonical for project content, because this is where
Mia's work lands.

## Tested

Verified against the live repo: clone on first run; all four real
projects validate clean; create → upload → fill → validate → delete
round-trip; a 1.4 MB 1366×2048 portrait resized to 1334×2000 at 210 KB
with orientation intact; `/.git/config` blocked; 404.html served for deep
unknown paths; publish refused with no token (401) and refused with an
unfinished visible project (409, nothing committed).

Not yet exercised with a real token, so the first live publish is the one
thing still unproven end to end.
