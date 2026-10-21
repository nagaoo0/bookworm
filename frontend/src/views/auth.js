// Auth screen: sign in / create account (design-system §8.9).
//
//   renderAuth(el, { onSuccess(user, target), next?, mode? }) -> cleanup
//
// `next` is a hash such as "#library" to land on after signing in; anything that is not an in-app
// hash (or points back at the auth screen) falls back to "#home". `onSuccess` receives the user and
// that resolved target; the shell does the navigation. `mode` is 'login' (default) or 'register'.
import { html } from '../utils.js';
import { api } from '../api.js';
import { button, setButtonLoading, field, setFieldError, mountFields, card } from '../ui/index.js';

/** Resolve a `next` hash to a safe in-app target. */
export function safeNext(next) {
  const n = typeof next === 'string' ? next.trim() : '';
  if (!n.startsWith('#') || n.length < 2 || n.length > 2000 || /^#auth(?:[/?]|$)/.test(n)) return '#home';
  return n;
}

// reCAPTCHA v3: the script is only ever loaded on the register form, and only when the server has a key.
let recaptchaScript = null;
function loadRecaptchaScript(siteKey) {
  if (window.grecaptcha?.execute) return Promise.resolve();
  if (!recaptchaScript) {
    recaptchaScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { recaptchaScript = null; reject(new Error('Failed to load reCAPTCHA script')); };
      document.head.appendChild(s);
    });
  }
  return recaptchaScript;
}

async function recaptchaToken(siteKey) {
  const g = window.grecaptcha;
  if (!siteKey || !g?.execute) return undefined;
  if (typeof g.ready === 'function') await new Promise(resolve => g.ready(resolve));
  return g.execute(siteKey, { action: 'register' });
}

function messageFor(err, isLogin) {
  if (err?.status === 401 && isLogin) return 'Wrong username or password';
  if (err?.status === undefined) return "Couldn't reach the server — try again";
  return err.message || 'Something went wrong — try again';
}

