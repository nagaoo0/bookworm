import { api } from '../api.js';
import { getState } from '../store.js';
import { showToast } from '../components/toast.js';
import { escHtml } from '../utils.js';

export async function renderAdmin(container) {
  const { user } = getState();
  if (!user?.isAdmin) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">Access denied.</p>`;
    return;
  }

  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;

  let users = [];
  try {
    users = await api.adminGetUsers();
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
    return;
  }

  render(container, users);
}

function render(container, users) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeRecent = users.filter(u => u.last_active && new Date(u.last_active).getTime() > sevenDaysAgo).length;
  const totalBooks = users.reduce((sum, u) => sum + (u.book_count || 0), 0);
  const adminCount = users.filter(u => u.is_admin).length;

  container.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <h1 class="font-serif text-2xl font-semibold">Admin</h1>

      <!-- System stats -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="bg-surface-2 rounded-xl p-4 text-center ring-1 ring-border/20">
          <div class="font-serif text-3xl font-bold text-amber-400">${users.length}</div>
          <div class="text-xs text-muted mt-1 uppercase tracking-wider">Total Users</div>
        </div>
        <div class="bg-surface-2 rounded-xl p-4 text-center ring-1 ring-border/20">
          <div class="font-serif text-3xl font-bold text-green-400">${activeRecent}</div>
          <div class="text-xs text-muted mt-1 uppercase tracking-wider">Active (7d)</div>
        </div>
        <div class="bg-surface-2 rounded-xl p-4 text-center ring-1 ring-border/20">
          <div class="font-serif text-3xl font-bold text-amber-400">${totalBooks.toLocaleString()}</div>
          <div class="text-xs text-muted mt-1 uppercase tracking-wider">Total Books</div>
        </div>
        <div class="bg-surface-2 rounded-xl p-4 text-center ring-1 ring-border/20">
          <div class="font-serif text-3xl font-bold text-amber-400">${adminCount}</div>
          <div class="text-xs text-muted mt-1 uppercase tracking-wider">Admins</div>
        </div>
      </div>

      <section class="bg-surface rounded-xl ring-1 ring-border/40 overflow-hidden">
        <div class="px-5 py-4 border-b border-border">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-semibold text-text">Users <span class="text-muted text-sm font-normal">(${users.length})</span></h2>
          </div>
          <input type="text" id="admin-user-search" placeholder="Filter by username…"
            class="field-input w-full text-sm" autocomplete="off" />
        </div>
        <div id="admin-users-list" class="divide-y divide-border">
          ${users.map(u => renderUserRow(u)).join('')}
        </div>
      </section>
    </div>

    <!-- Reset-password modal -->
    <div id="reset-pw-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div class="bg-surface rounded-xl ring-1 ring-border/40 w-full max-w-sm p-5 space-y-4">
        <h3 class="font-semibold text-text">Reset password for <span id="reset-pw-username" class="text-amber-400"></span></h3>
        <input id="reset-pw-input" type="password" placeholder="New password (min 6 chars)"
          class="field-input w-full" />
        <p id="reset-pw-error" class="text-xs text-red-400 hidden"></p>
        <div class="flex gap-3">
          <button id="reset-pw-confirm" class="flex-1 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg py-2 text-sm transition-colors">
            Set password
          </button>
          <button id="reset-pw-cancel" class="flex-1 bg-surface-2 hover:bg-border/60 rounded-lg py-2 text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>`;

  attachHandlers(container, users);
}

