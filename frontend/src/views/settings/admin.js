// Settings · Admin (admins only): invite codes and user management.
// One set of delegated listeners on the section element; lists are re-rendered without re-binding.
import { api } from '../../api.js';
import { html } from '../../utils.js';
import {
  EMPTY, TOAST, badge, button, card, delegate, emptyState, field, formatDate, iconButton, mountConfirmInline,
  mountFields, openModal, plural, setFieldError, skeletonCard, statCard, switchRow, timeAgo, toast,
} from '../../ui/index.js';
import { createScope, errorText } from './common.js';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function statsHTML(users) {
  const active = users.filter(u => u.last_active && Date.now() - new Date(u.last_active).getTime() < WEEK_MS).length;
  const books = users.reduce((sum, u) => sum + (u.book_count || 0), 0);
  const admins = users.filter(u => u.is_admin).length;
  return html`<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    ${statCard({ label: 'Users', value: users.length, size: 'sm' })}
    ${statCard({ label: 'Active in 7 days', value: active, size: 'sm' })}
    ${statCard({ label: 'Books', value: books.toLocaleString(), size: 'sm' })}
    ${statCard({ label: 'Admins', value: admins, size: 'sm' })}
  </div>`;
}

function invitesHTML(invites) {
  if (!invites.length) return html`<p class="text-small text-text-2">No invite codes yet.</p>`;
  return html`<div class="overflow-x-auto"><table class="w-full text-small text-left">
    <thead><tr class="text-text-2">
      <th scope="col" class="py-2 pr-3 label">Code</th>
      <th scope="col" class="py-2 pr-3 label">Created</th>
      <th scope="col" class="py-2 pr-3 label">Used by</th>
      <th scope="col" class="py-2 label"><span class="sr-only">Actions</span></th>
    </tr></thead>
    <tbody class="divide-y divide-border-1">
      ${invites.map(i => html`<tr data-invite-code="${i.code}">
        <td class="py-2 pr-3"><code class="font-mono ${i.used_at ? 'text-text-3 line-through' : 'text-text-1'}">${i.code}</code></td>
        <td class="py-2 pr-3 text-text-2 whitespace-nowrap">${i.created_at ? formatDate(i.created_at) : '—'}</td>
        <td class="py-2 pr-3 text-text-2">${i.used_at ? `@${i.used_by_username ?? 'unknown'}` : '—'}</td>
        <td class="py-2 text-right whitespace-nowrap">${i.used_at ? '' : html`
          ${iconButton({ icon: 'copy', label: `Copy invite code ${i.code}`, size: 'sm', attrs: 'data-action="copy-invite"' })}
          ${button({ label: 'Revoke', variant: 'danger-ghost', size: 'sm', attrs: 'data-confirm="Revoke this invite?" data-confirm-verb="Revoke" data-kind="invite"' })}`}</td>
      </tr>`)}
    </tbody>
  </table></div>`;
}

function userRow(u, meId) {
  const me = u.id === meId;
  return html`<li class="py-4 flex flex-wrap items-center gap-x-4 gap-y-3" data-user-id="${u.id}" data-username="${u.username}">
    <div class="min-w-0 flex-1 basis-48">
      <div class="flex items-center gap-2">
        <span class="font-medium truncate">@${u.username}</span>
        <span data-admin-badge>${u.is_admin ? badge({ label: 'Admin', variant: 'accent' }) : ''}</span>
        ${me ? badge({ label: 'You', variant: 'outline' }) : ''}
      </div>
      <p class="text-small text-text-2">Joined ${formatDate(u.created_at)} · ${plural(u.book_count ?? 0, 'book')} · ${u.last_active ? `last active ${timeAgo(u.last_active)}` : 'never active'}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      ${switchRow({ id: `admin-switch-${u.id}`, label: html`Admin<span class="sr-only"> access for @${u.username}</span>`, checked: !!u.is_admin, disabled: me, attrs: 'data-user-switch' })}
      ${button({ label: 'Reset password', variant: 'secondary', size: 'sm', attrs: 'data-action="reset-password"' })}
      ${button({ label: 'Revoke sessions', variant: 'secondary', size: 'sm', attrs: 'data-action="revoke-sessions"' })}
      ${me ? '' : button({ label: 'Delete', variant: 'danger-ghost', size: 'sm', attrs: `data-confirm="Delete this user and all their data? This can't be undone." data-confirm-verb="Delete user" data-kind="user"` })}
    </div>
  </li>`;
}

