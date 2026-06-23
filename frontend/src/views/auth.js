import { api } from '../api.js';

export function renderAuth(container, onSuccess) {
  let mode = 'login'; // 'login' | 'register'

  async function render() {
    const isRegister = mode === 'register';
    container.innerHTML = `
      <div class="min-h-[80vh] flex items-center justify-center px-4">
        <div class="w-full max-w-sm">
          <div class="flex flex-col items-center mb-6 gap-2">
            <div class="flex items-center justify-center bg-stone-800 rounded-full p-1">
              <img src="/logo.png" class="h-24 w-24 sm:h-28 sm:w-28 md:h-32 md:w-32 rounded-full object-cover" alt="Bookworm logo" />
            </div>
            <h1 class="font-serif text-2xl sm:text-3xl font-semibold text-amber-400">Bookworm</h1>
            <p class="text-stone-400 text-sm">${isRegister ? 'Create your account' : 'Sign in to your library'}</p>
          </div>
          <form id="auth-form" class="bg-stone-900 rounded-xl p-6 space-y-4 ring-1 ring-white/10 shadow-2xl">
            <div>
              <label for="auth-username" class="text-xs text-stone-400 block mb-1">Username</label>
              <input id="auth-username" type="text" name="username" required autofocus autocomplete="username"
                placeholder="2–32 characters, letters / numbers / _ -"
                class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            <div>
              <label for="auth-password" class="text-xs text-stone-400 block mb-1">Password</label>
              <input id="auth-password" type="password" name="password" required autocomplete="${isRegister ? 'new-password' : 'current-password'}"
                class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            ${isRegister ? `
            <div>
              <label for="auth-confirm" class="text-xs text-stone-400 block mb-1">Confirm password</label>
              <input id="auth-confirm" type="password" name="confirmPassword" required autocomplete="new-password"
                class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            <div id="recaptcha-status" class="text-stone-400 text-xs"></div>
            <input type="hidden" name="recaptchaToken" id="recaptcha-token" />
            ` : ''}
            <button type="submit" id="submit-btn"
              class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              ${isRegister ? 'Create account' : 'Sign in'}
            </button>
            <p id="auth-error" class="text-red-400 text-xs text-center hidden"></p>
          </form>
          <p class="text-center text-sm text-stone-500 mt-4">
            ${isRegister
              ? `Already have an account? <button id="toggle-mode" class="text-amber-400 hover:text-amber-300">Sign in</button>`
              : `Don't have an account? <button id="toggle-mode" class="text-amber-400 hover:text-amber-300">Register</button>`}
          </p>
        </div>
      </div>`;

    if (isRegister) {
      loadRecaptcha(container);
    }

    container.querySelector('#toggle-mode').addEventListener('click', () => {
      mode = mode === 'login' ? 'register' : 'login';
      render();
    });

    container.querySelector('#auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = container.querySelector('#auth-error');
      const submitBtn = container.querySelector('#submit-btn');
      errEl.classList.add('hidden');

      const fd = new FormData(e.target);
      const username = fd.get('username')?.trim();
      const password = fd.get('password');

      if (mode === 'register') {
        const confirm = fd.get('confirmPassword');
        if (password !== confirm) {
          errEl.textContent = 'Passwords do not match.';
          errEl.classList.remove('hidden');
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';

      try {
        let user;
        if (mode === 'login') {
          user = await api.login({ username, password });
        } else {
          const tokenEl = container.querySelector('#recaptcha-token');
          const siteKey = window._recaptchaSiteKey || (await api.getRecaptchaSiteKey().catch(() => null))?.siteKey;
          if (window.grecaptcha && siteKey) {
            try {
              const tok = await window.grecaptcha.execute(siteKey, { action: 'register' });
              if (tokenEl) tokenEl.value = tok;
              window._recaptchaSiteKey = siteKey;
            } catch (_) {
              // ignore; backend will validate
            }
          }
          const recaptchaToken = container.querySelector('#recaptcha-token')?.value || undefined;
          user = await api.register({ username, password, recaptchaToken });
        }
        onSuccess(user);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      }
    });
  }

  render();
}

async function loadRecaptcha(container) {
  const statusEl = container.querySelector('#recaptcha-status');
  const tokenEl = container.querySelector('#recaptcha-token');
  if (!tokenEl) return;

  let res;
  try {
    res = await api.getRecaptchaSiteKey();
  } catch (_) {
    return;
  }

  const siteKey = res?.siteKey;
  if (!siteKey) return;

  window._recaptchaSiteKey = siteKey;

  try {
    if (!window.grecaptcha) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load reCAPTCHA script'));
        document.head.appendChild(s);
      });
    }
    if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
      const token = await window.grecaptcha.execute(siteKey, { action: 'register' });
      tokenEl.value = token;
    }
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Anti-bot check unavailable';
    console.warn('reCAPTCHA setup failed', err);
  }
}
