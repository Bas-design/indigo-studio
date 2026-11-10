'use strict';
/* Indigo Studio — client.
 *
 * Deliberate choices, because the only user is not a developer:
 *  - Edits auto-save (debounced). There is no "did I press Save?" moment,
 *    and no way to lose a paragraph by clicking the wrong thing.
 *  - Anything irreversible goes through a typed confirmation.
 *  - Problems are shown where they are, in plain words, and block
 *    publishing rather than appearing on the live site.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let state = null;
let toastTimer = null;

function toast(message, bad) {
  const t = $('#toast');
  t.textContent = message;
  t.className = 'toast' + (bad ? ' toast--bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 7000 : 3200);
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: options.body instanceof FormData
      ? undefined
      : { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((json && json.error) || `Request failed (${res.status})`);
    err.payload = json;
    err.status = res.status;
    throw err;
  }
  return json;
}

/* Typed confirmation for destructive actions. Resolves true/false. */
function confirmBox({ title, body, confirmWord, okLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    $('#modalTitle').textContent = title;
    $('#modalBody').textContent = body;
    const wrap = $('#modalConfirmWrap');
    const input = $('#modalConfirm');
    const ok = $('#modalOk');
    ok.textContent = okLabel;

    if (confirmWord) {
      wrap.hidden = false;
      $('#modalConfirmLabel').textContent = `Type ${confirmWord} to confirm:`;
      input.value = '';
      ok.disabled = true;
      input.oninput = () => { ok.disabled = input.value.trim() !== confirmWord; };
    } else {
      wrap.hidden = true;
      ok.disabled = false;
    }

    function close(result) {
      modal.hidden = true;
      ok.onclick = null;
      $('#modalCancel').onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) { if (e.key === 'Escape') close(false); }

    ok.onclick = () => close(true);
    $('#modalCancel').onclick = () => close(false);
    document.addEventListener('keydown', onKey);
    modal.hidden = false;
    (confirmWord ? input : ok).focus();
  });
}

/* ------------------------------ chrome ------------------------------ */

