import { api } from '../api.js';

export function renderAuth(container, onSuccess) {
  let mode = 'login'; // 'login' | 'register'

  async function render() {
    const isRegister = mode === 'register';
    container.innerHTML = `
      <div class="min-h-[80vh] flex items-center justify-center px-4 relative">
        <div class="absolute inset-0 pointer-events-none overflow-hidden">
          <div style="position:absolute;top:-40%;left:50%;transform:translateX(-50%);width:600px;height:600px;background:radial-gradient(ellipse at center,rgba(245,158,11,0.06) 0%,transparent 70%);border-radius:50%"></div>
        </div>
        <div class="w-full max-w-sm relative">
          <div class="flex flex-col items-center mb-8 gap-3">
            <div class="relative">
              <div class="absolute inset-0 rounded-full bg-amber-400/20 blur-xl"></div>
              <div class="relative flex items-center justify-center bg-stone-800 rounded-full p-1.5 ring-2 ring-amber-500/30">
                <img src="/logo.png" class="h-20 w-20 sm:h-24 sm:w-24 rounded-full object-cover" alt="Bookworm logo" />
              </div>
            </div>
            <h1 class="font-serif text-3xl sm:text-4xl font-bold text-amber-400 tracking-tight">Bookworm</h1>
            <p class="text-stone-400 text-sm">${isRegister ? 'Create your account' : 'Sign in to your library'}</p>
          </div>
          <form id="auth-form" class="glass-card rounded-2xl p-6 space-y-4 shadow-2xl">
            <div>
              <label for="auth-username" class="text-xs text-stone-400 block mb-1">Username</label>
              <input id="auth-username" type="text" name="username" required autofocus autocomplete="username"
                placeholder="2–32 characters, letters / numbers / _ -"
                class="field-input py-2.5" />
            </div>
            <div>
              <label for="auth-password" class="text-xs text-stone-400 block mb-1">Password</label>
              <input id="auth-password" type="password" name="password" required autocomplete="${isRegister ? 'new-password' : 'current-password'}"
                class="field-input py-2.5" />
            </div>
            ${isRegister ? `
            <div>
              <label for="auth-confirm" class="text-xs text-stone-400 block mb-1">Confirm password</label>
              <input id="auth-confirm" type="password" name="confirmPassword" required autocomplete="new-password"
                class="field-input py-2.5" />
            </div>
            <div id="recaptcha-status" class="text-stone-400 text-xs"></div>
            <input type="hidden" name="recaptchaToken" id="recaptcha-token" />
            ` : ''}
            <button type="submit" id="submit-btn"
              class="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-xl py-2.5 text-sm transition-all duration-150 shadow-lg shadow-amber-500/20 hover:shadow-amber-400/30 disabled:opacity-50 disabled:cursor-not-allowed">
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