export function renderAuth(el, { onSuccess, next, mode: startMode = 'login' } = {}) {
  let mode = startMode === 'register' ? 'register' : 'login';
  let username = '';
  let config = null;          // { recaptchaConfigured, requireInvite } once /auth/config answered
  let configRequested = false;
  let inviteOpen = false;     // optional invite field expanded
  let siteKey = null;
  let busy = false;
  let disposed = false;

  const q = (sel) => el.querySelector(sel);

  function inviteHtml() {
    if (config?.requireInvite) {
      return field({
        name: 'inviteCode', label: 'Invite code', id: 'auth-invite', autocomplete: 'off',
        hint: 'This server is invite-only',
        attrs: 'autocapitalize="none" spellcheck="false"',
      });
    }
    if (inviteOpen) {
      return field({
        name: 'inviteCode', label: 'Invite code (optional)', id: 'auth-invite', autocomplete: 'off',
        attrs: 'autocapitalize="none" spellcheck="false"',
      });
    }
    return html`<div class="text-left">${button({
      label: 'Have an invite code?', variant: 'ghost', size: 'sm',
      attrs: 'data-auth-action="invite" aria-expanded="false" aria-controls="auth-invite-slot"',
    })}</div>`;
  }

  function renderInviteSlot({ focus = false } = {}) {
    const slot = q('[data-invite-slot]');
    if (!slot) return;
    const kept = slot.querySelector('input[name="inviteCode"]')?.value ?? '';
    slot.innerHTML = String(inviteHtml());
    const input = slot.querySelector('input[name="inviteCode"]');
    if (input) { input.value = kept; if (focus) input.focus(); }
  }

  function render() {
    const isRegister = mode === 'register';
    document.title = `${isRegister ? 'Create account' : 'Sign in'} · Bookworm`;
    el.innerHTML = String(html`
      <div class="mx-auto flex min-h-[70dvh] w-full max-w-sm flex-col justify-center py-6">
        <div class="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/logo.png" class="h-18 w-18 rounded-full border border-border-1" alt="">
          <h1 class="display text-accent-text" tabindex="-1">Bookworm</h1>
          <p class="text-small text-text-2">${isRegister ? 'Create your account' : 'Sign in to your library'}</p>
        </div>
        ${card({ padding: 'md', content: html`
          <form class="flex flex-col gap-4" data-auth-form novalidate>
            ${field({
              name: 'username', label: 'Username', id: 'auth-username', value: username, required: true,
              autocomplete: 'username', hint: isRegister ? '2–32 characters: letters, numbers, _ and -' : undefined,
              attrs: 'autocapitalize="none" autocorrect="off" spellcheck="false"',
            })}
            ${field({
              name: 'password', label: 'Password', type: 'password', id: 'auth-password', required: true,
              autocomplete: isRegister ? 'new-password' : 'current-password',
            })}
            ${isRegister ? html`
              ${field({ name: 'confirmPassword', label: 'Confirm password', type: 'password', id: 'auth-confirm', required: true, autocomplete: 'new-password' })}
              <div id="auth-invite-slot" data-invite-slot>${inviteHtml()}</div>
              <p class="text-caption text-text-3" data-recaptcha-status role="status"></p>
            ` : html`
              <div class="-mt-2 flex justify-end">${button({ label: 'Forgot password?', variant: 'ghost', size: 'sm', attrs: 'data-auth-action="forgot"' })}</div>
              <p class="text-small text-info" data-auth-info role="status" hidden>Contact your server admin to reset your password.</p>
            `}
            <p class="text-small text-danger" data-auth-error role="alert" hidden></p>
            ${button({ label: isRegister ? 'Create account' : 'Sign in', variant: 'primary', size: 'lg', block: true, type: 'submit', id: 'auth-submit' })}
          </form>` })}
        <p class="mt-4 flex flex-wrap items-center justify-center gap-1 text-small text-text-2">
          ${isRegister ? 'Already have an account?' : "Don't have an account?"}
          ${button({ label: isRegister ? 'Sign in' : 'Create account', variant: 'ghost', size: 'sm', attrs: 'data-auth-action="toggle"' })}
        </p>
      </div>`);

    q('#auth-username')?.focus();
    if (isRegister) ensureConfig();
  }

  function showError(message) {
    const p = q('[data-auth-error]');
    if (!p) return;
    p.textContent = message;
    p.hidden = !message;
  }

  async function ensureConfig() {
    if (config) { setupRecaptcha(); return; }
    if (configRequested) return;
    configRequested = true;
    try { config = await api.getAuthConfig(); } catch { config = { recaptchaConfigured: false, requireInvite: false }; }
    if (disposed || mode !== 'register') return;
    renderInviteSlot();
    setupRecaptcha();
  }

  async function setupRecaptcha() {
    if (!config?.recaptchaConfigured || siteKey === false) return;
    const status = q('[data-recaptcha-status]');
    try {
      if (!siteKey) siteKey = (await api.getRecaptchaSiteKey())?.siteKey ?? false;
      if (!siteKey) return;
      await loadRecaptchaScript(siteKey);
    } catch (err) {
      siteKey = siteKey || false;
      if (!disposed && status) status.textContent = 'Anti-bot check unavailable';
      console.warn('reCAPTCHA setup failed', err);
    }
  }

  async function submit(form) {
    if (busy) return;
    const isRegister = mode === 'register';
    const fd = new FormData(form);
    username = String(fd.get('username') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    const submitBtn = q('#auth-submit');

    showError('');
    const userField = q('#auth-username');
    const passField = q('#auth-password');
    const confirmField = q('#auth-confirm');
    setFieldError(userField, null);
    setFieldError(passField, null);
    if (confirmField) setFieldError(confirmField, null);

    let invalid = null;
    if (!username) { setFieldError(userField, 'Enter a username'); invalid = userField; }
    if (!password) { setFieldError(passField, 'Enter your password'); invalid = invalid ?? passField; }
    if (isRegister && password && password !== String(fd.get('confirmPassword') ?? '')) {
      setFieldError(confirmField, "Passwords don't match");
      invalid = invalid ?? confirmField;
    }
    if (invalid) { invalid.focus(); return; }

    busy = true;
    setButtonLoading(submitBtn, true);
    try {
      let user;
      if (isRegister) {
        const inviteCode = String(fd.get('inviteCode') ?? '').trim() || undefined;
        let token;
        if (config?.recaptchaConfigured && siteKey) {
          try { token = await recaptchaToken(siteKey); } catch { /* the server decides */ }
        }
        user = await api.register({ username, password, inviteCode, recaptchaToken: token });
      } else {
        user = await api.login({ username, password });
      }
      if (disposed) return;
      onSuccess?.(user, safeNext(next));
    } catch (err) {
      if (disposed) return;
      const message = messageFor(err, !isRegister);
      showError(message);
      if (isRegister && /invite/i.test(message) && !q('input[name="inviteCode"]')) {
        inviteOpen = true;
        renderInviteSlot({ focus: true });
      }
      busy = false;
      setButtonLoading(submitBtn, false);
    }
  }

  const onClick = (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-auth-action]') : null;
    if (!t || !el.contains(t)) return;
    const action = t.dataset.authAction;
    if (action === 'toggle') {
      username = q('#auth-username')?.value.trim() ?? username;
      mode = mode === 'login' ? 'register' : 'login';
      render();
    } else if (action === 'forgot') {
      const info = q('[data-auth-info]');
      if (info) info.hidden = false;
    } else if (action === 'invite') {
      inviteOpen = true;
      renderInviteSlot({ focus: true });
    }
  };
  const onSubmit = (e) => {
    const form = e.target instanceof Element ? e.target.closest('[data-auth-form]') : null;
    if (!form) return;
    e.preventDefault();
    submit(form);
  };
  const onInput = () => showError('');

  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('input', onInput);
  const offFields = mountFields(el);

  render();

  return () => {
    disposed = true;
    el.removeEventListener('click', onClick);
    el.removeEventListener('submit', onSubmit);
    el.removeEventListener('input', onInput);
    offFields();
  };
}