function paintChrome() {
  const pending = $('#pending');
  const total = (state.repo.pendingCount || 0);
  if (total > 0) {
    pending.hidden = false;
    pending.textContent = `${total} unpublished change${total === 1 ? '' : 's'}`;
  } else {
    pending.hidden = true;
  }

  /* The website has moved on since this copy was taken — Brandon has
     pushed something. Offer it rather than pulling silently, because a
     pull rewrites files under her while she may be mid-edit. */
  let bar = $('#behindBar');
  if (state.repo.behind > 0) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'behindBar';
      bar.className = 'behind';
      document.querySelector('.bar').insertAdjacentElement('afterend', bar);
    }
    const n = state.repo.behind;
    bar.innerHTML =
      `<span>The website has been updated elsewhere — ${n} change${n === 1 ? '' : 's'} you do not have yet.</span>` +
      `<button class="btn btn--tiny" id="getLatest">Get the latest</button>`;
    $('#getLatest').onclick = async () => {
      const btn = $('#getLatest');
      btn.disabled = true;
      btn.textContent = 'Updating…';
      try {
        await api('/update', { method: 'POST' });
        await refresh();
        route();
        toast('Updated to the latest version of the website.');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Get the latest';
        toast(err.message, true);
      }
    };
  } else if (bar) {
    bar.remove();
  }

  const who = $('#who');
  if (state.auth) {
    who.innerHTML = `signed in as <strong>${esc(state.auth.login)}</strong>`;
  } else {
    who.innerHTML = `<a href="#signin">Sign in to publish</a>`;
  }

  document.querySelectorAll('[data-nav]').forEach((a) => {
    const active = location.hash.replace('#', '').split('/')[0] === a.dataset.nav;
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function refresh() {
  state = await api('/state');
  paintChrome();
  return state;
}

/* --------------------------- project list --------------------------- */

function projectRow(p, i, lastIndex) {
  const thumb = p.cover
    ? `<img class="prow__thumb" src="/assets/projects/${encodeURIComponent(p.slug)}/${encodeURIComponent(p.cover)}" alt="">`
    : `<div class="prow__thumb prow__thumb--none">No photo</div>`;

  const flags = [
    p.problems && p.problems.length ? `<span class="flag flag--bad">needs attention</span>` : '',
    p.visible ? '' : `<span class="flag flag--hidden">hidden</span>`,
  ].join('');

  const problems = (p.problems && p.problems.length)
    ? `<ul class="problems">${p.problems.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
    : '';

  const nudges = p.visible ? `
    <button class="nudge" data-up="${esc(p.slug)}" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move up">▲</button>
    <button class="nudge" data-down="${esc(p.slug)}" ${i === lastIndex ? 'disabled' : ''} title="Move down" aria-label="Move down">▼</button>` : '';

  return `
  <div class="prow ${p.visible ? '' : 'prow--hidden'} ${p.problems && p.problems.length ? 'prow--bad' : ''}">
    ${thumb}
    <div>
      <div class="prow__title">${esc(p.title)}${flags}</div>
      <div class="prow__meta">
        ${esc(p.categoryLabel || p.category || '—')}
        ${p.location ? ' · ' + esc(p.location) : ''}
        ${p.year ? ' · ' + esc(p.year) : ''}
        · ${p.photoCount} photo${p.photoCount === 1 ? '' : 's'}
      </div>
      ${problems}
    </div>
    <div class="prow__acts">
      ${nudges}
      <a class="btn btn--tiny" href="#edit/${encodeURIComponent(p.slug)}">Edit</a>
      <a class="btn btn--tiny btn--quiet" href="/project.html?p=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View</a>
      <button class="btn btn--tiny btn--quiet" data-vis="${esc(p.slug)}" data-to="${p.visible ? '0' : '1'}">
        ${p.visible ? 'Hide' : 'Show'}
      </button>
    </div>
  </div>`;
}

function renderList() {
  const { visible, hidden } = state;
  const rows = visible.map((p, i) => projectRow(p, i, visible.length - 1)).join('');

  view.innerHTML = `
    <div class="head">
      <h1>Projects</h1>
      <div class="head__right">
        <button class="btn" id="newProject">+ New project</button>
      </div>
    </div>
    <p class="muted">The order here is the order they appear in the gallery. Changes are saved as you make them, then go live when you press Publish.</p>

    ${visible.length ? `<div class="plist">${rows}</div>` : `
      <div class="card"><p>No projects on the site yet.</p>
      <button class="btn" id="newProject2">+ Add the first one</button></div>`}

    ${hidden.length ? `
      <h2 style="margin-top:2.5rem">Hidden</h2>
      <p class="muted">Still on your computer, not shown on the website.</p>
      <div class="plist">${hidden.map((p) => projectRow(p, 0, 0)).join('')}</div>` : ''}
  `;

  const make = async () => {
    const title = prompt('What is this project called?\n\n(e.g. "Bella Vista Penthouse" — you can change it later.)');
    if (title == null || !title.trim()) return;
    try {
      const { slug } = await api('/projects', { method: 'POST', body: JSON.stringify({ title: title.trim() }) });
      await refresh();
      location.hash = `#edit/${encodeURIComponent(slug)}`;
    } catch (err) { toast(err.message, true); }
  };
  if ($('#newProject')) $('#newProject').onclick = make;
  if ($('#newProject2')) $('#newProject2').onclick = make;

  view.querySelectorAll('[data-vis]').forEach((b) => {
    b.onclick = async () => {
      const slug = b.dataset.vis;
      const toVisible = b.dataset.to === '1';
      if (!toVisible) {
        const ok = await confirmBox({
          title: 'Hide this project?',
          body: 'It will be removed from the website but kept on your computer, so you can show it again whenever you like.',
          okLabel: 'Hide it',
        });
        if (!ok) return;
      }
      try {
        await api(`/projects/${encodeURIComponent(slug)}/visible`, {
          method: 'POST', body: JSON.stringify({ visible: toVisible }),
        });
        await refresh(); renderList();
        toast(toVisible ? 'Shown on the site.' : 'Hidden from the site.');
      } catch (err) { toast(err.message, true); }
    };
  });

  const move = async (slug, delta) => {
    const order = state.visible.map((p) => p.slug);
    const i = order.indexOf(slug);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    order.splice(j, 0, order.splice(i, 1)[0]);
    try {
      await api('/order', { method: 'POST', body: JSON.stringify({ order }) });
      await refresh(); renderList();
    } catch (err) { toast(err.message, true); }
  };
  view.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => move(b.dataset.up, -1); });
  view.querySelectorAll('[data-down]').forEach((b) => { b.onclick = () => move(b.dataset.down, 1); });
}