function renderUserRow(u) {
  const since = new Date(u.created_at).toLocaleDateString();
  const lastActive = u.last_active ? new Date(u.last_active).toLocaleDateString() : 'never';
  return `
    <div class="px-5 py-4 flex flex-wrap items-center gap-3" data-user-id="${u.id}" data-username="${escHtml(u.username)}">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-text">${escHtml(u.username)}</span>
          ${u.is_admin ? `<span class="text-xs text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">admin</span>` : ''}
        </div>
        <div class="text-xs text-muted mt-0.5">
          Joined ${since} · ${u.book_count} books · last session ${lastActive}
        </div>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button class="admin-toggle-admin text-xs px-2.5 py-1.5 rounded-lg border transition-colors
                       ${u.is_admin ? 'border-amber-500/50 text-amber-400 hover:bg-red-900/30 hover:border-red-400 hover:text-red-400' : 'border-border text-muted hover:border-amber-500 hover:text-amber-400'}">
          ${u.is_admin ? 'Revoke admin' : 'Make admin'}
        </button>
        <button class="admin-revoke-sessions text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted hover:border-amber-500 hover:text-amber-400 transition-colors">
          Force logout
        </button>
        <button class="admin-reset-pw text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted hover:border-amber-500 hover:text-amber-400 transition-colors">
          Reset password
        </button>
        <button class="admin-delete-user text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted hover:border-red-400 hover:text-red-400 transition-colors">
          Delete user
        </button>
      </div>
    </div>`;
}

function attachHandlers(container, users) {
  // User search filter
  container.querySelector('#admin-user-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    container.querySelectorAll('#admin-users-list [data-user-id]').forEach(row => {
      row.style.display = (!q || row.dataset.username.toLowerCase().includes(q)) ? '' : 'none';
    });
  });

  const modal = container.querySelector('#reset-pw-modal');
  const pwInput = container.querySelector('#reset-pw-input');
  const pwError = container.querySelector('#reset-pw-error');
  const pwUsername = container.querySelector('#reset-pw-username');
  let resetTargetId = null;

  container.querySelector('#reset-pw-cancel').addEventListener('click', () => {
    modal.classList.add('hidden');
    pwInput.value = '';
    pwError.classList.add('hidden');
  });

  container.querySelector('#reset-pw-confirm').addEventListener('click', async () => {
    const pw = pwInput.value.trim();
    pwError.classList.add('hidden');
    if (!pw || pw.length < 6) {
      pwError.textContent = 'Password must be at least 6 characters.';
      pwError.classList.remove('hidden');
      return;
    }
    try {
      await api.adminResetPassword(resetTargetId, pw);
      modal.classList.add('hidden');
      pwInput.value = '';
      showToast('Password reset. User sessions revoked.');
    } catch (err) {
      pwError.textContent = err.message;
      pwError.classList.remove('hidden');
    }
  });

  container.querySelectorAll('[data-user-id]').forEach(row => {
    const id = parseInt(row.dataset.userId, 10);
    const username = row.dataset.username;
    const user = users.find(u => u.id === id);

    row.querySelector('.admin-toggle-admin').addEventListener('click', async () => {
      const newVal = !user.is_admin;
      try {
        await api.adminSetAdmin(id, newVal);
        user.is_admin = newVal;
        row.outerHTML = renderUserRow(user);
        // re-attach on the new row
        attachHandlers(container, users);
        showToast(`${username} is ${newVal ? 'now' : 'no longer'} an admin.`);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    row.querySelector('.admin-revoke-sessions').addEventListener('click', async () => {
      try {
        await api.adminRevokeSessions(id);
        showToast(`Sessions revoked for ${username}.`);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    row.querySelector('.admin-reset-pw').addEventListener('click', () => {
      resetTargetId = id;
      pwUsername.textContent = username;
      pwInput.value = '';
      pwError.classList.add('hidden');
      modal.classList.remove('hidden');
      pwInput.focus();
    });

    row.querySelector('.admin-delete-user').addEventListener('click', () => {
      const btn = row.querySelector('.admin-delete-user');
      if (btn.dataset.confirming) {
        api.adminDeleteUser(id).then(() => {
          row.remove();
          showToast(`User ${username} deleted.`);
        }).catch(err => showToast(err.message, 'error'));
      } else {
        btn.dataset.confirming = '1';
        btn.textContent = 'Confirm delete';
        btn.classList.replace('hover:text-red-400', 'text-red-400');
        btn.classList.replace('border-border', 'border-red-500');
        setTimeout(() => {
          if (btn.dataset.confirming) {
            delete btn.dataset.confirming;
            btn.textContent = 'Delete user';
            btn.classList.replace('text-red-400', 'hover:text-red-400');
            btn.classList.replace('border-red-500', 'border-border');
          }
        }, 4000);
      }
    });
  });
}

