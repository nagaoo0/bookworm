import { api } from '../api.js';
import { getState, setState } from '../store.js';
import { loadPrefs, savePrefs, ACCENT_COLORS } from '../prefs.js';
import { showToast } from '../components/toast.js';
import { avatarHTML } from '../components/avatar.js';
import { escHtml } from '../utils.js';

const SEARCH_LANGUAGES = [
  ['', 'Any language'],
  ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'],
  ['pl', 'Polish'], ['sv', 'Swedish'], ['cs', 'Czech'],
];

export async function renderSettings(container) {
  const { user } = getState();
  if (!user) return;

  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;

  const currentYear = new Date().getFullYear();
  let invites = [];
  let goal = null;
  let integrations = [];
  await Promise.all([
    user.isAdmin ? api.getInvites().then(r => { invites = r; }).catch(() => {}) : Promise.resolve(),
    api.getGoal(currentYear).then(r => { goal = r; }).catch(() => {}),
    api.getIntegrations().then(r => { integrations = r; }).catch(() => {}),
  ]);

  render(container, user, invites, goal, currentYear, integrations);
}

function render(container, user, invites, goal, currentYear, integrations = []) {
  const profileUrl = `${location.origin}${location.pathname}#u/${user.username}`;

  container.innerHTML = `
    <div class="max-w-lg mx-auto space-y-6 fade-in">
      <h1 class="font-serif text-2xl font-bold">Settings</h1>

      <!-- Profile -->
      <section class="card-section space-y-4">
        <div class="flex items-center gap-4">
          ${avatarHTML(user, { size: 48 })}
          <div>
            <div class="flex items-center gap-2">
              <p class="font-semibold text-text">${escHtml(user.username)}</p>
              ${user.isAdmin ? '<span class="text-xs text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-amber-400/20">admin</span>' : ''}
            </div>
            <p class="text-xs text-muted mt-0.5">Your profile is public</p>
          </div>
        </div>

        <!-- Bio -->
        <div>
          <label class="text-xs text-muted block mb-1">Bio <span class="text-muted">(shown on your public profile)</span></label>
          <textarea id="bio-input" rows="2" maxlength="500" placeholder="A few words about you…"
            class="field-input w-full resize-none">${escHtml(user.bio ?? '')}</textarea>
        </div>

        <!-- Avatar URL -->
        <div>
          <label class="text-xs text-muted block mb-1">Profile picture URL</label>
          <input id="avatar-url-input" type="url" value="${escHtml(user.avatarUrl ?? '')}"
            placeholder="https://example.com/photo.jpg"
            class="field-input w-full" />
        </div>

        <!-- Banner URL -->
        <div>
          <label class="text-xs text-muted block mb-1">Profile banner URL <span class="text-muted">(wide image, shown behind your name)</span></label>
          <input id="banner-url-input" type="url" value="${escHtml(user.bannerUrl ?? '')}"
            placeholder="https://example.com/banner.jpg"
            class="field-input w-full" />
        </div>

        <button id="save-profile-btn"
          class="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-lg text-sm transition-all duration-150 shadow-sm shadow-amber-500/20">
          Save profile
        </button>
        <p id="profile-msg" class="text-xs hidden"></p>

        <div class="glass-card rounded-lg px-3 py-2.5 text-xs">
          <span class="text-muted">Shareable link: </span>
          <a href="${escHtml(profileUrl)}" class="text-amber-400 hover:text-amber-300 transition-colors break-all">${escHtml(profileUrl)}</a>
        </div>
      </section>

      <!-- Change password -->
      <section class="card-section space-y-3">
        <h2 class="font-semibold text-text">Change password</h2>
        <form id="change-pw-form" class="space-y-3">
          <div>
            <label class="text-xs text-muted block mb-1">Current password</label>
            <input type="password" name="currentPassword" required class="field-input" />
          </div>
          <div>
            <label class="text-xs text-muted block mb-1">New password</label>
            <input type="password" name="newPassword" required class="field-input" />
          </div>
          <button type="submit"
            class="px-4 py-2 bg-surface-2 hover:bg-border/60 active:scale-[0.98] rounded-lg text-sm font-medium transition-all duration-150">
            Update password
          </button>
          <p id="pw-msg" class="text-xs hidden"></p>
        </form>
      </section>

      <!-- Reading goal -->
      ${renderGoalSection(goal, currentYear)}

      <!-- Appearance -->
      ${renderAppearanceSection()}

      <!-- Integrations -->
      ${renderIntegrationsSection(integrations)}

      <!-- Library Management -->
      ${renderLibraryManagementSection()}

      <!-- Import / Export -->
      ${renderImportExportSection()}

      <!-- Invite manager (admin only) -->
      ${user.isAdmin ? renderInviteSection(invites) : ''}
    </div>`;

  // Save profile (bio + avatarUrl)
  container.querySelector('#save-profile-btn')?.addEventListener('click', async () => {
    const bio = container.querySelector('#bio-input')?.value ?? '';
    const avatarUrl = container.querySelector('#avatar-url-input')?.value.trim() ?? '';
    const bannerUrl = container.querySelector('#banner-url-input')?.value.trim() ?? '';
    const msg = container.querySelector('#profile-msg');
    try {
      const updated = await api.updateMe({ bio: bio.trim() || null, avatarUrl: avatarUrl || null, bannerUrl: bannerUrl || null });
      setState({ user: { ...getState().user, bio: updated.bio, avatarUrl: updated.avatarUrl, bannerUrl: updated.bannerUrl } });
      showToast('Profile saved.');
      if (msg) msg.classList.add('hidden');
    } catch (err) {
      if (msg) { msg.className = 'text-xs text-red-400'; msg.textContent = err.message; msg.classList.remove('hidden'); }
    }
  });

  // Change password
  container.querySelector('#change-pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pwMsg = container.querySelector('#pw-msg');
    try {
      await api.updateMe({
        currentPassword: fd.get('currentPassword'),
        newPassword: fd.get('newPassword'),
      });
      e.target.reset();
      showToast('Password updated.');
      pwMsg.classList.add('hidden');
    } catch (err) {
      pwMsg.className = 'text-xs text-red-400';
      pwMsg.textContent = err.message;
      pwMsg.classList.remove('hidden');
    }
  });

  // Reading goal
  attachGoalHandlers(container, goal, currentYear);

  // Appearance
  attachAppearanceHandlers(container);

  // Integrations
  attachIntegrationsHandlers(container);

  // Library Management
  attachLibraryManagementHandlers(container);

  // Import / Export
  attachImportExportHandlers(container);

  // Invite actions
  if (user.isAdmin) attachInviteHandlers(container);
}

