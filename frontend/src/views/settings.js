import { api } from '../api.js';
import { getState, setState } from '../store.js';

export async function renderSettings(container) {
  const { user } = getState();
  if (!user) return;

  container.innerHTML = `<p class="text-stone-400 text-center py-20">Loading…</p>`;

  let invites = [];
  if (user.isAdmin) {
    try { invites = await api.getInvites(); } catch { /* non-fatal */ }
  }

  render(container, user, invites);
}

function render(container, user, invites) {
  const profileUrl = `${location.origin}${location.pathname}#u/${user.username}`;

  container.innerHTML = `
    <div class="max-w-lg mx-auto space-y-8">
      <h1 class="font-serif text-2xl font-semibold">Settings</h1>

      <!-- Profile -->
      <section class="bg-stone-900 rounded-xl p-5 space-y-4 ring-1 ring-white/10">
        <h2 class="font-semibold text-stone-200">Profile</h2>
        <p class="text-sm text-stone-400">Signed in as <strong class="text-stone-200">${escHtml(user.username)}</strong>${user.isAdmin ? ' <span class="text-amber-400 text-xs">(admin)</span>' : ''}</p>

        <label class="flex items-center gap-3 cursor-pointer group">
          <div class="relative">
            <input type="checkbox" id="public-toggle" class="sr-only peer" ${user.isPublic ? 'checked' : ''} />
            <div class="w-10 h-5 bg-stone-700 rounded-full peer peer-checked:bg-amber-500 transition-colors"></div>
            <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </div>
          <span class="text-sm text-stone-300 group-hover:text-stone-100">Public profile</span>
        </label>
        <p id="profile-link-row" class="text-xs text-stone-500 ${user.isPublic ? '' : 'hidden'}">
          Shareable link: <a href="${escHtml(profileUrl)}" class="text-amber-400 hover:underline">${escHtml(profileUrl)}</a>
        </p>
        <p id="settings-profile-msg" class="text-xs hidden"></p>
      </section>

      <!-- Change password -->
      <section class="bg-stone-900 rounded-xl p-5 space-y-3 ring-1 ring-white/10">
        <h2 class="font-semibold text-stone-200">Change password</h2>
        <form id="change-pw-form" class="space-y-3">
          <div>
            <label class="text-xs text-stone-400 block mb-1">Current password</label>
            <input type="password" name="currentPassword" required
              class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label class="text-xs text-stone-400 block mb-1">New password</label>
            <input type="password" name="newPassword" required
              class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
          </div>
          <button type="submit"
            class="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded-lg text-sm font-medium transition-colors">
            Update password
          </button>
          <p id="pw-msg" class="text-xs hidden"></p>
        </form>
      </section>

      <!-- Import / Export -->
      ${renderImportExportSection()}

      <!-- Invite manager (admin only) -->
      ${user.isAdmin ? renderInviteSection(invites) : ''}
    </div>`;

  // Public profile toggle
  const toggle = container.querySelector('#public-toggle');
  const linkRow = container.querySelector('#profile-link-row');
  const profileMsg = container.querySelector('#settings-profile-msg');

  toggle.addEventListener('change', async () => {
    try {
      const updated = await api.updateMe({ isPublic: toggle.checked });
      setState({ user: { ...getState().user, isPublic: updated.isPublic } });
      linkRow.classList.toggle('hidden', !toggle.checked);
      profileMsg.className = 'text-xs text-green-400';
      profileMsg.textContent = toggle.checked ? 'Profile is now public.' : 'Profile is now private.';
      setTimeout(() => { profileMsg.textContent = ''; }, 2000);
    } catch (err) {
      toggle.checked = !toggle.checked; // revert
      profileMsg.className = 'text-xs text-red-400';
      profileMsg.textContent = err.message;
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
      pwMsg.className = 'text-xs text-green-400';
      pwMsg.textContent = 'Password updated.';
    } catch (err) {
      pwMsg.className = 'text-xs text-red-400';
      pwMsg.textContent = err.message;
    }
    pwMsg.classList.remove('hidden');
    setTimeout(() => pwMsg.classList.add('hidden'), 3000);
  });

  // Import / Export
  attachImportExportHandlers(container);

  // Invite actions
  if (user.isAdmin) attachInviteHandlers(container);
}

function renderImportExportSection() {
  return `
    <section class="bg-stone-900 rounded-xl p-5 space-y-4 ring-1 ring-white/10">
      <h2 class="font-semibold text-stone-200">Import / Export</h2>
      <p class="text-xs text-stone-500">Tab-separated CSV. Compatible with the Places reading app format.</p>

      <div class="flex gap-3">
        <button id="export-btn"
          class="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded-lg text-sm font-medium transition-colors">
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
      alert('Export failed: ' + err.message);
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
      msg.className = 'text-xs text-green-400';
      msg.textContent = `Done — ${result.imported} added, ${result.skipped} skipped (${result.total} rows total).`;
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
    <section class="bg-stone-900 rounded-xl p-5 space-y-4 ring-1 ring-white/10">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-stone-200">Invite codes</h2>
        <button id="create-invite-btn"
          class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
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

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