/* ------------------------------ editor ------------------------------ */

let editor = null;  // { slug, data, saveTimer, saving }

function setSaveState(text, bad) {
  const el = $('#saveState');
  if (el) { el.textContent = text; el.style.color = bad ? 'var(--bad)' : 'var(--body)'; }
}

function queueSave() {
  if (!editor) return;
  setSaveState('Saving…');
  clearTimeout(editor.saveTimer);
  editor.saveTimer = setTimeout(doSave, 700);
}

async function doSave() {
  if (!editor) return;
  const { slug } = editor;
  try {
    const res = await api(`/projects/${encodeURIComponent(slug)}`, {
      method: 'PUT', body: JSON.stringify(editor.data),
    });
    editor.problems = res.problems;
    setSaveState('Saved');
    paintProblems();
    refresh().catch(() => {});
  } catch (err) {
    setSaveState('Not saved — ' + err.message, true);
  }
}

function paintProblems() {
  const box = $('#problemBox');
  if (!box) return;
  const list = (editor.problems || []);
  if (!list.length) {
    box.innerHTML = `<div class="note">This project is complete and ready to publish.</div>`;
    return;
  }
  box.innerHTML = `<div class="note note--bad">
    <strong>Still to finish${editor.visible ? ' — this project is live on the site' : ''}:</strong>
    <ul class="problems" style="color:inherit">${list.map((p) => `<li>${esc(p.message)}</li>`).join('')}</ul>
  </div>`;
}

function photoBlock(ph, i, total, cover) {
  const src = `/assets/projects/${encodeURIComponent(editor.slug)}/${encodeURIComponent(ph.image)}`;
  return `
  <div class="photo" data-photo="${i}">
    <div>
      <img class="photo__img" src="${src}" alt="">
      <div class="photo__side" style="margin-top:.5rem">
        ${ph.image === cover
          ? `<span class="photo__badge">Gallery cover</span>`
          : `<button class="btn btn--tiny btn--quiet" data-cover="${i}">Make cover</button>`}
        <div style="display:flex;gap:.3rem">
          <button class="nudge" data-pup="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move photo up">▲</button>
          <button class="nudge" data-pdown="${i}" ${i === total - 1 ? 'disabled' : ''} aria-label="Move photo down">▼</button>
          <button class="btn btn--tiny btn--quiet" data-pdel="${i}">Remove</button>
        </div>
        <div class="hint">${esc(ph.image)}</div>
      </div>
    </div>
    <div>
      <label>
        <span>Heading</span>
        <input type="text" data-pfield="heading" data-pi="${i}" value="${esc(ph.heading)}" placeholder="The Living Room">
      </label>
      <label>
        <span>About this photo</span>
        <textarea data-pfield="text" data-pi="${i}" rows="4" placeholder="What was done in this room — materials, colours, the choices you made.">${esc(ph.text)}</textarea>
      </label>
    </div>
  </div>`;
}