function renderGoalSection(goal, year) {
  const target = goal?.target ?? '';
  const read   = goal?.booksRead ?? 0;
  const pct = target ? Math.min(100, Math.round((read / target) * 100)) : 0;
  return `
    <section class="card-section space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-text">Reading Goal — ${year}</h2>
        ${target ? `<span class="text-xs text-muted">${read} / ${target} books</span>` : ''}
      </div>
      ${target ? `
      <div class="space-y-1.5">
        <div class="w-full rounded-full overflow-hidden bg-border/40" style="height:6px">
          <div class="h-full rounded-full progress-fill" style="width:${pct}%;background:var(--color-accent)"></div>
        </div>
        <p class="text-xs text-muted">${pct}% of your ${year} goal</p>
      </div>` : ''}
      <form id="goal-form" class="flex gap-3 items-center">
        <input type="number" id="goal-input" name="target" min="1" max="9999"
          value="${escHtml(String(target))}"
          placeholder="e.g. 24"
          class="field-input w-28" />
        <button type="submit"
          class="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-lg text-sm transition-all duration-150 shadow-sm shadow-amber-500/20">
          Save
        </button>
        ${target ? `<button type="button" id="clear-goal-btn"
          class="px-3 py-2 text-muted hover:text-red-400 text-sm transition-colors">
          Clear
        </button>` : ''}
      </form>
    </section>`;
}