export function mount(el, { user: me }) {
  const scope = createScope();
  let users = [];
  let invites = [];

  function renderAll() {
    el.innerHTML = String(html`
      <div data-admin-stats>${statsHTML(users)}</div>

      ${card({ content: html`
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="h3">Invite codes</h3>
            ${button({ label: 'Create invite', variant: 'primary', size: 'sm', icon: 'plus', attrs: 'data-action="create-invite"' })}
          </div>
          <div data-invites>${invitesHTML(invites)}</div>
        </div>` })}

      ${card({ content: html`
        <div class="space-y-4">
          <div class="flex items-center gap-2"><h3 class="h3">Users</h3>${badge({ label: users.length })}</div>
          ${field({ name: 'filter', type: 'search', ariaLabel: 'Filter users', placeholder: 'Filter by username', icon: 'search', autocomplete: 'off' })}
          <ul class="divide-y divide-border-1" data-users aria-label="Users">${users.map(u => userRow(u, me.id))}</ul>
          <p class="text-small text-text-2" data-no-match hidden>No users match</p>
        </div>` })}`);
  }

  async function load() {
    el.innerHTML = String(skeletonCard());
    try {
      const [u, i] = await Promise.all([api.adminGetUsers(), api.getInvites().catch(() => [])]);
      if (scope.disposed) return;
      users = u;
      invites = i;
      renderAll();
      // Personalised confirm questions are set through the DOM (usernames never go into attribute strings)
      el.querySelectorAll('[data-users] [data-user-id]').forEach(row => {
        const del = row.querySelector('[data-kind="user"]');
        if (del) del.dataset.confirm = `Delete @${row.dataset.username} and all their data? This can't be undone.`;
      });
    } catch {
      if (scope.disposed) return;
      const e = EMPTY.loadError;
      el.innerHTML = String(emptyState({ icon: e.icon, title: e.title, body: e.body, action: { label: 'Try again', attrs: 'data-action="retry"' } }));
    }
  }

  const refreshStats = () => {
    const box = el.querySelector('[data-admin-stats]');
    if (box) box.innerHTML = String(statsHTML(users));
  };
  const findUser = (row) => users.find(u => u.id === Number(row?.dataset.userId));

  scope.add(mountFields(el));

  // ── Filter ──
  const onInput = (e) => {
    if (e.target.name !== 'filter') return;
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    el.querySelectorAll('[data-users] [data-user-id]').forEach(row => {
      const match = !q || row.dataset.username.toLowerCase().includes(q);
      row.hidden = !match;
      if (match) shown++;
    });
    el.querySelector('[data-no-match]').hidden = shown > 0;
  };
  el.addEventListener('input', onInput);
  scope.add(() => el.removeEventListener('input', onInput));

  // ── Invites ──
  scope.add(delegate(el, 'click', '[data-action="retry"]', () => load()));

  scope.add(delegate(el, 'click', '[data-action="create-invite"]', async (e, btn) => {
    btn.disabled = true;
    try {
      const invite = await api.createInvite();
      if (scope.disposed) return;
      invites = [invite, ...invites];
      el.querySelector('[data-invites]').innerHTML = String(invitesHTML(invites));
      let copied = true;
      try { await navigator.clipboard.writeText(invite.code); } catch { copied = false; }
      toast(copied ? TOAST.inviteCreated : 'Invite created');
    } catch {
      if (!scope.disposed) toast("Couldn't create invite", { type: 'error' });
    } finally {
      btn.disabled = false;
    }
  }));

  scope.add(delegate(el, 'click', '[data-action="copy-invite"]', async (e, btn) => {
    try { await navigator.clipboard.writeText(btn.closest('[data-invite-code]').dataset.inviteCode); toast(TOAST.copied); }
    catch { toast("Couldn't copy to the clipboard — try again", { type: 'error' }); }
  }));

  // ── Admin switch ──
  scope.add(delegate(el, 'change', '[data-user-switch]', async (e, sw) => {
    const row = sw.closest('[data-user-id]');
    const target = findUser(row);
    if (!target) return;
    const isAdmin = !!e.detail?.checked;
    sw.disabled = true;
    try {
      await api.adminSetAdmin(target.id, isAdmin);
      if (scope.disposed) return;
      target.is_admin = isAdmin;
      row.querySelector('[data-admin-badge]').innerHTML = String(isAdmin ? badge({ label: 'Admin', variant: 'accent' }) : '');
      refreshStats();
      toast(isAdmin ? `@${target.username} is now an admin` : `@${target.username} is no longer an admin`);
    } catch {
      if (scope.disposed) return;
      sw.setAttribute('aria-checked', String(!isAdmin));
      toast("Couldn't change admin access — try again", { type: 'error' });
    } finally {
      sw.disabled = false;
    }
  }));

  // ── Revoke sessions ──
  scope.add(delegate(el, 'click', '[data-action="revoke-sessions"]', async (e, btn) => {
    const target = findUser(btn.closest('[data-user-id]'));
    if (!target) return;
    btn.disabled = true;
    try {
      await api.adminRevokeSessions(target.id);
      if (!scope.disposed) toast(`Sessions revoked for @${target.username}`);
    } catch {
      if (!scope.disposed) toast("Couldn't revoke sessions — try again", { type: 'error' });
    } finally {
      btn.disabled = false;
    }
  }));

  // ── Reset password (modal) ──
  scope.add(delegate(el, 'click', '[data-action="reset-password"]', (e, btn) => {
    const target = findUser(btn.closest('[data-user-id]'));
    if (!target) return;
    const modal = openModal({
      title: `Reset password for @${target.username}`,
      size: 'sm',
      content: html`<div class="space-y-2">
        ${field({ name: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password', hint: `${PASSWORD_MIN} to ${PASSWORD_MAX} characters. Their sessions will be signed out.`, attrs: 'data-autofocus' })}
      </div>`,
      footer: html`${button({ label: 'Cancel', variant: 'ghost', attrs: 'data-modal-close' })}${button({ label: 'Set password', variant: 'primary', attrs: 'data-reset-confirm' })}`,
    });
    mountFields(modal.el);
    const input = modal.el.querySelector('input[name="newPassword"]');
    const submit = async () => {
      const pw = input.value;
      if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) {
        setFieldError(input, `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
        input.focus();
        return;
      }
      setFieldError(input, null);
      modal.setBusy(true);
      try {
        await api.adminResetPassword(target.id, pw);
        modal.close();
        toast('Password reset — their sessions were signed out');
      } catch (err) {
        modal.setBusy(false);
        setFieldError(input, errorText(err, "Couldn't reset the password — try again"));
      }
    };
    modal.el.addEventListener('click', (ev) => { if (ev.target instanceof Element && ev.target.closest('[data-reset-confirm]')) submit(); });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    input.addEventListener('input', () => setFieldError(input, null));
  }));

  // ── Confirmed destructive actions: revoke invite, delete user ──
  scope.add(mountConfirmInline(el, {
    onConfirm: async (trigger) => {
      if (trigger.dataset.kind === 'invite') {
        try {
          const code = trigger.closest('[data-invite-code]').dataset.inviteCode;
          await api.deleteInvite(code);
          if (scope.disposed) return;
          invites = invites.filter(i => i.code !== code);
          el.querySelector('[data-invites]').innerHTML = String(invitesHTML(invites));
          toast(TOAST.inviteRevoked);
        } catch {
          if (!scope.disposed) toast("Couldn't revoke invite", { type: 'error' });
        }
      } else if (trigger.dataset.kind === 'user') {
        const row = trigger.closest('[data-user-id]');
        const target = findUser(row);
        if (!target) return;
        try {
          await api.adminDeleteUser(target.id);
          if (scope.disposed) return;
          users = users.filter(u => u.id !== target.id);
          row.remove();
          refreshStats();
          toast('User deleted');
        } catch {
          if (!scope.disposed) toast("Couldn't delete user", { type: 'error' });
        }
      }
    },
  }));

  load();
  return scope.dispose;
}