async function renderEdit(slug) {
  view.innerHTML = `<div class="loading">Loading project…</div>`;
  let res;
  try {
    res = await api(`/projects/${encodeURIComponent(slug)}`);
  } catch (err) {
    view.innerHTML = `<div class="card"><p>${esc(err.message)}</p><a class="btn" href="#list">Back to projects</a></div>`;
    return;
  }

  editor = { slug, data: res.data, problems: res.problems, visible: res.visible, saveTimer: null };
  const d = editor.data;
  const cats = state.categories || [];

  view.innerHTML = `
    <div class="head">
      <h1>${esc(d.title || slug)}</h1>
      <div class="head__right">
        <span id="saveState" class="muted"></span>
        <a class="btn btn--quiet" href="/project.html?p=${encodeURIComponent(slug)}" target="_blank" rel="noopener">Preview&nbsp;↗</a>
        <a class="btn" href="#list">Done</a>
      </div>
    </div>

    <div id="problemBox"></div>

    <div class="card">
      <h2>About the project</h2>
      <label><span>Project name</span>
        <input type="text" data-field="title" value="${esc(d.title)}" placeholder="Harrington Park Residence">
      </label>
      <div class="row">
        <label><span>Category</span>
          <select data-field="category">
            <option value="">Choose…</option>
            ${cats.map((c) => `<option value="${esc(c.category)}" ${c.category === d.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </label>
        <label><span>Category wording shown to visitors</span>
          <input type="text" data-field="categoryLabel" value="${esc(d.categoryLabel)}">
          <div class="hint">Fills in automatically; change it if you want different wording.</div>
        </label>
      </div>
      <div class="row">
        <label><span>Location</span>
          <input type="text" data-field="location" value="${esc(d.location)}" placeholder="Harrington Park, NSW">
        </label>
        <label><span>Year completed</span>
          <input type="text" data-field="year" value="${esc(d.year)}" placeholder="2026" inputmode="numeric">
        </label>
      </div>
      <label><span>Short summary</span>
        <textarea data-field="summary" rows="2" placeholder="One or two sentences. This shows on the gallery tile and at the top of the project page.">${esc(d.summary)}</textarea>
      </label>
      <label><span>The story</span>
        <textarea data-field="brief" rows="8" placeholder="The client, the home, what they asked for, how you approached it.">${esc((d.brief || []).join('\n\n'))}</textarea>
        <div class="hint">Leave a blank line between paragraphs.</div>
      </label>
    </div>

    <div class="card">
      <h2>Photos</h2>
      <p class="muted">Drop photos in at any size, straight from the camera — they are resized and renamed for the web automatically.</p>
      <label class="drop" id="drop">
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple>
        <strong>Choose photos</strong> or drag them here<br>
        <span class="hint">JPEG, PNG or WebP · resized to ${state.limits.maxEdge}px</span>
      </label>
      <div id="photos">${(d.photos || []).map((ph, i) => photoBlock(ph, i, d.photos.length, d.cover)).join('')}</div>
    </div>

    <div class="card">
      <h2>Remove this project</h2>
      <p class="muted">Hiding keeps everything and just takes it off the website. Deleting erases the folder and its photos from your computer for good.</p>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap">
        <button class="btn btn--quiet" id="hideBtn">${editor.visible ? 'Hide from website' : 'Show on website'}</button>
        <button class="btn btn--danger" id="eraseBtn">Delete permanently</button>
      </div>
    </div>
  `;

  paintProblems();
  wireEditor();
}

function repaintPhotos() {
  const d = editor.data;
  $('#photos').innerHTML = (d.photos || []).map((ph, i) => photoBlock(ph, i, d.photos.length, d.cover)).join('');
  wirePhotos();
}

function wirePhotos() {
  view.querySelectorAll('[data-pfield]').forEach((el) => {
    el.oninput = () => {
      editor.data.photos[+el.dataset.pi][el.dataset.pfield] = el.value;
      queueSave();
    };
  });
  view.querySelectorAll('[data-cover]').forEach((b) => {
    b.onclick = () => {
      editor.data.cover = editor.data.photos[+b.dataset.cover].image;
      repaintPhotos(); queueSave();
    };
  });
  const swap = (i, j) => {
    const ph = editor.data.photos;
    if (j < 0 || j >= ph.length) return;
    ph.splice(j, 0, ph.splice(i, 1)[0]);
    repaintPhotos(); queueSave();
  };
  view.querySelectorAll('[data-pup]').forEach((b) => { b.onclick = () => swap(+b.dataset.pup, +b.dataset.pup - 1); });
  view.querySelectorAll('[data-pdown]').forEach((b) => { b.onclick = () => swap(+b.dataset.pdown, +b.dataset.pdown + 1); });

  view.querySelectorAll('[data-pdel]').forEach((b) => {
    b.onclick = async () => {
      const ph = editor.data.photos[+b.dataset.pdel];
      const ok = await confirmBox({
        title: 'Remove this photo?',
        body: `${ph.image} will be deleted from the project folder. This cannot be undone once published.`,
        okLabel: 'Remove it',
      });
      if (!ok) return;
      try {
        const res = await api(`/projects/${encodeURIComponent(editor.slug)}/photos/${encodeURIComponent(ph.image)}`, { method: 'DELETE' });
        editor.data = res.data;
        repaintPhotos();
        await refresh();
        toast('Photo removed.');
      } catch (err) { toast(err.message, true); }
    };
  });
}

function wireEditor() {
  // Plain text fields
  view.querySelectorAll('[data-field]').forEach((el) => {
    const field = el.dataset.field;
    el.oninput = () => {
      if (field === 'brief') {
        editor.data.brief = el.value.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      } else {
        editor.data[field] = el.value;
      }
      // Choosing a category fills the visitor-facing label, unless she
      // has already written her own wording.
      if (field === 'category') {
        const cat = (state.categories || []).find((c) => c.category === el.value);
        const labelEl = view.querySelector('[data-field="categoryLabel"]');
        const current = labelEl.value.trim();
        const isDefault = !current || (state.categories || []).some((c) => c.label === current);
        if (cat && isDefault) {
          labelEl.value = cat.label;
          editor.data.categoryLabel = cat.label;
        }
      }
      queueSave();
    };
  });

  wirePhotos();

  // Uploads
  const drop = $('#drop');
  const file = $('#file');
  const send = async (files) => {
    if (!files || !files.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('photos', f));
    setSaveState(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`);
    try {
      const res = await api(`/projects/${encodeURIComponent(editor.slug)}/photos`, { method: 'POST', body: fd });
      const fresh = await api(`/projects/${encodeURIComponent(editor.slug)}`);
      editor.data = fresh.data; editor.problems = fresh.problems;
      repaintPhotos(); paintProblems(); setSaveState('Saved');
      await refresh();

      const big = res.added.filter((a) => a.overTarget);
      let msg = `${res.added.length} photo${res.added.length === 1 ? '' : 's'} added.`;
      if (big.length) msg += ` ${big.length} stayed above 600 KB — still fine, just a little heavier.`;
      toast(msg);
      res.failed.forEach((f) => toast(`${f.name}: ${f.error}`, true));
    } catch (err) {
      setSaveState('Upload failed', true);
      toast(err.message, true);
    }
  };

  file.onchange = () => { send(file.files); file.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) send(e.dataTransfer.files);
  });

  $('#hideBtn').onclick = async () => {
    const toVisible = !editor.visible;
    if (!toVisible) {
      const ok = await confirmBox({
        title: 'Hide this project?',
        body: 'It comes off the website but stays on your computer. You can show it again any time.',
        okLabel: 'Hide it',
      });
      if (!ok) return;
    }
    await api(`/projects/${encodeURIComponent(editor.slug)}/visible`, {
      method: 'POST', body: JSON.stringify({ visible: toVisible }),
    });
    editor.visible = toVisible;
    $('#hideBtn').textContent = toVisible ? 'Hide from website' : 'Show on website';
    paintProblems();
    await refresh();
    toast(toVisible ? 'Shown on the site.' : 'Hidden from the site.');
  };

  $('#eraseBtn').onclick = async () => {
    const ok = await confirmBox({
      title: 'Delete this project permanently?',
      body: `The folder "${editor.slug}" and every photo in it will be deleted from your computer. This cannot be undone.`,
      confirmWord: 'delete',
      okLabel: 'Delete for good',
    });
    if (!ok) return;
    try {
      await api(`/projects/${encodeURIComponent(editor.slug)}`, { method: 'DELETE' });
      await refresh();
      location.hash = '#list';
      toast('Project deleted.');
    } catch (err) { toast(err.message, true); }
  };
}