function attachGoalHandlers(container, goal, year) {
  container.querySelector('#goal-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const target = parseInt(new FormData(e.target).get('target'), 10);
    if (!target || target < 1) return;
    try {
      await api.setGoal(year, target);
      showToast(`Goal set: ${target} books in ${year}.`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelector('#clear-goal-btn')?.addEventListener('click', async () => {
    try {
      await api.deleteGoal(year);
      container.querySelector('#goal-input').value = '';
      showToast('Reading goal cleared.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function renderAppearanceSection() {
  const { theme, cardSize, accent, searchLanguage } = loadPrefs();

  const activeStyle = 'border-color:var(--color-accent);color:var(--color-accent);background:color-mix(in srgb,var(--color-accent) 10%,transparent)';
  const idleClass = 'border-border text-muted hover:border-muted';

  const themeBtn = (value, label) => `
    <button class="theme-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${value !== theme ? idleClass : ''}"
            style="${value === theme ? activeStyle : ''}"
            data-theme="${value}">${label}</button>`;

  const sizeBtn = (value, label, icon) => `
    <button class="size-btn flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border transition-colors ${value !== cardSize ? idleClass : ''}"
            style="${value === cardSize ? activeStyle : ''}"
            data-size="${value}">
      <span class="${icon} bg-border rounded-sm" style="display:inline-block"></span>
      <span class="text-xs">${label}</span>
    </button>`;

  const accentSwatch = (value) => {
    const c = ACCENT_COLORS[value].main;
    return `<button class="accent-btn w-7 h-7 rounded-full border-2 transition-all
                            ${accent === value ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'}"
                    data-accent="${value}"
                    style="background:${c}" title="${value}"></button>`;
  };

  return `
    <section id="appearance-section" class="card-section space-y-5">
      <h2 class="font-semibold text-text">Appearance</h2>

      <div class="space-y-2">
        <p class="text-xs text-muted font-medium uppercase tracking-wider">Theme</p>
        <div class="flex gap-2">
          ${themeBtn('dark', 'Dark')}
          ${themeBtn('light', 'Light')}
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-muted font-medium uppercase tracking-wider">Card size</p>
        <div class="flex gap-2">
          ${sizeBtn('miniature', 'Miniature', 'w-3 h-5')}
          ${sizeBtn('small',     'Small',     'w-5 h-7')}
          ${sizeBtn('medium',    'Medium',    'w-7 h-10')}
          ${sizeBtn('large',     'Large',     'w-9 h-14')}
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-muted font-medium uppercase tracking-wider">Accent color</p>
        <div class="flex gap-3 items-center">
          ${Object.keys(ACCENT_COLORS).map(accentSwatch).join('')}
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-muted font-medium uppercase tracking-wider">Search language</p>
        <p class="text-xs text-muted">Default language filter applied to all book searches. You can still override it per-search in the advanced form.</p>
        <select id="search-language-select" class="field-input rounded-lg py-2">
          ${SEARCH_LANGUAGES.map(([v, l]) => `<option value="${v}"${searchLanguage === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </section>`;
}

function attachAppearanceHandlers(container) {
  const refresh = () => {
    const section = container.querySelector('#appearance-section');
    if (section) section.outerHTML = renderAppearanceSection();
    attachAppearanceHandlers(container);
  };

  container.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => { savePrefs({ theme: btn.dataset.theme }); refresh(); });
  });
  container.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => { savePrefs({ cardSize: btn.dataset.size }); refresh(); });
  });
  container.querySelectorAll('.accent-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      savePrefs({ accent: btn.dataset.accent });
      api.updateMe({ accent: btn.dataset.accent }).catch(() => {});
      refresh();
    });
  });

  container.querySelector('#search-language-select')?.addEventListener('change', e => {
    savePrefs({ searchLanguage: e.target.value });
    showToast(e.target.value ? `Search language set to ${e.target.options[e.target.selectedIndex].text}.` : 'Search language set to any.');
  });
}

// ── Library Management ────────────────────────────────────────────────────────

function renderLibraryManagementSection() {
  return `
    <section class="card-section space-y-4">
      <h2 class="font-semibold text-text">Library Management</h2>
      <p class="text-xs text-muted">Tools to clean up your library after syncing from external services.</p>

      <!-- Fetch missing covers -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium">Fetch missing covers</p>
          <p class="text-xs text-muted mt-0.5">Search Google Books for cover art on books that have none.</p>
        </div>
        <button id="fetch-covers-btn"
          class="shrink-0 px-3 py-1.5 bg-surface-2 hover:bg-border/60 active:scale-[0.98] rounded-lg text-xs font-medium transition-all">
          Fetch covers
        </button>
      </div>
      <p id="fetch-covers-msg" class="text-xs hidden"></p>

      <hr class="border-border/40" />

      <!-- Duplicate finder -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium">Find duplicate books</p>
          <p class="text-xs text-muted mt-0.5">Detect books that were imported from multiple sources and merge them into one entry.</p>
        </div>
        <button id="find-dupes-btn"
          class="shrink-0 px-3 py-1.5 bg-surface-2 hover:bg-border/60 active:scale-[0.98] rounded-lg text-xs font-medium transition-all">
          Find duplicates
        </button>
      </div>
      <p id="find-dupes-msg" class="text-xs hidden"></p>

      <!-- Duplicates list (populated dynamically) -->
      <div id="dupes-list" class="space-y-3 hidden"></div>
    </section>`;
}

function attachLibraryManagementHandlers(container) {
  // ── Fetch missing covers ──
  container.querySelector('#fetch-covers-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const msg = container.querySelector('#fetch-covers-msg');
    btn.disabled = true; btn.textContent = 'Fetching…';
    msg.classList.add('hidden');
    try {
      const { updated, checked } = await api.fetchMissingCovers();
      msg.className = 'text-xs text-green-400';
      msg.textContent = checked === 0
        ? 'All books already have cover art.'
        : `Updated ${updated} of ${checked} book${checked !== 1 ? 's' : ''} checked.`;
    } catch (err) {
      msg.className = 'text-xs text-red-400';
      msg.textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Fetch covers';
      msg.classList.remove('hidden');
    }
  });

  // ── Find duplicates ──
  container.querySelector('#find-dupes-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const msg = container.querySelector('#find-dupes-msg');
    const list = container.querySelector('#dupes-list');
    btn.disabled = true; btn.textContent = 'Scanning…';
    msg.classList.add('hidden');
    list.classList.add('hidden');
    list.innerHTML = '';
    try {
      const pairs = await api.findDuplicates();
      if (!pairs.length) {
        msg.className = 'text-xs text-green-400';
        msg.textContent = 'No duplicate books found.';
        msg.classList.remove('hidden');
      } else {
        msg.className = 'text-xs text-muted';
        msg.textContent = `${pairs.length} potential duplicate${pairs.length !== 1 ? 's' : ''} found. Choose which record to keep for each.`;
        msg.classList.remove('hidden');
        list.innerHTML = pairs.map((p, i) => renderDupePair(p, i)).join('');
        list.classList.remove('hidden');
        attachDupeHandlers(container, list, pairs);
      }
    } catch (err) {
      msg.className = 'text-xs text-red-400';
      msg.textContent = err.message;
      msg.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'Find duplicates';
    }
  });
}

function renderDupePair(pair, index) {
  const cover = (url, title) => url
    ? `<img src="${escHtml(url)}" alt="" class="w-10 h-14 object-cover rounded flex-shrink-0">`
    : `<div class="w-10 h-14 bg-surface-2 rounded flex-shrink-0 flex items-center justify-center text-lg">📖</div>`;

  const score = pair.score != null ? Math.round(pair.score * 100) : null;
  const scoreLabel = score == null ? '' : score >= 90 ? 'Exact' : score >= 70 ? 'Very likely' : 'Possible';
  const scoreColor = score == null ? '' : score >= 90 ? 'text-green-400' : score >= 70 ? 'text-amber-400' : 'text-muted';

  return `
    <div class="rounded-lg border border-border/60 p-3 space-y-2" data-dupe-index="${index}">
      ${score != null ? `<p class="text-xs ${scoreColor}"><span class="font-semibold">${scoreLabel}</span> · ${score}% match</p>` : ''}
      <div class="grid grid-cols-2 gap-3">
        <!-- Keep option -->
        <div class="space-y-1">
          <p class="text-xs text-muted font-medium uppercase tracking-wide">Keep</p>
          <div class="flex gap-2 items-start">
            ${cover(pair.keep_cover, pair.keep_title)}
            <div class="min-w-0">
              <p class="text-xs font-medium leading-snug line-clamp-2">${escHtml(pair.keep_title)}</p>
              <p class="text-xs text-muted truncate">${escHtml((pair.keep_authors ?? [])[0] ?? '')}</p>
            </div>
          </div>
        </div>
        <!-- Remove option -->
        <div class="space-y-1">
          <p class="text-xs text-muted font-medium uppercase tracking-wide">Remove</p>
          <div class="flex gap-2 items-start">
            ${cover(pair.remove_cover, pair.remove_title)}
            <div class="min-w-0">
              <p class="text-xs font-medium leading-snug line-clamp-2">${escHtml(pair.remove_title)}</p>
              <p class="text-xs text-muted truncate">${escHtml((pair.remove_authors ?? [])[0] ?? '')}</p>
            </div>
          </div>
        </div>
      </div>
      <div class="flex gap-2 items-center">
        <button class="dupe-merge-btn px-3 py-1 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded text-xs transition-all"
          data-keep="${pair.keep_id}" data-remove="${pair.remove_id}">
          Merge
        </button>
        <button class="dupe-swap-btn px-3 py-1 bg-surface-2 hover:bg-border/60 active:scale-[0.98] rounded text-xs font-medium transition-all"
          data-index="${index}">
          ⇄ Swap
        </button>
        <p class="dupe-status text-xs hidden"></p>
      </div>
    </div>`;
}

function attachDupeHandlers(container, list, pairs) {
  list.querySelectorAll('.dupe-merge-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const keepId = parseInt(btn.dataset.keep, 10);
      const removeId = parseInt(btn.dataset.remove, 10);
      const row = btn.closest('[data-dupe-index]');
      const status = row.querySelector('.dupe-status');
      btn.disabled = true; btn.textContent = 'Merging…';
      try {
        await api.mergeBooks(keepId, removeId);
        row.classList.add('opacity-40', 'pointer-events-none');
        status.className = 'dupe-status text-xs text-green-400';
        status.textContent = 'Merged.';
        status.classList.remove('hidden');
      } catch (err) {
        status.className = 'dupe-status text-xs text-red-400';
        status.textContent = err.message;
        status.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Merge';
      }
    });
  });

  list.querySelectorAll('.dupe-swap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      const pair = pairs[idx];
      // Swap keep/remove in the local data structure
      [pair.keep_id, pair.remove_id] = [pair.remove_id, pair.keep_id];
      [pair.keep_title, pair.remove_title] = [pair.remove_title, pair.keep_title];
      [pair.keep_authors, pair.remove_authors] = [pair.remove_authors, pair.keep_authors];
      [pair.keep_cover, pair.remove_cover] = [pair.remove_cover, pair.keep_cover];
      // Re-render the row
      const row = btn.closest('[data-dupe-index]');
      row.outerHTML = renderDupePair(pair, idx);
      // Re-attach handlers to the new element
      attachDupeHandlers(container, list, pairs);
    });
  });
}

function renderImportExportSection() {
  return `
    <section class="card-section space-y-4">
      <h2 class="font-semibold text-text">Import / Export</h2>
      <p class="text-xs text-muted">Tab-separated CSV. Compatible with the Places reading app format.</p>

      <div class="flex gap-3">
        <button id="export-btn"
          class="px-4 py-2 bg-surface-2 hover:bg-border/60 active:scale-[0.98] rounded-lg text-sm font-medium transition-all duration-150">
          ↓ Export library
        </button>
      </div>

      <div class="space-y-2">
        <label class="text-xs text-muted block">Import from CSV file</label>
        <div class="flex gap-3 items-center">
          <input type="file" id="import-file" accept=".csv,.tsv,.txt"
            class="text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                   file:bg-surface-2 file:text-text file:text-sm file:cursor-pointer
                   file:hover:bg-border/60 file:transition-colors" />
          <button id="import-btn" disabled
            class="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed
                   text-stone-950 font-semibold rounded-lg text-sm transition-colors">
            Import
          </button>
        </div>
        <p id="import-msg" class="text-xs hidden"></p>
      </div>
    </section>`;
}

function attachImportExportHandlers(container) {
  // Export
  container.querySelector('#export-btn').addEventListener('click', async () => {
    const btn = container.querySelector('#export-btn');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const res = await api.exportLibrary();
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bookworm-library.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↓ Export library';
    }
  });

  // Enable import button only when a file is chosen
  const fileInput = container.querySelector('#import-file');
  const importBtn = container.querySelector('#import-btn');
  fileInput.addEventListener('change', () => {
    importBtn.disabled = !fileInput.files.length;
  });

  // Import
  importBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const msg = container.querySelector('#import-msg');
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
    msg.classList.add('hidden');
    try {
      const text = await file.text();
      const result = await api.importLibrary(text);
      const imp = result.imported;
      const skp = result.skipped;
      msg.className = 'text-xs text-green-400';
      msg.textContent = `${imp} book${imp !== 1 ? 's' : ''} added${skp ? `, ${skp} duplicate${skp !== 1 ? 's' : ''} skipped` : ''}.`;
    } catch (err) {
      msg.className = 'text-xs text-red-400';
      msg.textContent = err.message;
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = 'Import';
      msg.classList.remove('hidden');
      fileInput.value = '';
    }
  });
}

// ── Integrations ──────────────────────────────────────────────────────────────

function renderIntegrationsSection(integrations = []) {
  const byService = Object.fromEntries(integrations.map(i => [i.service, i]));
  const abs = byService.audiobookshelf;
  const cal = byService.calibre;
  const calKobo = cal?.kobo_connected;

  const fmtDate = d => d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const statusBadge = connected => connected
    ? `<span class="text-xs text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-green-400/20">Connected</span>`
    : `<span class="text-xs text-muted bg-surface-2 px-1.5 py-0.5 rounded-full">Not connected</span>`;

  return `
    <section class="card-section space-y-5">
      <h2 class="font-semibold text-text">Integrations</h2>
      <p class="text-xs text-muted">Connect external services to sync your audiobook and ebook libraries automatically.</p>

      <!-- Audiobookshelf -->
      <details class="group" ${abs ? 'open' : ''}>
        <summary class="flex items-center justify-between cursor-pointer list-none select-none">
          <div class="flex items-center gap-2">
            <span class="text-lg">🎧</span>
            <span class="font-medium text-sm">Audiobookshelf</span>
            ${statusBadge(!!abs)}
          </div>
          <svg class="w-4 h-4 text-muted transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
        </summary>
        <div class="mt-4 space-y-3 pl-1">
          <p class="text-xs text-muted">Self-hosted audiobook server. Requires your server URL and an API token from your ABS account settings.</p>
          <div>
            <label class="text-xs text-muted block mb-1">Server URL</label>
            <input id="abs-url" type="url" placeholder="http://192.168.1.100:13378"
              value="${escHtml(abs?.server_url ?? '')}"
              class="field-input w-full" />
          </div>
          <div>
            <label class="text-xs text-muted block mb-1">API Token</label>
            <input id="abs-token" type="password" placeholder="Your ABS API token"
              value="${abs ? '••••••••' : ''}"
              class="field-input w-full" />
          </div>
          <div class="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" id="abs-auto-sessions" class="rounded"
              ${abs ? '' : 'checked'} />
            <label for="abs-auto-sessions">Auto-create reading session when I finish a book in ABS</label>
          </div>
          ${abs ? `<p class="text-xs text-muted">Last synced: ${fmtDate(abs.last_synced_at)}</p>` : ''}
          <div class="flex gap-2 flex-wrap">
            <button id="abs-save-btn"
              class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-lg text-xs transition-all">
              ${abs ? 'Update' : 'Connect'}
            </button>
            ${abs ? `
            <button id="abs-sync-btn"
              class="px-3 py-1.5 bg-surface-2 hover:bg-border/60 active:scale-[0.98] rounded-lg text-xs font-medium transition-all">
              Sync now
            </button>
            <button id="abs-disconnect-btn"
              class="px-3 py-1.5 text-red-400 hover:text-red-300 text-xs transition-colors">
              Disconnect
            </button>` : ''}
          </div>
          <p id="abs-msg" class="text-xs hidden"></p>
        </div>
      </details>

      <hr class="border-border/40" />

      <!-- Calibre-Web -->
      <details class="group" ${cal ? 'open' : ''}>
        <summary class="flex items-center justify-between cursor-pointer list-none select-none">
          <div class="flex items-center gap-2">
            <span class="text-lg">📚</span>
            <span class="font-medium text-sm">Calibre-Web (OPDS)</span>
            ${statusBadge(!!cal)}
          </div>
          <svg class="w-4 h-4 text-muted transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
        </summary>
        <div class="mt-4 space-y-3 pl-1">
          <p class="text-xs text-muted">Connects via the Calibre-Web OPDS catalog. Enable it in Calibre-Web: <strong>Admin → Configuration → Feature Configuration → Allow OPDS</strong>.</p>
          <div>
            <label class="text-xs text-muted block mb-1">Server URL</label>
            <input id="calibre-url" type="url" placeholder="http://localhost:8083"
              value="${escHtml(cal?.server_url ?? '')}"
              class="field-input w-full" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-xs text-muted block mb-1">Username (optional)</label>
              <input id="calibre-username" type="text" placeholder="admin"
                value="${cal ? '••' : ''}"
                class="field-input w-full" />
            </div>
            <div>
              <label class="text-xs text-muted block mb-1">Password (optional)</label>
              <input id="calibre-password" type="password" placeholder="••••••"
                class="field-input w-full" />
            </div>
          </div>
          <details class="group/adv">
            <summary class="text-xs text-muted cursor-pointer hover:text-text transition-colors select-none">Advanced</summary>
            <div class="mt-2">
              <label class="text-xs text-muted block mb-1">OPDS catalog path <span class="text-muted">(default: /opds/new)</span></label>
              <input id="calibre-opds-path" type="text" placeholder="/opds/new"
                value=""
                class="field-input w-full" />
            </div>
          </details>

          <hr class="border-border/40" />
          <div>
            <div class="flex items-center gap-2 mb-1">
              <label class="text-xs text-muted">Kobo sync token <span class="text-muted">(optional)</span></label>
              ${calKobo ? statusBadge(true) : ''}
            </div>
            <input id="calibre-kobo-token" type="password" placeholder="Paste token from Calibre-Web → Connect to Kobo"
              value="${calKobo ? '••••••••' : ''}"
              class="field-input w-full" />
            <p class="text-xs text-muted mt-1">Syncs reading progress and status from your Kobo device via Calibre-Web. Get the token in Calibre-Web under <strong>Settings → Connect to Kobo</strong>.</p>
          </div>

          ${cal ? `<p class="text-xs text-muted">Last synced: ${fmtDate(cal.last_synced_at)}</p>` : ''}
          <div class="flex gap-2 flex-wrap">
            <button id="calibre-save-btn"
              class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-lg text-xs transition-all">
              ${cal ? 'Update' : 'Connect'}
            </button>
            ${cal ? `
            <button id="calibre-sync-btn"
              class="px-3 py-1.5 bg-surface-2 hover:bg-border/60 active:scale-[0.98] rounded-lg text-xs font-medium transition-all">
              Sync now
            </button>
            <button id="calibre-disconnect-btn"
              class="px-3 py-1.5 text-red-400 hover:text-red-300 text-xs transition-colors">
              Disconnect
            </button>` : ''}
          </div>
          <p id="calibre-msg" class="text-xs hidden"></p>
        </div>
      </details>
    </section>`;
}

function showIntMsg(container, id, msg, isError = false) {
  const el = container.querySelector(`#${id}`);
  if (!el) return;
  el.className = `text-xs ${isError ? 'text-red-400' : 'text-green-400'}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function attachIntegrationsHandlers(container) {
  // ── Audiobookshelf ──
  container.querySelector('#abs-save-btn')?.addEventListener('click', async () => {
    const url = container.querySelector('#abs-url')?.value.trim();
    const rawToken = container.querySelector('#abs-token')?.value;
    const autoSessions = container.querySelector('#abs-auto-sessions')?.checked;
    if (!url || !rawToken || rawToken === '••••••••') {
      showIntMsg(container, 'abs-msg', 'Server URL and API token are required.', true);
      return;
    }
    try {
      await api.saveIntegration('audiobookshelf', {
        serverUrl: url,
        token: rawToken,
        auto_sessions: String(autoSessions),
      });
      showIntMsg(container, 'abs-msg', 'Connected! Initial sync starting in the background.');
      api.syncIntegration('audiobookshelf').catch(() => {});
    } catch (err) {
      showIntMsg(container, 'abs-msg', err.message, true);
    }
  });

  container.querySelector('#abs-sync-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      await api.syncIntegration('audiobookshelf');
      showIntMsg(container, 'abs-msg', 'Sync complete.');
    } catch (err) {
      showIntMsg(container, 'abs-msg', err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Sync now';
    }
  });

  container.querySelector('#abs-disconnect-btn')?.addEventListener('click', async () => {
    if (!confirm('Disconnect Audiobookshelf? Availability data will be removed.')) return;
    try {
      await api.disconnectIntegration('audiobookshelf');
      showToast('Audiobookshelf disconnected.');
      location.reload();
    } catch (err) {
      showIntMsg(container, 'abs-msg', err.message, true);
    }
  });

  // ── Calibre ──
  container.querySelector('#calibre-save-btn')?.addEventListener('click', async () => {
    const url = container.querySelector('#calibre-url')?.value.trim();
    const username = container.querySelector('#calibre-username')?.value.trim();
    const password = container.querySelector('#calibre-password')?.value;
    if (!url) {
      showIntMsg(container, 'calibre-msg', 'Server URL is required.', true);
      return;
    }
    const opdsPath = container.querySelector('#calibre-opds-path')?.value.trim();
    const rawKoboToken = container.querySelector('#calibre-kobo-token')?.value.trim();
    try {
      await api.saveIntegration('calibre', {
        serverUrl: url,
        ...(username && username !== '••' ? { username } : {}),
        ...(password ? { password } : {}),
        ...(opdsPath ? { opdsStartPath: opdsPath } : {}),
        ...(rawKoboToken && rawKoboToken !== '••••••••' ? { koboToken: rawKoboToken } : {}),
      });
      showIntMsg(container, 'calibre-msg', 'Connected! Initial sync starting in the background.');
      api.syncIntegration('calibre').catch(() => {});
    } catch (err) {
      showIntMsg(container, 'calibre-msg', err.message, true);
    }
  });

  container.querySelector('#calibre-sync-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      await api.syncIntegration('calibre');
      showIntMsg(container, 'calibre-msg', 'Sync complete.');
    } catch (err) {
      showIntMsg(container, 'calibre-msg', err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Sync now';
    }
  });

  container.querySelector('#calibre-disconnect-btn')?.addEventListener('click', async () => {
    if (!confirm('Disconnect Calibre? Availability data will be removed.')) return;
    try {
      await api.disconnectIntegration('calibre');
      showToast('Calibre disconnected.');
      location.reload();
    } catch (err) {
      showIntMsg(container, 'calibre-msg', err.message, true);
    }
  });
}

function renderInviteSection(invites) {
  return `
    <section class="card-section space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-text">Invite codes</h2>
        <button id="create-invite-btn"
          class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-lg text-sm transition-all duration-150 shadow-sm shadow-amber-500/20">
          + New invite
        </button>
      </div>
      <p id="invite-msg" class="text-xs hidden"></p>
      <div id="invites-list" class="space-y-2">
        ${invites.length ? invites.map(i => renderInviteRow(i)).join('') : `<p class="text-muted text-sm italic">No invite codes yet.</p>`}
      </div>
    </section>`;
}

function renderInviteRow(invite) {
  const used = !!invite.used_at;
  return `
    <div class="flex items-center gap-2 bg-surface-2 rounded-lg px-3 py-2 text-sm" data-invite-code="${escHtml(invite.code)}">
      <code class="flex-1 font-mono text-sm ${used ? 'text-muted line-through' : 'text-amber-300'}">${escHtml(invite.code)}</code>
      ${used
        ? `<span class="text-xs text-muted">Used by ${escHtml(invite.used_by_username ?? '?')}</span>`
        : `<button class="copy-invite text-xs text-muted hover:text-amber-400 transition-colors" data-code="${escHtml(invite.code)}">Copy</button>
           <button class="revoke-invite text-xs text-muted hover:text-red-400 transition-colors" data-code="${escHtml(invite.code)}">Revoke</button>`}
    </div>`;
}

function attachInviteHandlers(container) {
  const inviteMsg = container.querySelector('#invite-msg');

  container.querySelector('#create-invite-btn')?.addEventListener('click', async () => {
    try {
      const invite = await api.createInvite();
      const list = container.querySelector('#invites-list');
      const empty = list.querySelector('.italic');
      if (empty) empty.remove();
      list.insertAdjacentHTML('afterbegin', renderInviteRow(invite));
      attachInviteHandlers(container);
    } catch (err) {
      inviteMsg.className = 'text-xs text-red-400';
      inviteMsg.textContent = err.message;
      inviteMsg.classList.remove('hidden');
    }
  });

  container.querySelectorAll('.copy-invite').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.code).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
  });

  container.querySelectorAll('.revoke-invite').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-invite-code]');
      if (!row || row.querySelector('.revoke-confirm')) return;
      btn.outerHTML = `
        <span class="revoke-confirm flex items-center gap-1">
          <button class="revoke-yes text-xs px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-medium">Revoke</button>
          <button class="revoke-no text-xs px-1 text-muted hover:text-text">Cancel</button>
        </span>`;
      row.querySelector('.revoke-yes').addEventListener('click', async () => {
        try {
          await api.deleteInvite(btn.dataset.code);
          row.remove();
          if (!container.querySelectorAll('[data-invite-code]').length) {
            container.querySelector('#invites-list').innerHTML = `<p class="text-muted text-sm italic">No invite codes yet.</p>`;
          }
        } catch (err) {
          inviteMsg.className = 'text-xs text-red-400';
          inviteMsg.textContent = err.message;
          inviteMsg.classList.remove('hidden');
        }
      });
      row.querySelector('.revoke-no').addEventListener('click', () => {
        row.querySelector('.revoke-confirm').outerHTML =
          `<button class="revoke-invite text-xs text-muted hover:text-red-400 transition-colors" data-code="${escHtml(btn.dataset.code)}">Revoke</button>`;
        attachInviteHandlers(container);
      });
    });
  });
}

