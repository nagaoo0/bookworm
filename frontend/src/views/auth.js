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
              <label class="text-xs text-stone-400 block mb-1">Username</label>
              <input type="text" name="username" required autofocus autocomplete="username"
                placeholder="2–32 characters, letters / numbers / _ -"
                class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            <div>
              <label class="text-xs text-stone-400 block mb-1">Password</label>
              <input type="password" name="password" required autocomplete="${isRegister ? 'new-password' : 'current-password'}"
                class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            ${isRegister ? `
            <div>
              <label class="text-xs text-stone-400 block mb-1">
                Invite code
                <span id="first-user-hint" class="text-stone-500 ml-1 hidden">(not needed for the first account)</span>
              </label>
              <input type="text" name="inviteCode" id="invite-code-input"
                placeholder="Leave blank if you're the first user"
                class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-sm
                       focus:outline-none focus:border-amber-500 transition-colors font-mono" />
            </div>` : ''}
            ${isRegister ? `
            <div id="recaptcha-status" class="text-stone-400 text-xs">Loading anti-bot check...</div>
            <input type="hidden" name="recaptchaToken" id="recaptcha-token" />
            ` : ''}
            <button type="submit"
              class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg py-2.5 text-sm transition-colors">
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

    // Check if there are any users (to show the hint)
    if (isRegister) {
      checkFirstUser(container);
      await loadRecaptcha(container);
    }

    container.querySelector('#toggle-mode').addEventListener('click', () => {
      mode = mode === 'login' ? 'register' : 'login';
      render();
    });

    container.querySelector('#auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = container.querySelector('#auth-error');
      errEl.classList.add('hidden');
      const fd = new FormData(e.target);
      const username = fd.get('username')?.trim();
      const password = fd.get('password');
  const inviteCode = fd.get('inviteCode')?.trim() || undefined;
  const recaptchaToken = fd.get('recaptchaToken') || undefined;

      try {
        let user;
        if (mode === 'login') {
          user = await api.login({ username, password });
        } else {
          // Ensure we have a fresh recaptcha token if grecaptcha is available
          const tokenEl = container.querySelector('#recaptcha-token');
          const siteKeyRes = await api.getRecaptchaSiteKey().catch(() => null);
          const siteKey = siteKeyRes?.siteKey;
          if (window.grecaptcha && siteKey) {
            try {
              const tok = await window.grecaptcha.execute(siteKey, { action: 'register' });
              if (tokenEl) tokenEl.value = tok;
            } catch (e) {
              // ignore and let backend validate; token may be empty
            }
          }
          const recaptchaTokenNow = (container.querySelector('#recaptcha-token') || {}).value;
          user = await api.register({ username, password, inviteCode, recaptchaToken: recaptchaTokenNow });
        }
        onSuccess(user);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
  }

  render();
}

async function loadRecaptcha(container) {
  const statusEl = container.querySelector('#recaptcha-status');
  const tokenEl = container.querySelector('#recaptcha-token');
  if (statusEl) statusEl.textContent = 'Loading anti-bot check...';
  if (!tokenEl) return;
  try {
    const res = await api.getRecaptchaSiteKey();
    const siteKey = res.siteKey;
    if (!siteKey) throw new Error('No site key');

    // If grecaptcha not already loaded, inject script
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
    statusEl.textContent = 'Anti-bot ready';
    // Pre-execute a token for the 'register' action and store it; tokens are short-lived so we'll fetch again on submit too.
    if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
      const token = await window.grecaptcha.execute(siteKey, { action: 'register' });
      tokenEl.value = token;
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Anti-bot unavailable';
    console.warn('reCAPTCHA setup failed', err);
  }
}

async function checkFirstUser(container) {
  // We can't know client-side if users exist, so we try registering with no invite
  // and check the error. Instead, just hint from the placeholder text — the backend
  // will enforce. Show a softer hint by checking if the invite input is focused-empty.
  const hint = container.querySelector('#first-user-hint');
  const input = container.querySelector('#invite-code-input');
  if (!hint || !input) return;

  // Fetch /api/auth/me — if 401, users likely exist; we can't really tell.
  // The most honest thing: show the hint permanently so first-time users know.
  hint.classList.remove('hidden');
}

// legacy captcha removed
