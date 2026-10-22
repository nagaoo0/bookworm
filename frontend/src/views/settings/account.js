// Settings · Account: change password, sign out everywhere.
import { api, setLoggedIn } from '../../api.js';
import { html } from '../../utils.js';
import {
  TOAST, button, field, mountConfirmInline, mountFields, setButtonLoading, setFieldError, toast,
} from '../../ui/index.js';
import { createScope, group, groupCard } from './common.js';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export function mount(el, { user }) {
  const scope = createScope();

  const lbl = { labelStyle: 'inline' };
  el.innerHTML = String(html`
    <form data-password-form novalidate>
      ${groupCard([
        group(html`
          ${field({ name: 'currentPassword', label: 'Current password', type: 'password', autocomplete: 'current-password', required: true, ...lbl })}
          ${field({ name: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password', required: true, hint: `${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`, ...lbl })}
          ${field({ name: 'confirmPassword', label: 'Confirm new password', type: 'password', autocomplete: 'new-password', required: true, ...lbl })}`, { title: 'Change password' }),
      ], { footer: html`${button({ label: 'Update password', variant: 'primary', type: 'submit', attrs: 'data-save' })}<p class="field__error" role="alert" data-form-error hidden></p>` })}
    </form>

    ${groupCard([
      group(html`<div>${button({ label: 'Sign out everywhere', variant: 'danger-ghost', icon: 'log-out', attrs: 'data-confirm="Sign out on every device?" data-confirm-verb="Sign out"' })}</div>`,
        { title: 'Sessions', help: `You are signed in as @${user.username}. Signing out everywhere ends every session, including this one.` }),
    ])}`);

  scope.add(mountFields(el));

  const form = el.querySelector('[data-password-form]');
  const current = form.elements.currentPassword;
  const next = form.elements.newPassword;
  const confirm = form.elements.confirmPassword;
  const formError = el.querySelector('[data-form-error]');

  const clearErrors = () => { [current, next, confirm].forEach(i => setFieldError(i, null)); formError.hidden = true; };
  const onInput = (e) => { if ([current, next, confirm].includes(e.target)) setFieldError(e.target, null); };
  form.addEventListener('input', onInput);
  scope.add(() => form.removeEventListener('input', onInput));

  const onSubmit = async (e) => {
    e.preventDefault();
    clearErrors();
    let firstInvalid = null;
    const fail = (input, msg) => { setFieldError(input, msg); firstInvalid ??= input; };

    if (!current.value) fail(current, 'Enter your current password');
    if (next.value.length < PASSWORD_MIN || next.value.length > PASSWORD_MAX) fail(next, `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
    if (confirm.value !== next.value) fail(confirm, "Passwords don't match");
    if (firstInvalid) { firstInvalid.focus(); return; }

    const btn = form.querySelector('[data-save]');
    setButtonLoading(btn, true);
    try {
      await api.updateMe({ currentPassword: current.value, newPassword: next.value });
      if (scope.disposed) return;
      form.reset();
      toast(TOAST.passwordUpdated);
    } catch (err) {
      if (scope.disposed) return;
      // A wrong current password is a normal answer, not an expired session: stay signed in and say where
      if (err.status === 401) { fail(current, 'Current password is incorrect'); current.focus(); }
      else if (err.status === 400) { fail(next, err.message || `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`); next.focus(); }
      else { formError.textContent = "Couldn't update your password — try again"; formError.hidden = false; }
    } finally {
      setButtonLoading(btn, false);
    }
  };
  form.addEventListener('submit', onSubmit);
  scope.add(() => form.removeEventListener('submit', onSubmit));

  scope.add(mountConfirmInline(el, {
    onConfirm: async (trigger) => {
      try {
        await api.logoutAll();
        // The server ended this session too: show the auth screen instead of firing 401 handlers
        setLoggedIn(false);
        location.hash = '';
        location.reload();
      } catch {
        if (!scope.disposed) toast("Couldn't sign out other sessions", { type: 'error' });
        trigger.focus?.();
      }
    },
  }));

  return scope.dispose;
}
