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
  const [, goalResult] = await Promise.all([
    user.isAdmin ? api.getInvites().then(r => { invites = r; }).catch(() => {}) : Promise.resolve(),
    api.getGoal(currentYear).then(r => { goal = r; }).catch(() => {}),
  ]);

  render(container, user, invites, goal, currentYear);
}

function render(container, user, invites, goal, currentYear) {
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
              <p class="font-semibold text-stone-100">${escHtml(user.username)}</p>
              ${user.isAdmin ? '<span class="text-xs text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full ring-1 ring-amber-400/20">admin</span>' : ''}
            </div>
            <p class="text-xs text-stone-500 mt-0.5">Your profile is public</p>
          </div>
        </div>

        <!-- Bio -->
        <div>
          <label class="text-xs text-stone-500 block mb-1">Bio <span class="text-stone-600">(shown on your public profile)</span></label>
          <textarea id="bio-input" rows="2" maxlength="500" placeholder="A few words about you…"
            class="field-input w-full resize-none">${escHtml(user.bio ?? '')}</textarea>
        </div>

        <!-- Avatar URL -->
        <div>
          <label class="text-xs text-stone-500 block mb-1">Profile picture URL</label>
          <input id="avatar-url-input" type="url" value="${escHtml(user.avatarUrl ?? '')}"
            placeholder="https://example.com/photo.jpg"
            class="field-input w-full" />
        </div>

        <!-- Banner URL -->
        <div>
          <label class="text-xs text-stone-500 block mb-1">Profile banner URL <span class="text-stone-600">(wide image, shown behind your name)</span></label>
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
          <span class="text-stone-500">Shareable link: </span>
          <a href="${escHtml(profileUrl)}" class="text-amber-400 hover:text-amber-300 transition-colors break-all">${escHtml(profileUrl)}</a>
        </div>
      </section>

      <!-- Change password -->
      <section class="card-section space-y-3">
        <h2 class="font-semibold text-stone-200">Change password</h2>
        <form id="change-pw-form" class="space-y-3">
          <div>
            <label class="text-xs text-stone-500 block mb-1">Current password</label>
            <input type="password" name="currentPassword" required class="field-input" />
          </div>
          <div>
            <label class="text-xs text-stone-500 block mb-1">New password</label>
            <input type="password" name="newPassword" required class="field-input" />
          </div>
          <button type="submit"
            class="px-4 py-2 bg-stone-700 hover:bg-stone-600 active:scale-[0.98] rounded-lg text-sm font-medium transition-all duration-150">
            Update password
          </button>
          <p id="pw-msg" class="text-xs hidden"></p>
        </form>
      </section>

      <!-- Reading goal -->
      ${renderGoalSection(goal, currentYear)}

      <!-- Appearance -->
      ${renderAppearanceSection()}

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
        <h2 class="font-semibold text-stone-200">Reading Goal — ${year}</h2>
        ${target ? `<span class="text-xs text-stone-500">${read} / ${target} books</span>` : ''}
      </div>
      ${target ? `
      <div class="space-y-1.5">
        <div class="w-full rounded-full overflow-hidden" style="background:rgba(68,64,60,0.4);height:6px">
          <div class="h-full rounded-full progress-fill" style="width:${pct}%;background:var(--color-accent)"></div>
        </div>
        <p class="text-xs text-stone-500">${pct}% of your ${year} goal</p>
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
          class="px-3 py-2 text-stone-500 hover:text-red-400 text-sm transition-colors">
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
  const idleClass = 'border-stone-600 text-stone-400 hover:border-stone-400';

  const themeBtn = (value, label) => `
    <button class="theme-btn flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${value !== theme ? idleClass : ''}"
            style="${value === theme ? activeStyle : ''}"
            data-theme="${value}">${label}</button>`;

  const sizeBtn = (value, label, icon) => `
    <button class="size-btn flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border transition-colors ${value !== cardSize ? idleClass : ''}"
            style="${value === cardSize ? activeStyle : ''}"
            data-size="${value}">
      <span class="${icon} bg-stone-600 rounded-sm" style="display:inline-block"></span>
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
      <h2 class="font-semibold text-stone-200">Appearance</h2>

      <div class="space-y-2">
        <p class="text-xs text-stone-400 font-medium uppercase tracking-wider">Theme</p>
        <div class="flex gap-2">
          ${themeBtn('dark', 'Dark')}
          ${themeBtn('sepia', 'Sepia')}
          ${themeBtn('light', 'Light')}
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-stone-400 font-medium uppercase tracking-wider">Card size</p>
        <div class="flex gap-2">
          ${sizeBtn('miniature', 'Miniature', 'w-3 h-5')}
          ${sizeBtn('small',     'Small',     'w-5 h-7')}
          ${sizeBtn('medium',    'Medium',    'w-7 h-10')}
          ${sizeBtn('large',     'Large',     'w-9 h-14')}
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-stone-400 font-medium uppercase tracking-wider">Accent color</p>
        <div class="flex gap-3 items-center">
          ${Object.keys(ACCENT_COLORS).map(accentSwatch).join('')}
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-stone-400 font-medium uppercase tracking-wider">Search language</p>
        <p class="text-xs text-stone-500">Default language filter applied to all book searches. You can still override it per-search in the advanced form.</p>
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

function renderImportExportSection() {
  return `
    <section class="card-section space-y-4">
      <h2 class="font-semibold text-stone-200">Import / Export</h2>
      <p class="text-xs text-stone-500">Tab-separated CSV. Compatible with the Places reading app format.</p>

      <div class="flex gap-3">
        <button id="export-btn"
          class="px-4 py-2 bg-stone-700 hover:bg-stone-600 active:scale-[0.98] rounded-lg text-sm font-medium transition-all duration-150">
          ↓ Export library
        </button>
      </div>

      <div class="space-y-2">
        <label class="text-xs text-stone-400 block">Import from CSV file</label>
        <div class="flex gap-3 items-center">
          <input type="file" id="import-file" accept=".csv,.tsv,.txt"
            class="text-sm text-stone-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                   file:bg-stone-700 file:text-stone-200 file:text-sm file:cursor-pointer
                   file:hover:bg-stone-600 file:transition-colors" />
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

function renderInviteSection(invites) {
  return `
    <section class="card-section space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-stone-200">Invite codes</h2>
        <button id="create-invite-btn"
          class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-lg text-sm transition-all duration-150 shadow-sm shadow-amber-500/20">
          + New invite
        </button>
      </div>
      <p id="invite-msg" class="text-xs hidden"></p>
      <div id="invites-list" class="space-y-2">
        ${invites.length ? invites.map(i => renderInviteRow(i)).join('') : `<p class="text-stone-500 text-sm italic">No invite codes yet.</p>`}
      </div>
    </section>`;
}

function renderInviteRow(invite) {
  const used = !!invite.used_at;
  return `
    <div class="flex items-center gap-2 bg-stone-800 rounded-lg px-3 py-2 text-sm" data-invite-code="${escHtml(invite.code)}">
      <code class="flex-1 font-mono text-sm ${used ? 'text-stone-500 line-through' : 'text-amber-300'}">${escHtml(invite.code)}</code>
      ${used
        ? `<span class="text-xs text-stone-500">Used by ${escHtml(invite.used_by_username ?? '?')}</span>`
        : `<button class="copy-invite text-xs text-stone-400 hover:text-amber-400 transition-colors" data-code="${escHtml(invite.code)}">Copy</button>
           <button class="revoke-invite text-xs text-stone-500 hover:text-red-400 transition-colors" data-code="${escHtml(invite.code)}">Revoke</button>`}
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
          <button class="revoke-no text-xs px-1 text-stone-400 hover:text-stone-200">Cancel</button>
        </span>`;
      row.querySelector('.revoke-yes').addEventListener('click', async () => {
        try {
          await api.deleteInvite(btn.dataset.code);
          row.remove();
          if (!container.querySelectorAll('[data-invite-code]').length) {
            container.querySelector('#invites-list').innerHTML = `<p class="text-stone-500 text-sm italic">No invite codes yet.</p>`;
          }
        } catch (err) {
          inviteMsg.className = 'text-xs text-red-400';
          inviteMsg.textContent = err.message;
          inviteMsg.classList.remove('hidden');
        }
      });
      row.querySelector('.revoke-no').addEventListener('click', () => {
        row.querySelector('.revoke-confirm').outerHTML =
          `<button class="revoke-invite text-xs text-stone-500 hover:text-red-400 transition-colors" data-code="${escHtml(btn.dataset.code)}">Revoke</button>`;
        attachInviteHandlers(container);
      });
    });
  });
}