/* ------------------------------ publish ------------------------------ */

function renderPublish() {
  const { pending, pendingCount, unpushed, lastCommit, liveUrl } = state.repo;
  const blocking = state.visible.filter((p) => p.problems && p.problems.length);

  if (!state.auth) {
    view.innerHTML = `
      <div class="head"><h1>Publish</h1></div>
      <div class="card">
        <div class="note note--bad">You need to sign in to GitHub before you can publish.</div>
        <p><a class="btn" href="#signin">Sign in</a></p>
      </div>`;
    return;
  }

  const nothing = pendingCount === 0 && unpushed === 0;

  view.innerHTML = `
    <div class="head"><h1>Publish</h1><div class="head__right"><a class="btn btn--quiet" href="#list">Back</a></div></div>

    ${nothing ? `<div class="card"><p>Everything is already published — nothing has changed since the last time.</p>
      ${lastCommit ? `<p class="muted">Last published ${esc(lastCommit.date)} — “${esc(lastCommit.subject)}”</p>` : ''}
      <a class="btn btn--quiet" href="${esc(liveUrl)}" target="_blank" rel="noopener">Open the live site ↗</a></div>` : `

      ${blocking.length ? `
        <div class="card">
          <div class="note note--bad">
            <strong>These projects are on the website but not finished.</strong>
            Publishing now would show them with pieces missing.
            <ul class="problems" style="color:inherit">
              ${blocking.map((p) => `<li><a href="#edit/${encodeURIComponent(p.slug)}">${esc(p.title)}</a> — ${esc(p.problems[0])}${p.problems.length > 1 ? ` (and ${p.problems.length - 1} more)` : ''}</li>`).join('')}
            </ul>
            Finish them, or hide them from the website, then come back.
          </div>
        </div>` : ''}

      <div class="card">
        <h2>What will go live</h2>
        <ul class="changes">
          ${pending.map((f) => `<li class="k-${esc(f.kind)}">${esc(f.kind)} — <code>${esc(f.file)}</code></li>`).join('')
            || '<li class="muted">No file changes, but there are commits waiting to be sent.</li>'}
        </ul>
        <label><span>Note for your records (optional)</span>
          <input type="text" id="msg" placeholder="Added the Bella Vista penthouse" maxlength="120">
        </label>
        <button class="btn btn--gold" id="go" ${blocking.length ? 'disabled' : ''}>
          ${blocking.length ? 'Fix the problems above first' : 'Publish to the website'}
        </button>
        <ol class="steps" id="steps" hidden>
          <li data-step="save">Preparing your changes</li>
          <li data-step="push">Sending them to GitHub</li>
          <li data-step="build">GitHub rebuilding the site</li>
          <li data-step="live">Live at ${esc(liveUrl.replace(/^https?:\/\//, ''))}</li>
        </ol>
        <div id="result"></div>
      </div>

      <div class="card">
        <h2>Start again</h2>
        <p class="muted">Throws away every change since the last publish, including photos you have added. The live website is not touched.</p>
        <button class="btn btn--quiet" id="discard">Discard my unpublished changes</button>
      </div>
    `}
  `;

  if ($('#discard')) {
    $('#discard').onclick = async () => {
      const ok = await confirmBox({
        title: 'Discard unpublished changes?',
        body: 'Everything you have done since the last publish will be lost. The live website stays exactly as it is.',
        confirmWord: 'discard',
        okLabel: 'Discard them',
      });
      if (!ok) return;
      try {
        await api('/discard', { method: 'POST' });
        await refresh();
        renderPublish();
        toast('Changes discarded.');
      } catch (err) { toast(err.message, true); }
    };
  }

  if (!$('#go')) return;

  $('#go').onclick = async () => {
    const steps = $('#steps');
    const go = $('#go');
    const mark = (name, cls) => {
      const li = steps.querySelector(`[data-step="${name}"]`);
      if (li) li.className = cls;
    };
    go.disabled = true;
    steps.hidden = false;
    mark('save', 'busy');

    try {
      const res = await api('/publish', {
        method: 'POST',
        body: JSON.stringify({ message: $('#msg').value.trim() }),
      });
      mark('save', 'done');

      if (res.nothingToDo) {
        mark('push', 'done'); mark('build', 'done'); mark('live', 'done');
        $('#result').innerHTML = `<div class="note">Nothing had changed, so there was nothing to send.</div>`;
        return;
      }

      mark('push', 'done');
      mark('build', 'busy');

      const failedScripts = (res.rebuilds || []).filter((r) => !r.ok);
      if (failedScripts.length) {
        $('#result').innerHTML = `<div class="note note--bad">Published, but a housekeeping script did not run:
          ${failedScripts.map((f) => `<br><code>${esc(f.script)}</code> — ${esc(f.error || 'failed')}`).join('')}
          <br>The site will still work. Worth mentioning to Brandon.</div>`;
      }

      /* GitHub takes a little while to rebuild. Poll so the UI does not
         claim success while the old version is still being served. */
      const started = Date.now();
      const poll = async () => {
        let pages = null;
        try { pages = (await api('/publish/status')).pages; } catch { /* keep waiting */ }

        if (pages && pages.status === 'built') {
          mark('build', 'done'); mark('live', 'done');
          $('#result').innerHTML = `<div class="note"><strong>Published.</strong>
            Your changes are live at <a href="${esc(state.repo.liveUrl)}" target="_blank" rel="noopener">${esc(state.repo.liveUrl)}</a>.
            <br><span class="muted">If the page looks unchanged, hold Ctrl and press F5 to force a refresh.</span></div>`;
          await refresh();
          return;
        }
        if (pages && pages.status === 'errored') {
          mark('build', 'failed');
          $('#result').innerHTML = `<div class="note note--bad">GitHub could not rebuild the site:
            ${esc(pages.error || 'unknown error')}<br>Your changes were saved and sent. Ask Brandon to take a look.</div>`;
          return;
        }
        if (Date.now() - started > 5 * 60 * 1000) {
          mark('build', 'failed');
          $('#result').innerHTML = `<div class="note">Your changes were sent successfully, but GitHub is taking longer than
            usual to rebuild. It will almost certainly finish on its own — check
            <a href="${esc(state.repo.liveUrl)}" target="_blank" rel="noopener">the site</a> in a few minutes.</div>`;
          return;
        }
        setTimeout(poll, 4000);
      };
      poll();
    } catch (err) {
      mark('save', 'failed');
      go.disabled = false;
      const p = err.payload;
      if (p && p.blocking) {
        $('#result').innerHTML = `<div class="note note--bad"><strong>${esc(p.error)}</strong>
          <ul class="problems" style="color:inherit">${p.blocking.map((b) => `<li><a href="#edit/${encodeURIComponent(b.slug)}">${esc(b.title)}</a> — ${esc(b.problems[0])}</li>`).join('')}</ul></div>`;
      } else {
        $('#result').innerHTML = `<div class="note note--bad">${esc(err.message)}
          ${p && p.detail ? `<br><span class="muted">${esc(p.detail)}</span>` : ''}</div>`;
      }
    }
  };
}

/* ------------------------------ sign in ------------------------------ */

function renderSignIn() {
  view.innerHTML = `
    <div class="head"><h1>Sign in to GitHub</h1></div>

    ${state.auth ? `
      <div class="card">
        <p>Signed in as <strong>${esc(state.auth.name)}</strong> (${esc(state.auth.login)}),
        publishing to <code>${esc(state.auth.repo)}</code>.</p>
        <button class="btn btn--quiet" id="out">Sign out</button>
      </div>` : ''}

    <div class="card">
      <p>Publishing needs a one-off access token from GitHub. It is saved on this
      computer only, and you will not have to do this again.</p>

      <p class="muted" style="font-size:.88rem">
        <strong>First:</strong> Brandon needs to have invited you to the website on
        GitHub, and you need to have accepted that invitation by email. If you have
        not had it, ask him before going further — the steps below will not work
        without it.
      </p>

      <ol class="muted" style="font-size:.88rem;line-height:1.7">
        <li>Open <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener">this GitHub page</a> (sign in if asked).</li>
        <li><strong>Note:</strong> type <code>Indigo Studio</code>.</li>
        <li><strong>Expiration:</strong> choose the longest option offered.</li>
        <li>Under <strong>Select scopes</strong>, tick <strong>public_repo</strong>
            — it sits indented just under <code>repo</code>. Tick only that one.</li>
        <li>Press <strong>Generate token</strong>, then copy the long code it shows you
            (it starts with <code>ghp_</code>).</li>
        <li>Paste it below. GitHub only shows it once, so if you lose it, just make another.</li>
      </ol>

      <p class="muted" style="font-size:.82rem">
        This has to be a <em>classic</em> token, which is what that link opens.
        GitHub's newer fine-grained tokens cannot write to someone else's
        repository, so they will not work here.
      </p>

      <label><span>Paste your token</span>
        <input type="password" id="token" autocomplete="off" spellcheck="false" placeholder="ghp_…">
      </label>
      <button class="btn" id="in">Sign in</button>
      <div id="authResult" style="margin-top:1rem"></div>
    </div>
  `;

  if ($('#out')) {
    $('#out').onclick = async () => {
      await api('/auth', { method: 'DELETE' });
      await refresh(); renderSignIn(); toast('Signed out.');
    };
  }

  $('#in').onclick = async () => {
    const token = $('#token').value.trim();
    const btn = $('#in');
    btn.disabled = true;
    $('#authResult').innerHTML = `<span class="muted">Checking with GitHub…</span>`;
    try {
      const res = await api('/auth', { method: 'POST', body: JSON.stringify({ token }) });
      $('#token').value = '';
      await refresh();
      $('#authResult').innerHTML = `<div class="note">Signed in as <strong>${esc(res.auth.login)}</strong>. You can publish now.</div>`;
      toast('Signed in to GitHub.');
    } catch (err) {
      $('#authResult').innerHTML = `<div class="note note--bad">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };
}

/* ------------------------------- router ------------------------------- */

async function route() {
  // Leaving the editor: flush any pending auto-save first, so navigating
  // away never drops the last keystrokes.
  if (editor) {
    clearTimeout(editor.saveTimer);
    const leaving = editor;
    editor = null;
    try { editor = leaving; await doSave(); } finally { editor = null; }
  }

  const hash = location.hash.replace(/^#/, '') || 'list';
  const [screen, arg] = hash.split('/');

  try {
    if (!state) await refresh(); else await refresh();
  } catch (err) {
    view.innerHTML = `<div class="card"><h1>Cannot reach the Studio</h1>
      <p>${esc(err.message)}</p><p class="muted">Is the Studio still running? Try closing and reopening it.</p></div>`;
    return;
  }

  if (!state.repo.cloned) {
    view.innerHTML = `<div class="card"><h1>Setting up</h1>
      <p>The Studio is downloading the website for the first time. This takes a minute.</p>
      <button class="btn" onclick="location.reload()">Check again</button></div>`;
    return;
  }

  paintChrome();
  if (screen === 'edit' && arg) return renderEdit(decodeURIComponent(arg));
  if (screen === 'publish') return renderPublish();
  if (screen === 'signin') return renderSignIn();
  return renderList();
}

window.addEventListener('hashchange', route);
route();
