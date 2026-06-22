import { api } from '../api.js';

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center px-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <span class="text-5xl">📚</span>
          <h1 class="font-serif text-3xl font-semibold text-amber-400 mt-3">Bookworm</h1>
          <p class="text-stone-400 text-sm mt-1">Enter your password to continue</p>
        </div>
        <form id="login-form" class="bg-stone-900 rounded-xl p-6 space-y-4 ring-1 ring-white/10 shadow-2xl">
          <div>
            <label class="text-xs text-stone-400 block mb-1">Password</label>
            <input type="password" name="password" required autofocus
              class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-sm
                     focus:outline-none focus:border-amber-500 transition-colors" />
          </div>
          <button type="submit"
            class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg py-2.5 text-sm transition-colors">
            Sign in
          </button>
          <p id="login-error" class="text-red-400 text-xs text-center hidden">Wrong password.</p>
        </form>
      </div>
    </div>`;

  container.querySelector('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = container.querySelector('#login-error');
    errEl.classList.add('hidden');
    const password = new FormData(e.target).get('password');
    try {
      await api.login(password);
      onSuccess();
    } catch {
      errEl.classList.remove('hidden');
    }
  });
}
